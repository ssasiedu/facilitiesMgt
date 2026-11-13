-- 0013_functions_workflows.sql : business logic. Every workflow step is a SECURITY DEFINER function that
-- checks the caller's role and the record's current status. The browser can only call these via RPC.

-- =====================================================================================
-- 1. Utilities
-- =====================================================================================
create or replace function public.app_settings() returns public.company_settings
language sql stable security definer set search_path = public as $$
  select * from public.company_settings where id = 1
$$;

create or replace function public.next_doc_no(p_type text, p_date date default current_date) returns text
language plpgsql security definer set search_path = public as $$
declare t public.document_sequences; v_year int; v_val int;
begin
  select * into t from public.document_sequences where doc_type = p_type and year = 0 for update;
  if not found then raise exception 'No document sequence configured for %', p_type; end if;
  if t.per_year then
    v_year := extract(year from coalesce(p_date, current_date))::int;
    insert into public.document_sequences (doc_type, year, prefix, padding, per_year, last_value)
    values (p_type, v_year, t.prefix, t.padding, true, 0) on conflict do nothing;
    update public.document_sequences set last_value = last_value + 1
      where doc_type = p_type and year = v_year returning last_value into v_val;
    return t.prefix || '-' || v_year || '-' || lpad(v_val::text, t.padding, '0');
  else
    update public.document_sequences set last_value = last_value + 1
      where doc_type = p_type and year = 0 returning last_value into v_val;
    return t.prefix || '-' || lpad(v_val::text, t.padding, '0');
  end if;
end $$;

create or replace function public.money_text(p numeric) returns text language sql immutable as $$
  select trim(to_char(coalesce(p,0), 'FM999,999,999,990.00'))
$$;

create or replace function public.date_text(p date) returns text language sql immutable as $$
  select to_char(p, 'DD/MM/YYYY')
$$;

create or replace function public.account_by_code(p_code text) returns uuid
language plpgsql stable security definer set search_path = public as $$
declare v uuid;
begin
  select id into v from public.accounts where code = p_code;
  if v is null then raise exception 'Account % is missing from the chart of accounts', p_code; end if;
  return v;
end $$;

create or replace function public.rule_debit(p_event text) returns uuid
language plpgsql stable security definer set search_path = public as $$
declare v uuid;
begin
  select debit_account_id into v from public.posting_rules where event_code = p_event;
  if v is null then raise exception 'Posting rule % has no debit account', p_event; end if;
  return v;
end $$;

create or replace function public.rule_credit(p_event text) returns uuid
language plpgsql stable security definer set search_path = public as $$
declare v uuid;
begin
  select credit_account_id into v from public.posting_rules where event_code = p_event;
  if v is null then raise exception 'Posting rule % has no credit account', p_event; end if;
  return v;
end $$;

create or replace function public.bank_ledger_account(p_bank_account_id uuid) returns uuid
language plpgsql stable security definer set search_path = public as $$
declare v uuid;
begin
  select account_id into v from public.bank_accounts where id = p_bank_account_id;
  if v is null then raise exception 'Bank/cash account not found'; end if;
  return v;
end $$;

-- =====================================================================================
-- 2. Notifications (outbox + in-app)
-- =====================================================================================
create or replace function public.render_template(p_body text, p_vars jsonb) returns text
language plpgsql immutable as $$
declare r record; v text := coalesce(p_body, '');
begin
  for r in select key, value from jsonb_each_text(coalesce(p_vars, '{}'::jsonb)) loop
    v := replace(v, '{' || r.key || '}', coalesce(r.value, ''));
  end loop;
  return v;
end $$;

create or replace function public.notification_enabled(p_event text) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select (notifications_enabled ->> p_event)::boolean from public.company_settings where id = 1), true)
$$;

create or replace function public.queue_notification(
  p_event text, p_channel text, p_name text, p_phone text, p_email text, p_vars jsonb,
  p_customer_id uuid default null, p_profile_id uuid default null, p_recipient_type text default 'customer',
  p_related_type text default null, p_related_id uuid default null, p_dedupe text default null
) returns uuid language plpgsql security definer set search_path = public as $$
declare t public.notification_templates; s public.company_settings; v_id uuid; v_vars jsonb; c record;
begin
  select * into t from public.notification_templates where event_code = p_event and channel = p_channel;
  if not found or not t.active then return null; end if;
  if not public.notification_enabled(p_event) then return null; end if;
  if p_channel = 'sms' and coalesce(p_phone, '') = '' then return null; end if;
  if p_channel = 'email' and coalesce(p_email, '') = '' then return null; end if;
  if t.is_marketing and p_customer_id is not null then
    select sms_opt_in, marketing_consent into c from public.customers where id = p_customer_id;
    if not coalesce(c.marketing_consent, false) or (p_channel = 'sms' and not coalesce(c.sms_opt_in, false)) then
      return null;  -- marketing respects opt-out; transactional always sends
    end if;
  end if;
  s := public.app_settings();
  v_vars := jsonb_build_object('company_name', s.company_name, 'payment_details', s.payment_details_sms,
                               'customer_name', coalesce(p_name, '')) || coalesce(p_vars, '{}'::jsonb);
  insert into public.notifications (event_code, channel, recipient_name, recipient_phone, recipient_email, recipient_type,
    customer_id, profile_id, subject, body, variables, related_type, related_id, is_marketing, dedupe_key)
  values (p_event, p_channel, p_name, case when p_channel = 'sms' then public.normalize_phone(p_phone) end,
    case when p_channel = 'email' then p_email end, p_recipient_type, p_customer_id, p_profile_id,
    public.render_template(t.subject, v_vars), public.render_template(t.body, v_vars), v_vars,
    p_related_type, p_related_id, t.is_marketing, p_dedupe)
  on conflict (dedupe_key) do nothing
  returning id into v_id;
  return v_id;
end $$;

-- in-app notification to one profile
create or replace function public.notify_profile(p_profile_id uuid, p_title text, p_body text, p_link text default null,
  p_severity text default 'info', p_dedupe text default null) returns void
language plpgsql security definer set search_path = public as $$
begin
  if p_profile_id is null then return; end if;
  insert into public.in_app_notifications (profile_id, title, body, link, severity, dedupe_key)
  values (p_profile_id, p_title, p_body, p_link, p_severity, p_dedupe)
  on conflict (profile_id, dedupe_key) do nothing;
end $$;

-- active profiles holding a role (falls back to Super Admins when nobody holds it)
create or replace function public.profiles_with_role(p_role text) returns setof public.profiles
language plpgsql stable security definer set search_path = public as $$
begin
  return query select p.* from public.profiles p join public.user_roles ur on ur.profile_id = p.id
    where ur.role_code = p_role and p.is_active and p.archived_at is null;
  if not found then
    return query select p.* from public.profiles p join public.user_roles ur on ur.profile_id = p.id
      where ur.role_code = 'super_admin' and p.is_active and p.archived_at is null;
  end if;
end $$;

create or replace function public.notify_role(p_role text, p_title text, p_body text, p_link text default null,
  p_severity text default 'info', p_dedupe text default null) returns void
language plpgsql security definer set search_path = public as $$
declare r record;
begin
  for r in select * from public.profiles_with_role(p_role) loop
    perform public.notify_profile(r.id, p_title, p_body, p_link, p_severity, p_dedupe);
  end loop;
end $$;

-- SMS (and email) to every staff member holding a role
create or replace function public.queue_role_message(p_role text, p_event text, p_vars jsonb,
  p_related_type text default null, p_related_id uuid default null, p_dedupe text default null) returns int
language plpgsql security definer set search_path = public as $$
declare r record; n int := 0;
begin
  for r in select * from public.profiles_with_role(p_role) loop
    if public.queue_notification(p_event, 'sms', r.full_name, r.phone, null, p_vars || jsonb_build_object('officer_name', r.full_name),
         null, r.id, 'staff', p_related_type, p_related_id, case when p_dedupe is null then null else p_dedupe || ':sms:' || r.id end) is not null then n := n + 1; end if;
    perform public.queue_notification(p_event, 'email', r.full_name, null, r.email, p_vars || jsonb_build_object('officer_name', r.full_name),
         null, r.id, 'staff', p_related_type, p_related_id, case when p_dedupe is null then null else p_dedupe || ':email:' || r.id end);
  end loop;
  return n;
end $$;

-- Edge Function helpers (service role only)
create or replace function public.claim_notifications(p_limit int default 50) returns setof public.notifications
language plpgsql security definer set search_path = public as $$
begin
  return query
  update public.notifications n set status = 'sending', attempts = n.attempts + 1
  where n.id in (select id from public.notifications where status = 'queued' and next_attempt_at <= now()
                 order by created_at limit p_limit for update skip locked)
  returning n.*;
end $$;

create or replace function public.complete_notification(p_id uuid, p_success boolean, p_provider text, p_message_id text,
  p_response jsonb, p_cost numeric, p_segments int, p_error text) returns void
language plpgsql security definer set search_path = public as $$
declare v_attempts int;
begin
  select attempts into v_attempts from public.notifications where id = p_id;
  if p_success then
    update public.notifications set status = 'sent', sent_at = now(), provider = p_provider, provider_message_id = p_message_id,
      provider_response = p_response, cost = p_cost, segments = p_segments, error = null where id = p_id;
  elsif v_attempts < 3 then
    update public.notifications set status = 'queued', provider = p_provider, provider_response = p_response, error = p_error,
      next_attempt_at = now() + (power(2, v_attempts) || ' minutes')::interval where id = p_id;
  else
    update public.notifications set status = 'failed', provider = p_provider, provider_response = p_response, error = p_error where id = p_id;
  end if;
end $$;

