import { supabase } from '@/lib/supabaseClient';
import { check, nullify, rpc } from '@/lib/rpc';
import { normalizePhone } from '@/lib/format';
import { contactSchema, customerSchema, type ContactForm, type CustomerForm } from '@/lib/schemas';
import type { PickerItem } from '@/components/ui/AsyncPicker';
import type { Tables } from '@/types/database';

export type Customer = Tables<'customers'>;
export type Contact = Tables<'customer_contacts'>;

function toRow(v: CustomerForm) {
  const p = customerSchema.parse(v);
  const individual = p.customer_type === 'individual';
  return nullify({
    ...p,
    phone: normalizePhone(p.phone), alt_phone: normalizePhone(p.alt_phone), whatsapp: normalizePhone(p.whatsapp), company_phone: normalizePhone(p.company_phone),
    ghana_card_no: p.ghana_card_no ? p.ghana_card_no.toUpperCase() : null, digital_address: p.digital_address ? p.digital_address.toUpperCase() : null,
    birth_day: individual && p.birth_day ? p.birth_day : null, birth_month: individual && p.birth_month ? p.birth_month : null, birth_year: individual && p.birth_year ? p.birth_year : null,
    tags: (p.tags ?? '').split(',').map((t) => t.trim()).filter(Boolean),
    // fields of the other customer type are cleared
    ...(individual ? { company_name: null, trading_name: null, registration_no: null, sector: null } : { first_name: null, middle_name: null, last_name: null, title: null, gender: null }),
  });
}

export async function saveCustomer(id: string | undefined, v: CustomerForm): Promise<string> {
  const row = toRow(v);
  if (id) { check(await supabase.from('customers').update(row).eq('id', id)); return id; }
  const created = check(await supabase.from('customers').insert(row).select('id').single()) as { id: string };
  return created.id;
}

export interface Duplicate { id: string; customer_code: string; display_name: string; matched_on: string }
export function findDuplicates(v: { phone?: string; ghana_card_no?: string; email?: string; tin?: string }, exclude?: string) {
  return rpc<Duplicate[]>('check_customer_duplicates', {
    p_phone: v.phone || '', p_ghana_card: v.ghana_card_no ? v.ghana_card_no.toUpperCase() : '', p_email: v.email || '', p_tin: v.tin || '', p_exclude: exclude,
  });
}

export async function saveContact(customerId: string, id: string | undefined, v: ContactForm) {
  const p = contactSchema.parse(v);
  const row = nullify({ ...p, customer_id: customerId, phone: normalizePhone(p.phone), ghana_card_no: p.ghana_card_no ? p.ghana_card_no.toUpperCase() : null });
  if (id) check(await supabase.from('customer_contacts').update(row).eq('id', id));
  else check(await supabase.from('customer_contacts').insert(row));
}

export async function searchCustomers(q: string): Promise<PickerItem[]> {
  let query = supabase.from('customers').select('id, display_name, customer_code, phone, company_phone, status').is('archived_at', null).order('display_name').limit(20);
  if (q) {
    const phone = normalizePhone(q);
    query = query.or([`display_name.ilike.%${q.replace(/[,()]/g, ' ')}%`, `customer_code.ilike.%${q}%`, ...(phone ? [`phone.eq.${phone}`, `company_phone.eq.${phone}`] : [])].join(','));
  }
  const rows = check(await query) as { id: string; display_name: string; customer_code: string; phone: string | null; company_phone: string | null; status: string }[];
  return rows.map((r) => ({ id: r.id, label: r.display_name, sub: `${r.customer_code}${r.status === 'blacklisted' ? ' · BLACKLISTED' : ''}${r.phone || r.company_phone ? ` · ${r.phone ?? r.company_phone}` : ''}` }));
}

export const CUSTOMER_IMPORT_COLUMNS = ['customer_type', 'title', 'first_name', 'middle_name', 'last_name', 'gender', 'ghana_card_no', 'phone', 'alt_phone', 'whatsapp', 'email',
  'occupation', 'residential_address', 'company_name', 'trading_name', 'registration_no', 'tin', 'sector', 'company_phone', 'company_email', 'digital_address', 'region',
  'district', 'source', 'preferred_channel', 'sms_opt_in', 'credit_limit', 'payment_terms_days', 'notes'] as const;

/** A message a staff member writes, queued through the same sender as every automatic one. */
export const sendCustomerMessage = (customerId: string, channel: 'sms' | 'email', body: string, subject?: string) =>
  rpc<string>('send_customer_message', { p_customer_id: customerId, p_channel: channel, p_body: body, p_subject: subject ?? null });

/** The outstanding balance, worded and worked out by the database so the figure is the ledger's. */
export const sendCustomerBalance = (customerId: string, channel: 'sms' | 'email', note?: string) =>
  rpc<string>('send_customer_balance', { p_customer_id: customerId, p_channel: channel, p_note: note ?? null });
