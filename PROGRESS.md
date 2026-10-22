# PROGRESS — Journal de développement

Format : une entrée par session, la plus récente en haut. Chaque tâche « faite » indique sa preuve.

---

## 2026-10-22 — Mission 10 : défauts métier restants et couverture complète de l'agent WhatsApp

Branche : `test/whatsapp-flow`. Aucune API réelle (Meta, OpenAI, Resend, Stripe, OVH), aucune migration, aucune donnée Supabase, aucune clé modifiée, aucun garde-fou désactivé, aucun push.

### Étape 1 — Préservation
Relecture du diff de la Mission 9 (cohérent), scan anti-secrets négatif, commit `e2a2b2b`.

### Étape 2 — Défauts connus corrigés (preuve : chaque test de régression échoue sur le code d'origine, vérifié en le restaurant temporairement par `git stash`, puis passe)

1. **Reprise après un refus de création** (`lib/whatsapp/conversation-turn.ts`). Un « oui » sur un brouillon complet, après un refus, répondait « il me manque des informations ». Désormais, le récapitulatif est reproposé et la création attend une nouvelle confirmation explicite (jamais de création directe).
2. **Doublons de numérotation des devis** (`lib/devis/numbering.ts`, nouveau ; `lib/devis/create-devis.ts` ; `app/api/devis/[id]/duplicate/route.ts`). Trois chemins (web, WhatsApp, duplication) calculaient `count + 1` : doublon après toute suppression, et lors de créations simultanées. Désormais, un module unique, utilisé par les trois chemins :
   - numéro = plus grand numéro existant de l'année + 1 (les numéros non standard sont ignorés) ;
   - verrou consultatif PostgreSQL par artisan (`pg_advisory_xact_lock(hashtext('gestly:devis-number:<userId>'))`), pris dans la transaction de création, qui sérialise les créations concurrentes. **Aucune migration** ; compatible avec le pooler Supabase en mode transaction. `createDevis` ouvre sa propre transaction lorsqu'il est appelé sans (API web).
   - ⚠️ Le verrou est vérifié par les tests (pris, dans une transaction, par artisan), mais **pas contre un vrai PostgreSQL concurrent** (base simulée).
3. **Téléphone donné après le nom** (`lib/whatsapp/pending-devis.ts`). La recherche n'était pas relancée, ce qui créait une fiche en double d'un client existant. Désormais, un téléphone reçu alors que le client n'est pas identifié avec certitude (aucune correspondance ou plusieurs) relance la recherche. Une correspondance unique n'est jamais remise en cause.

### Bugs supplémentaires trouvés par les nouveaux tests, et corrigés

4. **START impossible depuis WhatsApp** (`app/api/whatsapp/webhook/route.ts`). Une fois STOP reçu, le webhook enregistrait tous les messages sans job, START compris : l'assistant ne pouvait plus jamais être réactivé depuis WhatsApp (la route `/api/whatsapp/reactivate` n'est reliée à aucune interface). Désormais, seul START passe quand la conversation est désactivée.
5. **PDF tronqué au-delà d'environ 20 lignes** (`lib/pdf/generate-document-pdf.ts`). Aucun saut de page : sur 60 lignes, 32 lignes et les totaux étaient dessinés hors de la page A4, donc invisibles pour le client. Désormais, pagination avec en-tête de tableau répété, bloc des totaux et notes jamais coupés, mentions légales et « page n/N » sur chaque page.
6. **Montants ≥ 1 000 € corrompus dans tous les PDF** (même fichier). Le séparateur des milliers fr-FR de Node (U+202F) n'est pas encodable par les polices standard de jsPDF : toute la chaîne passait en 16 bits (octets nuls, « 1/740,00 »). Remplacé par l'espace insécable U+00A0.
   - Les fix 5 et 6 concernent aussi les PDF de **factures et d'avoirs** joints aux emails (générateur partagé). Rendu vérifié par analyse du flux PDF ; **pas vérifié visuellement** dans une visionneuse.

### Étape 3 — Couverture ajoutée

| Domaine | Tests |
|---|---|
| Vérification GET du webhook Meta | Jeton correct → challenge ; jeton faux, mode inattendu, challenge absent → 403 ; aucun jeton configuré → 403 |
| Route cron `process-pending` | 401 sans secret, mauvais secret, artisan non administrateur ; traitement et comptage |
| Reprises après interruption | Job « processing » périmé repris ; job récent jamais doublé ; job en échec repris puis abandonné au plafond (`MAX_ATTEMPTS`) ; extraction interrompue reprise avec un seul appel IA ; extraction concurrente → aucun second appel |
| PDF réel (jsPDF, données fictives) | Structure PDF valide, contenu (numéro, entreprise, montants), compte neuf sans réglages, 60 lignes paginées sans perte, facture via le générateur commun |
| STOP / START et opt-out | STOP → silence total → START → reprise ; « stop » dans une phrase ignoré ; route `reactivate` isolée par artisan ; STOP d'un client final → envoi refusé |
| Plafond IA | Atteint → réponse dédiée, aucun appel, autre artisan non affecté ; mois précédents exclus ; STOP toujours possible |
| Isolation des routes | Envoi WhatsApp et duplication du devis d'un autre artisan → 404 ; création web avec le client d'un autre artisan → 404 ; cron réservé |
| Numérotation | 8 tests unitaires + 1 test d'intégration (web, WhatsApp et duplication après suppression → 004, 005, 006) |

### Étape 4 — Résultats

| Vérification | Résultat |
|---|---|
| `npm.cmd exec -- tsc --noEmit` | ✅ code 0 |
| `npm.cmd run lint` | ✅ aucune erreur ni avertissement |
| `npm.cmd test -- --run` | ✅ **21 fichiers, 270 tests réussis, 0 échec** (+40) |
| Build isolé | ✅ code 0, 45 pages (copie sans `.env*`, variables factices, jonction retirée) |

### Proposition soumise à autorisation (non appliquée) : garantie définitive d'unicité des numéros de devis

Le verrou consultatif suffit si **tout** le code passe par `lib/devis/numbering.ts`. Pour une garantie au niveau base, contre tout chemin futur ou toute écriture manuelle :
1. Contrôle préalable en lecture seule : `SELECT "userId", "number", count(*) FROM "Devis" GROUP BY 1, 2 HAVING count(*) > 1;`. Tout doublon existant doit d'abord être renuméroté, avec accord.
2. Migration `up` : `CREATE UNIQUE INDEX CONCURRENTLY "Devis_userId_number_key" ON "Devis" ("userId", "number");` ; `down` : `DROP INDEX CONCURRENTLY "Devis_userId_number_key";` (fichiers à placer dans `prisma/manual-migrations/`).
3. Ajouter `@@unique([userId, number])` à `model Devis`, puis `prisma generate`.
4. Gérer un éventuel `P2002` à la création (renuméroter et retenter une fois).

### Points bloquants restants

- **Aucune intégration externe validée** : Meta (webhook réel, templates, upload, envoi), OpenAI/Whisper, Supabase réel (verrou, transactions et contraintes du pilote `pg`). À faire lors d'une recette réelle contrôlée.
- **Numérotation des factures et avoirs** (`app/api/factures/route.ts`, `app/api/devis/[id]/to-facture/route.ts`, `app/api/factures/[id]/avoir/route.ts`) : même règle `count + 1`, donc doublons possibles en cas de création simultanée. **Obligation légale** de numérotation unique et continue des factures. Hors mission : à traiter avec le même module.
- Les réglages « Préfixe devis / Prochain n° » de la page Paramètres ne sont utilisés par aucune numérotation (devis, factures, avoirs).
- En simulation locale, l'IA est désactivée : un vrai message WhatsApp n'obtient aucune réponse. Une recette locale demandera une décision de l'utilisateur.
- PDF : rendu visuel non contrôlé à l'œil.

---

## 2026-10-22 — Mission 9 : validation du parcours WhatsApp → devis → envoi simulé

Branche : `test/whatsapp-flow`, créée depuis `chore/claude-setup` @ `2ecdda4`. Aucune API Meta ou OpenAI, aucun envoi réel, aucune migration, aucune donnée Supabase, `npm run dev` non lancé.

### Méthode

