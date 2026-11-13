-- 0003_customers_leads.sql : customers (individual or company), their contact people and
-- documents, plus the sales pipeline (leads and lead activities).
--
-- Normalisation (phone numbers, display_name, consent dates) is handled by the triggers in
-- 0014 so that every write path — browser, import, workflow function — goes through the
-- same code.

create table if not exists public.customers (
  id uuid primary key default gen_random_uuid(),
  customer_code text unique,
  customer_type text not null default 'individual' check (customer_type in ('individual', 'company')),
  display_name text,

  -- individual
  title text,
  first_name text,
  middle_name text,
  last_name text,
  gender text check (gender is null or gender in ('male', 'female', 'other')),
  birth_day smallint check (birth_day is null or birth_day between 1 and 31),
  birth_month smallint check (birth_month is null or birth_month between 1 and 12),
  birth_year smallint check (birth_year is null or birth_year between 1900 and 2200),
  ghana_card_no text check (ghana_card_no is null or ghana_card_no ~ '^GHA-[0-9]{9}-[0-9]$'),
  ghana_card_front_path text,
  ghana_card_back_path text,
  photo_path text,
  phone text,
  alt_phone text,
  whatsapp text,
  email text,
  occupation text,
  residential_address text,

  -- company
  company_name text,
  trading_name text,
  registration_no text,
  tin text,
  sector text,
  company_phone text,
  company_email text,
  logo_path text,

  -- both
  digital_address text,
  region text,
  district text,
  zone_id uuid references public.zones(id) on delete set null,
  source text not null default 'call_in'
    check (source in ('call_in', 'walk_in', 'sales_field', 'zonal_officer', 'referral', 'website')),
  assigned_to uuid references public.profiles(id) on delete set null,
  preferred_channel text not null default 'sms' check (preferred_channel in ('sms', 'email', 'whatsapp')),
  sms_opt_in boolean not null default true,
  marketing_consent boolean not null default false,
  marketing_consent_at timestamptz,
  credit_limit numeric(14,2) not null default 0 check (credit_limit >= 0),
  payment_terms_days int not null default 14 check (payment_terms_days between 0 and 365),
  tags text[] not null default '{}',
  notes text,
  status text not null default 'active' check (status in ('active', 'inactive', 'blacklisted')),
  registered_on date not null default current_date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.profiles(id) on delete set null,
  archived_at timestamptz,

  constraint customers_name_chk check (
    (customer_type = 'individual' and coalesce(btrim(first_name), '') <> '' and coalesce(btrim(last_name), '') <> '')
    or (customer_type = 'company' and coalesce(btrim(company_name), '') <> '')
  ),
  constraint customers_digital_address_chk check (
    digital_address is null or digital_address ~ '^[A-Z]{2}-[0-9]{3,4}-[0-9]{3,4}$'
  )
);
create unique index if not exists customers_ghana_card_uq
  on public.customers (ghana_card_no) where ghana_card_no is not null and archived_at is null;
create index if not exists customers_phone_idx on public.customers (phone);
create index if not exists customers_company_phone_idx on public.customers (company_phone);
create index if not exists customers_email_idx on public.customers (lower(email));
create index if not exists customers_company_email_idx on public.customers (lower(company_email));
create index if not exists customers_tin_idx on public.customers (tin) where tin is not null;
create index if not exists customers_zone_idx on public.customers (zone_id);
create index if not exists customers_assigned_idx on public.customers (assigned_to);
create index if not exists customers_created_by_idx on public.customers (created_by);
create index if not exists customers_status_idx on public.customers (status) where archived_at is null;
create index if not exists customers_type_idx on public.customers (customer_type);
create index if not exists customers_birthday_idx on public.customers (birth_month, birth_day)
  where birth_month is not null and birth_day is not null;
create index if not exists customers_name_trgm on public.customers using gin (display_name extensions.gin_trgm_ops);
create index if not exists customers_code_trgm on public.customers using gin (customer_code extensions.gin_trgm_ops);

create table if not exists public.customer_contacts (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers(id) on delete cascade,
  name text not null check (btrim(name) <> ''),
  position text,
  phone text,
  email text,
  ghana_card_no text check (ghana_card_no is null or ghana_card_no ~ '^GHA-[0-9]{9}-[0-9]$'),
  is_primary boolean not null default false,
  receives_invoices boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists customer_contacts_customer_idx on public.customer_contacts (customer_id);
create index if not exists customer_contacts_phone_idx on public.customer_contacts (phone);
-- one primary contact per customer: the trigger in 0014 demotes the others on write
create index if not exists customer_contacts_primary_idx
  on public.customer_contacts (customer_id) where is_primary;

create table if not exists public.customer_documents (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers(id) on delete cascade,
  doc_type text not null check (doc_type in
    ('ghana_card_front', 'ghana_card_back', 'passport_photo', 'logo', 'registration', 'contract', 'other')),
  file_path text not null,
  file_name text,
  mime_type text check (mime_type is null or mime_type in ('image/jpeg', 'image/png', 'application/pdf')),
  size_bytes int check (size_bytes is null or size_bytes <= 5 * 1024 * 1024),
  uploaded_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists customer_documents_customer_idx on public.customer_documents (customer_id);
create index if not exists customer_documents_type_idx on public.customer_documents (customer_id, doc_type);

-- =====================================================================================
-- Leads and pipeline
-- =====================================================================================
create table if not exists public.leads (
  id uuid primary key default gen_random_uuid(),
  name text not null check (btrim(name) <> ''),
  company_name text,
  phone text,
  email text,
  service_id uuid,                       -- FK added in 0004, once services exists
  source text not null default 'call_in'
    check (source in ('call_in', 'walk_in', 'sales_field', 'zonal_officer', 'referral', 'website')),
  location text,
  zone_id uuid references public.zones(id) on delete set null,
  estimated_value numeric(14,2) not null default 0 check (estimated_value >= 0),
  owner_id uuid references public.profiles(id) on delete set null,
  stage text not null default 'new'
    check (stage in ('new', 'contacted', 'site_visit', 'estimate_sent', 'negotiation', 'won', 'lost')),
  lost_reason text,
  next_follow_up date,
  notes text,
  customer_id uuid references public.customers(id) on delete set null,
  won_at timestamptz,
  lost_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.profiles(id) on delete set null,
  archived_at timestamptz,
  -- "Lost requires a reason" (spec 4.2)
  constraint leads_lost_reason_chk check (stage <> 'lost' or coalesce(btrim(lost_reason), '') <> '')
);
create index if not exists leads_owner_idx on public.leads (owner_id);
create index if not exists leads_stage_idx on public.leads (stage) where archived_at is null;
create index if not exists leads_follow_up_idx on public.leads (next_follow_up)
  where next_follow_up is not null and archived_at is null;
create index if not exists leads_zone_idx on public.leads (zone_id);
create index if not exists leads_service_idx on public.leads (service_id);
create index if not exists leads_customer_idx on public.leads (customer_id);
create index if not exists leads_created_by_idx on public.leads (created_by);
create index if not exists leads_phone_idx on public.leads (phone);
create index if not exists leads_name_trgm on public.leads using gin (name extensions.gin_trgm_ops);

create table if not exists public.lead_activities (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads(id) on delete cascade,
  activity_type text not null check (activity_type in ('call', 'visit', 'meeting', 'email', 'sms', 'note')),
  activity_at timestamptz not null default now(),
  outcome text,
  notes text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists lead_activities_lead_idx on public.lead_activities (lead_id, activity_at desc);
create index if not exists lead_activities_created_by_idx on public.lead_activities (created_by);
