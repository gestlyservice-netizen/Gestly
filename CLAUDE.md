# CLAUDE.md — Gestly

SaaS de gestion pour artisans et indépendants : clients, devis, factures, avoirs, relances automatiques, agenda, pipeline commercial, abonnement Stripe. Interface et code commentés en **français**.

## Règles absolues (à lire avant toute action)

1. **Production intouchable sans autorisation explicite.** Interdit sans accord écrit de l'utilisateur dans la conversation en cours :
   - toute commande Prisma qui écrit dans une base (`prisma db push`, `prisma migrate dev|deploy|reset`, `prisma db execute`, scripts de seed) ;
   - tout déploiement ou commande Vercel (`vercel`, `vercel --prod`, `vercel env ...`) ;
   - tout `git push`, et a fortiori `git push --force` ;
   - tout appel réel à Stripe, Resend, OVH (SMS), Meta WhatsApp Cloud API ou au gateway IA ;
   - tout appel aux routes cron (`/api/relances/check`, `/api/stripe/resync`, `/api/admin/ovh-balance/check`, `/api/health`).
   Tant qu'aucune base de développement isolée n'est confirmée, **considérer que `DATABASE_URL` pointe vers la production** et ne pas lancer `npm run dev` sur des parcours qui écrivent en base ou envoient des messages.
2. **Ne jamais lire ni exposer de secrets.** Ne pas ouvrir `.env`, `.env.local` ni aucun `.env*` ; ne pas afficher de variables d'environnement ; ne jamais écrire une valeur de clé, de token ou d'URL de connexion dans le code, un commit, un log, un fichier Markdown ou une réponse. Se référer aux variables **par leur nom uniquement**.
3. **Toute modification doit être vérifiée** (voir « Commandes de vérification ») avant d'être déclarée terminée. Ne jamais annoncer une fonctionnalité comme « terminée » ou « fonctionnelle » sans preuve (commande exécutée et sortie observée, ou test automatisé).
4. **Mettre à jour `PROGRESS.md`** à la fin de chaque tâche (fait, preuve, blocages, prochaine action) et `ROADMAP.md` si l'état d'une fonctionnalité change.
5. Travailler sur une **branche dédiée** (`feat/…`, `fix/…`, `chore/…`), jamais directement sur `main`. Ne pas réécrire l'historique.
6. Ne pas contourner les permissions de Claude Code ni désactiver les hooks git (`--no-verify`).

## Stack

| Domaine | Outil |
|---|---|
| Framework | Next.js 14.2 (App Router), React 18, TypeScript `strict` |
| Base de données | PostgreSQL via Prisma 7 + `@prisma/adapter-pg` (`lib/prisma.ts`) |
| Authentification | Clerk (`middleware.ts`, `lib/auth.ts`) |
| UI | Tailwind CSS 3, shadcn/ui (`components/ui`), Base UI, lucide-react |
| Formulaires | react-hook-form + Zod |
| Paiement | Stripe (abonnement, Customer Portal, webhook) |
| Emails | Resend |
| SMS | OVH (`lib/sms`) |
| WhatsApp | Meta WhatsApp Cloud API, template `devis_client` (`app/api/devis/[id]/whatsapp/route.ts`) |
| IA | Vercel AI SDK `ai` (`generateText`, modèle `openai/gpt-4o-mini`) |
| PDF | jsPDF + html2canvas (`lib/pdf`, `lib/generate-pdf.ts`) |
| Monitoring | Sentry (`sentry.*.config.ts`, `instrumentation.ts`) |
| Hébergement | Vercel, région `fra1`, crons dans `vercel.json` |

## Architecture

