import { Text, View } from '@react-pdf/renderer';
import { date, Header, money, PaymentDetails, s, Shell, Table, Totals, type CompanyInfo } from './PdfKit';
import { formatNumber, humanize } from '../format';

export interface InvoiceDoc {
  invoice_no: string | null; status: string; issue_date: string; due_date: string | null; period_start?: string | null; period_end?: string | null;
  subtotal: number; discount_total: number; tax_total: number; total: number; amount_paid: number; amount_credited: number; balance: number;
  notes?: string | null; terms?: string | null; payment_terms?: string | null;
  lines: { description: string; quantity: number; unit_price: number; discount: number; line_total: number }[];
  taxes: { name: string; rate: number; amount: number }[];
  customer: { display_name: string; customer_code?: string | null; phone?: string | null; company_phone?: string | null; email?: string | null; company_email?: string | null; residential_address?: string | null; digital_address?: string | null; tin?: string | null } | null;
  attention?: { name: string; position?: string | null } | null;
}

export function InvoicePdf({ company, invoice, link }: { company: CompanyInfo; invoice: InvoiceDoc; link?: string }) {
  const c = invoice.customer;
  const meta: [string, string][] = [['Date', date(invoice.issue_date)], ['Due', invoice.due_date ? date(invoice.due_date) : 'On completion'], ['Status', humanize(invoice.status)]];
  if (invoice.period_start) meta.push(['Period', `${date(invoice.period_start)} – ${date(invoice.period_end ?? null)}`]);
  return (
    <Shell company={company} title={`Invoice ${invoice.invoice_no ?? ''}`}>
      <Header company={company} title="INVOICE" number={invoice.invoice_no} meta={meta} />
      <View style={[s.between, { marginBottom: 14 }]}>
        <View style={{ width: '55%' }}>
          <Text style={[s.muted, s.small]}>BILL TO</Text>
          <Text style={s.bold}>{c?.display_name}</Text>
          {invoice.attention ? <Text>Attn: {invoice.attention.name}{invoice.attention.position ? `, ${invoice.attention.position}` : ''}</Text> : null}
          {c?.residential_address ? <Text>{c.residential_address}</Text> : null}
          {c?.digital_address ? <Text>GhanaPost GPS: {c.digital_address}</Text> : null}
          <Text>{[c?.phone ?? c?.company_phone, c?.email ?? c?.company_email].filter(Boolean).join(' · ')}</Text>
          {c?.tin ? <Text>TIN: {c.tin}</Text> : null}
        </View>
        <View style={[s.box, { width: '35%' }]}>
          <Text style={s.muted}>Amount due</Text>
          <Text style={{ fontSize: 16, fontWeight: 700 }}>{money(invoice.balance)}</Text>
          {c?.customer_code ? <Text style={s.muted}>Customer {c.customer_code}</Text> : null}
        </View>
      </View>
      <Table brand={company.brand_color} rows={invoice.lines} columns={[
        { label: 'Description', width: '46%', value: (l) => l.description },
        { label: 'Qty', width: '10%', align: 'right', value: (l) => formatNumber(l.quantity) },
        { label: 'Unit price', width: '15%', align: 'right', value: (l) => money(l.unit_price) },
        { label: 'Discount', width: '13%', align: 'right', value: (l) => (Number(l.discount) ? money(l.discount) : '—') },
        { label: 'Amount', width: '16%', align: 'right', value: (l) => money(l.line_total) },
      ]} />
      <Totals rows={[
        ['Subtotal', money(invoice.subtotal)],
        ...(Number(invoice.discount_total) ? [['Discount', `-${money(invoice.discount_total)}`] as [string, string]] : []),
        ...invoice.taxes.map((t) => [`${t.name} (${Number(t.rate)}%)`, money(t.amount)] as [string, string]),
        ['Total', money(invoice.total), true],
        ...(Number(invoice.amount_paid) ? [['Paid', `-${money(invoice.amount_paid)}`] as [string, string]] : []),
        ...(Number(invoice.amount_credited) ? [['Credited', `-${money(invoice.amount_credited)}`] as [string, string]] : []),
        ['Balance due', money(invoice.balance), true],
      ]} />
      {invoice.payment_terms ? (
        <View style={{ marginTop: 10 }}>
          <Text style={[s.muted, s.small]}>PAYMENT TERMS</Text>
          <Text style={s.bold}>{invoice.payment_terms}</Text>
        </View>
      ) : null}
      <PaymentDetails company={company} />
      {link ? <Text style={[s.muted, { marginTop: 8 }]}>View or pay online: {link}</Text> : null}
      {invoice.terms || company.invoice_terms ? <Text style={[s.small, s.muted, { marginTop: 10 }]}>{invoice.terms || company.invoice_terms}</Text> : null}
      {invoice.notes ? <Text style={[s.small, { marginTop: 4 }]}>{invoice.notes}</Text> : null}
    </Shell>
  );
}
