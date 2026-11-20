import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Download } from 'lucide-react';
import { rpc } from '@/lib/rpc';
import { useSettings } from '@/lib/settings';
import { useAccounts, toOptions } from '@/lib/lookups';
import { formatDate, formatGHS, humanize } from '@/lib/format';
import { exportXlsx, type ExportColumn } from '@/lib/export';
import { downloadPdf } from '@/lib/pdf/download';
import { ReportPdf, type ReportColumn } from '@/lib/pdf/ReportPdf';
import { companyFromSettings } from '@/lib/pdf/company';
import { PageHeader } from '@/components/ui/PageHeader';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Select } from '@/components/ui/Select';
import { Tabs } from '@/components/ui/Tabs';
import { DateRange, presetRange, type Preset } from '@/components/ui/DateRange';
import { Spinner } from '@/components/ui/Spinner';
import { ErrorState } from '@/components/ui/ErrorState';
import { EmptyState } from '@/components/ui/EmptyState';

type ReportKey = 'trial_balance' | 'profit_loss' | 'balance_sheet' | 'cash_flow' | 'general_ledger' | 'ap_aging' | 'revenue' | 'tax' | 'expenses';

// These match the rpt_* function signatures in migration 0015 exactly.
interface TrialRow { account_id: string; code: string; name: string; account_type: string; debit: number; credit: number }
interface PlRow { group_key: string; group_label: string; account_type: string; subtype: string | null; code: string; name: string; amount: number }
interface BalanceRow { section: string; code: string; name: string; amount: number }
interface CashRow { category: string; amount: number; sort: number }
interface LedgerRow { entry_id: string; line_id: string; entry_no: string | null; entry_date: string; description: string; debit: number; credit: number; balance: number; cleared: boolean }
interface ApRow { supplier_id: string; supplier_name: string; current_amt: number; d1_30: number; d31_60: number; d61_90: number; d90_plus: number; total: number }
interface TaxRow { tax_name: string; account_code: string; collected: number; reversed: number; net: number }
interface ExpenseRow { code: string; name: string; subtype: string | null; amount: number }
interface TaxDetailRow {
  doc_type: string; doc_no: string | null; doc_date: string; customer_name: string | null;
  customer_code: string | null; customer_tin: string | null; tax_name: string; rate: number | null;
  taxable_amount: number; tax_amount: number; doc_total: number;
}
interface RevenueRow { bucket: string; account_code: string; account_name: string; subtype: string | null; earned: number }
interface RevenueServiceRow { service_name: string; invoices: number; quantity: number; net: number; tax: number; gross: number }

