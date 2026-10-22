-- Retour arrière de 20261023_document_number_counters_up.sql.
-- L'application revient automatiquement au fonctionnement sans compteur
-- (détection de l'absence de la table). Conséquence : le numéro du dernier
-- devis brouillon supprimé pourra de nouveau être réattribué, et « Prochain
-- n° » ne pourra plus être choisi en série annuelle (refus explicite).
--
-- ⚠️ PERTE D'INFORMATION si la table contient des compteurs : ils sont la
-- seule trace des numéros attribués puis libérés et des « Prochain n° »
-- choisis. Garde-fou : refuse de s'exécuter (aucun effet) si la table n'est
-- pas vide. Exporter d'abord son contenu (SELECT * FROM
-- "DocumentNumberCounter"), puis, dans la même session :
--   SET gestly.confirm_counter_loss = 'oui';

BEGIN;

DO $$
DECLARE
    compteurs integer := 0;
BEGIN
    IF to_regclass('public."DocumentNumberCounter"') IS NOT NULL THEN
        EXECUTE 'SELECT count(*) FROM "DocumentNumberCounter"' INTO compteurs;
    END IF;
    IF compteurs > 0
       AND coalesce(current_setting('gestly.confirm_counter_loss', true), '') <> 'oui' THEN
        RAISE EXCEPTION 'Retour arrière refusé : % compteur(s) de numérotation seraient perdus. Exporter la table, puis SET gestly.confirm_counter_loss = ''oui'' pour forcer.', compteurs;
    END IF;
END $$;

DROP TABLE IF EXISTS "DocumentNumberCounter";

COMMIT;
