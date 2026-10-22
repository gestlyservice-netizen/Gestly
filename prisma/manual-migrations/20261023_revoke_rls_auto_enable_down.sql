-- Retour arrière de 20261023_revoke_rls_auto_enable_up.sql : droits d'origine
-- (relevés le 2026-10-23 : PUBLIC, anon, authenticated, service_role).
BEGIN;
GRANT EXECUTE ON FUNCTION public.rls_auto_enable() TO PUBLIC, anon, authenticated, service_role;
COMMIT;
