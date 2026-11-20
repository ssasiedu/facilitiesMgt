-- 0031: a second statement format, showing what each payment left owing on its invoice.
--
-- Review item 5. The existing statement is a running account balance: correct, and what an
-- accountant wants, but it cannot answer "how much is still owed on invoice 00042?" because a
-- payment line only moves the account total. This format keeps each invoice together with the
-- payments and credits applied to it, and carries that invoice's own balance down the lines.

create or replace function public.rpt_customer_statement_by_invoice(
  p_customer_id uuid, p_from date, p_to date
) returns table (
  invoice_id uuid, invoice_no text, invoice_date date, due_date date, invoice_status text,
  invoice_total numeric, invoice_balance numeric,
  line_no integer, line_type text, line_date date, line_doc_no text, line_description text,
  line_amount numeric, balance_after numeric
)
language sql stable set search_path = public as $$
  with inv as (
    select i.id, i.invoice_no, i.issue_date, i.due_date, i.status, i.total, i.balance
    from public.invoices i
    where i.customer_id = p_customer_id
      and i.status <> 'draft'
      and i.issue_date <= p_to
      -- an invoice from before the window still belongs here while anything is owed on it
      and (i.issue_date >= p_from or i.balance > 0)
  ),
  /* Everything that reduced an invoice: money applied to it and credit notes raised against it.
     Both are ordered together, because a credit note dated between two payments changes what the
     later payment left owing. */
  movements as (
    select a.invoice_id, p.payment_date as on_date, 'payment'::text as kind,
           p.payment_no as doc_no,
           coalesce(m.name, p.method_code) as description,
           a.amount, p.created_at as sort_ts
    from public.payment_allocations a
    join public.payments p on p.id = a.payment_id
    left join public.payment_methods m on m.code = p.method_code
    where a.invoice_id in (select id from inv)

    union all

    select n.invoice_id, n.issue_date, 'credit'::text,
           n.credit_note_no, coalesce(nullif(n.reason, ''), 'Credit note'),
           n.amount, n.created_at
    from public.credit_notes n
    where n.invoice_id in (select id from inv)
  ),
  numbered as (
    select m.*,
           row_number() over (partition by m.invoice_id order by m.on_date, m.sort_ts, m.doc_no) as rn,
           sum(m.amount) over (partition by m.invoice_id
                               order by m.on_date, m.sort_ts, m.doc_no
                               rows unbounded preceding) as applied_to_date
    from movements m
  )
  -- the invoice itself, then each movement against it
  select i.id, i.invoice_no, i.issue_date, i.due_date, i.status, i.total, i.balance,
         0, 'invoice', i.issue_date, i.invoice_no, 'Invoice raised', i.total, i.total
  from inv i

  union all

  select i.id, i.invoice_no, i.issue_date, i.due_date, i.status, i.total, i.balance,
         n.rn::integer, n.kind, n.on_date, n.doc_no, n.description,
         -n.amount, round(i.total - n.applied_to_date, 2)
  from numbered n
  join inv i on i.id = n.invoice_id

  order by 3, 2, 8;
$$;

revoke all on function public.rpt_customer_statement_by_invoice(uuid, date, date) from public;
grant execute on function public.rpt_customer_statement_by_invoice(uuid, date, date) to authenticated;
