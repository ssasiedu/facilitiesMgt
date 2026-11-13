-- 0014_triggers_postings_audit.sql : numbering, updated_at, guards (no skipping steps from the browser),
-- automatic recalculation, ledger postings, stock levels and the audit log.

-- =====================================================================================
-- updated_at on every table that has the column
-- =====================================================================================
do $$
declare r record;
begin
  for r in select c.table_name from information_schema.columns c join information_schema.tables t on t.table_name = c.table_name and t.table_schema = c.table_schema
           where c.table_schema = 'public' and c.column_name = 'updated_at' and t.table_type = 'BASE TABLE' loop
    execute format('drop trigger if exists trg_%1$s_updated on public.%1$I', r.table_name);
    execute format('create trigger trg_%1$s_updated before update on public.%1$I for each row execute function public.set_updated_at()', r.table_name);
  end loop;
end $$;

-- =====================================================================================
-- Document numbers (gap-free: drafts that get numbers can never be deleted, only archived/cancelled)
-- =====================================================================================
-- Numbering functions are SECURITY DEFINER (they consume the counter) and are not callable over RPC.
-- Two triggers per table: one fires only for browser writes (WHEN current_user is a PostgREST role) and always
-- overrides any client-supplied number; the other fills a number when a workflow function did not supply one.
create or replace function public.trg_assign_number() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_col text := tg_argv[0]; v_type text := tg_argv[1]; v_force boolean := tg_argv[2] = 'force';
begin
  if v_force or (to_jsonb(new) ->> v_col) is null then
    new := jsonb_populate_record(new, jsonb_build_object(v_col, public.next_doc_no(v_type)));
  end if;
  return new;
end $$;

do $$
declare r record;
begin
  for r in select * from (values
    ('customers','customer_code','customer'), ('job_orders','job_no','job_order'), ('contracts','contract_no','contract'),
    ('employees','employee_code','employee'), ('suppliers','supplier_code','supplier'), ('expenses','expense_no','expense'),
    ('bills','bill_no','bill'), ('quotations','quote_no','quotation')) as x(tbl, col, typ) loop
    execute format('drop trigger if exists trg_%1$s_number on public.%1$I', r.tbl);
    execute format('drop trigger if exists trg_%1$s_number_client on public.%1$I', r.tbl);
    execute format('create trigger trg_%1$s_number before insert on public.%1$I for each row when (current_user not in (''authenticated'',''anon'')) execute function public.trg_assign_number(%2$L, %3$L, ''if_null'')', r.tbl, r.col, r.typ);
    execute format('create trigger trg_%1$s_number_client before insert on public.%1$I for each row when (current_user in (''authenticated'',''anon'')) execute function public.trg_assign_number(%2$L, %3$L, ''force'')', r.tbl, r.col, r.typ);
  end loop;
end $$;

create or replace function public.trg_estimate_number() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_argv[0] = 'force' then new.root_id := null; new.version := 1; new.estimate_no := null; end if;
  if new.estimate_no is null then new.estimate_no := public.next_doc_no('estimate'); end if;
  return new;
end $$;
drop trigger if exists trg_estimates_number on public.estimates;
drop trigger if exists trg_estimates_number_client on public.estimates;
create trigger trg_estimates_number before insert on public.estimates for each row when (current_user not in ('authenticated','anon')) execute function public.trg_estimate_number('if_null');
create trigger trg_estimates_number_client before insert on public.estimates for each row when (current_user in ('authenticated','anon')) execute function public.trg_estimate_number('force');

create or replace function public.trg_journal_number() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_argv[0] = 'force' then
    new.status := 'draft'; new.is_manual := true; new.source_type := 'manual'; new.event_code := 'manual';
    new.posted_at := null; new.posted_by := null; new.reversal_of := null; new.reversed_by := null; new.entry_no := null;
  end if;
  if new.entry_no is null then new.entry_no := public.next_doc_no('journal', new.entry_date); end if;
  return new;
end $$;
drop trigger if exists trg_journal_entries_number on public.journal_entries;
drop trigger if exists trg_journal_entries_number_client on public.journal_entries;
create trigger trg_journal_entries_number before insert on public.journal_entries for each row when (current_user not in ('authenticated','anon')) execute function public.trg_journal_number('if_null');
create trigger trg_journal_entries_number_client before insert on public.journal_entries for each row when (current_user in ('authenticated','anon')) execute function public.trg_journal_number('force');

-- =====================================================================================
-- Customers and phone normalisation
-- =====================================================================================
create or replace function public.trg_customers_before() returns trigger
language plpgsql as $$
begin
  new.phone := public.normalize_phone(new.phone);
  new.alt_phone := public.normalize_phone(new.alt_phone);
  new.whatsapp := public.normalize_phone(new.whatsapp);
  new.company_phone := public.normalize_phone(new.company_phone);
  new.ghana_card_no := nullif(upper(btrim(new.ghana_card_no)), '');
  new.digital_address := nullif(upper(btrim(new.digital_address)), '');
  new.email := nullif(lower(btrim(new.email)), '');
  new.company_email := nullif(lower(btrim(new.company_email)), '');
  new.tin := nullif(btrim(new.tin), '');
  new.display_name := case when new.customer_type = 'company' then new.company_name
    else btrim(concat_ws(' ', nullif(new.title, ''), new.first_name, nullif(new.middle_name, ''), new.last_name)) end;
  if new.marketing_consent and (tg_op = 'INSERT' or not old.marketing_consent) then new.marketing_consent_at := now(); end if;
  if not new.marketing_consent then new.marketing_consent_at := null; end if;
  return new;
end $$;
drop trigger if exists trg_customers_before on public.customers;
create trigger trg_customers_before before insert or update on public.customers for each row execute function public.trg_customers_before();

create or replace function public.trg_normalize_phone_col() returns trigger
language plpgsql as $$
declare v_col text := tg_argv[0]; v_val text;
begin
  v_val := to_jsonb(new) ->> v_col;
  if v_val is not null then new := jsonb_populate_record(new, jsonb_build_object(v_col, public.normalize_phone(v_val))); end if;
  return new;
