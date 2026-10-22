# ROADMAP — Gestly V1

## Légende des états

| État | Signification |
|---|---|
| 🟡 **Code présent** | Le code existe dans le dépôt, compile (`tsc`) et passe le lint. **Aucun test automatisé**, comportement non vérifié en exécution. |
| 🟢 **Vérifié** | Couvert par un test automatisé qui passe, ou vérifié en exécution sur un environnement isolé, avec preuve consignée dans `PROGRESS.md`. |
| 🔴 **Absent / à faire** | Pas de code correspondant dans le dépôt. |
| ⚠️ **Risque** | Point identifié nécessitant une décision ou une correction. |

Base de vérification au 2026-10-22 :
- Sur `7128471` (avant intégration de l'agent WhatsApp) : `npx tsc --noEmit` → code de sortie 0 ; `npx next lint` → « No ESLint warnings or errors ».
- Après le merge `dbd67c6`, `npm.cmd ci` (client Prisma régénéré localement avec les 22 modèles), puis :
  - `npm.cmd exec -- tsc --noEmit` → code de sortie 0
  - `npm.cmd run lint` → « ✔ No ESLint warnings or errors »
  - `npm.cmd test -- --run` → **13 fichiers, 85 tests réussis, 0 échec** (entièrement simulés : Prisma, envois et modèles IA mockés)
- `npm run build` : **non exécuté**.

Ces tests sont **unitaires et simulés**. Ils prouvent la logique interne de l'agent WhatsApp, pas son fonctionnement réel avec Meta, OpenAI ou la base. Une ligne n'est donc marquée 🟢 que pour sa **logique unitaire testée**. Aucune fonctionnalité n'est déclarée **opérationnelle de bout en bout** à ce jour.

Légende complémentaire : 🧪 **Logique testée** — tests unitaires simulés qui passent ; intégration réelle non vérifiée.

## Fonctionnalités V1

| # | Fonctionnalité | État | Preuve d'existence (chemins) |
|---|---|---|---|
| 1 | Authentification (Clerk) et protection des routes | 🟡 | `middleware.ts`, `lib/auth.ts`, `app/sign-in`, `app/sign-up` |
| 2 | Blocage API des comptes non abonnés | 🟡 | `lib/auth.ts` (`isSubscriptionBlocked`), utilisé dans les routes API |
| 3 | Gestion des clients (CRUD, recherche, filtres, canal préféré) | 🟡 | `app/api/clients/`, `app/dashboard/clients/page.tsx` |
| 4 | Devis : création, édition, détail | 🟡 | `app/api/devis/`, `app/dashboard/devis/(nouveau|[id]|[id]/modifier)` |
| 5 | Devis : duplication | 🟡 | `app/api/devis/[id]/duplicate/route.ts` |
| 6 | Devis : lien public / lien court | 🟡 | `app/api/devis/[id]/link`, `app/api/public/devis/[id]`, `app/d/[id]/page.tsx` |
| 7 | Devis : envoi par email | 🟡 | `app/api/devis/[id]/send/route.ts` |
| 8 | Devis : envoi WhatsApp (template Meta `devis_client`) | 🟡 | `app/api/devis/[id]/whatsapp/route.ts`, bouton dans `app/dashboard/devis/[id]/page.tsx` |
| 9 | Conversion devis → facture | 🧪 Transaction unique, une seule facture par devis même sur double clic (409) | `app/api/devis/[id]/to-facture/route.ts` |
| 10 | Factures : création, détail, envoi email | 🧪 Création et numérotation testées (routes réelles, base simulée) ; détail et envoi : 🟡 | `app/api/factures/`, `app/dashboard/factures/`, `app/api/factures/[id]/send` |
| 11 | Avoirs (depuis facture) + PDF | 🧪 Numérotation et règles de crédit testées (jamais au-delà du facturé, un seul avoir total) ; PDF : 🟡 | `app/api/factures/[id]/avoir`, `app/api/avoirs/[id]/pdf` |
| 11b | **Numérotation des documents** (devis, factures, avoirs) | 🧪 Décisions D1 à D4 et D6 appliquées (2026-10-22) : séries annuelles par défaut (DEV, FAC, AV), préfixe personnalisé continu, « Prochain n° » réel et jamais ignoré, compteurs persistants (aucun numéro réattribué), seuls les brouillons jamais envoyés sont supprimables, facture figée à l'émission. 37 tests unitaires + 33 tests d'intégration. 🟢 **Migrations appliquées sur Supabase le 2026-10-23** : postcheck OK, 0 écart avec `schema.prisma`, tests PostgreSQL T1–T10 réels (doublons et suppressions refusés), **test de fumée du vrai code sur la vraie base** (`scripts/db/smoke-numbering.ps1`, 12/12, transaction annulée). Reste la phase C (déploiement + relance du gel, C2) | `lib/numbering/`, `lib/devis/lifecycle.ts`, `prisma/manual-migrations/2026102*` |
| 11c | Conservation des factures et avoirs à la fermeture d'un compte (D5) | 🔴 Proposition seulement (plan, § 7) ; RESTRICT préparé, non appliqué ; durées légales à valider | — |
| 12 | Génération PDF / pages d'impression | 🧪 PDF serveur (`lib/pdf/generate-document-pdf.ts`) testé réellement avec données fictives (8 tests) ; pagination et montants ≥ 1 000 € corrigés. **Mentions légales (2026-10-23)** : conditions de paiement et réserve de propriété des Paramètres enfin imprimées, mention d'escompte ajoutée, article L.441-10 (`lib/documents/legal-mentions.ts`, 6 tests). Pages d'impression HTML (`app/print/`) : 🟡 (rendu non vérifié visuellement) | `lib/pdf/`, `lib/documents/`, `lib/generate-pdf.ts`, `app/print/` |
| 13 | Relances automatiques (moteur, réglages, email/SMS, cron) | 🟡 | `lib/relances/`, `app/api/relances/check`, `app/api/settings/relances`, `app/dashboard/parametres/relances` |
| 14 | Envoi SMS (OVH) + suivi solde admin | 🟡 | `lib/sms/`, `lib/ovh-balance.ts`, `app/api/admin/ovh-balance/`, `app/admin/ovh-balance` |
| 15 | Amélioration de message par IA (rate-limité) | 🟡 | `app/api/ai/improve-message/route.ts`, `lib/ai/config.ts`, `lib/rate-limit.ts` |
| 16 | Agenda (événements) | 🟡 | `app/api/events/`, `app/dashboard/agenda` |
| 17 | Pipeline commercial (opportunités) | 🟡 | `app/api/opportunities/`, `app/dashboard/pipeline` |
| 18 | Notifications in-app | 🟡 | `app/api/notifications/`, `lib/notifications.ts`, `components/layouts/notifications-bell.tsx` |
| 19 | Paramètres entreprise + logo | 🟡 | `app/api/settings/`, `app/api/settings/logo`, `app/dashboard/parametres` |
| 20 | Abonnement Stripe (checkout, portail, webhook, resync cron) | 🟡 | `app/api/stripe/`, `lib/stripe.ts`, `lib/stripe-sync.ts`, `app/dashboard/parametres/abonnement` |
| 21 | Landing, SEO, pages légales | 🟡 | `app/page.tsx`, `components/landing/`, `app/(cgu|cgv|privacy|mentions-legales|remboursement|contact)`, `app/robots.ts` |
| 22 | Monitoring Sentry | 🟡 | `sentry.*.config.ts`, `instrumentation.ts` |
| 23 | Agent IA WhatsApp conversationnel, intégré depuis la branche `feature/whatsapp-agent-v1` (merge `dbd67c6`) | 🟡 | Voir le détail ci-dessous |

### Agent IA WhatsApp — détail

Origine : code retrouvé le 2026-10-22 dans la copie de l'ancien PC, sur une branche locale jamais poussée (14 commits, `5cdbf61` → `9ce9f76`), puis fusionné (`dbd67c6`). Typage et lint OK sur l'ensemble.

**Aucune sous-fonctionnalité n'est vérifiée de bout en bout** (Meta, OpenAI, base réelle).

| Sous-fonctionnalité | État | Fichiers | Tests (résultat 2026-10-22) |
|---|---|---|---|
| **Parcours complet WhatsApp → client → devis → confirmation → envoi (simulé)** | 🧪 | Tous les fichiers ci-dessous | `tests/whatsapp-flow.integration.test.ts` 42/42 (2026-10-22) : base en mémoire, IA simulée, envois en mode simulation. **Non vérifié avec Meta, OpenAI ni la vraie base** |
| Webhook Meta entrant (GET de vérification, POST signé, dédoublonnage) | 🧪 | `app/api/whatsapp/webhook/route.ts`, `lib/whatsapp/verify-signature.ts`, `meta-types.ts`, `identify.ts` | Intégration : vérification GET (jeton, mode, challenge, échec fermé), signature valide/invalide, doublon, relivraison après échec, numéro inconnu ou partagé, START en opt-out |
| Traitement asynchrone (`waitUntil` + file de jobs + cron toutes les 15 min) | 🧪 | `app/api/whatsapp/webhook/route.ts`, `lib/whatsapp/job-queue.ts`, `app/api/whatsapp/process-pending/route.ts`, `vercel.json` | Intégration : `waitUntil`, route cron (autorisations, comptage), reprise d'un job interrompu, plafond de tentatives, extraction interrompue ou concurrente. Planification Vercel : **non vérifiée** |
| Orchestrateur conversationnel | 🧪 | `lib/whatsapp/agent.ts`, `conversation-turn.ts`, `reply-builder.ts` | `agent.test.ts` 12/12 + intégration (création, refus, rejeu, nouveau devis après envoi, erreurs de création) |
| Extraction IA structurée (`pendingDevis`) | 🧪 | `lib/whatsapp/extraction.ts`, `pending-devis.ts` | `extraction.test.ts` 5/5, `pending-devis.test.ts` 7/7 (dont recherche relancée par téléphone) |
| Idempotence de l'extraction sur retry (checkpoint) | 🧪 | `lib/whatsapp/extraction-checkpoint.ts` | `extraction-checkpoint.test.ts` 7/7, `extraction-checkpoint-quota.e2e.test.ts` 2/2 |
| Résolution client et création réelle du devis | 🧪 | `lib/whatsapp/client-resolution.ts`, `confirm-creation.ts`, `lib/devis/create-devis.ts`, `lib/clients/create-client.ts` | Intégration : nouveau client, client existant, téléphone donné après le nom, homonyme d'un autre compte, transaction annulée sur erreur, client supprimé entre-temps, reprise après refus ; numérotation partagée web/WhatsApp/duplication (`lib/devis/numbering.ts`, 8 tests unitaires) |
| PDF et envoi du devis au client (verrou d'envoi unique) | 🧪 | `lib/whatsapp/send-devis.ts`, `send-claim.ts`, `send.ts`, `lib/pdf/generate-document-pdf.ts` | `send-devis.test.ts` 3/3 + intégration (`send-claim` et `send` réels en simulation ; un seul document même en cas de reprise). PDF réel : `generate-document-pdf.test.ts` 6/6 (données fictives) |
| Messages vocaux (transcription Whisper + garde-fou anti-hallucination) | 🧪 | `lib/whatsapp/transcription.ts`, `voice-message.ts`, `media.ts` | `transcription.test.ts` 5/5, `voice-message.test.ts` 16/16 (`media` non testé) |
| Garde-fous : STOP/START artisan, opt-out client, escalade | 🧪 | `lib/whatsapp/artisan-optout.ts`, `client-optout.ts`, `escalation.ts`, `app/api/whatsapp/reactivate/route.ts` | `artisan-optout.test.ts` 7/7, `client-optout.test.ts` 8/8, `escalation.test.ts` 3/3 + intégration (STOP/silence/START, mot « stop » dans une phrase, route `reactivate` isolée par artisan, STOP client final puis envoi refusé) |
| Plafond mensuel d'usage IA | 🧪 | `lib/ai/usage.ts`, `lib/ai/config.ts` | `lib/ai/usage.test.ts` 9/9 + intégration (plafond atteint sans appel IA, autre artisan non affecté, mois précédents exclus, STOP toujours possible) |
| Notifications dédupliquées (`createNotificationOnce`) | 🧪 | `lib/notifications.ts` | `lib/notifications.test.ts` 4/4 (contrainte d'unicité simulée, pas l'index Postgres réel) |
| Schéma de données (7 nouveaux modèles, champs `whatsappOptOut`, `signature*`) | 🟢 | `prisma/schema.prisma`, `prisma/manual-migrations/` (9 paires up/down) | **Base Supabase conforme au schéma** (vérifié en lecture seule le 2026-10-22 : 22 tables, colonnes, types, nullabilité, défauts, 29 clés étrangères, 19 index ; les 9 migrations de l'agent sont enregistrées dans `supabase_migrations`) |

## Socle de développement autonome

| Élément | État |
|---|---|
| `CLAUDE.md`, `ROADMAP.md`, `PROGRESS.md` | 🟡 Commités le 2026-10-22 (`19745bc`), mis à jour depuis, non poussés. `CLAUDE.md` décrit désormais l'agent WhatsApp et Vitest |
| Environnement de dev isolé (base, Stripe test, SMS/WhatsApp/email factices) | 🔴 Non confirmé. Architecture proposée dans `CLAUDE.md` (section « Environnement de développement isolé ») et `PROGRESS.md` (Mission 5) |
| `.env.example` (noms de variables uniquement) | 🟡 Créé le 2026-10-22 : 33 variables, valeurs fictives, services sensibles vides par défaut |
| Mode simulation des envois (WhatsApp, SMS, emails, IA) | 🧪 `lib/outbound/` : `simulate` par défaut hors production Vercel, même avec de vraies clés ou `VERCEL_ENV=production` importé en local ; configuration incohérente signalée (log, Sentry, `/api/health`) ; tests prouvant l'absence d'appel externe ; build isolé OK. Non vérifié en exécution (`npm run dev` non lancé) |
| Gestion des erreurs Resend | 🧪 `sendEmail()` lève une exception sur `{ error }` ; devis, factures, relances et alertes OVH ne sont plus marqués envoyés en cas de refus (17 tests, vérifiés par mutation) |
| Garde-fous Claude Code (`.claude/settings.json` + hook) | 🧪 v2 installée (2026-10-22) : autoriser / demander / bloquer, 133 tests ; limites documentées |
| Autres garde-fous de dev (`APP_URL` localhost, SSL Postgres configurable) | 🔴 Non traités |
| Migrations Prisma versionnées (`prisma/migrations`) | 🔴 ⚠️ Pas de `prisma/migrations` ; seulement des scripts SQL manuels dans `prisma/manual-migrations/` (agent WhatsApp) |
| Framework de tests | 🟢 Vitest 2.1.9 installé, **23 fichiers / 411 tests réussis** (2026-10-23, branche `test/whatsapp-flow`, dont 133 tests du garde-fou), dont 42 tests d'intégration WhatsApp et 33 tests d'intégration des documents, sur une base Prisma en mémoire avec verrous réellement bloquants (`tests/support/fake-prisma.ts`). Couverture limitée à l'agent WhatsApp, à `lib/ai/usage` et à `lib/notifications` ; le reste de l'application (devis, factures, relances, Stripe…) n'a **aucun test**. Playwright : 🔴 |
| Scripts npm `typecheck` / `test` / `check` | 🟡 `test` (`vitest run`) présent ; `typecheck` et `check` : 🔴 |
| CI GitHub Actions (lint, typecheck, tests, build) | 🔴 |
| `.claude/` versionné (settings, hooks, sous-agents) | 🔴 ⚠️ `.claude/` est actuellement ignoré par `.gitignore` |

## Prochaines étapes (ordre recommandé, révisé le 2026-10-22)

Décision : la base Supabase actuelle (données fictives) sert au développement. Le plan détaillé et priorisé est dans `PROGRESS.md` (Mission 6).

1. ~~**P0 — Mode simulation des envois**~~ 🧪 Fait (2026-10-22) : `lib/outbound/`, tous les chemins WhatsApp, SMS, email et IA couverts, diagnostics de mauvaise configuration, correction Resend. Fusionné dans `chore/claude-setup` (voir `PROGRESS.md`, Mission 8). Non vérifié en exécution réelle (`npm run dev` non lancé).
2. ~~**P0 — `.claude/settings.json` versionné**~~ 🧪 Fait : règles `deny`/`ask`, hook `PreToolUse` (`.claude/hooks/guard.mjs`, 62 tests), `.gitignore` corrigé. Limites documentées dans `CLAUDE.md`.
3. **P0 — Sécurité** : révoquer le token GitHub exposé ; rotation des clés éventuellement présentes dans l'ancien `.env` de l'historique Git ; avis Supabase `rls_auto_enable` : risque nul vérifié (fonction `event_trigger`, non appelable), correctif d'hygiène préparé (`20261023_revoke_rls_auto_enable_up.sql`), non appliqué.
4. **P1 — Tests manquants** : ~~webhook WhatsApp, `job-queue`, `confirm-creation`, `createDevis`, `createClient`, numérotation des devis, factures et avoirs~~ (faits, 2026-10-22) ; restent : webhook Stripe, moteur de relances (hors e-mail), tests contre les vraies API.
   - ~~Application des 4 migrations~~ ✅ faite le 2026-10-23 (`PROGRESS.md`, Mission 17). **En attente** : déploiement de `test/whatsapp-flow` puis C2 (`apply-migrations.ps1 -RefreezeOnly`) ; durées de conservation et fermeture de compte (D5).
5. **P1 — Dépendances** : correctifs semver, `shadcn` en dev, puis migration Next 15.5.
6. **P1 — CI GitHub Actions** : lint, typecheck, tests, build isolé.
7. **P2 — Recette** : parcours complets en local avec services simulés, puis tests réels contrôlés (Stripe test, un numéro WhatsApp de test, un SMS) après accord.
8. **P2 — Pré-lancement** : séparer ou nettoyer la base, configuration de production Vercel (Clerk prod, Stripe live, `CRON_SECRET`), fusion dans `main` et déploiement.

## Risques identifiés (non corrigés)

- ⚠️ Un fichier `.env` a été commité dans `2e81a89` puis retiré dans `dd10b13` : il reste dans l'historique Git. Contenu **non inspecté** (par règle de non-lecture des secrets). À vérifier par l'utilisateur ; rotation des clés recommandée si des valeurs réelles s'y trouvaient.
- ⚠️ `lib/rate-limit.ts` est en mémoire : sur Vercel (instances serverless multiples), la limite n'est pas globale.
- ⚠️ Pas d'environnement de dev isolé confirmé : risque d'écriture en production lors d'essais locaux.
- ⚠️ `lib/url.ts` remplace `localhost` par `https://www.gestly.fr` : les liens générés en dev pointent vers la production.
- ✅ (branche `feat/outbound-simulation`) La route `app/api/devis/[id]/whatsapp` (URL Meta en dur), OVH et Resend sont neutralisés par le mode simulation hors production.
- ✅ Corrigé (2026-10-22) : une erreur renvoyée par `resend.emails.send()` était comptée comme un envoi réussi.
- ⚠️ Mode simulation en production : définir `OUTBOUND_MODE=live` dans Vercel Production avant le déploiement, puis vérifier `/api/health`. Une mauvaise configuration est désormais signalée (log d'erreur, Sentry, health en 503), mais les envois restent bloqués tant qu'elle n'est pas corrigée.
- ⚠️ `next start` local avec des variables de production importées (`VERCEL_ENV=production`, `NODE_ENV=production`) passerait en `live` : cas non protégé par la règle (le hook bloque `vercel env pull` pour Claude).
- ⚠️ Le commit `5cdbf61` affirme que la migration de l'agent WhatsApp a été « appliquée sur Supabase ». **Non vérifié** : avant tout déploiement, il faut comparer le schéma réel de la base à `prisma/schema.prisma` (lecture seule) et ne pas rejouer les scripts SQL à l'aveugle.
- ⚠️ La copie de l'ancien PC contient un token GitHub en clair dans l'URL de son remote `origin` : à révoquer.
- ⚠️ `npm ci` signale 48 vulnérabilités (2 faibles, 15 modérées, 27 élevées, 4 critiques), dont `next` 14.2.35. Non analysées en détail.
