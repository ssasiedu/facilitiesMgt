-- 0009_accounting.sql : chart of accounts, journals, posting rules, suppliers, bills, expenses, bank accounts.

create table if not exists public.accounts (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  account_type text not null check (account_type in ('asset','liability','equity','income','expense')),
  subtype text,
  parent_id uuid references public.accounts(id),
  service_id uuid references public.services(id),
  is_system boolean not null default false,
  is_active boolean not null default true,
  description text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists accounts_type_idx on public.accounts(account_type);
create index if not exists accounts_parent_idx on public.accounts(parent_id);
create index if not exists accounts_service_idx on public.accounts(service_id);

create table if not exists public.journal_entries (
  id uuid primary key default gen_random_uuid(),
  entry_no text unique,
  entry_date date not null default current_date,
  description text not null,
  source_type text not null default 'manual',
  source_id uuid,
  event_code text,
  status text not null default 'draft' check (status in ('draft','posted')),
  is_manual boolean not null default false,
  reversal_of uuid references public.journal_entries(id),
  reversed_by uuid references public.journal_entries(id),
  recur_frequency text not null default 'none' check (recur_frequency in ('none','monthly','quarterly')),
  next_recur_date date,
  total_debit numeric(14,2) not null default 0,
  total_credit numeric(14,2) not null default 0,
  posted_by uuid references public.profiles(id), posted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.profiles(id) default public.current_profile_id()
);
create index if not exists journal_entries_date_idx on public.journal_entries(entry_date);
create index if not exists journal_entries_source_idx on public.journal_entries(source_type, source_id);
create index if not exists journal_entries_status_idx on public.journal_entries(status);

create table if not exists public.journal_lines (
  id uuid primary key default gen_random_uuid(),
  entry_id uuid not null references public.journal_entries(id) on delete cascade,
  line_no int not null default 1,
  account_id uuid not null references public.accounts(id),
  debit numeric(14,2) not null default 0 check (debit >= 0),
  credit numeric(14,2) not null default 0 check (credit >= 0),
  description text,
  customer_id uuid references public.customers(id),
  supplier_id uuid,
  job_order_id uuid references public.job_orders(id),
  contract_id uuid references public.contracts(id),
  service_id uuid references public.services(id),
  truck_id uuid references public.trucks(id),
  invoice_id uuid references public.invoices(id),
  cleared boolean not null default false,
  cleared_at timestamptz,
  constraint journal_lines_one_side check ((debit = 0) <> (credit = 0))
);
create index if not exists journal_lines_entry_idx on public.journal_lines(entry_id);
create index if not exists journal_lines_account_idx on public.journal_lines(account_id);
create index if not exists journal_lines_customer_idx on public.journal_lines(customer_id);
create index if not exists journal_lines_job_idx on public.journal_lines(job_order_id);
create index if not exists journal_lines_contract_idx on public.journal_lines(contract_id);
create index if not exists journal_lines_service_idx on public.journal_lines(service_id);
create index if not exists journal_lines_truck_idx on public.journal_lines(truck_id);
create index if not exists journal_lines_invoice_idx on public.journal_lines(invoice_id);
create index if not exists journal_lines_supplier_idx on public.journal_lines(supplier_id);

create table if not exists public.posting_rules (
  event_code text primary key,
  description text not null,
  debit_account_id uuid references public.accounts(id),
  credit_account_id uuid references public.accounts(id),
  notes text,
  updated_at timestamptz not null default now()
);
create index if not exists posting_rules_debit_idx on public.posting_rules(debit_account_id);
create index if not exists posting_rules_credit_idx on public.posting_rules(credit_account_id);

create table if not exists public.suppliers (
  id uuid primary key default gen_random_uuid(),
  supplier_code text unique,
  name text not null,
  phone text check (phone ~ '^233[0-9]{9}$'),
  email text, tin text, address text,
  payment_terms_days int not null default 30,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.profiles(id) default public.current_profile_id(),
  archived_at timestamptz
);
create index if not exists suppliers_name_idx on public.suppliers(lower(name));

create table if not exists public.bank_accounts (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  kind text not null check (kind in ('cash','bank','momo')),
  account_id uuid not null references public.accounts(id),
  bank_name text, branch text, account_number text, momo_number text,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);
create index if not exists bank_accounts_account_idx on public.bank_accounts(account_id);

create table if not exists public.bank_transfers (
  id uuid primary key default gen_random_uuid(),
  transfer_no text unique,
  from_bank_account_id uuid not null references public.bank_accounts(id),
  to_bank_account_id uuid not null references public.bank_accounts(id),
  amount numeric(14,2) not null check (amount > 0),
  fee numeric(14,2) not null default 0 check (fee >= 0),
  transfer_date date not null default current_date,
  reference text,
  journal_entry_id uuid references public.journal_entries(id),
  created_by uuid references public.profiles(id) default public.current_profile_id(),
  created_at timestamptz not null default now(),
  constraint bank_transfers_distinct check (from_bank_account_id <> to_bank_account_id)
);
create index if not exists bank_transfers_from_idx on public.bank_transfers(from_bank_account_id);
create index if not exists bank_transfers_to_idx on public.bank_transfers(to_bank_account_id);

create table if not exists public.bills (
  id uuid primary key default gen_random_uuid(),
  bill_no text unique,
  supplier_id uuid not null references public.suppliers(id),
  supplier_ref text,
  bill_date date not null default current_date,
  due_date date,
  status text not null default 'draft' check (status in ('draft','pending_approval','approved','partially_paid','paid','rejected','void')),
  total numeric(14,2) not null default 0,
  amount_paid numeric(14,2) not null default 0,
  balance numeric(14,2) not null default 0,
  job_order_id uuid references public.job_orders(id),
  contract_id uuid references public.contracts(id),
  truck_id uuid references public.trucks(id),
  receipt_path text,
  notes text,
  is_fleet boolean not null default false,
  submitted_at timestamptz,
  approved_by uuid references public.profiles(id), approved_at timestamptz,
  rejection_reason text,
  journal_entry_id uuid references public.journal_entries(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.profiles(id) default public.current_profile_id()
);
create index if not exists bills_supplier_idx on public.bills(supplier_id);
create index if not exists bills_status_idx on public.bills(status);
create index if not exists bills_job_idx on public.bills(job_order_id);
create index if not exists bills_contract_idx on public.bills(contract_id);
create index if not exists bills_truck_idx on public.bills(truck_id);
create index if not exists bills_due_idx on public.bills(due_date);

create table if not exists public.bill_lines (
  id uuid primary key default gen_random_uuid(),
  bill_id uuid not null references public.bills(id) on delete cascade,
  account_id uuid not null references public.accounts(id),
  description text not null,
  cost_item_id uuid references public.cost_items(id),
  quantity numeric(12,3) not null default 1 check (quantity > 0),
  unit_cost numeric(14,2) not null default 0 check (unit_cost >= 0),
  amount numeric(14,2) not null default 0,
  stock_location_id uuid references public.stock_locations(id)
);
create index if not exists bill_lines_bill_idx on public.bill_lines(bill_id);
create index if not exists bill_lines_account_idx on public.bill_lines(account_id);
create index if not exists bill_lines_item_idx on public.bill_lines(cost_item_id);
create index if not exists bill_lines_location_idx on public.bill_lines(stock_location_id);

create table if not exists public.bill_payments (
  id uuid primary key default gen_random_uuid(),
  bill_id uuid not null references public.bills(id),
  payment_date date not null default current_date,
  amount numeric(14,2) not null check (amount > 0),
  bank_account_id uuid not null references public.bank_accounts(id),
  reference text,
  journal_entry_id uuid references public.journal_entries(id),
  created_by uuid references public.profiles(id) default public.current_profile_id(),
  created_at timestamptz not null default now()
);
create index if not exists bill_payments_bill_idx on public.bill_payments(bill_id);
create index if not exists bill_payments_bank_idx on public.bill_payments(bank_account_id);

create table if not exists public.expenses (
  id uuid primary key default gen_random_uuid(),
  expense_no text unique,
  expense_date date not null default current_date,
  account_id uuid not null references public.accounts(id),
  amount numeric(14,2) not null check (amount > 0),
  supplier_id uuid references public.suppliers(id),
  payee text,
  description text not null,
  receipt_path text,
  job_order_id uuid references public.job_orders(id),
  contract_id uuid references public.contracts(id),
  truck_id uuid references public.trucks(id),
  is_fleet boolean not null default false,
  status text not null default 'draft' check (status in ('draft','pending_approval','approved','paid','rejected')),
  submitted_at timestamptz,
  approved_by uuid references public.profiles(id), approved_at timestamptz,
  rejection_reason text,
  paid_from_bank_account_id uuid references public.bank_accounts(id),
  paid_at timestamptz, payment_reference text,
  journal_entry_id uuid references public.journal_entries(id),
  payment_journal_entry_id uuid references public.journal_entries(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.profiles(id) default public.current_profile_id()
);
create index if not exists expenses_account_idx on public.expenses(account_id);
create index if not exists expenses_status_idx on public.expenses(status);
create index if not exists expenses_date_idx on public.expenses(expense_date);
create index if not exists expenses_job_idx on public.expenses(job_order_id);
create index if not exists expenses_contract_idx on public.expenses(contract_id);
create index if not exists expenses_truck_idx on public.expenses(truck_id);
create index if not exists expenses_supplier_idx on public.expenses(supplier_id);
create index if not exists expenses_bank_idx on public.expenses(paid_from_bank_account_id);

create table if not exists public.fiscal_periods (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  start_date date not null,
  end_date date not null,
  is_closed boolean not null default false,
  constraint fiscal_periods_dates check (end_date > start_date)
);

-- deferred foreign keys to accounting objects
do $$ begin
  if not exists (select 1 from pg_constraint where conname='services_revenue_account_fk') then
    alter table public.services add constraint services_revenue_account_fk foreign key (revenue_account_id) references public.accounts(id); end if;
  if not exists (select 1 from pg_constraint where conname='tax_rates_account_fk') then
    alter table public.tax_rates add constraint tax_rates_account_fk foreign key (account_id) references public.accounts(id); end if;
  if not exists (select 1 from pg_constraint where conname='invoice_taxes_account_fk') then
    alter table public.invoice_taxes add constraint invoice_taxes_account_fk foreign key (account_id) references public.accounts(id); end if;
  if not exists (select 1 from pg_constraint where conname='invoice_lines_account_fk') then
    alter table public.invoice_lines add constraint invoice_lines_account_fk foreign key (revenue_account_id) references public.accounts(id); end if;
  if not exists (select 1 from pg_constraint where conname='payment_methods_bank_fk') then
    alter table public.payment_methods add constraint payment_methods_bank_fk foreign key (default_bank_account_id) references public.bank_accounts(id); end if;
  if not exists (select 1 from pg_constraint where conname='payments_bank_fk') then
    alter table public.payments add constraint payments_bank_fk foreign key (bank_account_id) references public.bank_accounts(id); end if;
  if not exists (select 1 from pg_constraint where conname='refunds_bank_fk') then
    alter table public.refunds add constraint refunds_bank_fk foreign key (bank_account_id) references public.bank_accounts(id); end if;
  if not exists (select 1 from pg_constraint where conname='maintenance_bank_fk') then
    alter table public.maintenance_records add constraint maintenance_bank_fk foreign key (paid_from_bank_account_id) references public.bank_accounts(id); end if;
  if not exists (select 1 from pg_constraint where conname='fuel_bank_fk') then
    alter table public.fuel_logs add constraint fuel_bank_fk foreign key (paid_from_bank_account_id) references public.bank_accounts(id); end if;
  if not exists (select 1 from pg_constraint where conname='journal_lines_supplier_fk') then
    alter table public.journal_lines add constraint journal_lines_supplier_fk foreign key (supplier_id) references public.suppliers(id); end if;
  if not exists (select 1 from pg_constraint where conname='invoices_journal_fk') then
    alter table public.invoices add constraint invoices_journal_fk foreign key (journal_entry_id) references public.journal_entries(id); end if;
  if not exists (select 1 from pg_constraint where conname='payments_journal_fk') then
    alter table public.payments add constraint payments_journal_fk foreign key (journal_entry_id) references public.journal_entries(id); end if;
  if not exists (select 1 from pg_constraint where conname='credit_notes_journal_fk') then
    alter table public.credit_notes add constraint credit_notes_journal_fk foreign key (journal_entry_id) references public.journal_entries(id); end if;
  if not exists (select 1 from pg_constraint where conname='maintenance_journal_fk') then
    alter table public.maintenance_records add constraint maintenance_journal_fk foreign key (journal_entry_id) references public.journal_entries(id); end if;
  if not exists (select 1 from pg_constraint where conname='fuel_journal_fk') then
    alter table public.fuel_logs add constraint fuel_journal_fk foreign key (journal_entry_id) references public.journal_entries(id); end if;
end $$;
create index if not exists payment_methods_bank_idx on public.payment_methods(default_bank_account_id);
create index if not exists payments_bank_idx on public.payments(bank_account_id);
create index if not exists tax_rates_account_idx on public.tax_rates(account_id);
create index if not exists invoice_taxes_account_idx on public.invoice_taxes(account_id);
create index if not exists invoice_lines_account_idx on public.invoice_lines(revenue_account_id);
create index if not exists services_revenue_account_idx on public.services(revenue_account_id);
create index if not exists refunds_bank_idx on public.refunds(bank_account_id);
create index if not exists maintenance_bank_idx on public.maintenance_records(paid_from_bank_account_id);
create index if not exists fuel_bank_idx on public.fuel_logs(paid_from_bank_account_id);