end $$;
do $$
declare r record;
begin
  for r in select * from (values ('customer_contacts','phone'), ('leads','phone'), ('employees','phone'), ('suppliers','phone'), ('tasks','contact_phone'), ('profiles','phone')) as x(tbl, col) loop
    execute format('drop trigger if exists trg_%1$s_phone on public.%1$I', r.tbl);
    execute format('create trigger trg_%1$s_phone before insert or update on public.%1$I for each row execute function public.trg_normalize_phone_col(%2$L)', r.tbl, r.col);
  end loop;
end $$;

create or replace function public.trg_contacts_primary() returns trigger
language plpgsql as $$
begin
  if new.is_primary then update public.customer_contacts set is_primary = false where customer_id = new.customer_id and id <> new.id and is_primary; end if;
  new.ghana_card_no := nullif(upper(btrim(new.ghana_card_no)), '');
  return new;
end $$;
drop trigger if exists trg_contacts_primary on public.customer_contacts;
create trigger trg_contacts_primary before insert or update on public.customer_contacts for each row execute function public.trg_contacts_primary();

create or replace function public.trg_leads_before() returns trigger
language plpgsql as $$
begin
  if new.stage = 'won' and (tg_op = 'INSERT' or old.stage <> 'won') then new.won_at := now(); end if;
  if new.stage = 'lost' and (tg_op = 'INSERT' or old.stage <> 'lost') then new.lost_at := now(); end if;
  if new.stage <> 'lost' then new.lost_reason := null; end if;
  return new;
end $$;
drop trigger if exists trg_leads_before on public.leads;
create trigger trg_leads_before before insert or update on public.leads for each row execute function public.trg_leads_before();

-- =====================================================================================
-- Job orders
-- =====================================================================================
create or replace function public.trg_job_orders_guard() returns trigger
language plpgsql set search_path = public as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Job orders are never deleted. Cancel it instead (Manager).';
  end if;
  select display_name into new.customer_name from public.customers where id = new.customer_id;
  if public.is_direct_client() then
    if tg_op = 'INSERT' then
      new.status := 'draft'; new.raised_by := public.current_profile_id(); new.approved_by := null; new.approved_at := null; new.invoice_id := null;
      new.started_at := null; new.started_by := null; new.completed_at := null; new.completed_by := null; new.submitted_at := null;
      new.needs_reassignment := false; new.credit_warning := false; new.subtotal := 0; new.discount_total := 0; new.tax_total := 0; new.agreed_amount := 0;
    else
      if old.status <> 'draft' then
        -- only notes/instructions and the officer in charge can change after submission
        if (to_jsonb(new) - array['instructions','officer_id','updated_at','time_window','priority']) is distinct from (to_jsonb(old) - array['instructions','officer_id','updated_at','time_window','priority']) then
          raise exception 'Job order % is %; use the workflow buttons to change it', old.job_no, old.status;
        end if;
      else
        new.status := old.status; new.job_no := old.job_no; new.raised_by := old.raised_by; new.approved_by := old.approved_by; new.approved_at := old.approved_at;
        new.invoice_id := old.invoice_id; new.subtotal := old.subtotal; new.discount_total := old.discount_total; new.tax_total := old.tax_total;
        new.agreed_amount := old.agreed_amount; new.submitted_at := old.submitted_at; new.started_at := old.started_at; new.completed_at := old.completed_at;
        new.needs_reassignment := old.needs_reassignment; new.credit_warning := old.credit_warning;
      end if;
    end if;
  end if;
  return new;
end $$;
drop trigger if exists trg_job_orders_guard on public.job_orders;
create trigger trg_job_orders_guard before insert or update or delete on public.job_orders for each row execute function public.trg_job_orders_guard();

create or replace function public.trg_job_orders_history() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    insert into public.job_order_status_history (job_order_id, from_status, to_status, note) values (new.id, null, new.status, 'Created');
  elsif new.status is distinct from old.status then
    insert into public.job_order_status_history (job_order_id, from_status, to_status, note)
    values (new.id, old.status, new.status, case new.status when 'cancelled' then new.cancel_reason when 'on_hold' then new.hold_reason
      when 'draft' then new.rejection_reason when 'completed' then 'Signed off by ' || new.signoff_name end);
  end if;
  return null;
end $$;
drop trigger if exists trg_job_orders_history on public.job_orders;
create trigger trg_job_orders_history after insert or update of status on public.job_orders for each row execute function public.trg_job_orders_history();

create or replace function public.trg_job_children_guard() returns trigger
language plpgsql set search_path = public as $$
declare v_job uuid; v_status text;
begin
  v_job := case when tg_op = 'DELETE' then old.job_order_id else new.job_order_id end;
  select status into v_status from public.job_orders where id = v_job;
  if public.is_direct_client() and v_status is distinct from 'draft' then
    raise exception 'Lines and assignments can only be changed while the job order is a draft';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end $$;
drop trigger if exists trg_job_lines_guard on public.job_order_lines;
create trigger trg_job_lines_guard before insert or update or delete on public.job_order_lines for each row execute function public.trg_job_children_guard();
drop trigger if exists trg_job_assign_guard on public.job_order_assignments;
create trigger trg_job_assign_guard before insert or update or delete on public.job_order_assignments for each row execute function public.trg_job_children_guard();

create or replace function public.trg_job_lines_recalc() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if pg_trigger_depth() = 1 then
    perform public.recalc_job_order(case when tg_op = 'DELETE' then old.job_order_id else new.job_order_id end);
  end if;
  return null;
end $$;
drop trigger if exists trg_job_lines_recalc on public.job_order_lines;
create trigger trg_job_lines_recalc after insert or update or delete on public.job_order_lines for each row execute function public.trg_job_lines_recalc();

-- assigning a truck brings its driver along (can be changed afterwards)
create or replace function public.trg_job_assign_driver() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_driver uuid;
begin
  if new.kind = 'truck' then
    select assigned_driver_id into v_driver from public.trucks where id = new.truck_id;
    if v_driver is not null and not exists (select 1 from public.job_order_assignments where job_order_id = new.job_order_id and kind = 'driver') then
      insert into public.job_order_assignments (job_order_id, kind, employee_id) values (new.job_order_id, 'driver', v_driver);
    end if;
  end if;
  return null;
end $$;
drop trigger if exists trg_job_assign_driver on public.job_order_assignments;
create trigger trg_job_assign_driver after insert on public.job_order_assignments for each row execute function public.trg_job_assign_driver();

