-- =====================================================================
-- DB security hardening — pre-prod
-- =====================================================================
-- Hoy todas las tablas de public:
--   - tienen rowsecurity=false (RLS apagado)
--   - dan SELECT/INSERT/UPDATE/DELETE/TRUNCATE/REFERENCES a anon y authenticated
-- Eso significa que si alguien encuentra el endpoint de Supabase REST/GraphQL
-- (https://qoeigqytlyjnpvxacrht.supabase.co/rest/v1/conversations) y un anon
-- key, puede leer y mutar TODO. Hoy nada de la app usa esos roles —
-- server.mjs y n8n se conectan via pooler con el rol postgres (superuser),
-- que bypasea RLS y permisos. Asi que blindar anon + authenticated NO
-- afecta operacion.
--
-- Esto es defensa en profundidad: si maniana se expone Supabase REST por
-- accidente, no hay datos accesibles.
-- =====================================================================

-- 1) Revocar TODO acceso a anon y authenticated en las tablas de public.
--    Si en el futuro queremos exponer alguna tabla read-only via Supabase
--    REST, se vuelve a granted explicitamente.
DO $$
DECLARE
  t text;
BEGIN
  FOR t IN
    SELECT tablename FROM pg_tables WHERE schemaname='public'
  LOOP
    EXECUTE format('REVOKE ALL ON public.%I FROM anon CASCADE', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM authenticated CASCADE', t);
  END LOOP;
END $$;

-- 2) Habilitar RLS en todas las tablas de public.
--    El rol postgres (superuser) bypasea RLS, asi que el bot sigue
--    funcionando sin cambios. service_role tambien bypasea por default
--    de Supabase.
DO $$
DECLARE
  t text;
BEGIN
  FOR t IN
    SELECT tablename FROM pg_tables WHERE schemaname='public'
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
  END LOOP;
END $$;

-- 3) Politica explicita "service_role only" en cada tabla.
--    Si alguna conexion futura entra como anon/authenticated, no ve nada.
--    service_role sigue con acceso completo.
DO $$
DECLARE
  t text;
BEGIN
  FOR t IN
    SELECT tablename FROM pg_tables WHERE schemaname='public'
  LOOP
    -- Drop existing policies con el mismo nombre por idempotencia
    EXECUTE format('DROP POLICY IF EXISTS service_only ON public.%I', t);
    EXECUTE format('CREATE POLICY service_only ON public.%I FOR ALL TO service_role USING (true) WITH CHECK (true)', t);
  END LOOP;
END $$;
