import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Download, Map as MapIcon } from 'lucide-react';
import { supabase } from '@/lib/supabaseClient';
import { check } from '@/lib/rpc';
import { useRealtimeInvalidate } from '@/lib/realtime';
import { useSettings } from '@/lib/settings';
import { useStaff, useZones, toOptions } from '@/lib/lookups';
import { daysFrom, formatDate, formatDateTime, formatGHS, formatPct, isoDate } from '@/lib/format';
import { exportXlsx } from '@/lib/export';
import { downloadPdf } from '@/lib/pdf/download';
import { ReportPdf } from '@/lib/pdf/ReportPdf';
import { companyFromSettings } from '@/lib/pdf/company';
import { PageHeader } from '@/components/ui/PageHeader';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { Tabs } from '@/components/ui/Tabs';
import { FilterSelect } from '@/components/ui/DataTable';
import { DateRange } from '@/components/ui/DateRange';
import { Spinner } from '@/components/ui/Spinner';
import { EmptyState } from '@/components/ui/EmptyState';
import type { Tables, Views } from '@/types/database';

type Task = Tables<'tasks'> & {
  task_type: { name: string } | null;
  officer: { id: string; full_name: string } | null;
  zone: { name: string } | null;
  task_checkins: { id: string; lat: number; lng: number; checked_in_at: string; accuracy_m: number | null }[];
};
type Summary = Views<'v_zonal_task_summary'>;

/**
 * Manager's view of the zonal team (spec 4.12): today's board, completion per officer,
 * a Leaflet map of check-ins on OpenStreetMap (no API key), and a weekly export.
 */
