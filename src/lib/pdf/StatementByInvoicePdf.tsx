import { Text, View } from '@react-pdf/renderer';
import { date, Header, money, s, Shell, Table, type CompanyInfo } from './PdfKit';

export interface StatementByInvoiceRow {
  invoice_id: string; invoice_no: string | null; invoice_date: string; due_date: string | null;
  invoice_status: string; invoice_total: number; invoice_balance: number;
  line_no: number; line_type: string; line_date: string; line_doc_no: string | null;
  line_description: string; line_amount: number; balance_after: number;
}

const LINE_LABEL: Record<string, string> = { invoice: 'Invoice', payment: 'Payment', credit: 'Credit note' };

/*
 * The invoice-by-invoice statement. Where the account statement carries one running total, this
 * keeps each invoice with the payments and credits applied to it and shows what each one left
 * owing on that invoice — the question a customer actually asks when they ring up about a bill.
 */
export function StatementByInvoicePdf({ company, customer, from, to, rows }: {
  company: CompanyInfo;
  customer: { display_name: string; customer_code?: string | null };
  from: string; to: string;
  rows: StatementByInvoiceRow[];
}) {
  // Group by invoice, keeping the order the function returned them in.
  const groups: { key: string; header: StatementByInvoiceRow; movements: StatementByInvoiceRow[] }[] = [];
  for (const r of rows) {
    let g = groups.find((x) => x.key === r.invoice_id);
    if (!g) {
      g = { key: r.invoice_id, header: r, movements: [] };
      groups.push(g);
    }
    if (r.line_type === 'invoice') g.header = r;
    else g.movements.push(r);
  }

  const invoiced = groups.reduce((t, g) => t + Number(g.header.invoice_total), 0);
  const owing = groups.reduce((t, g) => t + Number(g.header.invoice_balance), 0);
  const settledCount = groups.filter((g) => Number(g.header.invoice_balance) <= 0).length;

  return (
    <Shell company={company} title={`Statement ${customer.display_name}`}>
      <Header company={company} title="STATEMENT BY INVOICE" number={customer.customer_code ?? undefined}
        meta={[['Period', `${date(from)} – ${date(to)}`]]} />
      <Text style={[s.bold, { marginBottom: 8 }]}>{customer.display_name}</Text>

      {groups.map((g) => (
        <View key={g.key} style={{ marginBottom: 14 }} wrap={false}>
          <View style={[s.between, { marginBottom: 3 }]}>
            <Text style={s.bold}>
              Invoice {g.header.invoice_no ?? ''} · {date(g.header.invoice_date)}
              {g.header.due_date ? ` · due ${date(g.header.due_date)}` : ''}
            </Text>
            <Text style={s.bold}>
              {Number(g.header.invoice_balance) > 0
                ? `${money(g.header.invoice_balance)} still owing`
                : 'Settled'}
            </Text>
          </View>

          <Table brand={company.brand_color}
            rows={[g.header, ...g.movements]}
            columns={[
              { label: 'Date', width: '14%', value: (r) => date(r.line_date) },
              { label: 'Entry', width: '16%', value: (r) => LINE_LABEL[r.line_type] ?? r.line_type },
              { label: 'Document', width: '20%', value: (r) => r.line_doc_no ?? '' },
              { label: 'Detail', width: '24%', value: (r) => r.line_description },
              { label: 'Amount', width: '13%', align: 'right', value: (r) => money(r.line_amount) },
              { label: 'Left owing', width: '13%', align: 'right', value: (r) => money(r.balance_after) },
            ]} />
        </View>
      ))}

      {!groups.length ? <Text style={s.muted}>No invoices in this period.</Text> : null}

      <View style={[s.box, { marginTop: 4, alignSelf: 'flex-end', width: '55%' }]}>
        <View style={s.between}><Text>Invoices shown</Text><Text>{String(groups.length)}</Text></View>
        <View style={s.between}><Text>Settled in full</Text><Text>{String(settledCount)}</Text></View>
        <View style={s.between}><Text>Total invoiced</Text><Text>{money(invoiced)}</Text></View>
        <View style={s.between}><Text style={s.bold}>Still owing</Text><Text style={s.bold}>{money(owing)}</Text></View>
      </View>
    </Shell>
  );
}
