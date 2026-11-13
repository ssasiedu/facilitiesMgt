import { z } from 'zod';
import { DIGITAL_ADDRESS_RE, GHANA_CARD_RE, normalizePhone } from './format';

// Shared validation for forms and for the API layer (each api.ts parses with these before sending).

const text = z.string().trim();
export const optText = text.optional().or(z.literal(''));
export const reqText = (label: string) => text.min(1, `${label} is required`);
export const money = z.coerce.number({ invalid_type_error: 'Enter an amount' }).min(0, 'Cannot be negative').max(999_999_999_999.99);
export const positiveMoney = z.coerce.number({ invalid_type_error: 'Enter an amount' }).gt(0, 'Must be more than zero');
export const quantity = z.coerce.number({ invalid_type_error: 'Enter a number' }).min(0, 'Cannot be negative');
export const pct = z.coerce.number().min(0).max(99.999);
export const dateStr = text.regex(/^\d{4}-\d{2}-\d{2}$/, 'Choose a date');
export const optDate = dateStr.optional().or(z.literal(''));
export const uuid = z.string().uuid('Choose an option');
export const optUuid = z.string().uuid().optional().or(z.literal(''));

export const phone = text.refine((v) => !!normalizePhone(v), 'Enter a Ghana number, e.g. 024 412 3456');
export const optPhone = text.optional().or(z.literal('')).refine((v) => !v || !!normalizePhone(v), 'Enter a Ghana number, e.g. 024 412 3456');
export const optEmail = text.email('Enter a valid email').optional().or(z.literal(''));
export const ghanaCard = text.optional().or(z.literal('')).refine((v) => !v || GHANA_CARD_RE.test(v.toUpperCase()), 'Format: GHA-XXXXXXXXX-X');
export const digitalAddress = text.optional().or(z.literal('')).refine((v) => !v || DIGITAL_ADDRESS_RE.test(v.toUpperCase()), 'Format: GA-123-4567');

export const SOURCES = ['call_in', 'walk_in', 'sales_field', 'zonal_officer', 'referral', 'website'] as const;
export const TRUCK_TYPES = ['cesspit_emptier', 'water_tanker', 'cabin_carrier', 'pickup', 'other'] as const;
export const UOMS = ['per_trip', 'per_day', 'per_cabin_per_day', 'per_m2', 'per_visit', 'per_month', 'per_event'] as const;
export const OFF_ROAD_REASONS = ['breakdown', 'preventive_maintenance', 'accident', 'awaiting_parts', 'documents_expired'] as const;
export const PAYMENT_METHODS = ['cash', 'mtn_momo', 'telecel_cash', 'at_money', 'bank_transfer', 'cheque', 'card'] as const;

export const customerSchema = z.object({
  customer_type: z.enum(['individual', 'company']),
  title: optText, first_name: optText, middle_name: optText, last_name: optText,
  gender: z.enum(['male', 'female', 'other']).optional().or(z.literal('')),
  birth_day: z.coerce.number().int().min(0).max(31).optional(), birth_month: z.coerce.number().int().min(0).max(12).optional(),
  birth_year: z.coerce.number().int().min(0).max(2100).optional(),
  ghana_card_no: ghanaCard, phone: optPhone, alt_phone: optPhone, whatsapp: optPhone, email: optEmail,
  occupation: optText, residential_address: optText,
  company_name: optText, trading_name: optText, registration_no: optText, tin: optText, sector: optText,
  company_phone: optPhone, company_email: optEmail,
  digital_address: digitalAddress, region: optText, district: optText, zone_id: optUuid,
  source: z.enum(SOURCES), assigned_to: optUuid, preferred_channel: z.enum(['sms', 'email', 'whatsapp']),
  sms_opt_in: z.boolean(), marketing_consent: z.boolean(), credit_limit: money, payment_terms_days: z.coerce.number().int().min(0).max(365),
  tags: optText, notes: optText, status: z.enum(['active', 'inactive', 'blacklisted']),
}).superRefine((v, ctx) => {
  if (v.customer_type === 'individual') {
    if (!v.first_name) ctx.addIssue({ code: 'custom', path: ['first_name'], message: 'First name is required' });
    if (!v.last_name) ctx.addIssue({ code: 'custom', path: ['last_name'], message: 'Last name is required' });
    if (!v.phone) ctx.addIssue({ code: 'custom', path: ['phone'], message: 'Primary phone is required' });
  } else {
    if (!v.company_name) ctx.addIssue({ code: 'custom', path: ['company_name'], message: 'Company name is required' });
    if (!v.company_phone) ctx.addIssue({ code: 'custom', path: ['company_phone'], message: 'Company phone is required' });
  }
});
export type CustomerForm = z.infer<typeof customerSchema>;

