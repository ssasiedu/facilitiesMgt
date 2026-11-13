-- 0005_fleet.sql : trucks, their documents and status history, bookings, staff, maintenance
-- and fuel.
--
-- Two things here are enforced by the database rather than by application code:
--   * truck_bookings has an exclusion constraint, so the same truck can never hold two
--     overlapping bookings — even if two officers approve jobs at the same moment.
--   * employee_bookings does the same for drivers and crew.
-- Status changes go through set_truck_status() in 0013, which writes truck_status_history
-- and flags any future job orders that lose their truck.

create table if not exists public.employees (
  id uuid primary key default gen_random_uuid(),
  employee_code text unique,
  full_name text not null check (btrim(full_name) <> ''),
  role_type text not null default 'cleaner' check (role_type in
    ('driver', 'cleaner', 'supervisor', 'gardener', 'technician', 'loader', 'officer', 'other')),
  phone text,
  ghana_card_no text check (ghana_card_no is null or ghana_card_no ~ '^GHA-[0-9]{9}-[0-9]$'),
  daily_rate numeric(14,2) not null default 0 check (daily_rate >= 0),
  status text not null default 'active' check (status in ('active', 'on_leave', 'suspended', 'inactive')),
  profile_id uuid references public.profiles(id) on delete set null,
  -- drivers only
  licence_no text,
  licence_class text,
  licence_expiry date,
  hired_on date,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.profiles(id) on delete set null,
  archived_at timestamptz,
  -- a driver must have a licence on file: submit_job_order() checks it has not expired
  constraint employees_driver_licence_chk check (
    role_type <> 'driver' or (coalesce(btrim(licence_no), '') <> '' and licence_expiry is not null)
  )
);
create index if not exists employees_role_idx on public.employees (role_type) where archived_at is null;
create index if not exists employees_status_idx on public.employees (status) where archived_at is null;
create index if not exists employees_profile_idx on public.employees (profile_id);
create index if not exists employees_licence_expiry_idx on public.employees (licence_expiry)
  where licence_expiry is not null;
create index if not exists employees_name_trgm on public.employees using gin (full_name extensions.gin_trgm_ops);
create unique index if not exists employees_ghana_card_uq
  on public.employees (ghana_card_no) where ghana_card_no is not null;

create table if not exists public.trucks (
  id uuid primary key default gen_random_uuid(),
  registration_no text not null unique,
  fleet_code text unique,
  truck_type text not null check (truck_type in
    ('cesspit_emptier', 'water_tanker', 'cabin_carrier', 'pickup', 'other')),
  make text,
  model text,
  year int check (year is null or year between 1950 and 2200),
  capacity_litres numeric(12,3) check (capacity_litres is null or capacity_litres >= 0),
  capacity_cabins int check (capacity_cabins is null or capacity_cabins >= 0),
  chassis_no text,
  fuel_type text not null default 'diesel' check (fuel_type in ('diesel', 'petrol', 'electric', 'other')),
  odometer_km numeric(12,1) not null default 0 check (odometer_km >= 0),
  photo_path text,
  assigned_driver_id uuid references public.employees(id) on delete set null,
  -- on_road = available for jobs, on_job = out on a job right now, off_road = unavailable
  status text not null default 'on_road' check (status in ('on_road', 'on_job', 'off_road')),
  off_road_reason text check (off_road_reason is null or off_road_reason in
    ('breakdown', 'preventive_maintenance', 'accident', 'awaiting_parts', 'documents_expired')),
  expected_return_date date,
  status_note text,
  status_changed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.profiles(id) on delete set null,
  archived_at timestamptz,
  -- Off-Road always needs a reason and an expected return date (spec 4.5)
  constraint trucks_off_road_chk check (
    status <> 'off_road' or (off_road_reason is not null and expected_return_date is not null)
  ),
  constraint trucks_on_road_clean_chk check (
    status = 'off_road' or (off_road_reason is null and expected_return_date is null)
  )
);
create index if not exists trucks_type_idx on public.trucks (truck_type) where archived_at is null;
create index if not exists trucks_status_idx on public.trucks (status) where archived_at is null;
create index if not exists trucks_driver_idx on public.trucks (assigned_driver_id);
create index if not exists trucks_reg_trgm on public.trucks using gin (registration_no extensions.gin_trgm_ops);
create index if not exists trucks_fleet_code_trgm on public.trucks using gin (fleet_code extensions.gin_trgm_ops);

create table if not exists public.truck_documents (
  id uuid primary key default gen_random_uuid(),
  truck_id uuid not null references public.trucks(id) on delete cascade,
  doc_type text not null check (doc_type in ('insurance', 'roadworthy', 'permit', 'registration', 'other')),
  doc_number text,
  issue_date date,
  expiry_date date not null,
  file_path text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint truck_documents_dates_chk check (issue_date is null or expiry_date >= issue_date)
);
create index if not exists truck_documents_truck_idx on public.truck_documents (truck_id);
create index if not exists truck_documents_expiry_idx on public.truck_documents (expiry_date);

create table if not exists public.truck_status_history (
  id uuid primary key default gen_random_uuid(),
  truck_id uuid not null references public.trucks(id) on delete cascade,
  from_status text,
  to_status text not null,
  reason text,
  expected_return_date date,
  note text,
  changed_by uuid references public.profiles(id) on delete set null,
  changed_at timestamptz not null default now()
);
create index if not exists truck_status_history_truck_idx
  on public.truck_status_history (truck_id, changed_at desc);

