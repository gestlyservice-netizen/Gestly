# ROADMAP — Gestly V1

## Légende des états

| État | Signification |
|---|---|
| 🟡 **Code présent** | Le code existe dans le dépôt, compile (`tsc`) et passe le lint. **Aucun test automatisé**, comportement non vérifié en exécution. |
| 🟢 **Vérifié** | Couvert par un test automatisé qui passe, ou vérifié en exécution sur un environnement isolé, avec preuve consignée dans `PROGRESS.md`. |
| 🔴 **Absent / à faire** | Pas de code correspondant dans le dépôt. |
| ⚠️ **Risque** | Point identifié nécessitant une décision ou une correction. |

Base de vérification au 2026-10-22 (branche `chore/claude-setup`, commit de base `7128471`) :
- `npx tsc --noEmit` → code de sortie 0
- `npx next lint` → « No ESLint warnings or errors »
- Tests automatisés : **aucun** (aucun framework installé)

**Aucune fonctionnalité n'est à l'état 🟢 Vérifié à ce jour.**

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
| 9 | Conversion devis → facture | 🟡 | `app/api/devis/[id]/to-facture/route.ts` |
| 10 | Factures : création, détail, envoi email | 🟡 | `app/api/factures/`, `app/dashboard/factures/`, `app/api/factures/[id]/send` |
| 11 | Avoirs (depuis facture) + PDF | 🟡 | `app/api/factures/[id]/avoir`, `app/api/avoirs/[id]/pdf` |
| 12 | Génération PDF / pages d'impression | 🟡 | `lib/pdf/`, `lib/generate-pdf.ts`, `app/print/` |
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
| 23 | Agent IA WhatsApp conversationnel (réception de messages + réponses IA) | 🔴 | Aucune trace dans le dépôt ni l'historique — voir `PROGRESS.md` |

## Socle de développement autonome

| Élément | État |
|---|---|
| `CLAUDE.md`, `ROADMAP.md`, `PROGRESS.md` | 🟡 Créés le 2026-10-22 (branche `chore/claude-setup`, non commités) |
| Environnement de dev isolé (base, Stripe test, SMS/WhatsApp/email factices) | 🔴 Non confirmé |
| `.env.example` (noms de variables uniquement) | 🔴 |
| Migrations Prisma versionnées (`prisma/migrations`) | 🔴 ⚠️ Schéma sans historique de migrations |
| Framework de tests (Vitest, puis Playwright) | 🔴 |
| Scripts npm `typecheck` / `test` / `check` | 🔴 |
| CI GitHub Actions (lint, typecheck, tests, build) | 🔴 |
| `.claude/` versionné (settings, hooks, sous-agents) | 🔴 ⚠️ `.claude/` est actuellement ignoré par `.gitignore` |

## Risques identifiés (non corrigés)

- ⚠️ Un fichier `.env` a été commité dans `2e81a89` puis retiré dans `dd10b13` : il reste dans l'historique Git. Contenu **non inspecté** (par règle de non-lecture des secrets). À vérifier par l'utilisateur ; rotation des clés recommandée si des valeurs réelles s'y trouvaient.
- ⚠️ `lib/rate-limit.ts` est en mémoire : sur Vercel (instances serverless multiples), la limite n'est pas globale.
- ⚠️ Pas d'environnement de dev isolé confirmé : risque d'écriture en production lors d'essais locaux.
