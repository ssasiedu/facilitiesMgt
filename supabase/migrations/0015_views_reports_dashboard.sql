-- 0015_views_reports_dashboard.sql : reporting views (RLS-aware: security_invoker) and report/dashboard RPCs.
-- Report RPCs are SECURITY DEFINER with an explicit role check so they run fast on large data.

-- =====================================================================================
-- Customers and receivables
-- =====================================================================================
create or replace view public.v_customer_balances with (security_invoker = true) as
select c.id as customer_id, c.customer_code, c.display_name, c.customer_type, c.zone_id, c.status, c.credit_limit,
  coalesce(i.invoiced, 0) as total_invoiced, coalesce(i.paid, 0) as total_paid, coalesce(i.credited, 0) as total_credited,
  coalesce(i.outstanding, 0) as outstanding, coalesce(i.overdue, 0) as overdue,
  coalesce((select sum(cc.amount - cc.amount_used) from public.customer_credits cc where cc.customer_id = c.id), 0) as available_credit,
  i.last_invoice_date
from public.customers c
left join lateral (
  select sum(total) filter (where status <> 'draft') as invoiced, sum(amount_paid) as paid, sum(amount_credited) as credited,
    sum(balance) filter (where status in ('issued','due','partially_paid','overdue')) as outstanding,
    sum(balance) filter (where status = 'overdue') as overdue, max(issue_date) filter (where status <> 'draft') as last_invoice_date
  from public.invoices where customer_id = c.id) i on true;

-- Statement lines from the customer's point of view: invoices and refunds increase what they owe; payments and credit notes reduce it.
create or replace view public.v_customer_statement with (security_invoker = true) as
select i.customer_id, i.issue_date as txn_date, 'invoice'::text as doc_type, i.invoice_no as doc_no,
  coalesce(i.notes, 'Invoice') as description, i.total as debit, 0::numeric as credit, i.id as ref_id, i.issued_at as sort_ts
from public.invoices i where i.status <> 'draft'
union all
select p.customer_id, p.payment_date, 'payment', coalesce(r.receipt_no, p.payment_no),
  'Payment – ' || pm.name || coalesce(' (' || p.reference || ')', ''), 0, p.amount, p.id, p.created_at
from public.payments p join public.payment_methods pm on pm.code = p.method_code left join public.receipts r on r.payment_id = p.id
where p.status = 'posted'
union all
select cn.customer_id, cn.issue_date, 'credit_note', cn.credit_note_no, 'Credit note – ' || cn.reason, 0, cn.amount, cn.id, cn.created_at
from public.credit_notes cn
union all
select rf.customer_id, rf.refund_date, 'refund', rf.refund_no, 'Refund' || coalesce(' (' || rf.reference || ')', ''), rf.amount, 0, rf.id, rf.created_at
from public.refunds rf;

create or replace function public.rpt_customer_statement(p_customer_id uuid, p_from date, p_to date)
returns table (txn_date date, doc_type text, doc_no text, description text, debit numeric, credit numeric, balance numeric)
language sql stable security invoker set search_path = public as $$
  with opening as (
    select coalesce(sum(debit - credit), 0) as bal from public.v_customer_statement where customer_id = p_customer_id and txn_date < p_from
  ), lines as (
    select s.txn_date, s.doc_type, s.doc_no, s.description, s.debit, s.credit, s.sort_ts
    from public.v_customer_statement s where s.customer_id = p_customer_id and s.txn_date between p_from and p_to
  )
  select p_from, 'opening', null, 'Opening balance', null::numeric, null::numeric, (select bal from opening)
  union all
  select * from (
    select l.txn_date, l.doc_type, l.doc_no, l.description, l.debit, l.credit,
      (select bal from opening) + sum(l.debit - l.credit) over (order by l.txn_date, l.sort_ts, l.doc_no rows unbounded preceding)
    from lines l order by l.txn_date, l.sort_ts, l.doc_no) x
$$;

create or replace view public.v_ar_aging with (security_invoker = true) as
select i.id as invoice_id, i.invoice_no, i.customer_id, i.customer_name, i.issue_date, i.due_date, i.total, i.balance, i.status,
  greatest(current_date - coalesce(i.due_date, current_date), 0) as days_overdue,
  case when i.due_date is null or i.due_date >= current_date then 'current'
       when current_date - i.due_date <= 30 then '1_30'
       when current_date - i.due_date <= 60 then '31_60'
       when current_date - i.due_date <= 90 then '61_90' else '90_plus' end as bucket
from public.invoices i where i.status in ('issued','due','partially_paid','overdue') and i.balance > 0;

create or replace function public.rpt_ar_aging(p_as_of date default current_date)
returns table (customer_id uuid, customer_name text, current_amt numeric, d1_30 numeric, d31_60 numeric, d61_90 numeric, d90_plus numeric, total numeric)
language plpgsql stable security definer set search_path = public as $$
begin
  perform public.require_role(array['accountant','manager','executive','sales_exec','ops_officer']);
  return query
  select i.customer_id, max(i.customer_name),
    sum(i.balance) filter (where i.due_date is null or i.due_date >= p_as_of),
    sum(i.balance) filter (where p_as_of - i.due_date between 1 and 30),
    sum(i.balance) filter (where p_as_of - i.due_date between 31 and 60),
    sum(i.balance) filter (where p_as_of - i.due_date between 61 and 90),
    sum(i.balance) filter (where p_as_of - i.due_date > 90),
    sum(i.balance)
  from public.invoices i
  where i.status in ('issued','due','partially_paid','overdue') and i.balance > 0
    and true
  group by i.customer_id order by sum(i.balance) desc;
end $$;

create or replace function public.rpt_ap_aging(p_as_of date default current_date)
returns table (supplier_id uuid, supplier_name text, current_amt numeric, d1_30 numeric, d31_60 numeric, d61_90 numeric, d90_plus numeric, total numeric)
language plpgsql stable security definer set search_path = public as $$
begin
  perform public.require_role(array['accountant','manager','executive']);
  return query
  select x.supplier_id, s.name,
    sum(x.bal) filter (where x.due is null or x.due >= p_as_of), sum(x.bal) filter (where p_as_of - x.due between 1 and 30),
    sum(x.bal) filter (where p_as_of - x.due between 31 and 60), sum(x.bal) filter (where p_as_of - x.due between 61 and 90),
    sum(x.bal) filter (where p_as_of - x.due > 90), sum(x.bal)
  from (select supplier_id, balance as bal, coalesce(due_date, bill_date) as due from public.bills where status in ('approved','partially_paid') and balance > 0
        union all
        select supplier_id, amount, expense_date from public.expenses where status = 'approved') x
  left join public.suppliers s on s.id = x.supplier_id
  where true
  group by x.supplier_id, s.name order by sum(x.bal) desc;
