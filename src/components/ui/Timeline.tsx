import { formatDateTime } from '@/lib/format';

export interface TimelineItem { at: string | null; title: string; detail?: string | null; actor?: string | null; kind?: string }

export function Timeline({ items }: { items: TimelineItem[] }) {
  if (!items.length) return <p className="text-sm text-stone-500">No activity yet.</p>;
  return (
    <ol className="relative ml-2 border-l border-stone-200">
      {items.map((it, i) => (
        <li key={i} className="mb-4 ml-4">
          <span className="absolute -left-1.5 mt-1.5 h-3 w-3 rounded-full border-2 border-white bg-brand-600" />
          <p className="text-sm font-medium text-stone-800">{it.title}</p>
          {it.detail ? <p className="text-sm text-stone-600">{it.detail}</p> : null}
          <p className="text-xs text-stone-500">{formatDateTime(it.at)}{it.actor ? ` · ${it.actor}` : ''}</p>
        </li>
      ))}
    </ol>
  );
}