/** The financial reports from spec 4.10, each exportable to Excel and PDF. */
export default function ReportsPage() {
  const settings = useSettings();
  const { data: accounts } = useAccounts();
  const [tab, setTab] = useState<ReportKey>('profit_loss');
  const [preset, setPreset] = useState<Preset>('ytd');
  const [range, setRange] = useState(() => presetRange('ytd'));
  const [plGroup, setPlGroup] = useState('month');
  const [ledgerAccount, setLedgerAccount] = useState('');

  /* key decides which tab the query belongs to; part separates two queries that feed the same
     tab, so they get their own cache entry instead of overwriting one another. */
  const q = <T,>(key: ReportKey, fn: () => Promise<T>, enabled = true, part = '') =>
    useQuery({ queryKey: ['report', key, part, range.from, range.to, plGroup, ledgerAccount], enabled: tab === key && enabled, queryFn: fn });

  const trial = q<TrialRow[]>('trial_balance', () => rpc('rpt_trial_balance', { p_as_of: range.to }));
  const pl = q<PlRow[]>('profit_loss', () => rpc('rpt_profit_and_loss', { p_from: range.from, p_to: range.to, p_group: plGroup }));
  const balance = q<BalanceRow[]>('balance_sheet', () => rpc('rpt_balance_sheet', { p_as_of: range.to }));
  const cash = q<CashRow[]>('cash_flow', () => rpc('rpt_cash_flow', { p_from: range.from, p_to: range.to }));
  const ledger = q<LedgerRow[]>('general_ledger', () => rpc('rpt_general_ledger', { p_account_id: ledgerAccount, p_from: range.from, p_to: range.to }), !!ledgerAccount);
  const ap = q<ApRow[]>('ap_aging', () => rpc('rpt_ap_aging', { p_as_of: range.to }));
  const tax = q<TaxRow[]>('tax', () => rpc('rpt_tax_summary', { p_from: range.from, p_to: range.to }));
  const expenses = q<ExpenseRow[]>('expenses', () => rpc('rpt_expenses_by_category', { p_from: range.from, p_to: range.to }));
  // The working behind the tax summary, loaded with it so the figure can be checked on the spot.
  const taxDetail = q<TaxDetailRow[]>('tax', () => rpc('rpt_tax_detail', { p_from: range.from, p_to: range.to }), true, 'detail');
  const revenue = q<RevenueRow[]>('revenue', () => rpc('rpt_revenue', { p_from: range.from, p_to: range.to, p_group: plGroup }));
  const revenueByService = q<RevenueServiceRow[]>('revenue', () => rpc('rpt_revenue_by_service', { p_from: range.from, p_to: range.to }), true, 'by-service');

  const active = { trial_balance: trial, profit_loss: pl, balance_sheet: balance, cash_flow: cash, general_ledger: ledger, ap_aging: ap, revenue, tax, expenses }[tab];

  const titles: Record<ReportKey, string> = {
    trial_balance: 'Trial balance', profit_loss: 'Profit and loss', balance_sheet: 'Balance sheet',
    cash_flow: 'Cash flow', general_ledger: 'General ledger', ap_aging: 'Payables aging',
    revenue: 'Revenue', tax: 'Tax summary', expenses: 'Expenses by category',
  };

  const asAt = ['trial_balance', 'balance_sheet', 'ap_aging'].includes(tab);
  const subtitle = asAt ? `As at ${formatDate(range.to)}` : `${formatDate(range.from)} – ${formatDate(range.to)}`;

  // Per-report export shapes.
  /* extra is a second table that belongs with the first — the tax summary's working, for
     instance. It becomes another section in the PDF and another sheet in the workbook. */
  interface ExportTable {
    title?: string;
    columns: ReportColumn[];
    rows: Record<string, string | number | null>[];
    excel: ExportColumn<Record<string, unknown>>[];
  }
  const exportSpec = (): (ExportTable & { extra?: ExportTable }) | null => {
    const money = (n: unknown) => formatGHS(Number(n ?? 0));
    switch (tab) {
      case 'trial_balance': {
        const rows = (trial.data ?? []).map((r) => ({ code: r.code, name: r.name, type: humanize(r.account_type), debit: money(r.debit), credit: money(r.credit) }));
        return {
          columns: [{ label: 'Code', width: '12%', key: 'code' }, { label: 'Account', width: '44%', key: 'name' },
            { label: 'Type', width: '14%', key: 'type' }, { label: 'Debit', width: '15%', align: 'right', key: 'debit' },
            { label: 'Credit', width: '15%', align: 'right', key: 'credit' }],
          rows,
          excel: [
            { header: 'Code', value: (r) => String(r.code) }, { header: 'Account', value: (r) => String(r.name) },
            { header: 'Type', value: (r) => String(r.type) }, { header: 'Debit', value: (r) => String(r.debit) }, { header: 'Credit', value: (r) => String(r.credit) },
          ],
        };
      }
      case 'profit_loss': {
        const rows = (pl.data ?? []).map((r) => ({ group: r.group_label, code: r.code, name: r.name, type: humanize(r.account_type), amount: money(r.amount) }));
        return {
          columns: [{ label: plGroup === 'month' ? 'Month' : plGroup === 'service' ? 'Service' : 'Contract', width: '20%', key: 'group' },
            { label: 'Code', width: '10%', key: 'code' }, { label: 'Account', width: '40%', key: 'name' },
            { label: 'Type', width: '14%', key: 'type' }, { label: 'Amount', width: '16%', align: 'right', key: 'amount' }],
          rows,
          excel: [
            { header: 'Group', value: (r) => String(r.group) }, { header: 'Code', value: (r) => String(r.code) },
            { header: 'Account', value: (r) => String(r.name) }, { header: 'Type', value: (r) => String(r.type) }, { header: 'Amount', value: (r) => String(r.amount) },
          ],
        };
      }
      case 'balance_sheet': {
        const rows = (balance.data ?? []).map((r) => ({ section: humanize(r.section), code: r.code, name: r.name, amount: money(r.amount) }));
        return {
          columns: [{ label: 'Section', width: '22%', key: 'section' }, { label: 'Code', width: '12%', key: 'code' },
            { label: 'Account', width: '46%', key: 'name' }, { label: 'Amount', width: '20%', align: 'right', key: 'amount' }],
          rows,
          excel: [
            { header: 'Section', value: (r) => String(r.section) }, { header: 'Code', value: (r) => String(r.code) },
            { header: 'Account', value: (r) => String(r.name) }, { header: 'Amount', value: (r) => String(r.amount) },
          ],
        };
      }
      case 'cash_flow': {
        const rows = (cash.data ?? []).map((r) => ({ line: r.category, amount: money(r.amount) }));
        return {
          columns: [{ label: 'Line', width: '70%', key: 'line' }, { label: 'Amount', width: '30%', align: 'right', key: 'amount' }],
          rows,
          excel: [{ header: 'Line', value: (r) => String(r.line) }, { header: 'Amount', value: (r) => String(r.amount) }],
        };
      }
      case 'general_ledger': {
        const rows = (ledger.data ?? []).map((r) => ({
          date: formatDate(r.entry_date), entry: r.entry_no ?? '', description: r.description,
          debit: money(r.debit), credit: money(r.credit), balance: money(r.balance), cleared: r.cleared ? 'Yes' : '',
        }));
        return {
          columns: [{ label: 'Date', width: '12%', key: 'date' }, { label: 'Journal', width: '15%', key: 'entry' },
            { label: 'Description', width: '35%', key: 'description' },
            { label: 'Debit', width: '12%', align: 'right', key: 'debit' }, { label: 'Credit', width: '12%', align: 'right', key: 'credit' },
            { label: 'Balance', width: '14%', align: 'right', key: 'balance' }],
          rows,
          excel: [
            { header: 'Date', value: (r) => String(r.date) }, { header: 'Journal', value: (r) => String(r.entry) },
            { header: 'Description', value: (r) => String(r.description) },
            { header: 'Debit', value: (r) => String(r.debit) }, { header: 'Credit', value: (r) => String(r.credit) },
            { header: 'Balance', value: (r) => String(r.balance) }, { header: 'Cleared', value: (r) => String(r.cleared) },
          ],
        };
      }
      case 'ap_aging': {
        const rows = (ap.data ?? []).map((r) => ({
          supplier: r.supplier_name, current: money(r.current_amt), d1: money(r.d1_30), d2: money(r.d31_60),
          d3: money(r.d61_90), d4: money(r.d90_plus), total: money(r.total),
        }));
        return {
          columns: [{ label: 'Supplier', width: '28%', key: 'supplier' }, { label: 'Current', width: '12%', align: 'right', key: 'current' },
            { label: '1–30', width: '12%', align: 'right', key: 'd1' }, { label: '31–60', width: '12%', align: 'right', key: 'd2' },
            { label: '61–90', width: '12%', align: 'right', key: 'd3' }, { label: '90+', width: '12%', align: 'right', key: 'd4' },
            { label: 'Total', width: '12%', align: 'right', key: 'total' }],
          rows,
          excel: [
            { header: 'Supplier', value: (r) => String(r.supplier) }, { header: 'Current', value: (r) => String(r.current) },
            { header: '1-30', value: (r) => String(r.d1) }, { header: '31-60', value: (r) => String(r.d2) },
            { header: '61-90', value: (r) => String(r.d3) }, { header: '90+', value: (r) => String(r.d4) }, { header: 'Total', value: (r) => String(r.total) },
          ],
        };
      }
      case 'tax': {
        const rows = (tax.data ?? []).map((r) => ({
          name: r.tax_name, code: r.account_code, collected: money(r.collected), reversed: money(r.reversed), net: money(r.net),
        }));
        return {
          columns: [{ label: 'Tax', width: '32%', key: 'name' }, { label: 'Account', width: '14%', key: 'code' },
            { label: 'Collected', width: '18%', align: 'right', key: 'collected' },
            { label: 'Reversed', width: '18%', align: 'right', key: 'reversed' }, { label: 'Net payable', width: '18%', align: 'right', key: 'net' }],
          rows,
          excel: [
            { header: 'Tax', value: (r) => String(r.name) }, { header: 'Account', value: (r) => String(r.code) },
            { header: 'Collected', value: (r) => String(r.collected) }, { header: 'Reversed', value: (r) => String(r.reversed) },
            { header: 'Net payable', value: (r) => String(r.net) },
          ],
          /* The detail goes out with the summary, since the whole point of asking for customer
             and invoice number was to be able to hand the working to someone. */
          extra: {
            title: 'Documents behind the figures',
            rows: (taxDetail.data ?? []).map((r) => ({
              date: formatDate(r.doc_date), type: r.doc_type, doc: r.doc_no ?? '',
              customer: r.customer_name ?? '', customer_code: r.customer_code ?? '', tin: r.customer_tin ?? '',
              tax: r.tax_name, rate: r.rate === null ? '' : `${Number(r.rate)}%`,
              taxable: money(r.taxable_amount), amount: money(r.tax_amount),
            })),
            columns: [{ label: 'Date', width: '10%', key: 'date' }, { label: 'Type', width: '10%', key: 'type' },
              { label: 'Document', width: '13%', key: 'doc' }, { label: 'Customer', width: '22%', key: 'customer' },
              { label: 'TIN', width: '12%', key: 'tin' }, { label: 'Tax', width: '11%', key: 'tax' },
              { label: 'Rate', width: '7%', align: 'right', key: 'rate' },
              { label: 'Taxable', width: '7%', align: 'right', key: 'taxable' },
              { label: 'Tax', width: '8%', align: 'right', key: 'amount' }],
            excel: [
              { header: 'Date', value: (r: Record<string, unknown>) => String(r.date) },
              { header: 'Type', value: (r: Record<string, unknown>) => String(r.type) },
              { header: 'Document', value: (r: Record<string, unknown>) => String(r.doc) },
              { header: 'Customer', value: (r: Record<string, unknown>) => String(r.customer) },
              { header: 'Customer code', value: (r: Record<string, unknown>) => String(r.customer_code) },
              { header: 'TIN', value: (r: Record<string, unknown>) => String(r.tin) },
              { header: 'Tax', value: (r: Record<string, unknown>) => String(r.tax) },
              { header: 'Rate', value: (r: Record<string, unknown>) => String(r.rate) },
              { header: 'Taxable', value: (r: Record<string, unknown>) => String(r.taxable) },
              { header: 'Tax amount', value: (r: Record<string, unknown>) => String(r.amount) },
            ],
          },
        };
      }
      case 'revenue': {
        const rows = (revenue.data ?? []).map((r) => ({
          bucket: r.bucket, code: r.account_code, name: r.account_name,
          kind: r.subtype ? humanize(r.subtype) : '', earned: money(r.earned),
        }));
        return {
          columns: [{ label: 'Period', width: '16%', key: 'bucket' }, { label: 'Account', width: '14%', key: 'code' },
            { label: 'Income', width: '34%', key: 'name' }, { label: 'Kind', width: '18%', key: 'kind' },
            { label: 'Earned', width: '18%', align: 'right', key: 'earned' }],
          rows,
          excel: [
            { header: 'Period', value: (r) => String(r.bucket) }, { header: 'Account', value: (r) => String(r.code) },
            { header: 'Income', value: (r) => String(r.name) }, { header: 'Kind', value: (r) => String(r.kind) },
            { header: 'Earned', value: (r) => String(r.earned) },
          ],
        };
      }
      case 'expenses': {
        const expTotal = (expenses.data ?? []).reduce((t, r) => t + Number(r.amount), 0);
        const rows = (expenses.data ?? []).map((r) => ({
          code: r.code, name: r.name, subtype: r.subtype ? humanize(r.subtype) : '', amount: money(r.amount),
          share: expTotal ? `${((Number(r.amount) / expTotal) * 100).toFixed(1)}%` : '—',
        }));
        return {
          columns: [{ label: 'Code', width: '12%', key: 'code' }, { label: 'Account', width: '44%', key: 'name' },
            { label: 'Kind', width: '16%', key: 'subtype' }, { label: 'Amount', width: '16%', align: 'right', key: 'amount' },
            { label: 'Share', width: '12%', align: 'right', key: 'share' }],
          rows,
          excel: [
            { header: 'Code', value: (r) => String(r.code) }, { header: 'Account', value: (r) => String(r.name) },
            { header: 'Kind', value: (r) => String(r.subtype) }, { header: 'Amount', value: (r) => String(r.amount) }, { header: 'Share', value: (r) => String(r.share) },
          ],
        };
      }
      default:
        return null;
    }
  };

  const exportExcel = () => {
    const spec = exportSpec();
    if (!spec) return;
    exportXlsx(spec.rows as Record<string, unknown>[], spec.excel, `${tab}-${range.to}`, titles[tab].slice(0, 31));
    if (spec.extra?.rows.length) {
      exportXlsx(spec.extra.rows as Record<string, unknown>[], spec.extra.excel,
        `${tab}-detail-${range.to}`, (spec.extra.title ?? 'Detail').slice(0, 31));
    }
  };

  const exportPdf = () => {
    const spec = exportSpec();
    if (!spec || !settings) return;
    const sections: { title?: string; columns: ReportColumn[]; rows: Record<string, string | number | null>[] }[] =
      [{ columns: spec.columns, rows: spec.rows }];
    if (spec.extra?.rows.length) {
      sections.push({ title: spec.extra.title, columns: spec.extra.columns, rows: spec.extra.rows });
    }
    void downloadPdf(
      <ReportPdf company={companyFromSettings(settings)} title={titles[tab]} subtitle={subtitle} sections={sections} />,
      `${tab}-${range.to}`,
    );
  };

  // Totals shown under each report.
  const trialTotals = useMemo(() => (trial.data ?? []).reduce((t, r) => ({
    debit: t.debit + Number(r.debit), credit: t.credit + Number(r.credit),
  }), { debit: 0, credit: 0 }), [trial.data]);

  const plTotals = useMemo(() => (pl.data ?? []).reduce((t, r) => {
    if (r.account_type === 'income') t.income += Number(r.amount);
    else if (r.account_type === 'expense') { t.expense += Number(r.amount); if (r.subtype === 'direct') t.direct += Number(r.amount); }
    return t;
  }, { income: 0, expense: 0, direct: 0 }), [pl.data]);

  const expenseTotal = useMemo(() => (expenses.data ?? []).reduce((t, r) => t + Number(r.amount), 0), [expenses.data]);

  const balanceTotals = useMemo(() => (balance.data ?? []).reduce((t, r) => {
    const section = r.section.toLowerCase();
    if (section.includes('asset')) t.assets += Number(r.amount);
    else if (section.includes('liab')) t.liabilities += Number(r.amount);
    else t.equity += Number(r.amount);
    return t;
  }, { assets: 0, liabilities: 0, equity: 0 }), [balance.data]);

  return (
    <div>
      <PageHeader title="Financial reports" subtitle="Computed in the database from the general ledger"
        actions={<>
          <Button variant="secondary" size="sm" icon={<Download className="h-4 w-4" />} onClick={exportExcel}>Excel</Button>
          <Button variant="secondary" size="sm" icon={<Download className="h-4 w-4" />} onClick={exportPdf}>PDF</Button>
        </>} />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <DateRange from={range.from} to={range.to} preset={preset} onPreset={setPreset} onChange={(from, to) => setRange({ from, to })} />
        {tab === 'profit_loss' ? (
          <Select aria-label="Group by" options={[
            { value: 'month', label: 'By month' }, { value: 'service', label: 'By service' }, { value: 'contract', label: 'By contract' },
          ]} value={plGroup} onChange={(e) => setPlGroup(e.target.value)} />
        ) : null}
        {tab === 'general_ledger' ? (
          <Select aria-label="Account" options={toOptions(accounts, (a) => `${a.code} · ${a.name}`)} placeholder="Choose an account…"
            value={ledgerAccount} onChange={(e) => setLedgerAccount(e.target.value)} />
        ) : null}
        {asAt ? <Badge tone="grey">As at {formatDate(range.to)}</Badge> : null}
      </div>

      <Tabs tabs={[
        { value: 'profit_loss', label: 'Profit and loss' },
        { value: 'balance_sheet', label: 'Balance sheet' },
        { value: 'trial_balance', label: 'Trial balance' },
        { value: 'cash_flow', label: 'Cash flow' },
        { value: 'general_ledger', label: 'General ledger' },
        { value: 'ap_aging', label: 'Payables aging' },
        { value: 'revenue', label: 'Revenue' },
        { value: 'tax', label: 'Tax summary' },
        { value: 'expenses', label: 'Expenses' },
      ]} value={tab} onChange={setTab} />

      <div className="mt-4">
        {active?.isLoading ? <Spinner /> : active?.error ? <ErrorState error={active.error} onRetry={() => void active.refetch()} /> : null}

        {tab === 'trial_balance' && trial.data ? (
          <Card bodyClassName="p-0">
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-stone-50 text-left text-xs uppercase tracking-wide text-stone-500">
                  <tr>
                    <th scope="col" className="px-3 py-2 font-medium">Code</th>
                    <th scope="col" className="px-3 py-2 font-medium">Account</th>
                    <th scope="col" className="px-3 py-2 font-medium">Type</th>
                    <th scope="col" className="px-3 py-2 text-right font-medium">Debit</th>
                    <th scope="col" className="px-3 py-2 text-right font-medium">Credit</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-100">
                  {trial.data.map((r) => (
                    <tr key={r.code}>
                      <td className="px-3 py-2 font-mono text-xs">{r.code}</td>
                      <td className="px-3 py-2">{r.name}</td>
                      <td className="px-3 py-2 text-stone-500">{humanize(r.account_type)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{Number(r.debit) ? formatGHS(r.debit) : ''}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{Number(r.credit) ? formatGHS(r.credit) : ''}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="bg-stone-50 font-semibold">
                  <tr>
                    <td colSpan={3} className="px-3 py-2">Total</td>
                    <td className="px-3 py-2 text-right tabular-nums">{formatGHS(trialTotals.debit)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{formatGHS(trialTotals.credit)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
            <p className="p-3 text-sm">
              {Math.abs(trialTotals.debit - trialTotals.credit) < 0.005
                ? <Badge tone="green">Debits equal credits — the ledger balances</Badge>
                : <Badge tone="red">Out by {formatGHS(trialTotals.debit - trialTotals.credit)}</Badge>}
            </p>
          </Card>
        ) : null}

        {tab === 'profit_loss' && pl.data ? (
          <>
            <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
              <Card title="Revenue"><p className="text-xl font-semibold tabular-nums">{formatGHS(plTotals.income)}</p></Card>
              <Card title="Direct costs"><p className="text-xl font-semibold tabular-nums">{formatGHS(plTotals.direct)}</p></Card>
              <Card title="Gross profit"><p className="text-xl font-semibold tabular-nums">{formatGHS(plTotals.income - plTotals.direct)}</p></Card>
              <Card title="Net profit">
                <p className={`text-xl font-semibold tabular-nums ${plTotals.income - plTotals.expense < 0 ? 'text-red-700' : 'text-emerald-700'}`}>
                  {formatGHS(plTotals.income - plTotals.expense)}
                </p>
              </Card>
            </div>
            {pl.data.length ? (
              <Card bodyClassName="p-0">
                <div className="overflow-x-auto">
                  <table className="min-w-full text-sm">
                    <thead className="bg-stone-50 text-left text-xs uppercase tracking-wide text-stone-500">
                      <tr>
                        <th scope="col" className="px-3 py-2 font-medium">{plGroup === 'month' ? 'Month' : plGroup === 'service' ? 'Service' : 'Contract'}</th>
                        <th scope="col" className="px-3 py-2 font-medium">Account</th>
                        <th scope="col" className="px-3 py-2 font-medium">Type</th>
                        <th scope="col" className="px-3 py-2 text-right font-medium">Amount</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-stone-100">
                      {pl.data.map((r, i) => (
                        <tr key={`${r.group_key}-${r.code}-${i}`}>
                          <td className="px-3 py-2">{r.group_label}</td>
                          <td className="px-3 py-2"><span className="font-mono text-xs text-stone-500">{r.code}</span> {r.name}</td>
                          <td className="px-3 py-2">
                            <Badge tone={r.account_type === 'income' ? 'green' : 'red'}>{humanize(r.account_type)}</Badge>
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums">{formatGHS(r.amount)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>
            ) : <EmptyState title="Nothing posted in this period" />}
          </>
        ) : null}

        {tab === 'balance_sheet' && balance.data ? (
          <>
            <div className="mb-4 grid grid-cols-3 gap-3">
              <Card title="Assets"><p className="text-xl font-semibold tabular-nums">{formatGHS(balanceTotals.assets)}</p></Card>
              <Card title="Liabilities"><p className="text-xl font-semibold tabular-nums">{formatGHS(balanceTotals.liabilities)}</p></Card>
              <Card title="Equity"><p className="text-xl font-semibold tabular-nums">{formatGHS(balanceTotals.equity)}</p></Card>
            </div>
            <Card bodyClassName="p-0">
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead className="bg-stone-50 text-left text-xs uppercase tracking-wide text-stone-500">
                    <tr>
                      <th scope="col" className="px-3 py-2 font-medium">Section</th>
                      <th scope="col" className="px-3 py-2 font-medium">Account</th>
                      <th scope="col" className="px-3 py-2 text-right font-medium">Amount</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-stone-100">
                    {balance.data.map((r, i) => (
                      <tr key={`${r.section}-${r.code}-${i}`}>
                        <td className="px-3 py-2 text-stone-600">{humanize(r.section)}</td>
                        <td className="px-3 py-2"><span className="font-mono text-xs text-stone-500">{r.code}</span> {r.name}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{formatGHS(r.amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="p-3 text-sm">
                {Math.abs(balanceTotals.assets - (balanceTotals.liabilities + balanceTotals.equity)) < 0.01
                  ? <Badge tone="green">Assets equal liabilities plus equity</Badge>
                  : <Badge tone="amber">Difference {formatGHS(balanceTotals.assets - balanceTotals.liabilities - balanceTotals.equity)} — this is current-year profit until it is closed to retained earnings</Badge>}
              </p>
            </Card>
          </>
        ) : null}

        {tab === 'cash_flow' && cash.data ? (
          <Card bodyClassName="p-0">
            <table className="min-w-full text-sm">
              <tbody className="divide-y divide-stone-100">
                {cash.data.map((r, i) => (
                  <tr key={i} className={/total|net|opening|closing/i.test(r.category) ? 'bg-stone-50 font-semibold' : undefined}>
                    <td className="px-3 py-2">{r.category}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{formatGHS(r.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="p-3 text-xs text-stone-500">A simple cash flow: what came in and went out of the cash, bank and MoMo accounts.</p>
          </Card>
        ) : null}

        {tab === 'general_ledger' ? (
          !ledgerAccount ? <EmptyState title="Choose an account" message="Pick an account above to see every posting against it." />
            : ledger.data ? (
              <Card bodyClassName="p-0">
                <div className="overflow-x-auto">
                  <table className="min-w-full text-sm">
                    <thead className="bg-stone-50 text-left text-xs uppercase tracking-wide text-stone-500">
                      <tr>
                        <th scope="col" className="px-3 py-2 font-medium">Date</th>
                        <th scope="col" className="px-3 py-2 font-medium">Journal</th>
                        <th scope="col" className="px-3 py-2 font-medium">Description</th>
                        <th scope="col" className="px-3 py-2 text-right font-medium">Debit</th>
                        <th scope="col" className="px-3 py-2 text-right font-medium">Credit</th>
                        <th scope="col" className="px-3 py-2 text-right font-medium">Balance</th>
                        <th scope="col" className="px-3 py-2 font-medium">Cleared</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-stone-100">
                      {ledger.data.map((r) => (
                        <tr key={r.line_id}>
                          <td className="whitespace-nowrap px-3 py-2">{formatDate(r.entry_date)}</td>
                          <td className="px-3 py-2 font-mono text-xs">{r.entry_no}</td>
                          <td className="px-3 py-2">{r.description}</td>
                          <td className="px-3 py-2 text-right tabular-nums">{Number(r.debit) ? formatGHS(r.debit) : ''}</td>
                          <td className="px-3 py-2 text-right tabular-nums">{Number(r.credit) ? formatGHS(r.credit) : ''}</td>
                          <td className="px-3 py-2 text-right tabular-nums font-medium">{formatGHS(r.balance)}</td>
                          <td className="px-3 py-2">{r.cleared ? <Badge tone="green">Cleared</Badge> : null}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {!ledger.data.length ? <p className="p-4 text-sm text-stone-500">Nothing posted to this account in the period.</p> : null}
              </Card>
            ) : null
        ) : null}

        {tab === 'ap_aging' && ap.data ? (
          ap.data.length ? (
            <Card bodyClassName="p-0">
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead className="bg-stone-50 text-left text-xs uppercase tracking-wide text-stone-500">
                    <tr>
                      <th scope="col" className="px-3 py-2 font-medium">Supplier</th>
                      <th scope="col" className="px-3 py-2 text-right font-medium">Current</th>
                      <th scope="col" className="px-3 py-2 text-right font-medium">1–30</th>
                      <th scope="col" className="px-3 py-2 text-right font-medium">31–60</th>
                      <th scope="col" className="px-3 py-2 text-right font-medium">61–90</th>
                      <th scope="col" className="px-3 py-2 text-right font-medium">90+</th>
                      <th scope="col" className="px-3 py-2 text-right font-medium">Total</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-stone-100">
                    {ap.data.map((r) => (
                      <tr key={r.supplier_id}>
                        <td className="px-3 py-2 font-medium">{r.supplier_name}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{Number(r.current_amt) ? formatGHS(r.current_amt) : '—'}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{Number(r.d1_30) ? formatGHS(r.d1_30) : '—'}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{Number(r.d31_60) ? formatGHS(r.d31_60) : '—'}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{Number(r.d61_90) ? formatGHS(r.d61_90) : '—'}</td>
                        <td className="px-3 py-2 text-right tabular-nums font-medium text-red-700">{Number(r.d90_plus) ? formatGHS(r.d90_plus) : '—'}</td>
                        <td className="px-3 py-2 text-right tabular-nums font-semibold">{formatGHS(r.total)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="p-3 text-xs text-stone-500"><Link to="/finance/bills" className="text-brand-700 hover:underline">Open the bills list</Link> to pay these.</p>
            </Card>
          ) : <EmptyState title="Nothing owed to suppliers" />
        ) : null}

        {tab === 'tax' && tax.data ? (
          tax.data.length ? (
            <Card bodyClassName="p-0">
              <table className="min-w-full text-sm">
                <thead className="bg-stone-50 text-left text-xs uppercase tracking-wide text-stone-500">
                  <tr>
                    <th scope="col" className="px-3 py-2 font-medium">Tax</th>
                    <th scope="col" className="px-3 py-2 font-medium">Account</th>
                    <th scope="col" className="px-3 py-2 text-right font-medium">Collected</th>
                    <th scope="col" className="px-3 py-2 text-right font-medium">Reversed</th>
                    <th scope="col" className="px-3 py-2 text-right font-medium">Net payable</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-100">
                  {tax.data.map((r, i) => (
                    <tr key={i}>
                      <td className="px-3 py-2 font-medium">{r.tax_name}</td>
                      <td className="px-3 py-2 font-mono text-xs">{r.account_code}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{formatGHS(r.collected)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{Number(r.reversed) ? formatGHS(r.reversed) : '—'}</td>
                      <td className="px-3 py-2 text-right tabular-nums font-medium">{formatGHS(r.net)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="p-3 text-xs text-stone-500">
                Each tax posts to its own liability account. Check the current rates with the GRA and set them in
                Settings &gt; Taxes — the app never assumes a rate.
              </p>
            </Card>
          ) : <EmptyState title="No tax charged in this period" message="Taxes are inactive until an admin sets the current rates." />
        ) : null}

        {/* The working behind the summary above: which customer, on which invoice, at what rate.
            The summary is the figure that gets filed; this is what proves it. */}
        {tab === 'tax' && taxDetail.data?.length ? (
          <Card className="mt-4" bodyClassName="p-0" title="Every document behind those figures">
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-stone-50 text-left text-xs uppercase tracking-wide text-stone-500">
                  <tr>
                    <th scope="col" className="px-3 py-2 font-medium">Date</th>
                    <th scope="col" className="px-3 py-2 font-medium">Document</th>
                    <th scope="col" className="px-3 py-2 font-medium">Customer</th>
                    <th scope="col" className="px-3 py-2 font-medium">TIN</th>
                    <th scope="col" className="px-3 py-2 font-medium">Tax</th>
                    <th scope="col" className="px-3 py-2 text-right font-medium">Rate</th>
                    <th scope="col" className="px-3 py-2 text-right font-medium">Taxable</th>
                    <th scope="col" className="px-3 py-2 text-right font-medium">Tax</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-100">
                  {taxDetail.data.map((r, i) => (
                    <tr key={i} className={Number(r.tax_amount) < 0 ? 'text-red-800' : undefined}>
                      <td className="whitespace-nowrap px-3 py-2">{formatDate(r.doc_date)}</td>
                      <td className="px-3 py-2">
                        <span className="font-mono text-xs">{r.doc_no ?? '—'}</span>
                        <span className="ml-1 text-xs text-stone-500">{r.doc_type}</span>
                      </td>
                      <td className="px-3 py-2">
                        {r.customer_name ?? '—'}
                        {r.customer_code ? <span className="ml-1 font-mono text-xs text-stone-500">{r.customer_code}</span> : null}
                      </td>
                      <td className="px-3 py-2 font-mono text-xs">{r.customer_tin ?? '—'}</td>
                      <td className="px-3 py-2">{r.tax_name}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{r.rate === null ? '—' : `${Number(r.rate)}%`}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{formatGHS(r.taxable_amount)}</td>
                      <td className="px-3 py-2 text-right font-medium tabular-nums">{formatGHS(r.tax_amount)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="border-t-2 border-stone-300 bg-stone-50 font-semibold">
                  <tr>
                    <td className="px-3 py-2" colSpan={6}>Total</td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {formatGHS(taxDetail.data.reduce((t, r) => t + Number(r.taxable_amount), 0))}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {formatGHS(taxDetail.data.reduce((t, r) => t + Number(r.tax_amount), 0))}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
            <p className="p-3 text-xs text-stone-500">
              Credit notes appear as negatives, which is why this total agrees with the net payable above rather than
              with the amount collected.
            </p>
          </Card>
        ) : null}

        {/* ---------- Revenue only: what was earned, and on what ---------- */}
        {tab === 'revenue' && revenue.data ? (
          revenue.data.length ? (
            <div className="space-y-4">
              <Card bodyClassName="p-0" title="Earned by period and income account">
                <div className="overflow-x-auto">
                  <table className="min-w-full text-sm">
                    <thead className="bg-stone-50 text-left text-xs uppercase tracking-wide text-stone-500">
                      <tr>
                        <th scope="col" className="px-3 py-2 font-medium">Period</th>
                        <th scope="col" className="px-3 py-2 font-medium">Account</th>
                        <th scope="col" className="px-3 py-2 font-medium">Income</th>
                        <th scope="col" className="px-3 py-2 font-medium">Kind</th>
                        <th scope="col" className="px-3 py-2 text-right font-medium">Earned</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-stone-100">
                      {revenue.data.map((r, i) => (
                        <tr key={i}>
                          <td className="whitespace-nowrap px-3 py-2">{r.bucket}</td>
                          <td className="px-3 py-2 font-mono text-xs">{r.account_code}</td>
                          <td className="px-3 py-2">{r.account_name}</td>
                          <td className="px-3 py-2 text-stone-600">{r.subtype ? humanize(r.subtype) : '—'}</td>
                          <td className="px-3 py-2 text-right font-medium tabular-nums">{formatGHS(r.earned)}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot className="border-t-2 border-stone-300 bg-stone-50 font-semibold">
                      <tr>
                        <td className="px-3 py-2" colSpan={4}>Total earned</td>
                        <td className="px-3 py-2 text-right tabular-nums">
                          {formatGHS(revenue.data.reduce((t, r) => t + Number(r.earned), 0))}
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
                <p className="p-3 text-xs text-stone-500">
                  Taken from posted entries on income accounts, so this agrees with the books: work invoiced but not
                  yet recognised is not counted as earned, and a reversal reduces the figure. Tax is not income and
                  does not appear — it is in the Tax summary.
                </p>
              </Card>

              {revenueByService.data?.length ? (
                <Card bodyClassName="p-0" title="Earned on each service">
                  <div className="overflow-x-auto">
                    <table className="min-w-full text-sm">
                      <thead className="bg-stone-50 text-left text-xs uppercase tracking-wide text-stone-500">
                        <tr>
                          <th scope="col" className="px-3 py-2 font-medium">Service</th>
                          <th scope="col" className="px-3 py-2 text-right font-medium">Invoices</th>
                          <th scope="col" className="px-3 py-2 text-right font-medium">Net</th>
                          <th scope="col" className="px-3 py-2 text-right font-medium">Tax</th>
                          <th scope="col" className="px-3 py-2 text-right font-medium">Invoiced</th>
                          <th scope="col" className="px-3 py-2 text-right font-medium">Share</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-stone-100">
                        {revenueByService.data.map((r, i) => {
                          const totalNet = revenueByService.data!.reduce((t, x) => t + Number(x.net), 0);
                          return (
                            <tr key={i}>
                              <td className="px-3 py-2 font-medium">{r.service_name}</td>
                              <td className="px-3 py-2 text-right tabular-nums">{r.invoices}</td>
                              <td className="px-3 py-2 text-right tabular-nums">{formatGHS(r.net)}</td>
                              <td className="px-3 py-2 text-right tabular-nums">{Number(r.tax) ? formatGHS(r.tax) : '—'}</td>
                              <td className="px-3 py-2 text-right tabular-nums">{formatGHS(r.gross)}</td>
                              <td className="px-3 py-2 text-right tabular-nums">
                                {totalNet ? `${((Number(r.net) / totalNet) * 100).toFixed(1)}%` : '—'}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                  <p className="p-3 text-xs text-stone-500">
                    From invoice lines rather than the ledger, because accounts are not kept per service. Totals here
                    count what was invoiced in the period, so they can differ from the earned figure above where
                    revenue is deferred.
                  </p>
                </Card>
              ) : null}
            </div>
          ) : <EmptyState title="Nothing earned in this period" message="No income was posted between these dates." />
        ) : null}

        {tab === 'expenses' && expenses.data ? (
          expenses.data.length ? (
            <Card bodyClassName="p-0">
              <table className="min-w-full text-sm">
                <thead className="bg-stone-50 text-left text-xs uppercase tracking-wide text-stone-500">
                  <tr>
                    <th scope="col" className="px-3 py-2 font-medium">Account</th>
                    <th scope="col" className="px-3 py-2 font-medium">Kind</th>
                    <th scope="col" className="px-3 py-2 text-right font-medium">Amount</th>
                    <th scope="col" className="px-3 py-2 text-right font-medium">Share</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-100">
                  {expenses.data.map((r) => (
                    <tr key={r.code}>
                      <td className="px-3 py-2"><span className="font-mono text-xs text-stone-500">{r.code}</span> {r.name}</td>
                      <td className="px-3 py-2"><Badge tone={r.subtype === 'direct' ? 'amber' : 'grey'}>{r.subtype ? humanize(r.subtype) : '—'}</Badge></td>
                      <td className="px-3 py-2 text-right tabular-nums font-medium">{formatGHS(r.amount)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{expenseTotal ? `${((Number(r.amount) / expenseTotal) * 100).toFixed(1)}%` : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          ) : <EmptyState title="No expenses in this period" />
        ) : null}
      </div>

      <p className="mt-4 text-xs text-stone-500">
        Reports read the posted general ledger only; drafts never appear. A lock date in Settings stops anything being
        posted into a period you have already reported on.
      </p>
    </div>
  );
}
