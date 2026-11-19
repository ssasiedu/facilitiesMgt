import { supabase } from '@/lib/supabaseClient';
import { check, nullify, rpc } from '@/lib/rpc';
import type { CompleteJobForm, JobOrderForm } from '@/lib/schemas';
import type { PickerItem } from '@/components/ui/AsyncPicker';
import type { Tables } from '@/types/database';

export type JobOrder = Tables<'job_orders'>;
export type JobLine = Tables<'job_order_lines'>;
export type JobAssignment = Tables<'job_order_assignments'>;

export interface JobOrderFull extends JobOrder {
  job_order_lines: (JobLine & { service: { id: string; name: string; requires_truck: boolean; required_truck_type: string | null } | null })[];
  job_order_assignments: (JobAssignment & { truck: { id: string; registration_no: string; truck_type: string } | null; employee: { id: string; full_name: string; phone: string | null; role_type: string } | null })[];
  job_order_photos: Tables<'job_order_photos'>[];
  job_order_actual_costs: (Tables<'job_order_actual_costs'> & { cost_item: { name: string } | null })[];
  job_order_status_history: (Tables<'job_order_status_history'> & { profile: { full_name: string } | null })[];
  customer: { id: string; display_name: string | null; customer_code: string | null; phone: string | null; company_phone: string | null; email: string | null; company_email: string | null; status: string; payment_terms_days: number } | null;
  contact: { id: string; name: string; phone: string | null } | null;
  officer: { id: string; full_name: string; phone: string | null } | null;
  raiser: { id: string; full_name: string } | null;
  approver: { full_name: string } | null;
  invoice: { id: string; invoice_no: string | null; status: string; total: number; balance: number; due_date: string | null } | null;
  contract: { id: string; contract_no: string | null; title: string; contract_type: string } | null;
  estimate: { id: string; estimate_no: string | null; total_cost: number } | null;
}

const FULL_SELECT = `
  *,
  job_order_lines(*, service:services(id, name, requires_truck, required_truck_type)),
  job_order_assignments(*, truck:trucks(id, registration_no, truck_type), employee:employees(id, full_name, phone, role_type)),
  job_order_photos(*),
  job_order_actual_costs(*, cost_item:cost_items(name)),
  job_order_status_history(*, profile:profiles(full_name)),
  customer:customers(id, display_name, customer_code, phone, company_phone, email, company_email, status, payment_terms_days),
  contact:customer_contacts(id, name, phone),
  officer:profiles!job_orders_officer_id_fkey(id, full_name, phone),
  raiser:profiles!job_orders_raised_by_fkey(id, full_name),
  approver:profiles!job_orders_approved_by_fkey(full_name),
  invoice:invoices!job_orders_invoice_fk(id, invoice_no, status, total, balance, due_date),
  contract:contracts(id, contract_no, title, contract_type),
  estimate:estimates!job_orders_estimate_id_fkey(id, estimate_no, total_cost)
`;

export async function loadJobOrder(id: string): Promise<JobOrderFull> {
  return check(await supabase.from('job_orders').select(FULL_SELECT).eq('id', id).single()) as JobOrderFull;
}

/** Truck availability for a date range, with the reason a truck cannot be picked. */
export interface TruckAvailability {
  truck_id: string; registration_no: string; fleet_code: string | null; truck_type: string; status: string;
  off_road_reason: string | null; expected_return_date: string | null; driver_id: string | null; driver_name: string | null;
  capacity: string | null; bookings: { job_id: string; job_no: string | null; customer: string | null; from: string; to: string; clashes: boolean }[];
  available: boolean; reason: string | null;
}

/** Times are optional: without them the job holds its trucks for the whole day, as it always did. */
export const truckAvailability = (from: string, to: string, type?: string, excludeJob?: string, start?: string, end?: string) =>
  rpc<TruckAvailability[]>('get_truck_availability', {
    p_from: from, p_to: to, p_type: type || undefined, p_exclude_job: excludeJob || undefined,
    p_start: start || undefined, p_end: end || undefined,
  });

const HEADER_FIELDS = [
  'customer_id', 'contact_id', 'channel', 'priority', 'site_address', 'digital_address', 'site_lat', 'site_lng',
  'officer_id', 'execution_date', 'end_date', 'start_time', 'end_time', 'contract_id', 'estimate_id', 'instructions',
] as const;

function headerRow(v: JobOrderForm) {
  const out: Record<string, unknown> = {};
  for (const k of HEADER_FIELDS) out[k] = (v as Record<string, unknown>)[k];
  return nullify(out);
}

/**
 * Save a draft job order: header, service lines and assignments. The database computes the
 * agreed amount and fills the driver from the truck; approval and booking happen in the RPC.
 */
