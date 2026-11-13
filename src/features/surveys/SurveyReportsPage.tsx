import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Bar, BarChart, CartesianGrid, Cell, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Download, Smile, Star } from 'lucide-react';
import { supabase } from '@/lib/supabaseClient';
import { check } from '@/lib/rpc';
import { useServices, useTrucks, toOptions } from '@/lib/lookups';
import { formatDate, formatNumber, humanize } from '@/lib/format';
import { exportXlsx } from '@/lib/export';
import { PageHeader } from '@/components/ui/PageHeader';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Tabs } from '@/components/ui/Tabs';
import { FilterSelect } from '@/components/ui/DataTable';
import { DateRange, presetRange, type Preset } from '@/components/ui/DateRange';
import { Spinner } from '@/components/ui/Spinner';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import type { Tables } from '@/types/database';

type Response = Tables<'survey_responses'> & {
  customer: { id: string; display_name: string | null } | null;
  service: { id: string; name: string } | null;
  officer: { full_name: string } | null;
  driver: { full_name: string } | null;
  truck: { registration_no: string } | null;
  job_order: { id: string; job_no: string | null } | null;
};

type GroupKey = 'service' | 'officer' | 'driver' | 'truck';

/** Survey reports (spec 4.11): CSAT, NPS, results by service, officer, driver and truck, over time. */
export default function SurveyReportsPage() {
  const [preset, setPreset] = useState<Preset>('ytd');
  const [range, setRange] = useState(() => presetRange('ytd'));
  const [service, setService] = useState('');
  const [truck, setTruck] = useState('');
  const [tab, setTab] = useState<'overview' | 'breakdown' | 'comments'>('overview');
  const [groupBy, setGroupBy] = useState<GroupKey>('service');
  const { data: services } = useServices(true);
  const { data: trucks } = useTrucks();

  const { data = [], isLoading, error, refetch } = useQuery({
    queryKey: ['survey-responses', range.from, range.to, service, truck],
    queryFn: async () => {
      let q = supabase.from('survey_responses')
        .select(`*, customer:customers(id, display_name), service:services(id, name),
                 officer:profiles!survey_responses_officer_id_fkey(full_name),
                 driver:employees!survey_responses_driver_id_fkey(full_name),
                 truck:trucks(registration_no), job_order:job_orders(id, job_no)`)
        .gte('submitted_at', range.from).lte('submitted_at', `${range.to}T23:59:59`)
        .order('submitted_at', { ascending: false });
      if (service) q = q.eq('service_id', service);
      if (truck) q = q.eq('truck_id', truck);
      return check(await q) as Response[];
    },
  });

  const stats = useMemo(() => {
    const withCsat = data.filter((r) => r.csat !== null);
    const nps = data.filter((r) => r.nps_score !== null);
    const promoters = nps.filter((r) => Number(r.nps_score) >= 9).length;
    const detractors = nps.filter((r) => Number(r.nps_score) <= 6).length;
    return {
      responses: data.length,
      csat: withCsat.length ? withCsat.reduce((t, r) => t + Number(r.csat), 0) / withCsat.length : null,
      nps: nps.length ? Math.round(((promoters - detractors) / nps.length) * 1000) / 10 : null,
      promoters, detractors, passives: nps.length - promoters - detractors,
      low: data.filter((r) => r.is_low).length,
    };
  }, [data]);

  // Average score per group, used for the breakdown tab.
  const grouped = useMemo(() => {
    const keyOf = (r: Response) => {
      if (groupBy === 'service') return r.service?.name ?? 'No service';
      if (groupBy === 'officer') return r.officer?.full_name ?? 'No officer';
      if (groupBy === 'driver') return r.driver?.full_name ?? 'No driver';
      return r.truck?.registration_no ?? 'No truck';
    };
    const map = new Map<string, { name: string; count: number; csatSum: number; csatCount: number; low: number }>();
    for (const r of data) {
      const name = keyOf(r);
      const row = map.get(name) ?? { name, count: 0, csatSum: 0, csatCount: 0, low: 0 };
      row.count += 1;
      if (r.csat !== null) { row.csatSum += Number(r.csat); row.csatCount += 1; }
      if (r.is_low) row.low += 1;
      map.set(name, row);
    }
    return [...map.values()]
      .map((r) => ({ ...r, csat: r.csatCount ? Math.round((r.csatSum / r.csatCount) * 100) / 100 : null }))
      .sort((a, b) => (b.csat ?? 0) - (a.csat ?? 0));
  }, [data, groupBy]);

  // CSAT by month.
  const trend = useMemo(() => {
    const map = new Map<string, { month: string; sum: number; count: number }>();
    for (const r of data) {
      if (r.csat === null) continue;
      const month = r.submitted_at.slice(0, 7);
      const row = map.get(month) ?? { month, sum: 0, count: 0 };
      row.sum += Number(r.csat);
      row.count += 1;
      map.set(month, row);
    }
    return [...map.values()].sort((a, b) => a.month.localeCompare(b.month))
      .map((r) => ({ month: r.month, csat: Math.round((r.sum / r.count) * 100) / 100, responses: r.count }));
  }, [data]);

  const comments = data.filter((r) => (r.comments ?? '').trim().length > 0);

  const exportExcel = () => exportXlsx(data, [
    { header: 'Date', value: (r: Response) => formatDate(r.submitted_at) },
    { header: 'Customer', value: (r: Response) => r.customer?.display_name ?? '' },
    { header: 'Service', value: (r: Response) => r.service?.name ?? '' },
    { header: 'Officer', value: (r: Response) => r.officer?.full_name ?? '' },
    { header: 'Driver', value: (r: Response) => r.driver?.full_name ?? '' },
    { header: 'Truck', value: (r: Response) => r.truck?.registration_no ?? '' },
    { header: 'CSAT', value: (r: Response) => r.csat },
    { header: 'Overall', value: (r: Response) => r.overall_score },
    { header: 'NPS', value: (r: Response) => r.nps_score },
    { header: 'Low score', value: (r: Response) => (r.is_low ? 'yes' : '') },
    { header: 'Comments', value: (r: Response) => r.comments ?? '' },
  ], `survey-responses-${range.to}`);

  if (isLoading) return <Spinner />;
  if (error) return <ErrorState error={error} onRetry={() => void refetch()} />;

  return (
    <div>
      <PageHeader title="Survey results" subtitle="Satisfaction and NPS, and who the scores belong to"
        actions={<Button variant="secondary" size="sm" icon={<Download className="h-4 w-4" />} onClick={exportExcel}>Excel</Button>} />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <DateRange from={range.from} to={range.to} preset={preset} onPreset={setPreset} onChange={(from, to) => setRange({ from, to })} />
        <FilterSelect label="Service" value={service} onChange={setService} options={toOptions(services, (s) => s.name)} />
        <FilterSelect label="Truck" value={truck} onChange={setTruck} options={toOptions(trucks, (t) => t.registration_no)} />
      </div>

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Card title="Responses"><p className="text-xl font-semibold tabular-nums">{stats.responses}</p></Card>
        <Card title="CSAT">
          <p className="flex items-center gap-1 text-xl font-semibold tabular-nums">
            <Star className="h-5 w-5 text-amber-500" />{stats.csat === null ? '—' : `${stats.csat.toFixed(2)} / 5`}
          </p>
        </Card>
        <Card title="NPS">
          <p className="flex items-center gap-1 text-xl font-semibold tabular-nums">
            <Smile className="h-5 w-5 text-stone-400" />{stats.nps === null ? '—' : stats.nps}
          </p>
          <p className="text-xs text-stone-500">{stats.promoters} promoters · {stats.passives} passive · {stats.detractors} detractors</p>
        </Card>
        <Card title="Low scores" className={stats.low ? 'border-red-200' : undefined}>
          <p className={`text-xl font-semibold tabular-nums ${stats.low ? 'text-red-700' : ''}`}>{stats.low}</p>
          <p className="text-xs text-stone-500"><Link to="/followups" className="text-brand-700 hover:underline">Follow-up tasks</Link></p>
        </Card>
      </div>

      {!data.length ? (
        <EmptyState icon={<Smile className="h-6 w-6" />} title="No responses in this period"
          message="Surveys go out with every receipt; results appear here as customers answer." />
      ) : (
        <>
          <Tabs tabs={[
            { value: 'overview', label: 'Over time' },
            { value: 'breakdown', label: 'Breakdown', count: grouped.length },
            { value: 'comments', label: 'Comments', count: comments.length },
          ]} value={tab} onChange={setTab} />

          <div className="mt-4 space-y-4">
            {tab === 'overview' ? (
              <>
                <Card title="CSAT by month">
                  <div className="h-64">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={trend}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#e7e5e4" />
                        <XAxis dataKey="month" fontSize={11} />
                        <YAxis fontSize={11} domain={[0, 5]} />
                        <Tooltip />
                        <Line type="monotone" dataKey="csat" name="CSAT" stroke="#0f766e" strokeWidth={2} />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                </Card>
                <Card title="Responses by month">
                  <div className="h-56">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={trend}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#e7e5e4" />
                        <XAxis dataKey="month" fontSize={11} />
                        <YAxis fontSize={11} allowDecimals={false} />
                        <Tooltip />
                        <Bar dataKey="responses" name="Responses" fill="#2563eb" radius={[4, 4, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </Card>
              </>
            ) : null}

            {tab === 'breakdown' ? (
              <>
                <div className="flex flex-wrap items-center gap-2">
                  <FilterSelect label="Group by" value={groupBy} onChange={(v) => setGroupBy((v || 'service') as GroupKey)} options={[
                    { value: 'service', label: 'Service' }, { value: 'officer', label: 'Officer' },
                    { value: 'driver', label: 'Driver' }, { value: 'truck', label: 'Truck' },
                  ]} />
                </div>
                <Card title={`Average score by ${groupBy}`}>
                  <div className="h-64">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={grouped.map((g) => ({ name: g.name, csat: g.csat ?? 0 }))} layout="vertical" margin={{ left: 20 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#e7e5e4" />
                        <XAxis type="number" domain={[0, 5]} fontSize={11} />
                        <YAxis type="category" dataKey="name" fontSize={11} width={120} />
                        <Tooltip />
                        <Bar dataKey="csat" name="CSAT" radius={[0, 4, 4, 0]}>
                          {grouped.map((g) => (
                            <Cell key={g.name} fill={(g.csat ?? 0) >= 4 ? '#059669' : (g.csat ?? 0) >= 3 ? '#d97706' : '#dc2626'} />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </Card>
                <Card bodyClassName="p-0">
                  <table className="min-w-full text-sm">
                    <thead className="bg-stone-50 text-left text-xs uppercase tracking-wide text-stone-500">
                      <tr>
                        <th scope="col" className="px-3 py-2 font-medium">{humanize(groupBy)}</th>
                        <th scope="col" className="px-3 py-2 text-right font-medium">Responses</th>
                        <th scope="col" className="px-3 py-2 text-right font-medium">CSAT</th>
                        <th scope="col" className="px-3 py-2 text-right font-medium">Low scores</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-stone-100">
                      {grouped.map((g) => (
                        <tr key={g.name}>
                          <td className="px-3 py-2 font-medium">{g.name}</td>
                          <td className="px-3 py-2 text-right tabular-nums">{g.count}</td>
                          <td className="px-3 py-2 text-right">
                            {g.csat === null ? '—' : (
                              <Badge tone={g.csat >= 4 ? 'green' : g.csat >= 3 ? 'amber' : 'red'}>{g.csat.toFixed(2)}</Badge>
                            )}
                          </td>
                          <td className={`px-3 py-2 text-right tabular-nums ${g.low ? 'text-red-700' : ''}`}>{g.low || '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </Card>
              </>
            ) : null}

            {tab === 'comments' ? (
              comments.length ? (
                <Card bodyClassName="p-0">
                  <ul className="divide-y divide-stone-100">
                    {comments.map((r) => (
                      <li key={r.id} className={`p-3 ${r.is_low ? 'bg-red-50' : ''}`}>
                        <div className="mb-1 flex flex-wrap items-center gap-2 text-xs text-stone-500">
                          <span>{formatDate(r.submitted_at)}</span>
                          {r.customer ? <Link to={`/customers/${r.customer.id}`} className="text-brand-700 hover:underline">{r.customer.display_name}</Link> : null}
                          {r.service ? <Badge tone="brand">{r.service.name}</Badge> : null}
                          {r.csat !== null ? <Badge tone={Number(r.csat) >= 4 ? 'green' : Number(r.csat) >= 3 ? 'amber' : 'red'}>{formatNumber(r.csat)} / 5</Badge> : null}
                          {r.nps_score !== null ? <Badge tone="grey">NPS {r.nps_score}</Badge> : null}
                          {r.job_order ? <Link to={`/jobs/${r.job_order.id}`} className="text-brand-700 hover:underline">{r.job_order.job_no}</Link> : null}
                        </div>
                        <p className="whitespace-pre-wrap text-sm text-stone-800">{r.comments}</p>
                        {r.driver || r.truck ? (
                          <p className="mt-1 text-xs text-stone-500">
                            {[r.driver?.full_name, r.truck?.registration_no].filter(Boolean).join(' · ')}
                          </p>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                </Card>
              ) : <EmptyState title="No written comments yet" />
            ) : null}
          </div>
        </>
      )}
    </div>
  );
}