```
app/
  page.tsx                  Landing publique
  (cgu|cgv|privacy|mentions-legales|remboursement|contact)/  Pages légales publiques
  sign-in/, sign-up/        Clerk
  abonnement/               Choix d'abonnement (public)
  dashboard/                Application authentifiée
    clients/ devis/ factures/ agenda/ pipeline/
    parametres/ (général, abonnement, relances)
  admin/ovh-balance/        Suivi du solde SMS OVH
  d/[id]/                   Lien court public vers un devis
  print/(devis|factures)/[id]/  Rendu imprimable (public)
  api/
    clients, devis, factures, avoirs, events, opportunities, notifications, settings
    devis/[id]/(duplicate|link|send|to-facture|whatsapp)
    factures/[id]/(avoir|relances|send)
    ai/improve-message      Amélioration de texte par IA (rate-limité)
    relances/check          Cron : envoi des relances
    stripe/(create-checkout-session|create-portal-session|resync|webhook)
    admin/ovh-balance/(check|history)
    public/devis/[id]       Lecture publique d'un devis
    health                  Cron de santé
components/
  ui/        Composants shadcn
  layouts/   dashboard-shell, sidebar, header, notifications-bell
  landing/   Sections de la landing
lib/
  auth.ts             getCurrentUser(), isSubscriptionBlocked()
  prisma.ts           Client Prisma singleton
  rate-limit.ts       isRateLimited(key, limit, windowMs) — en mémoire
  relances/           Moteur et messages de relance
  sms/                Abstraction SMS + fournisseur OVH
  ai/config.ts        isAiConfigured()
  pdf/, generate-pdf.ts
  stripe.ts, stripe-sync.ts, notifications.ts, ovh-balance.ts, url.ts, utils.ts
prisma/schema.prisma  15 modèles (User, Client, Devis(+Line), Facture(+Line), Avoir(+Line),
                      Settings, RelanceSettings, Relance, Event, Notification, Opportunity,
                      OvhBalanceAlert)
```

Il n'existe **pas** de dossier `prisma/migrations` : le schéma n'est pas versionné par migrations. Ne pas en créer ni en appliquer sans décision explicite de l'utilisateur.

## Conventions

- **Routes publiques** : déclarées dans `isPublicRoute` de `middleware.ts`. Toute nouvelle route publique doit être justifiée et protégée autrement (secret de cron, signature de webhook, identifiant non devinable).
- **Routes API authentifiées** : commencer par
  ```ts
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  if (isSubscriptionBlocked(user)) return NextResponse.json({ error: "Abonnement inactif ou impayé" }, { status: 402 });
  ```
- **Isolation des données (anti-IDOR)** : toute requête Prisma sur une ressource utilisateur filtre par `userId: user.id` (ex. `prisma.devis.findFirst({ where: { id, userId: user.id } })`). Ne jamais charger par `id` seul.
- **Crons** : protégés par le secret `CRON_SECRET` (en-tête `Authorization`). Ne jamais retirer ce contrôle.
- **Erreurs API** : `try/catch`, `console.error("[METHOD /api/chemin]", err)`, réponse JSON `{ error: "message en français" }` avec le bon code HTTP. Ne jamais renvoyer de secret ni de stack trace au client.
- **Appels coûteux** (IA, SMS, WhatsApp, emails) : vérifier la configuration, limiter le débit (`isRateLimited`), et ne jamais les déclencher depuis une boucle non bornée.
- **Imports** : alias `@/…` (racine du projet).
- **Commits** : Conventional Commits en français (`feat: …`, `fix: …`, `chore: …`, `ci: …`), un sujet par commit.
- Respecter le style du code environnant (densité de commentaires, nommage français/anglais existant).

## Commandes de vérification

À exécuter avant de déclarer une tâche terminée (toutes sont locales, sans appel externe) :

```bash
npx tsc --noEmit     # typage (pas encore de script npm dédié)
npm run lint         # ESLint (next/core-web-vitals + next/typescript)
```

Notes :
- `npm run build` exécute `prisma generate` puis `next build` ; à lancer pour les changements de configuration, de routes ou de dépendances.
- **Aucun framework de test n'est installé** à ce jour (ni Vitest, ni Jest, ni Playwright) et **aucune CI** n'existe. Tant que ce n'est pas le cas, indiquer explicitement dans `PROGRESS.md` qu'une modification n'est vérifiée que par typage et lint.
- Ne pas lancer `npm run dev` contre une base dont on ne sait pas qu'elle est isolée de la production.

## Suivi de progression

- `ROADMAP.md` : fonctionnalités V1 et leur **état de vérification** (pas leur état supposé).
- `PROGRESS.md` : journal chronologique des sessions — tâches réalisées avec preuve, blocages, prochaines actions.
- Mettre à jour les deux fichiers dans le même commit que la modification concernée.
