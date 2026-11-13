import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { addDays, addMonths, eachDayOfInterval, endOfMonth, format, isSameDay, startOfMonth, startOfWeek } from 'date-fns';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/cn';
import { supabase } from '@/lib/supabaseClient';
import { check } from '@/lib/rpc';
import { useRealtimeInvalidate } from '@/lib/realtime';
import { useTrucks } from '@/lib/lookups';
import { formatDate, humanize, isoDate } from '@/lib/format';
import { PageHeader } from '@/components/ui/PageHeader';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Spinner } from '@/components/ui/Spinner';
import { FilterSelect } from '@/components/ui/DataTable';
import type { Tables } from '@/types/database';

type View = 'day' | 'week' | 'month';

interface Booking {
  id: string; truck_id: string; job_order_id: string;
  period: string;
  job: { id: string; job_no: string | null; customer_name: string | null; status: string; execution_date: string; end_date: string | null; time_window: string | null } | null;
}

/** Parse a Postgres daterange like [2026-11-12,2026-11-14) into inclusive start/end dates. */
function parseRange(period: string): { start: string; end: string } {
  const m = /^([[(])([^,]*),([^)\]]*)([)\]])$/.exec(period);
  if (!m) return { start: period, end: period };
  const startRaw = m[2];
  const endRaw = m[3];
  const start = m[1] === '(' ? isoDate(addDays(new Date(startRaw), 1)) : startRaw;
  const end = m[4] === ')' && endRaw ? isoDate(addDays(new Date(endRaw), -1)) : endRaw || start;
  return { start, end };
}

