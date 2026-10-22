-- Export (LECTURE SEULE) des compteurs de numérotation, à conserver AVANT
-- tout retour arrière de 20261023_document_number_counters (cf. plan, §6).
-- Fichier dédié : sous Windows PowerShell 5.1, les guillemets doubles d'un
-- argument -c sont mal transmis à psql.
SELECT "userId", "kind", "series", "nextValue", "updatedAt"
FROM "DocumentNumberCounter"
ORDER BY "userId", "kind", "series";
