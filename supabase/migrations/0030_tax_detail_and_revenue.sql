-- 0030: tax detail behind the tax summary, and a revenue report of its own.
--
-- Review items 10 and 11.
--
-- The tax summary rolls the ledger up by tax account, which is the figure that gets filed but
-- cannot be checked against anything: it names no customer and no invoice. The roll-up stays,
-- because it is what reconciles to the books, and this adds the line-by-line working behind it.
--
-- Revenue was only ever visible inside the profit and loss, mixed in with costs. A report of its
-- own answers "what did we earn, and on what" without reading past the expenses.

-- ------------------------------------------------------------------------- tax, line by line
create or replace function public.rpt_tax_detail(p_from date, p_to date)
returns table (
  doc_type text, doc_no text, doc_date date,
  customer_name text, customer_code text, customer_tin text,
  tax_name text, rate numeric, taxable_amount numeric, tax_amount numeric, doc_total numeric
)
language plpgsql stable security definer set search_path = public as $$
begin
  perform public._require_finance_view();
  return query
  -- tax charged on invoices issued in the period
  select
    'Invoice'::text, i.invoice_no, i.issue_date,
    coalesce(c.display_name, i.customer_name), c.customer_code, c.tin,
    t.name, t.rate, t.base_amount, t.amount, i.total
  from public.invoices i
  join public.invoice_taxes t on t.invoice_id = i.id
  left join public.customers c on c.id = i.customer_id
  where i.issue_date between p_from and p_to and i.status <> 'draft'

  union all

  /* Credit notes give tax back, so they belong in the same report as negatives. Without them the
     detail would total more than the summary it is meant to prove. A credit note carries one tax
     figure rather than a breakdown, so it shows as one line. */
  select
    'Credit note'::text, n.credit_note_no, n.issue_date,
    coalesce(c.display_name, i.customer_name), c.customer_code, c.tin,
    'Tax credited'::text, null::numeric, -(n.amount - n.tax_amount), -n.tax_amount, -(n.amount)
  from public.credit_notes n
  left join public.invoices i on i.id = n.invoice_id
  left join public.customers c on c.id = n.customer_id
  where n.issue_date between p_from and p_to

  order by 3, 2, 7;
end $$;

revoke all on function public.rpt_tax_detail(date, date) from public;
grant execute on function public.rpt_tax_detail(date, date) to authenticated;

-- ------------------------------------------------------------------------------- revenue only
/* Taken from posted journal entries on income accounts, not from invoice totals, so the report
   agrees with the books: deferred revenue that has not been recognised is not counted as earned,
   and a reversal reduces the figure. */
create or replace function public.rpt_revenue(p_from date, p_to date, p_group text default 'month')
returns table (bucket text, account_code text, account_name text, subtype text, earned numeric)
language plpgsql stable security definer set search_path = public as $$
declare v_fmt text;
begin
  perform public._require_finance_view();

  v_fmt := case lower(coalesce(p_group, 'month'))
             when 'day'     then 'YYYY-MM-DD'
             when 'week'    then 'IYYY-"W"IW'
             when 'quarter' then 'YYYY-"Q"Q'
             when 'year'    then 'YYYY'
             else 'YYYY-MM'
           end;

  return query
  select
    to_char(e.entry_date, v_fmt),
    a.code, a.name, a.subtype,
    -- income is credited, so a credit balance is what was earned
    coalesce(sum(l.credit - l.debit), 0)
  from public.journal_lines l
  join public.journal_entries e on e.id = l.entry_id and e.status = 'posted'
    and e.entry_date between p_from and p_to
  join public.accounts a on a.id = l.account_id
  where a.account_type = 'income'
  group by 1, a.code, a.name, a.subtype
  having coalesce(sum(l.credit - l.debit), 0) <> 0
  order by 1, a.code;
end $$;

revoke all on function public.rpt_revenue(date, date, text) from public;
grant execute on function public.rpt_revenue(date, date, text) to authenticated;

-- What was earned on each service, which the ledger cannot answer because accounts are not
-- per service. Invoice lines can, so the two sit side by side in the report.
create or replace function public.rpt_revenue_by_service(p_from date, p_to date)
returns table (service_name text, invoices bigint, quantity numeric, net numeric, tax numeric, gross numeric)
language plpgsql stable security definer set search_path = public as $$
begin
  perform public._require_finance_view();
  return query
  select
    coalesce(s.name, 'Unassigned'),
    count(distinct i.id),
    coalesce(sum(il.quantity), 0),
    coalesce(sum(il.line_total), 0),
    -- the invoice's tax, apportioned across its taxable lines
    coalesce(sum(case when il.taxable and nullif(i.taxable_amount, 0) is not null
                      then round(i.tax_total * il.line_total / i.taxable_amount, 2) else 0 end), 0),
    coalesce(sum(il.line_total), 0)
      + coalesce(sum(case when il.taxable and nullif(i.taxable_amount, 0) is not null
                          then round(i.tax_total * il.line_total / i.taxable_amount, 2) else 0 end), 0)
  from public.invoice_lines il
  join public.invoices i on i.id = il.invoice_id
  left join public.services s on s.id = il.service_id
  where i.issue_date between p_from and p_to and i.status not in ('draft', 'void')
  group by 1
  order by 4 desc;
end $$;

revoke all on function public.rpt_revenue_by_service(date, date) from public;
grant execute on function public.rpt_revenue_by_service(date, date) to authenticated;
