-- Retour arrière de 20261109_rate_limit_bucket_up.sql.
-- L'application revient automatiquement à la limite en mémoire (détection de
-- l'absence de la table par to_regclass, revérifiée toutes les 5 minutes).
-- Aucune perte d'information utile : la table ne contient que des compteurs
-- temporaires (fenêtres de 10 minutes à 1 heure).
-- Si schema.prisma contient déjà le modèle RateLimitBucket, le retirer
-- ensuite et relancer `prisma generate`.

BEGIN;

DROP TABLE IF EXISTS "RateLimitBucket";

COMMIT;
