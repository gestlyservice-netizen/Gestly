-- ⚠️ PROPOSITION — NE PAS EXÉCUTER sans l'accord explicite de l'utilisateur.
--
-- Garantie d'unicité des numéros au niveau PostgreSQL : un numéro de devis,
-- de facture ou d'avoir n'existe qu'une fois par artisan, quel que soit le
-- chemin d'écriture (code applicatif, futur code, SQL manuel).
-- Complète (sans le remplacer) le verrou consultatif de
-- lib/numbering/document-number.ts, qui évite les collisions en amont.
--
-- Prérequis : 20261022_document_numbers_precheck.sql renvoie 0 doublon
-- (vérifié le 2026-10-22).
--
-- Tables de faible volume : création non concurrente, dans une transaction
-- (un échec n'applique rien). Pour une table volumineuse, préférer
-- CREATE UNIQUE INDEX CONCURRENTLY, HORS transaction.
--
-- Après application : ajouter @@unique([userId, number]) aux modèles Devis,
-- Facture et Avoir de prisma/schema.prisma, puis `prisma generate` (jamais
-- `prisma db push`, cf. CLAUDE.md).

BEGIN;

CREATE UNIQUE INDEX "Devis_userId_number_key" ON "Devis" ("userId", "number");
CREATE UNIQUE INDEX "Facture_userId_number_key" ON "Facture" ("userId", "number");
CREATE UNIQUE INDEX "Avoir_userId_number_key" ON "Avoir" ("userId", "number");

COMMIT;
