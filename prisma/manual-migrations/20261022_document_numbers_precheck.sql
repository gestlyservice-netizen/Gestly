-- Contrôle préalable (LECTURE SEULE) aux migrations du 2026-10-22 / 2026-10-23 :
--   20261022_unique_document_numbers, 20261022_restrict_accounting_document_deletion,
--   20261023_document_number_counters, 20261023_freeze_invoice_lines.
-- Ne renvoie que des agrégats et des noms de contraintes : aucun numéro,
-- aucune donnée personnelle. Voir le plan d'application (PROGRESS.md, Mission 12).

-- 1. Doublons de numéros (doit valoir 0 partout pour créer les index uniques).
select 'Devis' as table_name, count(*) as documents,
  (select count(*) from (select 1 from "Devis" group by "userId", "number" having count(*) > 1) g) as groupes_en_doublon
from "Devis"
union all
select 'Facture', count(*),
  (select count(*) from (select 1 from "Facture" group by "userId", "number" having count(*) > 1) g)
from "Facture"
union all
select 'Avoir', count(*),
  (select count(*) from (select 1 from "Avoir" group by "userId", "number" having count(*) > 1) g)
from "Avoir";

-- 2. Contraintes visées par la migration RESTRICT : elles doivent toutes
--    exister ; confupdtype doit valoir 'c' (ON UPDATE CASCADE, repris tel quel).
select conname, confdeltype, confupdtype -- 'c' = CASCADE, 'r' = RESTRICT
from pg_constraint
where contype = 'f'
  and conname in ('Facture_clientId_fkey', 'Facture_userId_fkey', 'Avoir_clientId_fkey', 'Avoir_factureId_fkey', 'Avoir_userId_fkey');

-- 3. Objets à créer : doivent être ABSENTS (null).
select to_regclass('public."DocumentNumberCounter"') as table_compteurs,
       to_regclass('public."_Backfill20261023FactureLine"') as table_tracabilite,
       to_regclass('public."Devis_userId_number_key"') as index_devis,
       to_regclass('public."Facture_userId_number_key"') as index_facture,
       to_regclass('public."Avoir_userId_number_key"') as index_avoir;

-- 4. Factures à figer (migration freeze_invoice_lines) : nombre de factures
--    issues d'un devis sans ligne propre, et parmi elles celles dont le devis
--    a été modifié après la facture (à contrôler manuellement avant d'appliquer :
--    seule la date de dernière ligne de devis est comparable).
select count(*) as factures_sans_ligne_propre,
       count(*) filter (where d."status" not in ('facture', 'paye')) as devis_lie_hors_statut_facture
from "Facture" f
join "Devis" d on d."id" = f."devisId"
where not exists (select 1 from "FactureLine" fl where fl."factureId" = f."id");

-- 5. Comptes possédant des factures ou avoirs (impossibles à supprimer après RESTRICT).
select count(distinct "userId") as comptes_avec_documents_comptables
from (select "userId" from "Facture" union all select "userId" from "Avoir") d;
