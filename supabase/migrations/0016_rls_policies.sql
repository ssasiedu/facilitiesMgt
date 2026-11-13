-- 0016_rls_policies.sql : Row Level Security on every table, function privileges and a few column guards.
-- Policies use has_any_role() (Super Admin always passes). Wrapping calls in (select ...) lets Postgres
-- evaluate them once per statement instead of once per row.

create or replace function public._apply_rls(p_table text, p_select text, p_insert text, p_update text, p_delete text) returns void
language plpgsql as $$
declare r record;
begin
  execute format('alter table public.%I enable row level security', p_table);
  for r in select policyname from pg_policies where schemaname = 'public' and tablename = p_table and policyname like 'fm\_%' loop
    execute format('drop policy if exists %I on public.%I', r.policyname, p_table);
  end loop;
  if p_select is not null then execute format('create policy fm_select on public.%I for select to authenticated using (%s)', p_table, p_select); end if;
  if p_insert is not null then execute format('create policy fm_insert on public.%I for insert to authenticated with check (%s)', p_table, p_insert); end if;
  if p_update is not null then execute format('create policy fm_update on public.%I for update to authenticated using (%s) with check (%s)', p_table, p_update, p_update); end if;
  if p_delete is not null then execute format('create policy fm_delete on public.%I for delete to authenticated using (%s)', p_table, p_delete); end if;
end $$;

create or replace function public._r(p_roles text) returns text language sql immutable as $$
  select format('(select public.has_any_role(%L::text[]))', '{' || p_roles || '}')
$$;

-- driver sees a job when they are assigned to it
create or replace function public.is_assigned_to_job(p_job_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.job_order_assignments a join public.employees e on e.id = a.employee_id
                 where a.job_order_id = p_job_id and e.profile_id = public.current_profile_id())
$$;

