import { supabase } from '@/lib/supabaseClient';
import { check, nullify } from '@/lib/rpc';
import type { Tables } from '@/types/database';
import type { QuotationDoc } from '@/lib/pdf/QuotationPdf';

export type Quotation = Tables<'quotations'>;

export interface QuotationFull extends Quotation {
  quotation_lines: (Tables<'quotation_lines'> & { service: { id: string; name: string } | null })[];
  quotation_taxes: Tables<'quotation_taxes'>[];
  customer: {
    id: string; display_name: string | null; customer_code: string | null; phone: string | null;
    company_phone: string | null; email: string | null; company_email: string | null;
    residential_address: string | null; digital_address: string | null; tin: string | null;
  } | null;
  lead: { id: string; name: string; phone: string | null; email: string | null } | null;
  estimate: { id: string; estimate_no: string | null; is_recurring: boolean; tax_pct: number } | null;
}

const FULL_SELECT = `
  *,
  quotation_lines(*, service:services(id, name)),
  quotation_taxes(*),
  customer:customers(id, display_name, customer_code, phone, company_phone, email, company_email, residential_address, digital_address, tin),
  lead:leads(id, name, phone, email),
  estimate:estimates(id, estimate_no, is_recurring, tax_pct)
`;

export async function loadQuotation(id: string): Promise<QuotationFull> {
  return check(await supabase.from('quotations').select(FULL_SELECT).eq('id', id).single()) as unknown as QuotationFull;
}

/** Shapes a loaded quotation for the PDF, so the list page and the detail page print the same document. */
export function toQuotationDoc(q: QuotationFull, fallbackTerms?: string | null): QuotationDoc {
  const lines = [...(q.quotation_lines ?? [])].sort((a, b) => a.sort_order - b.sort_order);
  return {
    quote_no: q.quote_no ?? 'DRAFT',
    quote_date: q.quote_date,
    valid_until: q.valid_until,
    title: q.title,
    description: q.description,
    amount: Number(q.amount),
    tax_amount: Number(q.tax_amount),
    total: Number(q.total),
    terms: q.terms ?? fallbackTerms ?? null,
    payment_terms: q.payment_terms,
    lines: lines.map((l) => ({
      description: l.description,
      quantity: Number(l.quantity),
      unit_price: Number(l.unit_price),
      discount: Number(l.discount),
      line_total: Number(l.line_total),
    })),
    taxes: (q.quotation_taxes ?? []).map((t) => ({ name: t.name, rate: Number(t.rate), amount: Number(t.amount) })),
    // A quotation can be addressed to a lead that is not yet a customer, so the lead stands in.
    customer: q.customer
      ? {
          display_name: q.customer.display_name ?? 'Customer',
          customer_code: q.customer.customer_code,
          phone: q.customer.phone,
          company_phone: q.customer.company_phone,
          email: q.customer.email,
          company_email: q.customer.company_email,
          residential_address: q.customer.residential_address,
          digital_address: q.customer.digital_address,
          tin: q.customer.tin,
        }
      : q.lead
        ? { display_name: q.lead.name, phone: q.lead.phone, email: q.lead.email }
        : null,
  };
}

export interface QuotationLineValues {
  service_id: string; description: string; quantity: number; unit_price: number; discount: number; taxable: boolean;
}

/**
 * Replaces the lines on a quotation. Totals and the tax breakdown are recalculated by the
 * database trigger, so nothing here works out a figure the invoice side would work out differently.
 */
export async function saveQuotationLines(quotationId: string, lines: QuotationLineValues[]): Promise<void> {
  check(await supabase.from('quotation_lines').delete().eq('quotation_id', quotationId));
  if (!lines.length) return;
  check(await supabase.from('quotation_lines').insert(lines.map((l, i) => nullify({
    quotation_id: quotationId,
    service_id: l.service_id || null,
    description: l.description,
    quantity: l.quantity,
    unit_price: l.unit_price,
    discount: l.discount,
    taxable: l.taxable,
    sort_order: (i + 1) * 10,
  }))));
}

export async function saveQuotationTerms(quotationId: string, paymentTerms: string): Promise<void> {
  check(await supabase.from('quotations').update({ payment_terms: paymentTerms || null }).eq('id', quotationId));
}
