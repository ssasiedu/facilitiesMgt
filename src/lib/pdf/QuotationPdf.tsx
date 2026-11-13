import { Text, View } from '@react-pdf/renderer';
import { date, Header, money, PaymentDetails, s, Shell, Totals, type CompanyInfo } from './PdfKit';

// Customer-facing quotation: shows the price only, never the internal cost lines.
export interface QuotationDoc {
  quote_no: string; quote_date: string; valid_until: string; title: string | null; description: string | null;
  amount: number; tax_amount: number; total: number; terms: string | null;
  customer_name: string; customer_contact?: string | null;
}

export function QuotationPdf({ company, quote }: { company: CompanyInfo; quote: QuotationDoc }) {
  return (
    <Shell company={company} title={`Quotation ${quote.quote_no}`}>
      <Header company={company} title="QUOTATION" number={quote.quote_no} meta={[['Date', date(quote.quote_date)], ['Valid until', date(quote.valid_until)]]} />
      <Text style={[s.muted, s.small]}>PREPARED FOR</Text>
      <Text style={[s.bold, { marginBottom: 2 }]}>{quote.customer_name}</Text>
      {quote.customer_contact ? <Text style={{ marginBottom: 12 }}>{quote.customer_contact}</Text> : <View style={{ marginBottom: 12 }} />}
      <View style={s.box}>
        <Text style={s.h2}>{quote.title}</Text>
        <Text>{quote.description}</Text>
      </View>
      <Totals rows={[['Price', money(quote.amount)], ['Taxes', money(quote.tax_amount)], ['Total', money(quote.total), true]]} />
      <PaymentDetails company={company} />
      <Text style={[s.small, s.muted, { marginTop: 12 }]}>{quote.terms || 'Prices are valid until the date shown. Work is scheduled once the quotation is accepted.'}</Text>
      <View style={[s.between, { marginTop: 40 }]}>
        <Text>Accepted by: ____________________________</Text>
        <Text>Date: ______________</Text>
      </View>
    </Shell>
  );
}
