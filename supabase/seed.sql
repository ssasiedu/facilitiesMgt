-- seed.sql : reference data for FacilitiesManagement, followed by an optional DEMO block.
-- Run after all migrations (supabase db push runs it automatically with `supabase db reset`; otherwise paste it into the SQL editor).
-- Re-runnable: reference rows use ON CONFLICT DO NOTHING / UPDATE.

begin;

-- ---------------------------------------------------------------------------
-- Roles
-- ---------------------------------------------------------------------------
insert into public.roles (code, name, description, sort_order) values
  ('super_admin', 'Super Admin', 'Everything, including users, settings, templates and the chart of accounts', 1),
  ('manager', 'Manager', 'Approves job orders, estimates, contracts and expenses; sees all operations', 2),
  ('ops_officer', 'Operations Officer', 'Raises job orders, assigns trucks and dates, starts and completes jobs, records supplies', 3),
  ('sales_exec', 'Sales Executive', 'Leads, customers, estimates, quotes and job orders', 4),
  ('zonal_officer', 'Zonal Officer', 'Own task plans and leads in their zone', 5),
  ('accountant', 'Accountant', 'Invoices, payments, receipts, expenses, journals and financial reports', 6),
  ('fleet_manager', 'Fleet Manager', 'Trucks, drivers, truck status, maintenance and fuel', 7),
  ('driver', 'Driver', 'Own assigned jobs from a mobile view', 8),
  ('executive', 'Executive (view only)', 'Dashboard and all reports, read only', 9)
on conflict (code) do update set name = excluded.name, description = excluded.description, sort_order = excluded.sort_order;

-- ---------------------------------------------------------------------------
-- Company settings and document numbering
-- ---------------------------------------------------------------------------
insert into public.company_settings (id, company_name, address, phones, email, bank_details, momo_details, payment_details_sms, invoice_terms, invoice_footer)
values (1, 'Your Company Ltd', 'Accra, Ghana', '+233 30 000 0000', 'accounts@example.com',
  'Bank: [Your bank] · Account name: Your Company Ltd · Account no.: [0000000000] · Branch: [Branch]',
  'MTN MoMo Merchant: [000000] (Your Company Ltd)', 'MoMo [000000] or bank transfer',
  'Payment is due within the agreed payment terms. Please quote the invoice number with your payment.',
  'Thank you for your business.')
on conflict (id) do nothing;

insert into public.document_sequences (doc_type, year, prefix, padding, per_year) values
  ('customer', 0, 'CUS', 5, false), ('job_order', 0, 'JO', 5, true), ('invoice', 0, 'INV', 5, true), ('receipt', 0, 'RCP', 5, true),
  ('estimate', 0, 'EST', 5, true), ('contract', 0, 'CTR', 5, true), ('quotation', 0, 'QUO', 5, true), ('credit_note', 0, 'CN', 5, true),
  ('payment', 0, 'PAY', 5, true), ('journal', 0, 'JNL', 6, true), ('bill', 0, 'BILL', 5, true), ('expense', 0, 'EXP', 5, true),
  ('employee', 0, 'EMP', 4, false), ('supplier', 0, 'SUP', 4, false), ('refund', 0, 'RFD', 5, true), ('transfer', 0, 'TRF', 5, true)
on conflict (doc_type, year) do nothing;

-- ---------------------------------------------------------------------------
-- Chart of accounts (Ghana SME)
-- ---------------------------------------------------------------------------
insert into public.accounts (code, name, account_type, subtype, is_system) values
  ('1000', 'Cash on hand', 'asset', 'cash', true),
  ('1010', 'Main bank account', 'asset', 'bank', true),
  ('1020', 'Mobile Money wallet', 'asset', 'momo', true),
  ('1100', 'Accounts receivable', 'asset', 'receivable', true),
  ('1200', 'Consumables inventory', 'asset', 'inventory', true),
  ('1300', 'Prepayments', 'asset', 'current', true),
  ('1500', 'Vehicles', 'asset', 'fixed', true),
  ('1510', 'Equipment', 'asset', 'fixed', true),
  ('1590', 'Accumulated depreciation', 'asset', 'contra', true),
  ('2000', 'Accounts payable', 'liability', 'payable', true),
  ('2100', 'Deferred revenue', 'liability', 'deferred_revenue', true),
  ('2200', 'VAT payable', 'liability', 'tax', true),
  ('2210', 'NHIL payable', 'liability', 'tax', true),
  ('2220', 'GETFund levy payable', 'liability', 'tax', true),
  ('2300', 'Withholding tax payable', 'liability', 'tax', true),
  ('2400', 'SSNIT payable', 'liability', 'payroll', true),
  ('2500', 'Accruals', 'liability', 'current', true),
  ('2600', 'Customer credits and deposits', 'liability', 'customer_credit', true),
  ('3000', 'Capital', 'equity', 'capital', true),
  ('3100', 'Retained earnings', 'equity', 'retained', true),
  ('4010', 'Janitorial service revenue', 'income', 'service', true),
  ('4020', 'Event cleaning revenue', 'income', 'service', true),
  ('4030', 'Water supply revenue', 'income', 'service', true),
  ('4040', 'Mobile cabin rental revenue', 'income', 'service', true),
  ('4050', 'Cesspit emptying revenue', 'income', 'service', true),
  ('4060', 'Landscaping and beautification revenue', 'income', 'service', true),
  ('4100', 'Contract revenue', 'income', 'contract', true),
  ('4900', 'Other income', 'income', 'other', true),
  ('5010', 'Consumables', 'expense', 'direct', true),
  ('5020', 'Direct labour', 'expense', 'direct', true),
  ('5030', 'Fuel', 'expense', 'direct', true),
  ('5040', 'Vehicle maintenance', 'expense', 'direct', true),
  ('5050', 'Subcontractors', 'expense', 'direct', true),
  ('6010', 'Salaries and wages', 'expense', 'overhead', true),
  ('6020', 'Rent', 'expense', 'overhead', true),
  ('6030', 'Utilities', 'expense', 'overhead', true),
  ('6040', 'SMS and communication', 'expense', 'overhead', true),
  ('6050', 'Depreciation', 'expense', 'overhead', true),
  ('6060', 'Bank and MoMo charges', 'expense', 'overhead', true),
  ('6090', 'General and administrative expenses', 'expense', 'overhead', true)
on conflict (code) do nothing;

insert into public.bank_accounts (name, kind, account_id) values
  ('Cash on hand', 'cash', public.account_by_code('1000')),
  ('Main bank account', 'bank', public.account_by_code('1010')),
  ('Mobile Money wallet', 'momo', public.account_by_code('1020'))
on conflict (name) do nothing;

insert into public.payment_methods (code, name, default_bank_account_id, requires_reference, sort_order) values
  ('cash', 'Cash', (select id from public.bank_accounts where name = 'Cash on hand'), false, 1),
  ('mtn_momo', 'MTN MoMo', (select id from public.bank_accounts where name = 'Mobile Money wallet'), true, 2),
  ('telecel_cash', 'Telecel Cash', (select id from public.bank_accounts where name = 'Mobile Money wallet'), true, 3),
  ('at_money', 'AT Money', (select id from public.bank_accounts where name = 'Mobile Money wallet'), true, 4),
  ('bank_transfer', 'Bank Transfer', (select id from public.bank_accounts where name = 'Main bank account'), true, 5),
  ('cheque', 'Cheque', (select id from public.bank_accounts where name = 'Main bank account'), true, 6),
  ('card', 'Card', (select id from public.bank_accounts where name = 'Main bank account'), false, 7)
on conflict (code) do nothing;

-- Tax placeholders: inactive with rate 0 until an admin confirms current GRA rates in Settings > Taxes.
insert into public.tax_rates (code, name, rate, compound, account_id, active, sort_order) values
  ('NHIL', 'NHIL', 0, false, public.account_by_code('2210'), false, 1),
  ('GETFUND', 'GETFund levy', 0, false, public.account_by_code('2220'), false, 2),
  ('VAT', 'VAT', 0, false, public.account_by_code('2200'), false, 3)
on conflict (code) do nothing;