create or replace function public.trg_job_photos_guard() returns trigger
language plpgsql set search_path = public as $$
declare v_status text;
begin
  select status into v_status from public.job_orders where id = coalesce(new.job_order_id, old.job_order_id);
  if public.is_direct_client() and tg_op = 'DELETE' and v_status in ('completed','closed') then raise exception 'Photos of completed jobs cannot be removed'; end if;
  if public.is_direct_client() and tg_op = 'INSERT' and v_status in ('cancelled','closed') then raise exception 'Job order is %', v_status; end if;
  return coalesce(new, old);
end $$;
drop trigger if exists trg_job_photos_guard on public.job_order_photos;
create trigger trg_job_photos_guard before insert or delete on public.job_order_photos for each row execute function public.trg_job_photos_guard();

-- =====================================================================================
-- Costs, stock and consumption postings
-- =====================================================================================
create or replace function public.trg_cost_line_before() returns trigger
language plpgsql set search_path = public as $$
declare ci public.cost_items; v_rate numeric;
begin
  if tg_table_name = 'job_order_actual_costs' then
    if (to_jsonb(new) ->> 'employee_id') is not null and coalesce(new.unit_cost, 0) = 0 then
      select daily_rate into v_rate from public.employees where id = (to_jsonb(new) ->> 'employee_id')::uuid; new.unit_cost := coalesce(v_rate, 0);
    end if;
  end if;
  if new.cost_item_id is not null then
    select * into ci from public.cost_items where id = new.cost_item_id;
    if coalesce(new.unit_cost, 0) = 0 then
      new.unit_cost := case when ci.category = 'vehicle' and ci.cost_per_trip > 0 then ci.cost_per_trip else ci.unit_cost end;
    elsif tg_table_name = 'contract_supplies' and public.is_direct_client() and new.unit_cost <> ci.unit_cost
          and not public.has_any_role(array['manager','accountant']) then
      raise exception 'Only a Manager or Accountant can change the catalogue unit cost (GH₵ %)', public.money_text(ci.unit_cost) using errcode = '42501';
    end if;
  end if;
  new.amount := round(new.quantity * new.unit_cost, 2);
  return new;
end $$;
drop trigger if exists trg_contract_supplies_before on public.contract_supplies;
create trigger trg_contract_supplies_before before insert or update on public.contract_supplies for each row execute function public.trg_cost_line_before();
drop trigger if exists trg_job_actual_costs_before on public.job_order_actual_costs;
create trigger trg_job_actual_costs_before before insert or update on public.job_order_actual_costs for each row execute function public.trg_cost_line_before();

-- stock issue + Dr Consumables expense / Cr Consumables inventory when issuing tracked stock
create or replace function public.trg_issue_stock() returns trigger
language plpgsql security definer set search_path = public as $$
declare ci public.cost_items; v_loc uuid; v_contract uuid; v_job uuid; v_date date;
begin
  v_loc := new.stock_location_id;
  if v_loc is null or new.cost_item_id is null then return null; end if;
  select * into ci from public.cost_items where id = new.cost_item_id;
  if not ci.track_stock then return null; end if;
  if tg_table_name = 'contract_supplies' then v_contract := (to_jsonb(new) ->> 'contract_id')::uuid; v_date := (to_jsonb(new) ->> 'supply_date')::date;
  else v_job := (to_jsonb(new) ->> 'job_order_id')::uuid; v_date := current_date; end if;
  insert into public.stock_movements (cost_item_id, location_id, movement_date, movement_type, quantity, unit_cost, reference_type, reference_id, contract_id, job_order_id, note)
  values (new.cost_item_id, v_loc, v_date, 'issue', -new.quantity, new.unit_cost, tg_table_name, new.id, v_contract, v_job, 'Issued');
  if new.amount > 0 then
    perform public._post_journal(v_date, 'Stock issued: ' || ci.name, tg_table_name, new.id, 'stock_issue', jsonb_build_array(
      jsonb_build_object('account_id', public.rule_debit('stock_issue'), 'debit', new.amount, 'contract_id', v_contract, 'job_order_id', v_job),
      jsonb_build_object('account_id', public.rule_credit('stock_issue'), 'credit', new.amount, 'contract_id', v_contract, 'job_order_id', v_job)));
  end if;
  return null;
end $$;
drop trigger if exists trg_contract_supplies_stock on public.contract_supplies;
create trigger trg_contract_supplies_stock after insert on public.contract_supplies for each row execute function public.trg_issue_stock();
drop trigger if exists trg_job_actual_costs_stock on public.job_order_actual_costs;
create trigger trg_job_actual_costs_stock after insert on public.job_order_actual_costs for each row execute function public.trg_issue_stock();

create or replace function public.trg_stocked_line_lock() returns trigger
language plpgsql as $$
begin
  if old.stock_location_id is not null then raise exception 'This line issued stock and was posted; record a correction instead'; end if;
  return coalesce(new, old);
end $$;
drop trigger if exists trg_contract_supplies_lock on public.contract_supplies;
create trigger trg_contract_supplies_lock before update or delete on public.contract_supplies for each row execute function public.trg_stocked_line_lock();
drop trigger if exists trg_job_actual_costs_lock on public.job_order_actual_costs;
create trigger trg_job_actual_costs_lock before update or delete on public.job_order_actual_costs for each row execute function public.trg_stocked_line_lock();

create or replace function public.trg_contract_labour_before() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.employee_id is not null and coalesce(new.rate, 0) = 0 then select daily_rate into new.rate from public.employees where id = new.employee_id; end if;
  new.amount := coalesce(new.actual_wage_amount, round(new.staff_count * new.days * coalesce(new.rate, 0), 2));
  return new;
end $$;
drop trigger if exists trg_contract_labour_before on public.contract_labour;
create trigger trg_contract_labour_before before insert or update on public.contract_labour for each row execute function public.trg_contract_labour_before();

create or replace function public.trg_contract_margin() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform public.check_contract_margin(coalesce((to_jsonb(new) ->> 'contract_id')::uuid, (to_jsonb(old) ->> 'contract_id')::uuid),
    coalesce((to_jsonb(new) ->> 'supply_date')::date, (to_jsonb(new) ->> 'work_date')::date, (to_jsonb(old) ->> 'supply_date')::date, (to_jsonb(old) ->> 'work_date')::date));
  return null;
