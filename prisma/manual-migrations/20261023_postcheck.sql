-- Contrôle APRÈS application des migrations 1 à 4 (LECTURE SEULE).
-- Échoue (RAISE EXCEPTION) au premier écart ; affiche « POSTCHECK OK » sinon.
-- Ne renvoie aucun numéro ni aucune donnée personnelle.
--   1. 20261023_document_number_counters
--   2. 20261022_unique_document_numbers
--   3. 20261022_restrict_accounting_document_deletion
--   4. 20261023_freeze_invoice_lines

DO $$
DECLARE
    n integer;
BEGIN
    -- Migration 1 : table des compteurs, index unique, clé étrangère, RLS.
    IF to_regclass('public."DocumentNumberCounter"') IS NULL THEN
        RAISE EXCEPTION 'POSTCHECK 1 : table DocumentNumberCounter absente';
    END IF;
    IF to_regclass('public."DocumentNumberCounter_userId_kind_series_key"') IS NULL THEN
        RAISE EXCEPTION 'POSTCHECK 1 : index DocumentNumberCounter_userId_kind_series_key absent';
    END IF;
    SELECT count(*) INTO n FROM pg_constraint
    WHERE conname = 'DocumentNumberCounter_userId_fkey' AND confdeltype = 'c';
    IF n <> 1 THEN RAISE EXCEPTION 'POSTCHECK 1 : clé étrangère des compteurs absente ou incorrecte'; END IF;
    SELECT count(*) INTO n FROM pg_class
    WHERE oid = 'public."DocumentNumberCounter"'::regclass AND relrowsecurity;
    IF n <> 1 THEN RAISE EXCEPTION 'POSTCHECK 1 : RLS non activée sur DocumentNumberCounter'; END IF;

    -- Migration 2 : 3 index uniques (userId, number).
    SELECT count(*) INTO n FROM pg_index ix JOIN pg_class i ON i.oid = ix.indexrelid
    WHERE ix.indisunique AND ix.indisvalid
      AND i.relname IN ('Devis_userId_number_key', 'Facture_userId_number_key', 'Avoir_userId_number_key');
    IF n <> 3 THEN RAISE EXCEPTION 'POSTCHECK 2 : % index unique(s) valide(s) sur 3', n; END IF;

    -- Migration 3 : 5 clés étrangères en RESTRICT, ON UPDATE CASCADE conservé.
    SELECT count(*) INTO n FROM pg_constraint
    WHERE contype = 'f' AND confdeltype = 'r' AND confupdtype = 'c'
      AND conname IN ('Facture_clientId_fkey', 'Facture_userId_fkey', 'Avoir_clientId_fkey', 'Avoir_factureId_fkey', 'Avoir_userId_fkey');
    IF n <> 5 THEN RAISE EXCEPTION 'POSTCHECK 3 : % clé(s) étrangère(s) en RESTRICT sur 5', n; END IF;

    -- Migration 4 : plus aucune facture issue d'un devis sans ligne propre.
    SELECT count(*) INTO n FROM "Facture" f
    WHERE f."devisId" IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM "FactureLine" fl WHERE fl."factureId" = f."id")
      AND EXISTS (SELECT 1 FROM "DevisLine" dl WHERE dl."devisId" = f."devisId");
    IF n <> 0 THEN RAISE EXCEPTION 'POSTCHECK 4 : % facture(s) issue(s) d''un devis encore sans ligne propre', n; END IF;
    IF to_regclass('public."_Backfill20261023FactureLine"') IS NULL THEN
        RAISE EXCEPTION 'POSTCHECK 4 : table de traçabilité absente';
    END IF;

    -- Les données existantes n'ont pas disparu.
    SELECT count(*) INTO n FROM "Facture" f
    WHERE NOT EXISTS (SELECT 1 FROM "FactureLine" fl WHERE fl."factureId" = f."id");
    RAISE NOTICE 'POSTCHECK OK — factures sans ligne propre (sans devis ou devis sans ligne) : %', n;
END $$;

-- Récapitulatif (agrégats seulement), à comparer avec le relevé d'avant migration.
SELECT (SELECT count(*) FROM "Devis") AS devis,
       (SELECT count(*) FROM "DevisLine") AS lignes_devis,
       (SELECT count(*) FROM "Facture") AS factures,
       (SELECT count(*) FROM "FactureLine") AS lignes_factures,
       (SELECT count(*) FROM "_Backfill20261023FactureLine") AS lignes_figees_tracees,
       (SELECT count(*) FROM "Avoir") AS avoirs,
       (SELECT count(*) FROM "DocumentNumberCounter") AS compteurs;