-- Posting rules: which accounts each event uses (editable in Finance > Posting rules)
insert into public.posting_rules (event_code, description, debit_account_id, credit_account_id, notes) values
  ('job_approved', 'Job order approved: invoice issued, revenue deferred', public.account_by_code('1100'), public.account_by_code('2100'), 'Dr Accounts receivable / Cr Deferred revenue (tax lines go to their tax accounts)'),
  ('job_completed', 'Job completed: revenue recognised', public.account_by_code('2100'), public.account_by_code('4900'), 'Dr Deferred revenue / Cr the service revenue account (falls back to this credit account)'),
  ('contract_invoice', 'Recurring contract period billed', public.account_by_code('1100'), public.account_by_code('4100'), 'Dr Accounts receivable / Cr Contract revenue'),
  ('manual_invoice', 'Manual invoice issued', public.account_by_code('1100'), public.account_by_code('4900'), 'Dr Accounts receivable / Cr service revenue (or Other income)'),
  ('invoice_tax', 'Tax on invoices (fallback account)', null, public.account_by_code('2200'), 'Cr each tax''s own account; this is the fallback'),
  ('payment_received', 'Customer payment', public.account_by_code('1010'), public.account_by_code('1100'), 'Dr the cash/bank/MoMo account received into / Cr Accounts receivable'),
  ('customer_overpayment', 'Overpayment held as customer credit', public.account_by_code('1010'), public.account_by_code('2600'), 'Dr cash/bank / Cr Customer credits'),
  ('credit_applied', 'Customer credit applied to an invoice', public.account_by_code('2600'), public.account_by_code('1100'), 'Dr Customer credits / Cr Accounts receivable'),
  ('credit_note', 'Credit note', public.account_by_code('4900'), public.account_by_code('1100'), 'Dr revenue (or Deferred revenue before completion) and tax / Cr Accounts receivable'),
  ('refund', 'Refund of customer credit', public.account_by_code('2600'), public.account_by_code('1010'), 'Dr Customer credits / Cr the cash/bank account paid from'),
  ('bill_approved', 'Supplier bill approved', null, public.account_by_code('2000'), 'Dr each bill line''s expense account (or Inventory for stocked items) / Cr Accounts payable'),
  ('bill_paid', 'Supplier bill paid', public.account_by_code('2000'), public.account_by_code('1010'), 'Dr Accounts payable / Cr the cash/bank account paid from'),
  ('expense_approved', 'Expense approved', null, public.account_by_code('2000'), 'Dr the expense account / Cr Accounts payable'),
  ('expense_paid', 'Expense paid', public.account_by_code('2000'), public.account_by_code('1010'), 'Dr Accounts payable / Cr the cash/bank account paid from'),
  ('stock_receipt', 'Stock received on a bill', public.account_by_code('1200'), public.account_by_code('2000'), 'Dr Consumables inventory / Cr Accounts payable'),
  ('stock_issue', 'Stock issued to a contract or job', public.account_by_code('5010'), public.account_by_code('1200'), 'Dr Consumables / Cr Consumables inventory'),
  ('maintenance', 'Vehicle maintenance record', public.account_by_code('5040'), public.account_by_code('2000'), 'Dr Vehicle maintenance / Cr Accounts payable (or the account it was paid from)'),
  ('fuel_purchase', 'Fuel log', public.account_by_code('5030'), public.account_by_code('1000'), 'Dr Fuel / Cr Cash on hand (or the account it was paid from)'),
  ('bank_charges', 'Transfer fees', public.account_by_code('6060'), public.account_by_code('1010'), 'Dr Bank and MoMo charges / Cr the source account'),
  ('bank_transfer', 'Transfer between accounts', null, null, 'Dr destination / Cr source'),
  ('manual', 'Manual journal', null, null, 'Entered by an Accountant; must balance')
on conflict (event_code) do nothing;

-- ---------------------------------------------------------------------------
-- Services
-- ---------------------------------------------------------------------------
insert into public.services (code, name, description, unit_of_measure, default_price, taxable, requires_truck, required_truck_type, revenue_account_id) values
  ('JAN', 'Janitorial Service', 'Routine office, school and residential cleaning', 'per_visit', 350, true, false, null, public.account_by_code('4010')),
  ('EVT', 'Event Cleaning', 'Before, during and after-event cleaning', 'per_event', 1500, true, false, null, public.account_by_code('4020')),
  ('WAT', 'Supply of Water', 'Potable water delivery by tanker', 'per_trip', 800, true, true, 'water_tanker', public.account_by_code('4030')),
  ('CAB', 'Rental of Mobile Cabins', 'Mobile toilet cabins delivered, serviced and collected', 'per_cabin_per_day', 250, true, true, 'cabin_carrier', public.account_by_code('4040')),
  ('CES', 'Cesspit Emptier Service', 'Septic tank and cesspit emptying', 'per_trip', 1200, true, true, 'cesspit_emptier', public.account_by_code('4050')),
  ('LAN', 'Landscaping and Beautification', 'Lawn, hedge, planting and grounds beautification', 'per_m2', 45, true, false, null, public.account_by_code('4060'))
on conflict (code) do nothing;
update public.accounts a set service_id = s.id from public.services s where s.revenue_account_id = a.id and a.service_id is null;

-- ---------------------------------------------------------------------------
-- Cost item catalogue (GHS)
-- ---------------------------------------------------------------------------
insert into public.cost_items (code, name, category, unit_of_measure, unit_cost, rate_basis, cost_per_trip, cost_per_km, cost_per_day, truck_type, preferred_supplier, track_stock, reorder_level) values
  ('CON-DET', 'Liquid detergent (5 L)', 'consumable', 'gallon', 85, 'day', 0, 0, 0, null, 'Accra Cleaning Supplies', true, 10),
  ('CON-DIS', 'Disinfectant (5 L)', 'consumable', 'gallon', 120, 'day', 0, 0, 0, null, 'Accra Cleaning Supplies', true, 10),
  ('CON-BLE', 'Bleach (5 L)', 'consumable', 'gallon', 60, 'day', 0, 0, 0, null, 'Accra Cleaning Supplies', true, 8),
  ('CON-GLS', 'Glass cleaner (1 L)', 'consumable', 'bottle', 35, 'day', 0, 0, 0, null, 'Accra Cleaning Supplies', true, 10),
  ('CON-AIR', 'Air freshener (can)', 'consumable', 'can', 25, 'day', 0, 0, 0, null, 'Accra Cleaning Supplies', true, 12),
  ('CON-TRL', 'Toilet rolls (pack of 10)', 'consumable', 'pack', 45, 'day', 0, 0, 0, null, 'Makola Wholesale', true, 20),
  ('CON-HTW', 'Paper hand towels (pack)', 'consumable', 'pack', 30, 'day', 0, 0, 0, null, 'Makola Wholesale', true, 15),
  ('CON-SOP', 'Liquid hand soap (5 L)', 'consumable', 'gallon', 70, 'day', 0, 0, 0, null, 'Accra Cleaning Supplies', true, 6),
  ('CON-BIN', 'Bin liners (roll of 20)', 'consumable', 'roll', 40, 'day', 0, 0, 0, null, 'Makola Wholesale', true, 15),
  ('CON-MOP', 'Mop head', 'consumable', 'each', 25, 'day', 0, 0, 0, null, 'Accra Cleaning Supplies', true, 10),
  ('CON-BRM', 'Broom', 'consumable', 'each', 20, 'day', 0, 0, 0, null, 'Makola Wholesale', true, 10),
  ('CON-GLV', 'Rubber gloves (pair)', 'consumable', 'pair', 8, 'day', 0, 0, 0, null, 'Safety First Ghana', true, 30),
  ('CON-MSK', 'Face masks (box of 50)', 'consumable', 'box', 40, 'day', 0, 0, 0, null, 'Safety First Ghana', true, 5),
  ('CON-PPE', 'PPE set (coverall, boots, goggles)', 'consumable', 'set', 180, 'day', 0, 0, 0, null, 'Safety First Ghana', true, 4),
  ('CON-CHM', 'Cabin cleaning chemical (5 L)', 'consumable', 'gallon', 150, 'day', 0, 0, 0, null, 'Sanitation Chemicals Ltd', true, 6),
  ('CON-DEO', 'Cabin deodoriser blocks (pack)', 'consumable', 'pack', 55, 'day', 0, 0, 0, null, 'Sanitation Chemicals Ltd', true, 6),
  ('CON-WTR', 'Water per 1,000 litres', 'consumable', '1,000 L', 45, 'day', 0, 0, 0, null, 'Ghana Water Ltd', false, 0),
  ('CON-FUE', 'Diesel fuel per litre', 'consumable', 'litre', 15.50, 'day', 0, 0, 0, null, 'Fuel station', false, 0),
  ('CON-TSL', 'Topsoil (per tonne)', 'consumable', 'tonne', 180, 'day', 0, 0, 0, null, 'Green Acres Nursery', false, 0),
  ('CON-PLT', 'Ornamental plants', 'consumable', 'each', 35, 'day', 0, 0, 0, null, 'Green Acres Nursery', false, 0),
  ('CON-GRS', 'Grass carpet (per m²)', 'consumable', 'm²', 12, 'day', 0, 0, 0, null, 'Green Acres Nursery', false, 0),
  ('CON-FER', 'Fertiliser (50 kg bag)', 'consumable', 'bag', 450, 'day', 0, 0, 0, null, 'Agro Inputs Ltd', true, 2),
  ('CON-MUL', 'Mulch (bag)', 'consumable', 'bag', 40, 'day', 0, 0, 0, null, 'Green Acres Nursery', false, 0),
  ('EQP-SCR', 'Floor scrubber', 'equipment', 'day', 150, 'day', 0, 0, 0, null, null, false, 0),
  ('EQP-PWR', 'Pressure washer', 'equipment', 'day', 120, 'day', 0, 0, 0, null, null, false, 0),
  ('EQP-VAC', 'Industrial vacuum', 'equipment', 'day', 80, 'day', 0, 0, 0, null, null, false, 0),
  ('EQP-MOW', 'Lawn mower', 'equipment', 'day', 100, 'day', 0, 0, 0, null, null, false, 0),
  ('EQP-TRM', 'Hedge trimmer', 'equipment', 'day', 60, 'day', 0, 0, 0, null, null, false, 0),
  ('EQP-PMP', 'Water pump', 'equipment', 'day', 70, 'day', 0, 0, 0, null, null, false, 0),
  ('LAB-CLN', 'Cleaner', 'labour', 'person-day', 120, 'day', 0, 0, 0, null, null, false, 0),
  ('LAB-SUP', 'Supervisor', 'labour', 'person-day', 200, 'day', 0, 0, 0, null, null, false, 0),
  ('LAB-DRV', 'Driver', 'labour', 'person-day', 180, 'day', 0, 0, 0, null, null, false, 0),
  ('LAB-GRD', 'Gardener', 'labour', 'person-day', 130, 'day', 0, 0, 0, null, null, false, 0),
  ('LAB-LDR', 'Loader / helper', 'labour', 'person-day', 100, 'day', 0, 0, 0, null, null, false, 0),
  ('VEH-CES', 'Cesspit emptier trip', 'vehicle', 'trip', 0, 'day', 450, 6, 0, 'cesspit_emptier', null, false, 0),
  ('VEH-WAT', 'Water tanker trip', 'vehicle', 'trip', 0, 'day', 350, 5, 0, 'water_tanker', null, false, 0),
  ('VEH-CAB', 'Cabin carrier trip', 'vehicle', 'trip', 0, 'day', 300, 5, 0, 'cabin_carrier', null, false, 0),
  ('VEH-PKP', 'Pickup trip', 'vehicle', 'trip', 0, 'day', 150, 3, 0, 'pickup', null, false, 0),
  ('SUB-PST', 'Pest control (subcontract)', 'subcontract', 'visit', 800, 'day', 0, 0, 0, null, 'PestAway Ghana', false, 0),
  ('SUB-DMP', 'Waste dumping site fee', 'subcontract', 'trip', 150, 'day', 0, 0, 0, null, 'Municipal dump site', false, 0),
  ('OVH-ADM', 'Admin and supervision allocation', 'overhead', 'visit', 50, 'day', 0, 0, 0, null, null, false, 0),
  ('OVH-INS', 'Insurance allocation', 'overhead', 'day', 20, 'day', 0, 0, 0, null, null, false, 0)