export const contactSchema = z.object({
  name: reqText('Name'), position: optText, phone: optPhone, email: optEmail, ghana_card_no: ghanaCard,
  is_primary: z.boolean(), receives_invoices: z.boolean(),
});
export type ContactForm = z.infer<typeof contactSchema>;

export const leadSchema = z.object({
  name: reqText('Name'), company_name: optText, phone: optPhone, email: optEmail, service_id: optUuid,
  source: z.enum(SOURCES), location: optText, zone_id: optUuid, estimated_value: money, owner_id: optUuid,
  stage: z.enum(['new', 'contacted', 'site_visit', 'estimate_sent', 'negotiation', 'won', 'lost']),
  lost_reason: optText, next_follow_up: optDate, notes: optText,
}).refine((v) => v.stage !== 'lost' || !!v.lost_reason, { path: ['lost_reason'], message: 'Give a reason for losing the lead' });
export type LeadForm = z.infer<typeof leadSchema>;

export const leadActivitySchema = z.object({
  activity_type: z.enum(['call', 'visit', 'meeting', 'sms', 'email', 'note']), outcome: optText, notes: optText,
});

export const serviceSchema = z.object({
  code: reqText('Code').max(12), name: reqText('Name'), description: optText, unit_of_measure: z.enum(UOMS), default_price: money,
  taxable: z.boolean(), requires_truck: z.boolean(), required_truck_type: z.enum(TRUCK_TYPES).optional().or(z.literal('')),
  revenue_account_id: optUuid, default_template_id: optUuid, active: z.boolean(),
}).refine((v) => !v.requires_truck || !!v.required_truck_type, { path: ['required_truck_type'], message: 'Choose the truck type' });

export const costItemSchema = z.object({
  code: reqText('Code'), name: reqText('Name'),
  category: z.enum(['consumable', 'equipment', 'labour', 'vehicle', 'subcontract', 'overhead']), unit_of_measure: reqText('Unit'),
  unit_cost: money, rate_basis: z.enum(['day', 'hour']), cost_per_trip: money, cost_per_km: money, cost_per_day: money,
  truck_type: z.enum(TRUCK_TYPES).optional().or(z.literal('')), preferred_supplier: optText, track_stock: z.boolean(), reorder_level: quantity, active: z.boolean(),
});

export const estimateLineSchema = z.object({
  id: z.string().optional(), cost_item_id: optUuid,
  category: z.enum(['consumable', 'equipment', 'labour', 'vehicle', 'subcontract', 'overhead']), description: reqText('Description'),
  unit_of_measure: optText, basis: z.enum(['per_visit', 'total']), quantity, headcount: quantity, days: quantity, km: quantity,
  unit_cost: money, cost_per_trip: money, cost_per_km: money, cost_per_day: money, rate_basis: z.enum(['day', 'hour']),
});
export const estimateSchema = z.object({
  customer_id: optUuid, lead_id: optUuid, service_id: uuid, title: optText, site: optText,
  duration_days: z.coerce.number().gt(0), hours_per_day: z.coerce.number().gt(0).max(24), is_recurring: z.boolean(),
  visits_per_period: z.coerce.number().gt(0), visit_period: z.enum(['week', 'month']), contract_months: z.coerce.number().int().min(1).max(120),
  overhead_pct: pct, contingency_pct: pct, target_margin_pct: pct, tax_pct: pct, proposed_price: money, notes: optText,
  lines: z.array(estimateLineSchema),
}).refine((v) => !!v.customer_id || !!v.lead_id, { path: ['customer_id'], message: 'Choose a customer or a lead' });
export type EstimateForm = z.infer<typeof estimateSchema>;

