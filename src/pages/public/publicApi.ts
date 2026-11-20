import { functionsUrl, supabase } from '@/lib/supabaseClient';
import type { CompanyInfo } from '@/lib/pdf/PdfKit';

// The public pages (invoice, receipt, statement, survey) have no login. They read their data
// from the public-document and public-survey Edge Functions, which check the token server-side.
// The anon key is still sent because Supabase requires it to route the request.

const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

async function callFunction<T>(name: string, init: { method: 'GET' | 'POST'; query?: Record<string, string>; body?: unknown }): Promise<T> {
  const url = new URL(`${functionsUrl}/${name}`);
  for (const [k, v] of Object.entries(init.query ?? {})) url.searchParams.set(k, v);
  let res: Response;
  try {
    res = await fetch(url.toString(), {
      method: init.method,
      headers: { 'Content-Type': 'application/json', apikey: anonKey, Authorization: `Bearer ${anonKey}` },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
  } catch {
    throw new Error('No connection. Check your internet and try again.');
  }
  const text = await res.text();
  let payload: unknown = null;
  try { payload = text ? JSON.parse(text) : null; } catch { payload = null; }
  if (!res.ok) {
    const message = (payload as { error?: string } | null)?.error;
    throw new Error(message ?? (res.status === 404 ? 'This link is not valid any more.' : 'Something went wrong. Please try again.'));
  }
  return payload as T;
}

export interface PublicCustomer {
  display_name: string | null;
  customer_code?: string | null;
  phone?: string | null;
  company_phone?: string | null;
  email?: string | null;
  company_email?: string | null;
  residential_address?: string | null;
  digital_address?: string | null;
  tin?: string | null;
}

export interface PublicInvoiceLine { description: string; quantity: number; unit_price: number; discount: number; line_total: number }
export interface PublicInvoiceTax { name: string; rate: number; amount: number }

export interface PublicInvoiceData {
  company: CompanyInfo;
  pay_enabled: boolean;
  invoice: {
    id: string; invoice_no: string | null; status: string; issue_date: string; due_date: string | null;
    period_start: string | null; period_end: string | null;
    subtotal: number; discount_total: number; tax_total: number; total: number;
    amount_paid: number; amount_credited: number; balance: number;
    notes: string | null; terms: string | null;
    lines: PublicInvoiceLine[]; taxes: PublicInvoiceTax[]; customer: PublicCustomer; attention: { name: string; position: string | null } | null;
  };
}

export interface PublicReceiptData {
  company: CompanyInfo;
  receipt: {
    receipt_no: string; amount: number; issued_at: string;
    payment: { payment_date: string; method_code: string; reference: string | null; unallocated_amount: number; payment_methods: { name: string } | null } | null;
    allocations: { amount: number; invoices: { invoice_no: string | null; balance: number } | null }[];
    customer: PublicCustomer;
  };
}

// rpt_customer_statement returns one row per movement, opening balance first.
export interface StatementLine {
  txn_date: string; doc_type: string; doc_no: string | null; description: string;
  debit: number | null; credit: number | null; balance: number;
}

export interface PublicStatementData {
  company: CompanyInfo;
  /* format says which statement the link was created for. rows carry the shape that format
     returns: StatementLine[] for the account statement, StatementByInvoiceRow[] for by-invoice. */
  statement: { from: string; to: string; format?: 'account' | 'by_invoice'; customer: PublicCustomer; rows: StatementLine[] };
}

export interface SurveyQuestion {
  id: string; type: 'star' | 'nps' | 'choice' | 'bool' | 'text'; text: string; options: string[] | null; required: boolean;
}

export interface PublicSurveyData {
  state: 'open' | 'responded' | 'expired' | 'not_found';
  company: { name: string; logo_url: string | null; brand_color: string | null };
  customer_name: string | null;
  survey: { id: string; name: string; intro_text: string | null; thank_you_text: string | null; questions: SurveyQuestion[] } | null;
}

export interface SurveyAnswer {
  question_id: string; rating?: number | null; choice?: string | null; bool_value?: boolean | null; text_value?: string | null;
}

export const getPublicInvoice = (token: string) => callFunction<PublicInvoiceData>('public-document', { method: 'GET', query: { type: 'invoice', token } });
export const getPublicReceipt = (token: string) => callFunction<PublicReceiptData>('public-document', { method: 'GET', query: { type: 'receipt', token } });
export const getPublicStatement = (token: string) => callFunction<PublicStatementData>('public-document', { method: 'GET', query: { type: 'statement', token } });
/**
 * amount is left out to pay the whole balance; the server checks whatever is passed and answers
 * with the amount it actually opened the session for, so the caller can verify it before sending
 * the customer to the gateway.
 */
export const startInvoicePayment = (token: string, amount?: number) =>
  callFunction<{ url: string; amount?: number }>('public-document', { method: 'POST', body: { action: 'pay', token, amount } });
export const getPublicSurvey = (token: string) => callFunction<PublicSurveyData>('public-survey', { method: 'GET', query: { token } });
export const submitPublicSurvey = (token: string, answers: SurveyAnswer[]) =>
  callFunction<{ ok: boolean; low: boolean; thank_you: string | null }>('public-survey', { method: 'POST', body: { token, answers } });

/** The public pages must never hold a session (a shared link could leak one). */
export async function ensureSignedOut(): Promise<void> {
  const { data } = await supabase.auth.getSession();
  if (data.session) await supabase.auth.signOut();
}
