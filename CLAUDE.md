# CLAUDE.md — Gestly

SaaS de gestion pour artisans et indépendants : clients, devis, factures, avoirs, relances automatiques, agenda, pipeline commercial, abonnement Stripe. Interface et code commentés en **français**.

## Règles absolues (à lire avant toute action)

1. **Production intouchable sans autorisation explicite.** Interdit sans accord écrit de l'utilisateur dans la conversation en cours :
   - toute commande Prisma qui écrit dans une base (`prisma db push`, `prisma migrate dev|deploy|reset`, `prisma db execute`, scripts de seed) ;
   - tout déploiement ou commande Vercel (`vercel`, `vercel --prod`, `vercel env ...`) ;
   - tout `git push`, et a fortiori `git push --force` ;
   - tout appel réel à Stripe, Resend, OVH (SMS), Meta WhatsApp Cloud API ou au gateway IA ;
   - tout appel aux routes cron (`/api/relances/check`, `/api/stripe/resync`, `/api/admin/ovh-balance/check`, `/api/health`, `/api/whatsapp/process-pending`) ou au webhook `/api/whatsapp/webhook`.
   Tant qu'aucune base de développement isolée n'est confirmée, **considérer que `DATABASE_URL` pointe vers la production** et ne pas lancer `npm run dev` sur des parcours qui écrivent en base ou envoient des messages.
   **Tout développement autonome doit se faire dans un environnement isolé** (voir la section « Environnement de développement isolé »). Sans isolement confirmé par l'utilisateur, se limiter au code, aux tests simulés et au build isolé.
2. **Ne jamais lire ni exposer de secrets.** Ne pas ouvrir `.env`, `.env.local` ni aucun `.env*` ; ne pas afficher de variables d'environnement ; ne jamais écrire une valeur de clé, de token ou d'URL de connexion dans le code, un commit, un log, un fichier Markdown ou une réponse. Se référer aux variables **par leur nom uniquement**.
3. **Toute modification doit être vérifiée** (voir « Commandes de vérification ») avant d'être déclarée terminée. Ne jamais annoncer une fonctionnalité comme « terminée » ou « fonctionnelle » sans preuve (commande exécutée et sortie observée, ou test automatisé).
4. **Mettre à jour `PROGRESS.md`** à la fin de chaque tâche (fait, preuve, blocages, prochaine action) et `ROADMAP.md` si l'état d'une fonctionnalité change.
5. Travailler sur une **branche dédiée** (`feat/…`, `fix/…`, `chore/…`), jamais directement sur `main`. Ne pas réécrire l'historique.
6. Ne pas contourner les permissions de Claude Code ni désactiver les hooks git (`--no-verify`).

## Environnement de développement isolé (obligatoire)

**Décision de l'utilisateur (2026-10-22)** : Gestly n'a aucun client réel. Les données Supabase sont fictives, et la base Supabase actuelle (projet `ixaxfhitplhynhpihojx`, Postgres 17, eu-west-1) **sert à la fois au développement et aux tests**. Aucun nouvel environnement de base pour l'instant.

État vérifié le 2026-10-22, sans lecture des valeurs :
- `.env.local` référence bien ce projet Supabase.
- Stripe : **mode test** (préfixe de clé). Clerk : **instance de développement** (préfixes `pk_test_`/`sk_test_`).
- ⚠️ **Clés réelles présentes** pour Resend, OVH SMS, WhatsApp (Meta) et OpenAI. **Tout parcours qui envoie déclenche un envoi réel** (SMS facturés, messages WhatsApp, emails, appels IA facturés).
- `CRON_SECRET` absent en local : les routes cron ne sont alors accessibles qu'à l'administrateur connecté.

Règles qui en découlent :
- Données de la base : créer et modifier des données **fictives** est autorisé pour développer et tester. Toute **suppression** de données reste soumise à accord explicite.
- **Changements de schéma** : jamais `prisma db push`. Il supprimerait l'index unique partiel `Notification(userId, dedupeKey) WHERE dedupeKey IS NOT NULL`, qui n'est pas exprimable dans `schema.prisma` et garantit `createNotificationOnce`. Procédure : fichier SQL up/down dans `prisma/manual-migrations/`, appliqué après accord explicite, puis mise à jour de `schema.prisma` et `prisma generate`.
- **Envois réels** : tant que le mode simulation n'est pas en place dans le code, ne jamais déclencher en local un parcours qui envoie un SMS, un WhatsApp, un email ou un appel IA. Ne jamais utiliser de vrais numéros de téléphone ou adresses email dans les données de test.

