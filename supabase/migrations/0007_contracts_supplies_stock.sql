-- 0007_contracts_supplies_stock.sql : contracts, services, sites, billing periods, supplies, labour, stock.

create table if not exists public.contracts (
  id uuid primary key default gen_random_uuid(),
  contract_no text unique,
  customer_id uuid not null references public.customers(id),
  contract_type text not null check (contract_type in ('one_off','recurring')),
  title text not null,
  description text,
  start_date date not null,
  end_date date not null,
  billing_frequency text not null default 'monthly' check (billing_frequency in ('weekly','monthly','quarterly')),
  amount_per_period numeric(14,2) not null default 0 check (amount_per_period >= 0),
  total_agreed numeric(14,2) not null default 0 check (total_agreed >= 0),   -- one-off contracts
  billing_day int not null default 1 check (billing_day between 1 and 28),
  payment_terms_days int not null default 7 check (payment_terms_days >= 0),
  taxable boolean not null default true,
  service_id uuid references public.services(id),   -- main service (for revenue reporting)
  auto_send boolean not null default true,
  prorate boolean not null default true,
  price_review_date date,
  supervisor_id uuid references public.profiles(id),
  estimate_id uuid references public.estimates(id),
  budgeted_monthly_cost numeric(14,2) not null default 0,
  overhead_pct numeric(6,3) not null default 0 check (overhead_pct >= 0),
  signed_contract_path text,
  renewal_reminder_days int not null default 60,
  status text not null default 'draft' check (status in ('draft','pending_approval','active','suspended','expired','terminated')),
  status_reason text,
  next_billing_date date,
  submitted_at timestamptz,
  approved_by uuid references public.profiles(id), approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.profiles(id) default public.current_profile_id(),
  archived_at timestamptz,
  constraint contracts_dates check (end_date >= start_date)
);
create index if not exists contracts_customer_idx on public.contracts(customer_id);
create index if not exists contracts_status_idx on public.contracts(status);
create index if not exists contracts_next_billing_idx on public.contracts(next_billing_date) where status = 'active';
create index if not exists contracts_estimate_idx on public.contracts(estimate_id);
create index if not exists contracts_supervisor_idx on public.contracts(supervisor_id);
create index if not exists contracts_service_idx on public.contracts(service_id);

create table if not exists public.contract_services (
  id uuid primary key default gen_random_uuid(),
  contract_id uuid not null references public.contracts(id) on delete cascade,
  service_id uuid not null references public.services(id),
  description text,
  quantity numeric(12,3) not null default 1,
  unit_price numeric(14,2) not null default 0
);
create index if not exists contract_services_contract_idx on public.contract_services(contract_id);
create index if not exists contract_services_service_idx on public.contract_services(service_id);

create table if not exists public.contract_sites (
  id uuid primary key default gen_random_uuid(),
  contract_id uuid not null references public.contracts(id) on delete cascade,
  name text not null,
  address text,
  digital_address text check (digital_address ~ '^[A-Z]{2}-[0-9]{3,4}-[0-9]{4}$'),
  notes text
);
create index if not exists contract_sites_contract_idx on public.contract_sites(contract_id);

create table if not exists public.contract_billing_periods (
  id uuid primary key default gen_random_uuid(),
  contract_id uuid not null references public.contracts(id),
  period_start date not null,
  period_end date not null,
  amount numeric(14,2) not null,
  prorated boolean not null default false,
  invoice_id uuid,
  created_at timestamptz not null default now(),
  unique (contract_id, period_start)
);
create index if not exists contract_billing_periods_invoice_idx on public.contract_billing_periods(invoice_id);