end $$;

-- live customer overview (profile page)
create or replace function public.get_customer_overview(p_customer_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not exists (select 1 from public.customers c where c.id = p_customer_id and (
       public.has_any_role(array['manager','ops_officer','sales_exec','accountant','executive'])
       or (public.has_exact_role('zonal_officer') and c.zone_id = any(public.my_zone_ids())))) then
    raise exception 'Permission denied' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'lifetime_value', (select coalesce(sum(total - amount_credited), 0) from public.invoices where customer_id = p_customer_id and status <> 'draft'),
    'outstanding', public.customer_outstanding(p_customer_id),
    'overdue', (select coalesce(sum(balance), 0) from public.invoices where customer_id = p_customer_id and status = 'overdue'),
    'available_credit', (select coalesce(sum(amount - amount_used), 0) from public.customer_credits where customer_id = p_customer_id),
    'last_job', (select jsonb_build_object('id', id, 'job_no', job_no, 'date', execution_date, 'status', status) from public.job_orders
                 where customer_id = p_customer_id and status not in ('cancelled') order by execution_date desc limit 1),
    'jobs', (select count(*) from public.job_orders where customer_id = p_customer_id),
    'active_contracts', (select count(*) from public.contracts where customer_id = p_customer_id and status = 'active'),
    'avg_survey', (select round(avg(csat), 2) from public.survey_responses where customer_id = p_customer_id),
    'nps', (select round(avg(nps_score), 1) from public.survey_responses where customer_id = p_customer_id));
end $$;

create materialized view if not exists public.mv_customer_stats as
select c.id as customer_id,
  coalesce((select sum(total - amount_credited) from public.invoices i where i.customer_id = c.id and i.status <> 'draft'), 0) as lifetime_value,
  coalesce((select sum(balance) from public.invoices i where i.customer_id = c.id and i.status in ('issued','due','partially_paid','overdue')), 0) as outstanding,
  (select max(execution_date) from public.job_orders j where j.customer_id = c.id and j.status in ('completed','closed')) as last_job_date,
  (select count(*) from public.job_orders j where j.customer_id = c.id) as job_count,
  (select round(avg(csat), 2) from public.survey_responses s where s.customer_id = c.id) as avg_csat,
  now() as refreshed_at
from public.customers c;
create unique index if not exists mv_customer_stats_pk on public.mv_customer_stats(customer_id);

create or replace function public.list_customer_stats(p_ids uuid[]) returns setof public.mv_customer_stats
language plpgsql stable security definer set search_path = public as $$
begin
  perform public.require_role(array['manager','ops_officer','sales_exec','accountant','executive','zonal_officer']);
  return query
  select * from public.mv_customer_stats where customer_id = any(p_ids)
    and true;
end $$;

-- =====================================================================================
-- Fleet
-- =====================================================================================
create or replace view public.v_truck_availability with (security_invoker = true) as
select t.id as truck_id, t.registration_no, t.fleet_code, t.truck_type, t.status, t.off_road_reason, t.expected_return_date, d::date as day,
  (select j.job_no from public.truck_bookings b join public.job_orders j on j.id = b.job_order_id where b.truck_id = t.id and b.active and b.period @> d::date limit 1) as booked_job_no,
  (select b.job_order_id from public.truck_bookings b where b.truck_id = t.id and b.active and b.period @> d::date limit 1) as booked_job_id,
  case when t.status = 'off_road' and (t.expected_return_date is null or d::date < t.expected_return_date) then false
       when exists (select 1 from public.truck_bookings b where b.truck_id = t.id and b.active and b.period @> d::date) then false else true end as available
from public.trucks t cross join generate_series(current_date - 7, current_date + 60, interval '1 day') d
where t.archived_at is null;

-- days a truck was Off-Road between two dates, from the status history
create or replace function public.truck_off_road_days(p_truck_id uuid, p_from date, p_to date) returns int
language sql stable security definer set search_path = public as $$
  with h as (
    select changed_at::date as d_from, lead(changed_at::date, 1, p_to + 1) over (order by changed_at) as d_to, to_status
    from public.truck_status_history where truck_id = p_truck_id and changed_at::date <= p_to
  )
  select coalesce(sum(greatest(least(d_to, p_to + 1) - greatest(d_from, p_from), 0)), 0)::int from h where to_status = 'off_road'
$$;

create or replace function public.rpt_fleet(p_from date, p_to date)
returns table (truck_id uuid, registration_no text, truck_type text, status text, days int, downtime_days int, availability_pct numeric,
  jobs int, revenue numeric, maintenance_cost numeric, fuel_cost numeric, fuel_litres numeric, km numeric, cost_per_km numeric, km_per_litre numeric)
language plpgsql stable security definer set search_path = public as $$
begin
  perform public.require_role(array['fleet_manager','manager','executive','accountant','ops_officer']);
  return query
  select t.id, t.registration_no, t.truck_type, t.status, (p_to - p_from + 1),
    public.truck_off_road_days(t.id, p_from, p_to),
    round(100.0 * ((p_to - p_from + 1) - public.truck_off_road_days(t.id, p_from, p_to)) / (p_to - p_from + 1), 1),
    (select count(distinct a.job_order_id)::int from public.job_order_assignments a join public.job_orders j on j.id = a.job_order_id
      where a.truck_id = t.id and a.kind = 'truck' and j.status in ('completed','closed') and j.execution_date between p_from and p_to),
    coalesce((select sum(i.total - i.tax_total - i.amount_credited) from public.invoices i
      where i.job_order_id in (select a.job_order_id from public.job_order_assignments a join public.job_orders j on j.id = a.job_order_id
                               where a.truck_id = t.id and a.kind = 'truck' and j.execution_date between p_from and p_to)
        and i.status <> 'draft'), 0),
    coalesce((select sum(cost) from public.maintenance_records m where m.truck_id = t.id and m.service_date between p_from and p_to), 0),
    coalesce((select sum(cost) from public.fuel_logs f where f.truck_id = t.id and f.log_date between p_from and p_to), 0),
    coalesce((select sum(litres) from public.fuel_logs f where f.truck_id = t.id and f.log_date between p_from and p_to), 0),
    coalesce((select max(odometer_km) - min(odometer_km) from public.fuel_logs f where f.truck_id = t.id and f.log_date between p_from and p_to), 0),
    round((coalesce((select sum(cost) from public.maintenance_records m where m.truck_id = t.id and m.service_date between p_from and p_to), 0)
         + coalesce((select sum(cost) from public.fuel_logs f where f.truck_id = t.id and f.log_date between p_from and p_to), 0))
         / nullif((select max(odometer_km) - min(odometer_km) from public.fuel_logs f where f.truck_id = t.id and f.log_date between p_from and p_to), 0), 2),
    round((select max(odometer_km) - min(odometer_km) from public.fuel_logs f where f.truck_id = t.id and f.log_date between p_from and p_to)
         / nullif((select sum(litres) from public.fuel_logs f where f.truck_id = t.id and f.log_date between p_from and p_to and f.odometer_km is not null), 0), 2)
  from public.trucks t
  where t.archived_at is null and true
  order by t.registration_no;
