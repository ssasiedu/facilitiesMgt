import { supabase } from '@/lib/supabaseClient';
import { check, nullify, rpc } from '@/lib/rpc';
import type { EstimateForm } from '@/lib/schemas';
import type { CostCategory, EstimateLineInput } from '@/lib/calc';
import type { PickerItem } from '@/components/ui/AsyncPicker';
import type { Tables } from '@/types/database';

export type Estimate = Tables<'estimates'>;
export type EstimateLine = Tables<'estimate_lines'>;
export type Quotation = Tables<'quotations'>;

export interface EstimateWithLines extends Estimate {
  estimate_lines: EstimateLine[];
  customer: { id: string; display_name: string | null; customer_code: string | null } | null;
  lead: { id: string; name: string } | null;
  service: { id: string; name: string } | null;
}

export async function loadEstimate(id: string): Promise<EstimateWithLines> {
  return check(await supabase.from('estimates')
    .select('*, estimate_lines(*), customer:customers(id, display_name, customer_code), lead:leads(id, name), service:services(id, name)')
    .eq('id', id).single()) as EstimateWithLines;
}

const HEADER_FIELDS = [
  'customer_id', 'lead_id', 'service_id', 'title', 'site', 'duration_days', 'hours_per_day', 'is_recurring',
  'visits_per_period', 'visit_period', 'contract_months', 'overhead_pct', 'contingency_pct', 'target_margin_pct',
  'tax_pct', 'proposed_price', 'notes',
] as const;

function headerRow(v: EstimateForm) {
  const out: Record<string, unknown> = {};
  for (const k of HEADER_FIELDS) out[k] = (v as Record<string, unknown>)[k];
  return nullify(out);
}

function lineRow(l: EstimateForm['lines'][number], estimateId: string, index: number) {
  return nullify({
    estimate_id: estimateId,
    cost_item_id: l.cost_item_id || null,
    category: l.category,
    description: l.description,
    unit_of_measure: l.unit_of_measure || null,
    basis: l.basis,
    quantity: l.quantity,
    headcount: l.headcount,
    days: l.days,
    km: l.km,
    rate_basis: l.rate_basis,
    unit_cost: l.unit_cost,
    cost_per_trip: l.cost_per_trip,
    cost_per_km: l.cost_per_km,
    cost_per_day: l.cost_per_day,
    sort_order: index + 1,
  });
}

/** Save the header and replace the lines. The database recomputes every total (0013/0014). */
export async function saveEstimate(id: string | undefined, v: EstimateForm): Promise<string> {
  let estimateId = id;
  if (estimateId) {
    check(await supabase.from('estimates').update(headerRow(v)).eq('id', estimateId));
    check(await supabase.from('estimate_lines').delete().eq('estimate_id', estimateId));
  } else {
    const created = check(await supabase.from('estimates').insert(headerRow(v)).select('id').single()) as { id: string };
    estimateId = created.id;
  }
  if (v.lines.length) {
    check(await supabase.from('estimate_lines').insert(v.lines.map((l, i) => lineRow(l, estimateId as string, i))));
  }
  return estimateId;
}

/** Pull a template's lines and drivers into a draft estimate (server-side, so costs are snapshotted). */
export const applyTemplate = (estimateId: string, templateId: string) =>
  rpc('apply_estimate_template', { p_estimate_id: estimateId, p_template_id: templateId });

export const submitEstimate = (id: string) => rpc<string>('submit_estimate', { p_estimate_id: id });
export const approveEstimate = (id: string) => rpc('approve_estimate', { p_estimate_id: id });
export const rejectEstimate = (id: string, reason: string) => rpc('reject_estimate', { p_estimate_id: id, p_reason: reason });
export const newVersion = (id: string) => rpc<string>('new_estimate_version', { p_estimate_id: id });
export const createQuotation = (id: string, validDays?: number, terms?: string) =>
  rpc<string>('create_quotation', { p_estimate_id: id, p_valid_days: validDays, p_terms: terms });
export const setQuotationStatus = (id: string, status: string) => rpc('set_quotation_status', { p_quote_id: id, p_status: status });
export const convertToJob = (id: string, executionDate?: string) => rpc<string>('convert_estimate_to_job', { p_estimate_id: id, p_execution_date: executionDate });
export const convertToContract = (id: string, startDate?: string) => rpc<string>('convert_estimate_to_contract', { p_estimate_id: id, p_start_date: startDate });

export async function searchLeads(q: string): Promise<PickerItem[]> {
  let query = supabase.from('leads').select('id, name, company_name, phone, stage').is('archived_at', null).order('created_at', { ascending: false }).limit(20);
  if (q) query = query.or([`name.ilike.%${q.replace(/[,()]/g, ' ')}%`, `company_name.ilike.%${q.replace(/[,()]/g, ' ')}%`].join(','));
  const rows = check(await query) as { id: string; name: string; company_name: string | null; phone: string | null; stage: string }[];
  return rows.map((r) => ({ id: r.id, label: r.name, sub: [r.company_name, r.phone, r.stage].filter(Boolean).join(' · ') }));
}

export async function searchEstimates(q: string): Promise<PickerItem[]> {
  let query = supabase.from('estimates').select('id, estimate_no, title, version, proposed_price, status').in('status', ['approved', 'quoted', 'accepted'])
    .is('archived_at', null).order('created_at', { ascending: false }).limit(20);
  if (q) query = query.or([`estimate_no.ilike.%${q}%`, `title.ilike.%${q.replace(/[,()]/g, ' ')}%`].join(','));
  const rows = check(await query) as { id: string; estimate_no: string | null; title: string | null; version: number; proposed_price: number; status: string }[];
  return rows.map((r) => ({ id: r.id, label: `${r.estimate_no ?? 'Draft'} v${r.version}`, sub: [r.title, r.status].filter(Boolean).join(' · ') }));
}

/** An estimate_lines row in the shape the live what-if calculator needs. */
export function toCalcLine(l: {
  category: string; basis: string; quantity: number; headcount: number; days: number; km: number;
  unit_cost: number; cost_per_trip: number; cost_per_km: number; cost_per_day: number; rate_basis: string;
}): EstimateLineInput {
  return {
    category: l.category as CostCategory,
    basis: l.basis === 'per_visit' ? 'per_visit' : 'total',
    quantity: Number(l.quantity), headcount: Number(l.headcount), days: Number(l.days), km: Number(l.km),
    unit_cost: Number(l.unit_cost), cost_per_trip: Number(l.cost_per_trip), cost_per_km: Number(l.cost_per_km), cost_per_day: Number(l.cost_per_day),
    rate_basis: l.rate_basis === 'hour' ? 'hour' : 'day',
  };
}
