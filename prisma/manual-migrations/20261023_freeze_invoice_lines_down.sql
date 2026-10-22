-- Retour arrière de 20261023_freeze_invoice_lines_up.sql : supprime
-- UNIQUEMENT les lignes de facture créées par cette migration (tracées),
-- puis la table de traçabilité. Les factures concernées réafficheront les
-- lignes de leur devis, comme avant.
-- ⚠️ À ne pas utiliser si des avoirs totaux ont été émis depuis sur ces
-- factures (ils ont pu copier ces lignes) : vérifier d'abord.

BEGIN;

DELETE FROM "FactureLine"
WHERE "id" IN (SELECT "factureLineId" FROM "_Backfill20261023FactureLine");

DROP TABLE "_Backfill20261023FactureLine";

COMMIT;
