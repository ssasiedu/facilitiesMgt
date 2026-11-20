import { supabase } from '@/lib/supabaseClient';
import { check, nullify, rpc } from '@/lib/rpc';
import type { PickerItem } from '@/components/ui/AsyncPicker';
import type { Tables } from '@/types/database';

export type Invoice = Tables<'invoices'>;

export interface InvoiceFull extends Invoice {
  invoice_lines: (Tables<'invoice_lines'> & { service: { id: string; name: string } | null })[];
  invoice_taxes: Tables<'invoice_taxes'>[];
  customer: { id: string; display_name: string | null; customer_code: string | null; phone: string | null; company_phone: string | null; email: string | null; company_email: string | null; residential_address: string | null; digital_address: string | null; tin: string | null; payment_terms_days: number } | null;
  job_order: { id: string; job_no: string | null; status: string } | null;
  contract: { id: string; contract_no: string | null; title: string } | null;
  payment_allocations: (Tables<'payment_allocations'> & { payment: { id: string; payment_no: string | null; payment_date: string; method_code: string; reference: string | null } | null })[];
  credit_notes: Tables<'credit_notes'>[];
  issuer: { full_name: string } | null;
}

const FULL_SELECT = `
  *,
  invoice_lines(*, service:services(id, name)),
  invoice_taxes(*),
  customer:customers(id, display_name, customer_code, phone, company_phone, email, company_email, residential_address, digital_address, tin, payment_terms_days),
  job_order:job_orders!invoices_job_order_id_fkey(id, job_no, status),
  contract:contracts(id, contract_no, title),
  payment_allocations(*, payment:payments(id, payment_no, payment_date, method_code, reference)),
  credit_notes(*),
  issuer:profiles!invoices_issued_by_fkey(full_name)
`;

export async function loadInvoice(id: string): Promise<InvoiceFull> {
  return check(await supabase.from('invoices').select(FULL_SELECT).eq('id', id).single()) as InvoiceFull;
}

export interface InvoiceFormValues {
  customer_id: string; issue_date: string; due_date: string; notes: string; terms: string; payment_terms: string;
  lines: { service_id: string; description: string; quantity: number; unit_price: number; discount: number; taxable: boolean }[];
}

/** Save a draft manual invoice. Totals and taxes are recalculated by the database. */
export async function saveInvoice(id: string | undefined, v: InvoiceFormValues): Promise<string> {
  const header = nullify({
    customer_id: v.customer_id, issue_date: v.issue_date, due_date: v.due_date || null,
    notes: v.notes || null, terms: v.terms || null, payment_terms: v.payment_terms || null, source: 'manual',
  });
  let invoiceId = id;
  if (invoiceId) {
    check(await supabase.from('invoices').update(header).eq('id', invoiceId));
    check(await supabase.from('invoice_lines').delete().eq('invoice_id', invoiceId));
  } else {
    const created = check(await supabase.from('invoices').insert(header).select('id').single()) as { id: string };
    invoiceId = created.id;
  }
  check(await supabase.from('invoice_lines').insert(v.lines.map((l, i) => nullify({
    invoice_id: invoiceId, service_id: l.service_id || null, description: l.description,
    quantity: l.quantity, unit_price: l.unit_price, discount: l.discount, taxable: l.taxable, sort_order: i + 1,
  }))));
  return invoiceId;
}

export const issueInvoice = (id: string) => rpc('issue_invoice', { p_invoice_id: id });
export const issueCreditNote = (invoiceId: string, amount: number, reason: string) =>
  rpc('issue_credit_note', { p_invoice_id: invoiceId, p_amount: amount, p_reason: reason });
export const createStatementLink = (customerId: string, from: string, to: string) =>
  rpc<string>('create_statement_link', { p_customer_id: customerId, p_from: from, p_to: to });

export interface AgingRow {
  customer_id: string; customer_name: string | null;
  current_amt: number; d1_30: number; d31_60: number; d61_90: number; d90_plus: number; total: number;
}
export const agingReport = (asOf?: string) => rpc<AgingRow[]>('rpt_ar_aging', { p_as_of: asOf });

export async function searchInvoices(q: string): Promise<PickerItem[]> {
  let query = supabase.from('invoices').select('id, invoice_no, customer_name, total, balance, status')
    .neq('status', 'draft').order('issue_date', { ascending: false }).limit(20);
  if (q) query = query.or([`invoice_no.ilike.%${q}%`, `customer_name.ilike.%${q.replace(/[,()]/g, ' ')}%`].join(','));
  const rows = check(await query) as { id: string; invoice_no: string | null; customer_name: string | null; total: number; balance: number; status: string }[];
  return rows.map((r) => ({ id: r.id, label: r.invoice_no ?? 'Draft', sub: `${r.customer_name ?? ''} · balance ${r.balance}` }));
}

export const INVOICE_STATUSES = ['draft', 'issued', 'due', 'partially_paid', 'paid', 'overdue', 'void'] as const;
