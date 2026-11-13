import { useQuery } from '@tanstack/react-query';
import { CalendarDays, MapPin, Phone, Truck as TruckIcon } from 'lucide-react';
import { rpc } from '@/lib/rpc';
import { useRealtimeInvalidate } from '@/lib/realtime';
import { displayPhone, formatDate, isoDate } from '@/lib/format';
import { PageHeader } from '@/components/ui/PageHeader';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { Spinner } from '@/components/ui/Spinner';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';

// Matches get_my_jobs() in migration 0013.
interface DriverJob {
  id: string; job_no: string | null; status: string; execution_date: string; end_date: string | null; time_window: string | null;
  customer_name: string | null; customer_phone: string | null; site_address: string | null; digital_address: string | null;
  site_lat: number | null; site_lng: number | null; instructions: string | null;
  services: string | null; trucks: string | null; officer_name: string | null; officer_phone: string | null;
}

/**
 * The driver's own jobs (spec 3 and 6): read-only, phone first, with big tap targets and a
 * one-tap route to the site. Drivers see only the jobs they are assigned to.
 */
export default function MyJobsPage() {
  const today = isoDate();

  // A fortnight back and a fortnight ahead, so a driver can see what they finished too.
  const from = isoDate(new Date(Date.now() - 14 * 86_400_000));
  const to = isoDate(new Date(Date.now() + 14 * 86_400_000));

  const { data = [], isLoading, error, refetch } = useQuery({
    queryKey: ['my-driver-jobs', from, to],
    queryFn: () => rpc<DriverJob[]>('get_my_jobs', { p_from: from, p_to: to }),
  });
  useRealtimeInvalidate(['job_orders'], [['my-driver-jobs']]);

  if (isLoading) return <Spinner />;
  if (error) return <ErrorState error={error} onRetry={() => void refetch()} />;

  const todays = data.filter((j) => j.execution_date <= today && (j.end_date ?? j.execution_date) >= today);
  const upcoming = data.filter((j) => j.execution_date > today);
  const past = data.filter((j) => (j.end_date ?? j.execution_date) < today);

  const Section = ({ title, jobs, tone }: { title: string; jobs: DriverJob[]; tone: 'amber' | 'blue' | 'grey' }) => {
    if (!jobs.length) return null;
    return (
      <section className="mb-6">
        <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold text-stone-800">
          {title}<Badge tone={tone}>{jobs.length}</Badge>
        </h2>
        <div className="space-y-3">
          {jobs.map((j) => {
            const mapHref = j.site_lat !== null && j.site_lng !== null
              ? `https://www.google.com/maps/dir/?api=1&destination=${j.site_lat},${j.site_lng}`
              : j.site_address
                ? `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(j.site_address)}`
                : null;
            return (
              <Card key={j.id}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-semibold text-stone-900">{j.job_no}</p>
                    <p className="text-sm text-stone-800">{j.customer_name}</p>
                    <p className="text-xs text-stone-500">{j.services}</p>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    <StatusBadge status={j.status} />
                  </div>
                </div>

                <dl className="mt-3 space-y-1.5 text-sm">
                  <div className="flex items-start gap-2">
                    <CalendarDays className="mt-0.5 h-4 w-4 shrink-0 text-stone-400" />
                    <dd>{formatDate(j.execution_date)}{j.end_date && j.end_date !== j.execution_date ? ` – ${formatDate(j.end_date)}` : ''}
                      {j.time_window ? ` · ${j.time_window}` : ''}</dd>
                  </div>
                  {j.trucks ? (
                    <div className="flex items-start gap-2">
                      <TruckIcon className="mt-0.5 h-4 w-4 shrink-0 text-stone-400" />
                      <dd>{j.trucks}</dd>
                    </div>
                  ) : null}
                  {j.site_address ? (
                    <div className="flex items-start gap-2">
                      <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-stone-400" />
                      <dd>{j.site_address}{j.digital_address ? ` · ${j.digital_address}` : ''}</dd>
                    </div>
                  ) : null}
                  {j.customer_phone || j.officer_phone ? (
                    <div className="flex items-start gap-2">
                      <Phone className="mt-0.5 h-4 w-4 shrink-0 text-stone-400" />
                      <dd>
                        {displayPhone(j.customer_phone)}
                        {j.officer_phone ? <span className="block text-xs text-stone-500">Officer {j.officer_name}: {displayPhone(j.officer_phone)}</span> : null}
                      </dd>
                    </div>
                  ) : null}
                </dl>

                {j.instructions ? (
                  <p className="mt-3 rounded-lg bg-stone-50 p-2.5 text-sm text-stone-700">{j.instructions}</p>
                ) : null}

                <div className="mt-3 flex flex-wrap gap-2">
                  {mapHref ? (
                    <a href={mapHref} target="_blank" rel="noreferrer" className="flex-1">
                      <Button variant="secondary" size="lg" className="w-full" icon={<MapPin className="h-5 w-5" />}>Directions</Button>
                    </a>
                  ) : null}
                  {j.customer_phone ? (
                    <a href={`tel:${j.customer_phone}`} className="flex-1">
                      <Button variant="secondary" size="lg" className="w-full" icon={<Phone className="h-5 w-5" />}>Call the site</Button>
                    </a>
                  ) : null}
                  {j.officer_phone ? (
                    <a href={`tel:${j.officer_phone}`} className="flex-1">
                      <Button variant="secondary" size="lg" className="w-full" icon={<Phone className="h-5 w-5" />}>Call the officer</Button>
                    </a>
                  ) : null}
                </div>
              </Card>
            );
          })}
        </div>
      </section>
    );
  };

  return (
    <div>
      <PageHeader title="My jobs" subtitle={formatDate(today)} />

      {!data.length ? (
        <EmptyState icon={<TruckIcon className="h-6 w-6" />} title="No jobs assigned to you"
          message="Your jobs appear here as soon as an officer assigns you. You will also get an SMS the day before and on the morning of each job." />
      ) : (
        <>
          <Section title="Today" jobs={todays} tone="amber" />
          <Section title="Coming up" jobs={upcoming} tone="blue" />
          <Section title="Finished" jobs={past} tone="grey" />
        </>
      )}

      <p className="mt-4 text-xs text-stone-500">
        You can see your jobs here but not change them. The officer in charge starts and completes each job; if something
        is wrong on site, call them on the number above.
      </p>
    </div>
  );
}