export default function ManagerBoardPage() {
  const settings = useSettings();
  const { data: officers } = useStaff();
  const { data: zones } = useZones();
  const [tab, setTab] = useState<'board' | 'officers' | 'map'>('board');
  const [officer, setOfficer] = useState('');
  const [zone, setZone] = useState('');
  const [from, setFrom] = useState(isoDate());
  const [to, setTo] = useState(isoDate());

  const tasks = useQuery({
    queryKey: ['zonal-board', from, to, officer, zone],
    queryFn: async () => {
      let q = supabase.from('tasks')
        .select(`*, task_type:task_types(name), officer:profiles(id, full_name), zone:zones(name),
                 task_checkins(id, lat, lng, checked_in_at, accuracy_m)`)
        .gte('planned_date', from).lte('planned_date', to)
        .order('planned_date').order('priority', { ascending: false });
      if (officer) q = q.eq('officer_id', officer);
      if (zone) q = q.eq('zone_id', zone);
      return check(await q) as Task[];
    },
  });
  useRealtimeInvalidate(['tasks', 'task_comments'], [['zonal-board', from, to, officer, zone]]);

  const summary = useQuery({
    queryKey: ['zonal-summary', from, to],
    queryFn: async () => check(await supabase.from('v_zonal_task_summary').select('*')
      .gte('planned_date', from).lte('planned_date', to)) as Summary[],
  });

  const data = tasks.data ?? [];

  // Roll the per-day summary rows up to one row per officer.
  const perOfficer = useMemo(() => {
    const map = new Map<string, { id: string; name: string; planned: number; completed: number; pending: number; overdue: number; deals: number; last: string | null }>();
    for (const s of summary.data ?? []) {
      if (!s.officer_id) continue;
      if (officer && s.officer_id !== officer) continue;
      if (zone && s.zone_id !== zone) continue;
      const row = map.get(s.officer_id) ?? { id: s.officer_id, name: s.officer_name ?? '—', planned: 0, completed: 0, pending: 0, overdue: 0, deals: 0, last: null };
      row.planned += Number(s.planned ?? 0);
      row.completed += Number(s.completed ?? 0);
      row.pending += Number(s.pending ?? 0);
      row.overdue += Number(s.overdue ?? 0);
      row.deals += Number(s.deals_closed_value ?? 0);
      if (s.last_update_at && (!row.last || s.last_update_at > row.last)) row.last = s.last_update_at;
      map.set(s.officer_id, row);
    }
    return [...map.values()]
      .map((r) => ({ ...r, pct: r.planned ? Math.round((r.completed / r.planned) * 1000) / 10 : null }))
      .sort((a, b) => (b.pct ?? -1) - (a.pct ?? -1));
  }, [summary.data, officer, zone]);

  const totals = useMemo(() => perOfficer.reduce((t, r) => ({
    planned: t.planned + r.planned, completed: t.completed + r.completed, overdue: t.overdue + r.overdue, deals: t.deals + r.deals,
  }), { planned: 0, completed: 0, overdue: 0, deals: 0 }), [perOfficer]);

  const checkins = useMemo(
    () => data.flatMap((t) => t.task_checkins.map((c) => ({ ...c, task: t }))),
    [data],
  );

  const exportExcel = () => exportXlsx(data, [
    { header: 'Date', value: (t: Task) => formatDate(t.planned_date) },
    { header: 'Officer', value: (t: Task) => t.officer?.full_name ?? '' },
    { header: 'Zone', value: (t: Task) => t.zone?.name ?? '' },
    { header: 'Type', value: (t: Task) => t.task_type?.name ?? '' },
    { header: 'Title', value: (t: Task) => t.title },
    { header: 'Organisation', value: (t: Task) => t.target_org ?? '' },
    { header: 'Location', value: (t: Task) => t.location ?? '' },
    { header: 'Status', value: (t: Task) => t.status },
    { header: 'Outcome', value: (t: Task) => t.outcome_notes ?? '' },
    { header: 'Next step', value: (t: Task) => t.next_step ?? '' },
    { header: 'Follow-up', value: (t: Task) => t.follow_up_date ?? '' },
    { header: 'Deal value', value: (t: Task) => t.deal_value },
    { header: 'Check-ins', value: (t: Task) => t.task_checkins.length },
  ], `zonal-tasks-${from}-to-${to}`);

  const exportPdf = () => {
    if (!settings) return;
    void downloadPdf(
      <ReportPdf company={companyFromSettings(settings)} title="Zonal officer summary"
        subtitle={`${formatDate(from)} – ${formatDate(to)}`}
        summary={[
          ['Tasks planned', String(totals.planned)],
          ['Completed', String(totals.completed)],
          ['Overdue', String(totals.overdue)],
          ['Deals closed', formatGHS(totals.deals)],
        ]}
        sections={[{
          title: 'By officer',
          columns: [
            { label: 'Officer', width: '30%', key: 'name' },
            { label: 'Planned', width: '13%', align: 'right', key: 'planned' },
            { label: 'Completed', width: '13%', align: 'right', key: 'completed' },
            { label: 'Overdue', width: '13%', align: 'right', key: 'overdue' },
            { label: 'Completion', width: '15%', align: 'right', key: 'pct' },
            { label: 'Deals', width: '16%', align: 'right', key: 'deals' },
          ],
          rows: perOfficer.map((r) => ({
            name: r.name, planned: r.planned, completed: r.completed, overdue: r.overdue,
            pct: r.pct === null ? '—' : formatPct(r.pct), deals: formatGHS(r.deals),
          })),
        }]}
      />,
      `zonal-summary-${to}`,
    );
  };

  const setWeek = () => {
    const start = new Date();
    start.setDate(start.getDate() - start.getDay() + 1);
    setFrom(isoDate(start));
    setTo(isoDate(new Date(start.getTime() + 6 * 86_400_000)));
  };

  return (
    <div>
      <PageHeader title="Zonal team" subtitle="Today across every officer, completion rates, and where they checked in"
        actions={<>
          <Button variant="secondary" size="sm" onClick={setWeek}>This week</Button>
          <Button variant="secondary" size="sm" icon={<Download className="h-4 w-4" />} onClick={exportExcel}>Excel</Button>
          <Button variant="secondary" size="sm" icon={<Download className="h-4 w-4" />} onClick={exportPdf}>PDF</Button>
        </>} />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <DateRange presets={false} from={from} to={to} onChange={(f, t) => { setFrom(f); setTo(t); }} />
        <FilterSelect label="Officer" value={officer} onChange={setOfficer} options={toOptions(officers, (o) => o.full_name)} />
        <FilterSelect label="Zone" value={zone} onChange={setZone} options={toOptions(zones, (z) => z.name)} />
      </div>

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Card title="Tasks planned"><p className="text-xl font-semibold tabular-nums">{totals.planned}</p></Card>
        <Card title="Completed"><p className="text-xl font-semibold tabular-nums text-emerald-700">{totals.completed}</p></Card>
        <Card title="Overdue" className={totals.overdue ? 'border-red-200' : undefined}>
          <p className={`text-xl font-semibold tabular-nums ${totals.overdue ? 'text-red-700' : ''}`}>{totals.overdue}</p>
        </Card>
        <Card title="Deals closed"><p className="text-xl font-semibold tabular-nums">{formatGHS(totals.deals)}</p></Card>
      </div>

      <Tabs tabs={[
        { value: 'board', label: 'Board', count: data.length },
        { value: 'officers', label: 'By officer', count: perOfficer.length },
        { value: 'map', label: 'Check-in map', count: checkins.length },
      ]} value={tab} onChange={setTab} />

      <div className="mt-4">
        {tab === 'board' ? (
          tasks.isLoading ? <Spinner /> : data.length ? (
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-2 xl:grid-cols-3">
              {data.map((t) => {
                const late = (daysFrom(t.planned_date) ?? 0) > 0 && ['planned', 'in_progress', 'pending'].includes(t.status);
                return (
                  <Link key={t.id} to={`/zonal/tasks/${t.id}`}>
                    <Card className={late ? 'border-red-200' : undefined}>
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="font-medium text-stone-900">{t.title}</p>
                          <p className="text-sm text-stone-600">{t.officer?.full_name} · {t.task_type?.name}</p>
                          {t.target_org ? <p className="text-xs text-stone-500">{t.target_org}</p> : null}
                          {t.location ? <p className="text-xs text-stone-500">{t.location}</p> : null}
                        </div>
                        <div className="flex shrink-0 flex-col items-end gap-1">
                          <StatusBadge status={t.status} />
                          <span className={`text-xs ${late ? 'font-medium text-red-700' : 'text-stone-500'}`}>{formatDate(t.planned_date)}</span>
                          {t.task_checkins.length ? <Badge tone="blue">{t.task_checkins.length} check-in(s)</Badge> : null}
                          {t.deal_closed ? <Badge tone="green">{formatGHS(t.deal_value)}</Badge> : null}
                        </div>
                      </div>
                      {t.outcome_notes ? <p className="mt-2 rounded-lg bg-stone-50 p-2 text-xs text-stone-700">{t.outcome_notes}</p> : null}
                    </Card>
                  </Link>
                );
              })}
            </div>
          ) : <EmptyState title="No tasks in this period" message="Officers plan their own day or week; their tasks appear here." />
        ) : null}

        {tab === 'officers' ? (
          summary.isLoading ? <Spinner /> : perOfficer.length ? (
            <>
              <Card className="mb-4" title="Completion rate per officer">
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={perOfficer.map((r) => ({ name: r.name, pct: r.pct ?? 0 }))}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e7e5e4" />
                      <XAxis dataKey="name" fontSize={11} />
                      <YAxis fontSize={11} domain={[0, 100]} tickFormatter={(v: number) => `${v}%`} />
                      <Tooltip formatter={(v: number) => `${v}%`} />
                      <Bar dataKey="pct" name="Completed" radius={[4, 4, 0, 0]}>
                        {perOfficer.map((r) => (
                          <Cell key={r.id} fill={(r.pct ?? 0) >= 80 ? '#059669' : (r.pct ?? 0) >= 50 ? '#d97706' : '#dc2626'} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </Card>
              <Card bodyClassName="p-0">
                <div className="overflow-x-auto">
                  <table className="min-w-full text-sm">
                    <thead className="bg-stone-50 text-left text-xs uppercase tracking-wide text-stone-500">
                      <tr>
                        <th scope="col" className="px-3 py-2 font-medium">Officer</th>
                        <th scope="col" className="px-3 py-2 text-right font-medium">Planned</th>
                        <th scope="col" className="px-3 py-2 text-right font-medium">Completed</th>
                        <th scope="col" className="px-3 py-2 text-right font-medium">Pending</th>
                        <th scope="col" className="px-3 py-2 text-right font-medium">Overdue</th>
                        <th scope="col" className="px-3 py-2 text-right font-medium">Completion</th>
                        <th scope="col" className="px-3 py-2 text-right font-medium">Deals</th>
                        <th scope="col" className="px-3 py-2 font-medium">Last update</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-stone-100">
                      {perOfficer.map((r) => (
                        <tr key={r.id} className={r.overdue ? 'bg-red-50/50' : undefined}>
                          <td className="px-3 py-2 font-medium">{r.name}</td>
                          <td className="px-3 py-2 text-right tabular-nums">{r.planned}</td>
                          <td className="px-3 py-2 text-right tabular-nums">{r.completed}</td>
                          <td className="px-3 py-2 text-right tabular-nums">{r.pending}</td>
                          <td className={`px-3 py-2 text-right tabular-nums ${r.overdue ? 'font-semibold text-red-700' : ''}`}>{r.overdue || '—'}</td>
                          <td className="px-3 py-2 text-right">
                            {r.pct === null ? '—' : <Badge tone={r.pct >= 80 ? 'green' : r.pct >= 50 ? 'amber' : 'red'}>{formatPct(r.pct)}</Badge>}
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums">{formatGHS(r.deals)}</td>
                          <td className="px-3 py-2 text-stone-500">{r.last ? formatDateTime(r.last) : 'No update yet'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="p-3 text-xs text-stone-500">
                  Officers who have not updated a task by 17:00 get a reminder, and you get a summary at 18:00.
                </p>
              </Card>
            </>
          ) : <EmptyState title="No figures for this period" />
        ) : null}

        {tab === 'map' ? (
          checkins.length ? <CheckinMap points={checkins} /> : (
            <EmptyState icon={<MapIcon className="h-6 w-6" />} title="No check-ins in this period"
              message="Officers check in with GPS from the task page while they are at the site." />
          )
        ) : null}
      </div>
    </div>
  );
}

type CheckinPoint = { id: string; lat: number; lng: number; checked_in_at: string; accuracy_m: number | null; task: { id: string; title: string; officer: { full_name: string } | null; status: string } };

/* eslint-disable @typescript-eslint/no-explicit-any */
/** Build the map, its tile layer and its markers. Kept apart so the types stay contained. */
function createMap(L: any, el: HTMLElement, points: CheckinPoint[]) {
  const map = L.map(el).setView([points[0].lat, points[0].lng], 12);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; OpenStreetMap contributors',
    maxZoom: 19,
  }).addTo(map);
  const group = L.featureGroup(points.map((p: CheckinPoint) => L.marker([p.lat, p.lng]).bindPopup(
    `<strong>${p.task.title}</strong><br>${p.task.officer?.full_name ?? ''}<br>${new Date(p.checked_in_at).toLocaleString()}`,
  ))).addTo(map);
  map.fitBounds(group.getBounds().pad(0.2));
  return map as { remove: () => void };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

/**
 * Leaflet map on OpenStreetMap tiles, which need no API key. Leaflet is loaded only when this
 * tab is opened, so the rest of the app stays small.
 */
function CheckinMap({ points }: { points: CheckinPoint[] }) {
  const container = useRef<HTMLDivElement | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    // Leaflet's own types are not bundled here, so the instance is kept loosely typed.
    let map: ReturnType<typeof createMap> | null = null;
    let cancelled = false;

    (async () => {
      try {
        const L = (await import('leaflet')).default;
        if (cancelled || !container.current) return;
        // Leaflet needs its stylesheet; add it once.
        if (!document.getElementById('leaflet-css')) {
          const link = document.createElement('link');
          link.id = 'leaflet-css';
          link.rel = 'stylesheet';
          link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
          document.head.appendChild(link);
        }
        map = createMap(L, container.current, points);
      } catch {
        setFailed(true);
      }
    })();

    return () => { cancelled = true; map?.remove(); };
  }, [points]);

  if (failed) {
    return (
      <Card title="Check-ins">
        <p className="mb-3 text-sm text-stone-600">The map could not load. The check-ins are listed below.</p>
        <ul className="divide-y divide-stone-100 text-sm">
          {points.map((p) => (
            <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <Link to={`/zonal/tasks/${p.task.id}`} className="text-brand-700 hover:underline">{p.task.title}</Link>
              <span className="text-stone-600">{p.task.officer?.full_name}</span>
              <span className="text-stone-500">{formatDateTime(p.checked_in_at)}</span>
              <a className="text-brand-700 hover:underline" target="_blank" rel="noreferrer"
                href={`https://www.openstreetmap.org/?mlat=${p.lat}&mlon=${p.lng}#map=17/${p.lat}/${p.lng}`}>{p.lat}, {p.lng}</a>
            </li>
          ))}
        </ul>
      </Card>
    );
  }

  return (
    <Card bodyClassName="p-0" title={`Check-ins (${points.length})`}>
      <div ref={container} className="h-[28rem] w-full rounded-b-xl" role="img" aria-label="Map of officer check-ins" />
      <p className="p-3 text-xs text-stone-500">Map data from OpenStreetMap. Click a pin to see the task and officer.</p>
    </Card>
  );
}