on conflict (code) do nothing;

insert into public.stock_locations (name, is_default) values ('Main store', true) on conflict (name) do nothing;

-- ---------------------------------------------------------------------------
-- Estimate templates (one per service)
-- ---------------------------------------------------------------------------
do $$
declare v_t uuid; s record;
begin
  for s in select * from (values
    ('JAN', 'Janitorial – monthly office cleaning', 1, 8, true, 5, 'week', 12, 10, 5, 25,
      array[['CON-DET','per_visit','0.2','1','1','0'],['CON-DIS','per_visit','0.2','1','1','0'],['CON-TRL','per_visit','1','1','1','0'],['CON-BIN','per_visit','0.5','1','1','0'],
            ['LAB-CLN','per_visit','1','2','1','0'],['LAB-SUP','per_visit','1','0.2','1','0'],['CON-GLV','per_visit','1','2','1','0'],['OVH-ADM','per_visit','0.2','1','1','0']]),
    ('EVT', 'Event cleaning – one day', 1, 10, false, 1, 'month', 1, 10, 5, 30,
      array[['CON-DET','total','2','1','1','0'],['CON-DIS','total','2','1','1','0'],['CON-BIN','total','4','1','1','0'],['LAB-CLN','total','1','6','1','0'],
            ['LAB-SUP','total','1','1','1','0'],['VEH-PKP','total','2','1','0','15'],['EQP-PWR','total','1','1','1','0']]),
    ('WAT', 'Water supply – one tanker trip', 1, 4, false, 1, 'month', 1, 8, 5, 25,
      array[['CON-WTR','total','10','1','1','0'],['VEH-WAT','total','1','1','0','20'],['LAB-DRV','total','1','1','0.5','0'],['LAB-LDR','total','1','1','0.5','0']]),
    ('CAB', 'Mobile cabin rental – 2 cabins, 3 days', 3, 8, false, 1, 'month', 1, 10, 5, 30,
      array[['VEH-CAB','total','2','1','0','15'],['CON-CHM','total','1','1','1','0'],['CON-DEO','total','2','1','1','0'],['CON-TRL','total','2','1','1','0'],
            ['LAB-CLN','total','1','1','3','0'],['LAB-DRV','total','1','1','2','0'],['SUB-DMP','total','1','1','1','0']]),
    ('CES', 'Cesspit emptying – one trip', 1, 4, false, 1, 'month', 1, 8, 5, 25,
      array[['VEH-CES','total','1','1','0','20'],['LAB-DRV','total','1','1','0.5','0'],['LAB-LDR','total','1','2','0.5','0'],['CON-PPE','total','0.2','1','1','0'],['SUB-DMP','total','1','1','1','0']]),
    ('LAN', 'Landscaping – 100 m² beautification', 3, 8, false, 1, 'month', 1, 10, 10, 30,
      array[['CON-TSL','total','2','1','1','0'],['CON-GRS','total','100','1','1','0'],['CON-PLT','total','20','1','1','0'],['CON-FER','total','1','1','1','0'],
            ['CON-MUL','total','10','1','1','0'],['LAB-GRD','total','1','3','3','0'],['EQP-MOW','total','1','1','1','0'],['VEH-PKP','total','2','1','0','10']])
  ) as x(code, name, dur, hrs, rec, visits, period, months, ovh, cont, margin, lines) loop
    if exists (select 1 from public.estimate_templates t join public.services sv on sv.id = t.service_id where sv.code = s.code) then continue; end if;
    insert into public.estimate_templates (service_id, name, duration_days, hours_per_day, is_recurring, visits_per_period, visit_period, contract_months, overhead_pct, contingency_pct, target_margin_pct)
    values ((select id from public.services where code = s.code), s.name, s.dur, s.hrs, s.rec, s.visits, s.period, s.months, s.ovh, s.cont, s.margin) returning id into v_t;
    -- unnest of a 2-D array flattens it, so insert row by row
    for i in 1 .. array_length(s.lines, 1) loop
      insert into public.estimate_template_lines (template_id, cost_item_id, basis, quantity, headcount, days, km, sort_order)
      values (v_t, (select id from public.cost_items where code = s.lines[i][1]), s.lines[i][2], s.lines[i][3]::numeric, s.lines[i][4]::numeric, s.lines[i][5]::numeric, s.lines[i][6]::numeric, i);
    end loop;
    update public.services set default_template_id = v_t where code = s.code;
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Zonal task types
-- ---------------------------------------------------------------------------
insert into public.task_types (code, name, sort_order) values
  ('mmda_visit', 'MMDA Visit', 1), ('hoa_meeting', 'House-Owners Association Meeting', 2), ('deal_closing', 'Deal Closing', 3),
  ('site_inspection', 'Site Inspection', 4), ('customer_follow_up', 'Customer Follow-up', 5), ('payment_collection', 'Payment Collection', 6),
  ('prospecting', 'Prospecting', 7), ('community_sensitisation', 'Community Sensitisation', 8), ('other', 'Other', 9)
on conflict (code) do nothing;