- `tests/support/fake-prisma.ts` : base Prisma **en mémoire** reproduisant ce dont dépend la fiabilité du parcours. Contraintes d'unicité du schéma (`P2002` sur `WhatsappMessage.externalId`, `WhatsappJob.messageId`, `WhatsappSend.devisId`, `Notification(userId, dedupeKey)`…), `$transaction` avec annulation complète, `updateMany` conditionnels et `increment`, `include`/`select`/`orderBy`/`take`, `DbNull` relu comme `null`, injection de pannes (`failNext`).
- `tests/whatsapp-flow.integration.test.ts` : le parcours réel tourne de bout en bout (webhook signé HMAC → job → `waitUntil` → agent → extraction avec checkpoint → résolution client → `confirmDevisCreation` → `createClient`/`createDevis` → `sendDevisToClient` → upload + document). Seuls sont simulés : la base, les modèles IA (`MockLanguageModelV4`/`MockTranscriptionModelV4`, réponses scriptées), le contenu du PDF, et le média entrant pour le cas « vocal transcrit ». Les envois passent par le **vrai mode simulation**. Invariant vérifié après chaque test : `fetch` jamais appelé.
- **Approche TDD** : tests écrits sur le code existant → **14 réussis, 5 échecs**, chacun révélant un bug ; corrections ; **19/19**.

### Bugs trouvés et corrigés (chacun couvert par un test de régression)

1. **Message perdu après un échec de base** (`app/api/whatsapp/webhook/route.ts`). Message enregistré, puis échec de création du job → réponse 500 → Meta relivre → doublon ignoré → message jamais traité. Désormais, si le message existe sans job, le job manquant est créé ; un `P2002` sur le job (livraisons concurrentes) est ignoré proprement.
2. **Devis envoyé au client sans confirmation** (`lib/whatsapp/conversation-turn.ts`, grave). La reprise d'un job « oui » de *création*, après une erreur en aval (ex. enregistrement de la réponse), trouvait la conversation en attente de confirmation d'*envoi* : le « oui » rejoué depuis le checkpoint était interprété comme une confirmation d'envoi, et le PDF partait chez le client. Désormais, un message reçu avant la création du devis ne peut jamais confirmer son envoi : il renvoie la réponse « devis créé ».
3. **Conversation bloquée après un premier envoi** (`conversation-turn.ts`). Après un devis envoyé, chaque nouveau message recevait « devis déjà envoyé », donc aucun second devis possible sur ce numéro. Désormais, seule la reprise d'un message reçu avant l'envoi (comparé à `WhatsappSend.createdAt`, ou à `sentAt` sinon) reçoit ce rappel ; un nouveau message ouvre un nouveau brouillon.
4. **Erreur métier de création sans réponse** (`conversation-turn.ts`, `reply-builder.ts`). Client identifié puis supprimé (`CLIENT_NOT_FOUND`) ou nom invalide : l'erreur faisait échouer le job, rejoué 5 fois sans succès, et l'artisan n'avait jamais de réponse. Désormais, réponse claire (`buildCreationFailedReply`), job terminé, correspondance client oubliée pour qu'un nouveau « oui » crée la fiche. Les erreurs techniques restent retentées automatiquement.
5. **Message attribué au mauvais compte** (`lib/whatsapp/identify.ts`, isolation). Un numéro déclaré par deux comptes Gestly était attribué au premier trouvé. Désormais, le message n'est attribué à aucun compte, avec un avertissement dans le journal.

### Parcours couverts (19 tests d'intégration)

| Thème | Cas |
|---|---|
| Nominal | Nouveau client, demande complète → récapitulatif → création (client + devis brouillon, totaux 1200 HT / 1440 TTC) → envoi simulé (upload + document au client, devis `envoye`, `WhatsappSend` succès, conversation `idle`) |
| Client existant | Réutilisé, aucun doublon |
| Demande incomplète | Clarification, « oui » prématuré refusé, complétion, puis création |
| Refus | Refus de création (rien créé) ; refus d'envoi (devis brouillon, aucun document) |
| Vocal | Vocal transcrit (média + Whisper simulés) traité comme du texte ; vocal en simulation pure → réponse claire + escalade, aucun appel IA |
| Doublons et reprises | Double livraison Meta (un message, un job, un appel IA, une réponse) ; relivraison après échec du job [régr. 1] ; reprise du « oui » de création [régr. 2] ; reprise du « oui » d'envoi (un seul document) |
| Après envoi | Second devis complet dans la même conversation, numéros distincts [régr. 3] |
| Erreurs | Client supprimé entre-temps [régr. 4] ; panne pendant `devis.create` → transaction annulée (aucun client orphelin) puis reprise → exactement un client et un devis, sans nouvel appel IA |
| Isolation | Homonyme d'un autre compte jamais utilisé ; conversations séparées entre artisans ; numéro inconnu ; numéro partagé par deux comptes [régr. 5] ; signature invalide → 403 |

### Résultats

| Vérification | Résultat |
|---|---|
| `npm.cmd exec -- tsc --noEmit` | ✅ code 0 |
| `npm.cmd run lint` | ✅ aucune erreur ni avertissement |
| `npm.cmd test -- --run` | ✅ **19 fichiers, 230 tests réussis, 0 échec** (+19) |

### Non vérifié

