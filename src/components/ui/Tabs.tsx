import { cn } from '@/lib/cn';

export function Tabs<T extends string>({ tabs, value, onChange }: { tabs: { value: T; label: string; count?: number }[]; value: T; onChange: (v: T) => void }) {
  return (
    <div role="tablist" className="-mx-1 flex gap-1 overflow-x-auto border-b border-stone-200 px-1">
      {tabs.map((t) => (
        <button key={t.value} role="tab" type="button" aria-selected={value === t.value} onClick={() => onChange(t.value)}
          className={cn('whitespace-nowrap border-b-2 px-3 py-2.5 text-sm font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500',
            value === t.value ? 'border-brand-600 text-brand-700' : 'border-transparent text-stone-500 hover:text-stone-800')}>
          {t.label}{t.count !== undefined ? <span className="ml-1.5 rounded-full bg-stone-100 px-1.5 text-xs text-stone-600">{t.count}</span> : null}
        </button>
      ))}
    </div>
  );
}
