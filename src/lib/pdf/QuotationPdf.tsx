import { Text, View } from '@react-pdf/renderer';
import { date, Header, money, PaymentDetails, s, Shell, Table, Totals, type CompanyInfo } from './PdfKit';
import { formatNumber } from '../format';

/*
 * Customer-facing quotation. It mirrors the invoice deliberately: the same line table and the
 * same per-rate tax breakdown, so a customer comparing the quotation with the invoice that
 * follows is reading the same document twice. The internal cost lines on the estimate — labour,
 * materials, transport — are never shown here; these are the sellable lines on the quotation.
 */
export interface QuotationDoc {
  quote_no: string; quote_date: string; valid_until: string; title: string | null; description: string | null;
  amount: number; tax_amount: number; total: number; terms: string | null; payment_terms?: string | null;
  lines: { description: string; quantity: number; unit_price: number; discount: number; line_total: number }[];
  taxes: { name: string; rate: number; amount: number }[];
  customer: {
    display_name: string; customer_code?: string | null; phone?: string | null; company_phone?: string | null;
    email?: string | null; company_email?: string | null; residential_address?: string | null;
    digital_address?: string | null; tin?: string | null;
  } | null;
  attention?: { name: string; position?: string | null } | null;
}

export function QuotationPdf({ company, quote, link }: { company: CompanyInfo; quote: QuotationDoc; link?: string }) {
  const c = quote.customer;
  const discountTotal = quote.lines.reduce((sum, l) => sum + Number(l.discount ?? 0), 0);
  const subtotal = quote.lines.reduce((sum, l) => sum + Math.round(Number(l.quantity) * Number(l.unit_price) * 100) / 100, 0);

  return (
    <Shell company={company} title={`Quotation ${quote.quote_no}`}>
      <Header company={company} title="QUOTATION" number={quote.quote_no}
        meta={[['Date', date(quote.quote_date)], ['Valid until', date(quote.valid_until)]]} />

      <View style={[s.between, { marginBottom: 14 }]}>
        <View style={{ width: '55%' }}>
          <Text style={[s.muted, s.small]}>PREPARED FOR</Text>
          <Text style={s.bold}>{c?.display_name}</Text>
          {quote.attention ? <Text>Attn: {quote.attention.name}{quote.attention.position ? `, ${quote.attention.position}` : ''}</Text> : null}
          {c?.residential_address ? <Text>{c.residential_address}</Text> : null}
          {c?.digital_address ? <Text>GhanaPost GPS: {c.digital_address}</Text> : null}
          <Text>{[c?.phone ?? c?.company_phone, c?.email ?? c?.company_email].filter(Boolean).join(' · ')}</Text>
          {c?.tin ? <Text>TIN: {c.tin}</Text> : null}
        </View>
        <View style={[s.box, { width: '35%' }]}>
          <Text style={s.muted}>Quotation total</Text>
          <Text style={{ fontSize: 16, fontWeight: 700 }}>{money(quote.total)}</Text>
          {c?.customer_code ? <Text style={s.muted}>Customer {c.customer_code}</Text> : null}
        </View>
      </View>

      {quote.title || quote.description ? (
        <View style={[s.box, { marginBottom: 12 }]}>
          {quote.title ? <Text style={s.h2}>{quote.title}</Text> : null}
          {quote.description ? <Text>{quote.description}</Text> : null}
        </View>
      ) : null}

      <Table brand={company.brand_color} rows={quote.lines} columns={[
        { label: 'Description', width: '46%', value: (l) => l.description },
        { label: 'Qty', width: '10%', align: 'right', value: (l) => formatNumber(l.quantity) },
        { label: 'Unit price', width: '15%', align: 'right', value: (l) => money(l.unit_price) },
        { label: 'Discount', width: '13%', align: 'right', value: (l) => (Number(l.discount) ? money(l.discount) : '—') },
        { label: 'Amount', width: '16%', align: 'right', value: (l) => money(l.line_total) },
      ]} />

      <Totals rows={[
        ['Subtotal', money(subtotal)],
        ...(discountTotal ? [['Discount', `-${money(discountTotal)}`] as [string, string]] : []),
        ...quote.taxes.map((t) => [`${t.name} (${Number(t.rate)}%)`, money(t.amount)] as [string, string]),
        ['Total', money(quote.total), true],
      ]} />

      {quote.payment_terms ? (
        <View style={{ marginTop: 10 }}>
          <Text style={[s.muted, s.small]}>PAYMENT TERMS</Text>
          <Text style={s.bold}>{quote.payment_terms}</Text>
        </View>
      ) : null}

      <PaymentDetails company={company} />
      {link ? <Text style={[s.muted, { marginTop: 8 }]}>View this quotation online: {link}</Text> : null}

      <Text style={[s.small, s.muted, { marginTop: 12 }]}>
        {quote.terms || 'Prices are valid until the date shown. Work is scheduled once the quotation is accepted.'}
      </Text>

      <View style={[s.between, { marginTop: 40 }]}>
        <Text>Accepted by: ____________________________</Text>
        <Text>Date: ______________</Text>
      </View>
    </Shell>
  );
}