export async function saveJobOrder(id: string | undefined, v: JobOrderForm): Promise<string> {
  let jobId = id;
  if (jobId) {
    check(await supabase.from('job_orders').update(headerRow(v)).eq('id', jobId));
    check(await supabase.from('job_order_lines').delete().eq('job_order_id', jobId));
    check(await supabase.from('job_order_assignments').delete().eq('job_order_id', jobId));
  } else {
    const created = check(await supabase.from('job_orders').insert(headerRow(v)).select('id').single()) as { id: string };
    jobId = created.id;
  }

  check(await supabase.from('job_order_lines').insert(v.lines.map((l, i) => nullify({
    job_order_id: jobId, service_id: l.service_id, description: l.description || null,
    quantity: l.quantity, unit_price: l.unit_price, discount: l.discount, taxable: l.taxable, sort_order: i + 1,
  }))));

  const assignments: Record<string, unknown>[] = [
    ...v.truck_ids.map((truckId) => ({ job_order_id: jobId, kind: 'truck', truck_id: truckId })),
    ...(v.driver_id ? [{ job_order_id: jobId, kind: 'driver', employee_id: v.driver_id }] : []),
    ...v.crew_ids.map((employeeId) => ({ job_order_id: jobId, kind: 'crew', employee_id: employeeId })),
  ];
  if (assignments.length) check(await supabase.from('job_order_assignments').insert(assignments));
  return jobId;
}

export const submitJob = (id: string) => rpc<Record<string, unknown>>('submit_job_order', { p_job_id: id });
export const approveJob = (id: string) => rpc<Record<string, unknown>>('approve_job_order', { p_job_id: id });
export const rejectJob = (id: string, reason: string) => rpc('reject_job_order', { p_job_id: id, p_reason: reason });
export const startJob = (id: string, lat?: number, lng?: number) => rpc('start_job_order', { p_job_id: id, p_lat: lat, p_lng: lng });
export const completeJob = (id: string, v: CompleteJobForm, signaturePath?: string) =>
  rpc('complete_job_order', {
    p_job_id: id,
    p_signoff_name: v.signoff_name,
    p_signature_path: signaturePath,
    p_notes: v.notes || undefined,
    p_actuals: v.actuals.map((a) => ({
      category: a.category, cost_item_id: a.cost_item_id || null, employee_id: a.employee_id || null,
      description: a.description, quantity: a.quantity, unit_cost: a.unit_cost, stock_location_id: a.stock_location_id || null,
    })),
  });
export const cancelJob = (id: string, reason: string) => rpc('cancel_job_order', { p_job_id: id, p_reason: reason });
export const holdJob = (id: string, reason: string) => rpc('hold_job_order', { p_job_id: id, p_reason: reason });
export const resumeJob = (id: string) => rpc('resume_job_order', { p_job_id: id });
export const reassignTruck = (jobId: string, oldTruck: string, newTruck: string) =>
  rpc('reassign_job_truck', { p_job_id: jobId, p_old_truck: oldTruck, p_new_truck: newTruck });

export async function addJobPhoto(jobId: string, kind: 'before' | 'after' | 'site' | 'signature', path: string, caption?: string) {
  check(await supabase.from('job_order_photos').insert({ job_order_id: jobId, kind, file_path: path, caption: caption ?? null }));
}

export async function searchJobOrders(q: string): Promise<PickerItem[]> {
  let query = supabase.from('job_orders').select('id, job_no, customer_name, execution_date, status').is('archived_at', null)
    .order('execution_date', { ascending: false }).limit(20);
  if (q) query = query.or([`job_no.ilike.%${q}%`, `customer_name.ilike.%${q.replace(/[,()]/g, ' ')}%`].join(','));
  const rows = check(await query) as { id: string; job_no: string | null; customer_name: string | null; execution_date: string; status: string }[];
  return rows.map((r) => ({ id: r.id, label: r.job_no ?? 'Draft', sub: [r.customer_name, r.execution_date, r.status].filter(Boolean).join(' · ') }));
}

export async function searchContracts(q: string): Promise<PickerItem[]> {
  let query = supabase.from('contracts').select('id, contract_no, title, contract_type, status').eq('status', 'active')
    .is('archived_at', null).order('created_at', { ascending: false }).limit(20);
  if (q) query = query.or([`contract_no.ilike.%${q}%`, `title.ilike.%${q.replace(/[,()]/g, ' ')}%`].join(','));
  const rows = check(await query) as { id: string; contract_no: string | null; title: string; contract_type: string }[];
  return rows.map((r) => ({ id: r.id, label: `${r.contract_no ?? 'Draft'} · ${r.title}`, sub: r.contract_type === 'recurring' ? 'Recurring' : 'One-off' }));
}

export const JOB_STATUSES = [
  'draft', 'pending_approval', 'approved', 'in_progress', 'completed', 'closed', 'on_hold', 'cancelled',
] as const;

/** Approved estimates that can still be turned into a job order. */
export async function searchEstimatesForJob(q: string): Promise<PickerItem[]> {
  let query = supabase.from('estimates').select('id, estimate_no, title, version, total_cost, proposed_price, status')
    .in('status', ['approved', 'quoted', 'accepted']).is('archived_at', null).order('created_at', { ascending: false }).limit(20);
  if (q) query = query.or([`estimate_no.ilike.%${q}%`, `title.ilike.%${q.replace(/[,()]/g, ' ')}%`].join(','));
  const rows = check(await query) as { id: string; estimate_no: string | null; title: string | null; version: number; proposed_price: number }[];
  return rows.map((r) => ({ id: r.id, label: `${r.estimate_no ?? 'Draft'} v${r.version}`, sub: r.title ?? undefined }));
}
