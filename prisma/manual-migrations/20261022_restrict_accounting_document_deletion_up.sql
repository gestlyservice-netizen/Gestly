-- ⚠️ PROPOSITION — NE PAS EXÉCUTER sans l'accord explicite de l'utilisateur.
--
-- Aujourd'hui (vérifié le 2026-10-22), supprimer un client OU un compte
-- Gestly supprime EN CASCADE ses factures et ses avoirs : des documents
-- comptables émis, à conserver, dont les numéros redeviennent disponibles.
-- Cette migration remplace ces cascades par RESTRICT : la base refuse toute
-- suppression qui détruirait une facture ou un avoir, quel que soit le
-- chemin (application, SQL manuel, tableau de bord Supabase).
--   - Client → Facture / Avoir : déjà refusé par l'application (HTTP 409) ;
--   - Facture → Avoir : aucune suppression de facture n'existe ;
--   - Compte (User) → Facture / Avoir (décision D5) : la suppression d'un
--     compte qui possède des documents comptables échoue tant qu'une
--     procédure de conservation n'a pas été appliquée (cf. PROGRESS.md,
--     Mission 12 — proposition de mécanisme de conservation, NON implémentée).
--
-- Correspond aux onDelete: Restrict de Facture.user, Facture.client,
-- Avoir.user, Avoir.client et Avoir.facture dans prisma/schema.prisma.
-- Contrôle préalable : 20261022_document_numbers_precheck.sql (noms et
-- règles ON UPDATE actuels des contraintes).

BEGIN;

ALTER TABLE "Facture" DROP CONSTRAINT "Facture_clientId_fkey";
ALTER TABLE "Facture" ADD CONSTRAINT "Facture_clientId_fkey"
  FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Facture" DROP CONSTRAINT "Facture_userId_fkey";
ALTER TABLE "Facture" ADD CONSTRAINT "Facture_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Avoir" DROP CONSTRAINT "Avoir_clientId_fkey";
ALTER TABLE "Avoir" ADD CONSTRAINT "Avoir_clientId_fkey"
  FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Avoir" DROP CONSTRAINT "Avoir_factureId_fkey";
ALTER TABLE "Avoir" ADD CONSTRAINT "Avoir_factureId_fkey"
  FOREIGN KEY ("factureId") REFERENCES "Facture"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Avoir" DROP CONSTRAINT "Avoir_userId_fkey";
ALTER TABLE "Avoir" ADD CONSTRAINT "Avoir_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

COMMIT;