export const jobLineSchema = z.object({
  service_id: uuid, description: optText, quantity: z.coerce.number().gt(0, 'Quantity must be more than zero'), unit_price: money, discount: money, taxable: z.boolean(),
}).refine((l) => l.discount <= l.quantity * l.unit_price, { path: ['discount'], message: 'Discount is more than the line amount' });
export const jobOrderSchema = z.object({
  customer_id: uuid, contact_id: optUuid, channel: z.enum(['call_in', 'walk_in', 'sales']), priority: z.enum(['low', 'normal', 'high', 'urgent']),
  site_address: reqText('Site address'), digital_address: digitalAddress, site_lat: z.coerce.number().min(-90).max(90).optional().or(z.literal('')),
  site_lng: z.coerce.number().min(-180).max(180).optional().or(z.literal('')),
  officer_id: optUuid, execution_date: dateStr, end_date: optDate, time_window: optText, contract_id: optUuid, estimate_id: optUuid,
  instructions: optText, lines: z.array(jobLineSchema).min(1, 'Add at least one service line'),
  truck_ids: z.array(z.string().uuid()), driver_id: optUuid, crew_ids: z.array(z.string().uuid()),
}).refine((v) => !v.end_date || v.end_date >= v.execution_date, { path: ['end_date'], message: 'End date is before the start date' });
export type JobOrderForm = z.infer<typeof jobOrderSchema>;

export const completeJobSchema = z.object({
  signoff_name: reqText('Customer sign-off name'), notes: optText,
  actuals: z.array(z.object({
    category: z.enum(['consumable', 'equipment', 'labour', 'vehicle', 'subcontract', 'overhead', 'fuel', 'other']),
    cost_item_id: optUuid, employee_id: optUuid, description: reqText('Description'), quantity: quantity, unit_cost: money, stock_location_id: optUuid,
  })),
});
export type CompleteJobForm = z.infer<typeof completeJobSchema>;

export const truckSchema = z.object({
  registration_no: reqText('Registration number'), fleet_code: optText, truck_type: z.enum(TRUCK_TYPES), make: optText, model: optText,
  year: z.coerce.number().int().min(0).max(2100).optional(), capacity_litres: z.coerce.number().min(0).optional(), capacity_cabins: z.coerce.number().int().min(0).optional(),
  chassis_no: optText, fuel_type: z.enum(['diesel', 'petrol', 'other']), odometer_km: quantity, assigned_driver_id: optUuid,
});
export const truckStatusSchema = z.object({
  status: z.enum(['on_road', 'off_road']), reason: z.enum(OFF_ROAD_REASONS).optional().or(z.literal('')),
  expected_return: optDate, note: optText,
}).superRefine((v, ctx) => {
  if (v.status === 'off_road') {
    if (!v.reason) ctx.addIssue({ code: 'custom', path: ['reason'], message: 'Choose a reason' });
    if (!v.expected_return) ctx.addIssue({ code: 'custom', path: ['expected_return'], message: 'Expected return date is required' });
    if (!v.note) ctx.addIssue({ code: 'custom', path: ['note'], message: 'Add a note' });
  }
});
export const employeeSchema = z.object({
  full_name: reqText('Name'), role_type: z.enum(['driver', 'cleaner', 'supervisor', 'gardener', 'technician', 'loader', 'other']),
  phone: optPhone, ghana_card_no: ghanaCard, daily_rate: money, status: z.enum(['active', 'on_leave', 'inactive']), profile_id: optUuid,
  licence_no: optText, licence_class: optText, licence_expiry: optDate, hired_on: optDate, notes: optText,
}).refine((v) => v.role_type !== 'driver' || !!v.licence_no, { path: ['licence_no'], message: 'Drivers need a licence number' });
export const truckDocSchema = z.object({ doc_type: z.enum(['insurance', 'roadworthy', 'permit', 'other']), doc_number: optText, issue_date: optDate, expiry_date: dateStr, notes: optText });
export const maintenanceScheduleSchema = z.object({ truck_id: uuid, title: reqText('Title'), interval_days: z.coerce.number().int().min(0).optional(), interval_km: z.coerce.number().min(0).optional(), next_due_date: optDate, next_due_km: z.coerce.number().min(0).optional() });
export const maintenanceRecordSchema = z.object({ truck_id: uuid, schedule_id: optUuid, service_date: dateStr, workshop: optText, work_done: reqText('Work done'), parts: optText, cost: money, odometer_km: z.coerce.number().min(0).optional(), paid_from_bank_account_id: optUuid });
export const fuelLogSchema = z.object({ truck_id: uuid, log_date: dateStr, litres: z.coerce.number().gt(0), cost: money, odometer_km: z.coerce.number().min(0).optional(), job_order_id: optUuid, station: optText, paid_from_bank_account_id: optUuid });

