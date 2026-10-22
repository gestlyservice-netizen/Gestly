-- ⚠️ PROPOSITION — NE PAS EXÉCUTER sans l'accord explicite de l'utilisateur.
--
-- Compteurs de numérotation (décisions D1 et D4) : un compteur par
-- (artisan, type de document, série). Garantit qu'un numéro attribué n'est
-- jamais réattribué, même si le document (devis brouillon) est supprimé, et
-- porte le « Prochain n° » d'une série annuelle (la série, ex. "DEV-2026-",
-- fait partie de la clé : chaque année démarre un nouveau compteur).
-- Correspond au modèle DocumentNumberCounter de prisma/schema.prisma.
--
-- Aucune donnée existante n'est modifiée. Pas d'initialisation nécessaire :
-- l'application calcule max(plus grand numéro existant + 1, compteur), et
-- crée chaque compteur au premier numéro attribué.
-- Tant que cette table n'existe pas, l'application détecte son absence
-- (to_regclass) et ne l'utilise pas.

BEGIN;

CREATE TABLE "DocumentNumberCounter" (
    "id"        TEXT NOT NULL,
    "userId"    TEXT NOT NULL,
    "kind"      TEXT NOT NULL,
    "series"    TEXT NOT NULL,
    "nextValue" INTEGER NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "DocumentNumberCounter_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "DocumentNumberCounter_userId_kind_series_key"
    ON "DocumentNumberCounter" ("userId", "kind", "series");

ALTER TABLE "DocumentNumberCounter"
    ADD CONSTRAINT "DocumentNumberCounter_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Même politique que les 22 autres tables : RLS activée sans politique
-- (aucun accès via l'API publique Supabase ; Prisma utilise le rôle
-- propriétaire).
ALTER TABLE "DocumentNumberCounter" ENABLE ROW LEVEL SECURITY;

COMMIT;
