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
- ⚠️ **Clés réelles présentes** pour Resend, OVH SMS, WhatsApp (Meta) et OpenAI. Elles sont **neutralisées par le mode simulation** (section suivante) dès que la branche `feat/outbound-simulation` est en place.
- `CRON_SECRET` absent en local : les routes cron ne sont alors accessibles qu'à l'administrateur connecté.

## Mode simulation des envois (`lib/outbound/`)

- **Règle** (`lib/outbound/mode.ts`, `getOutboundMode()`), dans l'ordre :
  1. `OUTBOUND_MODE=simulate|live` (explicite) ;
  2. `NODE_ENV=development|test` → `simulate`, même si `VERCEL_ENV=production` a été importé localement par erreur ;
  3. `VERCEL_ENV=production` → `live` ;
  4. sinon `simulate` (`next start` local, Preview Vercel…).
  La présence de vraies clés ne déclenche **jamais** un envoi à elle seule.
- `OUTBOUND_MODE=simulate` = coupe-circuit, même en production. `OUTBOUND_MODE=live` = envois réels hors production, **réservé à l'utilisateur** (bloqué pour Claude par le hook). Toute autre valeur est ignorée **et signalée**.
- **Jamais silencieux** (`getOutboundDiagnostics()`) : une production probable en simulation (build de production sur Vercel ou `APP_URL` de production sans `VERCEL_ENV=production`), un coupe-circuit laissé en production ou une valeur `OUTBOUND_MODE` inconnue sont signalés par un log d'erreur et un message Sentry au démarrage (`instrumentation.ts`), par `/api/health` en échec (`checks.outbound = "FAILED: …"`, HTTP 503), et par chaque envoi bloqué, journalisé en erreur.
- Le mode actif est affiché au démarrage (`[outbound] mode=...`). Chaque envoi simulé est journalisé (`[outbound:simulate] ...`, destinataire masqué) et conservé en mémoire (`getSimulatedOutbox()`, 100 derniers).
- **Emails : toujours via `sendEmail()`** (`lib/outbound/email.ts`), jamais `client.emails.send()` (garde-fou statique). Le SDK Resend renvoie `{ error }` sans lever d'exception ; `sendEmail()` lève `EmailSendError` en cas d'erreur ou d'absence d'identifiant. Un devis, une facture, une relance ou une alerte OVH n'est marqué envoyé qu'après un retour normal de `sendEmail()`.
- Garde-fous placés **au plus près du réseau**, donc valables pour tous les appelants (routes API, cron, agent WhatsApp asynchrone) :

| Service | Point protégé | En simulation |
|---|---|---|
| WhatsApp (envoi texte et document) | `lib/whatsapp/send.ts` (`postMessage`) | Identifiant `sim_wamid_…`, aucun appel à Meta, aucune variable requise |
| WhatsApp (upload de média) | `lib/whatsapp/media.ts` (`uploadWhatsappMedia`) | Identifiant `sim_media_…` |
| WhatsApp (média entrant) | `lib/whatsapp/media.ts` (`getMediaMetadata`, `downloadMediaBuffer`) | Bloqué → chemin existant « média introuvable » (échec + escalade) |
| WhatsApp (template devis, URL en dur) | `app/api/devis/[id]/whatsapp/route.ts` | Réponse `{ success, messageId, simulated: true }` ; URL Meta inchangée en production |
| SMS OVH (envoi et solde) | `lib/sms/ovh-provider.ts`, `lib/ovh-balance.ts` ; SDK chargé uniquement par `lib/sms/ovh-client.ts` | `sendSMS` renvoie `true` ; solde simulé à 1000 crédits |
| Emails Resend (5 usages) | `lib/outbound/email.ts` (`sendEmail`, `canSendEmail`) ; seul fichier qui importe `resend` | Identifiant `sim_email_…`, SDK jamais instancié |
| IA (extraction, Whisper, amélioration de texte) | `lib/ai/config.ts` : `isAiConfigured()` renvoie `false` ; `getWhatsapp*Model()` lèvent une erreur | Chemins « IA non configurée » existants ; aucun appel facturé |

