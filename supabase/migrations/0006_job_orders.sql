-- 0006_job_orders.sql : job orders, lines, assignments, status history, photos, actual costs.

create table if not exists public.job_orders (
  id uuid primary key default gen_random_uuid(),
  job_no text unique,
  customer_id uuid not null references public.customers(id),
  customer_name text,                 -- denormalised for roles that cannot read customers (fleet, driver)
  contact_id uuid references public.customer_contacts(id) on delete set null,
  status text not null default 'draft' check (status in ('draft','pending_approval','approved','in_progress','completed','closed','cancelled','on_hold')),
  channel text not null default 'call_in' check (channel in ('call_in','walk_in','sales')),
  priority text not null default 'normal' check (priority in ('low','normal','high','urgent')),
  site_address text,
  digital_address text check (digital_address ~ '^[A-Z]{2}-[0-9]{3,4}-[0-9]{4}$'),
  site_lat numeric(9,6), site_lng numeric(9,6),
  raised_by uuid references public.profiles(id) default public.current_profile_id(),
  officer_id uuid references public.profiles(id),
  execution_date date not null,
  end_date date,
  time_window text,
  estimate_id uuid references public.estimates(id),
  contract_id uuid,
  subtotal numeric(14,2) not null default 0,
  discount_total numeric(14,2) not null default 0,
  tax_total numeric(14,2) not null default 0,
  agreed_amount numeric(14,2) not null default 0,
  instructions text,
  invoice_id uuid,
  submitted_at timestamptz,
  approved_by uuid references public.profiles(id), approved_at timestamptz,
  rejection_reason text,
  started_by uuid references public.profiles(id), started_at timestamptz,
  start_lat numeric(9,6), start_lng numeric(9,6),
  completed_by uuid references public.profiles(id), completed_at timestamptz,
  signoff_name text, signature_path text, completion_notes text,
  hold_reason text, held_from_status text, cancel_reason text, cancelled_at timestamptz,
  needs_reassignment boolean not null default false,
  reassignment_note text,
  credit_warning boolean not null default false,
  reminder_sent_on date, today_sms_sent_on date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  constraint job_orders_dates check (end_date is null or end_date >= execution_date)
);
create index if not exists job_orders_customer_idx on public.job_orders(customer_id);
create index if not exists job_orders_status_idx on public.job_orders(status);
create index if not exists job_orders_exec_idx on public.job_orders(execution_date);
create index if not exists job_orders_officer_idx on public.job_orders(officer_id);
create index if not exists job_orders_raised_idx on public.job_orders(raised_by);
create index if not exists job_orders_contract_idx on public.job_orders(contract_id);
create index if not exists job_orders_estimate_idx on public.job_orders(estimate_id);
create index if not exists job_orders_invoice_idx on public.job_orders(invoice_id);
create index if not exists job_orders_contact_idx on public.job_orders(contact_id);

create table if not exists public.job_order_lines (
  id uuid primary key default gen_random_uuid(),
  job_order_id uuid not null references public.job_orders(id) on delete cascade,
  service_id uuid not null references public.services(id),
  description text,
  quantity numeric(12,3) not null default 1 check (quantity > 0),
  unit_price numeric(14,2) not null default 0 check (unit_price >= 0),
  discount numeric(14,2) not null default 0 check (discount >= 0),
  taxable boolean not null default true,
  line_total numeric(14,2) not null default 0,
  sort_order int not null default 0
);
create index if not exists job_order_lines_job_idx on public.job_order_lines(job_order_id);
create index if not exists job_order_lines_service_idx on public.job_order_lines(service_id);

create table if not exists public.job_order_assignments (
  id uuid primary key default gen_random_uuid(),
  job_order_id uuid not null references public.job_orders(id) on delete cascade,
  kind text not null check (kind in ('truck','driver','crew')),
  truck_id uuid references public.trucks(id),
  employee_id uuid references public.employees(id),
  created_at timestamptz not null default now(),
  constraint job_assign_kind check ((kind = 'truck' and truck_id is not null) or (kind in ('driver','crew') and employee_id is not null))
);
create unique index if not exists job_assign_truck_uq on public.job_order_assignments(job_order_id, truck_id) where kind = 'truck';
create unique index if not exists job_assign_emp_uq on public.job_order_assignments(job_order_id, employee_id, kind) where kind <> 'truck';
create index if not exists job_assign_job_idx on public.job_order_assignments(job_order_id);
create index if not exists job_assign_truck_idx on public.job_order_assignments(truck_id);
create index if not exists job_assign_emp_idx on public.job_order_assignments(employee_id);

create table if not exists public.job_order_status_history (
  id uuid primary key default gen_random_uuid(),
  job_order_id uuid not null references public.job_orders(id) on delete cascade,
  from_status text, to_status text not null,
  note text,
  changed_by uuid references public.profiles(id) default public.current_profile_id(),
  changed_at timestamptz not null default now()
);
create index if not exists job_status_history_job_idx on public.job_order_status_history(job_order_id, changed_at);

create table if not exists public.job_order_photos (
  id uuid primary key default gen_random_uuid(),
  job_order_id uuid not null references public.job_orders(id) on delete cascade,
  kind text not null check (kind in ('site','before','after','signature')),
  file_path text not null,
  caption text,
  created_by uuid references public.profiles(id) default public.current_profile_id(),
  created_at timestamptz not null default now()
);
create index if not exists job_photos_job_idx on public.job_order_photos(job_order_id);

create table if not exists public.job_order_actual_costs (
  id uuid primary key default gen_random_uuid(),
  job_order_id uuid not null references public.job_orders(id) on delete cascade,
  category text not null check (category in ('consumable','equipment','labour','vehicle','subcontract','overhead','fuel','other')),
  cost_item_id uuid references public.cost_items(id),
  employee_id uuid references public.employees(id),
  description text not null,
  quantity numeric(12,3) not null default 1 check (quantity >= 0),
  unit_cost numeric(14,2) not null default 0 check (unit_cost >= 0),
  amount numeric(14,2) not null default 0,
  stock_location_id uuid,
  created_by uuid references public.profiles(id) default public.current_profile_id(),
  created_at timestamptz not null default now()
);
create index if not exists job_actual_costs_job_idx on public.job_order_actual_costs(job_order_id);
create index if not exists job_actual_costs_item_idx on public.job_order_actual_costs(cost_item_id);

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'truck_bookings_job_fk') then
    alter table public.truck_bookings add constraint truck_bookings_job_fk foreign key (job_order_id) references public.job_orders(id) on delete cascade;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'employee_bookings_job_fk') then
    alter table public.employee_bookings add constraint employee_bookings_job_fk foreign key (job_order_id) references public.job_orders(id) on delete cascade;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'fuel_logs_job_fk') then
    alter table public.fuel_logs add constraint fuel_logs_job_fk foreign key (job_order_id) references public.job_orders(id) on delete set null;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'estimates_converted_job_fk') then
    alter table public.estimates add constraint estimates_converted_job_fk foreign key (converted_job_id) references public.job_orders(id) on delete set null;
  end if;
end $$;
create index if not exists estimates_converted_job_idx on public.estimates(converted_job_id);
