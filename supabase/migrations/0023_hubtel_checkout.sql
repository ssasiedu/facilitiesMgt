-- 0023: make Hubtel the way customers pay an invoice online.
--
-- Hubtel's Online Checkout callback carries no signature, and Hubtel's own documentation leaves
-- securing the webhook to the integrator. Their transaction-status API would settle it, but that
-- API only accepts requests from an IP address allow-listed with Hubtel, and an Edge Function has
-- no fixed outbound IP. So the callback is trusted on three things of our own instead:
--
--   1. a secret handed to Hubtel in the callback URL at checkout and held only here,
--   2. a client reference that must match a session we opened and have not yet settled,
--   3. an amount that must equal, to the pesewa, what that session was opened for.
--
-- Where the status API does answer, it is used as well, and which checks passed is recorded.

alter table public.payment_sessions
  add column if not exists callback_token text,
  add column if not exists verified_by    text,
  add column if not exists provider_ref   text,
  add column if not exists failure_reason text;

comment on column public.payment_sessions.callback_token is
  'Secret put in the callback URL given to the provider. A callback without it is refused.';
comment on column public.payment_sessions.verified_by is
  'How the callback was trusted: token+amount, or status_api when Hubtel also confirmed it.';
comment on column public.payment_sessions.provider_ref is 'The provider''s own id for the transaction.';

-- A token is only ever compared, never looked up, so an index would buy nothing.
create index if not exists payment_sessions_status_idx on public.payment_sessions (status, created_at desc);

/* A session nobody completed is not evidence of anything after a few hours, and leaving it open
   would let a late callback settle an invoice whose balance has since changed. */
create or replace function public.expire_stale_payment_sessions() returns integer
language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  update public.payment_sessions
  set status = 'expired', failure_reason = 'No response from the payment provider within 6 hours'
  where status = 'pending' and created_at < now() - interval '6 hours';
  get diagnostics n = row_count;
  return n;
end $$;

revoke all on function public.expire_stale_payment_sessions() from public, anon, authenticated;

do $$ begin
  perform 1 from pg_extension where extname = 'pg_cron';
  if found then
    perform cron.schedule('fm-expire-payment-sessions', '17 * * * *',
      $cron$select public.expire_stale_payment_sessions();$cron$);
  end if;
exception when others then
  raise notice 'pg_cron not available; schedule expire_stale_payment_sessions() by hand';
end $$;

-- Hubtel is now the default for new projects. An existing project keeps whatever it already has,
-- so switching over is a deliberate change in Settings, not something a migration does behind you.
alter table public.company_settings alter column payment_provider set default 'hubtel';