create table if not exists public.stock_locations (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  is_default boolean not null default false,
  archived_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.stock_levels (
  cost_item_id uuid not null references public.cost_items(id),
  location_id uuid not null references public.stock_locations(id),
  quantity numeric(12,3) not null default 0,
  updated_at timestamptz not null default now(),
  primary key (cost_item_id, location_id)
);
create index if not exists stock_levels_location_idx on public.stock_levels(location_id);

create table if not exists public.stock_movements (
  id uuid primary key default gen_random_uuid(),
  cost_item_id uuid not null references public.cost_items(id),
  location_id uuid not null references public.stock_locations(id),
  movement_date date not null default current_date,
  movement_type text not null check (movement_type in ('receipt','issue','adjustment')),
  quantity numeric(12,3) not null check (quantity <> 0),       -- + in, - out
  unit_cost numeric(14,2) not null default 0,
  reference_type text, reference_id uuid,
  contract_id uuid references public.contracts(id),
  job_order_id uuid references public.job_orders(id),
  note text,
  created_by uuid references public.profiles(id) default public.current_profile_id(),
  created_at timestamptz not null default now()
);
create index if not exists stock_movements_item_idx on public.stock_movements(cost_item_id, location_id);
create index if not exists stock_movements_contract_idx on public.stock_movements(contract_id);
create index if not exists stock_movements_job_idx on public.stock_movements(job_order_id);
create index if not exists stock_movements_location_idx on public.stock_movements(location_id);

create table if not exists public.contract_supplies (
  id uuid primary key default gen_random_uuid(),
  contract_id uuid not null references public.contracts(id),
  supply_date date not null default current_date,
  cost_item_id uuid not null references public.cost_items(id),
  quantity numeric(12,3) not null check (quantity > 0),
  unit_cost numeric(14,2) not null default 0 check (unit_cost >= 0),
  amount numeric(14,2) not null default 0,
  site_id uuid references public.contract_sites(id) on delete set null,
  stock_location_id uuid references public.stock_locations(id),
  issued_by uuid references public.profiles(id) default public.current_profile_id(),
  received_by text,
  delivery_note_path text,
  notes text,
  created_at timestamptz not null default now()
);
create index if not exists contract_supplies_contract_idx on public.contract_supplies(contract_id, supply_date);
create index if not exists contract_supplies_item_idx on public.contract_supplies(cost_item_id);
create index if not exists contract_supplies_site_idx on public.contract_supplies(site_id);
create index if not exists contract_supplies_location_idx on public.contract_supplies(stock_location_id);

create table if not exists public.contract_labour (
  id uuid primary key default gen_random_uuid(),
  contract_id uuid not null references public.contracts(id),
  work_date date not null default current_date,       -- any date inside the month being allocated
  employee_id uuid references public.employees(id),
  role_description text,
  staff_count numeric(12,3) not null default 1 check (staff_count >= 0),
  days numeric(12,3) not null default 1 check (days >= 0),
  rate numeric(14,2) not null default 0 check (rate >= 0),
  actual_wage_amount numeric(14,2),                    -- overrides staff × days × rate
  amount numeric(14,2) not null default 0,
  kind text not null default 'labour' check (kind in ('labour','vehicle','other')),
  notes text,
  created_by uuid references public.profiles(id) default public.current_profile_id(),
  created_at timestamptz not null default now()
);
create index if not exists contract_labour_contract_idx on public.contract_labour(contract_id, work_date);
create index if not exists contract_labour_employee_idx on public.contract_labour(employee_id);

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'job_orders_contract_fk') then
    alter table public.job_orders add constraint job_orders_contract_fk foreign key (contract_id) references public.contracts(id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'estimates_converted_contract_fk') then
    alter table public.estimates add constraint estimates_converted_contract_fk foreign key (converted_contract_id) references public.contracts(id) on delete set null;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'job_actual_costs_location_fk') then
    alter table public.job_order_actual_costs add constraint job_actual_costs_location_fk foreign key (stock_location_id) references public.stock_locations(id);
  end if;
end $$;
create index if not exists estimates_converted_contract_idx on public.estimates(converted_contract_id);
create index if not exists job_actual_costs_location_idx on public.job_order_actual_costs(stock_location_id);
