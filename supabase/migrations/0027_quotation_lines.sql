-- 0027: a quotation that reads like an invoice, and payment terms on the face of both.
--
-- Review items 1 and 8.
--
-- A quotation held one price and one tax figure. The only line detail in the system sat on the
-- estimate, and those are internal cost lines (labour, materials, transport) that must never
-- reach a customer. So a quotation could not show what an invoice shows. It gets its own
-- sellable lines, mirroring invoice_lines, generated from the estimate and editable before the
-- quotation goes out. Converting one to an invoice is then line for line.
--
-- Payment terms were a day count on the customer and nothing on the documents. Both documents
-- now carry the wording the customer reads, defaulted from Configuration and editable per
-- document, because a staged job is agreed per job.

-- ---------------------------------------------------------------------------- sellable lines
create table if not exists public.quotation_lines (
  id            uuid primary key default extensions.gen_random_uuid(),
  quotation_id  uuid not null references public.quotations(id) on delete cascade,
  service_id    uuid references public.services(id),
  description   text not null,
  quantity      numeric(12,3) not null default 1 check (quantity > 0),
  unit_price    numeric(14,2) not null default 0 check (unit_price >= 0),
  discount      numeric(14,2) not null default 0 check (discount >= 0),
  taxable       boolean not null default true,
  line_total    numeric(14,2) not null default 0,
  sort_order    integer not null default 0,
  created_at    timestamptz not null default now()
);

create index if not exists quotation_lines_quotation_idx on public.quotation_lines (quotation_id, sort_order);

create table if not exists public.quotation_taxes (
  id            uuid primary key default extensions.gen_random_uuid(),
  quotation_id  uuid not null references public.quotations(id) on delete cascade,
  tax_rate_id   uuid references public.tax_rates(id),
  name          text not null,
  rate          numeric(7,4) not null,
  compound      boolean not null default false,
  base_amount   numeric(14,2) not null default 0,
  amount        numeric(14,2) not null default 0
);

create index if not exists quotation_taxes_quotation_idx on public.quotation_taxes (quotation_id);

-- Payment terms as the customer reads them, on both documents.
alter table public.quotations   add column if not exists payment_terms text;
alter table public.invoices     add column if not exists payment_terms text;

-- The default wording, editable by a Super Admin like any other setting.
alter table public.company_settings add column if not exists default_payment_terms text
  not null default '70% before work begins and 30% after completion';

-- ------------------------------------------------------------------------------ totals
/* Totals are the database's job, as they are for invoices: the same figures are reached whether
   a line was changed from the quotation screen, by an import, or by a function. */