### Règles

- Les variables locales viennent de `.env.example`, copié en `.env.local` (lu par Next.js) **et** en `.env` (lu par la CLI Prisma : `prisma.config.ts` charge `dotenv/config`, donc `.env` seulement, jamais `.env.local`).
- Ne jamais utiliser de valeur de production en local. Ne jamais lancer `vercel env pull` vers le dépôt : il écrirait des secrets réels et un `VERCEL_OIDC_TOKEN`, capable d'authentifier l'AI Gateway facturée.
- Ne jamais ouvrir ni afficher `.env`, `.env.local` ou `.env.*.local`. L'isolement se prouve par l'utilisateur, ou par des contrôles qui n'affichent pas de valeur (préfixe `sk_test_`/`pk_test_`, hôte de base dans une liste autorisée).
- Ne pas supposer qu'un service est en mode test sans preuve.

### Par service

| Service | Développement | Risque si mal configuré |
|---|---|---|
| PostgreSQL | Base distincte (projet de dev). SSL obligatoire : `lib/prisma.ts` force `ssl: { rejectUnauthorized: false }` | Écriture, suppression ou migration sur les données clients réelles |
| Clerk | Instance de développement (`pk_test_`/`sk_test_`) | Comptes réels ; les `clerkId` diffèrent entre instances |
| Stripe | Mode test (`sk_test_`, prix de test, `stripe listen` pour le webhook) | Paiements et abonnements réels |
| Resend | Clé vide (pas d'envoi) ; sinon compte de test et destinataires `*@resend.dev` | Emails réels aux clients. Avec une clé vide, `new Resend("")` lève une exception : les routes d'envoi renvoient une erreur, seules les relances l'ignorent |
| OVH SMS | Variables vides : `sendSMS()` renvoie `false` | Pas de mode test : SMS réels et facturés |
| Meta WhatsApp | Variables vides, ou `WHATSAPP_GRAPH_API_BASE_URL` vers un faux serveur local | Messages réels. ⚠️ `app/api/devis/[id]/whatsapp/route.ts` a l'URL Meta en dur et ignore cette variable |
| IA (Gateway/OpenAI) | Clés vides : `isAiConfigured()` est faux ; tests via `MockLanguageModelV4` / `MockTranscriptionModelV4` | Appels facturés |
| Supabase Storage (logos) | Vide, ou projet de dev | Fichiers déposés dans le stockage de production |
| Sentry | DSN et token vides ; `SENTRY_URL=http://127.0.0.1:9` pour un build hors ligne | Erreurs de dev mêlées à la production ; télémétrie du plugin |
| Liens publics | ⚠️ `lib/url.ts` rejette `localhost` et retombe sur `https://www.gestly.fr` | Liens de dev pointant vers la production |
| Admin | ⚠️ `ADMIN_EMAIL` est écrit en dur dans 3 routes ; le cron OVH et `/api/health` envoient des emails réels si Resend est configuré | Emails réels à l'administrateur |

### Protections contre les opérations destructives

- Interdits sans accord explicite : `prisma db push`, `prisma migrate *`, `prisma db execute`, exécution de `prisma/manual-migrations/*.sql`, `vercel *`, `git push`.
- Avant toute commande Prisma qui touche une base, faire confirmer par l'utilisateur que `.env` cible la base de développement.
- Build de vérification : dans une copie `git archive` sans `.env*`, avec des variables factices (procédure dans `PROGRESS.md`, Mission 4).

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
| WhatsApp | Meta WhatsApp Cloud API : envoi du template `devis_client` (`app/api/devis/[id]/whatsapp/route.ts`) **et** agent IA conversationnel entrant (`app/api/whatsapp/*`, `lib/whatsapp/*`) |
| IA | Vercel AI SDK `ai` + `@ai-sdk/openai` (`generateText`/`generateObject`, transcription `openai/whisper-1`), configuration centralisée dans `lib/ai/config.ts`, plafond d'usage dans `lib/ai/usage.ts` |
| Asynchrone | `waitUntil` (`@vercel/functions`) + file `WhatsappJob` (`lib/whatsapp/job-queue.ts`) + cron de rattrapage `/api/whatsapp/process-pending` |
| Tests | Vitest 2 (`vitest.config.ts`, environnement `node`, alias `@`) |
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
    whatsapp/webhook        Webhook Meta entrant (public, signature x-hub-signature-256)
    whatsapp/process-pending  Cron : rattrapage des jobs WhatsApp (public, CRON_SECRET)
    whatsapp/reactivate     Réactivation de l'agent par l'artisan
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
  ai/config.ts        isAiConfigured(), choix des modèles (extraction, transcription)
  ai/usage.ts         Comptage AiUsageEvent + plafond mensuel
  whatsapp/           Agent IA : agent.ts (orchestrateur), conversation-turn, extraction +
                      pending-devis (pendingDevis), extraction-checkpoint (idempotence),
                      confirm-creation, send-devis/send-claim/send, voice-message/transcription,
                      artisan-optout/client-optout/escalation, verify-signature, job-queue, media
  devis/create-devis.ts     createDevis() partagé (API + agent)
  clients/create-client.ts  createClient() partagé (API + agent)
  phone.ts            Normalisation E.164 unique
  pdf/, generate-pdf.ts
  stripe.ts (client instancié paresseusement), stripe-sync.ts, notifications.ts
  (createNotification / createNotificationOnce avec dedupeKey), ovh-balance.ts, url.ts, utils.ts
prisma/schema.prisma  22 modèles : les 15 d'origine (User, Client, Devis(+Line), Facture(+Line),
                      Avoir(+Line), Settings, RelanceSettings, Relance, Event, Notification,
                      Opportunity, OvhBalanceAlert) + WhatsappConversation, WhatsappMessage,
                      WhatsappJob, WhatsappSend, AiUsageEvent, RelanceDevisSettings, RelanceDevis