end $$;
drop trigger if exists trg_contract_supplies_margin on public.contract_supplies;
create trigger trg_contract_supplies_margin after insert or update or delete on public.contract_supplies for each row execute function public.trg_contract_margin();
drop trigger if exists trg_contract_labour_margin on public.contract_labour;
create trigger trg_contract_labour_margin after insert or update or delete on public.contract_labour for each row execute function public.trg_contract_margin();

-- issuing to a contract-linked invoice also re-checks margin when revenue arrives
create or replace function public.trg_invoice_margin() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.contract_id is not null and new.status <> 'draft' and (tg_op = 'INSERT' or old.status = 'draft') then
    perform public.check_contract_margin(new.contract_id, coalesce(new.period_start, new.issue_date));
  end if;
  return null;
end $$;
drop trigger if exists trg_invoice_margin on public.invoices;
create trigger trg_invoice_margin after update of status on public.invoices for each row execute function public.trg_invoice_margin();

create or replace function public.trg_stock_levels() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_qty numeric; ci public.cost_items;
begin
  insert into public.stock_levels (cost_item_id, location_id, quantity) values (new.cost_item_id, new.location_id, new.quantity)
  on conflict (cost_item_id, location_id) do update set quantity = public.stock_levels.quantity + excluded.quantity, updated_at = now()
  returning quantity into v_qty;
  if v_qty < 0 then
    select * into ci from public.cost_items where id = new.cost_item_id;
    raise exception 'Not enough % in stock (short by %)', ci.name, -v_qty;
  end if;
  select * into ci from public.cost_items where id = new.cost_item_id;
  if new.quantity < 0 and ci.reorder_level > 0 and v_qty <= ci.reorder_level then
    perform public.notify_role('ops_officer', 'Low stock: ' || ci.name, v_qty || ' ' || ci.unit_of_measure || ' left (reorder level ' || ci.reorder_level || ')', '/supplies/stock', 'warning', 'lowstock-' || ci.id || '-' || current_date);
    perform public.notify_role('manager', 'Low stock: ' || ci.name, v_qty || ' ' || ci.unit_of_measure || ' left', '/supplies/stock', 'warning', 'lowstock-' || ci.id || '-' || current_date);
  end if;
  return null;
end $$;
drop trigger if exists trg_stock_levels on public.stock_movements;
create trigger trg_stock_levels after insert on public.stock_movements for each row execute function public.trg_stock_levels();

create or replace function public.trg_no_update_delete() returns trigger
language plpgsql as $$
begin
  raise exception '% records are permanent. Record a correction instead.', tg_table_name;
end $$;
drop trigger if exists trg_stock_movements_lock on public.stock_movements;
create trigger trg_stock_movements_lock before update or delete on public.stock_movements for each row execute function public.trg_no_update_delete();

-- catalogue price history
create or replace function public.trg_cost_item_price_history() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if pg_trigger_depth() > 1 then return null; end if;
  if tg_op = 'INSERT' or (new.unit_cost, new.cost_per_trip, new.cost_per_km, new.cost_per_day) is distinct from (old.unit_cost, old.cost_per_trip, old.cost_per_km, old.cost_per_day) then
    insert into public.cost_item_prices (cost_item_id, effective_date, unit_cost, cost_per_trip, cost_per_km, cost_per_day, note)
    values (new.id, current_date, new.unit_cost, new.cost_per_trip, new.cost_per_km, new.cost_per_day, case when tg_op = 'INSERT' then 'Initial price' else 'Edited in catalogue' end)
    on conflict (cost_item_id, effective_date) do update set unit_cost = excluded.unit_cost, cost_per_trip = excluded.cost_per_trip,
      cost_per_km = excluded.cost_per_km, cost_per_day = excluded.cost_per_day;
  end if;
  return null;
end $$;
drop trigger if exists trg_cost_items_history on public.cost_items;
create trigger trg_cost_items_history after insert or update on public.cost_items for each row execute function public.trg_cost_item_price_history();

create or replace function public.trg_cost_item_price_apply() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.effective_date <= current_date and not exists (select 1 from public.cost_item_prices p where p.cost_item_id = new.cost_item_id
       and p.effective_date > new.effective_date and p.effective_date <= current_date) then
    update public.cost_items set unit_cost = new.unit_cost, cost_per_trip = new.cost_per_trip, cost_per_km = new.cost_per_km,
      cost_per_day = new.cost_per_day, last_updated = new.effective_date where id = new.cost_item_id;
  end if;
  return null;
end $$;
drop trigger if exists trg_cost_item_prices_apply on public.cost_item_prices;
create trigger trg_cost_item_prices_apply after insert or update on public.cost_item_prices for each row execute function public.trg_cost_item_price_apply();

-- =====================================================================================
-- Estimates
-- =====================================================================================
create or replace function public.trg_estimates_guard() returns trigger
language plpgsql set search_path = public as $$
begin
  if tg_op = 'DELETE' then raise exception 'Estimates are not deleted; archive them instead'; end if;
  if public.is_direct_client() then
    if tg_op = 'INSERT' then
      new.status := 'draft'; new.approved_by := null; new.approved_at := null; new.converted_job_id := null; new.converted_contract_id := null;
    else
      if old.status not in ('draft','rejected') and (to_jsonb(new) - array['notes','archived_at','updated_at','title']) is distinct from (to_jsonb(old) - array['notes','archived_at','updated_at','title']) then
        raise exception 'Estimate % v% is %; create a new version to change it', old.estimate_no, old.version, old.status;
      end if;
      new.status := old.status; new.approved_by := old.approved_by; new.approved_at := old.approved_at; new.estimate_no := old.estimate_no;
      new.version := old.version; new.root_id := old.root_id; new.converted_job_id := old.converted_job_id; new.converted_contract_id := old.converted_contract_id;
      new.rejection_reason := old.rejection_reason;
    end if;
  end if;
  return new;
end $$;
drop trigger if exists trg_estimates_a_guard on public.estimates;
create trigger trg_estimates_a_guard before insert or update or delete on public.estimates for each row execute function public.trg_estimates_guard();
drop trigger if exists trg_estimates_b_compute on public.estimates;
create trigger trg_estimates_b_compute before insert or update on public.estimates for each row execute function public.estimates_compute();

