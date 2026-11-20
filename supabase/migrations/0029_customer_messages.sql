-- 0029: send a customer a message, or their balance, from their own page.
--
-- Review item 4. Reaching a customer meant waiting for an event to fire a template. These two
-- queue through the same notifications table as everything else, so they are sent by the same
-- function, logged against the customer, and visible on the Messages tab beside the automatic
-- ones. Nothing here talks to a provider directly.

-- ------------------------------------------------------------------- a message staff write
create or replace function public.send_customer_message(
  p_customer_id uuid,
  p_channel text,
  p_body text,
  p_subject text default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare c public.customers; v_id uuid; v_to text; v_name text;
begin
  perform public.require_role(array['super_admin','manager','ops_officer','sales_exec','accountant']);

  if p_channel not in ('sms','email') then raise exception 'Choose SMS or email'; end if;
  if coalesce(trim(p_body), '') = '' then raise exception 'Write the message first'; end if;

  select * into c from public.customers where id = p_customer_id;
  if c.id is null then raise exception 'Customer not found'; end if;
  if c.archived_at is not null then raise exception 'This customer is archived'; end if;

  if p_channel = 'sms' then
    v_to := coalesce(nullif(c.phone, ''), nullif(c.company_phone, ''));
    if v_to is null then raise exception 'This customer has no phone number'; end if;
  else
    v_to := coalesce(nullif(c.email, ''), nullif(c.company_email, ''));
    if v_to is null then raise exception 'This customer has no email address'; end if;
  end if;

  select company_name into v_name from public.company_settings where id = 1;

  insert into public.notifications (
    event_code, channel, recipient_name, recipient_phone, recipient_email, recipient_type,
    customer_id, subject, body, related_type, related_id, profile_id)
  values (
    'manual_message', p_channel, c.display_name,
    case when p_channel = 'sms' then public.normalize_phone(v_to) end,
    case when p_channel = 'email' then lower(v_to) end,
    'customer', c.id,
    case when p_channel = 'email' then coalesce(nullif(trim(p_subject), ''), 'A message from ' || coalesce(v_name, 'us')) end,
    trim(p_body), 'customer', c.id, public.current_profile_id())
  returning id into v_id;

  return v_id;
end $$;

revoke all on function public.send_customer_message(uuid, text, text, text) from public;
grant execute on function public.send_customer_message(uuid, text, text, text) to authenticated;

-- ------------------------------------------------------------------------ the balance owed
/* The figure is worked out here rather than passed in from the screen, so what the customer is
   told is what the ledger says at that moment, not what a page happened to be showing. */
create or replace function public.send_customer_balance(
  p_customer_id uuid,
  p_channel text,
  p_note text default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  c public.customers; v_id uuid; v_to text; v_company text; v_balance numeric;
  v_count int; v_oldest date; v_body text; v_pay text;
begin
  perform public.require_role(array['super_admin','manager','ops_officer','sales_exec','accountant']);
  if p_channel not in ('sms','email') then raise exception 'Choose SMS or email'; end if;

  select * into c from public.customers where id = p_customer_id;
  if c.id is null then raise exception 'Customer not found'; end if;

  if p_channel = 'sms' then
    v_to := coalesce(nullif(c.phone, ''), nullif(c.company_phone, ''));
    if v_to is null then raise exception 'This customer has no phone number'; end if;
  else
    v_to := coalesce(nullif(c.email, ''), nullif(c.company_email, ''));
    if v_to is null then raise exception 'This customer has no email address'; end if;
  end if;

  select company_name, nullif(payment_details_sms, '') into v_company, v_pay
  from public.company_settings where id = 1;

  v_balance := public.customer_outstanding(p_customer_id);

  select count(*), min(due_date) into v_count, v_oldest
  from public.invoices
  where customer_id = p_customer_id and status in ('issued','due','partially_paid','overdue') and balance > 0;

  if v_balance <= 0 then
    v_body := 'Dear ' || c.display_name || ', your account with ' || coalesce(v_company, 'us')
              || ' is fully settled. Thank you.';
  else
    v_body := 'Dear ' || c.display_name || ', your balance with ' || coalesce(v_company, 'us')
              || ' is GH' || chr(8373) || ' ' || public.money_text(v_balance)
              || ' across ' || v_count || ' invoice' || case when v_count = 1 then '' else 's' end
              || case when v_oldest is not null then ', the earliest due ' || to_char(v_oldest, 'DD Mon YYYY') else '' end
              || '.';
    if v_pay is not null then v_body := v_body || ' ' || v_pay; end if;
  end if;

  if coalesce(trim(p_note), '') <> '' then v_body := v_body || ' ' || trim(p_note); end if;

  insert into public.notifications (
    event_code, channel, recipient_name, recipient_phone, recipient_email, recipient_type,
    customer_id, subject, body, related_type, related_id, profile_id)
  values (
    'balance_notice', p_channel, c.display_name,
    case when p_channel = 'sms' then public.normalize_phone(v_to) end,
    case when p_channel = 'email' then lower(v_to) end,
    'customer', c.id,
    case when p_channel = 'email' then 'Your balance with ' || coalesce(v_company, 'us') end,
    v_body, 'customer', c.id, public.current_profile_id())
  returning id into v_id;

  return v_id;
end $$;

revoke all on function public.send_customer_balance(uuid, text, text) from public;
grant execute on function public.send_customer_balance(uuid, text, text) to authenticated;