-- ---------------------------------------------------------------------------
-- Default survey
-- ---------------------------------------------------------------------------
do $$
declare v_s uuid;
begin
  if not exists (select 1 from public.surveys where is_default) then
    insert into public.surveys (name, description, intro_text, thank_you_text, is_default)
    values ('Customer satisfaction', 'Sent automatically with every receipt', 'Thank you for your payment. Please take one minute to rate our service.',
            'Thank you! Your feedback helps us serve you better.', true) returning id into v_s;
    insert into public.survey_questions (survey_id, position, question_type, question_text, metric_key, required) values
      (v_s, 1, 'star', 'Overall, how satisfied are you with our service?', 'overall', true),
      (v_s, 2, 'star', 'How punctual was our team?', 'punctuality', true),
      (v_s, 3, 'star', 'How professional were our staff?', 'professionalism', true),
      (v_s, 4, 'star', 'How would you rate the quality of the work?', 'quality', true),
      (v_s, 5, 'nps', 'How likely are you to recommend us to a friend or colleague? (0–10)', 'nps', true),
      (v_s, 6, 'text', 'Any comments or suggestions?', 'comments', false);
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Notification templates (SMS and email). Placeholders are listed in the README.
-- ---------------------------------------------------------------------------
insert into public.notification_templates (event_code, channel, name, subject, body, is_marketing) values
  ('job_approved', 'sms', 'Job approved – customer', null, 'Dear {customer_name}, your {service} job {job_no} is confirmed for {date} {time_window} at {site}. Truck {truck_reg}, driver {driver_name} ({driver_phone}). {company_name}', false),
  ('job_approved', 'email', 'Job approved – customer', 'Job {job_no} confirmed for {date}', 'Dear {customer_name},\n\nYour {service} job {job_no} is confirmed for {date} {time_window} at {site}.\nTruck: {truck_reg}\nDriver: {driver_name} ({driver_phone})\n\nThank you,\n{company_name}', false),
  ('job_approved_driver', 'sms', 'Job approved – driver', null, '{driver_name}: new job {job_no} on {date} {time_window}. Customer {customer_name}, site {site}. Truck {truck_reg}. Officer {officer_name}.', false),
  ('job_approved_officer', 'sms', 'Job approved – officer', null, '{officer_name}: job {job_no} for {customer_name} on {date} has been approved. Invoice {invoice_no} GH₵{amount}.', false),
  ('job_rejected_officer', 'sms', 'Job rejected – officer', null, '{officer_name}: job {job_no} for {customer_name} was returned for changes. Reason: {reason}', false),
  ('service_reminder', 'sms', 'Day before – customer', null, 'Dear {customer_name}, reminder: your {service} is scheduled for tomorrow {date} {time_window} at {site}. Driver {driver_name} ({driver_phone}). {company_name}', false),
  ('service_reminder_driver', 'sms', 'Day before – driver', null, '{driver_name}: tomorrow {date} {time_window} job {job_no} – {service} for {customer_name} at {site}. Truck {truck_reg}.', false),
  ('service_today', 'sms', 'Day of service – customer', null, 'Dear {customer_name}, your {service} is today {time_window}. Our team ({driver_name}, {driver_phone}) is on the way. {company_name}', false),
  ('service_today_driver', 'sms', 'Job sheet – driver', null, 'JOB SHEET {job_no}: {service} for {customer_name}, {site}, {time_window}. Truck {truck_reg}. Officer {officer_name}.', false),
  ('job_completed', 'sms', 'Job completed – customer', null, 'Dear {customer_name}, great news! Job order {job_no} ({service}) has been completed. Thank you for choosing {company_name}. Invoice {invoice_no} of GH₵{amount} is now due. Pay via {payment_details} or {invoice_link}.', false),
  ('job_completed', 'email', 'Job completed – customer', 'Job {job_no} completed – invoice {invoice_no}', 'Dear {customer_name},\n\nJob order {job_no} ({service}) has been completed. Thank you for choosing {company_name}.\n\nInvoice {invoice_no} of GH₵{amount} is now due.\nPay via {payment_details} or online: {invoice_link}\n\nKind regards,\n{company_name}', false),
  ('recurring_invoice', 'sms', 'Contract invoice', null, 'Dear {customer_name}, invoice {invoice_no} of GH₵{amount} for contract {contract_no} ({period}) is ready: {invoice_link}. {company_name}', false),
  ('recurring_invoice', 'email', 'Contract invoice', 'Invoice {invoice_no} – {period}', 'Dear {customer_name},\n\nPlease find invoice {invoice_no} for contract {contract_no}, period {period}.\nAmount: GH₵{amount}\nDue: {date}\nView and download: {invoice_link}\n\nPay via {payment_details}.\n\n{company_name}', false),
  ('invoice_issued', 'sms', 'Invoice issued', null, 'Dear {customer_name}, invoice {invoice_no} of GH₵{amount} is due {date}: {invoice_link}. {company_name}', false),
  ('invoice_issued', 'email', 'Invoice issued', 'Invoice {invoice_no}', 'Dear {customer_name},\n\nInvoice {invoice_no} of GH₵{amount} is due on {date}.\nView: {invoice_link}\n\n{company_name}', false),
  ('payment_received', 'sms', 'Payment received', null, 'Thank you, {customer_name}. We have received GH₵{amount} for {invoice_no}. Receipt: {receipt_link}. Balance: GH₵{balance}. Please rate our service: {survey_link}', false),
  ('payment_received', 'email', 'Payment received', 'Receipt {receipt_no} – thank you', 'Dear {customer_name},\n\nWe have received GH₵{amount} for {invoice_no}.\nReceipt: {receipt_link}\nRemaining balance: GH₵{balance}\n\nPlease take a minute to rate our service: {survey_link}\n\nThank you,\n{company_name}', false),
  ('invoice_overdue', 'sms', 'Invoice overdue', null, 'Dear {customer_name}, invoice {invoice_no} (due {date}) has GH₵{balance} outstanding. Kindly pay via {payment_details} or {invoice_link}. {company_name}', false),
  ('invoice_overdue', 'email', 'Invoice overdue', 'Reminder: invoice {invoice_no} is overdue', 'Dear {customer_name},\n\nInvoice {invoice_no} was due on {date}. The outstanding balance is GH₵{balance}.\nPay via {payment_details} or online: {invoice_link}\n\n{company_name}', false),
  ('truck_off_road', 'sms', 'Truck Off-Road with bookings', null, 'ALERT: truck {truck_reg} is Off-Road. Job {job_no} ({date}) needs another truck.', false),
  ('document_due', 'sms', 'Fleet document / maintenance due', null, 'FLEET: {service} for {truck_reg} is due {date}.', false),
  ('document_due', 'email', 'Fleet document / maintenance due', '{truck_reg}: {service} due {date}', '{service} for {truck_reg} is due on {date}. Please renew or schedule it.', false),
  ('contract_ending', 'sms', 'Contract ending', null, 'Contract {contract_no} for {customer_name} ends on {date}. Plan the renewal.', false),
  ('contract_ending', 'email', 'Contract ending', 'Contract {contract_no} ends {date}', 'Contract {contract_no} for {customer_name} ends on {date}. Please contact the customer about renewal.', false),
  ('contract_low_margin', 'sms', 'Contract margin alert', null, 'ALERT: contract {contract_no} {period} gross profit GH₵{amount} ({balance}% margin).', false),
  ('contract_low_margin', 'email', 'Contract margin alert', 'Contract {contract_no}: margin alert for {period}', 'Contract {contract_no} has a gross profit of GH₵{amount} ({balance}% margin) for {period}, below the threshold.', false),
  ('low_survey_score', 'sms', 'Low survey score', null, 'ALERT: low survey score from {customer_name} (CSAT {amount}, NPS {balance}) for {invoice_no}. A follow-up task was created.', false),
  ('low_survey_score', 'email', 'Low survey score', 'Low survey score – {customer_name}', '{customer_name} gave a low score (CSAT {amount}, NPS {balance}) for {invoice_no}. Please follow up.', false),
  ('zonal_not_updated', 'sms', 'Zonal tasks not updated', null, '{officer_name}, you have {amount} task(s) today with no update. Please update the app before close of day.', false),
  ('zonal_summary', 'sms', 'Zonal daily summary', null, 'Zonal summary {date}: {amount} tasks completed, {balance} open. {period}', false),
  ('zonal_summary', 'email', 'Zonal daily summary', 'Zonal summary {date}', 'Tasks completed: {amount}\nStill open: {balance}\n\nBy officer: {period}', false),
  ('birthday', 'sms', 'Birthday greeting', null, 'Happy birthday, {customer_name}! Wishing you a wonderful year ahead from all of us at {company_name}.', true)
on conflict (event_code, channel) do nothing;
update public.notification_templates set body = replace(body, '\n', E'\n') where body like '%\n%';

commit;

-- ===========================================================================
-- ===================== DEMO DATA START (safe to delete) ====================
-- Everything between DEMO DATA START and DEMO DATA END is sample data for
-- trying the app. Delete this block before running seed.sql in production.
-- Demo staff are profiles without Auth users: sign up (or invite) with one of
-- the @demo.fm emails and the account is linked to that profile automatically.
-- ===========================================================================
begin;

create or replace function pg_temp.demo_job(p_customer text, p_service text, p_qty numeric, p_price numeric, p_day int, p_truck text,
  p_status text, p_contract uuid default null, p_end_days int default 0, p_officer text default 'ops@demo.fm') returns uuid
language plpgsql as $$
declare v_job uuid; v_c public.customers; v_cn uuid; v_off uuid;
begin
  select * into v_c from public.customers where display_name = p_customer;
  select id into v_off from public.profiles where email = p_officer;
  insert into public.job_orders (customer_id, execution_date, end_date, time_window, site_address, digital_address, channel, priority, raised_by, officer_id, contract_id, instructions)
  values (v_c.id, current_date + p_day, case when p_end_days > 0 then current_date + p_day + p_end_days end, '08:00–12:00',
    coalesce(v_c.residential_address, v_c.district, 'Accra'), v_c.digital_address, (array['call_in','walk_in','sales'])[1 + (abs(p_day) % 3)], 'normal', v_off, v_off, p_contract,
    'Call the customer 30 minutes before arrival.')
  returning id into v_job;
  insert into public.job_order_lines (job_order_id, service_id, quantity, unit_price) values (v_job, (select id from public.services where code = p_service), p_qty, p_price);
  if p_truck is not null then
    insert into public.job_order_assignments (job_order_id, kind, truck_id) values (v_job, 'truck', (select id from public.trucks where fleet_code = p_truck));
  end if;
  if p_status = 'draft' then return v_job; end if;
  perform public.submit_job_order(v_job);
  if p_status = 'pending_approval' then return v_job; end if;
  if p_status = 'on_hold' then perform public.hold_job_order(v_job, 'Customer asked to postpone; awaiting new date'); return v_job; end if;
  perform public.approve_job_order(v_job);
  if p_status = 'approved' then return v_job; end if;
  if p_status = 'cancelled' then perform public.cancel_job_order(v_job, 'Customer cancelled the booking'); return v_job; end if;
  perform public.start_job_order(v_job, (5.60 + random() / 10)::numeric, (-0.20 + random() / 10)::numeric);
  if p_status = 'in_progress' then return v_job; end if;
  perform public.complete_job_order(v_job, coalesce(v_c.first_name, 'Site manager'), null, 'Completed to the customer''s satisfaction',
    jsonb_build_array(jsonb_build_object('category', 'labour', 'description', 'Crew wages', 'quantity', 2, 'unit_cost', 120),
                      jsonb_build_object('category', 'fuel', 'description', 'Diesel', 'quantity', 25, 'unit_cost', 15.5),
                      jsonb_build_object('category', 'consumable', 'cost_item_id', (select id from public.cost_items where code = 'CON-DIS'), 'description', 'Disinfectant', 'quantity', 1, 'unit_cost', 120)));
  return v_job;
end $$;

do $$
declare
  v_id uuid; v_k1 uuid; v_k2 uuid; v_k3 uuid; v_k4 uuid; r record; v_j uuid; v_inv uuid; v_pay jsonb; i int; v_plan uuid; v_task uuid; v_tt uuid;
  v_start1 date := (date_trunc('month', current_date) - interval '3 months')::date;
  v_start2 date := (date_trunc('month', current_date) - interval '2 months' + interval '14 days')::date;
  v_start3 date := date_trunc('month', current_date)::date;
