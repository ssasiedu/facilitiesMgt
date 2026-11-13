-- 0004_catalogue_estimator.sql : the service catalogue, the cost item catalogue with price
-- history, estimate templates, estimates with their cost lines, and quotations.
--
-- Percentages (overhead_pct, contingency_pct, target_margin_pct, tax_pct) are stored as
-- whole numbers: 10 means 10%. The arithmetic lives in estimates_compute() in 0013, so
-- the browser never calculates a cost or a margin.
--
-- Every estimate line keeps a snapshot of the unit costs it was built from (unit_cost,
-- cost_per_trip, cost_per_km, cost_per_day), so re-pricing the catalogue later never
-- rewrites history.

create table if not exists public.services (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  description text,
  unit_of_measure text not null default 'per_visit' check (unit_of_measure in
    ('per_trip', 'per_day', 'per_cabin_per_day', 'per_m2', 'per_visit', 'per_month', 'per_event', 'per_1000_litres')),
  default_price numeric(14,2) not null default 0 check (default_price >= 0),
  taxable boolean not null default true,
  requires_truck boolean not null default false,
  required_truck_type text check (required_truck_type is null or required_truck_type in
    ('cesspit_emptier', 'water_tanker', 'cabin_carrier', 'pickup', 'other')),
  revenue_account_id uuid,               -- FK added in 0009, once accounts exists
  default_template_id uuid,              -- FK added below, once estimate_templates exists
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.profiles(id) on delete set null,
  archived_at timestamptz,
  -- a service that needs a truck must say which type, or the truck picker cannot filter
  constraint services_truck_type_chk check (not requires_truck or required_truck_type is not null)
);
create index if not exists services_active_idx on public.services (active) where archived_at is null;
create index if not exists services_revenue_account_idx on public.services (revenue_account_id);

alter table public.leads drop constraint if exists leads_service_fk;
alter table public.leads
  add constraint leads_service_fk foreign key (service_id) references public.services(id) on delete set null;

-- =====================================================================================
-- Cost item catalogue
-- =====================================================================================
create table if not exists public.cost_items (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  category text not null check (category in
    ('consumable', 'equipment', 'labour', 'vehicle', 'subcontract', 'overhead')),
  unit_of_measure text not null default 'each',
  unit_cost numeric(14,2) not null default 0 check (unit_cost >= 0),
  -- labour: is the rate a day rate or an hourly rate?
  rate_basis text not null default 'day' check (rate_basis in ('day', 'hour')),
  -- vehicle items: fuel, driver and wear, by trip, by kilometre and by day
  cost_per_trip numeric(14,2) not null default 0 check (cost_per_trip >= 0),
  cost_per_km numeric(14,2) not null default 0 check (cost_per_km >= 0),
  cost_per_day numeric(14,2) not null default 0 check (cost_per_day >= 0),
  truck_type text check (truck_type is null or truck_type in
    ('cesspit_emptier', 'water_tanker', 'cabin_carrier', 'pickup', 'other')),
  preferred_supplier text,
  track_stock boolean not null default false,
  reorder_level numeric(12,3) not null default 0 check (reorder_level >= 0),
  last_updated timestamptz not null default now(),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.profiles(id) on delete set null,
  archived_at timestamptz
);
create index if not exists cost_items_category_idx on public.cost_items (category) where archived_at is null;
create index if not exists cost_items_active_idx on public.cost_items (active) where archived_at is null;
create index if not exists cost_items_stock_idx on public.cost_items (track_stock) where track_stock;
create index if not exists cost_items_truck_type_idx on public.cost_items (truck_type);
create index if not exists cost_items_name_trgm on public.cost_items using gin (name extensions.gin_trgm_ops);
create index if not exists cost_items_code_trgm on public.cost_items using gin (code extensions.gin_trgm_ops);

-- Price history with effective dates. 0014 writes a row whenever a catalogue price changes.
create table if not exists public.cost_item_prices (
  id uuid primary key default gen_random_uuid(),
  cost_item_id uuid not null references public.cost_items(id) on delete cascade,
  effective_date date not null default current_date,
  unit_cost numeric(14,2) not null default 0 check (unit_cost >= 0),
  cost_per_trip numeric(14,2) not null default 0 check (cost_per_trip >= 0),
  cost_per_km numeric(14,2) not null default 0 check (cost_per_km >= 0),
  cost_per_day numeric(14,2) not null default 0 check (cost_per_day >= 0),
  note text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (cost_item_id, effective_date)
);
create index if not exists cost_item_prices_item_idx
  on public.cost_item_prices (cost_item_id, effective_date desc);

