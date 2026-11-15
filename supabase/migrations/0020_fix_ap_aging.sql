-- 0020: payables ageing failed with: column reference "supplier_id" is ambiguous.
--
-- rpt_ap_aging declares supplier_id as an OUT column, which PL/pgSQL also puts in scope as a
-- variable. The unqualified supplier_id inside the union subquery therefore matched both that
-- variable and the column on bills/expenses, and Postgres refused to guess. Every column in the
-- subquery is now qualified with its table alias, so only the columns can match.
--
-- Re-runnable: create or replace, same signature and same result columns as 0015.

create or replace function public.rpt_ap_aging(p_as_of date default current_date)
returns table (supplier_id uuid, supplier_name text, current_amt numeric, d1_30 numeric, d31_60 numeric, d61_90 numeric, d90_plus numeric, total numeric)
language plpgsql stable security definer set search_path = public as $$
begin
  perform public.require_role(array['accountant','manager','executive']);
  return query
  select x.supplier_id, s.name,
    sum(x.bal) filter (where x.due is null or x.due >= p_as_of),
    sum(x.bal) filter (where p_as_of - x.due between 1 and 30),
    sum(x.bal) filter (where p_as_of - x.due between 31 and 60),
    sum(x.bal) filter (where p_as_of - x.due between 61 and 90),
    sum(x.bal) filter (where p_as_of - x.due > 90),
    sum(x.bal)
  from (
    select b.supplier_id, b.balance as bal, coalesce(b.due_date, b.bill_date) as due
    from public.bills b
    where b.status in ('approved', 'partially_paid') and b.balance > 0
    union all
    select e.supplier_id, e.amount, e.expense_date
    from public.expenses e
    where e.status = 'approved'
  ) x
  left join public.suppliers s on s.id = x.supplier_id
  group by x.supplier_id, s.name
  order by sum(x.bal) desc;
end $$;

grant execute on function public.rpt_ap_aging(date) to authenticated;
