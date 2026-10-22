-- Retour arrière de 20261023_document_number_counters_up.sql.
-- L'application revient automatiquement au fonctionnement sans compteur
-- (détection de l'absence de la table). Conséquence : le numéro du dernier
-- devis brouillon supprimé pourra de nouveau être réattribué, et « Prochain
-- n° » ne pourra plus être choisi en série annuelle (refus explicite).

BEGIN;

DROP TABLE IF EXISTS "DocumentNumberCounter";

COMMIT;