-- =====================================================================================
-- Estimate templates: so a cesspit or janitorial estimate takes under two minutes
-- =====================================================================================
create table if not exists public.estimate_templates (
  id uuid primary key default gen_random_uuid(),
  service_id uuid not null references public.services(id) on delete cascade,
  name text not null,
  duration_days numeric(12,3) not null default 1 check (duration_days > 0),
  hours_per_day numeric(12,3) not null default 8 check (hours_per_day > 0 and hours_per_day <= 24),
  is_recurring boolean not null default false,
  visits_per_period numeric(12,3) not null default 1 check (visits_per_period > 0),
  visit_period text not null default 'month' check (visit_period in ('week', 'month')),
  contract_months int not null default 1 check (contract_months > 0),
  overhead_pct numeric(7,3) not null default 10 check (overhead_pct >= 0 and overhead_pct <= 1000),
  contingency_pct numeric(7,3) not null default 5 check (contingency_pct >= 0 and contingency_pct <= 1000),
  target_margin_pct numeric(7,3) not null default 25 check (target_margin_pct >= 0 and target_margin_pct < 100),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz
);
create index if not exists estimate_templates_service_idx on public.estimate_templates (service_id);
create index if not exists estimate_templates_active_idx on public.estimate_templates (active) where archived_at is null;

alter table public.services drop constraint if exists services_template_fk;
alter table public.services
  add constraint services_template_fk foreign key (default_template_id)
  references public.estimate_templates(id) on delete set null;

create table if not exists public.estimate_template_lines (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null references public.estimate_templates(id) on delete cascade,
  cost_item_id uuid not null references public.cost_items(id) on delete cascade,
  basis text not null default 'total' check (basis in ('total', 'per_visit', 'per_day')),
  quantity numeric(12,3) not null default 1 check (quantity >= 0),
  headcount numeric(12,3) not null default 1 check (headcount >= 0),
  days numeric(12,3) not null default 1 check (days >= 0),
  km numeric(12,3) not null default 0 check (km >= 0),
  sort_order int not null default 0
);
create index if not exists estimate_template_lines_template_idx
  on public.estimate_template_lines (template_id, sort_order);
create index if not exists estimate_template_lines_item_idx on public.estimate_template_lines (cost_item_id);

-- =====================================================================================
-- Estimates
-- =====================================================================================
create table if not exists public.estimates (
  id uuid primary key default gen_random_uuid(),
  estimate_no text unique,
  version int not null default 1 check (version > 0),
  root_id uuid references public.estimates(id) on delete set null,   -- v1 of this estimate
  customer_id uuid references public.customers(id) on delete set null,
  lead_id uuid references public.leads(id) on delete set null,
  service_id uuid references public.services(id) on delete set null,
  template_id uuid references public.estimate_templates(id) on delete set null,
  title text,
  site text,

  -- drivers
  duration_days numeric(12,3) not null default 1 check (duration_days > 0),
  hours_per_day numeric(12,3) not null default 8 check (hours_per_day > 0 and hours_per_day <= 24),
  is_recurring boolean not null default false,
  visits_per_period numeric(12,3) not null default 1 check (visits_per_period > 0),
  visit_period text not null default 'month' check (visit_period in ('week', 'month')),
  contract_months int not null default 1 check (contract_months > 0),
  overhead_pct numeric(7,3) not null default 10 check (overhead_pct >= 0 and overhead_pct <= 1000),
  contingency_pct numeric(7,3) not null default 5 check (contingency_pct >= 0 and contingency_pct <= 1000),
  target_margin_pct numeric(7,3) not null default 25 check (target_margin_pct >= 0 and target_margin_pct < 100),
  tax_pct numeric(7,3) not null default 0 check (tax_pct >= 0 and tax_pct <= 100),
  proposed_price numeric(14,2) not null default 0 check (proposed_price >= 0),

  -- computed by estimates_compute() in 0013; never written from the browser
  total_visits numeric(12,3) not null default 1,
  cost_consumable numeric(14,2) not null default 0,
  cost_equipment numeric(14,2) not null default 0,
  cost_labour numeric(14,2) not null default 0,
  cost_vehicle numeric(14,2) not null default 0,
  cost_subcontract numeric(14,2) not null default 0,
  cost_overhead_items numeric(14,2) not null default 0,
  direct_cost numeric(14,2) not null default 0,
  overhead_amount numeric(14,2) not null default 0,
  contingency_amount numeric(14,2) not null default 0,
  total_cost numeric(14,2) not null default 0,
  break_even_price numeric(14,2) not null default 0,
  recommended_price numeric(14,2) not null default 0,
  profit numeric(14,2) not null default 0,
  margin_pct numeric(9,3) not null default 0,
  cost_per_visit numeric(14,2) not null default 0,
  cost_per_day numeric(14,2) not null default 0,
  cost_per_month numeric(14,2) not null default 0,
  price_warning text not null default 'none' check (price_warning in ('none', 'below_cost', 'below_margin')),
  requires_approval boolean not null default false,

  -- draft -> pending_approval -> approved -> quoted -> accepted -> converted
  -- (rejected, superseded by a newer version, or expired past its validity)
  status text not null default 'draft' check (status in
    ('draft', 'pending_approval', 'approved', 'rejected', 'quoted', 'accepted',
     'converted', 'superseded', 'expired')),
  approved_by uuid references public.profiles(id) on delete set null,
  approved_at timestamptz,
  rejection_reason text,
  converted_job_id uuid,                 -- FK added in 0006
  converted_contract_id uuid,            -- FK added in 0007
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.profiles(id) on delete set null,
  archived_at timestamptz,

  -- an estimate is always for a customer or a lead
  constraint estimates_party_chk check (customer_id is not null or lead_id is not null)
);
create index if not exists estimates_customer_idx on public.estimates (customer_id);
create index if not exists estimates_lead_idx on public.estimates (lead_id);
create index if not exists estimates_service_idx on public.estimates (service_id);
create index if not exists estimates_template_idx on public.estimates (template_id);
create index if not exists estimates_status_idx on public.estimates (status) where archived_at is null;
create index if not exists estimates_root_idx on public.estimates (root_id, version desc);
create index if not exists estimates_created_by_idx on public.estimates (created_by);
create index if not exists estimates_no_trgm on public.estimates using gin (estimate_no extensions.gin_trgm_ops);

