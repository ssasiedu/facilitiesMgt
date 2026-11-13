-- 0019_cron_jobs.sql : scheduled jobs (Africa/Accra = UTC, so cron times are local times).
-- Before the outbox job can deliver, store the Edge Function URL and cron secret in Vault (README step 10):
--   select vault.create_secret('https://<project-ref>.supabase.co/functions/v1/send-notification', 'send_notification_url');
--   select vault.create_secret('<same value as the CRON_SECRET function secret>', 'cron_secret');

create or replace function public.cron_expr(p_hhmm text) returns text language sql immutable as $$
  select (split_part(p_hhmm, ':', 2)::int)::text || ' ' || (split_part(p_hhmm, ':', 1)::int)::text || ' * * *'
$$;

-- (Re)create every job from company_settings.cron_times. Super Admin can call it after changing the times.
create or replace function public.schedule_app_jobs() returns jsonb
language plpgsql security definer set search_path = public as $$
declare t jsonb; v_out jsonb := '{}'::jsonb;
begin
  if auth.uid() is not null then perform public.require_role(array['super_admin']); end if;
  if to_regnamespace('cron') is null or to_regprocedure('cron.schedule(text,text,text)') is null then
    raise notice 'pg_cron is not enabled; enable it and run: select public.schedule_app_jobs();';
    return jsonb_build_object('scheduled', false);
  end if;
  select cron_times into t from public.company_settings where id = 1;
  t := coalesce(t, '{}'::jsonb);
  perform cron.schedule('fm-process-outbox', '* * * * *', 'select public.job_process_outbox()');
  perform cron.schedule('fm-service-today', public.cron_expr(coalesce(t->>'service_today', '06:30')), 'select public.job_service_today()');
  perform cron.schedule('fm-recurring-billing', public.cron_expr(coalesce(t->>'recurring_billing', '07:00')), 'select public.generate_recurring_invoices()');
  perform cron.schedule('fm-morning-alerts', public.cron_expr(coalesce(t->>'morning_alerts', '08:00')), 'select public.job_morning_alerts()');
  perform cron.schedule('fm-zonal-reminder', public.cron_expr(coalesce(t->>'zonal_reminder', '17:00')), 'select public.job_zonal_reminder()');
  perform cron.schedule('fm-evening', public.cron_expr(coalesce(t->>'evening', '18:00')), 'select public.job_day_before_reminders(); select public.job_zonal_summary()');
  perform cron.schedule('fm-nightly', public.cron_expr(coalesce(t->>'nightly', '01:00')), 'select public.job_nightly()');
  return jsonb_build_object('scheduled', true, 'times', t);
end $$;
grant execute on function public.schedule_app_jobs to authenticated;

do $$
begin
  if not exists (select 1 from public.company_settings where id = 1) then insert into public.company_settings (id) values (1); end if;
  perform public.schedule_app_jobs();
end $$;
