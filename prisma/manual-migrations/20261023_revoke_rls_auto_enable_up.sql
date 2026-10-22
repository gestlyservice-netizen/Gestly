-- Avis Supabase « Public Can Execute SECURITY DEFINER Function » sur
-- public.rls_auto_enable() (fonction du déclencheur d'événement ensure_rls,
-- qui active la RLS sur toute nouvelle table).
-- Risque réel nul : la fonction renvoie event_trigger, PostgreSQL refuse donc
-- tout appel direct (y compris /rest/v1/rpc). Correction d'hygiène : seul
-- postgres conserve EXECUTE. Le déclencheur ensure_rls n'est pas affecté
-- (EXECUTE n'est pas vérifié au déclenchement d'un event trigger).
-- Retour arrière : 20261023_revoke_rls_auto_enable_down.sql.
BEGIN;
REVOKE EXECUTE ON FUNCTION public.rls_auto_enable() FROM PUBLIC, anon, authenticated, service_role;
COMMIT;