prisma/manual-migrations/  Scripts SQL manuels up/down de l'agent WhatsApp (NE PAS exécuter)
```

Il n'existe **pas** de dossier `prisma/migrations` : le schéma n'est pas versionné par migrations Prisma. Les scripts de `prisma/manual-migrations/` auraient été appliqués sur Supabase (commit `5cdbf61`), ce qui **n'est pas vérifié**. Ne jamais les exécuter, ni créer ou appliquer de migration, sans décision explicite de l'utilisateur.

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
npm.cmd exec -- tsc --noEmit   # typage (pas encore de script npm dédié)
npm.cmd run lint               # ESLint (next/core-web-vitals + next/typescript)
npm.cmd test -- --run          # Vitest, une passe
```

Dernier résultat de référence (2026-10-22, après le merge `dbd67c6`) : tsc OK, lint sans erreur ni avertissement, **85/85 tests réussis** (13 fichiers).

Règles pour les tests :
- Les tests doivent rester **entièrement simulés** : `vi.mock("@/lib/prisma")`, modules d'envoi (`@/lib/whatsapp/send`, `media`, SDK Stripe/Resend/OVH) mockés, modèles IA injectés via `MockLanguageModelV4` / `MockTranscriptionModelV4` (`ai/test`) grâce au paramètre `opts.model`. Aucun test ne doit lire `.env*` ni ouvrir une connexion réelle.
- Toute nouvelle logique dans `lib/` doit être accompagnée d'un test `*.test.ts` à côté du fichier.
- Les tests ne valident que la logique unitaire : une fonctionnalité qui dépend de Meta, OpenAI, Stripe, OVH, Resend ou de la base n'est **pas** « opérationnelle » tant qu'elle n'a pas été vérifiée de bout en bout sur un environnement isolé.

Notes :
- `npm.cmd ci` déclenche le `postinstall` du projet (`prisma generate`, local, sans accès à la base). Avec npm 11, les scripts d'installation de certaines dépendances (esbuild, @prisma/engines, @sentry/cli…) sont bloqués par défaut (`allowScripts`) ; à ce jour, cela n'empêche ni le typage, ni le lint, ni les tests.
- `npm run build` exécute `prisma generate` puis `next build` ; à lancer pour les changements de configuration, de routes ou de dépendances. Non vérifié à ce jour.
- **Aucune CI** n'existe encore.
- Ne pas lancer `npm run dev`, ni appeler les routes webhook ou cron, contre une base ou des clés dont on ne sait pas qu'elles sont isolées de la production.

## Suivi de progression

- `ROADMAP.md` : fonctionnalités V1 et leur **état de vérification** (pas leur état supposé).
- `PROGRESS.md` : journal chronologique des sessions — tâches réalisées avec preuve, blocages, prochaines actions.
- Mettre à jour les deux fichiers dans le même commit que la modification concernée.
