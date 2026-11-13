-- 0008_billing.sql : taxes, payment methods, invoices, payments, allocations, receipts, credit notes, customer credits.

create table if not exists public.tax_rates (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  rate numeric(6,3) not null default 0 check (rate >= 0 and rate <= 100),
  compound boolean not null default false,   -- compound taxes are charged on (taxable amount + non-compound taxes)
  account_id uuid,
  active boolean not null default false,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.payment_methods (
  code text primary key,
  name text not null,
  default_bank_account_id uuid,
  requires_reference boolean not null default false,
  active boolean not null default true,
  sort_order int not null default 0
);

create table if not exists public.invoices (
  id uuid primary key default gen_random_uuid(),
  invoice_no text unique,
  source text not null default 'manual' check (source in ('job','contract','manual')),
  customer_id uuid not null references public.customers(id),
  customer_name text,
  job_order_id uuid references public.job_orders(id),
  contract_id uuid references public.contracts(id),
  period_start date, period_end date,
  issue_date date not null default current_date,
  due_date date,
  status text not null default 'draft' check (status in ('draft','issued','due','partially_paid','paid','overdue','void')),
  subtotal numeric(14,2) not null default 0,
  discount_total numeric(14,2) not null default 0,
  taxable_amount numeric(14,2) not null default 0,
  tax_total numeric(14,2) not null default 0,
  total numeric(14,2) not null default 0,
  amount_paid numeric(14,2) not null default 0,
  amount_credited numeric(14,2) not null default 0,
  balance numeric(14,2) not null default 0,
  revenue_deferred boolean not null default false,    -- job invoices: true until the job is completed
  revenue_recognised_at timestamptz,
  public_token text not null unique default encode(extensions.gen_random_bytes(18), 'hex'),
  notes text, terms text,
  journal_entry_id uuid,
  issued_at timestamptz, issued_by uuid references public.profiles(id),
  overdue_reminders_sent int[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.profiles(id) default public.current_profile_id(),
  constraint invoices_contract_period_uq unique (contract_id, period_start),
  constraint invoices_balance_nonneg check (balance >= 0)
);
create index if not exists invoices_customer_idx on public.invoices(customer_id);
create index if not exists invoices_status_idx on public.invoices(status);
create index if not exists invoices_due_idx on public.invoices(due_date);
create index if not exists invoices_issue_idx on public.invoices(issue_date);
create index if not exists invoices_job_idx on public.invoices(job_order_id);
create index if not exists invoices_contract_idx on public.invoices(contract_id);

create table if not exists public.invoice_lines (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.invoices(id) on delete cascade,
  service_id uuid references public.services(id),
  description text not null,
  quantity numeric(12,3) not null default 1 check (quantity > 0),
  unit_price numeric(14,2) not null default 0 check (unit_price >= 0),
  discount numeric(14,2) not null default 0 check (discount >= 0),
  taxable boolean not null default true,
  line_total numeric(14,2) not null default 0,
  revenue_account_id uuid,
  sort_order int not null default 0
);
create index if not exists invoice_lines_invoice_idx on public.invoice_lines(invoice_id);
create index if not exists invoice_lines_service_idx on public.invoice_lines(service_id);

create table if not exists public.invoice_taxes (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.invoices(id) on delete cascade,
  tax_rate_id uuid references public.tax_rates(id),
  name text not null,
  rate numeric(6,3) not null,
  compound boolean not null default false,
  base_amount numeric(14,2) not null,
  amount numeric(14,2) not null,
  account_id uuid
);
create index if not exists invoice_taxes_invoice_idx on public.invoice_taxes(invoice_id);
create index if not exists invoice_taxes_rate_idx on public.invoice_taxes(tax_rate_id);

create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  payment_no text unique,
  customer_id uuid not null references public.customers(id),
  payment_date date not null default current_date,
  amount numeric(14,2) not null check (amount > 0),
  method_code text not null references public.payment_methods(code),
  reference text,
  bank_account_id uuid,
  notes text,
  provider text,
  provider_ref text unique,
  status text not null default 'posted' check (status in ('posted','reversed')),
  allocated_amount numeric(14,2) not null default 0,
  unallocated_amount numeric(14,2) not null default 0,
  journal_entry_id uuid,
  recorded_by uuid references public.profiles(id) default public.current_profile_id(),
  created_at timestamptz not null default now()
);
create index if not exists payments_customer_idx on public.payments(customer_id);
create index if not exists payments_date_idx on public.payments(payment_date);
create index if not exists payments_method_idx on public.payments(method_code);

create table if not exists public.payment_allocations (
  id uuid primary key default gen_random_uuid(),
  payment_id uuid not null references public.payments(id),
  invoice_id uuid not null references public.invoices(id),
  amount numeric(14,2) not null check (amount > 0),
  created_at timestamptz not null default now()
);
create index if not exists payment_allocations_payment_idx on public.payment_allocations(payment_id);
create index if not exists payment_allocations_invoice_idx on public.payment_allocations(invoice_id);

create table if not exists public.receipts (
  id uuid primary key default gen_random_uuid(),
  receipt_no text unique,
  payment_id uuid not null unique references public.payments(id),
  customer_id uuid not null references public.customers(id),
  amount numeric(14,2) not null,
  public_token text not null unique default encode(extensions.gen_random_bytes(18), 'hex'),
  issued_at timestamptz not null default now()
);
create index if not exists receipts_customer_idx on public.receipts(customer_id);

create table if not exists public.credit_notes (
  id uuid primary key default gen_random_uuid(),
  credit_note_no text unique,
  invoice_id uuid not null references public.invoices(id),
  customer_id uuid not null references public.customers(id),
  amount numeric(14,2) not null check (amount > 0),
  tax_amount numeric(14,2) not null default 0,
  reason text not null,
  issue_date date not null default current_date,
  journal_entry_id uuid,
  issued_by uuid references public.profiles(id) default public.current_profile_id(),
  created_at timestamptz not null default now()
);
create index if not exists credit_notes_invoice_idx on public.credit_notes(invoice_id);
create index if not exists credit_notes_customer_idx on public.credit_notes(customer_id);

create table if not exists public.customer_credits (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers(id),
  source_type text not null check (source_type in ('overpayment','credit_note')),
  payment_id uuid references public.payments(id),
  credit_note_id uuid references public.credit_notes(id),
  amount numeric(14,2) not null check (amount > 0),
  amount_used numeric(14,2) not null default 0 check (amount_used >= 0),
  created_at timestamptz not null default now(),
  constraint customer_credits_used check (amount_used <= amount)
);
create index if not exists customer_credits_customer_idx on public.customer_credits(customer_id);
create index if not exists customer_credits_payment_idx on public.customer_credits(payment_id);
create index if not exists customer_credits_cn_idx on public.customer_credits(credit_note_id);

create table if not exists public.customer_credit_applications (
  id uuid primary key default gen_random_uuid(),
  credit_id uuid not null references public.customer_credits(id),
  invoice_id uuid not null references public.invoices(id),
  amount numeric(14,2) not null check (amount > 0),
  journal_entry_id uuid,
  applied_by uuid references public.profiles(id) default public.current_profile_id(),
  applied_at timestamptz not null default now()
);
create index if not exists credit_apps_credit_idx on public.customer_credit_applications(credit_id);
create index if not exists credit_apps_invoice_idx on public.customer_credit_applications(invoice_id);

create table if not exists public.refunds (
  id uuid primary key default gen_random_uuid(),
  refund_no text unique,
  credit_id uuid not null references public.customer_credits(id),
  customer_id uuid not null references public.customers(id),
  amount numeric(14,2) not null check (amount > 0),
  refund_date date not null default current_date,
  method_code text references public.payment_methods(code),
  bank_account_id uuid,
  reference text,
  journal_entry_id uuid,
  created_by uuid references public.profiles(id) default public.current_profile_id(),
  created_at timestamptz not null default now()
);
create index if not exists refunds_credit_idx on public.refunds(credit_id);
create index if not exists refunds_customer_idx on public.refunds(customer_id);

-- online "Pay now" checkout sessions (reference sent to Paystack/Hubtel, matched again by the webhook)
create table if not exists public.payment_sessions (
  reference text primary key,
  provider text not null check (provider in ('paystack','hubtel')),
  invoice_id uuid not null references public.invoices(id),
  amount numeric(14,2) not null check (amount > 0),
  status text not null default 'pending' check (status in ('pending','paid','failed')),
  payment_id uuid references public.payments(id),
  created_at timestamptz not null default now(),
  completed_at timestamptz
);
create index if not exists payment_sessions_invoice_idx on public.payment_sessions(invoice_id);
create index if not exists payment_sessions_payment_idx on public.payment_sessions(payment_id);

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'job_orders_invoice_fk') then
    alter table public.job_orders add constraint job_orders_invoice_fk foreign key (invoice_id) references public.invoices(id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'contract_billing_periods_invoice_fk') then
    alter table public.contract_billing_periods add constraint contract_billing_periods_invoice_fk foreign key (invoice_id) references public.invoices(id);
  end if;
end $$;
