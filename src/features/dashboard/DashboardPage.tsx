import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { AlertTriangle, Download, RefreshCw } from 'lucide-react';
import { rpc } from '@/lib/rpc';
import { useRealtimeInvalidate } from '@/lib/realtime';
import { useServices, useZones, toOptions } from '@/lib/lookups';
import { formatDate, formatGHS, formatNumber, formatPct, humanize } from '@/lib/format';
import { useSettings } from '@/lib/settings';
import { downloadPdf } from '@/lib/pdf/download';
import { ReportPdf } from '@/lib/pdf/ReportPdf';
import { companyFromSettings } from '@/lib/pdf/company';
import { PageHeader } from '@/components/ui/PageHeader';
import { Card } from '@/components/ui/Card';
import { StatCard } from '@/components/ui/StatCard';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { DateRange, presetRange, type Preset } from '@/components/ui/DateRange';
import { FilterSelect } from '@/components/ui/DataTable';
import { PageSkeleton } from '@/components/ui/Skeleton';
import { ErrorState } from '@/components/ui/ErrorState';
import { EmptyState } from '@/components/ui/EmptyState';
import type { DashboardData } from './types';

const PALETTE = ['#0f766e', '#2563eb', '#d97706', '#be123c', '#7c3aed', '#0891b2', '#65a30d', '#c2410c'];
const money = (v: number) => formatGHS(v);
const axisMoney = (v: number) => (Math.abs(v) >= 1000 ? `${Math.round(v / 1000)}k` : String(v));

