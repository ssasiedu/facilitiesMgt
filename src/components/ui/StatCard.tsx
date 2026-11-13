import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ArrowDownRight, ArrowUpRight } from 'lucide-react';
import { cn } from '@/lib/cn';

/** KPI card with comparison to the previous period; the whole card drills down to its list. */
export function StatCard({ label, value, previous, current, to, tone, hint, invert }: {
  label: string; value: ReactNode; previous?: number | null; current?: number | null; to?: string; tone?: 'red' | 'amber' | 'green'; hint?: string; invert?: boolean;
}) {
  let change: number | null = null;
  if (previous !== undefined && previous !== null && current !== undefined && current !== null) {
    change = previous === 0 ? (current === 0 ? 0 : 100) : ((current - previous) / Math.abs(previous)) * 100;
  }
  const good = change === null ? null : invert ? change <= 0 : change >= 0;
  const body = (
    <div className={cn('h-full rounded-xl border bg-white p-4 shadow-sm transition', to && 'hover:border-brand-500 hover:shadow',
      tone === 'red' ? 'border-red-200' : tone === 'amber' ? 'border-amber-200' : 'border-stone-200')}>
      <p className="text-xs font-medium uppercase tracking-wide text-stone-500">{label}</p>
      <p className={cn('mt-1 text-xl font-semibold', tone === 'red' ? 'text-red-700' : tone === 'amber' ? 'text-amber-700' : 'text-stone-900')}>{value}</p>
      <div className="mt-1 flex items-center gap-1 text-xs">
        {change !== null ? (
          <span className={cn('inline-flex items-center', good ? 'text-emerald-700' : 'text-red-700')}>
            {change >= 0 ? <ArrowUpRight className="h-3.5 w-3.5" /> : <ArrowDownRight className="h-3.5 w-3.5" />}{Math.abs(change).toFixed(1)}% vs previous
          </span>
        ) : hint ? <span className="text-stone-500">{hint}</span> : null}
      </div>
    </div>
  );
  return to ? <Link to={to} className="block focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 rounded-xl">{body}</Link> : body;
}