- **Rien n'est vérifié contre les vraies API** : Meta (webhook réel, templates, upload, document), OpenAI (extraction et Whisper réels), base Supabase réelle (transactions et contraintes réelles du pilote `pg`).
- Non testés : vérification GET du webhook (`hub.challenge`), route cron `/api/whatsapp/process-pending`, génération réelle du PDF, STOP/START et opt-out client en intégration (couverts seulement par les tests unitaires existants), plafond IA en intégration.
- En simulation locale, l'IA est désactivée : l'extraction échoue (« IA non configurée ») et le job est retenté puis abandonné, **sans réponse à l'artisan**. Une recette locale du parcours nécessitera une IA simulée côté application, ou une clé de test avec `OUTBOUND_MODE` adapté, sur décision de l'utilisateur.
- Limites connues, non corrigées (hors mission) :
  - après un refus de création, un « oui » sans modification répond « il me manque des informations » au lieu de reproposer le récapitulatif ;
  - la numérotation des devis (`count + 1`, partagée avec l'API web) peut produire un doublon après suppression d'un devis ;
  - un téléphone fourni après le nom ne relance pas la recherche du client.

---

## 2026-10-22 — Mission 8 : validation du mode simulation, correction Resend, build isolé

Branche : `feat/outbound-simulation`. Aucun envoi réel, aucun appel IA, aucune migration, aucune donnée modifiée, aucun déploiement, aucun push. Serveur applicatif non lancé.

### Étape 1 — Validation et durcissement

Relecture complète du diff (16 fichiers modifiés, 9 nouveaux) : garde-fous conformes ; chemins live identiques à l'existant (URL Meta, template, SDK Resend, client OVH). Scan anti-secrets de tous les fichiers modifiés ou nouveaux : aucune correspondance.

Deux faiblesses trouvées et corrigées :
1. **La production pouvait passer en simulation sans bruit** (variables système Vercel non exposées, ou `OUTBOUND_MODE=simulate` oublié). Ajout de `getOutboundDiagnostics()` : log d'erreur et `Sentry.captureMessage` au démarrage (`instrumentation.ts`), `/api/health` en échec (`checks.outbound = "FAILED: …"` → 503), chaque envoi bloqué journalisé en erreur. Signalé aussi : une valeur `OUTBOUND_MODE` inconnue.
2. **`VERCEL_ENV=production` importé en local** (ex. `vercel env pull --environment=production`) aurait fait passer `next dev` en `live`. Nouvelle règle : `NODE_ENV=development|test` → simulation, sauf `OUTBOUND_MODE=live` explicite.

Robustesse vérifiée par les tests : `NODE_ENV` absent ou fantaisiste (seul `VERCEL_ENV` décide), `OUTBOUND_MODE` vide, en espaces, mal orthographié ou en majuscules (jamais `live` par erreur en local). En local, `.env.local` ne définit ni `OUTBOUND_MODE` ni `VERCEL_ENV` (inventaire des noms, Mission 6) : `next dev` est donc en simulation quelles que soient les clés présentes.

Chemins protégés : vérifiés par `static-guards.test.ts`, renforcé (les emails ne peuvent plus être envoyés que via `sendEmail()`).

### Étape 2 — Correction Resend

- `lib/outbound/email.ts` : nouvelle fonction `sendEmail()`, qui lève `EmailSendError` si Resend renvoie `{ error }` ou aucun identifiant ; les erreurs réseau sont propagées.
- Appelants mis à jour : `app/api/devis/[id]/send` (devis non marqué « envoye » si échec → HTTP 500), `app/api/factures/[id]/send` (`sentAt` non renseigné → 500), `lib/relances/engine.ts` (relance enregistrée en « echec » + notification `relance_echouee`), `app/api/health` (log), `app/api/admin/ovh-balance/check`. Pour ce dernier, l'alerte n'est plus enregistrée si l'email échoue, ce qui permet de la retenter au lieu de la bloquer 24 h (même défaut corrigé).
- Tests (`lib/outbound/email-delivery.test.ts`, 17) : `sendEmail` (succès, refus, absence d'identifiant, erreur réseau, simulation) ; devis, factures, relances et alerte OVH, chacun en succès, en refus et en simulation.
- **Vérification par mutation** : avec les contrôles de `sendEmail` neutralisés, les 6 tests de refus échouent ; fichier rétabli.

### Étape 3 — Tests et build

| Vérification | Résultat |
|---|---|
| `npm.cmd exec -- tsc --noEmit` | ✅ code 0 |
| `npm.cmd run lint` | ✅ « No ESLint warnings or errors » |
| `npm.cmd test -- --run` | ✅ **18 fichiers, 211 tests réussis, 0 échec** (+30 : 17 `email-delivery`, 12 `mode`, 1 `static-guards`) |
| Build isolé | ✅ `npm run build` code 0, compilation, lint, typage, 45 pages |

Build isolé : copie des fichiers suivis et non ignorés (`git ls-files -co --exclude-standard`, donc aucun `.env*` hormis `.env.example`) dans le scratchpad, `node_modules` relié par jonction (retirée ensuite, `node_modules` intact), variables toutes factices (base `127.0.0.1:9`), télémétrie Next, Prisma et Sentry coupée.

Le hook Claude Code a bloqué une de mes commandes de vérification (motif `^\.env` dans un `grep`), un faux positif documenté ; remplacée par une simple liste des fichiers cachés.

### Étape 4 — Git

- Commit `e9acb8a` sur `feat/outbound-simulation` (26 fichiers), arbre propre.
- Merge `--no-ff` dans `chore/claude-setup` : commit `af7d980`, **aucun conflit** ; contenu identique à celui de `feat/outbound-simulation` (`git diff` vide).
- ⚠️ Tests relancés sur `chore/claude-setup` après le merge : **17 fichiers / 149 tests réussis, 1 fichier en échec de chargement** (`tests/claude-guard.test.ts`, 62 tests). Cause identifiée : en changeant de branche, Git (`core.autocrlf=true`) a réécrit `.claude/hooks/guard.mjs` en CRLF dans la copie de travail (LF dans l'index) ; la ligne shebang n'est alors plus reconnue par la transformation de Vitest (`SyntaxError`). Le hook lui-même fonctionne toujours sous Node.
- Correction : `.gitattributes` (`*.mjs text eol=lf`) commité pour éviter toute récidive. La ré-extraction du fichier existant (`git checkout -- .claude/hooks/guard.mjs`) a été **bloquée par le hook** (modification d'un garde-fou réservée à l'utilisateur) : **action utilisateur en attente**, puis relance de `npm test`.

**Parcours réel non exécuté** : `npm run dev` n'a pas été lancé. Il chargerait `.env.local` (vraies clés) ; le mode simulation l'empêcherait d'envoyer, mais la base Supabase et Clerk seraient réellement utilisés. À faire avec l'utilisateur.

### Risques résiduels

- Production : `OUTBOUND_MODE=live` (ou `VERCEL_ENV`) à configurer avant déploiement, sinon les envois restent bloqués (signalé, jamais silencieux).
- `next start` local avec des variables de production importées → `live` (non couvert par la règle).
- Non simulés : Stripe (mode test prouvé), upload de logo Supabase Storage, Sentry.
- Le hook ne voit pas les scripts écrits puis exécutés ni les commandes obfusquées.
- Tests mockés : aucune vérification contre les vraies API (Resend, Meta, OVH).

---

## 2026-10-22 — Mission 7 : mode simulation des envois et garde-fous Claude Code

Branche : `feat/outbound-simulation`, créée depuis `chore/claude-setup` @ `c0642b1` (documentation de la Mission 6 commitée au préalable). Autorisation de l'utilisateur : modifier le code applicatif, ajouter des tests et la configuration nécessaire. Aucun schéma, aucune migration, aucune donnée, aucun envoi réel, aucun appel IA, aucun déploiement, aucun push. Serveur applicatif non lancé.

### Fonctionnement

- `lib/outbound/mode.ts` : `getOutboundMode()` renvoie `live` seulement si `VERCEL_ENV=production`, `simulate` sinon, quelles que soient les clés présentes. `OUTBOUND_MODE=simulate|live` force le mode (toute autre valeur est ignorée). Journal des envois simulés en mémoire, destinataires masqués.
- `lib/outbound/email.ts` : `getEmailClient()` (vrai `Resend` en live, client simulé sinon) et `canSendEmail()`. Les 5 usages de Resend y passent : `app/api/devis/[id]/send`, `app/api/factures/[id]/send`, `app/api/health`, `app/api/admin/ovh-balance/check`, `lib/relances/engine.ts`.
- `lib/sms/ovh-client.ts` : seul chargement du SDK `ovh`. Garde-fous dans `OvhProvider.sendSMS` et `getOvhSmsBalance` (solde simulé : 1000 crédits).
- WhatsApp : garde-fous dans `lib/whatsapp/send.ts` (texte et document), `lib/whatsapp/media.ts` (upload simulé ; métadonnées et téléchargement entrants bloqués via le chemin d'erreur existant) et `app/api/devis/[id]/whatsapp/route.ts` (réponse simulée ; URL Meta et template inchangés en live).
- IA : `lib/ai/config.ts`, avec `isAiConfigured()` à `false` en simulation et `getWhatsappExtractionModel()` / `getWhatsappTranscriptionModel()` qui lèvent une erreur (second verrou).
- `instrumentation.ts` : affiche `[outbound] mode=…` au démarrage.

### Chemins d'envoi

| Chemin | Couvert | Preuve |
|---|---|---|
| Agent WhatsApp : réponses texte, envoi du PDF de devis (upload + document) | ✅ | `send.ts`/`media.ts` + test runtime |
| Agent WhatsApp : messages vocaux entrants (métadonnées, téléchargement, Whisper) | ✅ | Média bloqué → échec propre ; IA bloquée ; tests |
| Agent WhatsApp : extraction IA (`pendingDevis`) | ✅ | `isAiConfigured()` faux + `getWhatsappExtractionModel()` refusé ; test |
| Route `POST /api/devis/[id]/whatsapp` (URL en dur) | ✅ | Test runtime : simulé sans `fetch`, même sans variables ; en live, même URL et même template |
| Cron `/api/whatsapp/process-pending` et `waitUntil` du webhook | ✅ (indirect) | Passent par l'agent, donc par `send.ts`/`media.ts`/IA protégés ; pas de test de bout en bout de la route |
| Relances (cron `/api/relances/check`) email + SMS | ✅ | Test runtime de `runRelancesCheck()` : 2 envois simulés, aucun appel externe |
| Emails devis, factures, alertes health et solde OVH | ✅ | Via `getEmailClient()` ; garde-fou statique |
| Solde OVH (`/api/admin/ovh-balance/check`, relances) | ✅ | `getOvhSmsBalance()` simulé |
| IA : `POST /api/ai/improve-message` | ✅ | Test runtime : 503, `generateText` jamais appelé |
| Stripe | ❌ hors périmètre | Clé de **test** prouvée (préfixe) ; aucun paiement réel |
| Upload de logo vers Supabase Storage | ❌ hors périmètre | Stockage du projet, aucun tiers ; listé dans `static-guards.test.ts` |
| Sentry (DSN local) | ❌ hors périmètre | Erreurs locales envoyées au projet Sentry |

**Aucun chemin d'envoi vers un tiers (WhatsApp, SMS, email, IA) n'est resté non sécurisé.**

### Garde-fous Claude Code

- `.claude/settings.json` : 43 règles `deny` et 1 règle `ask` (`execute_sql`), plus le hook `PreToolUse` sur Bash, PowerShell, les outils fichiers, Grep et les outils MCP.
- `.claude/hooks/guard.mjs` : analyse textuelle avec échec fermé. **Actif dès sa création** : il a bloqué une de mes commandes (`sed` sur `.gitignore` mentionnant `.claude/settings.local.json`, faux positif), corrigée via l'outil d'édition.
- `.gitignore` : `.claude/` remplacé par `.claude/settings.local.json`, donc la configuration partagée est versionnée.
- Contournements testés et bloqués : `bash -c "…"`, `sh -c`, espaces multiples, commandes chaînées (`;`, `&&`, `||`), `git -C . push`, `node node_modules/prisma/build/index.js db push`, `npm.cmd exec -- prisma …`, `npx --yes vercel`, `pnpm dlx vercel`, `vercel.cmd`, `node -e "readFileSync('.env.local')"`, `Get-Content .env.local`, `$env:OUTBOUND_MODE='live'`, `VERCEL_ENV=production`, SQL destructif via `execute_sql`.
- Test en processus réel (JSON sur stdin) : 6/6 cas conformes, dont une entrée invalide → bloquée.
- **Limites** (détaillées dans `CLAUDE.md`) : pas d'analyse des scripts écrits puis exécutés, ni des commandes obfusquées ; faux positifs possibles ; ne remplace pas les protections applicatives.

### Résultats

| Vérification | Résultat |
|---|---|
| `npm.cmd exec -- tsc --noEmit` | ✅ code 0 |
| `npm.cmd run lint` | ✅ « No ESLint warnings or errors » |
| `npm.cmd test -- --run` | ✅ **17 fichiers, 181 tests réussis, 0 échec** (85 existants + 12 `mode` + 14 `no-real-sends` + 8 `static-guards` + 62 `claude-guard`) |
| Vérification par mutation | ✅ En forçant temporairement le mode à `live`, les 9 tests de simulation de `no-real-sends` **échouent** ; fichier rétabli |
| `npm run build` | Non relancé dans cette mission |

### Constat préexistant (non corrigé, comportement de production)

- `resend.emails.send()` (SDK 6.10) renvoie `{ data, error }` sans lever d'exception. Les 5 appelants n'examinent que les exceptions : un email refusé par Resend (domaine non vérifié, quota…) est traité comme envoyé, et le devis est marqué « envoyé », la relance « envoyee ». À corriger avec accord.

### Prochaines tâches

1. Relecture, puis fusion de `feat/outbound-simulation` dans `chore/claude-setup` (localement).
2. `npm run build` isolé, puis premier `npm run dev` en local : vérifier `[outbound] mode=simulate` au démarrage et un parcours de bout en bout (devis → WhatsApp simulé).
3. Corriger la gestion de `{ error }` de Resend (avec tests).
4. Tests : route webhook WhatsApp (signature, `waitUntil`), `job-queue`, `confirm-creation`, `createDevis`, `createClient`, webhook Stripe, contrôle d'accès par `userId`.
5. Sécurité : token GitHub, rotation des clés de l'ancien `.env`, avis Supabase `rls_auto_enable`.
6. Dépendances (correctifs semver, `shadcn` en dev), puis Next 15.5 ; CI GitHub Actions.
7. Pré-lancement : vérifier `VERCEL_ENV` en production, ou définir `OUTBOUND_MODE=live` ; configuration de production Vercel.

---

## 2026-10-22 — Mission 6 : base Supabase actuelle comme base de développement

**Décision de l'utilisateur** : aucun client réel, données Supabase fictives et supprimables. La base actuelle sert au développement et aux tests ; pas de nouvel environnement de base pour l'instant.

### 1. Connexion et structure (lecture seule, via le connecteur Supabase)

- Un seul projet : `ixaxfhitplhynhpihojx` (« gestlyservice-netizen's Project »), `ACTIVE_HEALTHY`, Postgres 17.6, région eu-west-1.
- `.env.local` référence bien ce projet (test oui/non sur l'identifiant public, aucune valeur affichée).
- 22 tables dans `public`, RLS activée partout, **aucune politique** : tout accès via l'API publique Supabase (anon/authenticated) est refusé ; Prisma passe par le rôle propriétaire. Volumes : User 3, Client 2, Devis 8, DevisLine 13, Notification 8, AiUsageEvent 58, toutes les autres tables vides.
- Migrations enregistrées dans `supabase_migrations.schema_migrations` (11) : les 9 de l'agent WhatsApp (`whatsapp_agent_v1_foundations`, `step5_*` ×2, `step6_whatsapp_send`, `step7_voice_transcription_fields`, `step8_ai_usage`, `step8bis_*` ×2), plus `create_settings_table`, `add_facture_lines_notes_duedate` et `remove_public_listing_on_documents_bucket`.

### 2. Comparaison des 22 modèles Prisma avec la base

| Élément | Résultat |
|---|---|
| Tables | ✅ 22/22 |
| Colonnes (noms et types) | ✅ identiques pour les 22 tables |
| Nullabilité | ✅ 76 champs optionnels = 76 colonnes nullables |
| Valeurs par défaut | ✅ 65/65 conformes (dont `trialEndsAt` en `dbgenerated`). En plus en base : `WhatsappMessage.updatedAt DEFAULT CURRENT_TIMESTAMP` (sans effet) |
| Clés étrangères | ✅ 29/29, avec les mêmes `CASCADE` / `SET NULL` |
| Index et contraintes d'unicité | ✅ 19/19. En plus en base : **index unique partiel `Notification(userId, dedupeKey) WHERE dedupeKey IS NOT NULL`** (migration `step8bis_notification_dedupe`), non exprimable en Prisma |

**Aucune migration manquante.** ⚠️ Une `prisma db push` supprimerait l'index partiel de déduplication (et le défaut de `WhatsappMessage.updatedAt`) : **ne jamais l'utiliser** sur cette base.

### 3. Avis de sécurité Supabase

- WARN : `public.rls_auto_enable()` est une fonction `SECURITY DEFINER` exécutable par `anon` et `authenticated` via `/rest/v1/rpc/rls_auto_enable`. Correction proposée (après accord) : `REVOKE EXECUTE ... FROM anon, authenticated`, ou sortir la fonction du schéma exposé.
- INFO : « RLS enabled, no policy » sur les 22 tables. C'est voulu : l'app n'utilise pas l'API Supabase pour ces tables.

### 4. Risques d'envoi réel en local (présence et type des clés, sans valeurs)

| Service | `.env.local` | Risque |
|---|---|---|
| Stripe | Clé **TEST** (préfixe vérifié), webhook et prix définis | ✅ Pas de paiement réel |
| Clerk | Instance de **développement** | ✅ |
| WhatsApp (Meta) | Token, phone ID, app secret définis ; `WHATSAPP_GRAPH_API_BASE_URL` absent | 🔴 Messages réels via `graph.facebook.com` |
| OVH SMS | 5 variables définies | 🔴 SMS réels et facturés (pas de mode test) |
| Resend | Clé définie | 🔴 Emails réels |
| IA | `OPENAI_API_KEY` défini (pas de Gateway, pas de `VERCEL_OIDC_TOKEN`) | 🔴 Appels OpenAI facturés (extraction, Whisper, amélioration de texte) |
| Supabase Storage | URL + clé `service_role` définies | 🟠 Écriture dans le stockage réel (données fictives) |
| Sentry | DSN défini | 🟠 Erreurs locales envoyées au projet Sentry |
| Cron | `CRON_SECRET` absent | ✅ Les routes cron refusent tout sauf l'administrateur connecté (vérifié dans le code) |
| `APP_URL` | localhost, mais `lib/url.ts` le remplace par `www.gestly.fr` | 🟠 Liens vers le site public |

Autres variables présentes (noms) : `NEXT_PUBLIC_CLERK_*_URL` ×4, `NEXT_PUBLIC_APP_URL`, `WHATSAPP_BUSINESS_ACCOUNT_ID`, `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`, `VERCEL_PROTECTION_BYPASS` (secret de contournement de la protection Vercel, à traiter comme sensible).

### 5. Protections minimales proposées

1. **Immédiat, sans code (utilisateur)** : vider dans `.env.local` les variables WhatsApp, OVH, Resend et `OPENAI_API_KEY` tant que le mode simulation n'existe pas. Les services se désactivent proprement (WhatsApp et OVH renvoient une erreur ou `false`, l'IA est désactivée). Exception : les routes d'envoi d'email lèvent une erreur « Missing API key ».
2. **Code (avec accord), priorité 0** : un interrupteur unique `OUTBOUND_MODE=simulate|live` (par défaut `simulate` hors production), appliqué à tous les points d'envoi : `lib/whatsapp/send.ts`, `lib/whatsapp/media.ts` (upload), `app/api/devis/[id]/whatsapp/route.ts`, `lib/sms/index.ts`, les 5 usages de Resend, et la résolution des modèles IA (`lib/ai/config.ts`, `app/api/ai/improve-message`). En mode simulation : journalisation, puis réponse simulée.
3. **Claude Code** : `.claude/settings.json` versionné avec `deny` sur `prisma db push`, `prisma migrate`, `prisma db execute`, `vercel`, `git push`, `Read(.env*)` ; confirmation obligatoire pour les outils Supabase en écriture (`apply_migration`, `execute_sql`) ; `.gitignore` corrigé (`.claude/settings.local.json` seulement).
4. **Schéma** : uniquement par SQL up/down dans `prisma/manual-migrations/`, appliqué après accord, puis `schema.prisma` aligné et `prisma generate`. Jamais `db push`.
5. **Données de test** : numéros et emails manifestement fictifs (`@example.com`, numéros de la plage fictive) pour qu'aucun envoi accidentel n'atteigne une vraie personne.

### 6. Plan de correction priorisé pour la V1

**P0 — avant tout test en exécution**
1. Mode simulation des envois (point 5.2) + tests associés.
2. `.claude/settings.json` + `.gitignore`.
3. Révoquer le token GitHub exposé (copie de l'ancien PC) ; vérifier l'ancien `.env` de l'historique Git et faire une rotation si besoin ; traiter `VERCEL_PROTECTION_BYPASS` comme secret.
4. Corriger l'avis Supabase `rls_auto_enable` (après accord).

**P1 — fiabilité**
5. Tests : signature du webhook WhatsApp et route webhook, `job-queue`, `confirm-creation`, `client-resolution`, `createDevis`, `createClient`, webhook Stripe, `lib/relances/engine.ts`, numérotation devis/factures, contrôle d'accès (`userId`) des routes API.
6. Dépendances : correctifs semver, `shadcn` en dev ; puis migration Next 15.5.x.
7. CI GitHub Actions (lint, typecheck, tests, build isolé).
8. `lib/url.ts` : autoriser `localhost` hors production ; route devis/whatsapp via `getGraphConfig()` ; `telemetry: false` pour Sentry.

**P2 — recette et lancement**
9. Recette locale des parcours complets en mode simulation (inscription, abonnement Stripe test, client, devis, signature, facture, avoir, relances, agent WhatsApp avec webhook simulé).
10. Tests réels contrôlés, un par service, avec accord : Stripe test, un message WhatsApp vers un numéro de test, un SMS, un email.
11. Pré-lancement : nettoyer la base ou créer une base de production dédiée ; configurer la production Vercel (Clerk prod, Stripe live, `CRON_SECRET`, clés réelles) ; WhatsApp Business (templates approuvés, webhook enregistré) ; fusion dans `main` et déploiement ; rate limiting persistant (actuellement en mémoire).

---

## 2026-10-22 — Mission 5 : préparation d'un environnement de développement isolé

Branche : `chore/claude-setup`. Analyse par lecture du code uniquement : aucune valeur de `.env*` lue, aucune base créée ou modifiée, aucune migration, aucun appel externe.

### Constats (code)

| Service | Configuration observée | Mode test/simulation existant ? |
|---|---|---|
| Prisma / PostgreSQL | `lib/prisma.ts` : `pg.Pool` avec **SSL forcé** (`rejectUnauthorized: false`), `max: 1`. `prisma.config.ts` charge `dotenv/config` → **`.env` seulement** ; aucun `.env` dans ce dépôt, donc la CLI Prisma n'a actuellement pas de `DATABASE_URL` (protection de fait). Next.js charge `.env.local` | Non. Un Postgres local sans SSL échouerait sans modification du code |
| Stripe | `lib/stripe.ts`, client paresseux, `STRIPE_SECRET_KEY`, `STRIPE_PRICE_ID`, `STRIPE_WEBHOOK_SECRET` | Le mode test dépend uniquement de la clé (`sk_test_`). **Non vérifié** |
| Meta WhatsApp | `lib/whatsapp/graph-config.ts` : base URL surchargeable (`WHATSAPP_GRAPH_API_BASE_URL`), utilisée par `send.ts` et `media.ts`. **Exception** : `app/api/devis/[id]/whatsapp/route.ts` a l'URL `graph.facebook.com/v18.0` en dur. Signature du webhook via `WHATSAPP_APP_SECRET` | Partiel (base URL), sauf la route devis |
| OVH SMS | `lib/sms/ovh-provider.ts`, `ovh` chargé à l'envoi, endpoint OVH par défaut. Interface `SmsProvider` présente (`lib/sms/types.ts`) | Non. Variables vides → `sendSMS()` renvoie `false` |
| Resend | `new Resend(RESEND_API_KEY)` dans 4 routes + `lib/relances/engine.ts` | Non. Clé vide → exception « Missing API key » (vérifié dans le SDK) ; seules les relances l'ignorent |
| IA | `lib/ai/config.ts` : AI Gateway (`AI_GATEWAY_API_KEY`) ou OpenAI direct (`OPENAI_API_KEY`) ; `isAiConfigured()` | Oui : clés vides → IA désactivée ; tests via modèles simulés injectés |
| Supabase Storage | `app/api/settings/logo/route.ts` (`NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`) | Vide → « Upload non configuré » |
| URL publique | `lib/url.ts` : `localhost` et URLs `.vercel.app` remplacés par `https://www.gestly.fr` | Non : liens de dev vers la production |
| Admin | `ADMIN_EMAIL` en dur dans `app/api/admin/ovh-balance/{check,history}` et `app/api/whatsapp/process-pending` | — |

### Services qui risquent de contacter la production depuis un poste de dev

1. **PostgreSQL** si `DATABASE_URL` (Next) ou `.env` (CLI Prisma) contient l'URL de production : risque le plus grave (écriture, `db push`, suppression).
2. **Stripe** avec une clé `sk_live_`.
3. **OVH** et **Resend** dès que des clés valides sont présentes : SMS et emails réels, sans mode test.
4. **Meta WhatsApp** avec un vrai token, en particulier via la route devis (URL en dur).
5. **IA** avec `AI_GATEWAY_API_KEY`, `OPENAI_API_KEY` ou un `VERCEL_OIDC_TOKEN`.
6. **Supabase Storage** de production via la clé `service_role`.
7. Indirectement, **Clerk** (instance de production) et les liens `www.gestly.fr` générés par `lib/url.ts`.

Le `.env.local` du poste est probablement concerné, mais son contenu n'a pas été vérifié.

### Architecture de développement isolée proposée

- **Base** : PostgreSQL distinct, avec SSL (voir les options d'hébergement dans le compte rendu). Schéma initialisé par `prisma db push` **sur la base de dev uniquement**, après accord. Aucune donnée de production copiée.
- **Clerk** : instance de développement (`pk_test_`/`sk_test_`).
- **Stripe** : mode test (clé `sk_test_`, produit et prix créés en mode test, `stripe listen` pour le webhook local, cartes de test).
- **Emails** : `RESEND_API_KEY` vide par défaut. Évolution recommandée (code, avec accord) : un transport « console » qui journalise au lieu d'envoyer quand la clé est absente ou que l'environnement n'est pas la production.
- **SMS** : variables OVH vides par défaut. Évolution recommandée : un `ConsoleSmsProvider` (l'interface `SmsProvider` existe déjà).
- **WhatsApp** : variables vides, ou `WHATSAPP_GRAPH_API_BASE_URL` vers un faux serveur local. Évolution recommandée : faire passer la route devis/whatsapp par `getGraphConfig()`.
- **IA** : clés vides en dev ; tests unitaires avec `MockLanguageModelV4` / `MockTranscriptionModelV4` (déjà en place) ; tests réels éventuels uniquement avec une clé de dev plafonnée, après accord.
- **Protection de la production** :
  1. Ne jamais garder de secrets de production sur le poste (les déplacer hors du dépôt) ; les secrets de production restent dans Vercel.
  2. `.claude/settings.json` versionné avec des règles `deny` (`prisma db push`, `prisma migrate`, `prisma db execute`, `vercel`, `git push`, lecture de `.env*`).
  3. Garde-fou de code proposé (avec accord) : refuser de démarrer en dev si l'hôte de `DATABASE_URL` n'est pas dans une liste autorisée.
  4. Côté base de production : rôle applicatif sans droits DDL et sauvegardes vérifiées (à étudier avec l'utilisateur).

### Fichiers produits

- `.env.example` : 33 variables, valeurs fictives (`REPLACE_ME`, `CHANGE_ME`, domaine `.invalid`), services sensibles vides par défaut, commentaires sur les risques de chaque service. Non ignoré par `.gitignore`.
- `CLAUDE.md` : nouvelle section « Environnement de développement isolé (obligatoire) » ; règle 1 complétée.
- `ROADMAP.md` : socle mis à jour et section « Prochaines étapes ».

### Prochaines actions (non commencées)

1. **Utilisateur** : choisir l'hébergement de la base de dev ; créer l'instance Clerk de dev et les clés Stripe test.
2. **Utilisateur** : déplacer le `.env.local` actuel hors du dépôt, puis créer `.env.local` et `.env` depuis `.env.example`.
3. Avec accord : `prisma db push` sur la base de dev, après vérification de l'hôte cible sans afficher l'URL.
4. `.claude/settings.json` (permissions `deny` + hooks) et correction de `.gitignore`.
5. Garde-fous de code (SMS/email console, URL Meta, `APP_URL`, SSL configurable, liste d'hôtes autorisés).

---

## 2026-10-22 — Mission 4 : sécurité des dépendances et build de production

Branche : `chore/claude-setup` @ `dbd67c6`. Modifications non commitées de `CLAUDE.md`, `ROADMAP.md` et `PROGRESS.md` préservées. Aucune dépendance modifiée, aucun `npm audit fix`.

### 1. Vulnérabilités (`npm audit`, 48 : 4 critiques, 27 élevées, 15 modérées, 2 faibles)

**Critiques**

| Paquet | Type | Origine | Exploitable chez nous ? | Correction |
|---|---|---|---|---|
| `next` 14.2.35 | direct, runtime | — | **Oui, en partie** (voir ci-dessous) | Aucune version 14.x corrigée (14.2.35 est la dernière). Corrigé à partir de **15.5.24** (dernière 15.5 publiée : 15.5.28) ; `npm audit` propose 16.4.2. Montée **majeure** |
| `vitest` 2.1.9 + `tinypool` | dev | `vitest` | Non : seulement si l'UI Vitest ou un serveur est exposé, ce qui n'est jamais le cas | `vitest` ≥ 3.2.6 / 4.1.11 (dernière : 5.0.5). Majeure, dev uniquement |
| `proxy-addr` 2.0.7 | transitif | `shadcn` → `@modelcontextprotocol/sdk` → `express` | Non : `shadcn` est un CLI de génération de composants, jamais importé par l'app | Correctif semver disponible ; ou passer `shadcn` en `devDependencies` |

**`next` 14.2.35 : 23 avis.** Analyse pour Gestly (App Router, hébergé sur Vercel en Linux, middleware Clerk) :
- **Non applicables** : RCE sur serveurs Windows (Vercel = Linux) ; i18n Pages Router (pas de Pages Router) ; SSRF/smuggling dans les `rewrites` (aucun `rewrites` dans `next.config.mjs`) ; Server Actions DoS/SSRF (aucun `"use server"`) ; XSS avec nonces CSP / `beforeInteractive` (non utilisés) ; WebSocket SSRF (serveur custom absent).
- **Atténués par Vercel, risque résiduel** : RCE critique et DoS de l'Image Optimizer (`/_next/image`, AVIF). `next/image` n'est jamais importé, mais l'endpoint existe par défaut. Sur Vercel, l'optimisation d'image est servie par l'infrastructure Vercel, pas par le serveur Next.
- **Applicables** : plusieurs DoS liés aux Server Components (`>=13.0.0 <15.5.16`), confusion et empoisonnement de cache des réponses RSC, divulgation des endpoints de Server Functions. Gravité élevée/modérée, sans fuite de données directe identifiée.
- Conclusion : pas de faille critique exploitable identifiée sur notre déploiement Vercel. En revanche, la branche 14.x n'est plus corrigée : **la montée vers Next 15.5.x est la correction prioritaire de fond.**

**Élevées et modérées : origine, et pourquoi elles ne sont pas exploitables à l'exécution**
- `prisma` (CLI) → `@prisma/dev` (`hono`, `@hono/node-server`, `valibot`), `mysql2`, `@prisma/config` (`deepmerge-ts`, `defu`) : outillage du CLI Prisma (serveur de dev local, MCP), absent du runtime de l'app. Correctifs semver disponibles (mise à jour de `prisma` / `@prisma/client` 7.x).
- `shadcn` → `@modelcontextprotocol/sdk`, `express-rate-limit`, `ip-address`, `ts-morph`, `fast-glob`, `msw` : CLI uniquement. **`shadcn` est à tort dans `dependencies`** : le déplacer en `devDependencies`.
- `tailwindcss` 3 / `postcss` / `chokidar` / `braces` / `micromatch` / `fast-glob`, `eslint-config-next` / `glob`, `browserslist`, `source-map-js`, `@babel/core`, `fast-uri` (via webpack de `@sentry/webpack-plugin`) : outils de build qui traitent uniquement nos propres fichiers, entrées de confiance. Risque négligeable.
- `vite`, `vite-node`, `@vitest/mocker`, `esbuild` ≤ 0.24.2 : dev, via Vitest, serveur jamais exposé.
- `jspdf` → `dompurify` 3.3.3 (modérée) : `dompurify` sert à `jspdf.html()`, **jamais appelé** dans le code. Correctif semver disponible.
- `resend` → `svix` → `uuid` (modérée) : bug de bornes dans v3/v5/v6 avec un `buf` fourni, cas non utilisé. Correctif semver disponible (`resend` ≥ 6.12.3).
- `nanoid`, `js-yaml`, `qs`, `fflate`, `postcss-selector-parser`, `baseline-browser-mapping`, `body-parser` : transitifs d'outillage, correctifs semver disponibles.

### 2. Corrections prioritaires (aucune appliquée)

1. **Next.js 14.2.35 → 15.5.x (≥ 15.5.24)**. Montée majeure : React 19, API asynchrones (`params`, `cookies()`, `headers()`), compatibilité Clerk 6, Sentry et `@base-ui/react` à vérifier. À faire sur une branche dédiée, avec build, tests et recette manuelle.
2. **Correctifs semver sans rupture** : un `npm update` ciblé (pas `audit fix --force`) pour `prisma`/`@prisma/client`, `resend`, `jspdf`, et les transitifs `proxy-addr`, `fast-uri`, `nanoid`, `js-yaml`, `qs`, `defu`, `brace-expansion`… Puis `npm ci`, tsc, lint, tests et build.
3. **Déplacer `shadcn` en `devDependencies`** (CLI, pas de code runtime).
4. **Vitest 2 → 3.2.x (≥ 3.2.6) ou 4.1.12+** : dev uniquement. Vérifier la compatibilité de `MockLanguageModelV4` et `vi.mock`.
5. Plus tard : `eslint-config-next` alignée sur la version de Next ; `tailwindcss` 4 seulement si une refonte CSS est prévue (risque faible aujourd'hui).

### 3. Scripts d'installation bloqués par npm 11 (`allowScripts`)

| Paquet | Rôle du script | Nécessaire au build ? |
|---|---|---|
| `@prisma/engines` (postinstall) | Téléchargement des moteurs natifs | **Non** : Prisma 7 + `@prisma/adapter-pg` utilise le compilateur de requêtes WASM (`query_compiler_fast_bg.wasm`, généré) ; `schema-engine-windows.exe` est déjà présent (migrations uniquement) |
| `prisma` (preinstall) | Vérification de version Node | Non |
| `esbuild` 0.28.2 / 0.21.5 (postinstall) | Vérification du binaire | Non pour `next build` (SWC) ; utilisé par Vitest/tsx, mais fonctionne déjà via `@esbuild/win32-x64` |
| `@sentry/cli` (postinstall) | Téléchargement / vérification du binaire | Non : binaire fourni par `@sentry/cli-win32-x64` ; utilisé uniquement pour l'upload des source maps et les releases, désactivés sans `SENTRY_AUTH_TOKEN` |
| `@clerk/shared` (postinstall) | Affiche un avis de télémétrie Clerk | Non |
| `core-js` (postinstall) | Message de financement | Non |
| `msw` (postinstall, via `shadcn`) | Copie d'un service worker | Non |
| `unrs-resolver` (postinstall) | Vérification du binding natif (eslint) | Non : lint OK |

**Recommandation** : n'en approuver aucun pour l'instant (moindre privilège). Si nécessaire un jour, approuver nommément (`npm install-scripts approve @sentry/cli`, par exemple) et versionner la décision dans un `.npmrc` projet, jamais via une autorisation globale. Ce blocage est propre au npm 11 local ; il ne préjuge pas du comportement du build Vercel.

### 4. Build de production

**Variables d'environnement utilisées par le code (noms seulement, valeurs non lues)** : `DATABASE_URL`, `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_ID`, `RESEND_API_KEY`, `RESEND_FROM_EMAIL`, `OVH_APP_KEY`, `OVH_APP_SECRET`, `OVH_CONSUMER_KEY`, `OVH_SMS_SERVICE_NAME`, `OVH_SMS_SENDER`, `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_APP_SECRET`, `WHATSAPP_WEBHOOK_VERIFY_TOKEN`, `WHATSAPP_GRAPH_API_BASE_URL`, `WHATSAPP_AI_MODEL`, `WHATSAPP_TRANSCRIPTION_MODEL`, `WHATSAPP_AI_MONTHLY_LIMIT`, `AI_GATEWAY_API_KEY`, `OPENAI_API_KEY`, `CRON_SECRET`, `APP_URL`, `NEXT_PUBLIC_SENTRY_DSN`, `SENTRY_AUTH_TOKEN`, `SENTRY_ORG`, `SENTRY_PROJECT`, `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`.

**Risques d'isolation identifiés, et parade appliquée**
- `next build` charge automatiquement `.env.local` (probablement les secrets de production), sans pouvoir le désactiver. → **Build dans une copie exportée par `git archive HEAD`** dans le scratchpad de session : les fichiers non suivis sont exclus, donc pas de `.env*`. `node_modules` relié par jonction, retirée après le build.
- Le plugin webpack Sentry est **toujours** ajouté par `withSentryConfig`, et sa télémétrie (`telemetry` vaut `true` par défaut) envoie des données à `o1.ingest.sentry.io` quand l'URL est `sentry.io`. → `SENTRY_URL=http://127.0.0.1:9` : la vérification de télémétrie échoue localement, donc rien n'est envoyé. Sans `SENTRY_AUTH_TOKEN`, ni upload ni release.
- Télémétrie Next.js → `NEXT_TELEMETRY_DISABLED=1`. Vérification de version Prisma → `CHECKPOINT_DISABLE=1`.
- Base → `DATABASE_URL` factice vers `127.0.0.1:9` : aucune connexion possible hors de la machine. Aucune page statique n'importe Prisma.
- Toutes les autres variables : valeurs factices, process de build uniquement. Polices locales (`next/font/local`), aucun client SDK qui ouvre une connexion au chargement des modules (OVH chargé paresseusement, Stripe instancié paresseusement depuis `9ce9f76`).

**Résultat : ✅ `npm.cmd run build` réussi (code 0)**
- `prisma generate` OK (client v7.6.0, régénéré dans le `node_modules` du projet, même schéma).
- Compilation OK ; lint et typage intégrés au build OK ; 45 pages générées.
- Toutes les pages sont dynamiques (`ƒ`), sauf `/robots.txt` et `/sitemap.xml` (statiques). Middleware : 139 kB. First Load JS partagé : 200 kB.
- Avertissements non bloquants : `disableLogger` déprécié ; `sentry.client.config.ts` à migrer vers `instrumentation-client.ts` (pour Turbopack) ; `caniuse-lite` obsolète ; « edge runtime désactive la génération statique » sur une page ; avertissements de cache webpack (performance).
- Limite : ce build prouve la compilation, pas le fonctionnement à l'exécution. Le build Vercel (variables réelles, npm de Vercel) n'est pas reproduit à l'identique.

Remarque : la commande `npm ci` de la Mission 3 a exécuté `prisma generate` sans `CHECKPOINT_DISABLE` ; la CLI Prisma a donc pu envoyer sa vérification de version anonyme habituelle à Prisma. Aucun service de production n'est concerné.

### Prochaines actions recommandées (non commencées)

1. Branche dédiée `chore/deps-security` : correctifs semver (point 2.2) + `shadcn` en dev, puis vérification complète (tsc, lint, tests, build isolé).
2. Branche dédiée `chore/next-15` : migration Next 15.5.x / React 19, avec plan de recette.
3. Ajouter `telemetry: false` dans `withSentryConfig` (modification de `next.config.mjs`, soumise à accord) pour ne plus dépendre de l'astuce `SENTRY_URL`.
4. Créer un script de build isolé réutilisable (copie + variables factices) pour la CI et les agents.
5. Commiter les mises à jour de `CLAUDE.md`, `ROADMAP.md` et `PROGRESS.md`.

---

## 2026-10-22 — Mission 3 : installation et premières vérifications techniques

Branche : `chore/claude-setup` @ `dbd67c6`. Avant de commencer, seuls `ROADMAP.md` et `PROGRESS.md` étaient modifiés (non commités).

### Résultats

| Étape | Commande | Résultat |
|---|---|---|
| Installation | `npm.cmd ci` (npm 11.19.0) | ✅ code 0. `@ai-sdk/openai` 4.0.17, `@vercel/functions` 3.9.5, `vitest` 2.1.9, `tsx` 4.23.13 installés. Aucun fichier suivi modifié (`package-lock.json` inchangé). |
| Client Prisma | `postinstall` → `prisma generate` | ✅ généré localement (`node_modules/.prisma/client`), contient les modèles WhatsApp. `prisma generate` n'a pas été relancé séparément. Aucun accès à la base : `prisma.config.ts` ne charge que `.env` (absent), et aucune variable sensible n'est définie dans le shell. |
| Typage | `npm.cmd exec -- tsc --noEmit` | ✅ code 0, aucune erreur |
| Lint | `npm.cmd run lint` | ✅ « No ESLint warnings or errors » (seul avertissement : dépréciation `disableLogger` de `@sentry/nextjs`) |
| Tests | `npm.cmd test -- --run` | ✅ **13 fichiers, 85 tests réussis, 0 échec**, 1,58 s |

Détail des tests : `voice-message` 16, `agent` 12, `ai/usage` 9, `client-optout` 8, `extraction-checkpoint` 7, `artisan-optout` 7, `extraction` 5, `transcription` 5, `notifications` 4, `pending-devis` 4, `send-devis` 3, `escalation` 3, `extraction-checkpoint-quota.e2e` 2.

### Audit d'isolation des tests (fait avant l'exécution)

- 12 fichiers sur 13 mockent `@/lib/prisma` et/ou les modules d'effet de bord (`send`, `media`, `send-claim`, `generate-document-pdf`, `job-queue`, `escalation`…). `pending-devis.test.ts` ne teste que des fonctions pures (aucun import).
- Les modèles IA sont injectés via `opts.model` (`MockLanguageModelV4`, `MockTranscriptionModelV4` de `ai/test`). Les logs confirment `modele=mock-transcription-model`.
- Aucun module testé n'importe sans mock Stripe, Resend, OVH, `fetch` Meta ou `lib/prisma`.
- Seconde barrière : aucune clé IA, base, Stripe, WhatsApp, OVH ou Resend dans l'environnement du shell. `isAiConfigured()` aurait donc bloqué tout appel IA réel.

### Avertissements relevés

- npm 11 a **bloqué les scripts d'installation** de 9 dépendances (`allowScripts`) : `@clerk/shared`, `@prisma/engines`, `@sentry/cli`, `core-js`, `esbuild` (×2), `msw`, `prisma` (preinstall), `unrs-resolver`. Impact constaté : aucun sur le typage, le lint et les tests (`esbuild` fonctionne via son binaire optionnel). Impact possible, non vérifié, sur `npm run build` (`@sentry/cli`) et le moteur Prisma à l'exécution.
- `npm audit` : 48 vulnérabilités (4 critiques, 27 élevées), dont `next` 14.2.35. Non analysées.

### Ce qui reste NON vérifié

- `npm run build`.
- Webhook Meta, cron `process-pending`, `waitUntil`, résolution client et `createDevis`/`createClient` : **aucun test**.
- Tout comportement réel : Meta, OpenAI/Whisper, Postgres (dont l'index unique `dedupeKey`), Stripe, OVH, Resend.
- État du schéma de la base réelle comparé à `prisma/schema.prisma`.
- Reste de l'application (devis, factures, avoirs, relances, Stripe) : aucun test.

### Prochaines actions proposées (non commencées)

1. `npm run build` avec des variables factices (vérifier le correctif `9ce9f76` et l'impact des scripts d'installation bloqués).
2. Ajouter des tests pour `verify-signature`, la route webhook, `job-queue`, `confirm-creation`, `createDevis` et `createClient`.
3. Commiter les mises à jour de `CLAUDE.md`, `ROADMAP.md` et `PROGRESS.md`.
4. Vérification en lecture seule du schéma de la base, sur un environnement désigné par l'utilisateur.
5. Ajouter le script `typecheck`, puis une CI GitHub Actions (lint, typecheck, test).

---

## 2026-10-22 — Mission 2 : récupération et intégration de l'agent IA WhatsApp

> ⚠️ **La section « Recherche agent IA WhatsApp » de la Mission 1 ci-dessous est obsolète.** Le code existait, mais seulement sur une branche locale jamais poussée, sur l'ancien PC.

### Tâches réalisées

- [x] Copie de l'ancien projet examinée en lecture seule (`C:\Users\utaku\gestly ancien PC`). On y trouve une branche locale `feature/whatsapp-agent-v1`, sans branche distante associée : 14 commits (`5cdbf61` → `9ce9f76`, du 2026-09-08 au 2026-09-28), partant exactement de `7128471` (= `main`). Arbre de travail propre, aucun stash, aucun dépôt imbriqué, aucun fichier métier non suivi. Aucun motif de secret dans le diff de la branche.
- [x] Branche récupérée dans ce dépôt avec `git fetch "<ancien PC>" feature/whatsapp-agent-v1:feature/whatsapp-agent-v1`. Preuve : `git rev-list --count main..feature/whatsapp-agent-v1` = 14, sommet `9ce9f76`, `git fsck` sans erreur. Les empreintes SHA-256 des trois fichiers de suivi sont identiques avant et après.
- [x] Fichiers de suivi commités : `19745bc` (uniquement `CLAUDE.md`, `ROADMAP.md`, `PROGRESS.md`, après un scan anti-secrets négatif).
- [x] Merge local `--no-ff` de `feature/whatsapp-agent-v1` dans `chore/claude-setup` : commit `dbd67c6`, **aucun conflit**.
- [x] Présence vérifiée après le merge : 41 fichiers source attendus (routes `app/api/whatsapp/*`, `lib/whatsapp/*`, `createDevis`, `createClient`, `lib/phone.ts`, `lib/ai/usage.ts`, `vitest.config.ts`) et 13 fichiers de test.
- [x] Isolation des tests vérifiée par lecture : 12 fichiers mockent `@/lib/prisma` et/ou les modules externes (`vi.mock`) ; l'IA est simulée par `MockLanguageModelV4` (`ai/test`) ; `pending-devis.test.ts` ne teste que des fonctions pures. Aucun `fetch` réel ni `DATABASE_URL` dans les tests. Seule variable manipulée : `WHATSAPP_AI_MONTHLY_LIMIT`, dans `lib/ai/usage.test.ts`, et uniquement dans `process.env` du processus de test.

Identité Git : aucune n'était configurée sur ce poste. Les commits ont été faits avec `git -c user.name="Gestly Dev" -c user.email="dev@gestly.app"`, l'identité des 99 commits existants, sans modifier la configuration Git.

### Non vérifié (aucune fonctionnalité de l'agent n'est déclarée opérationnelle)

- `npx tsc --noEmit`, `npm run lint`, `npm run build` et `npm test` **n'ont pas été relancés** après le merge.
- Dépendances ajoutées par la branche **non installées** dans `node_modules` : `@ai-sdk/openai` ^4.0.17, `@vercel/functions` ^3.9.5 (dépendances) ; `vitest` ^2.1.9, `tsx` ^4.23.13 (dépendances de dev). `package-lock.json` est déjà à jour dans le merge.
- Client Prisma non régénéré pour les 7 nouveaux modèles (`WhatsappConversation`, `WhatsappMessage`, `WhatsappJob`, `WhatsappSend`, `AiUsageEvent`, `RelanceDevisSettings`, `RelanceDevis`).
- État réel du schéma en base inconnu (le commit `5cdbf61` affirme une application sur Supabase, non vérifié).

### Blocages / points ouverts

- ⚠️ Token GitHub en clair dans le remote `origin` de la copie de l'ancien PC (`.git/config`) : **à révoquer par l'utilisateur**.
- ⚠️ `.env` toujours présent dans l'historique Git (voir Mission 1).
- `CLAUDE.md` à mettre à jour : il indique encore l'absence de tests et ne décrit pas l'agent WhatsApp.
- Rien n'est poussé sur GitHub ; `chore/claude-setup` est locale.

### Prochaines actions proposées (non commencées)

1. `npm ci` (installation locale, depuis le registre npm, sans appel payant) → `npx prisma generate` (génération locale du client, aucun accès à la base).
2. `npx tsc --noEmit` et `npm run lint` sur le code fusionné.
3. `npm test` (Vitest, entièrement mocké d'après la lecture) → consigner le résultat.
4. `npm run build` avec des variables factices, pour confirmer le correctif `9ce9f76` (build sans `STRIPE_SECRET_KEY`).
5. Mettre à jour `CLAUDE.md` (agent WhatsApp, Vitest, `prisma/manual-migrations`, routes publiques ajoutées dans `middleware.ts`).
6. Vérification **en lecture seule** du schéma de la base cible, après accord de l'utilisateur et sur un environnement désigné.

---

## 2026-10-22 — Mission 1 : configuration et suivi

Branche : `chore/claude-setup` (créée depuis `main` @ `7128471`, arbre de travail propre au départ).

### Tâches réalisées

- [x] Vérification de l'état Git : `git status` vide sur `main`, aucun stash, seules branches `main` et `origin/main`.
- [x] Création de la branche `chore/claude-setup` (`git switch -c`), sans perte de modification.
- [x] Création de `CLAUDE.md` (architecture, conventions, commandes, règles de sécurité).
- [x] Création de `ROADMAP.md` (23 fonctionnalités, toutes non vérifiées par tests).
- [x] Création de `PROGRESS.md` (ce fichier).
- [x] Recherche des développements « agent IA WhatsApp » (résultats ci-dessous).
- [x] Contrôles locaux de référence, sans appel externe :
  - `npx tsc --noEmit` → code de sortie 0
  - `npx next lint` → « ✔ No ESLint warnings or errors » (seul avertissement : dépréciation `disableLogger` de `@sentry/nextjs`)
- [x] Vérification de l'absence de secrets dans les trois fichiers créés.

Aucun fichier métier, `package.json`, schéma Prisma ou dépendance modifié. Aucune migration, aucun appel externe, aucun push.

### Recherche « agent IA WhatsApp »

Méthode : `grep` insensible à la casse sur l'arbre de travail (hors `node_modules`, `.next`, `.git`, `.env*`) ; `git log --all --grep` sur les messages ; `git log --all -G` (pickaxe) sur le contenu de l'historique ; recherche de marqueurs de webhook entrant (`hub.verify_token`, `hub.challenge`) et de termes `chatbot`, `conversation`, `agent`.

**Conclusion : aucun agent IA WhatsApp (conversationnel, réception de messages, réponse automatique par IA) n'existe dans le dépôt ni dans son historique Git.** WhatsApp n'est utilisé qu'en **envoi sortant** d'un devis, et l'IA uniquement pour reformuler les messages de relance. Les deux ne sont pas reliés.

Si un agent IA WhatsApp a été développé, il se trouve hors de ce dépôt (autre repo, branche non poussée, outil no-code, etc.) — à confirmer par l'utilisateur.

**Code WhatsApp présent aujourd'hui :**
- `app/api/devis/[id]/whatsapp/route.ts` : `POST` authentifié, vérifie l'abonnement, charge le devis filtré par `userId`, envoie le template Meta `devis_client` (langue `fr`, 4 paramètres : nom du client, numéro, montant TTC, lien public) via `graph.facebook.com/v18.0/{WHATSAPP_PHONE_NUMBER_ID}/messages`. Variables utilisées (noms seulement) : `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`.
- `app/dashboard/devis/[id]/page.tsx` (l. 161) : bouton qui appelle cette route.
- `app/api/clients/route.ts`, `app/api/clients/[id]/route.ts`, `app/dashboard/clients/page.tsx` : champ « canal de contact préféré » (WhatsApp / Email / Téléphone).
- Mentions textuelles : `app/page.tsx`, `components/landing/faq-section.tsx`, `app/abonnement/page.tsx`, `app/dashboard/parametres/abonnement/page.tsx`, `app/cgu/page.tsx`, `app/privacy/page.tsx`.

**Code WhatsApp supprimé (historique) :**
- `app/api/whatsapp/send/route.ts` : endpoint générique d'envoi (texte libre ou template). Ajouté dans `90ef276`, modifié dans `b82fc0d`, **supprimé dans `8cce6eb`** (« audit sécurité — … retire l'endpoint WhatsApp public »).

**Commits liés à WhatsApp (chronologique inverse) :**
`8cce6eb`, `94be0d9`, `7073aff` (passage au template `devis_client`), `6273904`, `54335b5`, `7ef08d2`, `f6c4028`, `c1f4ea6` (création de la route devis/whatsapp), `c3a6042` (URL courte `/d/[id]`), `ef5091e`, `2a79732`, `f8bc019`, `b5fe2ad`, `2043a5e`, `93bad5a`, `b82fc0d`, `90ef276`.
Les commits `ci:` `6273904`, `2043a5e`, `93bad5a` ne modifient aucun fichier (commits vides pour forcer un redéploiement) : aucun token n'est commité par eux.

**IA présente aujourd'hui (non liée à WhatsApp) :**
- `app/api/ai/improve-message/route.ts` : `generateText` (SDK `ai`, modèle `openai/gpt-4o-mini`), rate-limitée, appelée uniquement depuis `app/dashboard/parametres/relances/page.tsx`.
- `lib/ai/config.ts` : `isAiConfigured()` (variables `AI_GATEWAY_API_KEY` ou `OPENAI_API_KEY`, noms seulement).

### Blocages / points ouverts

- ⚠️ **`.env` présent dans l'historique Git** : ajouté dans `2e81a89`, retiré dans `dd10b13` (2026-03-27). Contenu non inspecté (lecture des secrets interdite ; tentative de lecture masquée refusée par le garde-fou de permissions). **Action utilisateur** : vérifier si des valeurs réelles y figuraient et, le cas échéant, faire une rotation des clés concernées.
- ⚠️ Aucun environnement de dev isolé confirmé (base, Stripe test, SMS/WhatsApp/email factices).
- ⚠️ `.claude/` est listé dans `.gitignore` : les futurs sous-agents et hooks projet ne seraient pas versionnés.
- Pas de migrations Prisma, pas de tests, pas de CI.

### Prochaines actions proposées (non commencées)

1. Décision utilisateur : base de dev isolée + `.env.example` (noms uniquement).
2. Ajuster `.gitignore` pour versionner `.claude/` (en ignorant `.claude/settings.local.json`).
3. Installer Vitest, ajouter les scripts `typecheck` / `test` / `check`, puis une CI GitHub Actions.
4. Créer `.claude/settings.json` (permissions, hooks) et les sous-agents spécialisés.
5. Décision utilisateur sur la migration Prisma de référence.
6. Clarifier avec l'utilisateur où se trouve l'éventuel agent IA WhatsApp.
