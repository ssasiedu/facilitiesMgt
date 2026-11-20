-- 0028: an invoice carries the payment terms the customer agreed to.
--
-- Review item 8. The terms are agreed on the quotation, so an invoice raised from that work
-- should repeat them rather than fall back to a generic default. Contracts and job orders both
-- carry the estimate they came from, and the quotation hangs off the same estimate, so the
-- wording can be traced back without a new column anywhere.

create or replace function public.trg_invoice_payment_terms() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_terms text;
begin
  if new.payment_terms is not null and new.payment_terms <> '' then
    return new;
  end if;

  -- the terms on the quotation behind this work, if there is one
  select q.payment_terms into v_terms
  from public.quotations q
  where q.payment_terms is not null
    and q.estimate_id = coalesce(
      (select c.estimate_id from public.contracts c where c.id = new.contract_id),
      (select j.estimate_id from public.job_orders j where j.id = new.job_order_id))
  order by q.status = 'accepted' desc, q.created_at desc
  limit 1;

  if v_terms is null then
    select default_payment_terms into v_terms from public.company_settings where id = 1;
  end if;

  new.payment_terms := v_terms;
  return new;
end $$;

drop trigger if exists trg_invoice_payment_terms on public.invoices;
create trigger trg_invoice_payment_terms before insert on public.invoices
  for each row execute function public.trg_invoice_payment_terms();

-- Invoices raised before this column existed get the standing wording.
update public.invoices set payment_terms = (select default_payment_terms from public.company_settings where id = 1)
where payment_terms is null;
