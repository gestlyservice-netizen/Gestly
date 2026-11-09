-- ⚠️ PROPOSITION — NE PAS EXÉCUTER sans l'accord explicite de l'utilisateur.
--
-- Limitation de débit PARTAGÉE entre toutes les instances Vercel
-- (lib/rate-limit-db.ts) : un compteur par clé (ex. « document-email:devis:<id> »,
-- « document-email:account:<userId> ») et par fenêtre de temps.
-- Chaque passage est UNE requête atomique (INSERT … ON CONFLICT DO UPDATE …
-- RETURNING) : deux instances simultanées ne peuvent pas dépasser la limite.
-- Correspondra au modèle RateLimitBucket de prisma/schema.prisma (à ajouter
-- APRÈS application : DDL généré par `prisma migrate diff`, 0 écart attendu).
--
-- Aucune donnée existante n'est lue ni modifiée. Table de travail, sans
-- donnée personnelle (clés = identifiants techniques), purgée chaque jour par
-- le cron /api/relances/check (lignes expirées depuis plus d'un jour).
-- Tant que cette table n'existe pas, l'application détecte son absence
-- (to_regclass) et garde la limite en mémoire actuelle : le code peut être
-- déployé avant cette migration.
--
-- Supabase : RLS activée sans aucune politique et droits retirés aux rôles
-- de l'API publique (anon, authenticated) : table invisible depuis
-- /rest/v1. L'application y accède avec le rôle propriétaire (Prisma).

BEGIN;

CREATE TABLE "RateLimitBucket" (
    "key" TEXT NOT NULL,
    "count" INTEGER NOT NULL,
    "windowStart" TIMESTAMP(3) NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RateLimitBucket_pkey" PRIMARY KEY ("key")
);

CREATE INDEX "RateLimitBucket_expiresAt_idx" ON "RateLimitBucket"("expiresAt");

ALTER TABLE "RateLimitBucket" ENABLE ROW LEVEL SECURITY;

-- Rôles propres à Supabase : absents d'un PostgreSQL local de recette.
DO $$
DECLARE
    role_name text;
BEGIN
    FOREACH role_name IN ARRAY ARRAY['anon', 'authenticated'] LOOP
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
            EXECUTE format('REVOKE ALL ON TABLE "RateLimitBucket" FROM %I', role_name);
        END IF;
    END LOOP;
END $$;

COMMIT;
