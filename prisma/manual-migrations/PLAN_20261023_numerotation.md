# Plan de bascule — numérotation et conservation des documents (2026-10-23)

> ⚠️ Aucune de ces migrations n'a été exécutée sur Supabase. À appliquer **uniquement** sur autorisation écrite de l'utilisateur, **par l'utilisateur** : Claude Code ne peut ni lancer `psql`, ni `apply_migration`, ni `prisma migrate` (règles `deny` et hook de `.claude/`).
> Dernière vérification complète : 2026-10-22, Missions 13 et 14 (`PROGRESS.md`).

## 1. Les quatre migrations (dans cet ordre)

Chaque fichier `*_up.sql` est encadré par `BEGIN` / `COMMIT` : en cas d'erreur, rien n'est appliqué (prouvé par la répétition locale : un doublon fait échouer la migration 2 sans créer d'index partiel).

| # | Fichier | Objectif | Tables modifiées | Risques | Retour arrière |
|---|---|---|---|---|---|
| 1 | `20261023_document_number_counters_up.sql` | Compteurs persistants : un numéro n'est jamais réattribué (D4), « Prochain n° » en série annuelle (D1) | Nouvelle table `DocumentNumberCounter` (index unique `(userId, kind, series)`, FK CASCADE vers `User`, RLS) | Nul : ajout pur, ignoré par l'ancienne version | `_down` : **perte des compteurs**. Garde-fou : refuse si la table n'est pas vide, sauf `SET gestly.confirm_counter_loss = 'oui'` après export |
| 2 | `20261022_unique_document_numbers_up.sql` | Unicité des numéros dans la base | Index uniques `(userId, number)` sur `Devis`, `Facture`, `Avoir` | Échoue sans effet si un doublon existe. Ancienne version : 500 au lieu d'un doublon silencieux | `_down` : sans perte |
| 3 | `20261022_restrict_accounting_document_deletion_up.sql` | Aucune suppression ne peut effacer une facture ou un avoir (D5, D6) | 5 clés étrangères de `Facture` et `Avoir` : CASCADE → RESTRICT | Échoue sans effet si un nom de contrainte diffère. Ancienne version : 500 au lieu d'effacer en cascade | `_down` : sans perte, mais rétablit les cascades |
| 4 | `20261023_freeze_invoice_lines_up.sql` | Figer le contenu des factures existantes (D6) | Insère les lignes du devis dans `FactureLine` pour les factures sans ligne propre (9 lignes au 2026-10-22) ; table de suivi `_Backfill20261023FactureLine` | Fige le contenu actuel des devis (identique en montants, vérifié). **Relançable** : ne traite que les factures encore sans ligne, sans doublon | `_down` : supprime les seules lignes tracées. Garde-fou : refuse si un avoir a été émis après le gel, sauf `SET gestly.confirm_freeze_rollback = 'oui'` |

Fichiers de contrôle (tous dans le dépôt) :

| Fichier | Rôle | Écrit en base ? |
|---|---|---|
| `20261022_document_numbers_precheck.sql` | Contrôle préalable : doublons, noms et règles des 5 contraintes, objets absents, factures à figer, comptes concernés | Non |
| `20261023_postcheck.sql` | Contrôle après migration : échoue au premier écart, affiche `POSTCHECK OK` | Non |
| `20261023_pg_behaviour_tests.sql` | 10 tests du comportement réel (doublons refusés, suppressions refusées ou autorisées, compteurs, upsert, verrou) | Écritures **annulées** (`ROLLBACK`) |
| `scripts/db/catalog-snapshot.sql` | Instantané du catalogue (colonnes, index, clés étrangères) | Non |
| `scripts/db/compare-schema.mjs` | Compare un instantané à `schema.prisma` : `--expect=before` (seuls les écarts corrigés par les migrations) ou `--expect=after` (0 écart) | Hors ligne |
| `scripts/db/rehearse-migrations.mjs` | Répétition complète sur PostgreSQL 17 en mémoire (PGlite) : schéma réel reconstruit, données synthétiques | Aucune connexion possible |
| `scripts/db/backup.ps1`, `scripts/db/verify-backup.ps1` | Sauvegarde, puis preuve de restaurabilité (et répétition sur la copie restaurée) | Non (lecture seule sur Supabase) |
| `scripts/db/fixtures/` | Catalogue et instantané de la base au 2026-10-22, structure seulement, aucune donnée | — |

## 2. Sauvegarde recommandée

Le projet Supabase est en **offre gratuite** (vérifié le 2026-10-22) : aucune sauvegarde téléchargeable ni restauration à un instant donné depuis le tableau de bord. Méthode retenue : **`pg_dump` au format custom du schéma `public`** (structure, données, contraintes, index, RLS, la fonction `rls_auto_enable`) **et de `supabase_migrations`**, puis **restauration réelle sur un PostgreSQL 17 local temporaire** pour la preuve.

- Pourquoi pas une sauvegarde complète de la base : les schémas internes de Supabase (`auth`, `storage`, `vault`, `extensions`…) ne sont pas touchés par ces migrations et ne se restaurent pas sur un PostgreSQL standard. `auth` est inutilisé (Clerk). `storage` contient 1 objet (logo) et n'est pas concerné.
- Volume : 22 tables, environ 1 Mo, une centaine de lignes. Durée : quelques secondes.
- Rôle `postgres` : propriétaire des 22 tables, avec `BYPASSRLS`. L'export lit donc toutes les lignes malgré la RLS.
- **Une sauvegarde n'est valable que si `verify-backup.ps1` a écrit `RESTORE-VERIFIED.txt`**. Le script vérifie les empreintes, la restauration sans erreur, le nombre de lignes de chaque table et la structure à l'identique.
- Les fichiers de sauvegarde contiennent les données : ils sont écrits **hors du dépôt** (`%USERPROFILE%\gestly-backups\`). Ne jamais les committer ni les partager.

## 3. Procédure de bascule

### Phase A — Préparation, sans aucune écriture en base

| Étape | Qui | Action | Preuve attendue |
|---|---|---|---|
| A1 | Claude (fait) | `node scripts/db/rehearse-migrations.mjs` | `RÉPÉTITION RÉUSSIE` (31 contrôles) |
| A2 | Utilisateur | Installer PostgreSQL 17 | `pg_dump --version` ≥ 17 |
| A3 | Utilisateur | `backup.ps1` | Dossier daté, 22 tables, `SHA256SUMS.txt` |
| A4 | Utilisateur | `verify-backup.ps1 -BackupDir … -Rehearse` | `RESTORE-VERIFIED.txt` ; répétition sur la copie des **vraies** données : migrations, postcheck, tests, 0 écart |
| A5 | Utilisateur ou Claude (lecture) | Contrôle préalable sur Supabase | 0 doublon ; 5 contraintes en `c`/`c` ; objets absents |

**Arrêt** si A3, A4 ou A5 échoue.

### Phase B — Migrations sur Supabase (autorisation écrite requise)

| Étape | Action | Preuve |
|---|---|---|
| B1 | Migrations 1 → 4, une par une, avec `ON_ERROR_STOP` | Chaque fichier se termine par `COMMIT` |
| B2 | `20261023_postcheck.sql` | `POSTCHECK OK`, mêmes nombres de devis et de factures qu'avant, 9 lignes figées |
| B3 | Instantané + `compare-schema.mjs --expect=after` | `RÉSULTAT (after) : CONFORME` |
| B4 | `20261023_pg_behaviour_tests.sql` | `PG TESTS OK` (écritures annulées) |

En cas d'échec en B1 : la migration fautive n'a rien appliqué. Lancer le `_down` des migrations déjà passées, dans l'ordre inverse, puis analyser. En dernier recours, restaurer la sauvegarde.

### Phase C — Déploiement coordonné (décision distincte)

Le déploiement de `test/whatsapp-flow` emporte **aussi** l'agent WhatsApp et le mode simulation (Missions 2 à 12). Sa préparation propre :
- `OUTBOUND_MODE=live` en Production Vercel ;
- contrôle `/api/health` après le déploiement ;
- variables WhatsApp et IA.

Elle ne conditionne pas la sécurité des migrations : l'ancienne version fonctionne avec le nouveau schéma (§4). Ordre :
1. Fusion de `test/whatsapp-flow` dans `main`, push, déploiement Vercel (par l'utilisateur).
2. **Juste après le déploiement : relancer la migration 4** (relançable), puis le postcheck. Cela fige les factures créées par l'ancienne version entre B1 et C1.
3. Validation fonctionnelle (§5).

## 4. Risques tant que l'ancienne version (`origin/main`, `7128471`) reste en ligne

L'ancienne version utilise la même base. Entre la phase B et la phase C :

| # | Situation dans l'ancienne version | Avant migration | Après migration | Gravité |
|---|---|---|---|---|
| R1 | Numérotation `count + 1` : après suppression d'un devis (autorisée pour tout statut), ou deux créations simultanées, le numéro calculé existe déjà | Doublon silencieux | Erreur 500, document non créé | Faible : amélioration (plus de doublon), message d'erreur peu clair |
| R2 | Suppression d'un client qui a des factures ou avoirs | Factures effacées en cascade | Erreur 500, rien n'est supprimé | Faible : amélioration (plus de perte), message peu clair |
| R3 | Transformation devis → facture : facture créée sans ligne propre | — | Facture non figée | Corrigé par la relance de la migration 4 (C2) |
| R4 | Modification d'un devis déjà facturé (non bloquée) | Change le contenu affiché de la facture | Sans effet sur les factures figées (l'ancienne version affiche d'abord les lignes propres : API, impression, avoirs) ; effet seulement sur une facture de type R3 jusqu'à C2 | Faible |
| R5 | Compteurs ignorés par l'ancienne version | — | Sans conséquence : le nouveau code prend `max(plus grand numéro + 1, compteur)` | Nul |
| R6 | Déploiements Preview Vercel d'autres branches, s'ils pointent vers la même base | — | Mêmes effets que R1 à R4 | Faible |
| R7 | Verrous pendant les migrations 2 et 3 (création d'index, validation des clés) | — | Écritures bloquées quelques millisecondes (une centaine de lignes) | Négligeable |

Le déclencheur Supabase `ensure_rls` active automatiquement la RLS sur toute nouvelle table : compatible avec les migrations, qui l'activent aussi explicitement. Il n'existe pas dans la répétition locale.

Aucun client réel : la fenêtre B → C est acceptable. La raccourcir reste la meilleure protection.

## 5. Validation fonctionnelle (après C, envois en simulation hors production)

1. Créer un devis web, puis un devis via le parcours WhatsApp simulé : numéros consécutifs `DEV-AAAA-NNN`, compteurs créés.
2. Supprimer le dernier devis brouillon, puis en créer un autre : le numéro supprimé n'est **pas** réattribué.
3. `GET /api/settings` : « Prochain n° » = numéro réellement attribué. Enregistrer une valeur supérieure, puis la vérifier sur le devis suivant ; une valeur inférieure est refusée (409).
4. Transformer un devis signé en facture : la facture a ses propres lignes. Modifier ensuite le devis est refusé (409).
5. Supprimer un client qui a une facture → 409.

## 6. Commandes exactes (à lancer par l'utilisateur, dans PowerShell, à la racine du dépôt)

```powershell
# A2 — PostgreSQL 17 (outils clients + serveur pour la restauration locale)
winget install --id PostgreSQL.PostgreSQL.17 -e
$env:Path += ";C:\Program Files\PostgreSQL\17\bin"
pg_dump --version

# Connexion : backup.ps1 réutilise DATABASE_URL de .env.local (puis .env) sans l'afficher,
# passe automatiquement du mode transaction (6543) au mode session (5432) du pooler,
# ignore les paramètres Prisma et transmet le mot de passe par variables PG* du processus.
# A3 — Test de connexion seul (lecture seule), puis sauvegarde
powershell -ExecutionPolicy Bypass -File scripts\db\backup.ps1 -CheckOnly
powershell -ExecutionPolicy Bypass -File scripts\db\backup.ps1

# Pour les commandes psql ci-dessous (B, C), l'URI doit être dans GESTLY_DB_URL : saisie masquée
# de l'URI « Session pooler » (Supabase → Connect), jamais dans l'historique ni un fichier.
$s = Read-Host "URI Session pooler" -AsSecureString
$env:GESTLY_DB_URL = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($s))
# A4 — Preuve de restaurabilité + répétition sur la copie restaurée (aucune connexion à Supabase)
powershell -ExecutionPolicy Bypass -File scripts\db\verify-backup.ps1 -BackupDir "<dossier affiché par backup.ps1>" -Rehearse

# A5 — Contrôle préalable (lecture seule)
psql $env:GESTLY_DB_URL -X -v ON_ERROR_STOP=1 -f prisma\manual-migrations\20261022_document_numbers_precheck.sql

# B1 — Migrations, une par une (S'ARRÊTER à la première erreur)
psql $env:GESTLY_DB_URL -X -v ON_ERROR_STOP=1 -f prisma\manual-migrations\20261023_document_number_counters_up.sql
psql $env:GESTLY_DB_URL -X -v ON_ERROR_STOP=1 -f prisma\manual-migrations\20261022_unique_document_numbers_up.sql
psql $env:GESTLY_DB_URL -X -v ON_ERROR_STOP=1 -f prisma\manual-migrations\20261022_restrict_accounting_document_deletion_up.sql
psql $env:GESTLY_DB_URL -X -v ON_ERROR_STOP=1 -f prisma\manual-migrations\20261023_freeze_invoice_lines_up.sql

# B2 à B4 — Vérifications
psql $env:GESTLY_DB_URL -X -v ON_ERROR_STOP=1 -f prisma\manual-migrations\20261023_postcheck.sql
psql $env:GESTLY_DB_URL -X -A -t -v ON_ERROR_STOP=1 -f scripts\db\catalog-snapshot.sql -o "$HOME\gestly-backups\snapshot-after.txt"
node scripts\db\compare-schema.mjs "$HOME\gestly-backups\snapshot-after.txt" --expect=after
psql $env:GESTLY_DB_URL -X -v ON_ERROR_STOP=1 -f prisma\manual-migrations\20261023_pg_behaviour_tests.sql

# C2 — Juste après le déploiement de la branche
psql $env:GESTLY_DB_URL -X -v ON_ERROR_STOP=1 -f prisma\manual-migrations\20261023_freeze_invoice_lines_up.sql
psql $env:GESTLY_DB_URL -X -v ON_ERROR_STOP=1 -f prisma\manual-migrations\20261023_postcheck.sql

# Fin de session : effacer l'URI de la mémoire
Remove-Item Env:GESTLY_DB_URL
```

Retour arrière (ordre inverse 4 → 1, uniquement si nécessaire) :

```powershell
psql $env:GESTLY_DB_URL -X -v ON_ERROR_STOP=1 -f prisma\manual-migrations\20261023_freeze_invoice_lines_down.sql
psql $env:GESTLY_DB_URL -X -v ON_ERROR_STOP=1 -f prisma\manual-migrations\20261022_restrict_accounting_document_deletion_down.sql
psql $env:GESTLY_DB_URL -X -v ON_ERROR_STOP=1 -f prisma\manual-migrations\20261022_unique_document_numbers_down.sql
# Compteurs : exporter d'abord, puis forcer en connaissance de cause
psql $env:GESTLY_DB_URL -X -A -f prisma\manual-migrations\20261023_export_counters.sql -o "$HOME\gestly-backups\counters-export.txt"
psql $env:GESTLY_DB_URL -X -v ON_ERROR_STOP=1 -c "SET gestly.confirm_counter_loss = 'oui'" -f prisma\manual-migrations\20261023_document_number_counters_down.sql
```

Après un retour arrière, remettre `schema.prisma` dans son état d'avant la mission 12 : `onDelete: Cascade`, sans `@@unique([userId, number])` ni le modèle `DocumentNumberCounter`. Le code de la branche fonctionne aussi sans la table des compteurs (repli automatique). En dernier recours : `pg_restore` de la sauvegarde.

## 7. Cohérence avec `prisma/schema.prisma`

`schema.prisma` décrit l'**état cible**. Vérification automatique, hors ligne, avec `scripts/db/compare-schema.mjs` sur l'instantané réel du 2026-10-22 :
- **avant** migration, 21 écarts, exactement ceux que corrigent les migrations ;
- **après** les 4 migrations simulées, 0 écart.

La répétition PGlite confirme ce résultat sur un vrai moteur : 0 écart après migration, schéma identique à l'original après retour arrière complet.

Ne sont pas comparés, et c'est volontaire :
- l'index partiel `Notification_userId_dedupeKey_key`, non exprimable en Prisma : **ne jamais utiliser `prisma db push`** ;
- la RLS ;
- la table de suivi `_Backfill20261023FactureLine`, à supprimer avec accord une fois le gel validé ;
- les valeurs par défaut des colonnes.

## 8. D5 — proposition de mécanisme de conservation (NON implémentée)

**Objectif** : la fermeture d'un compte ne détruit jamais des factures ou avoirs soumis à obligation de conservation. Durées couramment citées, **à faire valider par un expert-comptable ou un juriste** : 10 ans pour les pièces comptables (Code de commerce, art. L123-22) et 6 ans pour le droit de contrôle fiscal (LPF, art. L102 B).

Situation actuelle : aucune route ne supprime un compte. Une suppression directe en base effacerait tout en cascade. Après la migration 3, elle **échoue** dès qu'il existe une facture ou un avoir : c'est le premier niveau de protection.

Mécanisme proposé, à valider :
1. **Fermeture plutôt que suppression** : colonne `User.closedAt` (migration à venir) ; un compte fermé n'a plus accès à l'application, son abonnement est résilié, ses documents sont conservés en lecture seule.
2. **Export remis à l'artisan** à la fermeture : archive de ses factures et avoirs (PDF générés par `lib/pdf/generate-document-pdf.ts`), plus un récapitulatif CSV.
3. **Minimisation RGPD** pendant la conservation : suppression ou anonymisation des données non nécessaires à la valeur probante (conversations WhatsApp, notifications, opportunités, agenda), conservation des seules mentions obligatoires des factures.
4. **Purge à l'échéance** (fin de la durée légale validée) : tâche planifiée, jamais automatique sans validation, journalisée.

Décisions attendues : durées exactes, contenu de l'archive, données à anonymiser, qui déclenche la purge.