export const contractSchema = z.object({
  customer_id: uuid, contract_type: z.enum(['one_off', 'recurring']), title: reqText('Title'), description: optText,
  start_date: dateStr, end_date: dateStr, billing_frequency: z.enum(['weekly', 'monthly', 'quarterly']), amount_per_period: money, total_agreed: money,
  billing_day: z.coerce.number().int().min(1).max(28), payment_terms_days: z.coerce.number().int().min(0), taxable: z.boolean(), service_id: optUuid,
  auto_send: z.boolean(), prorate: z.boolean(), price_review_date: optDate, supervisor_id: optUuid, estimate_id: optUuid,
  budgeted_monthly_cost: money, overhead_pct: pct, renewal_reminder_days: z.coerce.number().int().min(0),
  services: z.array(z.object({ service_id: uuid, description: optText, quantity: quantity, unit_price: money })),
  sites: z.array(z.object({ name: reqText('Site name'), address: optText, digital_address: digitalAddress })),
}).refine((v) => v.end_date >= v.start_date, { path: ['end_date'], message: 'End date is before the start date' })
  .refine((v) => v.contract_type === 'one_off' || v.amount_per_period > 0, { path: ['amount_per_period'], message: 'Enter the amount per period' })
  .refine((v) => v.contract_type === 'recurring' || v.total_agreed > 0, { path: ['total_agreed'], message: 'Enter the agreed total' });
export type ContractForm = z.infer<typeof contractSchema>;

export const supplySchema = z.object({ contract_id: uuid, supply_date: dateStr, cost_item_id: uuid, quantity: z.coerce.number().gt(0), unit_cost: money, site_id: optUuid, stock_location_id: optUuid, received_by: optText, notes: optText });
export const labourSchema = z.object({ contract_id: uuid, work_date: dateStr, employee_id: optUuid, role_description: optText, staff_count: quantity, days: quantity, rate: money, actual_wage_amount: z.coerce.number().min(0).optional().or(z.literal('')), kind: z.enum(['labour', 'vehicle', 'other']), notes: optText });

export const paymentSchema = z.object({
  customer_id: uuid, amount: positiveMoney, method: z.enum(PAYMENT_METHODS), payment_date: dateStr, reference: optText,
  bank_account_id: optUuid, notes: optText, allocations: z.array(z.object({ invoice_id: z.string().uuid(), amount: money })),
}).refine((v) => !['mtn_momo', 'telecel_cash', 'at_money', 'bank_transfer', 'cheque'].includes(v.method) || !!v.reference, { path: ['reference'], message: 'Enter the transaction reference' })
  .refine((v) => v.allocations.reduce((s, a) => s + a.amount, 0) <= v.amount + 0.001, { path: ['allocations'], message: 'Allocations are more than the payment' });
export type PaymentForm = z.infer<typeof paymentSchema>;

export const invoiceSchema = z.object({
  customer_id: uuid, issue_date: dateStr, due_date: optDate, notes: optText, terms: optText,
  lines: z.array(z.object({ service_id: optUuid, description: reqText('Description'), quantity: z.coerce.number().gt(0), unit_price: money, discount: money, taxable: z.boolean() })).min(1),
});
export const creditNoteSchema = z.object({ amount: positiveMoney, reason: reqText('Reason') });

export const journalSchema = z.object({
  entry_date: dateStr, description: reqText('Description'), recur_frequency: z.enum(['none', 'monthly', 'quarterly']),
  lines: z.array(z.object({ account_id: uuid, description: optText, debit: money, credit: money })).min(2, 'A journal needs at least two lines'),
}).refine((v) => Math.abs(v.lines.reduce((s, l) => s + l.debit - l.credit, 0)) < 0.005, { path: ['lines'], message: 'Debits and credits must be equal' })
  .refine((v) => v.lines.every((l) => (l.debit > 0) !== (l.credit > 0)), { path: ['lines'], message: 'Each line needs either a debit or a credit' });
export type JournalForm = z.infer<typeof journalSchema>;

export const supplierSchema = z.object({ name: reqText('Name'), phone: optPhone, email: optEmail, tin: optText, address: optText, payment_terms_days: z.coerce.number().int().min(0), notes: optText });
export const billSchema = z.object({
  supplier_id: uuid, supplier_ref: optText, bill_date: dateStr, due_date: optDate, job_order_id: optUuid, contract_id: optUuid, truck_id: optUuid, notes: optText,
  lines: z.array(z.object({ account_id: uuid, description: reqText('Description'), cost_item_id: optUuid, quantity: z.coerce.number().gt(0), unit_cost: money, stock_location_id: optUuid })).min(1),
});
export type BillForm = z.infer<typeof billSchema>;
export const expenseSchema = z.object({
  expense_date: dateStr, account_id: uuid, amount: positiveMoney, supplier_id: optUuid, payee: optText, description: reqText('Description'),
  job_order_id: optUuid, contract_id: optUuid, truck_id: optUuid,
});

