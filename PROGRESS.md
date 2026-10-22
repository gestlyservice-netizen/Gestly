# PROGRESS — Journal de développement

Format : une entrée par session, la plus récente en haut. Chaque tâche « faite » indique sa preuve.

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