-- =====================================================================================
-- Bookings. "period" is an inclusive date range: a one-day job books [date, date].
-- =====================================================================================
create table if not exists public.truck_bookings (
  id uuid primary key default gen_random_uuid(),
  truck_id uuid not null references public.trucks(id) on delete cascade,
  job_order_id uuid not null,            -- FK added in 0006
  period daterange not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles(id) on delete set null,
  constraint truck_bookings_period_chk check (not isempty(period) and lower(period) is not null)
);
create index if not exists truck_bookings_truck_idx on public.truck_bookings (truck_id);
create index if not exists truck_bookings_job_idx on public.truck_bookings (job_order_id);
create index if not exists truck_bookings_period_idx
  on public.truck_bookings using gist (period) where active;

create table if not exists public.employee_bookings (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id) on delete cascade,
  job_order_id uuid not null,            -- FK added in 0006
  period daterange not null,
  active boolean not null default true,
  constraint employee_bookings_period_chk check (not isempty(period) and lower(period) is not null)
);
create index if not exists employee_bookings_employee_idx on public.employee_bookings (employee_id);
create index if not exists employee_bookings_job_idx on public.employee_bookings (job_order_id);
create index if not exists employee_bookings_period_idx
  on public.employee_bookings using gist (period) where active;

-- The uuid gist operator class comes from btree_gist, which 0001 installs into the
-- "extensions" schema. Its schema is looked up rather than assumed, so these statements
-- work both through the CLI and when pasted into the SQL editor.
do $$
declare v_opc text;
begin
  select quote_ident(n.nspname) || '.' || quote_ident(oc.opcname) into v_opc
    from pg_opclass oc
    join pg_namespace n on n.oid = oc.opcnamespace
    join pg_am am on am.oid = oc.opcmethod
   where am.amname = 'gist' and oc.opcintype = 'uuid'::regtype
   order by oc.opcdefault desc
   limit 1;

  if v_opc is null then
    raise exception 'btree_gist is needed for the booking overlap constraints. Run 0001_extensions.sql first.';
  end if;

  if not exists (select 1 from pg_constraint where conname = 'truck_bookings_no_overlap') then
    execute format(
      'alter table public.truck_bookings add constraint truck_bookings_no_overlap '
      'exclude using gist (truck_id %s with =, period with &&) where (active)', v_opc);
  end if;

  if not exists (select 1 from pg_constraint where conname = 'employee_bookings_no_overlap') then
    execute format(
      'alter table public.employee_bookings add constraint employee_bookings_no_overlap '
      'exclude using gist (employee_id %s with =, period with &&) where (active)', v_opc);
  end if;
end $$;

-- =====================================================================================
-- Maintenance and fuel
-- =====================================================================================
create table if not exists public.maintenance_schedules (
  id uuid primary key default gen_random_uuid(),
  truck_id uuid not null references public.trucks(id) on delete cascade,
  title text not null,
  interval_days int check (interval_days is null or interval_days > 0),
  interval_km numeric(12,1) check (interval_km is null or interval_km > 0),
  last_done_date date,
  last_done_km numeric(12,1),
  next_due_date date,
  next_due_km numeric(12,1),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- a schedule is by date, by kilometre, or both, but it must be one of them
  constraint maintenance_schedules_basis_chk check (
    interval_days is not null or interval_km is not null
    or next_due_date is not null or next_due_km is not null
  )
);
create index if not exists maintenance_schedules_truck_idx on public.maintenance_schedules (truck_id);
create index if not exists maintenance_schedules_due_date_idx
  on public.maintenance_schedules (next_due_date) where active;
create index if not exists maintenance_schedules_due_km_idx
  on public.maintenance_schedules (next_due_km) where active;

create table if not exists public.maintenance_records (
  id uuid primary key default gen_random_uuid(),
  truck_id uuid not null references public.trucks(id) on delete cascade,
  schedule_id uuid references public.maintenance_schedules(id) on delete set null,
  service_date date not null default current_date,
  workshop text,
  work_done text not null,
  parts text,
  cost numeric(14,2) not null default 0 check (cost >= 0),
  odometer_km numeric(12,1) check (odometer_km is null or odometer_km >= 0),
  paid_from_bank_account_id uuid,        -- FK added in 0009
  journal_entry_id uuid,                 -- FK added in 0009
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles(id) on delete set null
);
create index if not exists maintenance_records_truck_idx
  on public.maintenance_records (truck_id, service_date desc);
create index if not exists maintenance_records_schedule_idx on public.maintenance_records (schedule_id);
create index if not exists maintenance_records_journal_idx on public.maintenance_records (journal_entry_id);
create index if not exists maintenance_records_date_idx on public.maintenance_records (service_date);

create table if not exists public.fuel_logs (
  id uuid primary key default gen_random_uuid(),
  truck_id uuid not null references public.trucks(id) on delete cascade,
  log_date date not null default current_date,
  litres numeric(12,3) not null check (litres > 0),
  cost numeric(14,2) not null default 0 check (cost >= 0),
  odometer_km numeric(12,1) check (odometer_km is null or odometer_km >= 0),
  job_order_id uuid,                     -- FK added in 0006
  station text,
  paid_from_bank_account_id uuid,        -- FK added in 0009
  journal_entry_id uuid,                 -- FK added in 0009
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles(id) on delete set null
);
create index if not exists fuel_logs_truck_idx on public.fuel_logs (truck_id, log_date desc);
create index if not exists fuel_logs_job_idx on public.fuel_logs (job_order_id);
create index if not exists fuel_logs_journal_idx on public.fuel_logs (journal_entry_id);
create index if not exists fuel_logs_date_idx on public.fuel_logs (log_date);