create or replace function public.trg_estimate_lines_before() returns trigger
language plpgsql set search_path = public as $$
declare e public.estimates; ci public.cost_items;
begin
  select * into e from public.estimates where id = coalesce(new.estimate_id, old.estimate_id);
  if public.is_direct_client() and e.status not in ('draft','rejected') then raise exception 'Estimate is locked (%). Create a new version.', e.status; end if;
  if tg_op = 'DELETE' then return old; end if;
  if new.cost_item_id is not null and tg_op = 'INSERT' and new.unit_cost = 0 and new.cost_per_trip = 0 and new.cost_per_km = 0 and new.cost_per_day = 0 then
    select * into ci from public.cost_items where id = new.cost_item_id;   -- snapshot the current catalogue price
    new.unit_cost := ci.unit_cost; new.cost_per_trip := ci.cost_per_trip; new.cost_per_km := ci.cost_per_km; new.cost_per_day := ci.cost_per_day;
    new.rate_basis := ci.rate_basis; new.category := ci.category; new.unit_of_measure := coalesce(new.unit_of_measure, ci.unit_of_measure);
  end if;
  new.line_cost := public.estimate_line_cost(new.category, new.basis, new.quantity, new.headcount, new.days, new.km, new.unit_cost, new.cost_per_trip,
    new.cost_per_km, new.cost_per_day, new.rate_basis, e.hours_per_day, public.estimate_total_visits(e.is_recurring, e.visits_per_period, e.visit_period, e.contract_months));
  return new;
end $$;
drop trigger if exists trg_estimate_lines_before on public.estimate_lines;
create trigger trg_estimate_lines_before before insert or update or delete on public.estimate_lines for each row execute function public.trg_estimate_lines_before();

create or replace function public.trg_estimate_lines_after() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if pg_trigger_depth() = 1 then
    update public.estimates set updated_at = now() where id = coalesce(new.estimate_id, old.estimate_id);
  end if;
  return null;
end $$;
drop trigger if exists trg_estimate_lines_after on public.estimate_lines;
create trigger trg_estimate_lines_after after insert or update or delete on public.estimate_lines for each row execute function public.trg_estimate_lines_after();

create or replace function public.trg_estimates_refresh_lines() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if pg_trigger_depth() = 1 and (new.hours_per_day, new.is_recurring, new.visits_per_period, new.visit_period, new.contract_months)
     is distinct from (old.hours_per_day, old.is_recurring, old.visits_per_period, old.visit_period, old.contract_months) then
    update public.estimate_lines set sort_order = sort_order where estimate_id = new.id;   -- BEFORE trigger recomputes line_cost
  end if;
  return null;
end $$;
drop trigger if exists trg_estimates_refresh_lines on public.estimates;
create trigger trg_estimates_refresh_lines after update on public.estimates for each row execute function public.trg_estimates_refresh_lines();

-- =====================================================================================
-- Contracts, trucks, bills, expenses, fleet postings
-- =====================================================================================
create or replace function public.trg_contracts_guard() returns trigger
language plpgsql set search_path = public as $$
declare v_allowed text[] := array['auto_send','supervisor_id','price_review_date','renewal_reminder_days','signed_contract_path','description','updated_at','overhead_pct','archived_at'];
begin
  if tg_op = 'DELETE' then raise exception 'Contracts are not deleted; terminate them instead'; end if;
  if tg_op = 'INSERT' and new.estimate_id is not null and new.budgeted_monthly_cost = 0 then
    select cost_per_month into new.budgeted_monthly_cost from public.estimates where id = new.estimate_id;
  end if;
  if public.is_direct_client() then
    if tg_op = 'INSERT' then
      new.status := 'draft'; new.approved_by := null; new.approved_at := null; new.next_billing_date := null;
    else
      if public.has_role('manager') then v_allowed := v_allowed || array['amount_per_period','payment_terms_days','end_date','billing_day']; end if;
      if old.status <> 'draft' and (to_jsonb(new) - v_allowed) is distinct from (to_jsonb(old) - v_allowed) then
        raise exception 'Contract % is %; only supervisor, review and sending options can change', old.contract_no, old.status;
      end if;
      new.status := old.status; new.approved_by := old.approved_by; new.approved_at := old.approved_at; new.next_billing_date := old.next_billing_date;
      new.contract_no := old.contract_no;
    end if;
  end if;
  return new;
end $$;
drop trigger if exists trg_contracts_guard on public.contracts;
create trigger trg_contracts_guard before insert or update or delete on public.contracts for each row execute function public.trg_contracts_guard();

create or replace function public.trg_trucks_guard() returns trigger
language plpgsql set search_path = public as $$
begin
  if tg_op = 'DELETE' then raise exception 'Trucks are not deleted; archive them instead'; end if;
  if public.is_direct_client() then
    if tg_op = 'INSERT' then new.status := 'on_road'; new.off_road_reason := null; new.expected_return_date := null;
    elsif (new.status, new.off_road_reason, new.expected_return_date) is distinct from (old.status, old.off_road_reason, old.expected_return_date) then
      raise exception 'Use "Change status" to move a truck On-Road or Off-Road';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists trg_trucks_guard on public.trucks;
create trigger trg_trucks_guard before insert or update or delete on public.trucks for each row execute function public.trg_trucks_guard();

create or replace function public.trg_trucks_created() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.truck_status_history (truck_id, from_status, to_status, note) values (new.id, null, new.status, 'Truck added');
  return null;
end $$;
drop trigger if exists trg_trucks_created on public.trucks;
create trigger trg_trucks_created after insert on public.trucks for each row execute function public.trg_trucks_created();

create or replace function public.trg_status_doc_guard() returns trigger
language plpgsql set search_path = public as $$
declare v_keep text[] := array['status','submitted_at','approved_by','approved_at','rejection_reason','journal_entry_id','amount_paid','balance','paid_at','paid_from_bank_account_id','payment_reference','payment_journal_entry_id'];
  k text;