- **Non couverts (documenté)** : Stripe (mode test prouvé par le préfixe de clé), upload de logo vers Supabase Storage (`app/api/settings/logo`, stockage du projet, aucun tiers), Sentry (DSN local), Clerk (instance de dev).
- Tests : `lib/outbound/no-real-sends.test.ts` (aucun appel `fetch`, Resend, OVH ou IA avec de fausses clés présentes ; chemin live inchangé), `lib/outbound/static-guards.test.ts` (tout nouveau `fetch`, `new Resend`, `.emails.send(`, `require("ovh")` ou appel IA hors des fichiers protégés fait échouer la suite), `lib/outbound/mode.test.ts` (règles et diagnostics), `lib/outbound/email-delivery.test.ts` (réussite, refus Resend, simulation, pour devis, factures, relances et alerte OVH).
- **Toute nouvelle intégration externe** doit passer par `isOutboundSimulated()` au point d'appel réseau et être ajoutée aux listes de `static-guards.test.ts`.
- ⚠️ **Avant le déploiement en production** : définir `OUTBOUND_MODE=live` dans l'environnement Production de Vercel (recommandé, déterministe) ou vérifier que `VERCEL_ENV` y est exposé. Après déploiement, contrôler `/api/health` : `checks.outbound` doit valoir `mode=live`.

## Garde-fous Claude Code (`.claude/`)

- `.claude/settings.json` (versionné) : règles `deny` (lecture et écriture des `.env*`, `git push`, `vercel`, `prisma db push|migrate|db execute`, `supabase db push|reset`, `psql`, `printenv`, outils Supabase d'infrastructure), règle `ask` (`execute_sql` Supabase), et un hook `PreToolUse`.
- `.claude/hooks/guard.mjs` : analyse chaque commande Bash/PowerShell, chaque accès fichier et chaque appel au connecteur Supabase. Il bloque : secrets (`.env*` sauf `.env.example`, `printenv`, remote Git de l'ancien PC) ; `db push`, `migrate dev|deploy|reset|resolve`, `db execute|pull|seed`, `--accept-data-loss`, `psql` ; `vercel` sous toutes ses formes (`npx`, `pnpm dlx`…) ; `git push` (y compris `git -C . push`, `bash -c "…"`, commandes chaînées) et `gh pr create` ; `OUTBOUND_MODE=live` et `VERCEL_ENV=production` ; le SQL destructif via Supabase ; la modification des garde-fous eux-mêmes. En cas d'erreur interne, il bloque (échec fermé). Tests : `tests/claude-guard.test.ts`.
- **Limites (ne pas surestimer)** : analyse textuelle uniquement. Le hook ne voit pas le contenu d'un script écrit puis exécuté (ex. un `.mjs` qui lance `prisma db push`), ni une commande obfusquée (base64, variables concaténées), ni les actions de l'utilisateur hors de Claude Code. Il peut aussi produire des faux positifs : une commande qui mentionne `.claude/settings` avec `sed`, ou un `grep` sur `^\.env`. **Il ne remplace pas les protections applicatives** (`lib/outbound/mode.ts`), l'absence de secrets de production sur le poste, ni les droits restreints côté Supabase et Vercel. Les garde-fous ne peuvent être modifiés que par l'utilisateur.

Règles qui en découlent :
- Données de la base : créer et modifier des données **fictives** est autorisé pour développer et tester. Toute **suppression** de données reste soumise à accord explicite.
- **Changements de schéma** : jamais `prisma db push`. Il supprimerait l'index unique partiel `Notification(userId, dedupeKey) WHERE dedupeKey IS NOT NULL`, qui n'est pas exprimable dans `schema.prisma` et garantit `createNotificationOnce`. Procédure : fichier SQL up/down dans `prisma/manual-migrations/`, appliqué après accord explicite, puis mise à jour de `schema.prisma` et `prisma generate`.
- **Envois réels** : en local, le mode simulation (ci-dessous) intercepte WhatsApp, SMS, emails et IA. Ne jamais le désactiver (`OUTBOUND_MODE=live`) sans accord explicite. Ne jamais utiliser de vrais numéros de téléphone ou adresses email dans les données de test.

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
| Resend | Mode simulation (client simulé, clé non requise) | Emails réels aux clients si `OUTBOUND_MODE=live` |
| OVH SMS | Mode simulation (aucun client OVH créé) | Pas de mode test chez OVH : SMS réels et facturés si `live` |
| Meta WhatsApp | Mode simulation, y compris la route devis à URL en dur | Messages réels si `live` |
| IA (Gateway/OpenAI) | Mode simulation : `isAiConfigured()` est faux ; tests via `MockLanguageModelV4` / `MockTranscriptionModelV4` | Appels facturés si `live` |
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
- **Numérotation des documents** (devis, factures, avoirs) : toujours `allocateDocumentNumber(tx, type, userId)` (`lib/numbering/document-number.ts`), **dans la transaction** qui crée le document, avec `createdAt: issuedAt`. Jamais de `count + 1` ni de numéro calculé ailleurs. Une facture émise ne se modifie ni ne se supprime : elle se corrige par un avoir.
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

Dernier résultat de référence (2026-10-22, branche `feat/outbound-simulation`) : voir `PROGRESS.md`, Mission 7.

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
