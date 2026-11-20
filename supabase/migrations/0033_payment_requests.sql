-- 0033: ask a customer to pay, from the Record a payment screen.
--
-- Review item 3. Staff enter the amount and the mobile money number, and the customer is asked
-- to pay on that handset.
--
-- Two ways of asking. A link, sent by SMS, which the customer taps and pays through the hosted
-- checkout: this works with the credentials already in place. Or a prompt pushed straight to the
-- handset through Hubtel's Receive Money API, which needs that capability enabled on the merchant
-- account and the caller's IP allow-listed. Which one is used is a setting, and the prompt falls
-- back to the link if Hubtel refuses it, so nothing is stuck waiting on an approval.

-- A request can be for a specific invoice or on account - a deposit under 70/30 terms is asked
-- for before any invoice exists, so the invoice is no longer required.
alter table public.payment_sessions alter column invoice_id drop not null;
alter table public.payment_sessions add column if not exists customer_id uuid references public.customers(id);
alter table public.payment_sessions add column if not exists requested_phone text;
alter table public.payment_sessions add column if not exists requested_by uuid references public.profiles(id);
alter table public.payment_sessions add column if not exists channel text not null default 'checkout'
  check (channel in ('checkout', 'link', 'prompt'));

-- Money has to be for someone, even when it is not yet for an invoice.
do $$ begin
  alter table public.payment_sessions add constraint payment_sessions_has_party
    check (invoice_id is not null or customer_id is not null);
exception when duplicate_object then null; end $$;

-- Sessions opened from an invoice link predate customer_id; fill it in so every row has a party.
update public.payment_sessions s
set customer_id = i.customer_id
from public.invoices i
where s.invoice_id = i.id and s.customer_id is null;

create index if not exists payment_sessions_customer_idx on public.payment_sessions (customer_id, created_at desc);

-- How staff requests are sent. 'link' works today; 'prompt' needs Receive Money enabled at Hubtel.
alter table public.company_settings add column if not exists payment_request_mode text not null default 'link'
  check (payment_request_mode in ('link', 'prompt'));

-- ------------------------------------------------------------------- open the request
/* The session is opened here rather than in the Edge Function, so the role check, the amount
   rules and the reference live with every other business rule. The function returns what the
   gateway call needs and nothing else. */