create or replace function public.recalc_quotation(p_quotation_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_sub numeric; v_taxable numeric; v_net numeric; v_tax numeric; v_pct numeric;
begin
  update public.quotation_lines set line_total = round(quantity * unit_price, 2) - discount
  where quotation_id = p_quotation_id;

  if exists (select 1 from public.quotation_lines where quotation_id = p_quotation_id and line_total < 0) then
    raise exception 'A line discount cannot exceed the line amount';
  end if;

  select coalesce(sum(round(quantity * unit_price, 2)), 0),
         coalesce(sum(line_total) filter (where taxable), 0),
         coalesce(sum(line_total), 0)
    into v_sub, v_taxable, v_net
  from public.quotation_lines where quotation_id = p_quotation_id;

  delete from public.quotation_taxes where quotation_id = p_quotation_id;

  /* An estimate may carry a single flat rate instead of the configured taxes. It still has to
     break down on the page, so it becomes one named row rather than a bare figure. */
  select e.tax_pct into v_pct
  from public.quotations q left join public.estimates e on e.id = q.estimate_id
  where q.id = p_quotation_id;

  if coalesce(v_pct, 0) > 0 then
    insert into public.quotation_taxes (quotation_id, name, rate, base_amount, amount)
    values (p_quotation_id, 'Tax', v_pct, round(v_taxable, 2), round(v_taxable * v_pct / 100, 2));
  else
    insert into public.quotation_taxes (quotation_id, tax_rate_id, name, rate, compound, base_amount, amount)
    select p_quotation_id, t.tax_rate_id, t.name, t.rate, t.compound, t.base_amount, t.amount
    from public.compute_taxes(v_taxable) t where t.amount <> 0;
  end if;

  select coalesce(sum(amount), 0) into v_tax from public.quotation_taxes where quotation_id = p_quotation_id;

  update public.quotations set amount = v_net, tax_amount = v_tax, total = v_net + v_tax
  where id = p_quotation_id;
end $$;

-- A quotation the customer has accepted is the thing they agreed to, so its lines stop moving.
create or replace function public.trg_quotation_lines_recalc() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_status text;
begin
  v_id := coalesce(new.quotation_id, old.quotation_id);
  select status into v_status from public.quotations where id = v_id;
  -- quotations are declined, not rejected; estimates are the ones that get rejected
  if v_status in ('accepted', 'declined', 'expired') then
    raise exception 'This quotation has been %. Its lines cannot be changed - copy it to a new one instead.', v_status;
  end if;
  -- recalc_quotation writes line_total back, which re-fires this trigger; only the outermost
  -- call should recalculate, the same guard the invoice lines use.
  if pg_trigger_depth() = 1 then perform public.recalc_quotation(v_id); end if;
  return null;
end $$;

drop trigger if exists trg_quotation_lines_recalc on public.quotation_lines;
create trigger trg_quotation_lines_recalc after insert or update or delete on public.quotation_lines
  for each row execute function public.trg_quotation_lines_recalc();

-- ------------------------------------------------------------------------------ RLS
alter table public.quotation_lines enable row level security;
alter table public.quotation_taxes enable row level security;

drop policy if exists quotation_lines_read on public.quotation_lines;
create policy quotation_lines_read on public.quotation_lines for select to authenticated using (true);

drop policy if exists quotation_lines_write on public.quotation_lines;
create policy quotation_lines_write on public.quotation_lines for all to authenticated
  using (public.has_role('super_admin') or public.has_role('manager') or public.has_role('sales_exec') or public.has_role('ops_officer'))
  with check (public.has_role('super_admin') or public.has_role('manager') or public.has_role('sales_exec') or public.has_role('ops_officer'));

drop policy if exists quotation_taxes_read on public.quotation_taxes;
create policy quotation_taxes_read on public.quotation_taxes for select to authenticated using (true);

drop policy if exists quotation_taxes_write on public.quotation_taxes;
create policy quotation_taxes_write on public.quotation_taxes for all to authenticated
  using (public.has_role('super_admin')) with check (public.has_role('super_admin'));

grant select on public.quotation_lines, public.quotation_taxes to authenticated;
grant insert, update, delete on public.quotation_lines to authenticated;
grant insert, update, delete on public.quotation_taxes to authenticated;

-- ------------------------------------------------------------ create_quotation, with lines
/* The default lines say what the customer is buying in their terms. A recurring contract reads
   as a monthly fee times the months, which is the figure a customer checks; a one-off job reads
   as a single line. Either can be split or reworded before the quotation is sent. */
create or replace function public.create_quotation(p_estimate_id uuid, p_valid_days integer default 30, p_terms text default null)
returns uuid
language plpgsql security definer set search_path = public as $$
declare e public.estimates; v_id uuid; v_name text; v_terms text; v_qty numeric; v_unit numeric; v_desc text;
begin
  perform public.require_role(array['sales_exec','ops_officer','manager']);
  select * into e from public.estimates where id = p_estimate_id for update;
  if e.status not in ('approved','quoted') then raise exception 'The estimate must be approved before quoting'; end if;

  select name into v_name from public.services where id = e.service_id;

  -- The wording comes from Configuration unless this quotation was given its own.
  select coalesce(nullif(p_terms, ''), default_payment_terms) into v_terms
  from public.company_settings where id = 1;

  insert into public.quotations (quote_no, estimate_id, customer_id, lead_id, title, description, valid_until,
    amount, tax_amount, total, terms, payment_terms, status)
  values (public.next_doc_no('quotation'), e.id, e.customer_id, e.lead_id, coalesce(e.title, v_name),
    case when e.is_recurring then v_name || ' – ' || e.visits_per_period || ' visit(s) per ' || e.visit_period || ' for ' || e.contract_months || ' month(s).'
         else v_name || coalesce(' at ' || e.site, '') end,
    current_date + p_valid_days, 0, 0, 0, p_terms, v_terms, 'sent')
  returning id into v_id;

  if e.is_recurring and e.contract_months > 0 then
    v_qty  := e.contract_months;
    v_unit := round(e.proposed_price / e.contract_months, 2);
    v_desc := v_name || ' – ' || e.visits_per_period || ' visit(s) per ' || e.visit_period
              || coalesce(' at ' || e.site, '') || ' (monthly fee)';
  else
    v_qty  := 1;
    v_unit := round(e.proposed_price, 2);
    v_desc := v_name || coalesce(' at ' || e.site, '');
  end if;

  insert into public.quotation_lines (quotation_id, service_id, description, quantity, unit_price, sort_order)
  values (v_id, e.service_id, v_desc, v_qty, v_unit, 10);

  /* Rounding the monthly fee can leave the contract a few pesewas off the approved price. The
     difference goes on its own line rather than being hidden in the rate, so the quotation adds
     up to what was approved and anyone can see why. */
  if round(v_qty * v_unit, 2) <> round(e.proposed_price, 2) then
    insert into public.quotation_lines (quotation_id, description, quantity, unit_price, sort_order)
    values (v_id, 'Rounding adjustment', 1, round(e.proposed_price - round(v_qty * v_unit, 2), 2), 20);
  end if;

  perform public.recalc_quotation(v_id);

  update public.estimates set status = 'quoted' where id = e.id;
  if e.lead_id is not null then
    update public.leads set stage = 'estimate_sent' where id = e.lead_id and stage in ('new','contacted','site_visit');
  end if;
  return v_id;
end $$;

-- ------------------------------------------------- quotations already in the system get lines
/* Without this, every quotation raised before today would print an empty table. Each gets the
   single line its stored total implies.

   Three things make this more delicate than it looks, and all three are about not altering a
   document that has already been sent:

   1. The guard above refuses line changes on an accepted quotation - correctly, for a user. The
      backfill is not a user, so the recalc trigger is lifted for the length of it.
   2. With the trigger lifted, nothing recomputes the totals, which is exactly what is wanted. A
      recalc would price the tax at today's active rates, so a quotation accepted when no tax was
      active would silently gain VAT and its total would change. The stored amount, tax_amount and
      total are left untouched.
   3. The tax row is therefore derived from the tax already stored on the quotation, not from the
      tax table, so a reprint shows the figures the customer agreed to. */
alter table public.quotation_lines disable trigger trg_quotation_lines_recalc;

do $$
declare q record; v_rate numeric;
begin
  for q in
    select qt.id, qt.title, qt.amount, qt.tax_amount, e.service_id, s.name as service_name
    from public.quotations qt
    left join public.estimates e on e.id = qt.estimate_id
    left join public.services s on s.id = e.service_id
    where not exists (select 1 from public.quotation_lines l where l.quotation_id = qt.id)
  loop
    insert into public.quotation_lines (quotation_id, service_id, description, quantity, unit_price, line_total, sort_order)
    values (q.id, q.service_id, coalesce(q.service_name, q.title, 'Services as quoted'),
            1, round(coalesce(q.amount, 0), 2), round(coalesce(q.amount, 0), 2), 10);

    -- The rate the stored tax implies, so the breakdown adds up to what was sent.
    if coalesce(q.tax_amount, 0) <> 0 then
      v_rate := case when coalesce(q.amount, 0) <> 0
                     then round(q.tax_amount * 100 / q.amount, 4)
                     else 0 end;
      insert into public.quotation_taxes (quotation_id, name, rate, base_amount, amount)
      values (q.id, 'Tax', v_rate, round(coalesce(q.amount, 0), 2), round(q.tax_amount, 2));
    end if;
  end loop;
end $$;

alter table public.quotation_lines enable trigger trg_quotation_lines_recalc;

/* The standing wording goes only onto quotations still in play. An accepted or declined one was
   sent without it, and adding it now would make a reprint differ from the document the customer
   actually has. */
update public.quotations set payment_terms = (select default_payment_terms from public.company_settings where id = 1)
where payment_terms is null and status not in ('accepted', 'declined', 'expired');