end $$;

-- =====================================================================================
-- Profitability and estimate vs actual
-- =====================================================================================
create or replace view public.v_job_profitability with (security_invoker = true) as
select j.id as job_order_id, j.job_no, j.customer_id, j.customer_name, j.status, j.execution_date, j.estimate_id, j.contract_id,
  coalesce(i.total - i.tax_total - (i.amount_credited - coalesce(cn.tax, 0)), j.agreed_amount - j.tax_total) as revenue,
  coalesce(ac.consumable, 0) as cost_consumable, coalesce(ac.labour, 0) as cost_labour,
  coalesce(ac.vehicle, 0) + coalesce(f.fuel, 0) as cost_vehicle, coalesce(ac.equipment, 0) as cost_equipment,
  coalesce(ac.subcontract, 0) as cost_subcontract, coalesce(ac.other, 0) + coalesce(x.expenses, 0) + coalesce(b.bills, 0) as cost_other,
  coalesce(ac.total, 0) + coalesce(f.fuel, 0) + coalesce(x.expenses, 0) + coalesce(b.bills, 0) as total_cost,
  coalesce(i.total - i.tax_total - (i.amount_credited - coalesce(cn.tax, 0)), j.agreed_amount - j.tax_total)
    - (coalesce(ac.total, 0) + coalesce(f.fuel, 0) + coalesce(x.expenses, 0) + coalesce(b.bills, 0)) as profit
from public.job_orders j
left join public.invoices i on i.id = j.invoice_id
left join lateral (select sum(tax_amount) as tax from public.credit_notes where invoice_id = i.id) cn on true
left join lateral (select sum(amount) as total,
    sum(amount) filter (where category = 'consumable') as consumable, sum(amount) filter (where category = 'labour') as labour,
    sum(amount) filter (where category in ('vehicle','fuel')) as vehicle, sum(amount) filter (where category = 'equipment') as equipment,
    sum(amount) filter (where category = 'subcontract') as subcontract, sum(amount) filter (where category in ('other','overhead')) as other
  from public.job_order_actual_costs where job_order_id = j.id) ac on true
left join lateral (select sum(cost) as fuel from public.fuel_logs where job_order_id = j.id) f on true
left join lateral (select sum(amount) as expenses from public.expenses where job_order_id = j.id and status in ('approved','paid')) x on true
left join lateral (select sum(bl.amount) as bills from public.bill_lines bl join public.bills bb on bb.id = bl.bill_id
                   where bb.job_order_id = j.id and bb.status in ('approved','partially_paid','paid')) b on true;

create or replace view public.v_contract_monthly_profitability with (security_invoker = true) as
select k.id as contract_id, k.contract_no, k.customer_id, k.title, k.budgeted_monthly_cost, m::date as month, f.*,
  f.gross_profit - f.overhead as net_profit,
  f.direct_cost - k.budgeted_monthly_cost as budget_variance,
  f.gross_profit < 0 as is_loss,
  f.margin_pct < (select contract_margin_threshold from public.company_settings where id = 1) as below_threshold
from public.contracts k
cross join lateral generate_series(date_trunc('month', k.start_date), date_trunc('month', least(k.end_date, current_date)), interval '1 month') m
cross join lateral public.contract_month_figures(k.id, m::date) f
where k.status <> 'draft';

create or replace view public.v_contract_profitability with (security_invoker = true) as
select k.id as contract_id, k.contract_no, k.customer_id, k.title, k.contract_type, k.status, k.start_date, k.end_date,
  coalesce(sum(p.revenue), 0) as revenue_to_date, coalesce(sum(p.collected), 0) as collected_to_date,
  coalesce(sum(p.direct_cost), 0) as cost_to_date, coalesce(sum(p.gross_profit), 0) as gross_profit_to_date,
  case when sum(p.revenue) > 0 then round(sum(p.gross_profit) / sum(p.revenue) * 100, 2) else 0 end as margin_pct_to_date,
  count(p.month) as months_elapsed,
  greatest((extract(year from age(date_trunc('month', k.end_date), date_trunc('month', least(k.end_date, current_date)))) * 12
          + extract(month from age(date_trunc('month', k.end_date), date_trunc('month', least(k.end_date, current_date)))))::int, 0) as months_remaining,
  coalesce(sum(p.gross_profit), 0) + coalesce(avg(p.gross_profit), 0) *
    greatest((extract(year from age(date_trunc('month', k.end_date), date_trunc('month', least(k.end_date, current_date)))) * 12
            + extract(month from age(date_trunc('month', k.end_date), date_trunc('month', least(k.end_date, current_date)))))::int, 0) as projected_gross_profit,
  count(*) filter (where p.is_loss) as loss_months,
  case when k.contract_type = 'one_off' then k.total_agreed end as total_agreed,
  case when k.contract_type = 'one_off' then coalesce((select sum(i.total - i.amount_credited) from public.invoices i
       where (i.contract_id = k.id or i.job_order_id in (select id from public.job_orders where contract_id = k.id)) and i.status <> 'draft'), 0) end as billed_to_date
from public.contracts k left join public.v_contract_monthly_profitability p on p.contract_id = k.id
where k.status <> 'draft'
group by k.id;

