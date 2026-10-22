-- Retour arrière de 20261022_unique_document_numbers_up.sql.
-- Retirer aussi @@unique([userId, number]) de prisma/schema.prisma si ajouté.

BEGIN;

DROP INDEX IF EXISTS "Devis_userId_number_key";
DROP INDEX IF EXISTS "Facture_userId_number_key";
DROP INDEX IF EXISTS "Avoir_userId_number_key";

COMMIT;
