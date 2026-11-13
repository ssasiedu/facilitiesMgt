import { useQuery } from '@tanstack/react-query';
import { Truck as TruckIcon } from 'lucide-react';
import { cn } from '@/lib/cn';
import { formatDate, humanize } from '@/lib/format';
import { Badge } from '@/components/ui/Badge';
import { Spinner } from '@/components/ui/Spinner';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { truckAvailability } from './api';

/**
 * Truck picker used by the job order form (spec 4.5). Filters by date range and the truck type
 * the service needs. Off-Road and already-booked trucks are disabled, with the reason shown.
 */
export function TruckPicker({ from, to, requiredType, selected, onChange, excludeJob, disabled }: {
  from: string; to: string; requiredType?: string | null; selected: string[];
  onChange: (ids: string[]) => void; excludeJob?: string; disabled?: boolean;
}) {
  const enabled = !!from;
  const { data = [], isLoading, error } = useQuery({
    queryKey: ['truck-availability', from, to, requiredType ?? '', excludeJob ?? ''],
    enabled,
    queryFn: () => truckAvailability(from, to || from, requiredType ?? undefined, excludeJob),
  });

  if (!enabled) return <p className="text-sm text-stone-500">Choose an execution date to see which trucks are free.</p>;
  if (isLoading) return <Spinner label="Checking availability…" />;
  if (error) return <p className="text-sm text-red-700">{(error as Error).message}</p>;
  if (!data.length) {
    return (
      <p className="text-sm text-stone-500">
        No {requiredType ? `${humanize(requiredType).toLowerCase()} ` : ''}trucks in the fleet yet. Add one under Fleet &gt; Trucks.
      </p>
    );
  }

  const toggle = (id: string) => {
    onChange(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]);
  };

  return (
    <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
      {data.map((t) => {
        const chosen = selected.includes(t.truck_id);
        // An already-chosen truck stays clickable so it can be removed.
        const blocked = !t.available && !chosen;
        return (
          <li key={t.truck_id}>
            <button type="button" disabled={disabled || blocked} onClick={() => toggle(t.truck_id)}
              aria-pressed={chosen}
              className={cn('w-full rounded-xl border p-3 text-left transition',
                chosen ? 'border-brand-600 bg-brand-50 ring-1 ring-brand-600' : 'border-stone-200 bg-white hover:border-stone-300',
                blocked && 'cursor-not-allowed opacity-60')}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="flex items-center gap-1.5 font-medium text-stone-900">
                    <TruckIcon className="h-4 w-4 text-stone-400" />
                    {t.registration_no}
                    {t.fleet_code ? <span className="text-xs text-stone-500">({t.fleet_code})</span> : null}
                  </p>
                  <p className="mt-0.5 text-xs text-stone-600">
                    {humanize(t.truck_type)}{t.capacity ? ` · ${t.capacity}` : ''}
                  </p>
                  <p className="text-xs text-stone-600">Driver: {t.driver_name ?? 'none assigned'}</p>
                </div>
                <StatusBadge status={t.status} />
              </div>

              {t.reason ? <p className="mt-2 text-xs font-medium text-red-700">{t.reason}</p> : null}

              {t.bookings.length ? (
                <ul className="mt-2 space-y-0.5">
                  {t.bookings.map((b) => (
                    <li key={b.job_id} className="text-xs text-amber-800">
                      {b.job_no}: {formatDate(b.from)}{b.to !== b.from ? ` – ${formatDate(b.to)}` : ''}{b.customer ? ` · ${b.customer}` : ''}
                    </li>
                  ))}
                </ul>
              ) : t.available ? <Badge tone="green" className="mt-2">Free on these dates</Badge> : null}
            </button>
          </li>
        );
      })}
    </ul>
  );
}
