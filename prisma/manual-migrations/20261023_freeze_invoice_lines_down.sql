-- Retour arrière de 20261023_freeze_invoice_lines_up.sql : supprime
-- UNIQUEMENT les lignes de facture créées par cette migration (tracées),
-- puis la table de traçabilité. Les factures concernées réafficheront les
-- lignes de leur devis, comme avant.
--
-- Garde-fou : refuse de s'exécuter (aucun effet) si un avoir a été émis,
-- après le gel, sur une facture figée (il a été calculé à partir de ces
-- lignes). Pour passer outre en connaissance de cause, exécuter d'abord,
-- dans la même session :  SET gestly.confirm_freeze_rollback = 'oui';

BEGIN;

DO $$
DECLARE
    avoirs_apres_gel integer;
BEGIN
    SELECT count(*) INTO avoirs_apres_gel
    FROM "Avoir" a
    JOIN (SELECT "factureId", min("backfilledAt") AS gel
          FROM "_Backfill20261023FactureLine" GROUP BY "factureId") b ON b."factureId" = a."factureId"
    WHERE a."createdAt" >= b.gel;

    IF avoirs_apres_gel > 0
       AND coalesce(current_setting('gestly.confirm_freeze_rollback', true), '') <> 'oui' THEN
        RAISE EXCEPTION 'Retour arrière refusé : % avoir(s) émis après le gel sur des factures figées. Vérifier, puis SET gestly.confirm_freeze_rollback = ''oui'' pour forcer.', avoirs_apres_gel;
    END IF;
END $$;

DELETE FROM "FactureLine"
WHERE "id" IN (SELECT "factureLineId" FROM "_Backfill20261023FactureLine");

DROP TABLE "_Backfill20261023FactureLine";

COMMIT;