create or replace function public.open_payment_request(
  p_customer_id uuid,
  p_amount numeric,
  p_phone text,
  p_invoice_id uuid default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  c public.customers; v_inv public.invoices; v_ref text; v_token text;
  v_provider text; v_mode text; v_enabled boolean; v_phone text; v_amount numeric;
begin
  perform public.require_role(array['super_admin','manager','accountant','sales_exec','ops_officer']);

  select online_payments_enabled, payment_provider, payment_request_mode
    into v_enabled, v_provider, v_mode
  from public.company_settings where id = 1;

  if not v_enabled then raise exception 'Online payments are switched off in Configuration'; end if;

  select * into c from public.customers where id = p_customer_id;
  if c.id is null then raise exception 'Customer not found'; end if;

  v_amount := round(p_amount, 2);
  if v_amount is null or v_amount <= 0 then raise exception 'Enter the amount to request'; end if;
  if v_amount < 1 then raise exception 'The smallest request is GH% 1.00', chr(8373); end if;

  -- The number the prompt or the link goes to. Staff may be paying from a different wallet than
  -- the one on the customer record, so what they typed wins.
  v_phone := public.normalize_phone(coalesce(nullif(trim(p_phone), ''), c.phone, c.company_phone));
  if v_phone is null then raise exception 'Enter the mobile money number to charge'; end if;

  if p_invoice_id is not null then
    select * into v_inv from public.invoices where id = p_invoice_id;
    if v_inv.id is null then raise exception 'Invoice not found'; end if;
    if v_inv.customer_id <> p_customer_id then raise exception 'That invoice belongs to another customer'; end if;
    if v_inv.status in ('draft','void') then raise exception 'Invoice % cannot take payments (status %)', v_inv.invoice_no, v_inv.status; end if;
    if v_amount > v_inv.balance then
      raise exception 'Invoice % only owes GH% %', v_inv.invoice_no, chr(8373), public.money_text(v_inv.balance);
    end if;
  end if;

  -- Hubtel caps clientReference at 32 characters and refuses one it has seen before.
  v_ref := 'R' || replace(extensions.gen_random_uuid()::text, '-', '') || to_char(clock_timestamp(), 'SSSS');
  v_ref := left(v_ref, 32);
  /* Hubtel does not sign its callback, so the callback URL carries a secret of ours instead. */
  v_token := replace(extensions.gen_random_uuid()::text, '-', '') || replace(extensions.gen_random_uuid()::text, '-', '');

  insert into public.payment_sessions (reference, provider, invoice_id, customer_id, amount,
    callback_token, requested_phone, requested_by, channel)
  values (v_ref, v_provider, p_invoice_id, p_customer_id, v_amount,
    v_token, v_phone, public.current_profile_id(), case when v_mode = 'prompt' then 'prompt' else 'link' end);

  return jsonb_build_object(
    'reference', v_ref,
    'callback_token', v_token,
    'amount', v_amount,
    'phone', v_phone,
    'mode', v_mode,
    'provider', v_provider,
    'customer_name', c.display_name,
    'customer_email', coalesce(nullif(c.email, ''), nullif(c.company_email, '')),
    'invoice_id', p_invoice_id,
    'invoice_no', v_inv.invoice_no,
    -- so a customer paying from the link lands back on the invoice itself, not a dead URL
    'invoice_token', v_inv.public_token);
end $$;

revoke all on function public.open_payment_request(uuid, numeric, text, uuid) from public;
grant execute on function public.open_payment_request(uuid, numeric, text, uuid) to authenticated;

-- ------------------------------------------------------- tell the customer, and record how
/* The wording lives here with every other message. p_url is null when a prompt was pushed to the
   handset, in which case the customer has the prompt in front of them and the SMS only says what
   it is for, so they know the request is genuine before they enter a PIN. */
create or replace function public.notify_payment_request(
  p_reference text,
  p_url text default null,
  p_channel text default 'link'
) returns uuid
language plpgsql security definer set search_path = public as $$
declare s public.payment_sessions; c public.customers; v_company text; v_body text; v_id uuid;
begin
  perform public.require_role(array['super_admin','manager','accountant','sales_exec','ops_officer']);

  select * into s from public.payment_sessions where reference = p_reference;
  if s.reference is null then raise exception 'Payment request not found'; end if;

  select * into c from public.customers where id = s.customer_id;
  select company_name into v_company from public.company_settings where id = 1;

  if p_channel = 'prompt' then
    v_body := 'Dear ' || coalesce(c.display_name, 'Customer') || ', a payment prompt for GH' || chr(8373)
              || ' ' || public.money_text(s.amount) || ' to ' || coalesce(v_company, 'us')
              || case when s.invoice_id is not null
                      then ' for invoice ' || coalesce((select invoice_no from public.invoices where id = s.invoice_id), '')
                      else '' end
              || ' has been sent to your phone. Approve it with your mobile money PIN.';
  else
    v_body := 'Dear ' || coalesce(c.display_name, 'Customer') || ', please pay GH' || chr(8373)
              || ' ' || public.money_text(s.amount) || ' to ' || coalesce(v_company, 'us')
              || case when s.invoice_id is not null
                      then ' for invoice ' || coalesce((select invoice_no from public.invoices where id = s.invoice_id), '')
                      else '' end
              || ' here: ' || coalesce(p_url, '');
  end if;

  insert into public.notifications (event_code, channel, recipient_name, recipient_phone, recipient_type,
    customer_id, body, related_type, related_id, profile_id)
  values ('payment_request', 'sms', c.display_name, s.requested_phone, 'customer',
    c.id, v_body, 'payment_session', null, public.current_profile_id())
  returning id into v_id;

  update public.payment_sessions set channel = p_channel where reference = p_reference;
  return v_id;
end $$;

revoke all on function public.notify_payment_request(text, text, text) from public;
grant execute on function public.notify_payment_request(text, text, text) to authenticated;

-- Abandon a request that could not be sent, so it is not left pending until the expiry job.
create or replace function public.fail_payment_request(p_reference text, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public.require_role(array['super_admin','manager','accountant','sales_exec','ops_officer']);
  update public.payment_sessions
  set status = 'failed', failure_reason = left(coalesce(p_reason, 'Could not be sent'), 500)
  where reference = p_reference and status = 'pending';
end $$;

revoke all on function public.fail_payment_request(text, text) from public;
grant execute on function public.fail_payment_request(text, text) to authenticated;

-- What staff see on the customer: requests that are still waiting to be paid.
create or replace function public.pending_payment_requests(p_customer_id uuid)
returns table (reference text, amount numeric, requested_phone text, channel text,
               invoice_no text, requested_by text, created_at timestamptz)
language sql stable security definer set search_path = public as $$
  select s.reference, s.amount, s.requested_phone, s.channel,
         i.invoice_no, p.full_name, s.created_at
  from public.payment_sessions s
  left join public.invoices i on i.id = s.invoice_id
  left join public.profiles p on p.id = s.requested_by
  where s.customer_id = p_customer_id and s.status = 'pending' and s.channel in ('link','prompt')
  order by s.created_at desc;
$$;

revoke all on function public.pending_payment_requests(uuid) from public;
grant execute on function public.pending_payment_requests(uuid) to authenticated;