export const taskSchema = z.object({
  title: reqText('Title'), task_type_id: uuid, customer_id: optUuid, lead_id: optUuid, target_org: optText, contact_name: optText, contact_phone: optPhone,
  location: optText, planned_date: dateStr, priority: z.enum(['low', 'normal', 'high', 'urgent']), expected_outcome: optText,
});
export const planSchema = z.object({
  title: reqText('Title'), period_type: z.enum(['day', 'week', 'custom']), start_date: dateStr, end_date: dateStr, zone_id: optUuid, notes: optText,
  tasks: z.array(taskSchema).min(1, 'Add at least one task'),
}).refine((v) => v.end_date >= v.start_date, { path: ['end_date'], message: 'End date is before the start date' });
export type PlanForm = z.infer<typeof planSchema>;
export const taskUpdateSchema = z.object({
  status: z.enum(['planned', 'in_progress', 'completed', 'pending', 'postponed', 'cancelled']), notes: optText, next_step: optText,
  follow_up_date: optDate, deal_value: money,
});

export const taxSchema = z.object({ code: reqText('Code'), name: reqText('Name'), rate: z.coerce.number().min(0).max(100), compound: z.boolean(), account_id: optUuid, active: z.boolean(), sort_order: z.coerce.number().int() });
export const templateSchema = z.object({ subject: optText, body: reqText('Message'), active: z.boolean() });
export const inviteSchema = z.object({ email: text.email('Enter a valid email'), full_name: reqText('Name'), phone: optPhone, roles: z.array(z.string()).min(1, 'Choose at least one role'), zone_ids: z.array(z.string()) });

export const companySettingsSchema = z.object({
  company_name: reqText('Registered name'), trading_name: optText, address: optText, digital_address: digitalAddress,
  tin: optText, phones: optText, email: optEmail, website: optText,
  bank_details: optText, momo_details: optText, payment_details_sms: reqText('Payment line for SMS'),
  invoice_terms: optText, invoice_footer: optText,
  brand_color: text.regex(/^#[0-9a-fA-F]{6}$/, 'Use a hex colour such as #15803d'),
  sms_sender_id: reqText('Sender ID').max(11, 'Up to 11 characters'),
  public_app_url: text.url('Enter the full address, starting with https://'),
  default_payment_terms_days: z.coerce.number().int().min(0, 'Cannot be negative').max(365, 'Use 365 days or fewer'),
});
export type CompanySettingsValues = z.infer<typeof companySettingsSchema>;

export const configurationSchema = z.object({
  segregation_of_duties: z.boolean(),
  estimate_margin_threshold: z.coerce.number().min(0, 'Cannot be negative').max(100, 'Use 100 or less'),
  contract_margin_threshold: z.coerce.number().min(0, 'Cannot be negative').max(100, 'Use 100 or less'),
  overdue_reminder_days: text.regex(/^\s*\d+(\s*,\s*\d+)*\s*$/, 'Days after the due date, separated by commas'),
  survey_expiry_days: z.coerce.number().int().min(1, 'At least one day').max(365),
  survey_low_score: z.coerce.number().int().min(1).max(5),
  survey_low_nps: z.coerce.number().int().min(0).max(10),
  fiscal_year_start_month: z.coerce.number().int().min(1).max(12),
  lock_date: optDate,
  online_payments_enabled: z.boolean(),
  sms_provider: reqText('SMS provider'), email_provider: reqText('Email provider'), payment_provider: reqText('Payment provider'),
});
export type ConfigurationValues = z.infer<typeof configurationSchema>;

export const profileSchema = z.object({ full_name: reqText('Name'), phone: optPhone, email: optEmail });
export const passwordSchema = z.object({
  password: text.min(10, 'Use at least 10 characters'),
  confirm: text.min(1, 'Repeat the password'),
}).refine((v) => v.password === v.confirm, { path: ['confirm'], message: 'The two passwords are different' });
export const followupResolveSchema = z.object({ resolution: reqText('What was done') });
export const sequenceSchema = z.object({
  prefix: reqText('Prefix').max(10, 'Up to 10 characters'),
  padding: z.coerce.number().int().min(1, 'At least 1').max(10),
  per_year: z.boolean(),
});