-- Estimate vs actual by category
create or replace view public.v_estimate_vs_actual with (security_invoker = true) as
with est as (
  select e.id as estimate_id, e.estimate_no, e.version, e.converted_job_id, e.converted_contract_id, e.contract_months, e.is_recurring,
    unnest(array['consumable','equipment','labour','vehicle','subcontract','overhead']) as category,
    unnest(array[e.cost_consumable, e.cost_equipment, e.cost_labour, e.cost_vehicle, e.cost_subcontract, e.cost_overhead_items]) as estimated_total
  from public.estimates e where e.converted_job_id is not null or e.converted_contract_id is not null
), months as (
  select k.id, greatest(count(*), 1) as elapsed
  from public.contracts k cross join lateral generate_series(date_trunc('month', k.start_date), date_trunc('month', least(k.end_date, current_date)), interval '1 month') g
  group by k.id
)
select est.estimate_id, est.estimate_no, est.version, est.category,
  case when est.converted_job_id is not null then 'job' else 'contract' end as target_type,
  coalesce(est.converted_job_id, est.converted_contract_id) as target_id,
  case when est.converted_contract_id is not null and est.is_recurring then round(est.estimated_total / est.contract_months * coalesce(m.elapsed, 1), 2)
       else est.estimated_total end as estimated,
  coalesce(case when est.converted_job_id is not null then
      (select sum(ac.amount) from public.job_order_actual_costs ac where ac.job_order_id = est.converted_job_id
         and (ac.category = est.category or (est.category = 'vehicle' and ac.category = 'fuel') or (est.category = 'overhead' and ac.category = 'other')))
      + case when est.category = 'vehicle' then coalesce((select sum(cost) from public.fuel_logs where job_order_id = est.converted_job_id), 0) else 0 end
    else
      (select sum(cs.amount) from public.contract_supplies cs join public.cost_items ci on ci.id = cs.cost_item_id
         where cs.contract_id = est.converted_contract_id and ci.category = est.category)
      + case when est.category = 'labour' then coalesce((select sum(amount) from public.contract_labour where contract_id = est.converted_contract_id and kind = 'labour'), 0)
             when est.category = 'vehicle' then coalesce((select sum(amount) from public.contract_labour where contract_id = est.converted_contract_id and kind = 'vehicle'), 0)
             when est.category = 'overhead' then coalesce((select sum(amount) from public.contract_labour where contract_id = est.converted_contract_id and kind = 'other'), 0)
             else 0 end
    end, 0) as actual
from est left join months m on m.id = est.converted_contract_id;

-- Estimate vs actual by line (matched on catalogue item)
create or replace view public.v_estimate_vs_actual_lines with (security_invoker = true) as
select e.id as estimate_id, l.id as line_id, l.cost_item_id, l.category, l.description, l.line_cost as estimated,
  coalesce(case when e.converted_job_id is not null
    then (select sum(ac.amount) from public.job_order_actual_costs ac where ac.job_order_id = e.converted_job_id and ac.cost_item_id = l.cost_item_id)
    else (select sum(cs.amount) from public.contract_supplies cs where cs.contract_id = e.converted_contract_id and cs.cost_item_id = l.cost_item_id) end, 0) as actual
from public.estimates e join public.estimate_lines l on l.estimate_id = e.id
where e.converted_job_id is not null or e.converted_contract_id is not null;

-- =====================================================================================
-- Accounting reports
-- =====================================================================================
create or replace view public.v_trial_balance with (security_invoker = true) as
select a.id as account_id, a.code, a.name, a.account_type,
  coalesce(sum(l.debit), 0) as total_debit, coalesce(sum(l.credit), 0) as total_credit,
  greatest(coalesce(sum(l.debit - l.credit), 0), 0) as debit_balance, greatest(coalesce(sum(l.credit - l.debit), 0), 0) as credit_balance
from public.accounts a
left join public.journal_lines l on l.account_id = a.id and exists (select 1 from public.journal_entries e where e.id = l.entry_id and e.status = 'posted')
group by a.id;

create or replace function public._require_finance_view() returns void language plpgsql stable security definer set search_path = public as $$
begin perform public.require_role(array['accountant','manager','executive']); end $$;

create or replace function public.rpt_trial_balance(p_as_of date default current_date)
returns table (account_id uuid, code text, name text, account_type text, debit numeric, credit numeric)
language plpgsql stable security definer set search_path = public as $$
begin
  perform public._require_finance_view();
  return query
  select a.id, a.code, a.name, a.account_type,
    greatest(coalesce(sum(l.debit - l.credit), 0), 0), greatest(coalesce(sum(l.credit - l.debit), 0), 0)
  from public.accounts a
  left join (public.journal_lines l join public.journal_entries e on e.id = l.entry_id and e.status = 'posted' and e.entry_date <= p_as_of) on l.account_id = a.id
  group by a.id having coalesce(sum(l.debit), 0) <> 0 or coalesce(sum(l.credit), 0) <> 0
  order by a.code;
end $$;

create or replace view public.v_profit_and_loss with (security_invoker = true) as
select date_trunc('month', e.entry_date)::date as month, a.id as account_id, a.code, a.name, a.account_type, a.subtype,
  l.service_id, l.contract_id,
  sum(case when a.account_type = 'income' then l.credit - l.debit else l.debit - l.credit end) as amount
from public.journal_lines l join public.journal_entries e on e.id = l.entry_id and e.status = 'posted'
join public.accounts a on a.id = l.account_id
where a.account_type in ('income','expense')
group by 1, a.id, l.service_id, l.contract_id;

-- p_group: account | month | service | contract
create or replace function public.rpt_profit_and_loss(p_from date, p_to date, p_group text default 'account')
returns table (group_key text, group_label text, account_type text, subtype text, code text, name text, amount numeric)
language plpgsql stable security definer set search_path = public as $$
begin
  perform public._require_finance_view();
  return query
  select case p_group when 'month' then to_char(date_trunc('month', e.entry_date), 'YYYY-MM')
                      when 'service' then coalesce(l.service_id::text, 'none')
                      when 'contract' then coalesce(l.contract_id::text, 'none') else 'all' end,
         case p_group when 'month' then to_char(date_trunc('month', e.entry_date), 'Mon YYYY')
                      when 'service' then coalesce((select s.name from public.services s where s.id = l.service_id), 'Not linked to a service')
                      when 'contract' then coalesce((select k.contract_no || ' – ' || k.title from public.contracts k where k.id = l.contract_id), 'Not linked to a contract')
                      else 'All' end,
         a.account_type, a.subtype, a.code, a.name,
         sum(case when a.account_type = 'income' then l.credit - l.debit else l.debit - l.credit end)
  from public.journal_lines l join public.journal_entries e on e.id = l.entry_id and e.status = 'posted' and e.entry_date between p_from and p_to
  join public.accounts a on a.id = l.account_id
  where a.account_type in ('income','expense')
  group by 1, 2, a.account_type, a.subtype, a.code, a.name
  having sum(l.debit) <> 0 or sum(l.credit) <> 0
  order by 1, a.account_type desc, a.code;
end $$;

