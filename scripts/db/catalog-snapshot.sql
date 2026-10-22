-- Instantané du schéma public (LECTURE SEULE, catalogue uniquement, aucune
-- donnée) au format attendu par scripts/db/compare-schema.mjs :
--   C|table|colonne|type|nullable   I|table|index|unique|colonnes|prédicat
--   F|table|contrainte|colonnes|table_référencée|on_delete|on_update
-- Exécution : éditeur SQL Supabase, ou psql (sortie brute, une ligne par élément) :
--   psql "$env:GESTLY_DB_URL" -X -A -t -f scripts/db/catalog-snapshot.sql -o snapshot.txt
SELECT l FROM (
  SELECT 'C|' || table_name || '|' || column_name || '|' || udt_name || '|' || is_nullable AS l
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name NOT LIKE '\_%'
  UNION ALL
  SELECT 'I|' || t.relname || '|' || i.relname || '|' || ix.indisunique::text || '|'
         || (SELECT string_agg(a.attname::text, ',' ORDER BY k.ord)
             FROM unnest(ix.indkey) WITH ORDINALITY k(attnum, ord)
             JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = k.attnum)
         || '|' || coalesce(pg_get_expr(ix.indpred, t.oid), '')
  FROM pg_index ix
  JOIN pg_class i ON i.oid = ix.indexrelid
  JOIN pg_class t ON t.oid = ix.indrelid
  WHERE t.relnamespace = 'public'::regnamespace AND NOT ix.indisprimary AND t.relname NOT LIKE '\_%'
  UNION ALL
  SELECT 'F|' || replace(conrelid::regclass::text, '"', '') || '|' || conname::text || '|'
         || (SELECT string_agg(a.attname::text, ',') FROM pg_attribute a
             WHERE a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey))
         || '|' || replace(confrelid::regclass::text, '"', '') || '|' || confdeltype::text || '|' || confupdtype::text
  FROM pg_constraint c
  WHERE contype = 'f' AND connamespace = 'public'::regnamespace
) s
ORDER BY l;