-- =====================================================================================
-- 3. General ledger
-- =====================================================================================
-- Internal: create and post a balanced journal. p_lines: [{account_id, debit, credit, description,
--   customer_id, supplier_id, job_order_id, contract_id, service_id, truck_id, invoice_id}]
create or replace function public._post_journal(p_date date, p_description text, p_source_type text, p_source_id uuid,
  p_event text, p_lines jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid; l jsonb; n int := 0;
begin
  insert into public.journal_entries (entry_no, entry_date, description, source_type, source_id, event_code, status, is_manual)
  values (public.next_doc_no('journal', p_date), p_date, p_description, p_source_type, p_source_id, p_event, 'draft', false)
  returning id into v_id;
  for l in select * from jsonb_array_elements(p_lines) loop
    if round(coalesce((l->>'debit')::numeric, 0), 2) = 0 and round(coalesce((l->>'credit')::numeric, 0), 2) = 0 then continue; end if;
    n := n + 1;
    insert into public.journal_lines (entry_id, line_no, account_id, debit, credit, description, customer_id, supplier_id,
      job_order_id, contract_id, service_id, truck_id, invoice_id)
    values (v_id, n, (l->>'account_id')::uuid, round(coalesce((l->>'debit')::numeric, 0), 2), round(coalesce((l->>'credit')::numeric, 0), 2),
      l->>'description', (l->>'customer_id')::uuid, (l->>'supplier_id')::uuid, (l->>'job_order_id')::uuid, (l->>'contract_id')::uuid,
      (l->>'service_id')::uuid, (l->>'truck_id')::uuid, (l->>'invoice_id')::uuid);
  end loop;
  if n = 0 then raise exception 'Journal has no lines'; end if;
  update public.journal_entries set status = 'posted', posted_at = now(), posted_by = public.current_profile_id() where id = v_id;
  return v_id;
end $$;

-- RPC: post a draft manual journal (Accountant)
create or replace function public.post_journal(p_entry_id uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare e public.journal_entries;
begin
  perform public.require_role(array['accountant']);
  select * into e from public.journal_entries where id = p_entry_id for update;
  if not found then raise exception 'Journal not found'; end if;
  if e.status <> 'draft' then raise exception 'Journal % is already posted', e.entry_no; end if;
  update public.journal_entries set status = 'posted', posted_at = now(), posted_by = public.current_profile_id() where id = p_entry_id;
  if e.recur_frequency <> 'none' and e.next_recur_date is null then
    update public.journal_entries set next_recur_date = (e.entry_date + case e.recur_frequency when 'monthly' then interval '1 month' else interval '3 months' end)::date
    where id = p_entry_id;
  end if;
  return p_entry_id;
end $$;

create or replace function public._reverse_journal(p_entry_id uuid, p_date date, p_reason text) returns uuid
language plpgsql security definer set search_path = public as $$
declare e public.journal_entries; v_new uuid; v_lines jsonb;
begin
  select * into e from public.journal_entries where id = p_entry_id for update;
  if not found or e.status <> 'posted' then raise exception 'Only posted journals can be reversed'; end if;
  if e.reversed_by is not null then raise exception 'Journal % was already reversed', e.entry_no; end if;
  select jsonb_agg(jsonb_build_object('account_id', account_id, 'debit', credit, 'credit', debit, 'description', 'Reversal: ' || coalesce(description, ''),
    'customer_id', customer_id, 'supplier_id', supplier_id, 'job_order_id', job_order_id, 'contract_id', contract_id,
    'service_id', service_id, 'truck_id', truck_id, 'invoice_id', invoice_id) order by line_no) into v_lines
  from public.journal_lines where entry_id = p_entry_id;
  v_new := public._post_journal(coalesce(p_date, current_date), 'Reversal of ' || e.entry_no || ': ' || coalesce(p_reason, ''),
    'reversal', p_entry_id, 'reversal', v_lines);
  update public.journal_entries set reversal_of = p_entry_id where id = v_new;
  update public.journal_entries set reversed_by = v_new where id = p_entry_id;
  return v_new;
end $$;

create or replace function public.reverse_journal(p_entry_id uuid, p_date date, p_reason text) returns uuid
language plpgsql security definer set search_path = public as $$
begin
  perform public.require_role(array['accountant']);
  if coalesce(btrim(p_reason), '') = '' then raise exception 'A reason is required'; end if;
  return public._reverse_journal(p_entry_id, p_date, p_reason);
end $$;

create or replace function public.mark_lines_cleared(p_line_ids uuid[], p_cleared boolean) returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  perform public.require_role(array['accountant']);
  update public.journal_lines set cleared = p_cleared, cleared_at = case when p_cleared then now() end where id = any(p_line_ids);
  get diagnostics n = row_count;
  return n;
end $$;

create or replace function public.record_bank_transfer(p_from uuid, p_to uuid, p_amount numeric, p_fee numeric, p_date date, p_reference text) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_j uuid; v_no text;
begin
  perform public.require_role(array['accountant']);
  if p_from = p_to then raise exception 'Choose two different accounts'; end if;
  v_no := public.next_doc_no('transfer', p_date);
  v_j := public._post_journal(p_date, 'Transfer ' || v_no || coalesce(' ' || p_reference, ''), 'bank_transfer', null, 'bank_transfer',
    jsonb_build_array(
      jsonb_build_object('account_id', public.bank_ledger_account(p_to), 'debit', p_amount),
      jsonb_build_object('account_id', public.bank_ledger_account(p_from), 'credit', p_amount + coalesce(p_fee, 0)),
      jsonb_build_object('account_id', public.rule_debit('bank_charges'), 'debit', coalesce(p_fee, 0))));
  insert into public.bank_transfers (transfer_no, from_bank_account_id, to_bank_account_id, amount, fee, transfer_date, reference, journal_entry_id)
  values (v_no, p_from, p_to, p_amount, coalesce(p_fee, 0), p_date, p_reference, v_j) returning id into v_id;
  update public.journal_entries set source_id = v_id where id = v_j;
  return v_id;
end $$;

-- =====================================================================================
-- 4. Taxes and invoices
-- =====================================================================================
-- Configurable tax engine. Non-compound taxes are charged on the taxable amount; compound taxes on
-- (taxable amount + non-compound taxes). Each tax rounds to 2 dp.
create or replace function public.compute_taxes(p_taxable numeric)
returns table (tax_rate_id uuid, name text, rate numeric, compound boolean, base_amount numeric, amount numeric, account_id uuid)
language plpgsql stable security definer set search_path = public as $$
declare r record; v_simple numeric := 0;
begin
  for r in select * from public.tax_rates t where t.active and not t.compound order by t.sort_order loop
    tax_rate_id := r.id; name := r.name; rate := r.rate; compound := false; base_amount := round(p_taxable, 2);
    amount := round(p_taxable * r.rate / 100, 2); account_id := r.account_id; v_simple := v_simple + amount;
    return next;
  end loop;
  for r in select * from public.tax_rates t where t.active and t.compound order by t.sort_order loop
    tax_rate_id := r.id; name := r.name; rate := r.rate; compound := true; base_amount := round(p_taxable + v_simple, 2);
    amount := round((p_taxable + v_simple) * r.rate / 100, 2); account_id := r.account_id;
    return next;
  end loop;
end $$;

create or replace function public.recalc_invoice(p_invoice_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_sub numeric; v_disc numeric; v_taxable numeric; v_net numeric; v_tax numeric;
begin
  update public.invoice_lines set line_total = round(quantity * unit_price, 2) - discount where invoice_id = p_invoice_id;
  select coalesce(sum(round(quantity * unit_price, 2)), 0), coalesce(sum(discount), 0),
         coalesce(sum(line_total) filter (where taxable), 0), coalesce(sum(line_total), 0)
    into v_sub, v_disc, v_taxable, v_net from public.invoice_lines where invoice_id = p_invoice_id;
  if exists (select 1 from public.invoice_lines where invoice_id = p_invoice_id and line_total < 0) then
    raise exception 'A line discount cannot exceed the line amount';
  end if;
  delete from public.invoice_taxes where invoice_id = p_invoice_id;
  insert into public.invoice_taxes (invoice_id, tax_rate_id, name, rate, compound, base_amount, amount, account_id)
  select p_invoice_id, t.tax_rate_id, t.name, t.rate, t.compound, t.base_amount, t.amount, t.account_id from public.compute_taxes(v_taxable) t where t.amount <> 0;
  select coalesce(sum(amount), 0) into v_tax from public.invoice_taxes where invoice_id = p_invoice_id;
  update public.invoices set subtotal = v_sub, discount_total = v_disc, taxable_amount = v_taxable, tax_total = v_tax,
    total = v_net + v_tax, balance = greatest(v_net + v_tax - amount_paid - amount_credited, 0) where id = p_invoice_id;
end $$;

-- Recompute paid/credited/balance/status and close the job when fully paid.
create or replace function public.refresh_invoice_status(p_invoice_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare i public.invoices; v_paid numeric; v_cred numeric; v_bal numeric; v_status text;
begin
  select * into i from public.invoices where id = p_invoice_id for update;
  if not found or i.status = 'draft' then return; end if;
  select coalesce(sum(amount), 0) into v_paid from public.payment_allocations where invoice_id = p_invoice_id;
  v_paid := v_paid + coalesce((select sum(amount) from public.customer_credit_applications where invoice_id = p_invoice_id), 0);
  select coalesce(sum(amount), 0) into v_cred from public.credit_notes where invoice_id = p_invoice_id;
  -- paid money released back to the customer by a credit note no longer counts as paid on this invoice
  v_paid := v_paid - coalesce((select sum(cc.amount) from public.customer_credits cc join public.credit_notes cn on cn.id = cc.credit_note_id
                                where cn.invoice_id = p_invoice_id), 0);
  v_bal := i.total - v_paid - v_cred;
  if v_bal < 0 then raise exception 'Invoice % would be over-settled', i.invoice_no; end if;
  v_status := case
    when v_bal = 0 and v_cred >= i.total then 'void'
    when v_bal = 0 then 'paid'
    when i.due_date is not null and i.due_date < current_date then 'overdue'
    when v_paid > 0 then 'partially_paid'
    when i.due_date is not null then 'due'
    else 'issued' end;
  update public.invoices set amount_paid = v_paid, amount_credited = v_cred, balance = v_bal, status = v_status where id = p_invoice_id;
  if v_status in ('paid','void') and i.job_order_id is not null then
    update public.job_orders set status = 'closed' where id = i.job_order_id and status = 'completed';
  end if;
end $$;

-- Issue an invoice and post it. Deferred = job invoices before completion.
create or replace function public._issue_invoice(p_invoice_id uuid, p_event text, p_deferred boolean, p_due_date date) returns void
language plpgsql security definer set search_path = public as $$
declare i public.invoices; v_lines jsonb; v_taxes jsonb; v_j uuid; v_deferred_acct uuid;
begin
  perform public.recalc_invoice(p_invoice_id);
  select * into i from public.invoices where id = p_invoice_id for update;
  if i.status <> 'draft' then raise exception 'Invoice is already issued'; end if;
  if i.total <= 0 then raise exception 'Invoice total must be greater than zero'; end if;
  if p_deferred then v_deferred_acct := public.rule_credit(p_event); end if;

  select jsonb_agg(jsonb_build_object(
      'account_id', case when p_deferred then v_deferred_acct
                         when p_event = 'contract_invoice' then coalesce(l.revenue_account_id, public.rule_credit(p_event))
                         else coalesce(l.revenue_account_id, s.revenue_account_id, public.rule_credit(p_event)) end,
      'credit', l.line_total, 'description', l.description, 'customer_id', i.customer_id, 'job_order_id', i.job_order_id,
      'contract_id', i.contract_id, 'service_id', l.service_id, 'invoice_id', i.id) order by l.sort_order)
    into v_lines
  from public.invoice_lines l left join public.services s on s.id = l.service_id where l.invoice_id = p_invoice_id;
  select coalesce(jsonb_agg(jsonb_build_object('account_id', coalesce(t.account_id, public.rule_credit('invoice_tax')), 'credit', t.amount,
      'description', t.name, 'customer_id', i.customer_id, 'invoice_id', i.id)), '[]'::jsonb)
    into v_taxes from public.invoice_taxes t where t.invoice_id = p_invoice_id;

  update public.invoices set invoice_no = public.next_doc_no('invoice', i.issue_date), status = 'issued', issued_at = now(),
    issued_by = public.current_profile_id(), due_date = p_due_date, revenue_deferred = p_deferred,
    revenue_recognised_at = case when p_deferred then null else now() end
  where id = p_invoice_id returning * into i;

  v_j := public._post_journal(i.issue_date, 'Invoice ' || i.invoice_no || ' – ' || coalesce(i.customer_name, ''), 'invoice', i.id, p_event,
    jsonb_build_array(jsonb_build_object('account_id', public.rule_debit(p_event), 'debit', i.total, 'description', 'Invoice ' || i.invoice_no,
      'customer_id', i.customer_id, 'job_order_id', i.job_order_id, 'contract_id', i.contract_id, 'invoice_id', i.id)) || v_lines || v_taxes);
  update public.invoices set journal_entry_id = v_j where id = p_invoice_id;
  perform public.refresh_invoice_status(p_invoice_id);
end $$;

-- RPC: issue a manual draft invoice (Accountant)
create or replace function public.issue_invoice(p_invoice_id uuid) returns text
language plpgsql security definer set search_path = public as $$
declare i public.invoices; v_terms int;
begin
  perform public.require_role(array['accountant']);
  select * into i from public.invoices where id = p_invoice_id;
  if not found then raise exception 'Invoice not found'; end if;
  if i.source <> 'manual' then raise exception 'Only manual invoices are issued by hand'; end if;
  if not exists (select 1 from public.invoice_lines where invoice_id = p_invoice_id) then raise exception 'Add at least one line'; end if;
  select payment_terms_days into v_terms from public.customers where id = i.customer_id;
  perform public._issue_invoice(p_invoice_id, 'manual_invoice', false, coalesce(i.due_date, i.issue_date + coalesce(v_terms, 7)));
  select * into i from public.invoices where id = p_invoice_id;
  perform public.queue_invoice_messages(p_invoice_id, 'invoice_issued');
  return i.invoice_no;
end $$;

create or replace function public.invoice_link(p_invoice_id uuid) returns text
language sql stable security definer set search_path = public as $$
  select rtrim((select public_app_url from public.company_settings where id = 1), '/') || '/p/invoice/' || public_token from public.invoices where id = p_invoice_id
$$;

-- Send an invoice to the customer's billing contacts (or the customer when none is flagged).
create or replace function public.queue_invoice_messages(p_invoice_id uuid, p_event text) returns int
language plpgsql security definer set search_path = public as $$
declare i public.invoices; c public.customers; r record; v_vars jsonb; n int := 0; v_contract text; v_period text;
begin
  select * into i from public.invoices where id = p_invoice_id;
  select * into c from public.customers where id = i.customer_id;
  select contract_no into v_contract from public.contracts where id = i.contract_id;
  v_period := case when i.period_start is not null then public.date_text(i.period_start) || ' – ' || public.date_text(i.period_end) end;
  v_vars := jsonb_build_object('invoice_no', i.invoice_no, 'amount', public.money_text(i.total), 'balance', public.money_text(i.balance),
    'invoice_link', public.invoice_link(i.id), 'date', public.date_text(i.due_date), 'contract_no', coalesce(v_contract, ''), 'period', coalesce(v_period, ''));
  for r in select name, phone, email from public.customer_contacts where customer_id = c.id and receives_invoices loop
    if public.queue_notification(p_event, 'sms', r.name, r.phone, null, v_vars || jsonb_build_object('customer_name', r.name), c.id, null, 'contact', 'invoice', i.id) is not null then n := n + 1; end if;
    if public.queue_notification(p_event, 'email', r.name, null, r.email, v_vars || jsonb_build_object('customer_name', r.name), c.id, null, 'contact', 'invoice', i.id) is not null then n := n + 1; end if;
  end loop;
  if n = 0 then
    if public.queue_notification(p_event, 'sms', c.display_name, coalesce(c.phone, c.company_phone), null, v_vars, c.id, null, 'customer', 'invoice', i.id) is not null then n := n + 1; end if;
    if public.queue_notification(p_event, 'email', c.display_name, null, coalesce(c.email, c.company_email), v_vars, c.id, null, 'customer', 'invoice', i.id) is not null then n := n + 1; end if;
  end if;
  return n;
end $$;

-- =====================================================================================
-- 5. Credit notes, payments, receipts, customer credits, refunds
-- =====================================================================================
create or replace function public._issue_credit_note(p_invoice_id uuid, p_amount numeric, p_reason text) returns uuid
language plpgsql security definer set search_path = public as $$
declare i public.invoices; v_max numeric; v_tax numeric; v_net numeric; v_ar numeric; v_excess numeric; v_lines jsonb := '[]'::jsonb;
  v_no text; v_id uuid; v_j uuid; l record; v_alloc numeric; v_done numeric := 0; v_cnt int; v_k int := 0; v_line_net numeric; v_acct uuid;
begin
  select * into i from public.invoices where id = p_invoice_id for update;
  if not found or i.status in ('draft') then raise exception 'Only issued invoices can be credited'; end if;
  v_max := i.total - i.amount_credited;
  p_amount := round(p_amount, 2);
  if p_amount <= 0 or p_amount > v_max then raise exception 'Credit note amount must be between 0.01 and %', public.money_text(v_max); end if;
  if coalesce(btrim(p_reason), '') = '' then raise exception 'A reason is required'; end if;
  v_tax := case when i.total = 0 then 0 else round(i.tax_total * p_amount / i.total, 2) end;
  v_net := p_amount - v_tax;
  v_ar := least(p_amount, i.balance);
  v_excess := p_amount - v_ar;
  v_no := public.next_doc_no('credit_note');
  insert into public.credit_notes (credit_note_no, invoice_id, customer_id, amount, tax_amount, reason)
  values (v_no, i.id, i.customer_id, p_amount, v_tax, p_reason) returning id into v_id;

  -- reverse revenue (or deferred revenue) line by line, in proportion
  select count(*) into v_cnt from public.invoice_lines where invoice_id = i.id;
  for l in select il.*, s.revenue_account_id as svc_acct from public.invoice_lines il left join public.services s on s.id = il.service_id
           where il.invoice_id = i.id order by il.sort_order, il.id loop
    v_k := v_k + 1;
    v_line_net := case when v_k = v_cnt then v_net - v_done
                       else round(v_net * l.line_total / nullif(i.total - i.tax_total, 0), 2) end;
    v_done := v_done + v_line_net;
    v_acct := case when i.revenue_deferred then public.rule_credit('job_approved')
                   when i.source = 'contract' then coalesce(l.revenue_account_id, public.rule_credit('contract_invoice'))
                   else coalesce(l.revenue_account_id, l.svc_acct, public.rule_credit(case when i.source = 'job' then 'job_completed' else 'manual_invoice' end)) end;
    v_lines := v_lines || jsonb_build_object('account_id', v_acct, 'debit', v_line_net, 'description', 'Credit note ' || v_no,
      'customer_id', i.customer_id, 'job_order_id', i.job_order_id, 'contract_id', i.contract_id, 'service_id', l.service_id, 'invoice_id', i.id);
  end loop;
  -- reverse taxes in proportion
  v_alloc := 0;
  for l in select * from public.invoice_taxes where invoice_id = i.id order by id loop
    v_lines := v_lines || jsonb_build_object('account_id', coalesce(l.account_id, public.rule_credit('invoice_tax')),
      'debit', case when i.tax_total = 0 then 0 else round(v_tax * l.amount / i.tax_total, 2) end, 'description', 'Credit note ' || v_no || ' ' || l.name,
      'customer_id', i.customer_id, 'invoice_id', i.id);
    v_alloc := v_alloc + case when i.tax_total = 0 then 0 else round(v_tax * l.amount / i.tax_total, 2) end;
  end loop;
  if v_alloc <> v_tax then -- rounding residual to the first tax account
    v_lines := v_lines || jsonb_build_object('account_id', coalesce((select account_id from public.invoice_taxes where invoice_id = i.id order by id limit 1), public.rule_credit('invoice_tax')),
      'debit', greatest(v_tax - v_alloc, 0), 'credit', greatest(v_alloc - v_tax, 0), 'description', 'Rounding', 'invoice_id', i.id);
  end if;
  v_lines := v_lines || jsonb_build_object('account_id', public.rule_debit('job_approved'), 'credit', v_ar, 'description', 'Credit note ' || v_no,
    'customer_id', i.customer_id, 'invoice_id', i.id);
  if v_excess > 0 then
    v_lines := v_lines || jsonb_build_object('account_id', public.rule_credit('customer_overpayment'), 'credit', v_excess,
      'description', 'Paid amount credited back – ' || v_no, 'customer_id', i.customer_id, 'invoice_id', i.id);
    -- keep the invoice settled: move the excess paid amount out of the invoice into a customer credit
    insert into public.customer_credits (customer_id, source_type, credit_note_id, amount) values (i.customer_id, 'credit_note', v_id, v_excess);
  end if;
  v_j := public._post_journal(current_date, 'Credit note ' || v_no || ' for ' || i.invoice_no || ': ' || p_reason, 'credit_note', v_id, 'credit_note', v_lines);
  update public.credit_notes set journal_entry_id = v_j where id = v_id;
  perform public.refresh_invoice_status(i.id);
  return v_id;
end $$;

create or replace function public.issue_credit_note(p_invoice_id uuid, p_amount numeric, p_reason text) returns uuid
language plpgsql security definer set search_path = public as $$
begin
  perform public.require_role(array['accountant']);
  return public._issue_credit_note(p_invoice_id, p_amount, p_reason);
end $$;

create or replace function public.receipt_link(p_receipt_id uuid) returns text
language sql stable security definer set search_path = public as $$
  select rtrim((select public_app_url from public.company_settings where id = 1), '/') || '/p/receipt/' || public_token from public.receipts where id = p_receipt_id
$$;

create or replace function public.survey_link(p_invitation_id uuid) returns text
language sql stable security definer set search_path = public as $$
  select rtrim((select public_app_url from public.company_settings where id = 1), '/') || '/p/survey/' || token from public.survey_invitations where id = p_invitation_id
$$;

-- pick the survey for an invoice: one limited to the invoice's service, else the default
create or replace function public.get_or_create_survey_invitation(p_invoice_id uuid, p_payment_id uuid, p_customer_id uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_survey uuid; v_service uuid; v_job uuid; s public.company_settings;
begin
  if p_invoice_id is not null then
    select id into v_id from public.survey_invitations where invoice_id = p_invoice_id;
    if v_id is not null then return v_id; end if;
    select il.service_id, i.job_order_id into v_service, v_job from public.invoices i left join public.invoice_lines il on il.invoice_id = i.id
      where i.id = p_invoice_id order by il.sort_order limit 1;
  end if;
  select id into v_survey from public.surveys where active and archived_at is null and v_service = any(service_ids) order by created_at limit 1;
  if v_survey is null then select id into v_survey from public.surveys where active and is_default and archived_at is null limit 1; end if;
  if v_survey is null then return null; end if;
  s := public.app_settings();
  insert into public.survey_invitations (survey_id, customer_id, invoice_id, job_order_id, payment_id, expires_at)
  values (v_survey, p_customer_id, p_invoice_id, v_job, p_payment_id, now() + make_interval(days => s.survey_expiry_days))
  on conflict (invoice_id) where invoice_id is not null do nothing
  returning id into v_id;
  if v_id is null then select id into v_id from public.survey_invitations where invoice_id = p_invoice_id; end if;
  return v_id;
end $$;

-- RPC: record a customer payment, allocate it, post it, issue the receipt and queue receipt + survey messages.
-- p_allocations: [{invoice_id, amount}] or null for oldest-first automatic allocation.
create or replace function public.record_payment(p_customer_id uuid, p_amount numeric, p_method text, p_date date default current_date,
  p_reference text default null, p_bank_account_id uuid default null, p_allocations jsonb default null, p_notes text default null,
  p_provider text default null, p_provider_ref text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare m public.payment_methods; c public.customers; v_pid uuid; v_rid uuid; v_rno text; v_left numeric; v_alloc numeric;
  a record; inv public.invoices; v_total_alloc numeric := 0; v_lines jsonb := '[]'::jsonb; v_bank uuid; v_j uuid; v_first_inv uuid;
  v_inv_nos text := ''; v_bal numeric := 0; v_inv uuid; v_survey uuid; v_vars jsonb; v_existing record;
begin
  perform public.require_role(array['accountant']);
  if p_provider_ref is not null then
    select p.id, r.id as receipt_id, r.receipt_no into v_existing from public.payments p left join public.receipts r on r.payment_id = p.id where p.provider_ref = p_provider_ref;
    if found then return jsonb_build_object('payment_id', v_existing.id, 'receipt_id', v_existing.receipt_id, 'receipt_no', v_existing.receipt_no, 'duplicate', true); end if;
  end if;
  p_amount := round(p_amount, 2);
  if p_amount is null or p_amount <= 0 then raise exception 'Payment amount must be greater than zero'; end if;
  select * into m from public.payment_methods where code = p_method and active;
  if not found then raise exception 'Unknown or inactive payment method %', p_method; end if;
  if m.requires_reference and coalesce(btrim(p_reference), '') = '' then raise exception '% payments need a transaction reference', m.name; end if;
  select * into c from public.customers where id = p_customer_id;
  if not found then raise exception 'Customer not found'; end if;
  v_bank := coalesce(p_bank_account_id, m.default_bank_account_id);
  if v_bank is null then raise exception 'No cash/bank account set for %', m.name; end if;
  if p_date is null then p_date := current_date; end if;

  insert into public.payments (payment_no, customer_id, payment_date, amount, method_code, reference, bank_account_id, notes, provider, provider_ref)
  values (public.next_doc_no('payment', p_date), p_customer_id, p_date, p_amount, p_method, p_reference, v_bank, p_notes, p_provider, p_provider_ref)
  returning id into v_pid;

  v_left := p_amount;
  if p_allocations is null then
    for inv in select * from public.invoices where customer_id = p_customer_id and status in ('issued','due','partially_paid','overdue') and balance > 0
               order by (due_date is null), due_date, issue_date, invoice_no for update loop  -- due invoices first, oldest first
      exit when v_left <= 0;
      v_alloc := least(v_left, inv.balance);
      insert into public.payment_allocations (payment_id, invoice_id, amount) values (v_pid, inv.id, v_alloc);
      v_left := v_left - v_alloc; v_total_alloc := v_total_alloc + v_alloc;
    end loop;
  else
    for a in select (x->>'invoice_id')::uuid as invoice_id, round((x->>'amount')::numeric, 2) as amount from jsonb_array_elements(p_allocations) x loop
      if a.amount is null or a.amount <= 0 then continue; end if;
      select * into inv from public.invoices where id = a.invoice_id for update;
      if not found or inv.customer_id <> p_customer_id then raise exception 'Invoice does not belong to this customer'; end if;
      if inv.status not in ('issued','due','partially_paid','overdue') then raise exception 'Invoice % cannot take payments (status %)', inv.invoice_no, inv.status; end if;
      if a.amount > inv.balance then raise exception 'Allocation % exceeds the balance of %', public.money_text(a.amount), inv.invoice_no; end if;
      if a.amount > v_left then raise exception 'Allocations exceed the payment amount'; end if;
      insert into public.payment_allocations (payment_id, invoice_id, amount) values (v_pid, inv.id, a.amount);
      v_left := v_left - a.amount; v_total_alloc := v_total_alloc + a.amount;
    end loop;
  end if;

  v_lines := jsonb_build_array(jsonb_build_object('account_id', public.bank_ledger_account(v_bank), 'debit', p_amount, 'description', 'Payment ' || coalesce(p_reference, ''), 'customer_id', p_customer_id));
  for a in select pa.invoice_id, pa.amount, i.invoice_no from public.payment_allocations pa join public.invoices i on i.id = pa.invoice_id where pa.payment_id = v_pid order by pa.created_at loop
    v_lines := v_lines || jsonb_build_object('account_id', public.rule_credit('payment_received'), 'credit', a.amount, 'description', 'Payment for ' || a.invoice_no,
      'customer_id', p_customer_id, 'invoice_id', a.invoice_id);
    perform public.refresh_invoice_status(a.invoice_id);
    if v_first_inv is null then v_first_inv := a.invoice_id; end if;
    v_inv_nos := v_inv_nos || case when v_inv_nos = '' then '' else ', ' end || a.invoice_no;
    select balance into v_alloc from public.invoices where id = a.invoice_id;
    v_bal := v_bal + v_alloc;
  end loop;
  if v_left > 0 then
    v_lines := v_lines || jsonb_build_object('account_id', public.rule_credit('customer_overpayment'), 'credit', v_left, 'description', 'Customer credit (overpayment)', 'customer_id', p_customer_id);
    insert into public.customer_credits (customer_id, source_type, payment_id, amount) values (p_customer_id, 'overpayment', v_pid, v_left);
  end if;
  v_j := public._post_journal(p_date, 'Payment received – ' || c.display_name, 'payment', v_pid, 'payment_received', v_lines);
  update public.payments set journal_entry_id = v_j, allocated_amount = v_total_alloc, unallocated_amount = v_left where id = v_pid;

  v_rno := public.next_doc_no('receipt', p_date);
  insert into public.receipts (receipt_no, payment_id, customer_id, amount) values (v_rno, v_pid, p_customer_id, p_amount) returning id into v_rid;

  v_survey := public.get_or_create_survey_invitation(v_first_inv, v_pid, p_customer_id);
  if v_first_inv is null then
    select coalesce(sum(balance), 0) into v_bal from public.invoices where customer_id = p_customer_id and status in ('issued','due','partially_paid','overdue');
  end if;
  v_vars := jsonb_build_object('amount', public.money_text(p_amount), 'invoice_no', case when v_inv_nos = '' then 'your account' else v_inv_nos end,
    'receipt_no', v_rno, 'receipt_link', public.receipt_link(v_rid), 'balance', public.money_text(v_bal),
    'survey_link', coalesce(public.survey_link(v_survey), ''));
  perform public.queue_notification('payment_received', 'sms', c.display_name, coalesce(c.phone, c.company_phone), null, v_vars, c.id, null, 'customer', 'receipt', v_rid);
  perform public.queue_notification('payment_received', 'email', c.display_name, null, coalesce(c.email, c.company_email), v_vars, c.id, null, 'customer', 'receipt', v_rid);
  return jsonb_build_object('payment_id', v_pid, 'receipt_id', v_rid, 'receipt_no', v_rno, 'allocated', v_total_alloc, 'unallocated', v_left, 'survey_invitation_id', v_survey);
end $$;

create or replace function public.apply_customer_credit(p_credit_id uuid, p_invoice_id uuid, p_amount numeric) returns uuid
language plpgsql security definer set search_path = public as $$
declare cr public.customer_credits; i public.invoices; v_id uuid; v_j uuid;
begin
  perform public.require_role(array['accountant']);
  select * into cr from public.customer_credits where id = p_credit_id for update;
  select * into i from public.invoices where id = p_invoice_id for update;
  if cr.id is null or i.id is null then raise exception 'Credit or invoice not found'; end if;
  if cr.customer_id <> i.customer_id then raise exception 'Credit and invoice belong to different customers'; end if;
  if i.status not in ('issued','due','partially_paid','overdue') then raise exception 'Invoice cannot take payments'; end if;
  p_amount := round(p_amount, 2);
  if p_amount <= 0 or p_amount > cr.amount - cr.amount_used or p_amount > i.balance then
    raise exception 'Amount must not exceed the available credit (%) or the invoice balance (%)', public.money_text(cr.amount - cr.amount_used), public.money_text(i.balance);
  end if;
  update public.customer_credits set amount_used = amount_used + p_amount where id = p_credit_id;
  insert into public.customer_credit_applications (credit_id, invoice_id, amount) values (p_credit_id, p_invoice_id, p_amount) returning id into v_id;
  v_j := public._post_journal(current_date, 'Customer credit applied to ' || i.invoice_no, 'credit_application', v_id, 'credit_applied',
    jsonb_build_array(
      jsonb_build_object('account_id', public.rule_debit('credit_applied'), 'debit', p_amount, 'customer_id', i.customer_id, 'invoice_id', i.id),
      jsonb_build_object('account_id', public.rule_credit('credit_applied'), 'credit', p_amount, 'customer_id', i.customer_id, 'invoice_id', i.id)));
  update public.customer_credit_applications set journal_entry_id = v_j where id = v_id;
  perform public.refresh_invoice_status(p_invoice_id);
  return v_id;
end $$;

create or replace function public.refund_customer_credit(p_credit_id uuid, p_amount numeric, p_bank_account_id uuid, p_method text, p_reference text) returns uuid
language plpgsql security definer set search_path = public as $$
declare cr public.customer_credits; v_id uuid; v_j uuid; v_no text;
begin
  perform public.require_role(array['accountant']);
  select * into cr from public.customer_credits where id = p_credit_id for update;
  if not found then raise exception 'Credit not found'; end if;
  p_amount := round(p_amount, 2);
  if p_amount <= 0 or p_amount > cr.amount - cr.amount_used then raise exception 'Refund exceeds the available credit'; end if;
  update public.customer_credits set amount_used = amount_used + p_amount where id = p_credit_id;
  v_no := public.next_doc_no('refund');
  insert into public.refunds (refund_no, credit_id, customer_id, amount, method_code, bank_account_id, reference)
  values (v_no, p_credit_id, cr.customer_id, p_amount, p_method, p_bank_account_id, p_reference) returning id into v_id;
  v_j := public._post_journal(current_date, 'Refund ' || v_no, 'refund', v_id, 'refund',
    jsonb_build_array(
      jsonb_build_object('account_id', public.rule_credit('customer_overpayment'), 'debit', p_amount, 'customer_id', cr.customer_id),
      jsonb_build_object('account_id', public.bank_ledger_account(p_bank_account_id), 'credit', p_amount, 'customer_id', cr.customer_id)));
  update public.refunds set journal_entry_id = v_j where id = v_id;
  return v_id;
end $$;

-- =====================================================================================
-- 6. Fleet
-- =====================================================================================
create or replace function public._apply_truck_status(p_truck_id uuid, p_status text, p_reason text, p_return date, p_note text) returns void
language plpgsql security definer set search_path = public as $$
declare t public.trucks;
begin
  select * into t from public.trucks where id = p_truck_id for update;
  if t.status = p_status and p_status <> 'off_road' then return; end if;
  update public.trucks set status = p_status,
    off_road_reason = case when p_status = 'off_road' then p_reason end,
    expected_return_date = case when p_status = 'off_road' then p_return end,
    status_note = case when p_status = 'off_road' then p_note else status_note end,
    status_changed_at = now()
  where id = p_truck_id;
  insert into public.truck_status_history (truck_id, from_status, to_status, reason, expected_return_date, note)
  values (p_truck_id, t.status, p_status, p_reason, p_return, p_note);
end $$;

-- RPC: change a truck's status. Going Off-Road flags future bookings and notifies officers + Fleet Manager.
create or replace function public.set_truck_status(p_truck_id uuid, p_status text, p_reason text default null,
  p_expected_return date default null, p_note text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare t public.trucks; r record; n int := 0; v_vars jsonb;
begin
  perform public.require_role(array['fleet_manager']);
  if p_status not in ('on_road','off_road') then raise exception 'Status must be on_road or off_road'; end if;
  select * into t from public.trucks where id = p_truck_id;
  if not found then raise exception 'Truck not found'; end if;
  if p_status = 'off_road' then
    if p_reason is null or p_reason not in ('breakdown','preventive_maintenance','accident','awaiting_parts','documents_expired') then
      raise exception 'Off-Road needs a reason: breakdown, preventive_maintenance, accident, awaiting_parts or documents_expired'; end if;
    if p_expected_return is null then raise exception 'Off-Road needs an expected return date'; end if;
    if coalesce(btrim(p_note), '') = '' then raise exception 'Off-Road needs a note'; end if;
  end if;
  if p_status = 'on_road' and t.status = 'on_job' then return jsonb_build_object('flagged', 0); end if;
  perform public._apply_truck_status(p_truck_id, p_status, p_reason, p_expected_return, p_note);

  if p_status = 'off_road' then
    for r in
      select distinct j.id, j.job_no, j.execution_date, j.officer_id, j.raised_by, j.customer_name
      from public.job_orders j join public.job_order_assignments a on a.job_order_id = j.id and a.kind = 'truck' and a.truck_id = p_truck_id
      where j.status in ('draft','pending_approval','approved','on_hold') and coalesce(j.end_date, j.execution_date) >= current_date
    loop
      n := n + 1;
      update public.job_orders set needs_reassignment = true,
        reassignment_note = 'Truck ' || t.registration_no || ' is Off-Road (' || replace(p_reason, '_', ' ') || ') until ' || public.date_text(p_expected_return)
      where id = r.id;
      v_vars := jsonb_build_object('job_no', r.job_no, 'truck_reg', t.registration_no, 'date', public.date_text(r.execution_date), 'customer_name', r.customer_name);
      perform public.notify_profile(coalesce(r.officer_id, r.raised_by), 'Reassign truck for ' || r.job_no,
        'Truck ' || t.registration_no || ' went Off-Road. Job ' || r.job_no || ' on ' || public.date_text(r.execution_date) || ' needs another truck.',
        '/jobs/' || r.id, 'warning', 'truck-off-' || r.id || '-' || p_truck_id || '-' || current_date);
      perform public.queue_notification('truck_off_road', 'sms', p.full_name, p.phone, null, v_vars || jsonb_build_object('officer_name', p.full_name),
        null, p.id, 'officer', 'job_order', r.id, 'truck-off-sms-' || r.id || '-' || p_truck_id || '-' || current_date)
        from public.profiles p where p.id = coalesce(r.officer_id, r.raised_by);
    end loop;
    if n > 0 then
      perform public.notify_role('fleet_manager', 'Truck ' || t.registration_no || ' Off-Road with bookings', n || ' job order(s) need another truck.', '/fleet/trucks/' || t.id, 'warning');
      perform public.queue_role_message('fleet_manager', 'truck_off_road', jsonb_build_object('job_no', n || ' job(s)', 'truck_reg', t.registration_no, 'date', public.date_text(current_date)),
        'truck', t.id, 'truck-off-fm-' || t.id || '-' || current_date);
    end if;
  end if;
  return jsonb_build_object('flagged', n);
end $$;

-- Truck picker: availability for a date range and type.
create or replace function public.get_truck_availability(p_from date, p_to date, p_type text default null, p_exclude_job uuid default null)
returns table (truck_id uuid, registration_no text, fleet_code text, truck_type text, status text, off_road_reason text,
  expected_return_date date, driver_id uuid, driver_name text, capacity text, bookings jsonb, available boolean, reason text)
language sql stable security definer set search_path = public as $$
  select t.id, t.registration_no, t.fleet_code, t.truck_type, t.status, t.off_road_reason, t.expected_return_date,
    e.id, e.full_name,
    case when t.capacity_litres is not null then trim(to_char(t.capacity_litres, 'FM999,999')) || ' L'
         when t.capacity_cabins is not null then t.capacity_cabins || ' cabins' else null end,
    coalesce((select jsonb_agg(jsonb_build_object('job_id', j.id, 'job_no', j.job_no, 'customer', j.customer_name, 'from', lower(b.period), 'to', upper(b.period) - 1) order by lower(b.period))
              from public.truck_bookings b join public.job_orders j on j.id = b.job_order_id
              where b.truck_id = t.id and b.active and b.period && daterange(p_from, p_to, '[]') and b.job_order_id is distinct from p_exclude_job), '[]'::jsonb),
    (t.status <> 'off_road' and not exists (select 1 from public.truck_bookings b where b.truck_id = t.id and b.active
        and b.period && daterange(p_from, p_to, '[]') and b.job_order_id is distinct from p_exclude_job)),
    case when t.status = 'off_road' then 'Off-Road: ' || replace(t.off_road_reason, '_', ' ') || coalesce(' until ' || public.date_text(t.expected_return_date), '')
         when exists (select 1 from public.truck_bookings b where b.truck_id = t.id and b.active and b.period && daterange(p_from, p_to, '[]') and b.job_order_id is distinct from p_exclude_job)
           then 'Booked on these dates' else null end
  from public.trucks t left join public.employees e on e.id = t.assigned_driver_id
  where t.archived_at is null and (p_type is null or t.truck_type = p_type)
    and (public.has_any_role(array['ops_officer','sales_exec','manager','fleet_manager','executive','accountant']) or auth.uid() is null)
  order by (t.status = 'off_road'), t.registration_no
$$;

-- =====================================================================================
-- 7. Job orders
-- =====================================================================================
create or replace function public.recalc_job_order(p_job_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_sub numeric; v_disc numeric; v_taxable numeric; v_net numeric; v_tax numeric;
begin
  update public.job_order_lines set line_total = round(quantity * unit_price, 2) - discount
    where job_order_id = p_job_id and line_total is distinct from round(quantity * unit_price, 2) - discount;
  select coalesce(sum(round(quantity * unit_price, 2)), 0), coalesce(sum(discount), 0),
         coalesce(sum(line_total) filter (where taxable), 0), coalesce(sum(line_total), 0)
    into v_sub, v_disc, v_taxable, v_net from public.job_order_lines where job_order_id = p_job_id;
  select coalesce(sum(amount), 0) into v_tax from public.compute_taxes(v_taxable);
  update public.job_orders set subtotal = v_sub, discount_total = v_disc, tax_total = v_tax, agreed_amount = v_net + v_tax where id = p_job_id;
end $$;

create or replace function public.customer_outstanding(p_customer_id uuid) returns numeric
language sql stable security definer set search_path = public as $$
  select coalesce(sum(balance), 0) from public.invoices where customer_id = p_customer_id and status in ('issued','due','partially_paid','overdue')
$$;

-- Checks shared by submit and approve. Returns warnings; raises on blocking problems.
create or replace function public._check_job_order(p_job_id uuid) returns text[]
language plpgsql security definer set search_path = public as $$
declare j public.job_orders; c public.customers; v_warn text[] := '{}'; v_req text[]; r record; v_period daterange; v_errors text[] := '{}';
begin
  select * into j from public.job_orders where id = p_job_id;
  select * into c from public.customers where id = j.customer_id;
  v_period := daterange(j.execution_date, coalesce(j.end_date, j.execution_date), '[]');
  if c.status = 'blacklisted' then raise exception 'Customer % is blacklisted', c.display_name; end if;
  if c.archived_at is not null then raise exception 'Customer % is archived', c.display_name; end if;
  if not exists (select 1 from public.job_order_lines where job_order_id = p_job_id) then raise exception 'Add at least one service line'; end if;
  if j.agreed_amount <= 0 then raise exception 'The agreed amount must be greater than zero'; end if;
  if c.credit_limit > 0 and public.customer_outstanding(c.id) + j.agreed_amount > c.credit_limit then
    v_warn := v_warn || ('Customer is over the credit limit of GH₵ ' || public.money_text(c.credit_limit) || ' (outstanding GH₵ ' || public.money_text(public.customer_outstanding(c.id)) || ')');
  end if;
  select array_agg(distinct s.required_truck_type) filter (where s.requires_truck and s.required_truck_type is not null) into v_req
  from public.job_order_lines l join public.services s on s.id = l.service_id where l.job_order_id = p_job_id;
  if exists (select 1 from public.job_order_lines l join public.services s on s.id = l.service_id where l.job_order_id = p_job_id and s.requires_truck)
     and not exists (select 1 from public.job_order_assignments where job_order_id = p_job_id and kind = 'truck') then
    v_errors := v_errors || 'This service needs a truck. Assign one.'::text;
  end if;
  for r in select t.* from public.job_order_assignments a join public.trucks t on t.id = a.truck_id where a.job_order_id = p_job_id and a.kind = 'truck' loop
    if r.status = 'off_road' then v_errors := v_errors || ('Truck ' || r.registration_no || ' is Off-Road'); end if;
    if r.archived_at is not null then v_errors := v_errors || ('Truck ' || r.registration_no || ' is archived'); end if;
    if v_req is not null and array_length(v_req, 1) > 0 and not (r.truck_type = any(v_req)) then
      v_errors := v_errors || ('Truck ' || r.registration_no || ' is a ' || replace(r.truck_type, '_', ' ') || '; the service needs ' || replace(array_to_string(v_req, ' or '), '_', ' '));
    end if;
    if exists (select 1 from public.truck_bookings b where b.truck_id = r.id and b.active and b.period && v_period and b.job_order_id <> p_job_id) then
      v_errors := v_errors || ('Truck ' || r.registration_no || ' is already booked: ' ||
        (select string_agg(jj.job_no || ' (' || public.date_text(lower(b.period)) || ')', ', ') from public.truck_bookings b join public.job_orders jj on jj.id = b.job_order_id
         where b.truck_id = r.id and b.active and b.period && v_period and b.job_order_id <> p_job_id));
    end if;
    if exists (select 1 from public.job_order_assignments a2 join public.job_orders j2 on j2.id = a2.job_order_id
               where a2.truck_id = r.id and a2.kind = 'truck' and j2.id <> p_job_id and j2.status = 'pending_approval'
                 and daterange(j2.execution_date, coalesce(j2.end_date, j2.execution_date), '[]') && v_period) then
      v_warn := v_warn || ('Truck ' || r.registration_no || ' is also on another job awaiting approval for these dates');
    end if;
  end loop;
  for r in select e.* , a.kind from public.job_order_assignments a join public.employees e on e.id = a.employee_id where a.job_order_id = p_job_id and a.kind in ('driver','crew') loop
    if r.status <> 'active' then v_errors := v_errors || (r.full_name || ' is not active'); end if;
    if r.kind = 'driver' and (r.licence_expiry is null or r.licence_expiry < coalesce(j.end_date, j.execution_date)) then
      v_errors := v_errors || ('Driver ' || r.full_name || ' has no valid licence for the job dates');
    end if;
    if exists (select 1 from public.employee_bookings b where b.employee_id = r.id and b.active and b.period && v_period and b.job_order_id <> p_job_id) then
      v_errors := v_errors || (r.full_name || ' is already booked: ' ||
        (select string_agg(jj.job_no, ', ') from public.employee_bookings b join public.job_orders jj on jj.id = b.job_order_id
         where b.employee_id = r.id and b.active and b.period && v_period and b.job_order_id <> p_job_id));
    end if;
  end loop;
  if array_length(v_errors, 1) > 0 then raise exception '%', array_to_string(v_errors, E'\n') using errcode = 'P0001'; end if;
  return v_warn;
end $$;

create or replace function public.submit_job_order(p_job_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare j public.job_orders; v_warn text[];
begin
  perform public.require_role(array['ops_officer','sales_exec','manager']);
  select * into j from public.job_orders where id = p_job_id for update;
  if not found then raise exception 'Job order not found'; end if;
  if j.status <> 'draft' then raise exception 'Only draft job orders can be submitted (current status: %)', j.status; end if;
  perform public.recalc_job_order(p_job_id);
  v_warn := public._check_job_order(p_job_id);
  update public.job_orders set status = 'pending_approval', submitted_at = now(), rejection_reason = null,
    credit_warning = exists (select 1 from unnest(v_warn) w where w like 'Customer is over the credit limit%'), needs_reassignment = false
  where id = p_job_id;
  perform public.notify_role('manager', 'Job ' || j.job_no || ' awaiting approval', coalesce(j.customer_name, '') || ' – ' || public.date_text(j.execution_date), '/jobs/' || j.id, 'info', 'job-submit-' || j.id || '-' || now()::text);
  return jsonb_build_object('status', 'pending_approval', 'warnings', to_jsonb(v_warn));
end $$;

create or replace function public._job_vars(p_job_id uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('job_no', j.job_no, 'customer_name', j.customer_name,
    'service', coalesce((select string_agg(s.name, ', ' order by l.sort_order) from public.job_order_lines l join public.services s on s.id = l.service_id where l.job_order_id = j.id), ''),
    'date', public.date_text(j.execution_date), 'time_window', coalesce(j.time_window, ''),
    'site', coalesce(j.site_address, '') || coalesce(' (' || j.digital_address || ')', ''),
    'truck_reg', coalesce((select string_agg(t.registration_no, ', ') from public.job_order_assignments a join public.trucks t on t.id = a.truck_id where a.job_order_id = j.id and a.kind = 'truck'), ''),
    'driver_name', coalesce((select string_agg(e.full_name, ', ') from public.job_order_assignments a join public.employees e on e.id = a.employee_id where a.job_order_id = j.id and a.kind = 'driver'), ''),
    'driver_phone', coalesce((select string_agg(e.phone, ', ') from public.job_order_assignments a join public.employees e on e.id = a.employee_id where a.job_order_id = j.id and a.kind = 'driver'), ''),
    'officer_name', coalesce((select full_name from public.profiles where id = coalesce(j.officer_id, j.raised_by)), ''),
    'amount', public.money_text(j.agreed_amount),
    'invoice_no', coalesce((select invoice_no from public.invoices where id = j.invoice_id), ''),
    'invoice_link', coalesce(public.invoice_link(j.invoice_id), ''))
  from public.job_orders j where j.id = p_job_id
$$;

-- message the customer, the driver(s) and/or the officer for a job event
create or replace function public._job_messages(p_job_id uuid, p_event text, p_customer boolean, p_driver boolean, p_officer boolean, p_dedupe text default null) returns int
language plpgsql security definer set search_path = public as $$
declare j public.job_orders; c public.customers; ct public.customer_contacts; v_vars jsonb; r record; n int := 0; v_phone text; v_name text;
begin
  select * into j from public.job_orders where id = p_job_id;
  select * into c from public.customers where id = j.customer_id;
  v_vars := public._job_vars(p_job_id);
  if p_customer then
    if j.contact_id is not null then select * into ct from public.customer_contacts where id = j.contact_id; end if;
    v_phone := coalesce(ct.phone, c.phone, c.company_phone); v_name := coalesce(ct.name, c.display_name);
    if public.queue_notification(p_event, 'sms', v_name, v_phone, null, v_vars || jsonb_build_object('customer_name', v_name), c.id, null, 'customer', 'job_order', j.id,
         case when p_dedupe is null then null else p_dedupe || ':c' end) is not null then n := n + 1; end if;
    perform public.queue_notification(p_event, 'email', v_name, null, coalesce(ct.email, c.email, c.company_email), v_vars || jsonb_build_object('customer_name', v_name), c.id, null, 'customer', 'job_order', j.id,
         case when p_dedupe is null then null else p_dedupe || ':ce' end);
  end if;
  if p_driver then
    for r in select e.* from public.job_order_assignments a join public.employees e on e.id = a.employee_id where a.job_order_id = j.id and a.kind = 'driver' loop
      if public.queue_notification(p_event || '_driver', 'sms', r.full_name, r.phone, null, v_vars || jsonb_build_object('driver_name', r.full_name), null, r.profile_id, 'driver', 'job_order', j.id,
           case when p_dedupe is null then null else p_dedupe || ':d:' || r.id end) is not null then n := n + 1; end if;
    end loop;
  end if;
  if p_officer then
    for r in select * from public.profiles where id = j.raised_by loop
      if public.queue_notification(p_event || '_officer', 'sms', r.full_name, r.phone, null, v_vars || jsonb_build_object('officer_name', r.full_name), null, r.id, 'officer', 'job_order', j.id,
           case when p_dedupe is null then null else p_dedupe || ':o' end) is not null then n := n + 1; end if;
    end loop;
  end if;
  return n;
end $$;

create or replace function public.approve_job_order(p_job_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare j public.job_orders; c public.customers; v_inv uuid; v_period daterange; r record; s public.company_settings; v_warn text[]; v_sms int;
begin
  perform public.require_role(array['manager']);
  s := public.app_settings();
  select * into j from public.job_orders where id = p_job_id for update;
  if not found then raise exception 'Job order not found'; end if;
  if j.status <> 'pending_approval' then raise exception 'Only job orders pending approval can be approved (current status: %)', j.status; end if;
  if s.segregation_of_duties and j.raised_by = public.current_profile_id() then
    raise exception 'Segregation of duties: you raised this job order, so another manager must approve it' using errcode = '42501';
  end if;
  perform public.recalc_job_order(p_job_id);
  v_warn := public._check_job_order(p_job_id);
  select * into j from public.job_orders where id = p_job_id;
  select * into c from public.customers where id = j.customer_id;
  v_period := daterange(j.execution_date, coalesce(j.end_date, j.execution_date), '[]');
  begin
    for r in select truck_id from public.job_order_assignments where job_order_id = p_job_id and kind = 'truck' loop
      insert into public.truck_bookings (truck_id, job_order_id, period) values (r.truck_id, p_job_id, v_period);
    end loop;
    for r in select distinct employee_id from public.job_order_assignments where job_order_id = p_job_id and kind in ('driver','crew') loop
      insert into public.employee_bookings (employee_id, job_order_id, period) values (r.employee_id, p_job_id, v_period);
    end loop;
  exception when exclusion_violation then
    raise exception 'A truck or staff member on this job is already booked for these dates. Reassign and resubmit.' using errcode = '23P01';
  end;
  -- invoice for the agreed amount: "Issued – not yet due", revenue deferred until completion
  insert into public.invoices (source, customer_id, customer_name, job_order_id, contract_id, issue_date, notes)
  values ('job', j.customer_id, c.display_name, j.id, j.contract_id, current_date, 'Job order ' || j.job_no) returning id into v_inv;
  insert into public.invoice_lines (invoice_id, service_id, description, quantity, unit_price, discount, taxable, sort_order)
  select v_inv, l.service_id, coalesce(nullif(l.description, ''), s2.name), l.quantity, l.unit_price, l.discount, l.taxable, l.sort_order
  from public.job_order_lines l join public.services s2 on s2.id = l.service_id where l.job_order_id = p_job_id;
  perform public._issue_invoice(v_inv, 'job_approved', true, null);
  update public.job_orders set status = 'approved', approved_by = public.current_profile_id(), approved_at = now(), invoice_id = v_inv where id = p_job_id;
  v_sms := public._job_messages(p_job_id, 'job_approved', true, true, true);
  perform public.notify_profile(j.raised_by, 'Job ' || j.job_no || ' approved', 'Scheduled for ' || public.date_text(j.execution_date), '/jobs/' || j.id, 'success');
  return jsonb_build_object('status', 'approved', 'invoice_id', v_inv, 'sms_queued', v_sms, 'warnings', to_jsonb(v_warn));
end $$;

create or replace function public.reject_job_order(p_job_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare j public.job_orders;
begin
  perform public.require_role(array['manager']);
  if coalesce(btrim(p_reason), '') = '' then raise exception 'A rejection reason is required'; end if;
  select * into j from public.job_orders where id = p_job_id for update;
  if j.status <> 'pending_approval' then raise exception 'Only job orders pending approval can be rejected'; end if;
  update public.job_orders set status = 'draft', rejection_reason = p_reason where id = p_job_id;
  insert into public.job_order_status_history (job_order_id, from_status, to_status, note) values (p_job_id, 'pending_approval', 'rejected', p_reason);
  perform public.queue_notification('job_rejected_officer', 'sms', p.full_name, p.phone, null, public._job_vars(p_job_id) || jsonb_build_object('reason', p_reason, 'officer_name', p.full_name),
    null, p.id, 'officer', 'job_order', p_job_id) from public.profiles p where p.id = j.raised_by;
  perform public.notify_profile(j.raised_by, 'Job ' || j.job_no || ' rejected', p_reason, '/jobs/' || j.id, 'danger');
end $$;

create or replace function public.start_job_order(p_job_id uuid, p_lat numeric default null, p_lng numeric default null) returns void
language plpgsql security definer set search_path = public as $$
declare j public.job_orders; r record;
begin
  perform public.require_role(array['ops_officer','manager']);
  select * into j from public.job_orders where id = p_job_id for update;
  if not found then raise exception 'Job order not found'; end if;
  if j.status <> 'approved' then raise exception 'Only approved job orders can be started (current status: %)', j.status; end if;
  if current_date < j.execution_date then raise exception 'This job can only be started from % onwards', public.date_text(j.execution_date); end if;
  if j.needs_reassignment then raise exception 'Reassign the Off-Road truck before starting'; end if;
  update public.job_orders set status = 'in_progress', started_at = now(), started_by = public.current_profile_id(), start_lat = p_lat, start_lng = p_lng where id = p_job_id;
  for r in select truck_id from public.job_order_assignments where job_order_id = p_job_id and kind = 'truck' loop
    perform public._apply_truck_status(r.truck_id, 'on_job', null, null, 'On job ' || j.job_no);
  end loop;
end $$;

-- p_actuals: [{category, cost_item_id, employee_id, description, quantity, unit_cost, stock_location_id}]
create or replace function public.complete_job_order(p_job_id uuid, p_signoff_name text, p_signature_path text default null,
  p_notes text default null, p_actuals jsonb default '[]'::jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare j public.job_orders; i public.invoices; c public.customers; a jsonb; r record; v_lines jsonb := '[]'::jsonb; v_deferred numeric;
  v_net numeric; v_done numeric := 0; v_cnt int; v_k int := 0; v_amt numeric; v_due date;
begin
  perform public.require_role(array['ops_officer','manager']);
  select * into j from public.job_orders where id = p_job_id for update;
  if not found then raise exception 'Job order not found'; end if;
  if j.status <> 'in_progress' then raise exception 'Only jobs in progress can be completed (current status: %)', j.status; end if;
  if coalesce(btrim(p_signoff_name), '') = '' then raise exception 'Customer sign-off name is required'; end if;
  for a in select * from jsonb_array_elements(coalesce(p_actuals, '[]'::jsonb)) loop
    insert into public.job_order_actual_costs (job_order_id, category, cost_item_id, employee_id, description, quantity, unit_cost, stock_location_id)
    values (p_job_id, a->>'category', nullif(a->>'cost_item_id', '')::uuid, nullif(a->>'employee_id', '')::uuid, coalesce(a->>'description', 'Actual cost'),
      coalesce((a->>'quantity')::numeric, 1), coalesce((a->>'unit_cost')::numeric, 0), nullif(a->>'stock_location_id', '')::uuid);
  end loop;
  select * into c from public.customers where id = j.customer_id;
  select * into i from public.invoices where id = j.invoice_id for update;
  v_due := current_date + coalesce(c.payment_terms_days, 7);
  if i.id is not null and i.revenue_deferred then
    -- recognise what is still deferred for this invoice (net of any credit notes), line by line
    select coalesce(sum(jl.credit - jl.debit), 0) into v_deferred from public.journal_lines jl
      where jl.invoice_id = i.id and jl.account_id = public.rule_credit('job_approved');
    v_net := i.total - i.tax_total;
    select count(*) into v_cnt from public.invoice_lines where invoice_id = i.id;
    if v_deferred > 0 then
      for r in select il.*, s.revenue_account_id as svc_acct from public.invoice_lines il left join public.services s on s.id = il.service_id where il.invoice_id = i.id order by il.sort_order, il.id loop
        v_k := v_k + 1;
        v_amt := case when v_k = v_cnt then v_deferred - v_done else round(v_deferred * r.line_total / nullif(v_net, 0), 2) end;
        v_done := v_done + v_amt;
        v_lines := v_lines
          || jsonb_build_object('account_id', public.rule_debit('job_completed'), 'debit', v_amt, 'description', 'Recognise ' || i.invoice_no, 'customer_id', i.customer_id, 'job_order_id', j.id, 'service_id', r.service_id, 'invoice_id', i.id)
          || jsonb_build_object('account_id', coalesce(r.revenue_account_id, r.svc_acct, public.rule_credit('job_completed')), 'credit', v_amt, 'description', coalesce(r.description, 'Service revenue'), 'customer_id', i.customer_id, 'job_order_id', j.id, 'service_id', r.service_id, 'invoice_id', i.id);
      end loop;
      perform public._post_journal(current_date, 'Revenue recognised – job ' || j.job_no, 'job_order', j.id, 'job_completed', v_lines);
    end if;
    update public.invoices set revenue_deferred = false, revenue_recognised_at = now(), due_date = v_due where id = i.id;
    perform public.refresh_invoice_status(i.id);
  end if;
  update public.job_orders set status = 'completed', completed_at = now(), completed_by = public.current_profile_id(),
    signoff_name = p_signoff_name, signature_path = p_signature_path, completion_notes = p_notes where id = p_job_id;
  for r in select truck_id from public.job_order_assignments where job_order_id = p_job_id and kind = 'truck' loop
    if not exists (select 1 from public.job_order_assignments a2 join public.job_orders j2 on j2.id = a2.job_order_id
                   where a2.truck_id = r.truck_id and a2.kind = 'truck' and j2.status = 'in_progress' and j2.id <> p_job_id) then
      perform public._apply_truck_status(r.truck_id, 'on_road', null, null, 'Completed ' || j.job_no);
    end if;
  end loop;
  perform public._job_messages(p_job_id, 'job_completed', true, false, false);
  if i.id is not null then perform public.refresh_invoice_status(i.id); end if; -- closes the job if already paid
  return jsonb_build_object('status', (select status from public.job_orders where id = p_job_id), 'due_date', v_due);
end $$;

create or replace function public.cancel_job_order(p_job_id uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare j public.job_orders; i public.invoices; v_cn uuid; r record;
begin
  perform public.require_role(array['manager']);
  if coalesce(btrim(p_reason), '') = '' then raise exception 'A cancellation reason is required'; end if;
  select * into j from public.job_orders where id = p_job_id for update;
  if j.status in ('completed','closed','cancelled') then raise exception 'A % job order cannot be cancelled', j.status; end if;
  if j.invoice_id is not null then
    select * into i from public.invoices where id = j.invoice_id;
    if i.total - i.amount_credited > 0 then
      v_cn := public._issue_credit_note(i.id, i.total - i.amount_credited, 'Job ' || j.job_no || ' cancelled: ' || p_reason);
    end if;
  end if;
  update public.truck_bookings set active = false where job_order_id = p_job_id;
  update public.employee_bookings set active = false where job_order_id = p_job_id;
  for r in select truck_id from public.job_order_assignments where job_order_id = p_job_id and kind = 'truck' loop
    if (select status from public.trucks where id = r.truck_id) = 'on_job' then perform public._apply_truck_status(r.truck_id, 'on_road', null, null, 'Cancelled ' || j.job_no); end if;
  end loop;
  update public.job_orders set status = 'cancelled', cancel_reason = p_reason, cancelled_at = now() where id = p_job_id;
  perform public.notify_profile(j.raised_by, 'Job ' || j.job_no || ' cancelled', p_reason, '/jobs/' || j.id, 'warning');
  return jsonb_build_object('status', 'cancelled', 'credit_note_id', v_cn);
end $$;

create or replace function public.hold_job_order(p_job_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare j public.job_orders;
begin
  perform public.require_role(array['manager']);
  if coalesce(btrim(p_reason), '') = '' then raise exception 'A reason is required'; end if;
  select * into j from public.job_orders where id = p_job_id for update;
  if j.status not in ('draft','pending_approval','approved') then raise exception 'Only draft, pending or approved jobs can be put on hold'; end if;
  update public.job_orders set held_from_status = status, status = 'on_hold', hold_reason = p_reason where id = p_job_id;
end $$;

create or replace function public.resume_job_order(p_job_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare j public.job_orders;
begin
  perform public.require_role(array['manager']);
  select * into j from public.job_orders where id = p_job_id for update;
  if j.status <> 'on_hold' then raise exception 'Job order is not on hold'; end if;
  update public.job_orders set status = coalesce(held_from_status, 'draft'), held_from_status = null where id = p_job_id;
end $$;

-- Replace a truck on an approved/pending job (e.g. after the original went Off-Road)
create or replace function public.reassign_job_truck(p_job_id uuid, p_old_truck uuid, p_new_truck uuid) returns void
language plpgsql security definer set search_path = public as $$
declare j public.job_orders; t public.trucks; v_period daterange;
begin
  perform public.require_role(array['ops_officer','manager']);
  select * into j from public.job_orders where id = p_job_id for update;
  if j.status not in ('draft','pending_approval','approved','on_hold') then raise exception 'Trucks can only be changed before the job starts'; end if;
  select * into t from public.trucks where id = p_new_truck;
  if t.status = 'off_road' then raise exception 'Truck % is Off-Road', t.registration_no; end if;
  v_period := daterange(j.execution_date, coalesce(j.end_date, j.execution_date), '[]');
  update public.job_order_assignments set truck_id = p_new_truck where job_order_id = p_job_id and kind = 'truck' and truck_id = p_old_truck;
  if not found then raise exception 'That truck is not on this job'; end if;
  if j.status in ('approved','on_hold') then
    update public.truck_bookings set active = false where job_order_id = p_job_id and truck_id = p_old_truck;
    begin
      insert into public.truck_bookings (truck_id, job_order_id, period) values (p_new_truck, p_job_id, v_period);
    exception when exclusion_violation then
      raise exception 'Truck % is already booked for these dates', t.registration_no using errcode = '23P01';
    end;
  end if;
  if not exists (select 1 from public.job_order_assignments a join public.trucks tt on tt.id = a.truck_id where a.job_order_id = p_job_id and a.kind = 'truck' and tt.status = 'off_road') then
    update public.job_orders set needs_reassignment = false, reassignment_note = null where id = p_job_id;
  end if;
end $$;

-- Driver mobile view: only the jobs assigned to the signed-in driver
create or replace function public.get_my_jobs(p_from date default current_date, p_to date default current_date + 7)
returns table (id uuid, job_no text, status text, execution_date date, end_date date, time_window text, customer_name text, customer_phone text,
  site_address text, digital_address text, site_lat numeric, site_lng numeric, instructions text, services text, trucks text, officer_name text, officer_phone text)
language sql stable security definer set search_path = public as $$
  select j.id, j.job_no, j.status, j.execution_date, j.end_date, j.time_window, j.customer_name,
    coalesce(ct.phone, c.phone, c.company_phone), j.site_address, j.digital_address, j.site_lat, j.site_lng, j.instructions,
    (select string_agg(s.name, ', ') from public.job_order_lines l join public.services s on s.id = l.service_id where l.job_order_id = j.id),
    (select string_agg(t.registration_no, ', ') from public.job_order_assignments a join public.trucks t on t.id = a.truck_id where a.job_order_id = j.id and a.kind = 'truck'),
    p.full_name, p.phone
  from public.job_orders j
  join public.customers c on c.id = j.customer_id
  left join public.customer_contacts ct on ct.id = j.contact_id
  left join public.profiles p on p.id = coalesce(j.officer_id, j.raised_by)
  where j.status in ('approved','in_progress','completed','closed')
    and coalesce(j.end_date, j.execution_date) >= p_from and j.execution_date <= p_to
    and exists (select 1 from public.job_order_assignments a join public.employees e on e.id = a.employee_id
                where a.job_order_id = j.id and a.kind in ('driver','crew') and e.profile_id = public.current_profile_id())
  order by j.execution_date, j.time_window
$$;

-- =====================================================================================
-- 8. Estimator
-- =====================================================================================
-- Cost of one estimate line. Must match src/lib/calc.ts exactly.
create or replace function public.estimate_line_cost(p_category text, p_basis text, p_quantity numeric, p_headcount numeric, p_days numeric,
  p_km numeric, p_unit_cost numeric, p_cost_per_trip numeric, p_cost_per_km numeric, p_cost_per_day numeric, p_rate_basis text,
  p_hours_per_day numeric, p_total_visits numeric) returns numeric
language sql immutable as $$
  select round(
    (case p_category
       when 'labour' then p_headcount * p_days * p_unit_cost * (case when p_rate_basis = 'hour' then p_hours_per_day else 1 end)
       when 'vehicle' then p_quantity * (p_cost_per_trip + p_km * p_cost_per_km) + p_days * p_cost_per_day
       when 'equipment' then p_quantity * p_days * p_unit_cost
       else p_quantity * p_unit_cost end)
    * (case when p_basis = 'per_visit' then p_total_visits else 1 end), 2)
$$;

create or replace function public.estimate_total_visits(p_is_recurring boolean, p_visits numeric, p_period text, p_months int) returns numeric
language sql immutable as $$
  select case when not p_is_recurring then 1
              when p_period = 'week' then round(p_visits * p_months * 52.0 / 12.0, 3)
              else round(p_visits * p_months, 3) end
$$;

-- BEFORE INSERT/UPDATE on estimates: compute every output from the lines.
create or replace function public.estimates_compute() returns trigger
language plpgsql security definer set search_path = public as $$
declare v record; v_thr numeric;
begin
  new.total_visits := public.estimate_total_visits(new.is_recurring, new.visits_per_period, new.visit_period, new.contract_months);
  select
    coalesce(sum(c) filter (where category = 'consumable'), 0) as consumable,
    coalesce(sum(c) filter (where category = 'equipment'), 0) as equipment,
    coalesce(sum(c) filter (where category = 'labour'), 0) as labour,
    coalesce(sum(c) filter (where category = 'vehicle'), 0) as vehicle,
    coalesce(sum(c) filter (where category = 'subcontract'), 0) as subcontract,
    coalesce(sum(c) filter (where category = 'overhead'), 0) as overhead
  into v from (
    select l.category, public.estimate_line_cost(l.category, l.basis, l.quantity, l.headcount, l.days, l.km, l.unit_cost, l.cost_per_trip,
      l.cost_per_km, l.cost_per_day, l.rate_basis, new.hours_per_day, new.total_visits) as c
    from public.estimate_lines l where l.estimate_id = new.id) x;
  new.cost_consumable := v.consumable; new.cost_equipment := v.equipment; new.cost_labour := v.labour;
  new.cost_vehicle := v.vehicle; new.cost_subcontract := v.subcontract; new.cost_overhead_items := v.overhead;
  new.direct_cost := v.consumable + v.equipment + v.labour + v.vehicle + v.subcontract + v.overhead;
  new.overhead_amount := round(new.direct_cost * new.overhead_pct / 100, 2);
  new.contingency_amount := round(new.direct_cost * new.contingency_pct / 100, 2);
  new.total_cost := new.direct_cost + new.overhead_amount + new.contingency_amount;
  new.break_even_price := new.total_cost;
  new.recommended_price := round(new.total_cost / (1 - new.target_margin_pct / 100), 2);
  new.profit := new.proposed_price - new.total_cost;
  new.margin_pct := case when new.proposed_price > 0 then round(new.profit / new.proposed_price * 100, 3) else 0 end;
  new.cost_per_visit := round(new.total_cost / nullif(new.total_visits, 0), 2);
  new.cost_per_day := round(new.total_cost / nullif(new.duration_days * new.total_visits, 0), 2);
  new.cost_per_month := case when new.is_recurring then round(new.total_cost / new.contract_months, 2) else new.total_cost end;
  new.price_warning := case when new.proposed_price > 0 and new.proposed_price < new.total_cost then 'below_cost'
                            when new.proposed_price > 0 and new.margin_pct < new.target_margin_pct then 'below_margin' else 'none' end;
  select estimate_margin_threshold into v_thr from public.company_settings where id = 1;
  new.requires_approval := new.proposed_price > 0 and new.margin_pct < coalesce(v_thr, 15);
  return new;
end $$;

create or replace function public.apply_estimate_template(p_estimate_id uuid, p_template_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare t public.estimate_templates; e public.estimates;
begin
  perform public.require_role(array['sales_exec','ops_officer','manager']);
  select * into e from public.estimates where id = p_estimate_id;
  if e.status not in ('draft','rejected') then raise exception 'Only draft estimates can be changed'; end if;
  select * into t from public.estimate_templates where id = p_template_id;
  if not found then raise exception 'Template not found'; end if;
  insert into public.estimate_lines (estimate_id, cost_item_id, category, description, unit_of_measure, basis, quantity, headcount, days, km,
    rate_basis, unit_cost, cost_per_trip, cost_per_km, cost_per_day, sort_order)
  select p_estimate_id, ci.id, ci.category, ci.name, ci.unit_of_measure, tl.basis, tl.quantity, tl.headcount, tl.days, tl.km,
    ci.rate_basis, ci.unit_cost, ci.cost_per_trip, ci.cost_per_km, ci.cost_per_day,
    coalesce((select max(sort_order) from public.estimate_lines where estimate_id = p_estimate_id), 0) + tl.sort_order + 1
  from public.estimate_template_lines tl join public.cost_items ci on ci.id = tl.cost_item_id where tl.template_id = p_template_id;
  update public.estimates set template_id = p_template_id, service_id = coalesce(service_id, t.service_id),
    duration_days = t.duration_days, hours_per_day = t.hours_per_day, is_recurring = t.is_recurring,
    visits_per_period = t.visits_per_period, visit_period = t.visit_period, contract_months = t.contract_months,
    overhead_pct = t.overhead_pct, contingency_pct = t.contingency_pct, target_margin_pct = t.target_margin_pct
  where id = p_estimate_id;
end $$;

create or replace function public.submit_estimate(p_estimate_id uuid) returns text
language plpgsql security definer set search_path = public as $$
declare e public.estimates;
begin
  perform public.require_role(array['sales_exec','ops_officer','manager']);
  update public.estimates set updated_at = now() where id = p_estimate_id; -- recompute
  select * into e from public.estimates where id = p_estimate_id for update;
  if e.status not in ('draft','rejected') then raise exception 'Only draft estimates can be submitted'; end if;
  if not exists (select 1 from public.estimate_lines where estimate_id = p_estimate_id) then raise exception 'Add cost lines first'; end if;
  if e.proposed_price <= 0 then raise exception 'Enter a proposed selling price'; end if;
  if e.requires_approval or e.price_warning = 'below_cost' then
    update public.estimates set status = 'pending_approval', rejection_reason = null where id = p_estimate_id;
    perform public.notify_role('manager', 'Estimate ' || e.estimate_no || ' v' || e.version || ' needs approval',
      'Margin ' || round(e.margin_pct, 1) || '% at GH₵ ' || public.money_text(e.proposed_price), '/estimates/' || e.id, 'warning');
    return 'pending_approval';
  end if;
  update public.estimates set status = 'approved', approved_at = now(), approved_by = null where id = p_estimate_id;
  return 'approved';
end $$;

create or replace function public.approve_estimate(p_estimate_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare e public.estimates;
begin
  perform public.require_role(array['manager']);
  select * into e from public.estimates where id = p_estimate_id for update;
  if e.status <> 'pending_approval' then raise exception 'Estimate is not pending approval'; end if;
  update public.estimates set status = 'approved', approved_by = public.current_profile_id(), approved_at = now() where id = p_estimate_id;
  perform public.notify_profile(e.created_by, 'Estimate ' || e.estimate_no || ' approved', null, '/estimates/' || e.id, 'success');
end $$;

create or replace function public.reject_estimate(p_estimate_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare e public.estimates;
begin
  perform public.require_role(array['manager']);
  if coalesce(btrim(p_reason), '') = '' then raise exception 'A reason is required'; end if;
  select * into e from public.estimates where id = p_estimate_id for update;
  if e.status <> 'pending_approval' then raise exception 'Estimate is not pending approval'; end if;
  update public.estimates set status = 'rejected', rejection_reason = p_reason where id = p_estimate_id;
  perform public.notify_profile(e.created_by, 'Estimate ' || e.estimate_no || ' rejected', p_reason, '/estimates/' || e.id, 'danger');
end $$;

create or replace function public.new_estimate_version(p_estimate_id uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare e public.estimates; v_id uuid; v_root uuid;
begin
  perform public.require_role(array['sales_exec','ops_officer','manager']);
  select * into e from public.estimates where id = p_estimate_id;
  if e.status in ('converted') then raise exception 'A converted estimate cannot get a new version'; end if;
  v_root := coalesce(e.root_id, e.id);
  insert into public.estimates (estimate_no, version, root_id, customer_id, lead_id, service_id, template_id, title, site, duration_days, hours_per_day,
    is_recurring, visits_per_period, visit_period, contract_months, overhead_pct, contingency_pct, target_margin_pct, tax_pct, proposed_price, notes)
  values (e.estimate_no, (select max(version) + 1 from public.estimates where coalesce(root_id, id) = v_root), v_root, e.customer_id, e.lead_id,
    e.service_id, e.template_id, e.title, e.site, e.duration_days, e.hours_per_day, e.is_recurring, e.visits_per_period, e.visit_period,
    e.contract_months, e.overhead_pct, e.contingency_pct, e.target_margin_pct, e.tax_pct, e.proposed_price, e.notes)
  returning id into v_id;
  insert into public.estimate_lines (estimate_id, cost_item_id, category, description, unit_of_measure, basis, quantity, headcount, days, km,
    rate_basis, unit_cost, cost_per_trip, cost_per_km, cost_per_day, sort_order)
  select v_id, cost_item_id, category, description, unit_of_measure, basis, quantity, headcount, days, km, rate_basis, unit_cost,
    cost_per_trip, cost_per_km, cost_per_day, sort_order from public.estimate_lines where estimate_id = p_estimate_id;
  update public.estimates set status = 'superseded' where id = p_estimate_id and status in ('draft','rejected','approved','pending_approval');
  return v_id;
end $$;

create or replace function public.create_quotation(p_estimate_id uuid, p_valid_days int default 30, p_terms text default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare e public.estimates; v_id uuid; v_tax numeric; v_name text;
begin
  perform public.require_role(array['sales_exec','ops_officer','manager']);
  select * into e from public.estimates where id = p_estimate_id for update;
  if e.status not in ('approved','quoted') then raise exception 'The estimate must be approved before quoting'; end if;
  if e.tax_pct > 0 then v_tax := round(e.proposed_price * e.tax_pct / 100, 2);
  else select coalesce(sum(amount), 0) into v_tax from public.compute_taxes(e.proposed_price); end if;
  select name into v_name from public.services where id = e.service_id;
  insert into public.quotations (quote_no, estimate_id, customer_id, lead_id, title, description, valid_until, amount, tax_amount, total, terms, status)
  values (public.next_doc_no('quotation'), e.id, e.customer_id, e.lead_id, coalesce(e.title, v_name),
    case when e.is_recurring then v_name || ' – ' || e.visits_per_period || ' visit(s) per ' || e.visit_period || ' for ' || e.contract_months || ' month(s). Monthly fee GH₵ ' || public.money_text(round(e.proposed_price / e.contract_months, 2))
         else v_name || coalesce(' at ' || e.site, '') end,
    current_date + p_valid_days, e.proposed_price, v_tax, e.proposed_price + v_tax, p_terms, 'sent')
  returning id into v_id;
  update public.estimates set status = 'quoted' where id = e.id;
  if e.lead_id is not null then update public.leads set stage = 'estimate_sent' where id = e.lead_id and stage in ('new','contacted','site_visit'); end if;
  return v_id;
end $$;

create or replace function public.set_quotation_status(p_quote_id uuid, p_status text) returns void
language plpgsql security definer set search_path = public as $$
declare q public.quotations;
begin
  perform public.require_role(array['sales_exec','ops_officer','manager']);
  if p_status not in ('accepted','rejected') then raise exception 'Status must be accepted or rejected'; end if;
  select * into q from public.quotations where id = p_quote_id for update;
  if q.status not in ('draft','sent') then raise exception 'Quotation is already %', q.status; end if;
  update public.quotations set status = p_status, accepted_at = case when p_status = 'accepted' then now() end where id = p_quote_id;
  if p_status = 'accepted' then update public.estimates set status = 'accepted' where id = q.estimate_id; end if;
end $$;

create or replace function public.convert_estimate_to_job(p_estimate_id uuid, p_execution_date date default current_date + 1) returns uuid
language plpgsql security definer set search_path = public as $$
declare e public.estimates; v_id uuid; v_taxable boolean;
begin
  perform public.require_role(array['sales_exec','ops_officer','manager']);
  select * into e from public.estimates where id = p_estimate_id for update;
  if e.status not in ('approved','quoted','accepted') then raise exception 'Only approved or accepted estimates can be converted'; end if;
  if e.customer_id is null then raise exception 'Convert the lead to a customer first'; end if;
  select taxable into v_taxable from public.services where id = e.service_id;
  insert into public.job_orders (job_no, customer_id, status, channel, site_address, execution_date, end_date, estimate_id, instructions, raised_by)
  values (public.next_doc_no('job_order'), e.customer_id, 'draft', 'sales', e.site, p_execution_date,
    case when e.duration_days > 1 then p_execution_date + (ceil(e.duration_days)::int - 1) end, e.id, e.notes, public.current_profile_id())
  returning id into v_id;
  insert into public.job_order_lines (job_order_id, service_id, description, quantity, unit_price, taxable)
  values (v_id, e.service_id, coalesce(e.title, 'As per estimate ' || e.estimate_no), 1, e.proposed_price, coalesce(v_taxable, true));
  perform public.recalc_job_order(v_id);
  update public.estimates set status = 'converted', converted_job_id = v_id where id = e.id;
  update public.quotations set status = 'accepted', accepted_at = coalesce(accepted_at, now()) where estimate_id = e.id and status = 'sent';
  return v_id;
end $$;

create or replace function public.convert_estimate_to_contract(p_estimate_id uuid, p_start_date date default current_date) returns uuid
language plpgsql security definer set search_path = public as $$
declare e public.estimates; v_id uuid; v_taxable boolean; c public.customers;
begin
  perform public.require_role(array['sales_exec','ops_officer','manager']);
  select * into e from public.estimates where id = p_estimate_id for update;
  if e.status not in ('approved','quoted','accepted') then raise exception 'Only approved or accepted estimates can be converted'; end if;
  if e.customer_id is null then raise exception 'Convert the lead to a customer first'; end if;
  select taxable into v_taxable from public.services where id = e.service_id;
  select * into c from public.customers where id = e.customer_id;
  insert into public.contracts (contract_no, customer_id, contract_type, title, start_date, end_date, billing_frequency, amount_per_period,
    total_agreed, billing_day, payment_terms_days, taxable, service_id, estimate_id, budgeted_monthly_cost, overhead_pct, status)
  values (public.next_doc_no('contract'), e.customer_id, case when e.is_recurring then 'recurring' else 'one_off' end,
    coalesce(e.title, 'Contract from estimate ' || e.estimate_no), p_start_date,
    (p_start_date + make_interval(months => e.contract_months) - interval '1 day')::date, 'monthly',
    case when e.is_recurring then round(e.proposed_price / e.contract_months, 2) else 0 end,
    case when e.is_recurring then 0 else e.proposed_price end,
    least(extract(day from p_start_date)::int, 28), c.payment_terms_days, coalesce(v_taxable, true), e.service_id, e.id,
    e.cost_per_month, 0, 'draft')
  returning id into v_id;
  insert into public.contract_services (contract_id, service_id, description, quantity, unit_price)
  values (v_id, e.service_id, e.title, 1, case when e.is_recurring then round(e.proposed_price / e.contract_months, 2) else e.proposed_price end);
  if e.site is not null then insert into public.contract_sites (contract_id, name, address) values (v_id, 'Main site', e.site); end if;
  update public.estimates set status = 'converted', converted_contract_id = v_id where id = e.id;
  update public.quotations set status = 'accepted', accepted_at = coalesce(accepted_at, now()) where estimate_id = e.id and status = 'sent';
  return v_id;
end $$;

-- =====================================================================================
-- 9. Contracts and recurring billing
-- =====================================================================================
create or replace function public.submit_contract(p_contract_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare k public.contracts;
begin
  perform public.require_role(array['ops_officer','sales_exec','accountant','manager']);
  select * into k from public.contracts where id = p_contract_id for update;
  if k.status <> 'draft' then raise exception 'Only draft contracts can be submitted'; end if;
  if k.contract_type = 'recurring' and k.amount_per_period <= 0 then raise exception 'Enter the amount per period'; end if;
  if k.contract_type = 'one_off' and k.total_agreed <= 0 then raise exception 'Enter the agreed total'; end if;
  update public.contracts set status = 'pending_approval', submitted_at = now() where id = p_contract_id;
  perform public.notify_role('manager', 'Contract ' || k.contract_no || ' awaiting approval', k.title, '/contracts/' || k.id);
end $$;

create or replace function public.approve_contract(p_contract_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare k public.contracts; s public.company_settings;
begin
  perform public.require_role(array['manager']);
  s := public.app_settings();
  select * into k from public.contracts where id = p_contract_id for update;
  if k.status <> 'pending_approval' then raise exception 'Contract is not pending approval'; end if;
  if s.segregation_of_duties and k.created_by = public.current_profile_id() then
    raise exception 'Segregation of duties: another manager must approve a contract you created' using errcode = '42501';
  end if;
  update public.contracts set status = 'active', approved_by = public.current_profile_id(), approved_at = now(),
    next_billing_date = case when contract_type = 'recurring' then start_date end where id = p_contract_id;
end $$;

create or replace function public.reject_contract(p_contract_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public.require_role(array['manager']);
  if coalesce(btrim(p_reason), '') = '' then raise exception 'A reason is required'; end if;
  update public.contracts set status = 'draft', status_reason = p_reason where id = p_contract_id and status = 'pending_approval';
  if not found then raise exception 'Contract is not pending approval'; end if;
end $$;

create or replace function public.set_contract_status(p_contract_id uuid, p_status text, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare k public.contracts;
begin
  perform public.require_role(array['manager']);
  select * into k from public.contracts where id = p_contract_id for update;
  if p_status = 'suspended' and k.status <> 'active' then raise exception 'Only active contracts can be suspended'; end if;
  if p_status = 'active' and k.status <> 'suspended' then raise exception 'Only suspended contracts can be resumed'; end if;
  if p_status = 'terminated' and k.status not in ('active','suspended') then raise exception 'Only active or suspended contracts can be terminated'; end if;
  if p_status not in ('suspended','active','terminated') then raise exception 'Invalid status'; end if;
  if p_status <> 'active' and coalesce(btrim(p_reason), '') = '' then raise exception 'A reason is required'; end if;
  update public.contracts set status = p_status, status_reason = p_reason,
    next_billing_date = case when p_status = 'terminated' then null
                             when p_status = 'active' then greatest(coalesce(next_billing_date, current_date), current_date) else next_billing_date end
  where id = p_contract_id;
end $$;

-- end date of a billing period starting on p_start, and the length of the full billing cycle (for pro-rating)
create or replace function public.contract_period(p_freq text, p_billing_day int, p_start date, p_contract_end date, p_first boolean,
  out period_end date, out cycle_days int) language plpgsql immutable as $$
declare v_anchor date; v_end date;
begin
  if p_freq = 'weekly' then
    v_end := p_start + 6; cycle_days := 7;
  elsif p_freq = 'quarterly' then
    v_end := (p_start + interval '3 months' - interval '1 day')::date; cycle_days := v_end - p_start + 1;
  elsif p_first and extract(day from p_start)::int <> p_billing_day then
    v_anchor := make_date(extract(year from p_start)::int, extract(month from p_start)::int, p_billing_day);
    if v_anchor <= p_start then v_anchor := (v_anchor + interval '1 month')::date; end if;
    v_end := v_anchor - 1;
    cycle_days := v_anchor - (v_anchor - interval '1 month')::date;
  else
    v_end := (p_start + interval '1 month' - interval '1 day')::date; cycle_days := v_end - p_start + 1;
  end if;
  period_end := least(v_end, p_contract_end);
end $$;

-- Daily billing engine (07:00). Idempotent: unique (contract_id, period_start) on billing periods and invoices.
create or replace function public.generate_recurring_invoices(p_as_of date default current_date, p_contract_id uuid default null, p_bill_next boolean default false) returns int
language plpgsql security definer set search_path = public as $$
declare k public.contracts; v_start date; v_end date; v_days int; v_full_days int; v_amount numeric;
  v_period uuid; v_inv uuid; n int := 0; v_loop int; v_first boolean; v_svc text; v_due date; c public.customers;
begin
  if p_contract_id is not null then perform public.require_role(array['accountant','ops_officer','manager']); end if;
  for k in select * from public.contracts where status = 'active' and contract_type = 'recurring' and next_billing_date is not null
           and (p_contract_id is null or id = p_contract_id) and (next_billing_date <= p_as_of or p_bill_next) order by next_billing_date for update loop
    v_loop := 0;
    select * into c from public.customers where id = k.customer_id;
    while k.next_billing_date is not null and (k.next_billing_date <= p_as_of or (p_bill_next and v_loop = 0)) and v_loop < 24 loop
      v_loop := v_loop + 1;
      v_start := k.next_billing_date;
      if v_start > k.end_date then
        update public.contracts set next_billing_date = null where id = k.id; exit;
      end if;
      v_first := v_start = k.start_date;
      -- pro-rating: compare billed days with the length of the full billing cycle
      select cp.period_end, cp.cycle_days into v_end, v_full_days from public.contract_period(k.billing_frequency, k.billing_day, v_start, k.end_date, v_first) cp;
      v_days := v_end - v_start + 1;
      v_amount := case when k.prorate and v_days < v_full_days then round(k.amount_per_period * v_days / v_full_days, 2) else k.amount_per_period end;

      insert into public.contract_billing_periods (contract_id, period_start, period_end, amount, prorated)
      values (k.id, v_start, v_end, v_amount, v_days < v_full_days)
      on conflict (contract_id, period_start) do nothing returning id into v_period;

      if v_period is not null and v_amount > 0 then
        select string_agg(s.name, ', ') into v_svc from public.contract_services cs join public.services s on s.id = cs.service_id where cs.contract_id = k.id;
        v_due := p_as_of + k.payment_terms_days;
        insert into public.invoices (source, customer_id, customer_name, contract_id, period_start, period_end, issue_date, notes)
        values ('contract', k.customer_id, c.display_name, k.id, v_start, v_end, least(p_as_of, current_date), 'Contract ' || k.contract_no)
        on conflict (contract_id, period_start) do nothing returning id into v_inv;
        if v_inv is not null then
          insert into public.invoice_lines (invoice_id, service_id, description, quantity, unit_price, taxable)
          values (v_inv, k.service_id, coalesce(v_svc, k.title) || ' – ' || public.date_text(v_start) || ' to ' || public.date_text(v_end), 1, v_amount, k.taxable);
          perform public._issue_invoice(v_inv, 'contract_invoice', false, v_due);
          update public.contract_billing_periods set invoice_id = v_inv where id = v_period;
          if k.auto_send then perform public.queue_invoice_messages(v_inv, 'recurring_invoice'); end if;
          n := n + 1;
        end if;
      end if;
      k.next_billing_date := case when v_end >= k.end_date then null else v_end + 1 end;
      update public.contracts set next_billing_date = k.next_billing_date where id = k.id;
    end loop;
  end loop;
  return n;
end $$;

-- =====================================================================================
-- 10. Suppliers, bills and expenses
-- =====================================================================================
create or replace function public.submit_bill(p_bill_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare b public.bills;
begin
  perform public.require_role(array['accountant','fleet_manager']);
  select * into b from public.bills where id = p_bill_id for update;
  if b.status not in ('draft','rejected') then raise exception 'Only draft bills can be submitted'; end if;
  if b.is_fleet and not public.has_any_role(array['accountant']) and b.truck_id is null then raise exception 'Fleet bills must be linked to a truck'; end if;
  if not exists (select 1 from public.bill_lines where bill_id = p_bill_id) then raise exception 'Add at least one line'; end if;
  update public.bills set status = 'pending_approval', submitted_at = now(), rejection_reason = null where id = p_bill_id;
  perform public.notify_role('manager', 'Bill ' || b.bill_no || ' awaiting approval', 'GH₵ ' || public.money_text(b.total), '/finance/bills/' || b.id);
end $$;

create or replace function public.approve_bill(p_bill_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare b public.bills; v_lines jsonb := '[]'::jsonb; l record; v_j uuid;
begin
  perform public.require_role(array['manager']);
  select * into b from public.bills where id = p_bill_id for update;
  if b.status <> 'pending_approval' then raise exception 'Bill is not pending approval'; end if;
  for l in select bl.*, ci.track_stock from public.bill_lines bl left join public.cost_items ci on ci.id = bl.cost_item_id where bl.bill_id = p_bill_id loop
    v_lines := v_lines || jsonb_build_object('account_id', case when l.track_stock and l.stock_location_id is not null then public.rule_debit('stock_receipt') else l.account_id end,
      'debit', l.amount, 'description', l.description, 'supplier_id', b.supplier_id, 'job_order_id', b.job_order_id, 'contract_id', b.contract_id, 'truck_id', b.truck_id);
    if l.track_stock and l.stock_location_id is not null then
      insert into public.stock_movements (cost_item_id, location_id, movement_date, movement_type, quantity, unit_cost, reference_type, reference_id, note)
      values (l.cost_item_id, l.stock_location_id, b.bill_date, 'receipt', l.quantity, l.unit_cost, 'bill', b.id, 'Bill ' || b.bill_no);
    end if;
  end loop;
  v_lines := v_lines || jsonb_build_object('account_id', public.rule_credit('bill_approved'), 'credit', b.total, 'description', 'Bill ' || b.bill_no, 'supplier_id', b.supplier_id);
  v_j := public._post_journal(b.bill_date, 'Supplier bill ' || b.bill_no, 'bill', b.id, 'bill_approved', v_lines);
  update public.bills set status = 'approved', approved_by = public.current_profile_id(), approved_at = now(), journal_entry_id = v_j, balance = total where id = p_bill_id;
end $$;

create or replace function public.reject_bill(p_bill_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public.require_role(array['manager']);
  if coalesce(btrim(p_reason), '') = '' then raise exception 'A reason is required'; end if;
  update public.bills set status = 'rejected', rejection_reason = p_reason where id = p_bill_id and status = 'pending_approval';
  if not found then raise exception 'Bill is not pending approval'; end if;
end $$;

create or replace function public.pay_bill(p_bill_id uuid, p_amount numeric, p_bank_account_id uuid, p_date date, p_reference text) returns uuid
language plpgsql security definer set search_path = public as $$
declare b public.bills; v_id uuid; v_j uuid;
begin
  perform public.require_role(array['accountant']);
  select * into b from public.bills where id = p_bill_id for update;
  if b.status not in ('approved','partially_paid') then raise exception 'Only approved bills can be paid'; end if;
  p_amount := round(p_amount, 2);
  if p_amount <= 0 or p_amount > b.balance then raise exception 'Amount must be between 0.01 and %', public.money_text(b.balance); end if;
  v_j := public._post_journal(coalesce(p_date, current_date), 'Payment of bill ' || b.bill_no, 'bill_payment', b.id, 'bill_paid',
    jsonb_build_array(
      jsonb_build_object('account_id', public.rule_debit('bill_paid'), 'debit', p_amount, 'supplier_id', b.supplier_id),
      jsonb_build_object('account_id', public.bank_ledger_account(p_bank_account_id), 'credit', p_amount, 'supplier_id', b.supplier_id, 'description', p_reference)));
  insert into public.bill_payments (bill_id, payment_date, amount, bank_account_id, reference, journal_entry_id)
  values (p_bill_id, coalesce(p_date, current_date), p_amount, p_bank_account_id, p_reference, v_j) returning id into v_id;
  update public.bills set amount_paid = amount_paid + p_amount, balance = balance - p_amount,
    status = case when balance - p_amount = 0 then 'paid' else 'partially_paid' end where id = p_bill_id;
  return v_id;
end $$;

create or replace function public.submit_expense(p_expense_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare x public.expenses;
begin
  perform public.require_role(array['accountant','fleet_manager']);
  select * into x from public.expenses where id = p_expense_id for update;
  if x.status not in ('draft','rejected') then raise exception 'Only draft expenses can be submitted'; end if;
  update public.expenses set status = 'pending_approval', submitted_at = now(), rejection_reason = null where id = p_expense_id;
  perform public.notify_role('manager', 'Expense ' || x.expense_no || ' awaiting approval', x.description || ' – GH₵ ' || public.money_text(x.amount), '/finance/expenses');
end $$;

create or replace function public.approve_expense(p_expense_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare x public.expenses; v_j uuid;
begin
  perform public.require_role(array['manager']);
  select * into x from public.expenses where id = p_expense_id for update;
  if x.status <> 'pending_approval' then raise exception 'Expense is not pending approval'; end if;
  v_j := public._post_journal(x.expense_date, 'Expense ' || x.expense_no || ': ' || x.description, 'expense', x.id, 'expense_approved',
    jsonb_build_array(
      jsonb_build_object('account_id', x.account_id, 'debit', x.amount, 'description', x.description, 'supplier_id', x.supplier_id, 'job_order_id', x.job_order_id, 'contract_id', x.contract_id, 'truck_id', x.truck_id),
      jsonb_build_object('account_id', public.rule_credit('expense_approved'), 'credit', x.amount, 'description', x.description, 'supplier_id', x.supplier_id)));
  update public.expenses set status = 'approved', approved_by = public.current_profile_id(), approved_at = now(), journal_entry_id = v_j where id = p_expense_id;
end $$;

create or replace function public.reject_expense(p_expense_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public.require_role(array['manager']);
  if coalesce(btrim(p_reason), '') = '' then raise exception 'A reason is required'; end if;
  update public.expenses set status = 'rejected', rejection_reason = p_reason where id = p_expense_id and status = 'pending_approval';
  if not found then raise exception 'Expense is not pending approval'; end if;
end $$;

create or replace function public.pay_expense(p_expense_id uuid, p_bank_account_id uuid, p_reference text) returns void
language plpgsql security definer set search_path = public as $$
declare x public.expenses; v_j uuid;
begin
  perform public.require_role(array['accountant']);
  select * into x from public.expenses where id = p_expense_id for update;
  if x.status <> 'approved' then raise exception 'Only approved expenses can be paid'; end if;
  v_j := public._post_journal(current_date, 'Payment of expense ' || x.expense_no, 'expense_payment', x.id, 'expense_paid',
    jsonb_build_array(
      jsonb_build_object('account_id', public.rule_debit('expense_paid'), 'debit', x.amount, 'supplier_id', x.supplier_id),
      jsonb_build_object('account_id', public.bank_ledger_account(p_bank_account_id), 'credit', x.amount, 'supplier_id', x.supplier_id, 'description', p_reference)));
  update public.expenses set status = 'paid', paid_from_bank_account_id = p_bank_account_id, paid_at = now(), payment_reference = p_reference,
    payment_journal_entry_id = v_j where id = p_expense_id;
end $$;

-- =====================================================================================
-- 11. Stock
-- =====================================================================================
create or replace function public.receive_stock(p_item uuid, p_location uuid, p_quantity numeric, p_unit_cost numeric, p_note text, p_adjust boolean default false) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  perform public.require_role(array['ops_officer','accountant','manager']);
  if p_quantity = 0 then raise exception 'Quantity cannot be zero'; end if;
  if not p_adjust and p_quantity < 0 then raise exception 'Use an adjustment to reduce stock'; end if;
  insert into public.stock_movements (cost_item_id, location_id, movement_type, quantity, unit_cost, note)
  values (p_item, p_location, case when p_adjust then 'adjustment' else 'receipt' end, p_quantity, coalesce(p_unit_cost, 0), p_note)
  returning id into v_id;
  return v_id;
end $$;

-- =====================================================================================
-- 12. Contract profitability alerts
-- =====================================================================================
create or replace function public.contract_month_figures(p_contract_id uuid, p_month date,
  out revenue numeric, out collected numeric, out supplies numeric, out labour numeric, out vehicle numeric, out other numeric,
  out direct_cost numeric, out overhead numeric, out gross_profit numeric, out margin_pct numeric)
language plpgsql stable security definer set search_path = public as $$
declare v_from date := date_trunc('month', p_month)::date; v_to date := (date_trunc('month', p_month) + interval '1 month - 1 day')::date; k public.contracts;
begin
  perform public.require_role(array['manager','ops_officer','sales_exec','accountant','executive']);
  select * into k from public.contracts where id = p_contract_id;
  select coalesce(sum(i.total - i.tax_total), 0) into revenue from public.invoices i
    where i.contract_id = p_contract_id and i.status <> 'draft' and coalesce(i.period_start, i.issue_date) between v_from and v_to;
  revenue := revenue - coalesce((select sum(cn.amount - cn.tax_amount) from public.credit_notes cn join public.invoices i on i.id = cn.invoice_id
    where i.contract_id = p_contract_id and coalesce(i.period_start, i.issue_date) between v_from and v_to), 0);
  select coalesce(sum(pa.amount), 0) into collected from public.payment_allocations pa join public.invoices i on i.id = pa.invoice_id join public.payments p on p.id = pa.payment_id
    where i.contract_id = p_contract_id and p.payment_date between v_from and v_to;
  select coalesce(sum(cs.amount) filter (where ci.category <> 'vehicle'), 0), coalesce(sum(cs.amount) filter (where ci.category = 'vehicle'), 0)
    into supplies, vehicle from public.contract_supplies cs join public.cost_items ci on ci.id = cs.cost_item_id
    where cs.contract_id = p_contract_id and cs.supply_date between v_from and v_to;
  select coalesce(sum(amount) filter (where kind = 'labour'), 0), vehicle + coalesce(sum(amount) filter (where kind = 'vehicle'), 0),
         coalesce(sum(amount) filter (where kind = 'other'), 0)
    into labour, vehicle, other from public.contract_labour where contract_id = p_contract_id and work_date between v_from and v_to;
  other := other + coalesce((select sum(amount) from public.expenses where contract_id = p_contract_id and status in ('approved','paid') and expense_date between v_from and v_to), 0)
                 + coalesce((select sum(bl.amount) from public.bill_lines bl join public.bills b on b.id = bl.bill_id
                             where b.contract_id = p_contract_id and b.status in ('approved','partially_paid','paid') and b.bill_date between v_from and v_to), 0);
  -- one-off contracts: costs recorded on the contract's job orders count too
  labour := labour + coalesce((select sum(ac.amount) from public.job_order_actual_costs ac join public.job_orders j on j.id = ac.job_order_id
              where j.contract_id = p_contract_id and ac.category = 'labour' and coalesce(j.completed_at::date, ac.created_at::date) between v_from and v_to), 0);
  vehicle := vehicle + coalesce((select sum(ac.amount) from public.job_order_actual_costs ac join public.job_orders j on j.id = ac.job_order_id
              where j.contract_id = p_contract_id and ac.category in ('vehicle','fuel') and coalesce(j.completed_at::date, ac.created_at::date) between v_from and v_to), 0)
           + coalesce((select sum(f.cost) from public.fuel_logs f join public.job_orders j on j.id = f.job_order_id where j.contract_id = p_contract_id and f.log_date between v_from and v_to), 0);
  supplies := supplies + coalesce((select sum(ac.amount) from public.job_order_actual_costs ac join public.job_orders j on j.id = ac.job_order_id
              where j.contract_id = p_contract_id and ac.category in ('consumable','equipment') and coalesce(j.completed_at::date, ac.created_at::date) between v_from and v_to), 0);
  other := other + coalesce((select sum(ac.amount) from public.job_order_actual_costs ac join public.job_orders j on j.id = ac.job_order_id
              where j.contract_id = p_contract_id and ac.category in ('subcontract','overhead','other') and coalesce(j.completed_at::date, ac.created_at::date) between v_from and v_to), 0);
  direct_cost := supplies + labour + vehicle + other;
  overhead := round(revenue * coalesce(k.overhead_pct, 0) / 100, 2);
  gross_profit := revenue - direct_cost;
  margin_pct := case when revenue > 0 then round(gross_profit / revenue * 100, 2) when direct_cost > 0 then -100 else 0 end;
end $$;

create or replace function public.check_contract_margin(p_contract_id uuid, p_month date) returns void
language plpgsql security definer set search_path = public as $$
declare f record; k public.contracts; v_thr numeric; v_key text;
begin
  select * into k from public.contracts where id = p_contract_id;
  select * into f from public.contract_month_figures(p_contract_id, p_month);
  select contract_margin_threshold into v_thr from public.company_settings where id = 1;
  if f.direct_cost = 0 and f.revenue = 0 then return; end if;
  if f.margin_pct < coalesce(v_thr, 10) then
    v_key := 'contract-margin-' || p_contract_id || '-' || to_char(p_month, 'YYYYMM') || '-' || case when f.gross_profit < 0 then 'loss' else 'low' end;
    perform public.notify_role('manager', case when f.gross_profit < 0 then 'Loss-making month: ' else 'Low margin: ' end || k.contract_no,
      to_char(p_month, 'Mon YYYY') || ' – gross profit GH₵ ' || public.money_text(f.gross_profit) || ' (' || f.margin_pct || '%)', '/contracts/' || k.id, 'danger', v_key);
    perform public.queue_role_message('manager', 'contract_low_margin', jsonb_build_object('contract_no', k.contract_no, 'period', to_char(p_month, 'Mon YYYY'),
      'amount', public.money_text(f.gross_profit), 'balance', f.margin_pct::text), 'contract', k.id, v_key);
  end if;
end $$;

-- =====================================================================================
-- 13. Customers, leads, surveys, zonal work
-- =====================================================================================
create or replace function public.check_customer_duplicates(p_phone text, p_ghana_card text, p_email text, p_tin text, p_exclude uuid default null)
returns table (id uuid, customer_code text, display_name text, matched_on text)
language plpgsql stable security definer set search_path = public as $$
declare v_phone text;
begin
  perform public.require_role(array['manager','ops_officer','sales_exec','zonal_officer','accountant']);
  begin v_phone := public.normalize_phone(p_phone); exception when others then v_phone := null; end;
  return query
  select c.id, c.customer_code, c.display_name, 'phone'::text from public.customers c
    where v_phone is not null and (c.phone = v_phone or c.alt_phone = v_phone or c.whatsapp = v_phone or c.company_phone = v_phone) and c.id is distinct from p_exclude
  union all
  select c.id, c.customer_code, c.display_name, 'Ghana Card' from public.customers c where p_ghana_card is not null and c.ghana_card_no = upper(p_ghana_card) and c.id is distinct from p_exclude
  union all
  select c.id, c.customer_code, c.display_name, 'email' from public.customers c where coalesce(p_email, '') <> '' and (lower(c.email) = lower(p_email) or lower(c.company_email) = lower(p_email)) and c.id is distinct from p_exclude
  union all
  select c.id, c.customer_code, c.display_name, 'TIN' from public.customers c where coalesce(p_tin, '') <> '' and c.tin = p_tin and c.id is distinct from p_exclude;
end $$;

-- Bulk import with a row-level result list. Runs as the caller, so RLS applies.
create or replace function public.import_customers(p_rows jsonb) returns jsonb
language plpgsql security invoker set search_path = public as $$
declare r jsonb; v_out jsonb := '[]'::jsonb; v_id uuid; i int := 0;
begin
  for r in select * from jsonb_array_elements(p_rows) loop
    i := i + 1;
    begin
      insert into public.customers (customer_type, title, first_name, middle_name, last_name, gender, ghana_card_no, phone, alt_phone, whatsapp, email,
        occupation, residential_address, company_name, trading_name, registration_no, tin, sector, company_phone, company_email, digital_address,
        region, district, source, preferred_channel, sms_opt_in, credit_limit, payment_terms_days, notes, zone_id)
      values (coalesce(r->>'customer_type', 'individual'), r->>'title', r->>'first_name', r->>'middle_name', r->>'last_name', nullif(r->>'gender', ''),
        nullif(upper(r->>'ghana_card_no'), ''), r->>'phone', r->>'alt_phone', r->>'whatsapp', nullif(r->>'email', ''), r->>'occupation', r->>'residential_address',
        r->>'company_name', r->>'trading_name', r->>'registration_no', nullif(r->>'tin', ''), r->>'sector', r->>'company_phone', nullif(r->>'company_email', ''),
        nullif(upper(r->>'digital_address'), ''), r->>'region', r->>'district', coalesce(nullif(r->>'source', ''), 'call_in'),
        coalesce(nullif(r->>'preferred_channel', ''), 'sms'), coalesce((r->>'sms_opt_in')::boolean, true), coalesce(nullif(r->>'credit_limit', '')::numeric, 0),
        coalesce(nullif(r->>'payment_terms_days', '')::int, 7), r->>'notes', nullif(r->>'zone_id', '')::uuid)
      returning id into v_id;
      v_out := v_out || jsonb_build_object('row', i, 'ok', true, 'id', v_id);
    exception when others then
      v_out := v_out || jsonb_build_object('row', i, 'ok', false, 'error', sqlerrm);
    end;
  end loop;
  return v_out;
end $$;

create or replace function public.convert_lead_to_customer(p_lead_id uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare l public.leads; v_id uuid; v_first text; v_last text;
begin
  perform public.require_role(array['sales_exec','manager','zonal_officer']);
  select * into l from public.leads where id = p_lead_id for update;
  if not found then raise exception 'Lead not found'; end if;
  if public.has_exact_role('zonal_officer') and not public.has_any_role(array['sales_exec','manager']) and l.owner_id <> public.current_profile_id() then
    raise exception 'You can only convert your own leads' using errcode = '42501'; end if;
  if l.customer_id is not null then return l.customer_id; end if;
  if l.company_name is not null then
    insert into public.customers (customer_type, company_name, company_phone, company_email, source, zone_id, assigned_to, residential_address, notes)
    values ('company', l.company_name, l.phone, l.email, l.source, l.zone_id, l.owner_id, l.location, 'Converted from lead: ' || l.name) returning id into v_id;
    insert into public.customer_contacts (customer_id, name, phone, email, is_primary, receives_invoices) values (v_id, l.name, l.phone, l.email, true, true);
  else
    v_first := split_part(l.name, ' ', 1);
    v_last := nullif(btrim(substr(l.name, length(v_first) + 1)), '');
    insert into public.customers (customer_type, first_name, last_name, phone, email, source, zone_id, assigned_to, residential_address, notes)
    values ('individual', v_first, coalesce(v_last, v_first), l.phone, l.email, l.source, l.zone_id, l.owner_id, l.location, l.notes) returning id into v_id;
  end if;
  update public.leads set customer_id = v_id, stage = 'won', won_at = coalesce(won_at, now()) where id = p_lead_id;
  update public.estimates set customer_id = v_id where lead_id = p_lead_id and customer_id is null;
  update public.quotations set customer_id = v_id where lead_id = p_lead_id and customer_id is null;
  return v_id;
end $$;

create or replace function public.convert_task_to_lead(p_task_id uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare t public.tasks; v_id uuid;
begin
  perform public.require_role(array['zonal_officer','manager','sales_exec']);
  select * into t from public.tasks where id = p_task_id for update;
  if not found then raise exception 'Task not found'; end if;
  if t.officer_id <> public.current_profile_id() and not public.has_any_role(array['manager']) then raise exception 'Not your task' using errcode = '42501'; end if;
  if t.converted_lead_id is not null then return t.converted_lead_id; end if;
  insert into public.leads (name, company_name, phone, source, location, zone_id, estimated_value, owner_id, stage, notes)
  values (coalesce(t.contact_name, t.target_org, t.title), t.target_org, t.contact_phone, 'zonal_officer', t.location, t.zone_id, t.deal_value, t.officer_id,
    case when t.deal_closed then 'negotiation' else 'contacted' end, coalesce(t.outcome_notes, t.expected_outcome))
  returning id into v_id;
  update public.tasks set converted_lead_id = v_id where id = p_task_id;
  return v_id;
end $$;

-- Public survey (called by the public-survey Edge Function with the service role)
create or replace function public.get_public_survey(p_token text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare inv public.survey_invitations; s public.company_settings;
begin
  select * into inv from public.survey_invitations where token = p_token;
  if not found then return jsonb_build_object('state', 'not_found'); end if;
  s := public.app_settings();
  return jsonb_build_object(
    'state', case when inv.responded_at is not null then 'responded' when inv.expires_at < now() then 'expired' else 'open' end,
    'company', jsonb_build_object('name', s.company_name, 'logo_url', s.logo_url, 'brand_color', s.brand_color),
    'customer_name', (select display_name from public.customers where id = inv.customer_id),
    'survey', (select jsonb_build_object('id', sv.id, 'name', sv.name, 'intro_text', sv.intro_text, 'thank_you_text', sv.thank_you_text,
       'questions', coalesce((select jsonb_agg(jsonb_build_object('id', q.id, 'type', q.question_type, 'text', q.question_text, 'options', q.options, 'required', q.required) order by q.position)
                              from public.survey_questions q where q.survey_id = sv.id), '[]'::jsonb))
       from public.surveys sv where sv.id = inv.survey_id));
end $$;

-- p_answers: [{question_id, rating, choice, bool_value, text_value}]
create or replace function public.submit_survey_response(p_token text, p_answers jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare inv public.survey_invitations; s public.company_settings; v_id uuid; a jsonb; q public.survey_questions; v_csat numeric; v_nps int; v_overall int;
  v_comments text; v_low boolean; v_service uuid; v_officer uuid; v_driver uuid; v_truck uuid; v_cust text; v_inv_no text;
begin
  select * into inv from public.survey_invitations where token = p_token for update;
  if not found then raise exception 'Survey link not found'; end if;
  if inv.responded_at is not null then raise exception 'This survey has already been answered. Thank you!'; end if;
  if inv.expires_at < now() then raise exception 'This survey link has expired'; end if;
  s := public.app_settings();
  for q in select * from public.survey_questions where survey_id = inv.survey_id and required loop
    if not exists (select 1 from jsonb_array_elements(p_answers) x where (x->>'question_id')::uuid = q.id
                   and coalesce(x->>'rating', x->>'choice', x->>'bool_value', nullif(x->>'text_value', '')) is not null) then
      raise exception 'Please answer: %', q.question_text;
    end if;
  end loop;
  select j.officer_id, (select a.employee_id from public.job_order_assignments a where a.job_order_id = j.id and a.kind = 'driver' limit 1),
         (select a.truck_id from public.job_order_assignments a where a.job_order_id = j.id and a.kind = 'truck' limit 1)
    into v_officer, v_driver, v_truck from public.job_orders j where j.id = inv.job_order_id;
  select il.service_id into v_service from public.invoice_lines il where il.invoice_id = inv.invoice_id order by il.sort_order limit 1;
  insert into public.survey_responses (invitation_id, survey_id, customer_id, job_order_id, invoice_id, service_id, officer_id, driver_id, truck_id)
  values (inv.id, inv.survey_id, inv.customer_id, inv.job_order_id, inv.invoice_id, v_service, v_officer, v_driver, v_truck) returning id into v_id;
  for a in select * from jsonb_array_elements(p_answers) loop
    select * into q from public.survey_questions where id = (a->>'question_id')::uuid and survey_id = inv.survey_id;
    if not found then continue; end if;
    if q.question_type = 'star' and (a->>'rating')::int not between 1 and 5 then raise exception 'Ratings must be 1 to 5'; end if;
    if q.question_type = 'nps' and (a->>'rating')::int not between 0 and 10 then raise exception 'NPS must be 0 to 10'; end if;
    insert into public.survey_answers (response_id, question_id, rating, choice, bool_value, text_value)
    values (v_id, q.id, (a->>'rating')::int, a->>'choice', (a->>'bool_value')::boolean, left(a->>'text_value', 2000));
  end loop;
  select round(avg(sa.rating) filter (where sq.question_type = 'star'), 2),
         max(sa.rating) filter (where sq.question_type = 'nps'),
         max(sa.rating) filter (where sq.metric_key = 'overall'),
         string_agg(sa.text_value, ' | ') filter (where sq.question_type = 'text' and coalesce(sa.text_value, '') <> ''),
         bool_or((sq.question_type = 'star' and sa.rating <= s.survey_low_score) or (sq.question_type = 'nps' and sa.rating <= s.survey_low_nps))
    into v_csat, v_nps, v_overall, v_comments, v_low
  from public.survey_answers sa join public.survey_questions sq on sq.id = sa.question_id where sa.response_id = v_id;
  update public.survey_responses set csat = v_csat, nps_score = v_nps, overall_score = v_overall, comments = v_comments, is_low = coalesce(v_low, false) where id = v_id;
  update public.survey_invitations set responded_at = now(), status = 'responded' where id = inv.id;
  if coalesce(v_low, false) then
    select display_name into v_cust from public.customers where id = inv.customer_id;
    select invoice_no into v_inv_no from public.invoices where id = inv.invoice_id;
    insert into public.followup_tasks (title, description, source_type, source_id, customer_id, assigned_role)
    values ('Low survey score – ' || v_cust, 'CSAT ' || coalesce(v_csat::text, '-') || ', NPS ' || coalesce(v_nps::text, '-') || coalesce('. Comments: ' || v_comments, '') || coalesce(' (invoice ' || v_inv_no || ')', ''),
      'survey_response', v_id, inv.customer_id, 'manager');
    perform public.notify_role('manager', 'Low survey score from ' || v_cust, coalesce(v_comments, 'CSAT ' || coalesce(v_csat::text, '-') || ' / NPS ' || coalesce(v_nps::text, '-')), '/followups', 'danger', 'survey-low-' || v_id);
    perform public.queue_role_message('manager', 'low_survey_score', jsonb_build_object('customer_name', v_cust, 'invoice_no', coalesce(v_inv_no, ''),
      'amount', coalesce(v_csat::text, '-'), 'balance', coalesce(v_nps::text, '-')), 'survey_response', v_id, 'survey-low-' || v_id);
  end if;
  return jsonb_build_object('ok', true, 'low', coalesce(v_low, false), 'thank_you', (select thank_you_text from public.surveys where id = inv.survey_id));
end $$;

create or replace function public.resolve_followup(p_id uuid, p_resolution text) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public.require_role(array['manager']);
  update public.followup_tasks set status = 'done', resolution = p_resolution, resolved_by = public.current_profile_id(), resolved_at = now() where id = p_id;
end $$;

-- statement share link (public-document Edge Function serves it)
create or replace function public.create_statement_link(p_customer_id uuid, p_from date, p_to date) returns text
language plpgsql security definer set search_path = public as $$
declare v_token text;
begin
  perform public.require_role(array['accountant','manager','sales_exec']);
  insert into public.public_links (doc_type, customer_id, params) values ('statement', p_customer_id, jsonb_build_object('from', p_from, 'to', p_to)) returning token into v_token;
  return rtrim((select public_app_url from public.company_settings where id = 1), '/') || '/p/statement/' || v_token;
end $$;

create or replace function public.mark_notifications_read(p_ids uuid[] default null) returns void
language sql security definer set search_path = public as $$
  update public.in_app_notifications set read_at = now()
  where profile_id = public.current_profile_id() and read_at is null and (p_ids is null or id = any(p_ids))
$$;

-- Settings: queue a test SMS (send-notification delivers it within a minute)
create or replace function public.send_test_sms(p_phone text, p_message text) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  perform public.require_role(array['super_admin']);
  insert into public.notifications (event_code, channel, recipient_name, recipient_phone, recipient_type, body, profile_id)
  values ('test', 'sms', 'Test', public.normalize_phone(p_phone), 'staff', coalesce(nullif(p_message, ''), 'Test message from ' || (select company_name from public.company_settings where id = 1)), public.current_profile_id())
  returning id into v_id;
  return v_id;
end $$;

-- =====================================================================================
-- 14. Scheduled jobs (called by pg_cron, see 0019)
-- =====================================================================================
-- 06:30 – "service today" to customers, job sheets to drivers
create or replace function public.job_service_today() returns int
language plpgsql security definer set search_path = public as $$
declare r record; n int := 0;
begin
  for r in select id from public.job_orders where status = 'approved' and execution_date = current_date and today_sms_sent_on is distinct from current_date loop
    n := n + public._job_messages(r.id, 'service_today', true, true, false, 'today-' || r.id || '-' || current_date);
    update public.job_orders set today_sms_sent_on = current_date where id = r.id;
  end loop;
  return n;
end $$;

-- 18:00 – day-before reminders
create or replace function public.job_day_before_reminders() returns int
language plpgsql security definer set search_path = public as $$
declare r record; n int := 0;
begin
  for r in select id from public.job_orders where status = 'approved' and execution_date = current_date + 1 and reminder_sent_on is distinct from current_date loop
    n := n + public._job_messages(r.id, 'service_reminder', true, true, false, 'remind-' || r.id || '-' || current_date);
    update public.job_orders set reminder_sent_on = current_date where id = r.id;
  end loop;
  return n;
end $$;

-- 08:00 – overdue reminders, birthdays, fleet documents/maintenance, contract renewals
create or replace function public.job_morning_alerts() returns jsonb
language plpgsql security definer set search_path = public as $$
declare s public.company_settings; r record; d int; v_over int := 0; v_bday int := 0; v_fleet int := 0; v_contract int := 0; c public.customers; v_vars jsonb;
begin
  s := public.app_settings();
  perform public.job_mark_overdue();
  -- overdue reminders at configured day counts, stop once paid
  for r in select i.* from public.invoices i where i.status = 'overdue' and i.balance > 0 and i.due_date is not null loop
    d := current_date - r.due_date;
    if d = any(s.overdue_reminder_days) and not (d = any(r.overdue_reminders_sent)) then
      select * into c from public.customers where id = r.customer_id;
      v_vars := jsonb_build_object('invoice_no', r.invoice_no, 'amount', public.money_text(r.total), 'balance', public.money_text(r.balance),
        'invoice_link', public.invoice_link(r.id), 'date', public.date_text(r.due_date));
      perform public.queue_notification('invoice_overdue', 'sms', c.display_name, coalesce(c.phone, c.company_phone), null, v_vars, c.id, null, 'customer', 'invoice', r.id, 'overdue-' || r.id || '-' || d);
      perform public.queue_notification('invoice_overdue', 'email', c.display_name, null, coalesce(c.email, c.company_email), v_vars, c.id, null, 'customer', 'invoice', r.id, 'overdue-email-' || r.id || '-' || d);
      update public.invoices set overdue_reminders_sent = overdue_reminders_sent || d where id = r.id;
      v_over := v_over + 1;
    end if;
  end loop;
  -- birthdays (marketing: queue_notification enforces opt-in/consent)
  for c in select * from public.customers where customer_type = 'individual' and status = 'active' and archived_at is null
           and birth_month = extract(month from current_date) and birth_day = extract(day from current_date) loop
    if public.queue_notification('birthday', 'sms', c.first_name, c.phone, null, jsonb_build_object('customer_name', c.first_name), c.id, null, 'customer', 'customer', c.id,
         'bday-' || c.id || '-' || extract(year from current_date)) is not null then v_bday := v_bday + 1; end if;
  end loop;
  -- truck documents, maintenance and driver licences at 30 and 7 days
  for r in select td.id, t.registration_no, t.id as truck_id, td.doc_type as label, td.expiry_date as due from public.truck_documents td join public.trucks t on t.id = td.truck_id
           where t.archived_at is null and td.expiry_date - current_date in (30, 7, 0)
           union all
           select ms.id, t.registration_no, t.id, 'maintenance: ' || ms.title, ms.next_due_date from public.maintenance_schedules ms join public.trucks t on t.id = ms.truck_id
           where ms.active and t.archived_at is null and ms.next_due_date - current_date in (30, 7, 0)
           union all
           select ms.id, t.registration_no, t.id, 'maintenance (km): ' || ms.title, current_date from public.maintenance_schedules ms join public.trucks t on t.id = ms.truck_id
           where ms.active and ms.next_due_km is not null and t.odometer_km >= ms.next_due_km - 500 and t.archived_at is null
           union all
           select e.id, e.full_name, null, 'driver licence', e.licence_expiry from public.employees e where e.role_type = 'driver' and e.status = 'active' and e.licence_expiry - current_date in (30, 7, 0)
  loop
    v_fleet := v_fleet + 1;
    perform public.notify_role('fleet_manager', 'Due ' || public.date_text(r.due) || ': ' || replace(r.label, '_', ' '), r.registration_no,
      case when r.truck_id is not null then '/fleet/trucks/' || r.truck_id else '/fleet/employees' end, 'warning', 'fleetdue-' || r.id || '-' || current_date);
    perform public.queue_role_message('fleet_manager', 'document_due', jsonb_build_object('truck_reg', r.registration_no, 'service', replace(r.label, '_', ' '), 'date', public.date_text(r.due)),
      'truck', r.truck_id, 'fleetdue-' || r.id || '-' || current_date);
  end loop;
  -- contract renewal reminders at 60/30/7 days
  for r in select * from public.contracts where status = 'active' and end_date - current_date in (60, 30, 7) loop
    v_contract := v_contract + 1;
    perform public.notify_role('manager', 'Contract ' || r.contract_no || ' ends ' || public.date_text(r.end_date), r.title, '/contracts/' || r.id, 'warning', 'renew-' || r.id || '-' || current_date);
    perform public.queue_role_message('manager', 'contract_ending', jsonb_build_object('contract_no', r.contract_no, 'date', public.date_text(r.end_date),
      'customer_name', (select display_name from public.customers where id = r.customer_id)), 'contract', r.id, 'renew-' || r.id || '-' || current_date);
  end loop;
  return jsonb_build_object('overdue', v_over, 'birthdays', v_bday, 'fleet', v_fleet, 'contracts', v_contract);
end $$;

create or replace function public.job_mark_overdue() returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  update public.invoices set status = 'overdue' where status in ('due','partially_paid','issued') and due_date < current_date and balance > 0;
  get diagnostics n = row_count;
  return n;
end $$;

-- 17:00 – remind officers who have not updated today
create or replace function public.job_zonal_reminder() returns int
language plpgsql security definer set search_path = public as $$
declare r record; n int := 0;
begin
  for r in select p.id, p.full_name, p.phone, count(t.id) as open_tasks
           from public.profiles p join public.user_roles ur on ur.profile_id = p.id and ur.role_code = 'zonal_officer'
           join public.tasks t on t.officer_id = p.id and t.planned_date = current_date and t.status in ('planned','in_progress')
           where p.is_active and not exists (select 1 from public.task_updates u join public.tasks t2 on t2.id = u.task_id
                                             where t2.officer_id = p.id and u.created_at::date = current_date)
           group by p.id, p.full_name, p.phone loop
    perform public.notify_profile(r.id, 'Update your tasks', r.open_tasks || ' task(s) today have no update yet', '/zonal/my-tasks', 'warning', 'zonal-remind-' || current_date);
    if public.queue_notification('zonal_not_updated', 'sms', r.full_name, r.phone, null, jsonb_build_object('officer_name', r.full_name, 'amount', r.open_tasks::text),
         null, r.id, 'staff', null, null, 'zonal-remind-' || r.id || '-' || current_date) is not null then n := n + 1; end if;
  end loop;
  return n;
end $$;

-- 18:00 – daily zonal summary to managers
create or replace function public.job_zonal_summary() returns int
language plpgsql security definer set search_path = public as $$
declare v_planned int; v_done int; v_pending int; v_text text;
begin
  select count(*), count(*) filter (where status = 'completed'), count(*) filter (where status in ('planned','in_progress','pending'))
    into v_planned, v_done, v_pending from public.tasks where planned_date = current_date;
  if v_planned = 0 then return 0; end if;
  select string_agg(p.full_name || ' ' || x.done || '/' || x.total, '; ') into v_text
  from (select officer_id, count(*) total, count(*) filter (where status = 'completed') done from public.tasks where planned_date = current_date group by officer_id) x
  join public.profiles p on p.id = x.officer_id;
  perform public.notify_role('manager', 'Zonal summary ' || public.date_text(current_date), v_done || ' of ' || v_planned || ' tasks completed. ' || coalesce(v_text, ''), '/zonal/board', 'info', 'zonal-summary-' || current_date);
  return public.queue_role_message('manager', 'zonal_summary', jsonb_build_object('date', public.date_text(current_date), 'amount', v_done || '/' || v_planned,
    'balance', v_pending::text, 'period', coalesce(v_text, '')), null, null, 'zonal-summary-' || current_date);
end $$;

-- 01:00 – overdue invoices, expiries, recurring journals, materialised views
create or replace function public.job_nightly() returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_over int; v_exp int; v_surv int; v_quote int; r record; v_new uuid; v_j int := 0;
begin
  v_over := public.job_mark_overdue();
  update public.contracts set status = 'expired', next_billing_date = null where status in ('active','suspended') and end_date < current_date;
  get diagnostics v_exp = row_count;
  update public.survey_invitations set status = 'expired' where status = 'sent' and expires_at < now();
  get diagnostics v_surv = row_count;
  update public.quotations set status = 'expired' where status in ('draft','sent') and valid_until < current_date;
  get diagnostics v_quote = row_count;
  -- recurring manual journals
  for r in select * from public.journal_entries where is_manual and status = 'posted' and recur_frequency <> 'none' and next_recur_date <= current_date loop
    v_new := public._post_journal(r.next_recur_date, r.description || ' (recurring)', 'manual', r.id, 'manual_recurring',
      (select jsonb_agg(jsonb_build_object('account_id', account_id, 'debit', debit, 'credit', credit, 'description', description,
        'customer_id', customer_id, 'supplier_id', supplier_id, 'contract_id', contract_id, 'service_id', service_id, 'truck_id', truck_id) order by line_no)
       from public.journal_lines where entry_id = r.id));
    update public.journal_entries set next_recur_date = (next_recur_date + case recur_frequency when 'monthly' then interval '1 month' else interval '3 months' end)::date where id = r.id;
    v_j := v_j + 1;
  end loop;
  refresh materialized view public.mv_customer_stats;
  return jsonb_build_object('overdue', v_over, 'contracts_expired', v_exp, 'surveys_expired', v_surv, 'quotes_expired', v_quote, 'recurring_journals', v_j);
end $$;

-- every minute – hand the outbox to the send-notification Edge Function (URL and secret live in Vault)
create or replace function public.job_process_outbox() returns bigint
language plpgsql security definer set search_path = public, extensions as $$
declare v_url text; v_secret text; v_id bigint;
begin
  if not exists (select 1 from public.notifications where status = 'queued' and next_attempt_at <= now()) then return null; end if;
  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'send_notification_url';
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'cron_secret';
  if v_url is null or v_secret is null then raise notice 'Vault secrets send_notification_url / cron_secret are not set'; return null; end if;
  select net.http_post(url := v_url, body := jsonb_build_object('source', 'cron'),
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', v_secret), timeout_milliseconds := 55000) into v_id;
  return v_id;
end $$;
