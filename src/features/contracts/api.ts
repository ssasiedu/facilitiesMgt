import { supabase } from '@/lib/supabaseClient';
import { check, nullify, rpc } from '@/lib/rpc';
import type { ContractForm } from '@/lib/schemas';
import type { Tables, Views } from '@/types/database';

export type Contract = Tables<'contracts'>;

export interface ContractFull extends Contract {
  contract_services: (Tables<'contract_services'> & { service: { id: string; name: string } | null })[];
  contract_sites: Tables<'contract_sites'>[];
  contract_billing_periods: (Tables<'contract_billing_periods'> & { invoice: { id: string; invoice_no: string | null; status: string; total: number; balance: number } | null })[];
  customer: { id: string; display_name: string | null; customer_code: string | null; payment_terms_days: number; email: string | null; company_email: string | null } | null;
  supervisor: { full_name: string } | null;
  approver: { full_name: string } | null;
  estimate: { id: string; estimate_no: string | null; total_cost: number; cost_per_month: number } | null;
  service: { name: string } | null;
}

const FULL_SELECT = `
  *,
  contract_services(*, service:services(id, name)),
  contract_sites(*),
  contract_billing_periods(*, invoice:invoices(id, invoice_no, status, total, balance)),
  customer:customers(id, display_name, customer_code, payment_terms_days, email, company_email),
  supervisor:profiles!contracts_supervisor_id_fkey(full_name),
  approver:profiles!contracts_approved_by_fkey(full_name),
  estimate:estimates(id, estimate_no, total_cost, cost_per_month),
  service:services(name)
`;

export async function loadContract(id: string): Promise<ContractFull> {
  return check(await supabase.from('contracts').select(FULL_SELECT).eq('id', id).single()) as ContractFull;
}

const HEADER_FIELDS = [
  'customer_id', 'contract_type', 'title', 'description', 'start_date', 'end_date', 'billing_frequency',
  'amount_per_period', 'total_agreed', 'billing_day', 'payment_terms_days', 'taxable', 'service_id',
  'auto_send', 'prorate', 'price_review_date', 'supervisor_id', 'estimate_id', 'budgeted_monthly_cost',
  'overhead_pct', 'renewal_reminder_days',
] as const;

function headerRow(v: ContractForm) {
  const out: Record<string, unknown> = {};
  for (const k of HEADER_FIELDS) out[k] = (v as Record<string, unknown>)[k];
  // A one-off contract has no period amount, and a recurring one has no agreed total.
  if (v.contract_type === 'one_off') out.amount_per_period = 0;
  else out.total_agreed = 0;
  return nullify(out);
}

export async function saveContract(id: string | undefined, v: ContractForm): Promise<string> {
  let contractId = id;
  if (contractId) {
    check(await supabase.from('contracts').update(headerRow(v)).eq('id', contractId));
    check(await supabase.from('contract_services').delete().eq('contract_id', contractId));
    check(await supabase.from('contract_sites').delete().eq('contract_id', contractId));
  } else {
    const created = check(await supabase.from('contracts').insert(headerRow(v)).select('id').single()) as { id: string };
    contractId = created.id;
  }
  if (v.services.length) {
    check(await supabase.from('contract_services').insert(v.services.map((s) => nullify({
      contract_id: contractId, service_id: s.service_id, description: s.description || null, quantity: s.quantity, unit_price: s.unit_price,
    }))));
  }
  if (v.sites.length) {
    check(await supabase.from('contract_sites').insert(v.sites.map((s) => nullify({
      contract_id: contractId, name: s.name, address: s.address || null, digital_address: s.digital_address || null,
    }))));
  }
  return contractId;
}

export const submitContract = (id: string) => rpc('submit_contract', { p_contract_id: id });
export const approveContract = (id: string) => rpc('approve_contract', { p_contract_id: id });
export const rejectContract = (id: string, reason: string) => rpc('reject_contract', { p_contract_id: id, p_reason: reason });
export const setContractStatus = (id: string, status: string, reason: string) =>
  rpc('set_contract_status', { p_contract_id: id, p_status: status, p_reason: reason });
/** "Bill now": run the recurring engine for this one contract. Idempotent per period. */
export const billNow = (id: string, billNext = false) =>
  rpc<number>('generate_recurring_invoices', { p_contract_id: id, p_bill_next: billNext });

export interface MonthFigures {
  revenue: number; collected: number; supplies: number; labour: number; vehicle: number; other: number;
  direct_cost: number; overhead: number; gross_profit: number; margin_pct: number | null;
}
export const monthFigures = (contractId: string, month: string) =>
  rpc<MonthFigures>('contract_month_figures', { p_contract_id: contractId, p_month: month });

export type MonthlyProfitability = Views<'v_contract_monthly_profitability'>;
export type ContractProfitability = Views<'v_contract_profitability'>;

export async function loadMonthlyProfitability(contractId: string): Promise<MonthlyProfitability[]> {
  return check(await supabase.from('v_contract_monthly_profitability').select('*')
    .eq('contract_id', contractId).order('month')) as MonthlyProfitability[];
}

export async function loadProfitabilitySummary(contractId: string): Promise<ContractProfitability | null> {
  const rows = check(await supabase.from('v_contract_profitability').select('*').eq('contract_id', contractId).limit(1)) as ContractProfitability[];
  return rows[0] ?? null;
}

export const CONTRACT_STATUSES = ['draft', 'pending_approval', 'active', 'suspended', 'expired', 'terminated', 'rejected'] as const;