begin
  if tg_op = 'DELETE' then
    if old.status not in ('draft','rejected') then raise exception '% % is % and cannot be deleted', tg_table_name, coalesce(to_jsonb(old)->>'bill_no', to_jsonb(old)->>'expense_no'), old.status; end if;
    return old;
  end if;
  if public.is_direct_client() then
    if tg_op = 'INSERT' then
      new := jsonb_populate_record(new, jsonb_build_object('status', 'draft', 'approved_by', null, 'approved_at', null, 'journal_entry_id', null) ||
        case when tg_table_name = 'bills' then jsonb_build_object('amount_paid', 0) else jsonb_build_object('payment_journal_entry_id', null, 'paid_at', null) end);
    else
      if old.status not in ('draft','rejected') then raise exception 'This record is % and can no longer be edited', old.status; end if;
      foreach k in array v_keep loop
        if to_jsonb(old) ? k then new := jsonb_populate_record(new, jsonb_build_object(k, to_jsonb(old) -> k)); end if;
      end loop;
    end if;
  end if;
  return new;
end $$;
drop trigger if exists trg_bills_guard on public.bills;
create trigger trg_bills_guard before insert or update or delete on public.bills for each row execute function public.trg_status_doc_guard();
drop trigger if exists trg_expenses_guard on public.expenses;
create trigger trg_expenses_guard before insert or update or delete on public.expenses for each row execute function public.trg_status_doc_guard();

create or replace function public.trg_bill_lines() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_status text; v_bill uuid;
begin
  v_bill := coalesce(new.bill_id, old.bill_id);
  select status into v_status from public.bills where id = v_bill;
  if v_status not in ('draft','rejected') then raise exception 'Bill lines are locked once submitted'; end if;
  if tg_op <> 'DELETE' then new.amount := round(new.quantity * new.unit_cost, 2); return new; end if;
  return old;
end $$;
drop trigger if exists trg_bill_lines on public.bill_lines;
create trigger trg_bill_lines before insert or update or delete on public.bill_lines for each row execute function public.trg_bill_lines();

create or replace function public.trg_bill_total() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_bill uuid := coalesce(new.bill_id, old.bill_id); v_total numeric;
begin
  select coalesce(sum(amount), 0) into v_total from public.bill_lines where bill_id = v_bill;
  update public.bills set total = v_total, balance = v_total - amount_paid where id = v_bill;
  return null;
end $$;
drop trigger if exists trg_bill_total on public.bill_lines;
create trigger trg_bill_total after insert or update or delete on public.bill_lines for each row execute function public.trg_bill_total();

-- maintenance record: Dr Vehicle Maintenance / Cr Accounts Payable (or the bank/cash account it was paid from)
create or replace function public.trg_maintenance_post() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_j uuid; t public.trucks; ms public.maintenance_schedules;
begin
  select * into t from public.trucks where id = new.truck_id;
  if new.cost > 0 then
    v_j := public._post_journal(new.service_date, 'Maintenance ' || t.registration_no || ': ' || left(new.work_done, 80), 'maintenance', new.id, 'maintenance',
      jsonb_build_array(
        jsonb_build_object('account_id', public.rule_debit('maintenance'), 'debit', new.cost, 'truck_id', new.truck_id, 'description', new.workshop),
        jsonb_build_object('account_id', case when new.paid_from_bank_account_id is null then public.rule_credit('maintenance') else public.bank_ledger_account(new.paid_from_bank_account_id) end,
          'credit', new.cost, 'truck_id', new.truck_id)));
    update public.maintenance_records set journal_entry_id = v_j where id = new.id;
  end if;
  if new.schedule_id is not null then
    select * into ms from public.maintenance_schedules where id = new.schedule_id;
    update public.maintenance_schedules set last_done_date = new.service_date, last_done_km = coalesce(new.odometer_km, last_done_km),
      next_due_date = case when interval_days is not null then new.service_date + interval_days end,
      next_due_km = case when interval_km is not null and new.odometer_km is not null then new.odometer_km + interval_km else next_due_km end
    where id = new.schedule_id;
  end if;
  if new.odometer_km is not null and new.odometer_km > t.odometer_km then update public.trucks set odometer_km = new.odometer_km where id = t.id; end if;
  return null;
end $$;
drop trigger if exists trg_maintenance_post on public.maintenance_records;
create trigger trg_maintenance_post after insert on public.maintenance_records for each row execute function public.trg_maintenance_post();

-- fuel: Dr Fuel / Cr cash or bank (default Cash on hand)
create or replace function public.trg_fuel_post() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_j uuid; t public.trucks;
begin
  select * into t from public.trucks where id = new.truck_id;
  if new.cost > 0 then
    v_j := public._post_journal(new.log_date, 'Fuel ' || t.registration_no || ' ' || new.litres || ' L', 'fuel', new.id, 'fuel_purchase',
      jsonb_build_array(
        jsonb_build_object('account_id', public.rule_debit('fuel_purchase'), 'debit', new.cost, 'truck_id', new.truck_id, 'job_order_id', new.job_order_id),
        jsonb_build_object('account_id', case when new.paid_from_bank_account_id is null then public.rule_credit('fuel_purchase') else public.bank_ledger_account(new.paid_from_bank_account_id) end,
          'credit', new.cost, 'truck_id', new.truck_id)));
    update public.fuel_logs set journal_entry_id = v_j where id = new.id;
  end if;
  if new.odometer_km is not null and new.odometer_km > t.odometer_km then update public.trucks set odometer_km = new.odometer_km where id = t.id; end if;
  return null;
end $$;
drop trigger if exists trg_fuel_post on public.fuel_logs;
create trigger trg_fuel_post after insert on public.fuel_logs for each row execute function public.trg_fuel_post();

create or replace function public.trg_posted_fleet_lock() returns trigger
language plpgsql as $$
begin
  if tg_op = 'DELETE' then raise exception 'Posted fleet costs cannot be deleted; ask an Accountant to reverse the journal'; end if;
  if public.is_direct_client() and (to_jsonb(new) - array['notes','station','parts','workshop']) is distinct from (to_jsonb(old) - array['notes','station','parts','workshop']) then
    raise exception 'Posted fleet costs cannot be edited; ask an Accountant to reverse the journal';
  end if;
  return new;
end $$;
drop trigger if exists trg_maintenance_lock on public.maintenance_records;
create trigger trg_maintenance_lock before update or delete on public.maintenance_records for each row execute function public.trg_posted_fleet_lock();
drop trigger if exists trg_fuel_lock on public.fuel_logs;
create trigger trg_fuel_lock before update or delete on public.fuel_logs for each row execute function public.trg_posted_fleet_lock();

