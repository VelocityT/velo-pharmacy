-- ══════════════════════════════════════════════════════════════
--  SUPABASE HARDENING — run once per Supabase project, right after
--  the first `prisma migrate deploy`.
--
--  WHY THIS EXISTS
--  Supabase ships default privileges that grant ALL on every new
--  table in `public` to the `anon` and `authenticated` roles. Prisma
--  creates its tables in `public`, so they silently inherit that —
--  and the anon key is public by design (it ships in frontends and
--  is printed in the dashboard).
--
--  Measured on a real project before this ran: `anon` held SELECT,
--  INSERT, UPDATE, DELETE and TRUNCATE on all 44 tables, with RLS
--  off. That is every patient name, prescription, Schedule H1 entry,
--  narcotic register row and password hash readable — and the tables
--  droppable — by anyone holding a key that is not a secret.
--
--  WHY IT IS SAFE
--  This app never uses PostgREST or supabase-js. Prisma connects as
--  `postgres`, which owns every table and has rolbypassrls = true.
--  Enabling RLS and revoking anon grants cannot affect it. Verified:
--  billing, stock ledger and balance reads all continued to work.
--
--  Prisma does not track RLS or grants during introspection, so this
--  will NOT show up as schema drift on the next `migrate dev`.
-- ══════════════════════════════════════════════════════════════

-- 1. RLS on everything. No policies = deny-all for non-bypass roles.
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN
    SELECT c.relname
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'r'
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', r.relname);
  END LOOP;
END $$;

-- 2. Remove the grants that already exist.
--    service_role is left intact — its key is a server-side secret,
--    never shipped to a browser.
REVOKE ALL ON ALL TABLES    IN SCHEMA public FROM anon, authenticated;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon, authenticated;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM anon, authenticated;
REVOKE USAGE ON SCHEMA public FROM anon, authenticated;

-- 3. Stop the NEXT migration from re-granting on newly created tables.
--    Without this, step 2 is undone the first time you add a model.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL ON TABLES    FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL ON SEQUENCES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL ON FUNCTIONS FROM anon, authenticated;

-- ── Verify (expect: 44 / 44 / 0 / false / false) ──────────────
-- SELECT
--   (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
--      WHERE n.nspname='public' AND c.relkind='r' AND c.relrowsecurity) AS rls_on,
--   (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
--      WHERE n.nspname='public' AND c.relkind='r') AS total,
--   (SELECT count(*) FROM information_schema.role_table_grants
--      WHERE table_schema='public' AND grantee IN ('anon','authenticated')) AS grants_left,
--   has_table_privilege('anon','public.patients','SELECT')          AS anon_patients,
--   has_table_privilege('anon','public.narcotic_register','SELECT') AS anon_narcotics;
