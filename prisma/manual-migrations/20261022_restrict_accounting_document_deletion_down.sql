-- Retour arrière de 20261022_restrict_accounting_document_deletion_up.sql :
-- rétablit les suppressions en cascade d'origine (client et compte →
-- factures et avoirs). Remettre aussi onDelete: Cascade dans schema.prisma.

BEGIN;

ALTER TABLE "Facture" DROP CONSTRAINT "Facture_clientId_fkey";
ALTER TABLE "Facture" ADD CONSTRAINT "Facture_clientId_fkey"
  FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Facture" DROP CONSTRAINT "Facture_userId_fkey";
ALTER TABLE "Facture" ADD CONSTRAINT "Facture_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Avoir" DROP CONSTRAINT "Avoir_clientId_fkey";
ALTER TABLE "Avoir" ADD CONSTRAINT "Avoir_clientId_fkey"
  FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Avoir" DROP CONSTRAINT "Avoir_factureId_fkey";
ALTER TABLE "Avoir" ADD CONSTRAINT "Avoir_factureId_fkey"
  FOREIGN KEY ("factureId") REFERENCES "Facture"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Avoir" DROP CONSTRAINT "Avoir_userId_fkey";
ALTER TABLE "Avoir" ADD CONSTRAINT "Avoir_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

COMMIT;
