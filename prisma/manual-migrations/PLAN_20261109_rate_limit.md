# Plan — limitation de débit partagée (`RateLimitBucket`)

**État : préparé, NON appliqué.** Toute étape marquée 🔒 exige l'accord explicite de l'utilisateur.

## Objet

Remplacer la limite d'envoi en mémoire (une par instance Vercel, remise à zéro à chaque démarrage) par un compteur dans la base PostgreSQL existante, **commun à toutes les instances**, sans service supplémentaire.

- Table `RateLimitBucket(key, count, windowStart, expiresAt)`, clé primaire `key`, index sur `expiresAt`.
- Une requête atomique par passage : `INSERT … ON CONFLICT ("key") DO UPDATE … RETURNING "count"`. PostgreSQL verrouille la ligne : N requêtes simultanées reçoivent les compteurs 1…N, jamais de dépassement.
- Horloge de la base (`now()`), commune à toutes les instances.
- Purge quotidienne par le cron existant `/api/relances/check` (compteurs expirés depuis plus d'un jour).
- Sécurité Supabase : RLS activée sans politique, droits retirés à `anon` et `authenticated`. Table invisible depuis l'API publique ; Prisma y accède avec le rôle propriétaire.
- Aucune donnée personnelle : les clés sont des identifiants techniques (`document-email:devis:<id>`, `document-email:account:<userId>`).

## Fichiers

| Fichier | Rôle |
|---|---|
| `20261109_rate_limit_bucket_up.sql` | Création (DDL identique à `prisma migrate diff` pour le futur modèle), RLS, révocations |
| `20261109_rate_limit_bucket_down.sql` | Retour arrière (`DROP TABLE IF EXISTS`) : aucune perte utile, compteurs temporaires |
| `lib/rate-limit-db.ts` | `consumeRateLimit`, `purgeExpiredRateLimits` ; repli en mémoire si la table est absente |
| `lib/documents/document-email-limit.ts` | Limites des emails de devis et factures (3 / 10 min par document, 50 / h par compte) |

## Preuves (locales, avant toute application)

- **Répétition sur PostgreSQL 17 local** (`scripts/recette/m15-email-local.ps1`) : up → down → up sans erreur, présence de la table vérifiée après chaque étape.
- **`tests/recette/rate-limit.recette.ts`, 6 sur 6** :
  - L1 : RLS activée et 2 index ;
  - L2 : 30 requêtes simultanées depuis 3 instances (pools distincts) → exactement 3 acceptées, compteur final à 30 ;
  - L3 (témoin) : l'ancienne limite en mémoire en accepte 9 ;
  - L4 : fin de fenêtre respectée ;
  - L5 : la purge ne supprime que les compteurs expirés ;
  - L6 : 6 envois simultanés du même devis depuis 6 instances → 3 acceptés.
- **`lib/rate-limit-db.test.ts`, 10 sur 10** : requête paramétrée, repli en mémoire (table absente, base indisponible, table supprimée), purge.

## Ordre de déploiement

Le code détecte l'absence de la table (`to_regclass`, revérifiée toutes les 5 minutes) et garde alors la limite en mémoire. **Le code peut donc partir avant la migration**, et la limite partagée s'active seule après la migration, sans redéploiement.

1. 🔒 **Push et déploiement du code** (branche `fix/m15-envoi-email`). Effet immédiat : aucun changement de comportement (limite en mémoire), un avertissement Sentry unique par instance (« table RateLimitBucket absente »).
2. 🔒 **Sauvegarde** : `scripts/db/backup.ps1`, puis `scripts/db/verify-backup.ps1` (restauration prouvée).
3. 🔒 **Application** de `20261109_rate_limit_bucket_up.sql` sur Supabase (psql vers le pooler, comme `apply-migrations.ps1`). Opération rapide, sans verrou sur les tables existantes (création d'une table vide).
4. **Contrôles (lecture seule)** :
   - `SELECT relrowsecurity FROM pg_class WHERE oid = to_regclass('public."RateLimitBucket"')` doit renvoyer `true` ;
   - avis de sécurité Supabase sans nouvelle alerte ;
   - au premier envoi de document, une ligne doit apparaître dans `RateLimitBucket`.
5. **Après application** : ajouter à `prisma/schema.prisma` le modèle ci-dessous, `prisma generate`, puis `scripts/db/compare-schema.mjs` (0 écart attendu). Commit séparé.

```prisma
model RateLimitBucket {
  key         String   @id
  count       Int
  windowStart DateTime
  expiresAt   DateTime

  @@index([expiresAt])
}
```

## Retour arrière

🔒 `20261109_rate_limit_bucket_down.sql`. L'application revient seule à la limite en mémoire en 5 minutes au plus, sans redéploiement. Retirer ensuite le modèle de `schema.prisma` s'il avait été ajouté.

## Risques et limites

- **Charge** : 2 requêtes courtes par envoi d'email (document, puis compte) et 1 vérification de la table toutes les 5 minutes par instance. Négligeable au volume actuel.
- **Base indisponible** : repli en mémoire (signalé une fois dans les journaux et Sentry). L'envoi échouerait de toute façon, puisque le document doit être lu en base.
- **Fenêtre fixe**, pas glissante : jusqu'à 2 × la limite autour d'une fin de fenêtre (comportement identique à l'actuel).