create or replace function public.rpt_balance_sheet(p_as_of date default current_date)
returns table (section text, code text, name text, amount numeric)
language plpgsql stable security definer set search_path = public as $$
declare v_fy_start date; s public.company_settings;
begin
  perform public._require_finance_view();
  s := public.app_settings();
  v_fy_start := make_date(extract(year from p_as_of)::int - case when extract(month from p_as_of) < s.fiscal_year_start_month then 1 else 0 end, s.fiscal_year_start_month, 1);
  return query
  with bal as (
    select a.account_type, a.code, a.name, sum(l.debit - l.credit) as dr
    from public.journal_lines l join public.journal_entries e on e.id = l.entry_id and e.status = 'posted' and e.entry_date <= p_as_of
    join public.accounts a on a.id = l.account_id group by a.account_type, a.code, a.name
  )
  select 'asset', b.code, b.name, b.dr from bal b where b.account_type = 'asset' and b.dr <> 0
  union all select 'liability', b.code, b.name, -b.dr from bal b where b.account_type = 'liability' and b.dr <> 0
  union all select 'equity', b.code, b.name, -b.dr from bal b where b.account_type = 'equity' and b.dr <> 0
  union all
  select 'equity', 'RE-PRIOR', 'Retained earnings (prior years)', coalesce(-sum(l.debit - l.credit), 0)
    from public.journal_lines l join public.journal_entries e on e.id = l.entry_id and e.status = 'posted' and e.entry_date < v_fy_start
    join public.accounts a on a.id = l.account_id where a.account_type in ('income','expense')
  union all
  select 'equity', 'RE-CURRENT', 'Current year profit', coalesce(-sum(l.debit - l.credit), 0)
    from public.journal_lines l join public.journal_entries e on e.id = l.entry_id and e.status = 'posted' and e.entry_date between v_fy_start and p_as_of
    join public.accounts a on a.id = l.account_id where a.account_type in ('income','expense');
end $$;

create or replace view public.v_balance_sheet with (security_invoker = true) as
select a.account_type as section, a.code, a.name,
  case when a.account_type = 'asset' then sum(l.debit - l.credit) else sum(l.credit - l.debit) end as amount
from public.journal_lines l join public.journal_entries e on e.id = l.entry_id and e.status = 'posted'
join public.accounts a on a.id = l.account_id
where a.account_type in ('asset','liability','equity')
group by a.account_type, a.code, a.name;

create or replace function public.rpt_cash_flow(p_from date, p_to date)
returns table (category text, amount numeric, sort int)
language plpgsql stable security definer set search_path = public as $$
begin
  perform public._require_finance_view();
  return query
  with cash_accts as (select account_id from public.bank_accounts),
  opening as (select coalesce(sum(l.debit - l.credit), 0) as v from public.journal_lines l join public.journal_entries e on e.id = l.entry_id
              where e.status = 'posted' and e.entry_date < p_from and l.account_id in (select account_id from cash_accts)),
  moves as (
    select case e.event_code when 'payment_received' then 'Receipts from customers'
                             when 'refund' then 'Refunds to customers'
                             when 'bill_paid' then 'Payments to suppliers'
                             when 'expense_paid' then 'Expenses paid'
                             when 'fuel_purchase' then 'Fuel'
                             when 'maintenance' then 'Vehicle maintenance'
                             when 'bank_transfer' then 'Transfers and bank charges'
                             else 'Other movements' end as cat,
           sum(l.debit - l.credit) as v
    from public.journal_lines l join public.journal_entries e on e.id = l.entry_id
    where e.status = 'posted' and e.entry_date between p_from and p_to and l.account_id in (select account_id from cash_accts)
    group by 1)
  select 'Opening cash, bank and MoMo', (select v from opening), 0
  union all select m.cat, m.v, 1 from moves m
  union all select 'Net change', coalesce((select sum(v) from moves), 0), 2
  union all select 'Closing cash, bank and MoMo', (select v from opening) + coalesce((select sum(v) from moves), 0), 3;
end $$;

create or replace function public.rpt_general_ledger(p_account_id uuid, p_from date, p_to date)
returns table (entry_id uuid, line_id uuid, entry_no text, entry_date date, description text, debit numeric, credit numeric, balance numeric, cleared boolean)
language plpgsql stable security definer set search_path = public as $$
declare v_open numeric; v_type text;
begin
  perform public._require_finance_view();
  select account_type into v_type from public.accounts where id = p_account_id;
  select coalesce(sum(case when v_type in ('asset','expense') then l.debit - l.credit else l.credit - l.debit end), 0) into v_open
  from public.journal_lines l join public.journal_entries e on e.id = l.entry_id where e.status = 'posted' and l.account_id = p_account_id and e.entry_date < p_from;
  return query
  select null::uuid, null::uuid, null::text, p_from, 'Opening balance'::text, null::numeric, null::numeric, v_open, null::boolean
  union all
  select * from (
    select e.id, l.id, e.entry_no, e.entry_date, coalesce(l.description, e.description), l.debit, l.credit,
      v_open + sum(case when v_type in ('asset','expense') then l.debit - l.credit else l.credit - l.debit end)
        over (order by e.entry_date, e.posted_at, e.entry_no, l.line_no rows unbounded preceding), l.cleared
    from public.journal_lines l join public.journal_entries e on e.id = l.entry_id
    where e.status = 'posted' and l.account_id = p_account_id and e.entry_date between p_from and p_to
    order by e.entry_date, e.posted_at, e.entry_no, l.line_no) x;
end $$;

create or replace function public.rpt_tax_summary(p_from date, p_to date)
returns table (tax_name text, account_code text, collected numeric, reversed numeric, net numeric)
language plpgsql stable security definer set search_path = public as $$
begin
  perform public._require_finance_view();
  return query
  select a.name, a.code, coalesce(sum(l.credit), 0), coalesce(sum(l.debit), 0), coalesce(sum(l.credit - l.debit), 0)
  from public.journal_lines l join public.journal_entries e on e.id = l.entry_id and e.status = 'posted' and e.entry_date between p_from and p_to
  join public.accounts a on a.id = l.account_id
  where a.subtype = 'tax'
  group by a.name, a.code order by a.code;
end $$;

create or replace function public.rpt_expenses_by_category(p_from date, p_to date)
returns table (code text, name text, subtype text, amount numeric)
language plpgsql stable security definer set search_path = public as $$
begin
  perform public._require_finance_view();
  return query
  select a.code, a.name, a.subtype, sum(l.debit - l.credit)
  from public.journal_lines l join public.journal_entries e on e.id = l.entry_id and e.status = 'posted' and e.entry_date between p_from and p_to
  join public.accounts a on a.id = l.account_id where a.account_type = 'expense'
  group by a.code, a.name, a.subtype having sum(l.debit - l.credit) <> 0 order by 4 desc;
end $$;

-- =====================================================================================
-- Zonal summary
-- =====================================================================================
create or replace view public.v_zonal_task_summary with (security_invoker = true) as
select t.officer_id, p.full_name as officer_name, t.zone_id, z.name as zone_name, t.planned_date,
  count(*) filter (where t.status <> 'cancelled') as planned,
  count(*) filter (where t.status = 'completed') as completed,
  count(*) filter (where t.status = 'pending') as pending,
  count(*) filter (where t.status in ('planned','in_progress','pending') and t.planned_date < current_date) as overdue,
  round(100.0 * count(*) filter (where t.status = 'completed') / nullif(count(*) filter (where t.status <> 'cancelled'), 0), 1) as completion_pct,
  coalesce(sum(t.deal_value) filter (where t.deal_closed), 0) as deals_closed_value,
  max(t.last_update_at) as last_update_at
