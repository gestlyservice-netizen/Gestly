-- ⚠️ PROPOSITION — NE PAS EXÉCUTER sans l'accord explicite de l'utilisateur.
--
-- Aujourd'hui (vérifié le 2026-10-22), supprimer un client supprime EN
-- CASCADE ses factures et ses avoirs : des documents comptables émis, à
-- conserver, dont les numéros redeviennent disponibles. L'application refuse
-- désormais cette suppression (app/api/clients/[id]/route.ts, HTTP 409) ;
-- cette migration ajoute la même protection au niveau base (RESTRICT),
-- valable pour tout chemin d'écriture.
--
-- Non modifié volontairement : la suppression d'un COMPTE Gestly (User)
-- reste en cascade — décision métier à prendre (durée de conservation des
-- documents d'un artisan qui quitte le service).
--
-- Après application : remplacer onDelete: Cascade par onDelete: Restrict
-- sur Facture.client, Avoir.client et Avoir.facture dans prisma/schema.prisma,
-- puis `prisma generate`.

BEGIN;

ALTER TABLE "Facture" DROP CONSTRAINT "Facture_clientId_fkey";
ALTER TABLE "Facture" ADD CONSTRAINT "Facture_clientId_fkey"
  FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Avoir" DROP CONSTRAINT "Avoir_clientId_fkey";
ALTER TABLE "Avoir" ADD CONSTRAINT "Avoir_clientId_fkey"
  FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Avoir" DROP CONSTRAINT "Avoir_factureId_fkey";
ALTER TABLE "Avoir" ADD CONSTRAINT "Avoir_factureId_fkey"
  FOREIGN KEY ("factureId") REFERENCES "Facture"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

COMMIT;
