import { Text, View } from '@react-pdf/renderer';
import { date, Header, money, s, Shell, Table, Totals, type CompanyInfo } from './PdfKit';

export interface ReceiptDoc {
  receipt_no: string; amount: number; issued_at: string;
  payment: { payment_date: string; method_code: string; reference: string | null; unallocated_amount: number; payment_methods?: { name: string } | null } | null;
  allocations: { amount: number; invoices: { invoice_no: string; balance: number } | null }[];
  customer: { display_name: string; customer_code?: string | null; phone?: string | null; company_phone?: string | null; email?: string | null } | null;
}

export function ReceiptPdf({ company, receipt }: { company: CompanyInfo; receipt: ReceiptDoc }) {
  return (
    <Shell company={company} title={`Receipt ${receipt.receipt_no}`}>
      <Header company={company} title="RECEIPT" number={receipt.receipt_no} meta={[['Date', date(receipt.payment?.payment_date ?? receipt.issued_at)]]} />
      <View style={[s.between, { marginBottom: 14 }]}>
        <View>
          <Text style={[s.muted, s.small]}>RECEIVED FROM</Text>
          <Text style={s.bold}>{receipt.customer?.display_name}</Text>
          <Text>{receipt.customer?.phone ?? receipt.customer?.company_phone ?? ''}</Text>
        </View>
        <View style={[s.box, { width: '38%' }]}>
          <Text style={s.muted}>Amount received</Text>
          <Text style={{ fontSize: 16, fontWeight: 700 }}>{money(receipt.amount)}</Text>
          <Text style={s.muted}>{receipt.payment?.payment_methods?.name ?? receipt.payment?.method_code}{receipt.payment?.reference ? ` · Ref ${receipt.payment.reference}` : ''}</Text>
        </View>
      </View>
      <Table brand={company.brand_color} rows={receipt.allocations} columns={[
        { label: 'Applied to invoice', width: '50%', value: (a) => a.invoices?.invoice_no ?? '' },
        { label: 'Amount applied', width: '25%', align: 'right', value: (a) => money(a.amount) },
        { label: 'Balance left', width: '25%', align: 'right', value: (a) => money(a.invoices?.balance ?? 0) },
      ]} />
      <Totals rows={[
        ['Total received', money(receipt.amount), true],
        ...(Number(receipt.payment?.unallocated_amount) ? [['Held as credit on your account', money(receipt.payment?.unallocated_amount)] as [string, string]] : []),
      ]} />
      <Text style={[s.muted, { marginTop: 18 }]}>Thank you for your payment.</Text>
    </Shell>
  );
}
