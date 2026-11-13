import { Text, View } from '@react-pdf/renderer';
import { date, Header, money, s, Shell, Table, type CompanyInfo } from './PdfKit';
import { humanize } from '../format';

export interface StatementRow { txn_date: string; doc_type: string; doc_no: string | null; description: string; debit: number | null; credit: number | null; balance: number }

export function StatementPdf({ company, customer, from, to, rows }: { company: CompanyInfo; customer: { display_name: string; customer_code?: string | null }; from: string; to: string; rows: StatementRow[] }) {
  const closing = rows.length ? rows[rows.length - 1].balance : 0;
  const debits = rows.reduce((t, r) => t + Number(r.debit ?? 0), 0);
  const credits = rows.reduce((t, r) => t + Number(r.credit ?? 0), 0);
  return (
    <Shell company={company} title={`Statement ${customer.display_name}`}>
      <Header company={company} title="STATEMENT" number={customer.customer_code ?? undefined} meta={[['Period', `${date(from)} – ${date(to)}`]]} />
      <Text style={[s.bold, { marginBottom: 8 }]}>{customer.display_name}</Text>
      <Table brand={company.brand_color} rows={rows} columns={[
        { label: 'Date', width: '12%', value: (r) => date(r.txn_date) },
        { label: 'Type', width: '12%', value: (r) => humanize(r.doc_type) },
        { label: 'Document', width: '16%', value: (r) => r.doc_no ?? '' },
        { label: 'Description', width: '24%', value: (r) => r.description },
        { label: 'Debit', width: '12%', align: 'right', value: (r) => (r.debit ? money(r.debit) : '') },
        { label: 'Credit', width: '12%', align: 'right', value: (r) => (r.credit ? money(r.credit) : '') },
        { label: 'Balance', width: '12%', align: 'right', value: (r) => money(r.balance) },
      ]} />
      <View style={[s.box, { marginTop: 12, alignSelf: 'flex-end', width: '50%' }]}>
        <View style={s.between}><Text>Total debits</Text><Text>{money(debits)}</Text></View>
        <View style={s.between}><Text>Total credits</Text><Text>{money(credits)}</Text></View>
        <View style={s.between}><Text style={s.bold}>Closing balance</Text><Text style={s.bold}>{money(closing)}</Text></View>
      </View>
    </Shell>
  );
}
