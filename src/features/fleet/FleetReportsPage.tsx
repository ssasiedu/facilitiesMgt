import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Download } from 'lucide-react';
import { rpc } from '@/lib/rpc';
import { useSettings } from '@/lib/settings';
import { formatDate, formatGHS, formatNumber, formatPct, humanize } from '@/lib/format';
import { exportXlsx } from '@/lib/export';
import { downloadPdf } from '@/lib/pdf/download';
import { ReportPdf } from '@/lib/pdf/ReportPdf';
import { companyFromSettings } from '@/lib/pdf/company';
import { PageHeader } from '@/components/ui/PageHeader';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { DateRange, presetRange, type Preset } from '@/components/ui/DateRange';
import { Spinner } from '@/components/ui/Spinner';
import { ErrorState } from '@/components/ui/ErrorState';
import { EmptyState } from '@/components/ui/EmptyState';

interface FleetRow {
  truck_id: string; registration_no: string; truck_type: string; status: string; days: number; downtime_days: number;
  availability_pct: number | null; jobs: number; revenue: number; maintenance_cost: number; fuel_cost: number;
  fuel_litres: number; km: number; cost_per_km: number | null; km_per_litre: number | null;
}

/** Fleet reports (spec 4.5): availability, downtime, cost per truck and per km, jobs and revenue. */
export default function FleetReportsPage() {
  const settings = useSettings();
  const [preset, setPreset] = useState<Preset>('mtd');
  const [range, setRange] = useState(() => presetRange('mtd'));

  const { data = [], isLoading, error, refetch } = useQuery({
    queryKey: ['fleet-report', range.from, range.to],
    queryFn: () => rpc<FleetRow[]>('rpt_fleet', { p_from: range.from, p_to: range.to }),
  });

  const totals = useMemo(() => data.reduce((t, r) => ({
    trucks: t.trucks + 1,
    downtime: t.downtime + Number(r.downtime_days),
    jobs: t.jobs + Number(r.jobs),
    revenue: t.revenue + Number(r.revenue),
    maintenance: t.maintenance + Number(r.maintenance_cost),
    fuel: t.fuel + Number(r.fuel_cost),
    km: t.km + Number(r.km),
  }), { trucks: 0, downtime: 0, jobs: 0, revenue: 0, maintenance: 0, fuel: 0, km: 0 }), [data]);

  const overallAvailability = data.length
    ? data.reduce((s, r) => s + Number(r.availability_pct ?? 0), 0) / data.length
    : null;

  const exportExcel = () => exportXlsx(data, [
    { header: 'Registration', value: (r: FleetRow) => r.registration_no },
    { header: 'Type', value: (r: FleetRow) => humanize(r.truck_type) },
    { header: 'Status', value: (r: FleetRow) => r.status },
    { header: 'Days in period', value: (r: FleetRow) => r.days },
    { header: 'Downtime days', value: (r: FleetRow) => r.downtime_days },
    { header: 'Availability %', value: (r: FleetRow) => r.availability_pct },
    { header: 'Jobs', value: (r: FleetRow) => r.jobs },
    { header: 'Revenue', value: (r: FleetRow) => r.revenue },
    { header: 'Maintenance cost', value: (r: FleetRow) => r.maintenance_cost },
    { header: 'Fuel cost', value: (r: FleetRow) => r.fuel_cost },
    { header: 'Litres', value: (r: FleetRow) => r.fuel_litres },
    { header: 'Km', value: (r: FleetRow) => r.km },
    { header: 'Cost per km', value: (r: FleetRow) => r.cost_per_km },
    { header: 'Km per litre', value: (r: FleetRow) => r.km_per_litre },
  ], `fleet-report-${range.from}-to-${range.to}`);

  const exportPdf = () => {
    if (!settings) return;
    void downloadPdf(
      <ReportPdf company={companyFromSettings(settings)} title="Fleet report"
        subtitle={`${formatDate(range.from)} – ${formatDate(range.to)}`}
        summary={[
          ['Trucks', String(totals.trucks)],
          ['Overall availability', overallAvailability === null ? '—' : formatPct(overallAvailability)],
          ['Maintenance + fuel', formatGHS(totals.maintenance + totals.fuel)],
          ['Revenue', formatGHS(totals.revenue)],
        ]}
        sections={[{
          columns: [
            { label: 'Truck', width: '14%', key: 'reg' },
            { label: 'Type', width: '14%', key: 'type' },
            { label: 'Downtime', width: '9%', align: 'right', key: 'downtime' },
            { label: 'Availability', width: '10%', align: 'right', key: 'availability' },
            { label: 'Jobs', width: '7%', align: 'right', key: 'jobs' },
            { label: 'Revenue', width: '12%', align: 'right', key: 'revenue' },
            { label: 'Maintenance', width: '12%', align: 'right', key: 'maintenance' },
            { label: 'Fuel', width: '11%', align: 'right', key: 'fuel' },
            { label: 'Cost / km', width: '11%', align: 'right', key: 'cpk' },
          ],
          rows: data.map((r) => ({
            reg: r.registration_no, type: humanize(r.truck_type), downtime: `${r.downtime_days} d`,
            availability: r.availability_pct === null ? '—' : formatPct(r.availability_pct), jobs: r.jobs,
            revenue: formatGHS(r.revenue), maintenance: formatGHS(r.maintenance_cost), fuel: formatGHS(r.fuel_cost),
            cpk: r.cost_per_km === null ? '—' : formatGHS(r.cost_per_km),
          })),
        }]}
      />,
      `fleet-report-${range.to}`,
    );
  };

  if (isLoading) return <Spinner />;
  if (error) return <ErrorState error={error} onRetry={() => void refetch()} />;

  return (
    <div>
      <PageHeader title="Fleet reports" subtitle="Availability, downtime, running cost and revenue per truck"
        actions={<>
          <Button variant="secondary" size="sm" icon={<Download className="h-4 w-4" />} onClick={exportExcel}>Excel</Button>
          <Button variant="secondary" size="sm" icon={<Download className="h-4 w-4" />} onClick={exportPdf}>PDF</Button>
        </>} />

      <div className="mb-4">
        <DateRange from={range.from} to={range.to} preset={preset} onPreset={setPreset} onChange={(from, to) => setRange({ from, to })} />
      </div>

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Card title="Overall availability"><p className="text-xl font-semibold">{overallAvailability === null ? '—' : formatPct(overallAvailability)}</p>
          <p className="text-xs text-stone-500">{totals.downtime} downtime day(s) across {totals.trucks} truck(s)</p></Card>
        <Card title="Jobs completed"><p className="text-xl font-semibold tabular-nums">{formatNumber(totals.jobs)}</p></Card>
        <Card title="Revenue from fleet jobs"><p className="text-xl font-semibold tabular-nums">{formatGHS(totals.revenue)}</p></Card>
        <Card title="Running cost"><p className="text-xl font-semibold tabular-nums">{formatGHS(totals.maintenance + totals.fuel)}</p>
          <p className="text-xs text-stone-500">{formatGHS(totals.maintenance)} maintenance · {formatGHS(totals.fuel)} fuel</p></Card>
      </div>

      {!data.length ? <EmptyState title="No trucks yet" message="Add trucks under Fleet > Trucks." /> : (
        <>
          <Card className="mb-4" title="Availability per truck">
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data.map((r) => ({ name: r.registration_no, availability: Number(r.availability_pct ?? 0) }))}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e7e5e4" />
                  <XAxis dataKey="name" fontSize={11} />
                  <YAxis fontSize={11} domain={[0, 100]} tickFormatter={(v: number) => `${v}%`} />
                  <Tooltip formatter={(v: number) => `${v}%`} />
                  <Bar dataKey="availability" radius={[4, 4, 0, 0]}>
                    {data.map((r) => (
                      <Cell key={r.truck_id} fill={Number(r.availability_pct ?? 0) >= 90 ? '#059669' : Number(r.availability_pct ?? 0) >= 70 ? '#d97706' : '#dc2626'} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Card>

          <Card title="Per truck" bodyClassName="p-0">
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-stone-50 text-left text-xs uppercase tracking-wide text-stone-500">
                  <tr>
                    <th scope="col" className="px-3 py-2 font-medium">Truck</th>
                    <th scope="col" className="px-3 py-2 font-medium">Type</th>
                    <th scope="col" className="px-3 py-2 font-medium">Status</th>
                    <th scope="col" className="px-3 py-2 text-right font-medium">Downtime</th>
                    <th scope="col" className="px-3 py-2 text-right font-medium">Availability</th>
                    <th scope="col" className="px-3 py-2 text-right font-medium">Jobs</th>
                    <th scope="col" className="px-3 py-2 text-right font-medium">Revenue</th>
                    <th scope="col" className="px-3 py-2 text-right font-medium">Maintenance</th>
                    <th scope="col" className="px-3 py-2 text-right font-medium">Fuel</th>
                    <th scope="col" className="px-3 py-2 text-right font-medium">Km</th>
                    <th scope="col" className="px-3 py-2 text-right font-medium">Cost / km</th>
                    <th scope="col" className="px-3 py-2 text-right font-medium">Km / litre</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-100">
                  {data.map((r) => (
                    <tr key={r.truck_id}>
                      <td className="px-3 py-2"><Link to={`/fleet/trucks/${r.truck_id}`} className="font-medium text-brand-700 hover:underline">{r.registration_no}</Link></td>
                      <td className="px-3 py-2">{humanize(r.truck_type)}</td>
                      <td className="px-3 py-2"><StatusBadge status={r.status} /></td>
                      <td className="px-3 py-2 text-right tabular-nums">{r.downtime_days} / {r.days} d</td>
                      <td className="px-3 py-2 text-right">
                        <Badge tone={Number(r.availability_pct ?? 0) >= 90 ? 'green' : Number(r.availability_pct ?? 0) >= 70 ? 'amber' : 'red'}>
                          {r.availability_pct === null ? '—' : formatPct(r.availability_pct)}
                        </Badge>
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">{r.jobs}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{formatGHS(r.revenue)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{formatGHS(r.maintenance_cost)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{formatGHS(r.fuel_cost)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{formatNumber(r.km)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{r.cost_per_km === null ? '—' : formatGHS(r.cost_per_km)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{r.km_per_litre === null ? '—' : formatNumber(r.km_per_litre)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="p-3 text-xs text-stone-500">
              Kilometres come from the odometer readings on fuel entries, so record the odometer at each fill-up to get
              cost per km and km per litre.
            </p>
          </Card>
        </>
      )}
    </div>
  );
}