/** Dispatch calendar by day, week or month, with one row per truck (spec 4.4). */
export default function DispatchCalendarPage() {
  const [view, setView] = useState<View>('week');
  const [anchor, setAnchor] = useState(() => new Date());
  const [truckType, setTruckType] = useState('');
  const { data: trucks } = useTrucks();

  const range = useMemo(() => {
    if (view === 'day') return { from: anchor, to: anchor };
    if (view === 'week') {
      const start = startOfWeek(anchor, { weekStartsOn: 1 });
      return { from: start, to: addDays(start, 6) };
    }
    return { from: startOfMonth(anchor), to: endOfMonth(anchor) };
  }, [view, anchor]);

  const days = useMemo(() => eachDayOfInterval({ start: range.from, end: range.to }), [range]);
  const fromIso = isoDate(range.from);
  const toIso = isoDate(range.to);

  const { data: bookings = [], isLoading } = useQuery({
    queryKey: ['dispatch', fromIso, toIso],
    queryFn: async () => check(await supabase.from('truck_bookings')
      .select('id, truck_id, job_order_id, period, job:job_orders(id, job_no, customer_name, status, execution_date, end_date, time_window)')
      .eq('active', true)
      .overlaps('period', `[${fromIso},${toIso}]`)) as Booking[],
  });
  useRealtimeInvalidate(['job_orders'], [['dispatch', fromIso, toIso]]);

  // Jobs with no truck still need dispatching, so they get their own row.
  const { data: unassigned = [] } = useQuery({
    queryKey: ['dispatch-unassigned', fromIso, toIso],
    queryFn: async () => check(await supabase.from('job_orders')
      .select('id, job_no, customer_name, status, execution_date, end_date, time_window')
      .in('status', ['approved', 'in_progress'])
      .gte('execution_date', fromIso).lte('execution_date', toIso)) as Tables<'job_orders'>[],
  });

  const visibleTrucks = (trucks ?? []).filter((t) => !truckType || t.truck_type === truckType);
  const bookedJobIds = new Set(bookings.map((b) => b.job_order_id));
  const unassignedJobs = unassigned.filter((j) => !bookedJobIds.has(j.id));

  const step = (direction: number) => {
    if (view === 'month') setAnchor(addMonths(anchor, direction));
    else setAnchor(addDays(anchor, direction * (view === 'week' ? 7 : 1)));
  };

  const label = view === 'month' ? format(anchor, 'MMMM yyyy')
    : view === 'week' ? `${formatDate(isoDate(range.from))} – ${formatDate(isoDate(range.to))}`
      : formatDate(isoDate(anchor));

  return (
    <div>
      <PageHeader title="Dispatch calendar" subtitle="One row per truck, so double bookings are obvious"
        actions={<Link to="/jobs"><Button variant="secondary">All job orders</Button></Link>} />

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="flex rounded-lg border border-stone-300 bg-white p-0.5">
          {(['day', 'week', 'month'] as View[]).map((v) => (
            <button key={v} type="button" onClick={() => setView(v)}
              className={cn('rounded-md px-3 py-1 text-xs font-medium capitalize', view === v ? 'bg-brand-600 text-white' : 'text-stone-600 hover:bg-stone-100')}>{v}</button>
          ))}
        </div>
        <Button variant="secondary" size="sm" aria-label="Previous" onClick={() => step(-1)}><ChevronLeft className="h-4 w-4" /></Button>
        <span className="min-w-[12rem] text-center text-sm font-medium text-stone-800">{label}</span>
        <Button variant="secondary" size="sm" aria-label="Next" onClick={() => step(1)}><ChevronRight className="h-4 w-4" /></Button>
        <Button variant="ghost" size="sm" onClick={() => setAnchor(new Date())}>Today</Button>
        <FilterSelect label="Truck type" value={truckType} onChange={setTruckType}
          options={[...new Set((trucks ?? []).map((t) => t.truck_type))].map((t) => ({ value: t, label: humanize(t) }))} />
      </div>

      {isLoading ? <Spinner /> : (
        <Card bodyClassName="p-0">
          <div className="overflow-x-auto">
            <table className="min-w-full border-collapse text-sm">
              <thead>
                <tr className="bg-stone-50">
                  <th scope="col" className="sticky left-0 z-10 w-44 border-b border-r border-stone-200 bg-stone-50 px-3 py-2 text-left text-xs font-medium uppercase tracking-wide text-stone-500">Truck</th>
                  {days.map((d) => (
                    <th key={d.toISOString()} scope="col"
                      className={cn('min-w-[7rem] border-b border-stone-200 px-2 py-2 text-center text-xs font-medium', isSameDay(d, new Date()) ? 'bg-brand-50 text-brand-700' : 'text-stone-500')}>
                      <span className="block">{format(d, 'EEE')}</span>
                      <span className="block text-sm text-stone-800">{format(d, 'd MMM')}</span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {visibleTrucks.map((t) => (
                  <tr key={t.id}>
                    <th scope="row" className="sticky left-0 z-10 border-b border-r border-stone-200 bg-white px-3 py-2 text-left">
                      <Link to={`/fleet/trucks/${t.id}`} className="font-medium text-brand-700 hover:underline">{t.registration_no}</Link>
                      <span className="block text-xs text-stone-500">{humanize(t.truck_type)}</span>
                      {t.status === 'off_road' ? <Badge tone="red" className="mt-1">Off-Road</Badge> : null}
                    </th>
                    {days.map((d) => {
                      const iso = isoDate(d);
                      const cell = bookings.filter((b) => {
                        if (b.truck_id !== t.id) return false;
                        const { start, end } = parseRange(b.period);
                        return iso >= start && iso <= end;
                      });
                      return (
                        <td key={iso} className={cn('border-b border-stone-100 p-1 align-top', isSameDay(d, new Date()) && 'bg-brand-50/40')}>
                          {cell.map((b) => (
                            <Link key={b.id} to={`/jobs/${b.job_order_id}`}
                              className="mb-1 block rounded-md border border-brand-200 bg-brand-50 px-1.5 py-1 text-xs hover:bg-brand-100">
                              <span className="block font-medium text-brand-800">{b.job?.job_no}</span>
                              <span className="block truncate text-stone-600">{b.job?.customer_name}</span>
                              {b.job?.time_window ? <span className="block text-stone-500">{b.job.time_window}</span> : null}
                            </Link>
                          ))}
                        </td>
                      );
                    })}
                  </tr>
                ))}
                {!visibleTrucks.length ? (
                  <tr><td colSpan={days.length + 1} className="px-3 py-6 text-center text-stone-500">No trucks match this filter.</td></tr>
                ) : null}
                {unassignedJobs.length ? (
                  <tr>
                    <th scope="row" className="sticky left-0 z-10 border-r border-t border-stone-200 bg-amber-50 px-3 py-2 text-left text-xs font-medium text-amber-900">
                      No truck assigned
                    </th>
                    {days.map((d) => {
                      const iso = isoDate(d);
                      const cell = unassignedJobs.filter((j) => iso >= j.execution_date && iso <= (j.end_date ?? j.execution_date));
                      return (
                        <td key={iso} className="border-t border-stone-200 bg-amber-50/50 p-1 align-top">
                          {cell.map((j) => (
                            <Link key={j.id} to={`/jobs/${j.id}`} className="mb-1 block rounded-md border border-amber-300 bg-white px-1.5 py-1 text-xs hover:bg-amber-100">
                              <span className="block font-medium text-amber-900">{j.job_no}</span>
                              <span className="block truncate text-stone-600">{j.customer_name}</span>
                            </Link>
                          ))}
                        </td>
                      );
                    })}
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-stone-500">
        <span className="flex items-center gap-1"><span className="inline-block h-3 w-3 rounded border border-brand-200 bg-brand-50" />Booked job</span>
        <span className="flex items-center gap-1"><span className="inline-block h-3 w-3 rounded border border-amber-300 bg-amber-50" />Approved job with no truck</span>
        <span>A truck can only hold one booking per date — the database refuses overlaps.</span>
      </div>
    </div>
  );
}
