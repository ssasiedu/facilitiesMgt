-- 0018_realtime.sql : live updates for the dashboard, job boards, notification bell and the zonal board.
do $$
declare t text;
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
  foreach t in array array['job_orders','in_app_notifications','tasks','task_comments','task_checkins','trucks','payments','invoices'] loop
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;
-- Realtime respects RLS: each subscriber only receives rows its policies allow.
