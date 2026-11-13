-- 0012_notifications.sql : message templates, outbox, in-app notifications and system tables
-- (company settings, document sequences, attachments, comments, public links, audit log).

create table if not exists public.company_settings (
  id int primary key default 1 check (id = 1),
  company_name text not null default 'Your Company Ltd',
  trading_name text,
  logo_url text,
  address text,
  digital_address text,
  tin text,
  phones text,
  email text,
  website text,
  bank_details text,            -- printed on invoices
  momo_details text,            -- e.g. "MTN MoMo Merchant 123456 (Your Company Ltd)"
  payment_details_sms text not null default 'MoMo or bank transfer',
  invoice_terms text,
  invoice_footer text,
  brand_color text not null default '#0F766E',
  sms_sender_id text not null default 'FACILITIES',
  sms_provider text not null default 'hubtel' check (sms_provider in ('hubtel','arkesel','mnotify')),
  email_provider text not null default 'resend' check (email_provider in ('resend','smtp')),
  payment_provider text not null default 'paystack' check (payment_provider in ('paystack','hubtel')),
  online_payments_enabled boolean not null default false,
  public_app_url text not null default 'http://localhost:5173',
  default_payment_terms_days int not null default 7,
  segregation_of_duties boolean not null default true,
  estimate_margin_threshold numeric(6,3) not null default 15,     -- below this margin an estimate needs Manager approval
  contract_margin_threshold numeric(6,3) not null default 10,     -- below this monthly margin the Manager is alerted
  overdue_reminder_days int[] not null default '{3,7,14}',
  survey_expiry_days int not null default 30,
  survey_low_score int not null default 2,
  survey_low_nps int not null default 6,
  fiscal_year_start_month int not null default 1 check (fiscal_year_start_month between 1 and 12),
  lock_date date,
  notifications_enabled jsonb not null default '{}'::jsonb,       -- {"job_approved": true, ...}; missing key = on
  cron_times jsonb not null default '{"service_today":"06:30","recurring_billing":"07:00","morning_alerts":"08:00","zonal_reminder":"17:00","evening":"18:00","nightly":"01:00"}'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists public.document_sequences (
  doc_type text not null,
  year int not null default 0,          -- 0 = not reset by year (e.g. customer codes)
  prefix text not null,
  padding int not null default 5,
  per_year boolean not null default true,
  last_value int not null default 0,
  primary key (doc_type, year)
);

create table if not exists public.notification_templates (
  id uuid primary key default gen_random_uuid(),
  event_code text not null,
  channel text not null check (channel in ('sms','email')),
  name text not null,
  subject text,
  body text not null,
  is_marketing boolean not null default false,
  active boolean not null default true,
  updated_at timestamptz not null default now(),
  unique (event_code, channel)
);

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  event_code text not null,
  channel text not null check (channel in ('sms','email')),
  recipient_name text,
  recipient_phone text,
  recipient_email text,
  recipient_type text check (recipient_type in ('customer','driver','officer','staff','contact')),
  customer_id uuid references public.customers(id),
  profile_id uuid references public.profiles(id),
  subject text,
  body text not null,
  variables jsonb not null default '{}'::jsonb,
  related_type text, related_id uuid,
  is_marketing boolean not null default false,
  status text not null default 'queued' check (status in ('queued','sending','sent','failed','skipped')),
  attempts int not null default 0,
  next_attempt_at timestamptz not null default now(),
  provider text,
  provider_message_id text,
  provider_response jsonb,
  cost numeric(14,4),
  segments int,
  error text,
  sent_at timestamptz,
  dedupe_key text unique,
  created_at timestamptz not null default now()
);
create index if not exists notifications_queue_idx on public.notifications(status, next_attempt_at) where status in ('queued','sending');
create index if not exists notifications_customer_idx on public.notifications(customer_id, created_at desc);
create index if not exists notifications_related_idx on public.notifications(related_type, related_id);
create index if not exists notifications_event_idx on public.notifications(event_code);
create index if not exists notifications_profile_idx on public.notifications(profile_id);

create table if not exists public.in_app_notifications (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  title text not null,
  body text,
  link text,
  severity text not null default 'info' check (severity in ('info','success','warning','danger')),
  read_at timestamptz,
  dedupe_key text,
  created_at timestamptz not null default now(),
  unique (profile_id, dedupe_key)
);
create index if not exists in_app_notifications_profile_idx on public.in_app_notifications(profile_id, created_at desc);

create table if not exists public.attachments (
  id uuid primary key default gen_random_uuid(),
  entity_type text not null,
  entity_id uuid not null,
  bucket text not null,
  file_path text not null,
  file_name text,
  mime_type text,
  size_bytes int,
  uploaded_by uuid references public.profiles(id) default public.current_profile_id(),
  created_at timestamptz not null default now()
);
create index if not exists attachments_entity_idx on public.attachments(entity_type, entity_id);

create table if not exists public.comments (
  id uuid primary key default gen_random_uuid(),
  entity_type text not null check (entity_type in ('customer','job_order','contract','lead','invoice','estimate','truck')),
  entity_id uuid not null,
  body text not null,
  author_id uuid references public.profiles(id) default public.current_profile_id(),
  created_at timestamptz not null default now()
);
create index if not exists comments_entity_idx on public.comments(entity_type, entity_id, created_at);

create table if not exists public.public_links (
  id uuid primary key default gen_random_uuid(),
  token text not null unique default encode(extensions.gen_random_bytes(18), 'hex'),
  doc_type text not null check (doc_type in ('statement')),
  customer_id uuid references public.customers(id),
  params jsonb not null default '{}'::jsonb,
  expires_at timestamptz not null default (now() + interval '30 days'),
  created_by uuid references public.profiles(id) default public.current_profile_id(),
  created_at timestamptz not null default now()
);
create index if not exists public_links_customer_idx on public.public_links(customer_id);

create table if not exists public.audit_log (
  id bigint generated always as identity primary key,
  table_name text not null,
  record_id text,
  action text not null check (action in ('INSERT','UPDATE','DELETE')),
  old_values jsonb,
  new_values jsonb,
  changed_by uuid,
  changed_by_user uuid,
  db_role text default current_user,
  changed_at timestamptz not null default now()
);
create index if not exists audit_log_table_idx on public.audit_log(table_name, changed_at desc);
create index if not exists audit_log_record_idx on public.audit_log(record_id);
create index if not exists audit_log_user_idx on public.audit_log(changed_by, changed_at desc);
create index if not exists audit_log_time_idx on public.audit_log(changed_at desc);
