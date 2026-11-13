-- 0010_surveys.sql : survey builder, invitations (token links), responses and answers.

create table if not exists public.surveys (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  intro_text text,
  thank_you_text text,
  service_ids uuid[] not null default '{}',     -- empty = all services
  is_default boolean not null default false,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.profiles(id) default public.current_profile_id(),
  archived_at timestamptz
);
create unique index if not exists surveys_one_default on public.surveys(is_default) where is_default;

create table if not exists public.survey_questions (
  id uuid primary key default gen_random_uuid(),
  survey_id uuid not null references public.surveys(id) on delete cascade,
  position int not null default 0,
  question_type text not null check (question_type in ('star','nps','choice','yes_no','text')),
  question_text text not null,
  options jsonb not null default '[]',
  required boolean not null default true,
  metric_key text check (metric_key in ('overall','punctuality','professionalism','quality','nps','comments'))
);
create index if not exists survey_questions_survey_idx on public.survey_questions(survey_id, position);

create table if not exists public.survey_invitations (
  id uuid primary key default gen_random_uuid(),
  token text not null unique default encode(extensions.gen_random_bytes(18), 'hex'),
  survey_id uuid not null references public.surveys(id),
  customer_id uuid not null references public.customers(id),
  invoice_id uuid references public.invoices(id),
  job_order_id uuid references public.job_orders(id),
  payment_id uuid references public.payments(id),
  status text not null default 'sent' check (status in ('sent','responded','expired')),
  sent_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '30 days'),
  responded_at timestamptz
);
create unique index if not exists survey_invitations_invoice_uq on public.survey_invitations(invoice_id) where invoice_id is not null;
create index if not exists survey_invitations_customer_idx on public.survey_invitations(customer_id);
create index if not exists survey_invitations_survey_idx on public.survey_invitations(survey_id);
create index if not exists survey_invitations_job_idx on public.survey_invitations(job_order_id);
create index if not exists survey_invitations_payment_idx on public.survey_invitations(payment_id);

create table if not exists public.survey_responses (
  id uuid primary key default gen_random_uuid(),
  invitation_id uuid not null unique references public.survey_invitations(id),
  survey_id uuid not null references public.surveys(id),
  customer_id uuid not null references public.customers(id),
  job_order_id uuid references public.job_orders(id),
  invoice_id uuid references public.invoices(id),
  service_id uuid references public.services(id),
  officer_id uuid references public.profiles(id),
  driver_id uuid references public.employees(id),
  truck_id uuid references public.trucks(id),
  csat numeric(4,2),            -- average of star questions (1–5)
  overall_score int,
  nps_score int check (nps_score between 0 and 10),
  comments text,
  is_low boolean not null default false,
  submitted_at timestamptz not null default now()
);
create index if not exists survey_responses_survey_idx on public.survey_responses(survey_id);
create index if not exists survey_responses_customer_idx on public.survey_responses(customer_id);
create index if not exists survey_responses_service_idx on public.survey_responses(service_id);
create index if not exists survey_responses_officer_idx on public.survey_responses(officer_id);
create index if not exists survey_responses_driver_idx on public.survey_responses(driver_id);
create index if not exists survey_responses_truck_idx on public.survey_responses(truck_id);
create index if not exists survey_responses_job_idx on public.survey_responses(job_order_id);
create index if not exists survey_responses_invoice_idx on public.survey_responses(invoice_id);
create index if not exists survey_responses_date_idx on public.survey_responses(submitted_at);

create table if not exists public.survey_answers (
  id uuid primary key default gen_random_uuid(),
  response_id uuid not null references public.survey_responses(id) on delete cascade,
  question_id uuid not null references public.survey_questions(id),
  rating int,
  choice text,
  bool_value boolean,
  text_value text
);
create index if not exists survey_answers_response_idx on public.survey_answers(response_id);
create index if not exists survey_answers_question_idx on public.survey_answers(question_id);
