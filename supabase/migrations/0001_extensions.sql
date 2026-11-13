-- 0001_extensions.sql : extensions FacilitiesManagement needs.
-- pgcrypto  : gen_random_uuid(), gen_random_bytes() for public tokens
-- btree_gist: lets an exclusion constraint mix uuid (=) with daterange (&&) so a truck
--             cannot be booked twice for overlapping dates
-- pg_trgm   : fast "contains" search on names, phone numbers and registration numbers
-- pg_cron   : scheduled jobs (migration 0019)
-- pg_net    : lets those jobs call the send-notification Edge Function
--
-- Supabase keeps extensions in the "extensions" schema. pg_cron must live in its own
-- schema and is created without one. If your project blocks CREATE EXTENSION, enable
-- pg_cron and pg_net in Dashboard > Database > Extensions and run this file again.

create schema if not exists extensions;

create extension if not exists pgcrypto with schema extensions;
create extension if not exists btree_gist with schema extensions;
create extension if not exists pg_trgm with schema extensions;

do $$
begin
  begin
    create extension if not exists pg_cron;
  exception when others then
    raise notice 'pg_cron not created (%). Enable it in Dashboard > Database > Extensions, then re-run 0019_cron_jobs.sql.', sqlerrm;
  end;
  begin
    create extension if not exists pg_net with schema extensions;
  exception when others then
    raise notice 'pg_net not created (%). Enable it in Dashboard > Database > Extensions, then re-run 0019_cron_jobs.sql.', sqlerrm;
  end;
end $$;

-- gen_random_uuid() is in pg_catalog from PostgreSQL 13 on, and gen_random_bytes()
-- comes from pgcrypto. Make sure both resolve from the default search_path, which is
-- what column DEFAULTs in later migrations rely on.
do $$
begin
  perform gen_random_uuid();
exception when undefined_function then
  raise exception 'gen_random_uuid() is unavailable. Install pgcrypto or use PostgreSQL 13+.';
end $$;

grant usage on schema extensions to public;