from public.tasks t join public.profiles p on p.id = t.officer_id left join public.zones z on z.id = t.zone_id
group by t.officer_id, p.full_name, t.zone_id, z.name, t.planned_date;

create or replace view public.v_upcoming_contract_bills with (security_invoker = true) as
select k.id as contract_id, k.contract_no, k.title, k.customer_id, c.display_name as customer_name, k.next_billing_date, k.amount_per_period,
  k.billing_frequency, k.auto_send
from public.contracts k join public.customers c on c.id = k.customer_id
where k.status = 'active' and k.contract_type = 'recurring' and k.next_billing_date is not null and k.next_billing_date <= current_date + 30;

-- =====================================================================================
-- Search and activity timeline (run as the caller so RLS applies)
-- =====================================================================================
create or replace function public.global_search(p_q text, p_limit int default 8)
returns table (kind text, id uuid, title text, subtitle text, link text)
language plpgsql stable security invoker set search_path = public as $$
declare v_q text := btrim(coalesce(p_q, '')); v_phone text; v_like text;
begin
  if length(v_q) < 2 then return; end if;
  v_like := '%' || v_q || '%';
  begin v_phone := public.normalize_phone(v_q); exception when others then v_phone := null; end;
  return query
  (select 'customer'::text, c.id, c.display_name, c.customer_code || coalesce(' · ' || c.phone, ''), '/customers/' || c.id
   from public.customers c where c.archived_at is null and (c.display_name ilike v_like or c.customer_code ilike v_like
     or c.phone = v_phone or c.company_phone = v_phone or c.alt_phone = v_phone or c.phone like '%' || regexp_replace(v_q, '\D', '', 'g') || '%' and length(regexp_replace(v_q, '\D', '', 'g')) >= 6)
   order by c.display_name limit p_limit)
  union all
  (select 'job_order', j.id, j.job_no, coalesce(j.customer_name, '') || ' · ' || public.date_text(j.execution_date), '/jobs/' || j.id
   from public.job_orders j where j.job_no ilike v_like or j.customer_name ilike v_like order by j.execution_date desc limit p_limit)
  union all
  (select 'invoice', i.id, i.invoice_no, coalesce(i.customer_name, '') || ' · GH₵ ' || public.money_text(i.total), '/finance/invoices/' || i.id
   from public.invoices i where i.invoice_no ilike v_like order by i.issue_date desc limit p_limit)
  union all
  (select 'receipt', r.id, r.receipt_no, 'GH₵ ' || public.money_text(r.amount), '/finance/payments?receipt=' || r.receipt_no
   from public.receipts r where r.receipt_no ilike v_like limit p_limit)
  union all
  (select 'truck', t.id, t.registration_no, coalesce(t.fleet_code, '') || ' · ' || replace(t.truck_type, '_', ' '), '/fleet/trucks/' || t.id
   from public.trucks t where t.registration_no ilike v_like or t.fleet_code ilike v_like limit p_limit)
  union all
  (select 'contract', k.id, k.contract_no, k.title, '/contracts/' || k.id from public.contracts k where k.contract_no ilike v_like or k.title ilike v_like limit p_limit);
end $$;

create or replace function public.get_activity_timeline(p_entity_type text, p_entity_id uuid, p_limit int default 100)
returns table (at timestamptz, kind text, title text, detail text, actor text)
language plpgsql stable security invoker set search_path = public as $$
begin
  return query
  select * from (
    select c.created_at, 'comment'::text, 'Comment'::text, c.body, p.full_name from public.comments c left join public.profiles p on p.id = c.author_id
     where c.entity_type = p_entity_type and c.entity_id = p_entity_id
    union all
    select h.changed_at, 'status', 'Status: ' || coalesce(h.from_status, '—') || ' → ' || h.to_status, h.note, p.full_name
     from public.job_order_status_history h left join public.profiles p on p.id = h.changed_by where p_entity_type = 'job_order' and h.job_order_id = p_entity_id
    union all
    select j.created_at, 'job', 'Job order ' || j.job_no, j.status, null from public.job_orders j where p_entity_type = 'customer' and j.customer_id = p_entity_id
    union all
    select i.issued_at, 'invoice', 'Invoice ' || i.invoice_no, 'GH₵ ' || public.money_text(i.total), null from public.invoices i where p_entity_type = 'customer' and i.customer_id = p_entity_id and i.issued_at is not null
    union all
    select r.issued_at, 'payment', 'Receipt ' || r.receipt_no, 'GH₵ ' || public.money_text(r.amount), null from public.receipts r where p_entity_type = 'customer' and r.customer_id = p_entity_id
    union all
    select n.created_at, 'message', upper(n.channel) || ' ' || replace(n.event_code, '_', ' '), left(n.body, 120), n.status from public.notifications n where p_entity_type = 'customer' and n.customer_id = p_entity_id
    union all
    select a.changed_at, 'audit', initcap(lower(a.action)) || ' ' || replace(a.table_name, '_', ' '), null, p.full_name
     from public.audit_log a left join public.profiles p on p.id = a.changed_by where a.record_id = p_entity_id::text and a.table_name in ('customers','contracts','job_orders')
  ) x order by 1 desc nulls last limit p_limit;
end $$;

