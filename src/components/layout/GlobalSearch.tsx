import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ClipboardList, Contact, FileSpreadsheet, Receipt, ScrollText, Search, Truck } from 'lucide-react';
import { rpc } from '@/lib/rpc';
import { Modal } from '@/components/ui/Modal';
import { inputClass } from '@/components/ui/Field';
import { cn } from '@/lib/cn';

interface Hit { kind: string; id: string; title: string; subtitle: string; link: string }
const ICONS: Record<string, typeof Contact> = { customer: Contact, job_order: ClipboardList, invoice: FileSpreadsheet, receipt: Receipt, truck: Truck, contract: ScrollText };

/** Ctrl/Cmd + K search across customers, phones, job orders, invoices, receipts, trucks and contracts. */
export function GlobalSearch() {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [debounced, setDebounced] = useState('');
  const [active, setActive] = useState(0);
  const navigate = useNavigate();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setOpen(true); } };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  useEffect(() => { const t = setTimeout(() => setDebounced(q), 250); return () => clearTimeout(t); }, [q]);
  const { data = [], isFetching } = useQuery({ queryKey: ['global_search', debounced], enabled: debounced.trim().length >= 2, queryFn: () => rpc<Hit[]>('global_search', { p_q: debounced }) });
  const go = (h: Hit) => { setOpen(false); setQ(''); navigate(h.link); };
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="flex h-10 w-full max-w-md items-center gap-2 rounded-lg border border-stone-200 bg-stone-50 px-3 text-sm text-stone-500 hover:bg-white">
        <Search className="h-4 w-4" /><span className="flex-1 text-left">Search customers, phones, jobs, invoices…</span>
        <kbd className="hidden rounded border border-stone-300 px-1.5 text-[10px] sm:inline">Ctrl K</kbd>
      </button>
      <Modal open={open} onClose={() => setOpen(false)} title="Search" size="md">
        <input autoFocus className={cn(inputClass, 'h-11')} placeholder="Type a name, phone number, JO-, INV-, RCP- or truck number" value={q}
          onChange={(e) => { setQ(e.target.value); setActive(0); }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(a + 1, data.length - 1)); }
            if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
            if (e.key === 'Enter' && data[active]) go(data[active]);
          }} />
        <ul className="mt-3 max-h-[50vh] overflow-y-auto">
          {data.map((h, i) => {
            const Icon = ICONS[h.kind] ?? Search;
            return (
              <li key={`${h.kind}-${h.id}`}>
                <button type="button" onClick={() => go(h)} onMouseEnter={() => setActive(i)} className={cn('flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left', i === active ? 'bg-brand-50' : 'hover:bg-stone-50')}>
                  <Icon className="h-4 w-4 text-stone-500" />
                  <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{h.title}</span><span className="block truncate text-xs text-stone-500">{h.subtitle}</span></span>
                  <span className="text-[11px] uppercase text-stone-400">{h.kind.replace('_', ' ')}</span>
                </button>
              </li>
            );
          })}
          {debounced.length >= 2 && !isFetching && !data.length ? <li className="px-3 py-6 text-center text-sm text-stone-500">No matches.</li> : null}
        </ul>
      </Modal>
    </>
  );
}