-- =====================================================================================
-- Invoices and the general ledger (posted records are permanent)
-- =====================================================================================
create or replace function public.trg_invoices_guard() returns trigger
language plpgsql set search_path = public as $$
begin
  if tg_op = 'DELETE' then
    if old.status <> 'draft' then raise exception 'Issued invoices are never deleted; issue a credit note'; end if;
    return old;
  end if;
  if public.is_direct_client() then
    if tg_op = 'INSERT' then
      new.status := 'draft'; new.source := 'manual'; new.invoice_no := null; new.amount_paid := 0; new.amount_credited := 0; new.journal_entry_id := null;
      new.job_order_id := null; new.revenue_deferred := false; new.period_start := null; new.period_end := null;
      select display_name into new.customer_name from public.customers where id = new.customer_id;
    else
      if old.status <> 'draft' then raise exception 'Invoice % is issued and cannot be edited; issue a credit note', old.invoice_no; end if;
      new.status := old.status; new.invoice_no := old.invoice_no; new.source := old.source; new.amount_paid := old.amount_paid;
      new.amount_credited := old.amount_credited; new.journal_entry_id := old.journal_entry_id; new.job_order_id := old.job_order_id;
      new.public_token := old.public_token; new.total := old.total; new.balance := old.balance; new.tax_total := old.tax_total;
      select display_name into new.customer_name from public.customers where id = new.customer_id;
    end if;
  end if;
  return new;
end $$;
drop trigger if exists trg_invoices_guard on public.invoices;
create trigger trg_invoices_guard before insert or update or delete on public.invoices for each row execute function public.trg_invoices_guard();

create or replace function public.trg_invoice_lines_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_status text;
begin
  select status into v_status from public.invoices where id = coalesce(new.invoice_id, old.invoice_id);
  if v_status is distinct from 'draft' and v_status is not null then raise exception 'Lines of an issued invoice cannot change'; end if;
  return coalesce(new, old);
end $$;
drop trigger if exists trg_invoice_lines_guard on public.invoice_lines;
create trigger trg_invoice_lines_guard before insert or update or delete on public.invoice_lines for each row execute function public.trg_invoice_lines_guard();

create or replace function public.trg_invoice_lines_recalc() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if pg_trigger_depth() = 1 then perform public.recalc_invoice(coalesce(new.invoice_id, old.invoice_id)); end if;
  return null;
end $$;
drop trigger if exists trg_invoice_lines_recalc on public.invoice_lines;
create trigger trg_invoice_lines_recalc after insert or update or delete on public.invoice_lines for each row execute function public.trg_invoice_lines_recalc();

create or replace function public.trg_journal_entries_guard() returns trigger
language plpgsql set search_path = public as $$
declare v_dr numeric; v_cr numeric; s public.company_settings;
begin
  if tg_op = 'DELETE' then
    if old.status = 'posted' then raise exception 'Posted journals are permanent; reverse them instead'; end if;
    return old;
  end if;
  if old.status = 'posted' then
    -- the only change allowed on a posted journal: linking its reversal / scheduling the next recurrence
    if (to_jsonb(new) - array['reversed_by','reversal_of','next_recur_date','updated_at','source_id']) is distinct from (to_jsonb(old) - array['reversed_by','reversal_of','next_recur_date','updated_at','source_id'])
       or (public.is_direct_client()) then
      raise exception 'Journal % is posted and cannot be changed', old.entry_no;
    end if;
    return new;
  end if;
  if public.is_direct_client() then
    if new.status <> old.status then raise exception 'Use Post to post a journal'; end if;
    new.entry_no := old.entry_no; new.is_manual := true; new.source_type := 'manual';
  end if;
  if new.status = 'posted' then
    select coalesce(sum(debit), 0), coalesce(sum(credit), 0) into v_dr, v_cr from public.journal_lines where entry_id = new.id;
    if v_dr <> v_cr then raise exception 'Journal does not balance: debits % vs credits %', public.money_text(v_dr), public.money_text(v_cr); end if;
    if v_dr = 0 then raise exception 'Journal has no amounts'; end if;
    s := public.app_settings();
    if s.lock_date is not null and new.entry_date <= s.lock_date then
      raise exception 'The books are locked up to %. Post with a later date.', public.date_text(s.lock_date);
    end if;
    if exists (select 1 from public.fiscal_periods fp where fp.is_closed and new.entry_date between fp.start_date and fp.end_date) then
      raise exception 'The fiscal period containing % is closed', public.date_text(new.entry_date);
    end if;
    new.total_debit := v_dr; new.total_credit := v_cr;
  end if;
  return new;
end $$;
drop trigger if exists trg_journal_entries_guard on public.journal_entries;
create trigger trg_journal_entries_guard before update or delete on public.journal_entries for each row execute function public.trg_journal_entries_guard();

create or replace function public.trg_journal_lines_guard() returns trigger
language plpgsql set search_path = public as $$
declare v_status text;
begin
  select status into v_status from public.journal_entries where id = coalesce(new.entry_id, old.entry_id);
  if v_status = 'posted' then
    if tg_op = 'UPDATE' and (to_jsonb(new) - array['cleared','cleared_at']) = (to_jsonb(old) - array['cleared','cleared_at']) and not public.is_direct_client() then
      return new;   -- reconciliation via mark_lines_cleared()
    end if;
    raise exception 'Lines of a posted journal cannot change';
  end if;
  return coalesce(new, old);
end $$;
drop trigger if exists trg_journal_lines_guard on public.journal_lines;
create trigger trg_journal_lines_guard before insert or update or delete on public.journal_lines for each row execute function public.trg_journal_lines_guard();

-- money tables that can never be edited or deleted once written
do $$
declare r record;
begin
  for r in select unnest(array['payment_allocations','receipts','credit_notes','customer_credit_applications','refunds','bill_payments','bank_transfers','contract_billing_periods','audit_log','truck_status_history','job_order_status_history']) as tbl loop
    execute format('drop trigger if exists trg_%1$s_lock on public.%1$I', r.tbl);
    execute format('create trigger trg_%1$s_lock before delete on public.%1$I for each row execute function public.trg_no_update_delete()', r.tbl);
  end loop;