/** Executive dashboard. Every number comes from get_dashboard() in SQL; cards drill down to their lists. */
export default function DashboardPage() {
  const settings = useSettings();
  const [preset, setPreset] = useState<Preset>('mtd');
  const [range, setRange] = useState(() => presetRange('mtd'));
  const [service, setService] = useState('');
  const [zone, setZone] = useState('');
  const [customerType, setCustomerType] = useState('');
  const { data: services } = useServices(true);
  const { data: zones } = useZones();

  const args = useMemo(() => ({
    p_from: range.from, p_to: range.to,
    p_service: service || undefined, p_zone: zone || undefined, p_customer_type: customerType || undefined,
  }), [range.from, range.to, service, zone, customerType]);

  const { data, isLoading, error, refetch, isFetching } = useQuery({
    queryKey: ['dashboard', args],
    queryFn: () => rpc<DashboardData>('get_dashboard', args),
    staleTime: 60_000,
  });

  // Numbers refresh live as jobs, payments and tasks change.
  useRealtimeInvalidate(['job_orders', 'payments', 'trucks'], [['dashboard']]);

  if (isLoading) return <PageSkeleton />;
  if (error || !data) return <ErrorState error={error ?? new Error('No data')} onRetry={() => void refetch()} />;

  const d = data;
  const cash = (d.balances?.cash ?? 0) + (d.balances?.bank ?? 0) + (d.balances?.momo ?? 0);
  const alerts = d.alerts;
  const alertCount = alerts.jobs_waiting_24h.length + (alerts.overdue_invoices.count > 0 ? 1 : 0) + alerts.loss_contracts.length
    + alerts.off_road_trucks.length + alerts.expiring_documents.length + alerts.low_stock.length + alerts.low_surveys.length;

  const exportPdf = () => {
    if (!settings) return;
    const measures: [string, string][] = [
      ['Recognised revenue', money(d.revenue.value)],
      ['Cash collected', money(d.cash_collected.value)],
      ['Expenses', money(d.expenses.value)],
      ['Gross profit', money(d.gross_profit.value)],
      ['Gross margin', formatPct(d.gross_margin.value)],
      ['Outstanding receivables', money(d.receivables.outstanding)],
      ['Overdue receivables', money(d.receivables.overdue)],
      ['Cash, bank and MoMo', money(cash)],
      ['Jobs pending approval', formatNumber(d.jobs.pending_approval)],
      ['Jobs scheduled today', formatNumber(d.jobs.scheduled_today)],
      ['Jobs in progress', formatNumber(d.jobs.in_progress)],
      ['Jobs completed this month', formatNumber(d.jobs.completed_this_month)],
      ['Fleet availability', d.fleet.availability_pct === null ? '—' : formatPct(d.fleet.availability_pct)],
      ['Trucks Off-Road', formatNumber(d.fleet.off_road)],
      ['Active contracts', formatNumber(d.contracts.active)],
      ['Monthly recurring revenue', money(d.contracts.mrr)],
      ['CSAT', d.surveys?.csat ? `${d.surveys.csat} / 5` : '—'],
      ['NPS', d.surveys?.nps === null || d.surveys?.nps === undefined ? '—' : String(d.surveys.nps)],
      ['Zonal task completion', d.zonal?.completion_pct === null || d.zonal?.completion_pct === undefined ? '—' : formatPct(d.zonal.completion_pct)],
    ];
    void downloadPdf(
      <ReportPdf
        company={companyFromSettings(settings)}
        title="Executive dashboard"
        subtitle={`${formatDate(range.from)} – ${formatDate(range.to)}`}
        summary={[
          ['Revenue', money(d.revenue.value)],
          ['Collected', money(d.cash_collected.value)],
          ['Gross profit', money(d.gross_profit.value)],
          ['Overdue', money(d.receivables.overdue)],
        ]}
        sections={[
          { title: 'Key figures', columns: [{ label: 'Measure', width: '60%', key: 'measure' }, { label: 'Value', width: '40%', align: 'right', key: 'value' }],
            rows: measures.map(([measure, value]) => ({ measure, value })) },
          { title: 'Revenue by service', columns: [{ label: 'Service', width: '60%', key: 'name' }, { label: 'Revenue', width: '40%', align: 'right', key: 'value' }],
            rows: d.charts.revenue_by_service.map((r) => ({ name: r.name, value: money(r.value) })) },
          { title: 'Top customers', columns: [{ label: 'Customer', width: '60%', key: 'name' }, { label: 'Revenue', width: '40%', align: 'right', key: 'revenue' }],
            rows: d.charts.top_customers.map((r) => ({ name: r.name ?? '—', revenue: money(r.revenue) })) },
        ]}
      />,
      `dashboard-${range.to}`,
    );
  };

  return (
    <div>
      <PageHeader title="Executive dashboard" subtitle={`${formatDate(range.from)} – ${formatDate(range.to)}, compared with the previous period`}
        actions={<>
          <Button variant="secondary" size="sm" icon={<RefreshCw className="h-4 w-4" />} loading={isFetching} onClick={() => void refetch()}>Refresh</Button>
          <Button variant="secondary" size="sm" icon={<Download className="h-4 w-4" />} onClick={exportPdf}>PDF</Button>
        </>} />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <DateRange from={range.from} to={range.to} preset={preset} onPreset={setPreset} onChange={(from, to) => setRange({ from, to })} />
        <FilterSelect label="Service" value={service} onChange={setService} options={toOptions(services, (s) => s.name)} />
        <FilterSelect label="Zone" value={zone} onChange={setZone} options={toOptions(zones, (z) => z.name)} />
        <FilterSelect label="Customer type" value={customerType} onChange={setCustomerType}
          options={[{ value: 'individual', label: 'Individual' }, { value: 'company', label: 'Company' }]} />
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Recognised revenue" value={money(d.revenue.value)} current={d.revenue.value} previous={d.revenue.prev} to="/finance/reports" />
        <StatCard label="Cash collected" value={money(d.cash_collected.value)} current={d.cash_collected.value} previous={d.cash_collected.prev} to="/finance/payments" />
        <StatCard label="Gross profit" value={money(d.gross_profit.value)} current={d.gross_profit.value} previous={d.gross_profit.prev}
          hint={`Margin ${formatPct(d.gross_margin.value)}`} to="/finance/reports" />
        <StatCard label="Expenses" value={money(d.expenses.value)} current={d.expenses.value} previous={d.expenses.prev} invert to="/finance/expenses" />
        <StatCard label="Outstanding receivables" value={money(d.receivables.outstanding)} to="/finance/aging" hint="All unpaid invoices" />
        <StatCard label="Overdue receivables" value={money(d.receivables.overdue)} tone={d.receivables.overdue > 0 ? 'red' : undefined}
          hint={`${d.receivables.overdue_count} invoice(s)`} to="/finance/aging" />
        <StatCard label="Cash, bank and MoMo" value={money(cash)} to="/finance/banks" hint="Posted balances" />
        <StatCard label="Monthly recurring revenue" value={money(d.contracts.mrr)} hint={`${d.contracts.active} active contract(s)`} to="/contracts" />
        <StatCard label="Jobs pending approval" value={formatNumber(d.jobs.pending_approval)} tone={d.jobs.pending_approval > 0 ? 'amber' : undefined} to="/jobs?status=pending_approval" />
        <StatCard label="Scheduled today" value={formatNumber(d.jobs.scheduled_today)} to="/jobs/today" />
        <StatCard label="In progress" value={formatNumber(d.jobs.in_progress)} to="/jobs?status=in_progress" />
        <StatCard label="Completed this month" value={formatNumber(d.jobs.completed_this_month)} to="/jobs?status=completed" />
        <StatCard label="Fleet availability" value={d.fleet.availability_pct === null ? '—' : formatPct(d.fleet.availability_pct)}
          current={d.fleet.availability_pct} previous={d.fleet.availability_prev} to="/fleet/reports"
          tone={(d.fleet.availability_pct ?? 100) < 70 ? 'amber' : undefined} />
        <StatCard label="Trucks Off-Road" value={formatNumber(d.fleet.off_road)} tone={d.fleet.off_road > 0 ? 'red' : undefined}
          hint={`${d.fleet.on_road} on-road, ${d.fleet.on_job} on job`} to="/fleet/trucks" />
        <StatCard label="CSAT" value={d.surveys?.csat ? `${d.surveys.csat} / 5` : '—'} current={d.surveys?.csat} previous={d.surveys?.csat_prev}
          hint={`${d.surveys?.responses ?? 0} response(s)`} to="/surveys/reports" />
        <StatCard label="NPS" value={d.surveys?.nps === null || d.surveys?.nps === undefined ? '—' : String(d.surveys.nps)} to="/surveys/reports"
          hint="Promoters minus detractors" />
      </div>

      {alertCount > 0 ? (
        <Card className="mt-4 border-amber-200" title={<h2 className="flex items-center gap-2 text-sm font-semibold text-amber-900"><AlertTriangle className="h-4 w-4" />Needs attention ({alertCount})</h2>}>
          <ul className="grid grid-cols-1 gap-2 text-sm md:grid-cols-2">
            {alerts.jobs_waiting_24h.map((j) => (
              <li key={j.id}><Link to={`/jobs/${j.id}`} className="text-brand-700 hover:underline">{j.job_no}</Link> has been waiting for approval since {formatDate(j.since)} — {j.customer}</li>
            ))}
            {alerts.overdue_invoices.count > 0 ? (
              <li><Link to="/finance/aging" className="text-brand-700 hover:underline">{alerts.overdue_invoices.count} overdue invoice(s)</Link> worth {money(alerts.overdue_invoices.amount)}</li>
            ) : null}
            {alerts.loss_contracts.map((c) => (
              <li key={`${c.id}-${c.month}`}><Link to={`/contracts/${c.id}`} className="text-brand-700 hover:underline">{c.contract_no}</Link> lost {money(Math.abs(c.gross_profit))} in {formatDate(c.month)}</li>
            ))}
            {alerts.off_road_trucks.map((t) => (
              <li key={t.id}><Link to={`/fleet/trucks/${t.id}`} className="text-brand-700 hover:underline">{t.registration_no}</Link> is Off-Road ({humanize(t.reason)}), back {formatDate(t.return)}</li>
            ))}
            {alerts.expiring_documents.map((doc, i) => (
              <li key={i}><Link to={`/fleet/trucks/${doc.truck_id}`} className="text-brand-700 hover:underline">{doc.registration_no}</Link> {humanize(doc.doc_type)} expires {formatDate(doc.expiry)}</li>
            ))}
            {alerts.low_stock.map((s, i) => (
              <li key={i}><Link to="/supplies/stock" className="text-brand-700 hover:underline">{s.item}</Link> is low: {formatNumber(s.quantity)} left (reorder at {formatNumber(s.reorder)})</li>
            ))}
            {alerts.low_surveys.map((s) => (
              <li key={s.id}><Link to="/followups" className="text-brand-700 hover:underline">{s.title}</Link> needs follow-up</li>
            ))}
          </ul>
        </Card>
      ) : null}

      <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Card title="Revenue against expenses, last 12 months">
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={d.charts.revenue_vs_expenses ?? []}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e7e5e4" />
                <XAxis dataKey="month" fontSize={11} />
                <YAxis fontSize={11} tickFormatter={axisMoney} />
                <Tooltip formatter={(v: number) => money(v)} />
                <Legend />
                <Area type="monotone" dataKey="revenue" name="Revenue" stroke={PALETTE[0]} fill={PALETTE[0]} fillOpacity={0.18} />
                <Area type="monotone" dataKey="expenses" name="Expenses" stroke={PALETTE[3]} fill={PALETTE[3]} fillOpacity={0.14} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card title="Revenue by service" actions={<Link to="/finance/reports" className="text-xs text-brand-700 hover:underline">Open report</Link>}>
          <div className="h-72">
            {d.charts.revenue_by_service.length ? (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={d.charts.revenue_by_service} dataKey="value" nameKey="name" innerRadius={55} outerRadius={95} paddingAngle={2}>
                    {d.charts.revenue_by_service.map((_, i) => <Cell key={i} fill={PALETTE[i % PALETTE.length]} />)}
                  </Pie>
                  <Tooltip formatter={(v: number) => money(v)} />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
            ) : <EmptyState title="No revenue in this period" />}
          </div>
        </Card>

        <Card title="Receivables aging" actions={<Link to="/finance/aging" className="text-xs text-brand-700 hover:underline">Open aging report</Link>}>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={[
                { bucket: 'Current', amount: d.charts.aging.current },
                { bucket: '1–30', amount: d.charts.aging['1_30'] },
                { bucket: '31–60', amount: d.charts.aging['31_60'] },
                { bucket: '61–90', amount: d.charts.aging['61_90'] },
                { bucket: '90+', amount: d.charts.aging['90_plus'] },
              ]}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e7e5e4" />
                <XAxis dataKey="bucket" fontSize={11} />
                <YAxis fontSize={11} tickFormatter={axisMoney} />
                <Tooltip formatter={(v: number) => money(v)} />
                <Bar dataKey="amount" name="Balance" fill={PALETTE[2]} radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card title="Sales funnel">
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart layout="vertical" data={[
                { stage: 'Leads', count: d.charts.funnel.leads },
                { stage: 'Estimates', count: d.charts.funnel.estimates },
                { stage: 'Job orders', count: d.charts.funnel.jobs },
                { stage: 'Paid', count: d.charts.funnel.paid },
              ]}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e7e5e4" />
                <XAxis type="number" fontSize={11} allowDecimals={false} />
                <YAxis type="category" dataKey="stage" fontSize={11} width={80} />
                <Tooltip />
                <Bar dataKey="count" name="Count" fill={PALETTE[1]} radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card title="Collections trend">
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={d.charts.collections ?? []}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e7e5e4" />
                <XAxis dataKey="month" fontSize={11} />
                <YAxis fontSize={11} tickFormatter={axisMoney} />
                <Tooltip formatter={(v: number) => money(v)} />
                <Legend />
                <Line type="monotone" dataKey="invoiced" name="Invoiced" stroke={PALETTE[1]} strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="collected" name="Collected" stroke={PALETTE[0]} strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card title="Fleet status">
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={[
                  { name: 'On-Road', value: d.fleet.on_road },
                  { name: 'On job', value: d.fleet.on_job },
                  { name: 'Off-Road', value: d.fleet.off_road },
                ]} dataKey="value" nameKey="name" innerRadius={50} outerRadius={90}>
                  <Cell fill="#059669" /><Cell fill="#2563eb" /><Cell fill="#dc2626" />
                </Pie>
                <Tooltip />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card title="Contract profitability (best and worst)" actions={<Link to="/contracts" className="text-xs text-brand-700 hover:underline">All contracts</Link>}>
          {d.charts.contract_profitability.length ? (
            <ul className="divide-y divide-stone-100 text-sm">
              {d.charts.contract_profitability.map((c) => (
                <li key={c.contract_id} className="flex items-center justify-between gap-2 py-2">
                  <Link to={`/contracts/${c.contract_id}`} className="min-w-0 flex-1 truncate text-brand-700 hover:underline">{c.contract_no} · {c.title}</Link>
                  <span className="tabular-nums">{money(c.gp)}</span>
                  {c.loss ? <Badge tone="red">Loss</Badge> : <Badge tone="green">{c.margin === null ? '—' : formatPct(c.margin)}</Badge>}
                </li>
              ))}
            </ul>
          ) : <EmptyState title="No contract figures yet" />}
        </Card>

        <Card title="Top 10 customers" actions={<Link to="/customers" className="text-xs text-brand-700 hover:underline">All customers</Link>}>
          {d.charts.top_customers.length ? (
            <ul className="divide-y divide-stone-100 text-sm">
              {d.charts.top_customers.map((c) => (
                <li key={c.customer_id} className="flex items-center justify-between gap-2 py-2">
                  <Link to={`/customers/${c.customer_id}`} className="min-w-0 flex-1 truncate text-brand-700 hover:underline">{c.name}</Link>
                  <span className="tabular-nums">{money(c.revenue)}</span>
                </li>
              ))}
            </ul>
          ) : <EmptyState title="No invoices in this period" />}
        </Card>

        <Card className="xl:col-span-2" title="Estimate against actual cost" actions={<Link to="/estimates" className="text-xs text-brand-700 hover:underline">All estimates</Link>}>
          {d.charts.estimate_variance.length ? (
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-stone-50 text-left text-xs uppercase tracking-wide text-stone-500">
                  <tr>
                    <th scope="col" className="px-3 py-2 font-medium">Estimate</th>
                    <th scope="col" className="px-3 py-2 font-medium">Used on</th>
                    <th scope="col" className="px-3 py-2 text-right font-medium">Estimated cost</th>
                    <th scope="col" className="px-3 py-2 text-right font-medium">Actual cost</th>
                    <th scope="col" className="px-3 py-2 text-right font-medium">Variance</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-100">
                  {d.charts.estimate_variance.map((v) => (
                    <tr key={v.estimate_id}>
                      <td className="px-3 py-2"><Link to={`/estimates/${v.estimate_id}`} className="text-brand-700 hover:underline">{v.estimate_no}</Link></td>
                      <td className="px-3 py-2">
                        {v.target_type === 'job_order' && v.target_id ? <Link to={`/jobs/${v.target_id}`} className="text-brand-700 hover:underline">Job order</Link>
                          : v.target_type === 'contract' && v.target_id ? <Link to={`/contracts/${v.target_id}`} className="text-brand-700 hover:underline">Contract</Link>
                            : '—'}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">{money(v.estimated)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{money(v.actual)}</td>
                      <td className={`px-3 py-2 text-right tabular-nums ${v.variance > 0 ? 'text-red-700' : 'text-emerald-700'}`}>
                        {v.variance > 0 ? '+' : ''}{money(v.variance)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <EmptyState title="No completed work to compare yet" message="Variances appear once a job completes or a contract month closes." />}
        </Card>
      </div>
    </div>
  );
}