create table if not exists public.estimate_lines (
  id uuid primary key default gen_random_uuid(),
  estimate_id uuid not null references public.estimates(id) on delete cascade,
  cost_item_id uuid references public.cost_items(id) on delete set null,
  category text not null check (category in
    ('consumable', 'equipment', 'labour', 'vehicle', 'subcontract', 'overhead')),
  description text not null,
  unit_of_measure text,
  basis text not null default 'total' check (basis in ('total', 'per_visit', 'per_day')),
  quantity numeric(12,3) not null default 1 check (quantity >= 0),
  headcount numeric(12,3) not null default 1 check (headcount >= 0),
  days numeric(12,3) not null default 1 check (days >= 0),
  km numeric(12,3) not null default 0 check (km >= 0),
  rate_basis text not null default 'day' check (rate_basis in ('day', 'hour')),
  -- cost snapshot, taken when the line is saved
  unit_cost numeric(14,2) not null default 0 check (unit_cost >= 0),
  cost_per_trip numeric(14,2) not null default 0 check (cost_per_trip >= 0),
  cost_per_km numeric(14,2) not null default 0 check (cost_per_km >= 0),
  cost_per_day numeric(14,2) not null default 0 check (cost_per_day >= 0),
  line_cost numeric(14,2) not null default 0,     -- computed in 0013/0014
  sort_order int not null default 0
);
create index if not exists estimate_lines_estimate_idx on public.estimate_lines (estimate_id, sort_order);
create index if not exists estimate_lines_item_idx on public.estimate_lines (cost_item_id);
create index if not exists estimate_lines_category_idx on public.estimate_lines (estimate_id, category);

-- =====================================================================================
-- Quotations: the customer-facing document. Internal costs never appear on it.
-- =====================================================================================
create table if not exists public.quotations (
  id uuid primary key default gen_random_uuid(),
  quote_no text unique,
  estimate_id uuid not null references public.estimates(id) on delete cascade,
  customer_id uuid references public.customers(id) on delete set null,
  lead_id uuid references public.leads(id) on delete set null,
  title text,
  description text,
  quote_date date not null default current_date,
  valid_until date not null default (current_date + 30),
  amount numeric(14,2) not null default 0 check (amount >= 0),
  tax_amount numeric(14,2) not null default 0 check (tax_amount >= 0),
  total numeric(14,2) not null default 0 check (total >= 0),
  terms text,
  status text not null default 'draft' check (status in ('draft', 'sent', 'accepted', 'declined', 'expired')),
  public_token text not null unique default encode(extensions.gen_random_bytes(18), 'hex'),
  accepted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.profiles(id) on delete set null,
  constraint quotations_valid_until_chk check (valid_until >= quote_date)
);
create index if not exists quotations_estimate_idx on public.quotations (estimate_id);
create index if not exists quotations_customer_idx on public.quotations (customer_id);
create index if not exists quotations_lead_idx on public.quotations (lead_id);
create index if not exists quotations_status_idx on public.quotations (status);
