-- 0025: configurable dropdown lists, and an invoice that reads Open until it falls due.
--
-- Sector and payment terms were free text, so the same thing arrived spelled three ways and no
-- report could group on it. Both now come from a list a Super Admin maintains, in one table so
-- the next list that needs this costs a row rather than a migration.

create table if not exists public.list_options (
  id          uuid primary key default extensions.gen_random_uuid(),
  category    text not null check (category in ('customer_sector', 'payment_terms', 'lead_lost_reason', 'expense_category')),
  value       text not null,
  label       text not null,
  sort_order  integer not null default 100,
  -- payment terms need the number of days behind the label; other lists leave it null
  numeric_value numeric(12,2),
  is_default  boolean not null default false,
  archived_at timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create unique index if not exists list_options_unique on public.list_options (category, value) where archived_at is null;
create index if not exists list_options_category_idx on public.list_options (category, sort_order) where archived_at is null;

-- Only one default per list, so a form never has to choose between two.
create unique index if not exists list_options_one_default on public.list_options (category) where is_default and archived_at is null;

drop trigger if exists trg_list_options_updated on public.list_options;
create trigger trg_list_options_updated before update on public.list_options
  for each row execute function public.set_updated_at();

alter table public.list_options enable row level security;

drop policy if exists list_options_read on public.list_options;
create policy list_options_read on public.list_options for select to authenticated using (true);

drop policy if exists list_options_write on public.list_options;
create policy list_options_write on public.list_options for all to authenticated
  using (public.has_role('super_admin')) with check (public.has_role('super_admin'));

grant select on public.list_options to authenticated;
grant insert, update, delete on public.list_options to authenticated;

-- Starting values. Sectors are the ones this business actually serves; edit them in Settings.
insert into public.list_options (category, value, label, sort_order) values
  ('customer_sector', 'government_mmda',  'Government (MMDA)',        10),
  ('customer_sector', 'government_agency','Government agency',        20),
  ('customer_sector', 'hospitality',      'Hospitality',              30),
  ('customer_sector', 'healthcare',       'Healthcare',               40),
  ('customer_sector', 'education',        'Education',                50),
  ('customer_sector', 'manufacturing',    'Manufacturing',            60),
  ('customer_sector', 'retail',           'Retail and commercial',    70),
  ('customer_sector', 'estate',           'Estate and facilities',    80),
  ('customer_sector', 'religious',        'Religious body',           90),
  ('customer_sector', 'ngo',              'NGO and development',     100),
  ('customer_sector', 'residential',      'Residential',             110),
  ('customer_sector', 'other',            'Other',                   900)
on conflict do nothing;

insert into public.list_options (category, value, label, numeric_value, sort_order, is_default) values
  ('payment_terms', 'on_receipt', 'Due on receipt',  0,  10, false),
  ('payment_terms', 'net_7',      '7 days',          7,  20, true),
  ('payment_terms', 'net_14',     '14 days',        14,  30, false),
  ('payment_terms', 'net_30',     '30 days',        30,  40, false),
  ('payment_terms', 'net_45',     '45 days',        45,  50, false),
  ('payment_terms', 'net_60',     '60 days',        60,  60, false),
  ('payment_terms', 'net_90',     '90 days',        90,  70, false)
on conflict do nothing;

-- Existing free-text sectors keep working: anything not on the list is added to it, so nothing
-- is lost and the dropdown shows what this business has actually been using.
insert into public.list_options (category, value, label, sort_order)
select distinct 'customer_sector', lower(regexp_replace(trim(c.sector), '\s+', '_', 'g')), trim(c.sector), 500
from public.customers c
where c.sector is not null and trim(c.sector) <> ''
  and not exists (
    select 1 from public.list_options o
    where o.category = 'customer_sector'
      and (o.value = lower(regexp_replace(trim(c.sector), '\s+', '_', 'g')) or lower(o.label) = lower(trim(c.sector))))
on conflict do nothing;

-- ---------------------------------------------------------------- Open, then Due, then Overdue
/* An issued invoice reads "Open" until the day it falls due, "Due" on that day, and "Overdue"
   once the day has passed. The last of the three is what the reminder schedule keys off, so it
   stays a status of its own rather than being folded into "Due". */
create or replace function public.job_mark_overdue() returns int
language plpgsql security definer set search_path = public as $$
declare n int; m int;
begin
  update public.invoices set status = 'overdue'
  where status in ('due', 'partially_paid', 'issued') and due_date < current_date and balance > 0;
  get diagnostics n = row_count;

  update public.invoices set status = 'due'
  where status = 'issued' and due_date = current_date and balance > 0;
  get diagnostics m = row_count;

  return n + m;
end $$;

-- Catch up anything already past its due date, so the change shows without waiting for tonight.
do $$ begin perform public.job_mark_overdue(); end $$;