create or replace function public.can_see_customer(p_customer_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.has_any_role(array['manager','ops_officer','sales_exec','accountant','executive'])
    or (public.has_exact_role('zonal_officer') and exists (select 1 from public.customers c where c.id = p_customer_id
          and (c.zone_id = any(public.my_zone_ids()) or c.assigned_to = public.current_profile_id() or c.created_by = public.current_profile_id())))
$$;

create or replace function public.can_see_task(p_task_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.has_any_role(array['manager','executive']) or exists (select 1 from public.tasks t where t.id = p_task_id and t.officer_id = public.current_profile_id())
$$;

do $$
declare
  ALL_AUTH text := '(select auth.uid()) is not null';
  SUPER text := public._r('super_admin');
  me text := '(select public.current_profile_id())';
  CUST_STAFF text := public._r('manager,ops_officer,sales_exec,accountant,executive');
  CUST_WRITE text := public._r('manager,ops_officer,sales_exec');
  ZONAL text := '(select public.has_exact_role(''zonal_officer''))';
  MYZONES text := '((select public.my_zone_ids())::uuid[])';
  FLEET_VIEW text := public._r('fleet_manager,manager,ops_officer,sales_exec,accountant,executive');
  FLEET_WRITE text := public._r('fleet_manager');
  JOB_VIEW text := public._r('manager,ops_officer,sales_exec,accountant,fleet_manager,executive');
  JOB_WRITE text := public._r('manager,ops_officer,sales_exec');
  EST_VIEW text := public._r('manager,ops_officer,sales_exec,accountant,executive');
  CON_VIEW text := public._r('manager,ops_officer,sales_exec,accountant,executive');
  CON_WRITE text := public._r('manager,ops_officer,sales_exec,accountant');
  SUP_VIEW text := public._r('manager,ops_officer,accountant,executive');
  SUP_WRITE text := public._r('manager,ops_officer');
  FIN_VIEW text := public._r('accountant,manager,ops_officer,sales_exec,executive');
  ACC text := public._r('accountant');
  ACC_VIEW text := public._r('accountant,manager,executive');
  EXP_VIEW text := public._r('accountant,manager,executive,fleet_manager');
  CAT_VIEW text := public._r('manager,ops_officer,sales_exec,accountant,executive,fleet_manager');
  CAT_WRITE text := public._r('manager,accountant');
  MGR text := public._r('manager');
  ANY_ROLE text := public._r('manager,ops_officer,sales_exec,zonal_officer,accountant,fleet_manager,driver,executive');
begin
  -- identity
  perform public._apply_rls('roles', ALL_AUTH, SUPER, SUPER, SUPER);
  perform public._apply_rls('profiles', ALL_AUTH, SUPER, format('%s or user_id = (select auth.uid())', SUPER), SUPER);
  perform public._apply_rls('user_roles', ALL_AUTH, SUPER, SUPER, SUPER);
  perform public._apply_rls('zones', ALL_AUTH, public._r('manager'), public._r('manager'), SUPER);
  perform public._apply_rls('user_zones', ALL_AUTH, public._r('manager'), public._r('manager'), public._r('manager'));

  -- customers & leads
  perform public._apply_rls('customers',
    format('%s or (%s and (zone_id = any(%s) or assigned_to = %s or created_by = %s))', CUST_STAFF, ZONAL, MYZONES, me, me),
    format('%s or (%s and zone_id = any(%s))', CUST_WRITE, ZONAL, MYZONES),
    format('%s or (%s and zone_id = any(%s))', CUST_WRITE, ZONAL, MYZONES),
    SUPER);
  perform public._apply_rls('customer_contacts', 'public.can_see_customer(customer_id)',
    format('public.can_see_customer(customer_id) and (%s or %s)', CUST_WRITE, ZONAL), format('public.can_see_customer(customer_id) and (%s or %s)', CUST_WRITE, ZONAL),
    format('public.can_see_customer(customer_id) and (%s or %s)', CUST_WRITE, ZONAL));
  perform public._apply_rls('customer_documents', 'public.can_see_customer(customer_id)',
    format('public.can_see_customer(customer_id) and (%s or %s)', CUST_WRITE, ZONAL), null, format('public.can_see_customer(customer_id) and %s', CUST_WRITE));
  perform public._apply_rls('leads', format('%s or owner_id = %s', public._r('manager,ops_officer,sales_exec,executive'), me),
    format('%s or (%s and owner_id = %s)', public._r('manager,sales_exec'), ZONAL, me),
    format('%s or owner_id = %s', public._r('manager,sales_exec'), me), SUPER);
  perform public._apply_rls('lead_activities', 'exists (select 1 from public.leads l where l.id = lead_id)',
    format('exists (select 1 from public.leads l where l.id = lead_id) and %s', public._r('manager,sales_exec,zonal_officer')), null, SUPER);

  -- catalogue & estimator
  perform public._apply_rls('services', ALL_AUTH, public._r('manager'), public._r('manager'), SUPER);
  perform public._apply_rls('cost_items', CAT_VIEW, CAT_WRITE, CAT_WRITE, SUPER);
  perform public._apply_rls('cost_item_prices', CAT_VIEW, CAT_WRITE, CAT_WRITE, CAT_WRITE);
  perform public._apply_rls('estimate_templates', CAT_VIEW, CAT_WRITE, CAT_WRITE, CAT_WRITE);
  perform public._apply_rls('estimate_template_lines', CAT_VIEW, CAT_WRITE, CAT_WRITE, CAT_WRITE);
  perform public._apply_rls('estimates', EST_VIEW, JOB_WRITE, JOB_WRITE, null);
  perform public._apply_rls('estimate_lines', EST_VIEW, JOB_WRITE, JOB_WRITE, JOB_WRITE);
  perform public._apply_rls('quotations', EST_VIEW, null, JOB_WRITE, null);

  -- fleet
  perform public._apply_rls('employees', format('%s or profile_id = %s', FLEET_VIEW, me), FLEET_WRITE, FLEET_WRITE, SUPER);
  perform public._apply_rls('trucks', format('%s or exists (select 1 from public.employees e where e.id = assigned_driver_id and e.profile_id = %s)', FLEET_VIEW, me), FLEET_WRITE, FLEET_WRITE, null);
  perform public._apply_rls('truck_documents', FLEET_VIEW, FLEET_WRITE, FLEET_WRITE, FLEET_WRITE);
  perform public._apply_rls('truck_status_history', FLEET_VIEW, null, null, null);
  perform public._apply_rls('truck_bookings', FLEET_VIEW, null, null, null);
  perform public._apply_rls('employee_bookings', FLEET_VIEW, null, null, null);
  perform public._apply_rls('maintenance_schedules', FLEET_VIEW, FLEET_WRITE, FLEET_WRITE, FLEET_WRITE);
  perform public._apply_rls('maintenance_records', FLEET_VIEW, FLEET_WRITE, FLEET_WRITE, null);
  perform public._apply_rls('fuel_logs', format('%s or created_by = %s', FLEET_VIEW, me),
    format('%s or exists (select 1 from public.trucks t join public.employees e on e.id = t.assigned_driver_id where t.id = truck_id and e.profile_id = %s)', FLEET_WRITE, me),
    FLEET_WRITE, null);

  -- job orders
  perform public._apply_rls('job_orders', format('%s or public.is_assigned_to_job(id)', JOB_VIEW), JOB_WRITE, JOB_WRITE, null);
  perform public._apply_rls('job_order_lines', 'exists (select 1 from public.job_orders j where j.id = job_order_id)', JOB_WRITE, JOB_WRITE, JOB_WRITE);
  perform public._apply_rls('job_order_assignments', 'exists (select 1 from public.job_orders j where j.id = job_order_id)', JOB_WRITE, JOB_WRITE, JOB_WRITE);
  perform public._apply_rls('job_order_status_history', 'exists (select 1 from public.job_orders j where j.id = job_order_id)', null, null, null);
  perform public._apply_rls('job_order_photos', 'exists (select 1 from public.job_orders j where j.id = job_order_id)',
    format('%s or public.is_assigned_to_job(job_order_id)', JOB_WRITE), null, public._r('manager,ops_officer'));
  perform public._apply_rls('job_order_actual_costs', 'exists (select 1 from public.job_orders j where j.id = job_order_id)',
    public._r('manager,ops_officer'), public._r('manager,ops_officer'), public._r('manager,ops_officer'));

  -- contracts, supplies, stock
  perform public._apply_rls('contracts', CON_VIEW, CON_WRITE, CON_WRITE, null);
  perform public._apply_rls('contract_services', CON_VIEW, CON_WRITE, CON_WRITE, CON_WRITE);
  perform public._apply_rls('contract_sites', format('%s or %s', CON_VIEW, SUP_VIEW), CON_WRITE, CON_WRITE, CON_WRITE);
  perform public._apply_rls('contract_billing_periods', CON_VIEW, null, null, null);
  perform public._apply_rls('contract_supplies', SUP_VIEW, SUP_WRITE, SUP_WRITE, SUP_WRITE);
  perform public._apply_rls('contract_labour', SUP_VIEW, SUP_WRITE, SUP_WRITE, SUP_WRITE);
  perform public._apply_rls('stock_locations', SUP_VIEW, SUP_WRITE, SUP_WRITE, SUPER);
  perform public._apply_rls('stock_levels', SUP_VIEW, null, null, null);
  perform public._apply_rls('stock_movements', SUP_VIEW, null, null, null);

  -- billing
  perform public._apply_rls('tax_rates', ALL_AUTH, SUPER, SUPER, SUPER);
  perform public._apply_rls('payment_methods', ALL_AUTH, SUPER, SUPER, SUPER);
  perform public._apply_rls('invoices', FIN_VIEW, ACC, ACC, ACC);
  perform public._apply_rls('invoice_lines', 'exists (select 1 from public.invoices i where i.id = invoice_id)', ACC, ACC, ACC);
  perform public._apply_rls('invoice_taxes', 'exists (select 1 from public.invoices i where i.id = invoice_id)', null, null, null);
  perform public._apply_rls('payments', FIN_VIEW, null, null, null);
  perform public._apply_rls('payment_allocations', FIN_VIEW, null, null, null);
  perform public._apply_rls('receipts', FIN_VIEW, null, null, null);
  perform public._apply_rls('credit_notes', FIN_VIEW, null, null, null);
  perform public._apply_rls('customer_credits', FIN_VIEW, null, null, null);
  perform public._apply_rls('customer_credit_applications', FIN_VIEW, null, null, null);
  perform public._apply_rls('refunds', FIN_VIEW, null, null, null);
  perform public._apply_rls('payment_sessions', ACC_VIEW, null, null, null);

  -- accounting
  perform public._apply_rls('accounts', EXP_VIEW, public._r('accountant'), public._r('accountant'), SUPER);
  perform public._apply_rls('journal_entries', ACC_VIEW, ACC, ACC, ACC);
  perform public._apply_rls('journal_lines', 'exists (select 1 from public.journal_entries e where e.id = entry_id)', ACC, ACC, ACC);
  perform public._apply_rls('posting_rules', ACC_VIEW, SUPER, public._r('accountant'), SUPER);
  perform public._apply_rls('suppliers', public._r('accountant,manager,executive,fleet_manager,ops_officer'), public._r('accountant,fleet_manager,manager'), public._r('accountant,fleet_manager,manager'), SUPER);
  perform public._apply_rls('bills', format('%s or (%s and is_fleet)', ACC_VIEW, FLEET_WRITE), format('%s or (%s and is_fleet)', ACC, FLEET_WRITE),
    format('%s or (%s and is_fleet)', ACC, FLEET_WRITE), format('%s or (%s and is_fleet)', ACC, FLEET_WRITE));
  perform public._apply_rls('bill_lines', 'exists (select 1 from public.bills b where b.id = bill_id)', format('exists (select 1 from public.bills b where b.id = bill_id) and %s', public._r('accountant,fleet_manager')),
    format('exists (select 1 from public.bills b where b.id = bill_id) and %s', public._r('accountant,fleet_manager')), format('exists (select 1 from public.bills b where b.id = bill_id) and %s', public._r('accountant,fleet_manager')));
  perform public._apply_rls('bill_payments', ACC_VIEW, null, null, null);
  perform public._apply_rls('expenses', format('%s or (%s and is_fleet)', ACC_VIEW, FLEET_WRITE), format('%s or (%s and is_fleet)', ACC, FLEET_WRITE),
    format('%s or (%s and is_fleet)', ACC, FLEET_WRITE), format('%s or (%s and is_fleet)', ACC, FLEET_WRITE));
  perform public._apply_rls('bank_accounts', public._r('accountant,manager,executive,fleet_manager'), public._r('accountant'), public._r('accountant'), SUPER);
  perform public._apply_rls('bank_transfers', ACC_VIEW, null, null, null);
  perform public._apply_rls('fiscal_periods', ACC_VIEW, public._r('accountant'), public._r('accountant'), SUPER);

  -- surveys
  perform public._apply_rls('surveys', public._r('manager,ops_officer,sales_exec,executive,accountant'), MGR, MGR, SUPER);
  perform public._apply_rls('survey_questions', public._r('manager,ops_officer,sales_exec,executive,accountant'), MGR, MGR, MGR);
  perform public._apply_rls('survey_invitations', public._r('manager,ops_officer,sales_exec,executive,accountant'), null, null, null);
  perform public._apply_rls('survey_responses', public._r('manager,ops_officer,sales_exec,executive'), null, null, null);
  perform public._apply_rls('survey_answers', public._r('manager,ops_officer,sales_exec,executive'), null, null, null);

  -- zonal work: officers see and edit only their own; managers see all
  perform public._apply_rls('task_types', ALL_AUTH, MGR, MGR, SUPER);
  perform public._apply_rls('task_plans', format('%s or officer_id = %s', public._r('manager,executive'), me),
    format('%s or (%s and officer_id = %s)', MGR, ZONAL, me), format('%s or officer_id = %s', MGR, me), format('%s or officer_id = %s', MGR, me));
  perform public._apply_rls('tasks', format('%s or officer_id = %s', public._r('manager,executive'), me),
    format('%s or (%s and officer_id = %s)', MGR, ZONAL, me), format('%s or officer_id = %s', MGR, me), format('%s or officer_id = %s', MGR, me));
  perform public._apply_rls('task_updates', 'public.can_see_task(task_id)', format('public.can_see_task(task_id) and created_by = %s', me), null, null);
  perform public._apply_rls('task_checkins', 'public.can_see_task(task_id)', format('public.can_see_task(task_id) and officer_id = %s', me), null, null);
  perform public._apply_rls('task_comments', 'public.can_see_task(task_id)', format('public.can_see_task(task_id) and author_id = %s', me), null, format('author_id = %s', me));
  perform public._apply_rls('followup_tasks', public._r('manager,executive'), MGR, MGR, SUPER);

  -- system
  perform public._apply_rls('notification_templates', public._r('manager'), SUPER, SUPER, SUPER);
  perform public._apply_rls('notifications', public._r('manager,ops_officer,sales_exec,accountant,executive'), null, null, null);
  perform public._apply_rls('in_app_notifications', format('profile_id = %s', me), null, format('profile_id = %s', me), format('profile_id = %s', me));
  perform public._apply_rls('company_settings', ALL_AUTH, null, SUPER, null);
  perform public._apply_rls('document_sequences', SUPER, null, SUPER, null);
  perform public._apply_rls('attachments', ANY_ROLE, ANY_ROLE, null, format('uploaded_by = %s or %s', me, SUPER));
  perform public._apply_rls('comments', ANY_ROLE, format('%s and author_id = %s', ANY_ROLE, me), null, format('author_id = %s', me));
  perform public._apply_rls('public_links', public._r('accountant,manager'), null, null, null);
  perform public._apply_rls('audit_log', public._r('manager,accountant,executive'), null, null, null);
end $$;

-- every public table must have RLS: fail loudly if one was missed
do $$
declare r record;
begin
  for r in select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity loop
    raise exception 'RLS is not enabled on public.%', r.relname;
  end loop;
end $$;

-- column guards
create or replace function public.trg_profiles_guard() returns trigger language plpgsql set search_path = public as $$
begin
  if public.is_direct_client() and not public.has_role('super_admin') and
     (new.is_active, new.user_id, new.email, new.archived_at, new.is_demo) is distinct from (old.is_active, old.user_id, old.email, old.archived_at, old.is_demo) then
    raise exception 'Only a Super Admin can change account status or email';
  end if;
  return new;
end $$;
drop trigger if exists trg_profiles_guard on public.profiles;
create trigger trg_profiles_guard before update on public.profiles for each row execute function public.trg_profiles_guard();

create or replace function public.trg_sequences_guard() returns trigger language plpgsql set search_path = public as $$
begin
  if public.is_direct_client() and (new.last_value, new.year, new.doc_type) is distinct from (old.last_value, old.year, old.doc_type) then
    raise exception 'Document counters cannot be edited (numbers must stay gap-free); only prefix and padding can change';
  end if;
  return new;
end $$;
drop trigger if exists trg_sequences_guard on public.document_sequences;
create trigger trg_sequences_guard before update on public.document_sequences for each row execute function public.trg_sequences_guard();

-- =====================================================================================
-- Function privileges: nothing is callable by anon; authenticated users get the RPC surface only.
-- =====================================================================================
revoke execute on all functions in schema public from public, anon, authenticated;
alter default privileges in schema public revoke execute on functions from public, anon, authenticated;
grant execute on all functions in schema public to service_role;

do $$
declare f text;
begin
  foreach f in array array[
    -- helpers used inside policies, defaults and browser-side triggers
    'current_profile_id','has_role','has_any_role','has_exact_role','my_zone_ids','is_direct_client','my_roles','normalize_phone',
    'money_text','date_text','estimate_line_cost','estimate_total_visits','is_assigned_to_job','can_see_customer','can_see_task','require_role',
    'set_updated_at','app_settings',
    -- workflow RPCs
    'submit_job_order','approve_job_order','reject_job_order','start_job_order','complete_job_order','cancel_job_order','hold_job_order',
    'resume_job_order','reassign_job_truck','get_my_jobs','get_truck_availability','set_truck_status',
    'record_payment','apply_customer_credit','issue_credit_note','refund_customer_credit','issue_invoice',
    'apply_estimate_template','submit_estimate','approve_estimate','reject_estimate','new_estimate_version','create_quotation','set_quotation_status',
    'convert_estimate_to_job','convert_estimate_to_contract','submit_contract','approve_contract','reject_contract','set_contract_status',
    'generate_recurring_invoices','post_journal','reverse_journal','mark_lines_cleared','record_bank_transfer',
    'submit_bill','approve_bill','reject_bill','pay_bill','submit_expense','approve_expense','reject_expense','pay_expense','receive_stock',
    'check_customer_duplicates','import_customers','convert_lead_to_customer','convert_task_to_lead','resolve_followup','create_statement_link',
    'mark_notifications_read','send_test_sms',
    -- reports
    'rpt_customer_statement','rpt_ar_aging','rpt_ap_aging','get_customer_overview','list_customer_stats','truck_off_road_days','rpt_fleet',
    'rpt_trial_balance','rpt_profit_and_loss','rpt_balance_sheet','rpt_cash_flow','rpt_general_ledger','rpt_tax_summary','rpt_expenses_by_category',
    'global_search','get_activity_timeline','get_dashboard','contract_month_figures','compute_taxes','_require_finance_view'] loop
    execute format('grant execute on function public.%I to authenticated', f);
  end loop;
end $$;

-- the materialised view has no RLS: expose it only through list_customer_stats()
revoke all on public.mv_customer_stats from anon, authenticated;
grant select on public.mv_customer_stats to service_role;
