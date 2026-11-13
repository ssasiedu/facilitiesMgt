import { endOfMonth, endOfQuarter, endOfWeek, endOfYear, startOfMonth, startOfQuarter, startOfWeek, startOfYear } from 'date-fns';
import { isoDate } from '@/lib/format';
import { inputClass } from './Field';
import { cn } from '@/lib/cn';

export type Preset = 'today' | 'week' | 'mtd' | 'qtd' | 'ytd' | 'custom';

export function presetRange(p: Preset): { from: string; to: string } {
  const now = new Date();
  switch (p) {
    case 'today': return { from: isoDate(now), to: isoDate(now) };
    case 'week': return { from: isoDate(startOfWeek(now, { weekStartsOn: 1 })), to: isoDate(endOfWeek(now, { weekStartsOn: 1 })) };
    case 'qtd': return { from: isoDate(startOfQuarter(now)), to: isoDate(endOfQuarter(now) < now ? endOfQuarter(now) : now) };
    case 'ytd': return { from: isoDate(startOfYear(now)), to: isoDate(endOfYear(now) < now ? endOfYear(now) : now) };
    case 'mtd':
    default: return { from: isoDate(startOfMonth(now)), to: isoDate(endOfMonth(now) < now ? endOfMonth(now) : now) };
  }
}

export function DateRange({ from, to, onChange, preset, onPreset, presets = true }: {
  from: string; to: string; onChange: (from: string, to: string) => void; preset?: Preset; onPreset?: (p: Preset) => void; presets?: boolean;
}) {
  const options: [Preset, string][] = [['today', 'Today'], ['week', 'This week'], ['mtd', 'MTD'], ['qtd', 'QTD'], ['ytd', 'YTD'], ['custom', 'Custom']];
  return (
    <div className="flex flex-wrap items-center gap-2">
      {presets ? (
        <div className="flex flex-wrap rounded-lg border border-stone-300 bg-white p-0.5">
          {options.map(([p, l]) => (
            <button key={p} type="button" onClick={() => { onPreset?.(p); if (p !== 'custom') { const r = presetRange(p); onChange(r.from, r.to); } }}
              className={cn('rounded-md px-2.5 py-1 text-xs font-medium', preset === p ? 'bg-brand-600 text-white' : 'text-stone-600 hover:bg-stone-100')}>{l}</button>
          ))}
        </div>
      ) : null}
      <input type="date" aria-label="From" className={cn(inputClass, 'h-9 w-auto')} value={from} onChange={(e) => { onPreset?.('custom'); onChange(e.target.value, to); }} />
      <span className="text-stone-400">–</span>
      <input type="date" aria-label="To" className={cn(inputClass, 'h-9 w-auto')} value={to} onChange={(e) => { onPreset?.('custom'); onChange(from, e.target.value); }} />
    </div>
  );
}
