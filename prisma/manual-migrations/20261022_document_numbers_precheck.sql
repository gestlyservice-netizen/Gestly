-- Contrôle préalable (LECTURE SEULE) aux migrations 20261022_unique_document_numbers
-- et 20261022_restrict_accounting_document_deletion.
-- Ne renvoie que des agrégats : aucun numéro, aucune donnée personnelle.
-- Les index uniques ne peuvent être créés que si "groupes_en_doublon" = 0 partout.
--
-- Résultat observé le 2026-10-22 (projet ixaxfhitplhynhpihojx) :
--   Devis 8 / 0 doublon, Facture 5 / 0 doublon, Avoir 0 / 0 doublon ;
--   FK Facture_clientId_fkey, Avoir_clientId_fkey, Avoir_factureId_fkey : CASCADE.

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

-- confupdtype doit valoir 'c' (ON UPDATE CASCADE, valeur Prisma par défaut),
-- règle reprise telle quelle par 20261022_restrict_accounting_document_deletion
-- (non vérifié le 2026-10-22 : à confirmer avant application).
select conname, confdeltype, confupdtype -- 'c' = CASCADE, 'r' = RESTRICT
from pg_constraint
where contype = 'f' and conname in ('Facture_clientId_fkey', 'Avoir_clientId_fkey', 'Avoir_factureId_fkey');