begin
  if exists (select 1 from public.profiles where email = 'manager@demo.fm') then raise notice 'Demo data already loaded'; return; end if;

  -- zones
  insert into public.zones (name, regions, districts, description) values
    ('Accra Metro', '{Greater Accra}', '{Accra Metropolitan,Korle Klottey,Ayawaso West}', 'Central Accra and the CBD'),
    ('Tema and Ashaiman', '{Greater Accra}', '{Tema Metropolitan,Ashaiman Municipal,Kpone Katamanso}', 'Tema harbour area and Ashaiman'),
    ('Ga East and Adentan', '{Greater Accra}', '{Ga East Municipal,Adentan Municipal,La Nkwantanang Madina}', 'North-east Accra suburbs');

  -- demo staff (profiles only; no Auth users)
  insert into public.profiles (full_name, email, phone, is_demo) values
    ('Akosua Mensah', 'manager@demo.fm', '0244100001', true), ('Kwame Boateng', 'manager2@demo.fm', '0244100002', true),
    ('Efua Owusu', 'ops@demo.fm', '0244100003', true), ('Yaw Asante', 'sales@demo.fm', '0244100004', true),
    ('Kojo Appiah', 'zonal1@demo.fm', '0244100005', true), ('Abena Darko', 'zonal2@demo.fm', '0244100006', true),
    ('Esi Quaye', 'accounts@demo.fm', '0244100007', true), ('Kofi Agyeman', 'fleet@demo.fm', '0244100008', true),
    ('Nana Addo', 'executive@demo.fm', '0244100009', true), ('Kwesi Badu', 'driver1@demo.fm', '0244100010', true),
    ('Ibrahim Mohammed', 'driver2@demo.fm', '0244100011', true), ('Selorm Agbeko', 'driver3@demo.fm', '0244100012', true);
  insert into public.user_roles (profile_id, role_code)
  select p.id, x.role from public.profiles p join (values ('manager@demo.fm','manager'), ('manager2@demo.fm','manager'), ('ops@demo.fm','ops_officer'),
    ('sales@demo.fm','sales_exec'), ('zonal1@demo.fm','zonal_officer'), ('zonal2@demo.fm','zonal_officer'), ('accounts@demo.fm','accountant'),
    ('fleet@demo.fm','fleet_manager'), ('executive@demo.fm','executive'), ('driver1@demo.fm','driver'), ('driver2@demo.fm','driver'), ('driver3@demo.fm','driver')) x(email, role)
    on x.email = p.email;
  insert into public.user_zones (profile_id, zone_id) select p.id, z.id from public.profiles p join public.zones z on
    (p.email = 'zonal1@demo.fm' and z.name = 'Accra Metro') or (p.email = 'zonal2@demo.fm' and z.name = 'Tema and Ashaiman') or (p.email = 'zonal1@demo.fm' and z.name = 'Ga East and Adentan');

  -- employees (8)
  insert into public.employees (full_name, role_type, phone, ghana_card_no, daily_rate, licence_no, licence_class, licence_expiry, profile_id, hired_on) values
    ('Kwesi Badu', 'driver', '0244100010', 'GHA-712345601-1', 180, 'DVLA-C-55102', 'C', current_date + 400, (select id from public.profiles where email = 'driver1@demo.fm'), current_date - 900),
    ('Ibrahim Mohammed', 'driver', '0244100011', 'GHA-712345602-2', 180, 'DVLA-C-55103', 'C', current_date + 25, (select id from public.profiles where email = 'driver2@demo.fm'), current_date - 600),
    ('Selorm Agbeko', 'driver', '0244100012', 'GHA-712345603-3', 180, 'DVLA-D-55104', 'D', current_date + 700, (select id from public.profiles where email = 'driver3@demo.fm'), current_date - 300),
    ('Adwoa Sarpong', 'cleaner', '0201234501', null, 120, null, null, null, null, current_date - 500),
    ('Mercy Tetteh', 'cleaner', '0201234502', null, 120, null, null, null, null, current_date - 450),
    ('Emmanuel Ofori', 'cleaner', '0201234503', null, 120, null, null, null, null, current_date - 200),
    ('Gifty Amankwah', 'supervisor', '0201234504', null, 200, null, null, null, null, current_date - 800),
    ('Daniel Nkrumah', 'gardener', '0201234505', null, 130, null, null, null, null, current_date - 365);

  -- trucks (6)
  insert into public.trucks (registration_no, fleet_code, truck_type, make, model, year, capacity_litres, capacity_cabins, chassis_no, odometer_km, assigned_driver_id) values
    ('GT 4521-21', 'CES-01', 'cesspit_emptier', 'Howo', 'Sinotruk 10m³', 2021, 10000, null, 'LZZ5ELND1MW000101', 84500, (select id from public.employees where full_name = 'Kwesi Badu')),
    ('GR 7788-22', 'CES-02', 'cesspit_emptier', 'Isuzu', 'FVR 8m³', 2022, 8000, null, 'JALFVR34PN7000202', 52300, null),
    ('GT 3310-20', 'WAT-01', 'water_tanker', 'DAF', 'CF 85', 2020, 15000, null, 'XLRAD85MC0E000303', 120900, (select id from public.employees where full_name = 'Ibrahim Mohammed')),
    ('GN 1290-19', 'WAT-02', 'water_tanker', 'Mercedes-Benz', 'Actros', 2019, 18000, null, 'WDB9302031L000404', 188200, null),
    ('GE 5577-23', 'CAB-01', 'cabin_carrier', 'Mitsubishi', 'Fuso Canter', 2023, null, 4, 'JLBFE85PDNK000505', 21400, (select id from public.employees where full_name = 'Selorm Agbeko')),
    ('GW 2468-24', 'PKP-01', 'pickup', 'Toyota', 'Hilux', 2024, null, null, 'AHTFR22G700000606', 15800, null);
  insert into public.truck_documents (truck_id, doc_type, doc_number, issue_date, expiry_date)
  select t.id, d.doc_type, d.doc_type || '-' || t.fleet_code, current_date - 300, current_date + case when t.fleet_code = 'CES-02' and d.doc_type = 'roadworthy' then 20 else 65 + (row_number() over ())::int * 9 end
  from public.trucks t cross join (values ('insurance'), ('roadworthy'), ('permit')) d(doc_type);
  insert into public.maintenance_schedules (truck_id, title, interval_days, interval_km, last_done_date, last_done_km, next_due_date, next_due_km)
  select id, 'Full service', 90, 10000, current_date - 80, odometer_km - 6000, current_date + 10, odometer_km + 4000 from public.trucks;

  -- customers (15)
  insert into public.customers (customer_type, title, first_name, last_name, gender, birth_day, birth_month, ghana_card_no, phone, whatsapp, email, occupation, residential_address,
    digital_address, region, district, zone_id, source, assigned_to, sms_opt_in, marketing_consent, payment_terms_days, credit_limit, tags) values
    ('individual', 'Mrs', 'Comfort', 'Asamoah', 'female', extract(day from current_date)::int, extract(month from current_date)::int, 'GHA-701234501-1', '0244555101', '0244555101', 'comfort.asamoah@example.com', 'Trader', 'House 12, Dzorwulu', 'GA-183-4521', 'Greater Accra', 'Ayawaso West', (select id from public.zones where name = 'Accra Metro'), 'call_in', (select id from public.profiles where email = 'sales@demo.fm'), true, true, 7, 0, '{residential}'),
    ('individual', 'Mr', 'Kofi', 'Antwi', 'male', 14, 3, 'GHA-701234502-2', '0244555102', null, 'kofi.antwi@example.com', 'Engineer', 'Plot 5, Tema Community 25', 'GT-021-3344', 'Greater Accra', 'Tema Metropolitan', (select id from public.zones where name = 'Tema and Ashaiman'), 'walk_in', (select id from public.profiles where email = 'sales@demo.fm'), true, false, 7, 0, '{residential}'),
    ('individual', 'Dr', 'Ama', 'Owusu-Ansah', 'female', 2, 11, 'GHA-701234503-3', '0201555103', null, 'ama.oa@example.com', 'Doctor', 'East Legon, Lagos Avenue', 'GA-492-1180', 'Greater Accra', 'Ayawaso West', (select id from public.zones where name = 'Accra Metro'), 'referral', (select id from public.profiles where email = 'sales@demo.fm'), true, true, 14, 0, '{residential,vip}'),
    ('individual', 'Mr', 'Yaw', 'Frimpong', 'male', 21, 7, 'GHA-701234504-4', '0277555104', null, null, 'Landlord', 'Ashaiman Main Road', 'GT-114-2290', 'Greater Accra', 'Ashaiman Municipal', (select id from public.zones where name = 'Tema and Ashaiman'), 'zonal_officer', (select id from public.profiles where email = 'zonal2@demo.fm'), true, false, 7, 0, '{landlord}'),
    ('individual', 'Ms', 'Esi', 'Boakye', 'female', 9, 1, 'GHA-701234505-5', '0244555105', null, 'esi.boakye@example.com', 'Event planner', 'Madina Zongo Junction', 'GM-075-5521', 'Greater Accra', 'La Nkwantanang Madina', (select id from public.zones where name = 'Ga East and Adentan'), 'website', (select id from public.profiles where email = 'sales@demo.fm'), true, true, 7, 0, '{events}'),
    ('individual', 'Mr', 'Kwabena', 'Nyarko', 'male', 30, 5, 'GHA-701234506-6', '0244555106', null, null, 'Civil servant', 'Adenta SSNIT Flats', 'GD-031-7710', 'Greater Accra', 'Adentan Municipal', (select id from public.zones where name = 'Ga East and Adentan'), 'zonal_officer', (select id from public.profiles where email = 'zonal1@demo.fm'), true, false, 7, 0, '{}'),
    ('individual', 'Mrs', 'Akua', 'Danso', 'female', 17, 8, 'GHA-701234507-7', '0244555107', null, 'akua.danso@example.com', 'Caterer', 'Osu Oxford Street', 'GA-011-0099', 'Greater Accra', 'Korle Klottey', (select id from public.zones where name = 'Accra Metro'), 'call_in', null, true, false, 7, 0, '{}'),
    ('individual', 'Mr', 'Fiifi', 'Mensah', 'male', 3, 12, 'GHA-701234508-8', '0244555108', null, null, 'Pastor', 'Kpone Barrier', 'GT-201-6612', 'Greater Accra', 'Kpone Katamanso', (select id from public.zones where name = 'Tema and Ashaiman'), 'walk_in', null, false, false, 7, 0, '{church}');
  insert into public.customers (customer_type, company_name, trading_name, registration_no, tin, sector, company_phone, company_email, digital_address, region, district, zone_id, source,
    assigned_to, payment_terms_days, credit_limit, tags, residential_address) values
    ('company', 'Accra Metropolitan Assembly', 'AMA', 'GOV-AMA-001', 'C0001234567', 'Government (MMDA)', '0302664000', 'procurement@ama.example.gov.gh', 'GA-001-0001', 'Greater Accra', 'Accra Metropolitan', (select id from public.zones where name = 'Accra Metro'), 'zonal_officer', (select id from public.profiles where email = 'zonal1@demo.fm'), 30, 50000, '{mmda}', 'AMA Head Office, High Street'),
    ('company', 'Tema Harbour Logistics Ltd', 'THL', 'CS123450001', 'C0009876543', 'Logistics', '0303200100', 'accounts@thl.example.com', 'GT-005-1122', 'Greater Accra', 'Tema Metropolitan', (select id from public.zones where name = 'Tema and Ashaiman'), 'sales_field', (select id from public.profiles where email = 'sales@demo.fm'), 30, 30000, '{corporate}', 'Harbour Area, Tema'),
    ('company', 'Golden Palm Hotel', 'Golden Palm', 'CS123450002', 'C0005551112', 'Hospitality', '0302777888', 'gm@goldenpalm.example.com', 'GA-120-3434', 'Greater Accra', 'Korle Klottey', (select id from public.zones where name = 'Accra Metro'), 'referral', (select id from public.profiles where email = 'sales@demo.fm'), 14, 20000, '{hotel}', 'Ring Road Central'),
    ('company', 'Bright Future International School', 'BFIS', 'CS123450003', 'C0002223334', 'Education', '0302555123', 'bursar@bfis.example.edu.gh', 'GM-044-7788', 'Greater Accra', 'Ga East Municipal', (select id from public.zones where name = 'Ga East and Adentan'), 'sales_field', (select id from public.profiles where email = 'sales@demo.fm'), 30, 25000, '{school}', 'Haatso-Atomic Road'),
    ('company', 'Community 25 Residents Association', 'C25 RA', null, null, 'House-owners association', '0244666777', 'c25ra@example.com', 'GT-025-0001', 'Greater Accra', 'Tema Metropolitan', (select id from public.zones where name = 'Tema and Ashaiman'), 'zonal_officer', (select id from public.profiles where email = 'zonal2@demo.fm'), 14, 10000, '{hoa}', 'Community 25 Estate'),
    ('company', 'Adenta Municipal Assembly', 'ADMA', 'GOV-ADMA-002', 'C0001112223', 'Government (MMDA)', '0302511222', 'procurement@adma.example.gov.gh', 'GD-002-0002', 'Greater Accra', 'Adentan Municipal', (select id from public.zones where name = 'Ga East and Adentan'), 'zonal_officer', (select id from public.profiles where email = 'zonal1@demo.fm'), 45, 40000, '{mmda}', 'Adenta Municipal Office'),
    ('company', 'Sunrise Events Centre', 'Sunrise', 'CS123450004', 'C0007778889', 'Events', '0244888999', 'bookings@sunrise.example.com', 'GA-310-9090', 'Greater Accra', 'Ayawaso West', (select id from public.zones where name = 'Accra Metro'), 'website', null, 7, 15000, '{events}', 'Spintex Road');
  update public.customers set status = 'blacklisted', notes = 'Bounced cheques in 2025 – cash only after Manager approval' where display_name = 'Mr Fiifi Mensah';
  insert into public.customer_contacts (customer_id, name, position, phone, email, is_primary, receives_invoices)
  select c.id, x.name, x.position, x.phone, x.email, true, true from public.customers c join (values
    ('Accra Metropolitan Assembly', 'Mr Joseph Laryea', 'Procurement Officer', '0244700001', 'j.laryea@ama.example.gov.gh'),
    ('Tema Harbour Logistics Ltd', 'Ms Rita Ansah', 'Facilities Manager', '0244700002', 'rita.ansah@thl.example.com'),
    ('Golden Palm Hotel', 'Mr Samuel Otoo', 'General Manager', '0244700003', 'gm@goldenpalm.example.com'),
    ('Bright Future International School', 'Mrs Grace Aidoo', 'Bursar', '0244700004', 'bursar@bfis.example.edu.gh'),
    ('Community 25 Residents Association', 'Mr Ebo Taylor', 'Chairman', '0244700005', 'c25ra@example.com'),
    ('Adenta Municipal Assembly', 'Ms Linda Ocran', 'Sanitation Officer', '0244700006', 'l.ocran@adma.example.gov.gh'),
    ('Sunrise Events Centre', 'Mr Kojo Bonsu', 'Operations', '0244700007', 'bookings@sunrise.example.com')) x(cname, name, position, phone, email) on c.display_name = x.cname;

  -- leads (10)
  insert into public.leads (name, company_name, phone, email, service_id, source, location, zone_id, estimated_value, owner_id, stage, lost_reason, next_follow_up, notes) values
    ('Mr Isaac Quartey', null, '0244810001', null, (select id from public.services where code = 'CES'), 'call_in', 'Dansoman', (select id from public.zones where name = 'Accra Metro'), 1200, (select id from public.profiles where email = 'sales@demo.fm'), 'new', null, current_date, 'Septic tank full'),
    ('Mrs Joyce Addai', null, '0244810002', null, (select id from public.services where code = 'WAT'), 'walk_in', 'Ashaiman', (select id from public.zones where name = 'Tema and Ashaiman'), 2400, (select id from public.profiles where email = 'zonal2@demo.fm'), 'contacted', null, current_date - 2, 'Weekly water for a guest house'),
    ('Ms Patricia Lamptey', 'Lamptey & Sons Ltd', '0244810003', 'pl@lamptey.example.com', (select id from public.services where code = 'JAN'), 'sales_field', 'Airport City', (select id from public.zones where name = 'Accra Metro'), 18000, (select id from public.profiles where email = 'sales@demo.fm'), 'site_visit', null, current_date + 2, 'Office block, 3 floors'),
    ('Mr George Asiedu', 'Madina Market Traders', '0244810004', null, (select id from public.services where code = 'CAB'), 'zonal_officer', 'Madina Market', (select id from public.zones where name = 'Ga East and Adentan'), 6000, (select id from public.profiles where email = 'zonal1@demo.fm'), 'estimate_sent', null, current_date + 1, 'Cabins for market days'),
    ('Rev. Daniel Opoku', 'Grace Chapel', '0244810005', null, (select id from public.services where code = 'EVT'), 'referral', 'Teshie', (select id from public.zones where name = 'Accra Metro'), 3000, (select id from public.profiles where email = 'sales@demo.fm'), 'negotiation', null, current_date + 3, 'Annual convention'),
    ('Mr Felix Owusu', 'Spintex Mall', '0244810006', null, (select id from public.services where code = 'LAN'), 'sales_field', 'Spintex', (select id from public.zones where name = 'Accra Metro'), 9500, (select id from public.profiles where email = 'sales@demo.fm'), 'won', null, null, 'Car park landscaping'),
    ('Mrs Hannah Mireku', null, '0244810007', null, (select id from public.services where code = 'CES'), 'call_in', 'Tema Community 8', (select id from public.zones where name = 'Tema and Ashaiman'), 1200, (select id from public.profiles where email = 'zonal2@demo.fm'), 'lost', 'Chose a cheaper operator', null, null),
    ('Kpone Katamanso Assembly', 'Kpone Katamanso Municipal Assembly', '0244810008', null, (select id from public.services where code = 'CES'), 'zonal_officer', 'Kpone', (select id from public.zones where name = 'Tema and Ashaiman'), 45000, (select id from public.profiles where email = 'zonal2@demo.fm'), 'contacted', null, current_date - 1, 'Public toilets emptying contract'),
    ('Mr Raymond Tagoe', 'Tagoe Apartments', '0244810009', null, (select id from public.services where code = 'JAN'), 'website', 'Haatso', (select id from public.zones where name = 'Ga East and Adentan'), 7200, (select id from public.profiles where email = 'zonal1@demo.fm'), 'new', null, current_date + 5, 'Common areas cleaning'),
    ('Ms Abigail Sowah', null, '0244810010', null, (select id from public.services where code = 'WAT'), 'call_in', 'Adenta', (select id from public.zones where name = 'Ga East and Adentan'), 800, (select id from public.profiles where email = 'sales@demo.fm'), 'site_visit', null, current_date, 'Borehole broken');
  insert into public.lead_activities (lead_id, activity_type, activity_at, outcome, notes, created_by)
  select l.id, 'call', now() - interval '2 days', 'Interested', 'Initial call', l.owner_id from public.leads l;

  -- contracts (3 recurring + 1 one-off)
  insert into public.contracts (customer_id, contract_type, title, start_date, end_date, billing_frequency, amount_per_period, billing_day, payment_terms_days, service_id, supervisor_id, overhead_pct, budgeted_monthly_cost, created_by)
  values ((select id from public.customers where display_name = 'Tema Harbour Logistics Ltd'), 'recurring', 'Office and warehouse cleaning', v_start1, (v_start1 + interval '12 months' - interval '1 day')::date, 'monthly', 4500, 1, 30,
          (select id from public.services where code = 'JAN'), (select id from public.profiles where email = 'ops@demo.fm'), 5, 3200, (select id from public.profiles where email = 'ops@demo.fm')) returning id into v_k1;
  insert into public.contracts (customer_id, contract_type, title, start_date, end_date, billing_frequency, amount_per_period, billing_day, payment_terms_days, service_id, supervisor_id, overhead_pct, budgeted_monthly_cost, created_by)
  values ((select id from public.customers where display_name = 'Bright Future International School'), 'recurring', 'School washrooms and grounds', v_start2, (v_start2 + interval '10 months' - interval '1 day')::date, 'monthly', 3000, 1, 30,
          (select id from public.services where code = 'JAN'), (select id from public.profiles where email = 'ops@demo.fm'), 5, 2100, (select id from public.profiles where email = 'ops@demo.fm')) returning id into v_k2;
  insert into public.contracts (customer_id, contract_type, title, start_date, end_date, billing_frequency, amount_per_period, billing_day, payment_terms_days, service_id, supervisor_id, overhead_pct, budgeted_monthly_cost, created_by)
  values ((select id from public.customers where display_name = 'Golden Palm Hotel'), 'recurring', 'Landscaping and grounds upkeep', v_start3, (v_start3 + interval '6 months' - interval '1 day')::date, 'monthly', 1800, 1, 14,
          (select id from public.services where code = 'LAN'), (select id from public.profiles where email = 'ops@demo.fm'), 5, 1300, (select id from public.profiles where email = 'ops@demo.fm')) returning id into v_k3;
  insert into public.contracts (customer_id, contract_type, title, start_date, end_date, total_agreed, payment_terms_days, service_id, supervisor_id, created_by)
  values ((select id from public.customers where display_name = 'Accra Metropolitan Assembly'), 'one_off', 'Public toilet desludging – phase 1', current_date - 40, current_date + 50, 6000, 30,
          (select id from public.services where code = 'CES'), (select id from public.profiles where email = 'ops@demo.fm'), (select id from public.profiles where email = 'ops@demo.fm')) returning id into v_k4;
  insert into public.contract_services (contract_id, service_id, description, quantity, unit_price) values
    (v_k1, (select id from public.services where code = 'JAN'), 'Daily cleaning, Mon–Sat', 1, 4500), (v_k2, (select id from public.services where code = 'JAN'), 'Daily washroom cleaning', 1, 3000),
    (v_k3, (select id from public.services where code = 'LAN'), 'Weekly grounds upkeep', 1, 1800), (v_k4, (select id from public.services where code = 'CES'), '5 desludging trips', 5, 1200);
  insert into public.contract_sites (contract_id, name, address, digital_address) values
    (v_k1, 'Head office', 'Harbour Area, Tema', 'GT-005-1122'), (v_k1, 'Warehouse 3', 'Free Zone Enclave, Tema', 'GT-006-2233'),
    (v_k2, 'Main campus', 'Haatso-Atomic Road', 'GM-044-7788'), (v_k3, 'Hotel grounds', 'Ring Road Central', 'GA-120-3434'), (v_k4, 'Public toilets', 'Accra Central', 'GA-001-0001');
  for v_id in select unnest(array[v_k1, v_k2, v_k3, v_k4]) loop
    perform public.submit_contract(v_id);
    perform public.approve_contract(v_id);
  end loop;
  perform public.generate_recurring_invoices(current_date);

  -- supplies and labour per contract month
  for r in select k.id, m::date as month, k.amount_per_period, k.start_date from public.contracts k
           cross join lateral generate_series(date_trunc('month', k.start_date), date_trunc('month', current_date), interval '1 month') m where k.id in (v_k1, v_k2, v_k3) loop
    insert into public.contract_supplies (contract_id, supply_date, cost_item_id, quantity, received_by, notes)
    select r.id, greatest(r.month + 3, r.start_date), (select id from public.cost_items where code = x.code), x.qty, 'Site supervisor', 'Monthly issue'
    from (values (v_k1, 'CON-DET', 4), (v_k1, 'CON-DIS', 3), (v_k1, 'CON-TRL', 10),
                 (v_k2, 'CON-DET', 3), (v_k2, 'CON-DIS', 3), (v_k2, 'CON-TRL', case when r.month = date_trunc('month', current_date) then 30 else 20 end),
                 (v_k3, 'CON-FER', 1), (v_k3, 'CON-MUL', 5), (v_k3, 'CON-PLT', 4)) x(kid, code, qty) where x.kid = r.id;
    insert into public.contract_labour (contract_id, work_date, role_description, staff_count, days, rate, notes)
    values (r.id, greatest(r.month + 27, r.start_date), case when r.id = v_k3 then 'Gardener' else 'Cleaner' end, 1,
            case when r.id = v_k1 then 20 when r.id = v_k2 then 10 else 6 end, case when r.id = v_k3 then 130 else 120 end, 'Monthly allocation');
  end loop;

  -- 20 job orders across every status
  perform pg_temp.demo_job('Mrs Comfort Asamoah', 'CES', 1, 1200, -20, 'CES-01', 'closed');
  perform pg_temp.demo_job('Mr Kofi Antwi', 'WAT', 2, 800, -18, 'WAT-01', 'closed');
  perform pg_temp.demo_job('Golden Palm Hotel', 'EVT', 1, 3500, -15, null, 'closed');
  perform pg_temp.demo_job('Accra Metropolitan Assembly', 'CES', 2, 1200, -12, 'CES-02', 'completed', v_k4);
  perform pg_temp.demo_job('Accra Metropolitan Assembly', 'CES', 1, 1200, -9, 'CES-01', 'completed', v_k4);
  perform pg_temp.demo_job('Ms Esi Boakye', 'CAB', 2, 250, -7, 'CAB-01', 'completed', null, 2);
  perform pg_temp.demo_job('Sunrise Events Centre', 'CAB', 4, 250, -1, 'CAB-01', 'in_progress', null, 2);
  perform pg_temp.demo_job('Community 25 Residents Association', 'CES', 1, 1100, 0, 'CES-02', 'in_progress');
  perform pg_temp.demo_job('Dr Ama Owusu-Ansah', 'CES', 1, 1200, 0, 'CES-01', 'approved');
  perform pg_temp.demo_job('Adenta Municipal Assembly', 'WAT', 3, 800, 2, 'WAT-02', 'approved');
  perform pg_temp.demo_job('Mrs Akua Danso', 'JAN', 1, 450, 3, null, 'approved');
  perform pg_temp.demo_job('Tema Harbour Logistics Ltd', 'WAT', 2, 750, 5, 'WAT-01', 'approved');
  perform pg_temp.demo_job('Mr Kwabena Nyarko', 'CES', 1, 1200, 4, 'CES-02', 'pending_approval');
  perform pg_temp.demo_job('Mr Yaw Frimpong', 'LAN', 120, 45, 6, null, 'pending_approval');
  perform pg_temp.demo_job('Bright Future International School', 'EVT', 1, 2500, 9, null, 'pending_approval');
  perform pg_temp.demo_job('Mrs Comfort Asamoah', 'JAN', 2, 350, 10, null, 'draft');
  perform pg_temp.demo_job('Golden Palm Hotel', 'CAB', 6, 250, 14, 'CAB-01', 'draft', null, 1);
  perform pg_temp.demo_job('Mr Kofi Antwi', 'CES', 1, 1200, 8, 'CES-01', 'on_hold');
  perform pg_temp.demo_job('Sunrise Events Centre', 'EVT', 1, 1800, 12, null, 'cancelled');
  perform pg_temp.demo_job('Tema Harbour Logistics Ltd', 'CES', 1, 1200, 7, 'CES-01', 'cancelled');

  -- payments: closed jobs fully paid (closes them), some partial, contract invoices
  for r in select i.* from public.invoices i join public.job_orders j on j.id = i.job_order_id where j.status = 'completed' and j.execution_date <= current_date - 15 loop
    perform public.record_payment(r.customer_id, r.balance, 'mtn_momo', current_date - 5, 'MOMO-' || left(r.invoice_no, 3) || right(r.invoice_no, 5));
  end loop;
  for r in select i.* from public.invoices i join public.job_orders j on j.id = i.job_order_id where j.status = 'completed' and j.contract_id = v_k4 order by i.invoice_no limit 1 loop
    perform public.record_payment(r.customer_id, 1500, 'bank_transfer', current_date - 2, 'GCB-TRF-88120', null, jsonb_build_array(jsonb_build_object('invoice_id', r.id, 'amount', 1500)));
  end loop;
  for r in select i.* from public.invoices i where i.contract_id in (v_k1, v_k2) and i.period_start < date_trunc('month', current_date) loop
    perform public.record_payment(r.customer_id, r.balance, 'bank_transfer', least(r.issue_date + 20, current_date), 'BANK-' || right(r.invoice_no, 5), null,
      jsonb_build_array(jsonb_build_object('invoice_id', r.id, 'amount', r.balance)));
  end loop;

  -- survey responses for a few invitations
  for r in select si.token, row_number() over (order by si.sent_at) as n from public.survey_invitations si loop
    perform public.submit_survey_response(r.token, (select jsonb_agg(jsonb_build_object('question_id', q.id,
      'rating', case q.question_type when 'star' then case when r.n = 2 then 2 else 4 + (r.n % 2) end when 'nps' then case when r.n = 2 then 4 else 9 end end,
      'text_value', case when q.question_type = 'text' then case when r.n = 2 then 'Truck arrived two hours late' else 'Very professional team' end end))
      from public.survey_questions q join public.survey_invitations si2 on si2.survey_id = q.survey_id where si2.token = r.token));
    exit when r.n >= 4;
  end loop;

  -- supplier, bill, expense, fuel, maintenance, transfer
  insert into public.suppliers (name, phone, email, tin, address) values
    ('Accra Cleaning Supplies', '0302111222', 'sales@acs.example.com', 'C0004445556', 'Kaneshie Industrial Area'),
    ('Kwame Auto Workshop', '0244333444', null, null, 'Abossey Okai'),
    ('Star Oil Station', '0302999000', null, null, 'Tema Motorway');
  insert into public.bills (supplier_id, supplier_ref, bill_date, due_date, notes)
  values ((select id from public.suppliers where name = 'Accra Cleaning Supplies'), 'ACS-INV-2041', current_date - 10, current_date + 20, 'Monthly consumables') returning id into v_id;
  insert into public.bill_lines (bill_id, account_id, description, cost_item_id, quantity, unit_cost, stock_location_id) values
    (v_id, public.account_by_code('5010'), 'Liquid detergent (5 L)', (select id from public.cost_items where code = 'CON-DET'), 40, 85, (select id from public.stock_locations where name = 'Main store')),
    (v_id, public.account_by_code('5010'), 'Disinfectant (5 L)', (select id from public.cost_items where code = 'CON-DIS'), 30, 120, (select id from public.stock_locations where name = 'Main store')),
    (v_id, public.account_by_code('5010'), 'Toilet rolls (pack of 10)', (select id from public.cost_items where code = 'CON-TRL'), 60, 45, (select id from public.stock_locations where name = 'Main store'));
  perform public.submit_bill(v_id); perform public.approve_bill(v_id);
  perform public.pay_bill(v_id, 3000, (select id from public.bank_accounts where name = 'Main bank account'), current_date - 3, 'GCB-CHQ-1102');
  insert into public.contract_supplies (contract_id, supply_date, cost_item_id, quantity, stock_location_id, received_by)
  values (v_k1, current_date, (select id from public.cost_items where code = 'CON-DET'), 5, (select id from public.stock_locations where name = 'Main store'), 'Warehouse supervisor');
  insert into public.expenses (expense_date, account_id, amount, payee, description, contract_id)
  values (current_date - 6, public.account_by_code('6040'), 350, 'Hubtel', 'SMS bundle top-up', null) returning id into v_id;
  perform public.submit_expense(v_id); perform public.approve_expense(v_id); perform public.pay_expense(v_id, (select id from public.bank_accounts where name = 'Mobile Money wallet'), 'MOMO-EXP-1');
  insert into public.expenses (expense_date, account_id, amount, payee, description, truck_id, is_fleet)
  values (current_date - 1, public.account_by_code('5040'), 680, 'Kwame Auto Workshop', 'Replace brake pads – WAT-02', (select id from public.trucks where fleet_code = 'WAT-02'), true) returning id into v_id;
  perform public.submit_expense(v_id);
  insert into public.fuel_logs (truck_id, log_date, litres, cost, odometer_km, station, job_order_id)
  select t.id, current_date - g, 60, 930, t.odometer_km - g * 90, 'Star Oil Station',
    case when g = 14 then (select j.id from public.job_orders j join public.job_order_assignments a on a.job_order_id = j.id where a.truck_id = t.id and j.status in ('completed','closed') limit 1) end
  from public.trucks t cross join generate_series(2, 14, 4) g where t.fleet_code in ('CES-01','CES-02','WAT-01');
  insert into public.maintenance_records (truck_id, schedule_id, service_date, workshop, work_done, parts, cost, odometer_km)
  select t.id, (select id from public.maintenance_schedules where truck_id = t.id), current_date - 30, 'Kwame Auto Workshop', 'Full service, oil and filters', 'Oil, oil filter, air filter', 1450, t.odometer_km - 2500
  from public.trucks t where t.fleet_code in ('CES-01','WAT-01');
  perform public.record_bank_transfer((select id from public.bank_accounts where name = 'Mobile Money wallet'), (select id from public.bank_accounts where name = 'Main bank account'),
    2000, 5, current_date - 1, 'MoMo sweep to bank');

  -- one truck Off-Road (flags its booked job for reassignment)
  perform public.set_truck_status((select id from public.trucks where fleet_code = 'WAT-02'), 'off_road', 'awaiting_parts', current_date + 6, 'Waiting for a new fuel pump from Tema');

  -- zonal tasks for two weeks (last week and this week)
  select id into v_tt from public.task_types where code = 'mmda_visit';
  for r in select p.id as officer, (select zone_id from public.user_zones where profile_id = p.id limit 1) as zone, p.email from public.profiles p where p.email in ('zonal1@demo.fm', 'zonal2@demo.fm') loop
    for i in 0 .. 1 loop
      insert into public.task_plans (officer_id, zone_id, title, period_type, start_date, end_date)
      values (r.officer, r.zone, 'Week plan ' || to_char(date_trunc('week', current_date) - (1 - i) * interval '7 days', 'DD/MM'), 'week',
              (date_trunc('week', current_date) - (1 - i) * interval '7 days')::date, (date_trunc('week', current_date) - (1 - i) * interval '7 days' + interval '4 days')::date)
      returning id into v_plan;
      insert into public.tasks (plan_id, officer_id, zone_id, task_type_id, title, target_org, contact_name, contact_phone, location, planned_date, priority, expected_outcome, status, deal_value, deal_closed, outcome_notes)
      select v_plan, r.officer, r.zone, tt.id, tt.name || ': ' || x.org, x.org, x.contact, x.phone, x.loc,
        (date_trunc('week', current_date) - (1 - i) * interval '7 days')::date + x.d,
        x.pri, x.expect,
        case when i = 0 then (array['completed','completed','pending','completed','postponed'])[x.d + 1]
             when (date_trunc('week', current_date))::date + x.d < current_date then (array['completed','pending','completed','in_progress','completed'])[x.d + 1]
             else 'planned' end,
        x.val, x.val > 0 and i = 0, case when i = 0 then 'Met the contact; positive response' end
      from (values (0, 'mmda_visit', 'Sanitation Directorate', 'Mr Adjei', '0244900001', 'Municipal office', 'high', 'Present cesspit services', 0),
                   (1, 'hoa_meeting', 'Estate Residents Association', 'Chairman', '0244900002', 'Community centre', 'normal', 'Pitch monthly cleaning', 3500),
                   (2, 'prospecting', 'New shops on main road', 'Shop owners', '0244900003', 'Main road', 'normal', 'Collect 10 contacts', 0),
                   (3, 'payment_collection', 'Overdue customers', 'Accounts', '0244900004', 'Various', 'urgent', 'Collect overdue balances', 0),
                   (4, 'deal_closing', 'Private school', 'Head teacher', '0244900005', 'School campus', 'high', 'Sign washroom contract', 6000)) x(d, ttype, org, contact, phone, loc, pri, expect, val)
      join public.task_types tt on tt.code = x.ttype;
    end loop;
  end loop;
  insert into public.task_checkins (task_id, officer_id, lat, lng, accuracy_m, checked_in_at)
  select t.id, t.officer_id, 5.55 + random() / 10, -0.25 + random() / 10, 15, t.planned_date + time '10:30' from public.tasks t where t.status in ('completed','in_progress','pending');
  insert into public.task_updates (task_id, status, notes, created_by, created_at)
  select t.id, t.status, 'Visited and recorded outcome', t.officer_id, t.planned_date + time '11:00' from public.tasks t where t.status in ('completed','pending');
  insert into public.task_comments (task_id, author_id, body)
  select t.id, (select id from public.profiles where email = 'manager@demo.fm'), 'Good work – follow up next week.' from public.tasks t where t.status = 'completed' limit 3;

  -- an estimate per state
  insert into public.estimates (customer_id, service_id, title, site, proposed_price, created_by)
  values ((select id from public.customers where display_name = 'Adenta Municipal Assembly'), (select id from public.services where code = 'JAN'), 'Municipal office cleaning (12 months)', 'Adenta Municipal Office', 0, (select id from public.profiles where email = 'sales@demo.fm')) returning id into v_id;
  perform public.apply_estimate_template(v_id, (select default_template_id from public.services where code = 'JAN'));
  update public.estimates set proposed_price = round(recommended_price * 0.9, 0) where id = v_id;
  perform public.submit_estimate(v_id);
  insert into public.estimates (lead_id, service_id, title, site, proposed_price, created_by)
  values ((select id from public.leads where name = 'Mr George Asiedu'), (select id from public.services where code = 'CAB'), 'Market-day cabins', 'Madina Market', 0, (select id from public.profiles where email = 'sales@demo.fm')) returning id into v_id;
  perform public.apply_estimate_template(v_id, (select default_template_id from public.services where code = 'CAB'));
  update public.estimates set proposed_price = recommended_price where id = v_id;
  perform public.submit_estimate(v_id);
  perform public.create_quotation(v_id);

  -- an estimate that was converted into one of the closed jobs (shows estimate vs actual variance)
  insert into public.estimates (customer_id, service_id, title, site, proposed_price, created_by)
  values ((select id from public.customers where display_name = 'Mrs Comfort Asamoah'), (select id from public.services where code = 'CES'), 'Septic tank emptying', 'House 12, Dzorwulu', 0,
          (select id from public.profiles where email = 'sales@demo.fm')) returning id into v_id;
  perform public.apply_estimate_template(v_id, (select default_template_id from public.services where code = 'CES'));
  update public.estimates set proposed_price = 1200 where id = v_id;
  perform public.submit_estimate(v_id);
  select j.id into v_j from public.job_orders j join public.customers c on c.id = j.customer_id where c.display_name = 'Mrs Comfort Asamoah' and j.status = 'closed' limit 1;
  update public.estimates set status = case when status = 'pending_approval' then 'approved' else status end where id = v_id;
  update public.estimates set status = 'converted', converted_job_id = v_j where id = v_id;
  update public.job_orders set estimate_id = v_id where id = v_j;

  refresh materialized view public.mv_customer_stats;
  raise notice 'Demo data loaded';
end $$;

commit;
-- ====================== DEMO DATA END ======================
