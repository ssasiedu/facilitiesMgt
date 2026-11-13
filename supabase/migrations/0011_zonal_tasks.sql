-- 0011_zonal_tasks.sql : task types, plans, tasks, updates, GPS check-ins, comments, manager follow-ups.

create table if not exists public.task_types (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  active boolean not null default true,
  sort_order int not null default 0
);

create table if not exists public.task_plans (
  id uuid primary key default gen_random_uuid(),
  officer_id uuid not null references public.profiles(id) default public.current_profile_id(),
  zone_id uuid references public.zones(id),
  title text not null,
  period_type text not null default 'week' check (period_type in ('day','week','custom')),
  start_date date not null,
  end_date date not null,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint task_plans_dates check (end_date >= start_date)
);
create index if not exists task_plans_officer_idx on public.task_plans(officer_id, start_date);
create index if not exists task_plans_zone_idx on public.task_plans(zone_id);

create table if not exists public.tasks (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid references public.task_plans(id) on delete cascade,
  officer_id uuid not null references public.profiles(id) default public.current_profile_id(),
  zone_id uuid references public.zones(id),
  task_type_id uuid not null references public.task_types(id),
  title text not null,
  customer_id uuid references public.customers(id),
  lead_id uuid references public.leads(id),
  target_org text,
  contact_name text,
  contact_phone text check (contact_phone ~ '^233[0-9]{9}$'),
  location text,
  planned_date date not null,
  priority text not null default 'normal' check (priority in ('low','normal','high','urgent')),
  expected_outcome text,
  status text not null default 'planned' check (status in ('planned','in_progress','completed','pending','postponed','cancelled')),
  outcome_notes text,
  next_step text,
  follow_up_date date,
  deal_value numeric(14,2) not null default 0 check (deal_value >= 0),
  deal_closed boolean not null default false,
  converted_lead_id uuid references public.leads(id),
  converted_customer_id uuid references public.customers(id),
  converted_job_id uuid references public.job_orders(id),
  last_update_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists tasks_officer_idx on public.tasks(officer_id, planned_date);
create index if not exists tasks_plan_idx on public.tasks(plan_id);
create index if not exists tasks_zone_idx on public.tasks(zone_id);
create index if not exists tasks_status_idx on public.tasks(status);
create index if not exists tasks_type_idx on public.tasks(task_type_id);
create index if not exists tasks_customer_idx on public.tasks(customer_id);
create index if not exists tasks_lead_idx on public.tasks(lead_id);
create index if not exists tasks_conv_lead_idx on public.tasks(converted_lead_id);
create index if not exists tasks_conv_customer_idx on public.tasks(converted_customer_id);
create index if not exists tasks_conv_job_idx on public.tasks(converted_job_id);

create table if not exists public.task_updates (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks(id) on delete cascade,
  client_ref text unique,                 -- idempotency key for updates queued offline
  status text check (status in ('planned','in_progress','completed','pending','postponed','cancelled')),
  notes text,
  next_step text,
  follow_up_date date,
  deal_value numeric(14,2),
  created_by uuid references public.profiles(id) default public.current_profile_id(),
  created_at timestamptz not null default now()
);
create index if not exists task_updates_task_idx on public.task_updates(task_id, created_at);

create table if not exists public.task_checkins (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks(id) on delete cascade,
  officer_id uuid not null references public.profiles(id) default public.current_profile_id(),
  client_ref text unique,
  lat numeric(9,6) not null check (lat between -90 and 90),
  lng numeric(9,6) not null check (lng between -180 and 180),
  accuracy_m numeric(10,2),
  checked_in_at timestamptz not null default now()
);
create index if not exists task_checkins_task_idx on public.task_checkins(task_id);
create index if not exists task_checkins_officer_idx on public.task_checkins(officer_id, checked_in_at);

create table if not exists public.task_comments (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks(id) on delete cascade,
  author_id uuid not null references public.profiles(id) default public.current_profile_id(),
  body text not null,
  created_at timestamptz not null default now()
);
create index if not exists task_comments_task_idx on public.task_comments(task_id, created_at);
create index if not exists task_comments_author_idx on public.task_comments(author_id);

-- Follow-up tasks for managers (low survey scores, loss-making contracts, etc.)
create table if not exists public.followup_tasks (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text,
  source_type text not null,
  source_id uuid,
  customer_id uuid references public.customers(id),
  assigned_role text not null default 'manager',
  assigned_to uuid references public.profiles(id),
  due_date date not null default (current_date + 2),
  status text not null default 'open' check (status in ('open','in_progress','done')),
  resolution text,
  resolved_by uuid references public.profiles(id),
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists followup_tasks_status_idx on public.followup_tasks(status);
create index if not exists followup_tasks_customer_idx on public.followup_tasks(customer_id);
create index if not exists followup_tasks_assigned_idx on public.followup_tasks(assigned_to);