end $$;
drop trigger if exists trg_audit_log_noupdate on public.audit_log;
create trigger trg_audit_log_noupdate before update on public.audit_log for each row execute function public.trg_no_update_delete();
drop trigger if exists trg_receipts_noupdate on public.receipts;
create trigger trg_receipts_noupdate before update on public.receipts for each row execute function public.trg_no_update_delete();
drop trigger if exists trg_allocations_noupdate on public.payment_allocations;
create trigger trg_allocations_noupdate before update on public.payment_allocations for each row execute function public.trg_no_update_delete();

create or replace function public.trg_payments_lock() returns trigger
language plpgsql as $$
begin
  if tg_op = 'DELETE' or public.is_direct_client() then raise exception 'Payments are permanent; record a refund or reversal instead'; end if;
  if (new.amount, new.customer_id, new.payment_date, new.method_code) is distinct from (old.amount, old.customer_id, old.payment_date, old.method_code) then
    raise exception 'Payment amounts cannot change';
  end if;
  return new;
end $$;
drop trigger if exists trg_payments_lock on public.payments;
create trigger trg_payments_lock before update or delete on public.payments for each row execute function public.trg_payments_lock();

-- =====================================================================================
-- Zonal tasks
-- =====================================================================================
create or replace function public.trg_tasks_before() returns trigger
language plpgsql set search_path = public as $$
declare p public.task_plans;
begin
  if new.plan_id is not null then
    select * into p from public.task_plans where id = new.plan_id;
    new.officer_id := p.officer_id; new.zone_id := coalesce(new.zone_id, p.zone_id);
  end if;
  if new.zone_id is null then select zone_id into new.zone_id from public.user_zones where profile_id = new.officer_id limit 1; end if;
  if new.status = 'completed' and (tg_op = 'INSERT' or old.status <> 'completed') then new.completed_at := now(); end if;
  if public.is_direct_client() and tg_op = 'UPDATE' then
    new.converted_lead_id := old.converted_lead_id; new.officer_id := old.officer_id;
  end if;
  return new;
end $$;
drop trigger if exists trg_tasks_before on public.tasks;
create trigger trg_tasks_before before insert or update on public.tasks for each row execute function public.trg_tasks_before();

create or replace function public.trg_task_updates_apply() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update public.tasks set status = coalesce(new.status, status),
    outcome_notes = case when coalesce(new.notes, '') = '' then outcome_notes else coalesce(outcome_notes || E'\n', '') || to_char(now(), 'DD/MM HH24:MI') || ' – ' || new.notes end,
    next_step = coalesce(new.next_step, next_step), follow_up_date = coalesce(new.follow_up_date, follow_up_date),
    deal_value = coalesce(new.deal_value, deal_value), last_update_at = new.created_at
  where id = new.task_id;
  return null;
end $$;
drop trigger if exists trg_task_updates_apply on public.task_updates;
create trigger trg_task_updates_apply after insert on public.task_updates for each row execute function public.trg_task_updates_apply();

create or replace function public.trg_task_checkin_touch() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update public.tasks set last_update_at = new.checked_in_at, status = case when status = 'planned' then 'in_progress' else status end where id = new.task_id;
  return null;
end $$;
drop trigger if exists trg_task_checkin_touch on public.task_checkins;
create trigger trg_task_checkin_touch after insert on public.task_checkins for each row execute function public.trg_task_checkin_touch();

create or replace function public.trg_task_comment_notify() returns trigger
language plpgsql security definer set search_path = public as $$
declare t public.tasks;
begin
  select * into t from public.tasks where id = new.task_id;
  if t.officer_id <> new.author_id then
    perform public.notify_profile(t.officer_id, 'New comment on "' || t.title || '"', left(new.body, 140), '/zonal/tasks/' || t.id, 'info');
  end if;
  return null;
end $$;
drop trigger if exists trg_task_comment_notify on public.task_comments;
create trigger trg_task_comment_notify after insert on public.task_comments for each row execute function public.trg_task_comment_notify();

-- =====================================================================================
-- Audit log on every business table
-- =====================================================================================
create or replace function public.trg_audit() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_old jsonb; v_new jsonb; v_id text;
begin
  if tg_op in ('UPDATE','DELETE') then v_old := to_jsonb(old); end if;
  if tg_op in ('INSERT','UPDATE') then v_new := to_jsonb(new); end if;
  if tg_op = 'UPDATE' and (v_old - 'updated_at') = (v_new - 'updated_at') then return null; end if;
  v_id := coalesce(v_new ->> 'id', v_old ->> 'id', v_new ->> 'code', v_old ->> 'code', v_new ->> 'event_code', v_old ->> 'event_code');
  insert into public.audit_log (table_name, record_id, action, old_values, new_values, changed_by, changed_by_user)
  values (tg_table_name, v_id, tg_op, v_old, v_new, public.current_profile_id(), auth.uid());
  return null;
end $$;

do $$
declare r record;
begin
  for r in select unnest(array[
    'profiles','user_roles','user_zones','zones','customers','customer_contacts','customer_documents','leads','lead_activities',
    'services','cost_items','cost_item_prices','estimate_templates','estimate_template_lines','estimates','estimate_lines','quotations',
    'employees','trucks','truck_documents','truck_bookings','maintenance_schedules','maintenance_records','fuel_logs',
    'job_orders','job_order_lines','job_order_assignments','job_order_photos','job_order_actual_costs',
    'contracts','contract_services','contract_sites','contract_billing_periods','contract_supplies','contract_labour','stock_locations','stock_movements',
    'tax_rates','payment_methods','invoices','invoice_lines','payments','payment_allocations','receipts','credit_notes','customer_credits',
    'customer_credit_applications','refunds','accounts','journal_entries','journal_lines','posting_rules','suppliers','bills','bill_lines','bill_payments',
    'expenses','bank_accounts','bank_transfers','fiscal_periods','surveys','survey_questions','survey_responses','task_types','task_plans','tasks',
    'task_updates','followup_tasks','notification_templates','company_settings','attachments','comments']) as tbl loop
    execute format('drop trigger if exists trg_%1$s_audit on public.%1$I', r.tbl);
    execute format('create trigger trg_%1$s_audit after insert or update or delete on public.%1$I for each row execute function public.trg_audit()', r.tbl);
  end loop;
end $$;