-- =====================================================================================
-- Executive dashboard (one round trip)
-- =====================================================================================
create or replace function public.get_dashboard(p_from date, p_to date, p_service uuid default null, p_zone uuid default null, p_customer_type text default null)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare v_len int := p_to - p_from + 1; v_pfrom date := p_from - (p_to - p_from + 1); v_pto date := p_from - 1; v_res jsonb; v_cash_ids uuid[];
begin
  perform public.require_role(array['manager','executive','accountant']);
  select array_agg(account_id) into v_cash_ids from public.bank_accounts;

  create temporary table if not exists _dash_cust (id uuid primary key) on commit drop;
  truncate _dash_cust;
  insert into _dash_cust select id from public.customers where (p_zone is null or zone_id = p_zone) and (p_customer_type is null or customer_type = p_customer_type);

  with
  rev as (
    select e.entry_date, sum(l.credit - l.debit) as amt, l.service_id
    from public.journal_lines l join public.journal_entries e on e.id = l.entry_id and e.status = 'posted'
    join public.accounts a on a.id = l.account_id and a.account_type = 'income'
    where e.entry_date between v_pfrom and p_to and (p_service is null or l.service_id = p_service)
      and (l.customer_id is null and p_zone is null and p_customer_type is null or l.customer_id in (select id from _dash_cust))
    group by e.entry_date, l.service_id),
  exp as (
    select e.entry_date, sum(l.debit - l.credit) as amt, bool_or(a.subtype = 'direct') as direct, a.subtype
    from public.journal_lines l join public.journal_entries e on e.id = l.entry_id and e.status = 'posted'
    join public.accounts a on a.id = l.account_id and a.account_type = 'expense'
    where e.entry_date between v_pfrom and p_to group by e.entry_date, a.subtype),
  pay as (
    select p.payment_date, p.amount from public.payments p where p.payment_date between v_pfrom and p_to and p.customer_id in (select id from _dash_cust)
      and (p_service is null or exists (select 1 from public.payment_allocations pa join public.invoice_lines il on il.invoice_id = pa.invoice_id where pa.payment_id = p.id and il.service_id = p_service)))
  select jsonb_build_object(
    'revenue', jsonb_build_object('value', coalesce((select sum(amt) from rev where entry_date between p_from and p_to), 0), 'prev', coalesce((select sum(amt) from rev where entry_date between v_pfrom and v_pto), 0)),
    'cash_collected', jsonb_build_object('value', coalesce((select sum(amount) from pay where payment_date between p_from and p_to), 0), 'prev', coalesce((select sum(amount) from pay where payment_date between v_pfrom and v_pto), 0)),
    'expenses', jsonb_build_object('value', coalesce((select sum(amt) from exp where entry_date between p_from and p_to), 0), 'prev', coalesce((select sum(amt) from exp where entry_date between v_pfrom and v_pto), 0)),
    'direct_costs', jsonb_build_object('value', coalesce((select sum(amt) from exp where direct and entry_date between p_from and p_to), 0), 'prev', coalesce((select sum(amt) from exp where direct and entry_date between v_pfrom and v_pto), 0))
  ) into v_res;

  v_res := v_res || jsonb_build_object(
    'gross_profit', jsonb_build_object('value', (v_res->'revenue'->>'value')::numeric - (v_res->'direct_costs'->>'value')::numeric,
                                       'prev', (v_res->'revenue'->>'prev')::numeric - (v_res->'direct_costs'->>'prev')::numeric),
    'gross_margin', jsonb_build_object('value', case when (v_res->'revenue'->>'value')::numeric > 0 then round(((v_res->'revenue'->>'value')::numeric - (v_res->'direct_costs'->>'value')::numeric) / (v_res->'revenue'->>'value')::numeric * 100, 1) else 0 end,
                                       'prev', case when (v_res->'revenue'->>'prev')::numeric > 0 then round(((v_res->'revenue'->>'prev')::numeric - (v_res->'direct_costs'->>'prev')::numeric) / (v_res->'revenue'->>'prev')::numeric * 100, 1) else 0 end),
    'receivables', jsonb_build_object(
       'outstanding', coalesce((select sum(balance) from public.invoices where status in ('issued','due','partially_paid','overdue') and customer_id in (select id from _dash_cust)), 0),
       'overdue', coalesce((select sum(balance) from public.invoices where status = 'overdue' and customer_id in (select id from _dash_cust)), 0),
       'overdue_count', (select count(*) from public.invoices where status = 'overdue' and customer_id in (select id from _dash_cust))),
    'balances', (select jsonb_object_agg(kind, bal) from (
       select b.kind, coalesce(sum(l.debit - l.credit), 0) as bal from public.bank_accounts b
       left join (public.journal_lines l join public.journal_entries e on e.id = l.entry_id and e.status = 'posted' and e.entry_date <= p_to) on l.account_id = b.account_id
       group by b.kind) x),
    'jobs', jsonb_build_object(
       'pending_approval', (select count(*) from public.job_orders where status = 'pending_approval'),
       'scheduled_today', (select count(*) from public.job_orders where status = 'approved' and current_date between execution_date and coalesce(end_date, execution_date)),
       'in_progress', (select count(*) from public.job_orders where status = 'in_progress'),
       'completed_this_month', (select count(*) from public.job_orders where status in ('completed','closed') and completed_at >= date_trunc('month', now())),
       'completed_period', (select count(*) from public.job_orders where status in ('completed','closed') and completed_at::date between p_from and p_to)),
    'fleet', jsonb_build_object(
       'total', (select count(*) from public.trucks where archived_at is null),
       'on_road', (select count(*) from public.trucks where archived_at is null and status = 'on_road'),
       'on_job', (select count(*) from public.trucks where archived_at is null and status = 'on_job'),
       'off_road', (select count(*) from public.trucks where archived_at is null and status = 'off_road'),
       'availability_pct', (select round(100.0 * sum(v_len - public.truck_off_road_days(id, p_from, p_to)) / nullif(count(*) * v_len, 0), 1) from public.trucks where archived_at is null),
       'availability_prev', (select round(100.0 * sum(v_len - public.truck_off_road_days(id, v_pfrom, v_pto)) / nullif(count(*) * v_len, 0), 1) from public.trucks where archived_at is null)),
    'contracts', jsonb_build_object(
       'active', (select count(*) from public.contracts where status = 'active' and customer_id in (select id from _dash_cust)),
       'mrr', coalesce((select sum(case billing_frequency when 'weekly' then amount_per_period * 52 / 12 when 'quarterly' then amount_per_period / 3 else amount_per_period end)
                        from public.contracts where status = 'active' and contract_type = 'recurring' and customer_id in (select id from _dash_cust) and (p_service is null or service_id = p_service)), 0)),
    'surveys', (select jsonb_build_object('csat', round(avg(csat), 2), 'responses', count(*),
        'nps', round(100.0 * (count(*) filter (where nps_score >= 9) - count(*) filter (where nps_score <= 6)) / nullif(count(nps_score), 0), 1),
        'csat_prev', (select round(avg(csat), 2) from public.survey_responses where submitted_at::date between v_pfrom and v_pto))
       from public.survey_responses where submitted_at::date between p_from and p_to and customer_id in (select id from _dash_cust) and (p_service is null or service_id = p_service)),
    'zonal', (select jsonb_build_object('planned', count(*) filter (where status <> 'cancelled'), 'completed', count(*) filter (where status = 'completed'),
        'completion_pct', round(100.0 * count(*) filter (where status = 'completed') / nullif(count(*) filter (where status <> 'cancelled'), 0), 1))
       from public.tasks where planned_date between p_from and p_to and (p_zone is null or zone_id = p_zone)),
    'charts', jsonb_build_object(
       'revenue_vs_expenses', (select jsonb_agg(jsonb_build_object('month', to_char(m, 'Mon YY'), 'month_start', m::date,
           'revenue', coalesce((select sum(l.credit - l.debit) from public.journal_lines l join public.journal_entries e on e.id = l.entry_id and e.status = 'posted'
                     join public.accounts a on a.id = l.account_id and a.account_type = 'income' where date_trunc('month', e.entry_date) = m
                     and (p_service is null or l.service_id = p_service)), 0),
           'expenses', coalesce((select sum(l.debit - l.credit) from public.journal_lines l join public.journal_entries e on e.id = l.entry_id and e.status = 'posted'
                     join public.accounts a on a.id = l.account_id and a.account_type = 'expense' where date_trunc('month', e.entry_date) = m), 0)) order by m)
         from generate_series(date_trunc('month', p_to) - interval '11 months', date_trunc('month', p_to), interval '1 month') m),
       'revenue_by_service', (select coalesce(jsonb_agg(jsonb_build_object('service_id', x.service_id, 'name', coalesce(s.name, 'Contracts / other'), 'value', x.amt) order by x.amt desc), '[]'::jsonb)
         from (select service_id, sum(amt) amt from (
                 select l.service_id, l.credit - l.debit as amt from public.journal_lines l join public.journal_entries e on e.id = l.entry_id and e.status = 'posted'
                 join public.accounts a on a.id = l.account_id and a.account_type = 'income'
                 where e.entry_date between p_from and p_to and (l.customer_id is null and p_zone is null and p_customer_type is null or l.customer_id in (select id from _dash_cust))) q
               group by service_id) x left join public.services s on s.id = x.service_id),
       'aging', (select jsonb_build_object('current', coalesce(sum(balance) filter (where bucket = 'current'), 0), '1_30', coalesce(sum(balance) filter (where bucket = '1_30'), 0),
           '31_60', coalesce(sum(balance) filter (where bucket = '31_60'), 0), '61_90', coalesce(sum(balance) filter (where bucket = '61_90'), 0),
           '90_plus', coalesce(sum(balance) filter (where bucket = '90_plus'), 0)) from public.v_ar_aging where customer_id in (select id from _dash_cust)),
       'funnel', jsonb_build_object(
           'leads', (select count(*) from public.leads where created_at::date between p_from and p_to and (p_zone is null or zone_id = p_zone) and (p_service is null or service_id = p_service)),
           'estimates', (select count(*) from public.estimates where version = 1 and created_at::date between p_from and p_to and (p_service is null or service_id = p_service)),
           'jobs', (select count(*) from public.job_orders where created_at::date between p_from and p_to and customer_id in (select id from _dash_cust)),
           'paid', (select count(*) from public.invoices where status = 'paid' and updated_at::date between p_from and p_to and customer_id in (select id from _dash_cust))),
       'contract_profitability', (select coalesce(jsonb_agg(x order by x.gp desc), '[]'::jsonb) from (
           (select contract_id, contract_no, title, gross_profit_to_date as gp, margin_pct_to_date as margin, loss_months > 0 or gross_profit_to_date < 0 as loss
            from public.v_contract_profitability where customer_id in (select id from _dash_cust) order by gross_profit_to_date desc limit 5)
           union
           (select contract_id, contract_no, title, gross_profit_to_date, margin_pct_to_date, loss_months > 0 or gross_profit_to_date < 0
            from public.v_contract_profitability where customer_id in (select id from _dash_cust) order by gross_profit_to_date asc limit 5)) x),
       'top_customers', (select coalesce(jsonb_agg(x order by x.revenue desc), '[]'::jsonb) from (
           select i.customer_id, max(i.customer_name) as name, sum(i.total - i.tax_total - i.amount_credited) as revenue
           from public.invoices i where i.status <> 'draft' and i.issue_date between p_from and p_to and i.customer_id in (select id from _dash_cust)
           group by i.customer_id order by 3 desc limit 10) x),
       'collections', (select jsonb_agg(jsonb_build_object('month', to_char(m, 'Mon YY'), 'month_start', m::date,
           'collected', coalesce((select sum(amount) from public.payments p where date_trunc('month', p.payment_date) = m and p.customer_id in (select id from _dash_cust)), 0),
           'invoiced', coalesce((select sum(total) from public.invoices i where i.status <> 'draft' and date_trunc('month', i.issue_date) = m and i.customer_id in (select id from _dash_cust)), 0)) order by m)
         from generate_series(date_trunc('month', p_to) - interval '11 months', date_trunc('month', p_to), interval '1 month') m),
       'estimate_variance', (select coalesce(jsonb_agg(x order by abs(x.variance) desc), '[]'::jsonb) from (
           select v.estimate_id, v.estimate_no, v.target_type, v.target_id, sum(v.estimated) as estimated, sum(v.actual) as actual, sum(v.actual - v.estimated) as variance
           from public.v_estimate_vs_actual v group by v.estimate_id, v.estimate_no, v.target_type, v.target_id having sum(v.actual) > 0 limit 10) x)),
    'alerts', jsonb_build_object(
       'jobs_waiting_24h', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'job_no', job_no, 'customer', customer_name, 'since', submitted_at)), '[]'::jsonb)
           from public.job_orders where status = 'pending_approval' and submitted_at < now() - interval '24 hours'),
       'overdue_invoices', (select jsonb_build_object('count', count(*), 'amount', coalesce(sum(balance), 0)) from public.invoices where status = 'overdue'),
       'loss_contracts', (select coalesce(jsonb_agg(jsonb_build_object('id', contract_id, 'contract_no', contract_no, 'month', month, 'gross_profit', gross_profit)), '[]'::jsonb)
           from public.v_contract_monthly_profitability where is_loss and month >= date_trunc('month', current_date) - interval '1 month'),
       'off_road_trucks', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'registration_no', registration_no, 'reason', off_road_reason, 'return', expected_return_date)), '[]'::jsonb)
           from public.trucks where status = 'off_road' and archived_at is null),
       'expiring_documents', (select coalesce(jsonb_agg(jsonb_build_object('truck_id', t.id, 'registration_no', t.registration_no, 'doc_type', d.doc_type, 'expiry', d.expiry_date) order by d.expiry_date), '[]'::jsonb)
           from public.truck_documents d join public.trucks t on t.id = d.truck_id where d.expiry_date <= current_date + 30 and t.archived_at is null),
       'low_stock', (select coalesce(jsonb_agg(jsonb_build_object('item', ci.name, 'quantity', sl.quantity, 'reorder', ci.reorder_level)), '[]'::jsonb)
           from public.stock_levels sl join public.cost_items ci on ci.id = sl.cost_item_id where ci.reorder_level > 0 and sl.quantity <= ci.reorder_level),
       'low_surveys', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'title', title, 'created_at', created_at)), '[]'::jsonb)
           from public.followup_tasks where status <> 'done' and source_type = 'survey_response'))
  );
  return v_res;
end $$;
