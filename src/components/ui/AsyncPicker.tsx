import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronDown, X } from 'lucide-react';
import { cn } from '@/lib/cn';
import { Field, inputClass } from './Field';

export interface PickerItem { id: string; label: string; sub?: string | null }

/** Searchable picker for large lists (customers, leads, jobs): searches on the server as you type. */
export function AsyncPicker({ label, value, valueLabel, onChange, search, required, error, placeholder = 'Search…', disabled, queryKey }: {
  label?: string; value: string | null | undefined; valueLabel?: string | null; onChange: (id: string | null, item?: PickerItem) => void;
  search: (q: string) => Promise<PickerItem[]>; required?: boolean; error?: string; placeholder?: string; disabled?: boolean; queryKey: string;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [debounced, setDebounced] = useState('');
  const [chosen, setChosen] = useState<string | null>(valueLabel ?? null);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { setChosen(valueLabel ?? null); }, [valueLabel]);
  useEffect(() => { const t = setTimeout(() => setDebounced(q), 250); return () => clearTimeout(t); }, [q]);
  useEffect(() => {
    const close = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);
  const { data = [], isFetching } = useQuery({ queryKey: ['picker', queryKey, debounced], enabled: open, queryFn: () => search(debounced.trim()) });
  return (
    <Field label={label} required={required} error={error}>
      <div className="relative" ref={ref}>
        <button type="button" disabled={disabled} aria-haspopup="listbox" onClick={() => setOpen(!open)}
          className={cn(inputClass, 'flex h-10 items-center justify-between text-left', !value && 'text-stone-400')}>
          <span className="truncate">{value ? chosen ?? 'Selected' : placeholder}</span>
          <span className="flex items-center gap-1">
            {value && !disabled ? <X className="h-4 w-4 text-stone-400 hover:text-stone-700" onClick={(e) => { e.stopPropagation(); onChange(null); setChosen(null); }} /> : null}
            <ChevronDown className="h-4 w-4 text-stone-400" />
          </span>
        </button>
        {open ? (
          <div className="absolute z-40 mt-1 w-full rounded-lg border border-stone-200 bg-white p-2 shadow-lg">
            <input autoFocus className={cn(inputClass, 'h-9')} placeholder="Type to search" value={q} onChange={(e) => setQ(e.target.value)} />
            <ul role="listbox" className="mt-1 max-h-64 overflow-y-auto">
              {data.map((it) => (
                <li key={it.id}>
                  <button type="button" className="w-full rounded-md px-2 py-2 text-left hover:bg-stone-100" onClick={() => { onChange(it.id, it); setChosen(it.label); setOpen(false); }}>
                    <span className="block text-sm">{it.label}</span>{it.sub ? <span className="block text-xs text-stone-500">{it.sub}</span> : null}
                  </button>
                </li>
              ))}
              {!isFetching && !data.length ? <li className="px-2 py-3 text-sm text-stone-500">No matches</li> : null}
            </ul>
          </div>
        ) : null}
      </div>
    </Field>
  );
}
