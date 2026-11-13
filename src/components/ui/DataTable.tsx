import { useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, Download, Search } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/cn';
import { exportCsv, exportXlsx, type ExportColumn } from '@/lib/export';
import type { useServerTable } from '@/lib/useServerTable';
import { Button } from './Button';
import { Skeleton } from './Skeleton';
import { EmptyState } from './EmptyState';
import { ErrorState } from './ErrorState';
import { inputClass } from './Field';

export interface Column<T> {
  key: string;
  header: string;
  render: (row: T) => ReactNode;
  /** database column to sort by (enables sorting) */
  sort?: string;
  /** value for CSV / Excel export (defaults to nothing) */
  exportValue?: (row: T) => string | number | boolean | null | undefined;
  className?: string;
  hideOnMobile?: boolean;
}

type TableState<T> = ReturnType<typeof useServerTable<T>>;

export function DataTable<T extends { id?: string }>({ table, columns, rowLink, toolbar, empty, exportName, searchPlaceholder = 'Search…', selectable }: {
  table: TableState<T>; columns: Column<T>[]; rowLink?: (row: T) => string | undefined; toolbar?: ReactNode;
  empty?: { title: string; message?: string; action?: ReactNode }; exportName?: string; searchPlaceholder?: string; selectable?: boolean;
}) {
  const navigate = useNavigate();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [exporting, setExporting] = useState(false);
  const pages = Math.max(1, Math.ceil(table.count / table.pageSize));
  const exportCols: ExportColumn<T>[] = columns.filter((c) => c.exportValue).map((c) => ({ header: c.header, value: c.exportValue! }));

  const doExport = async (kind: 'csv' | 'xlsx') => {
    setExporting(true);
    try {
      const all = selected.size ? (await table.fetchAll()).filter((r) => r.id && selected.has(r.id)) : await table.fetchAll();
      const name = `${exportName ?? 'export'}-${new Date().toISOString().slice(0, 10)}`;
      if (kind === 'csv') exportCsv(all, exportCols, name); else exportXlsx(all, exportCols, name);
      toast.success(`Exported ${all.length} row(s)`);
    } catch (e) { toast.error((e as Error).message); } finally { setExporting(false); }
  };

  return (
    <div className="rounded-xl border border-stone-200 bg-white shadow-sm">
      <div className="flex flex-wrap items-center gap-2 border-b border-stone-100 p-3">
        <div className="relative min-w-[200px] flex-1 sm:max-w-xs">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-stone-400" />
          <input aria-label="Search" placeholder={searchPlaceholder} className={cn(inputClass, 'h-10 pl-9')} value={table.search} onChange={(e) => table.setSearch(e.target.value)} />
        </div>
        {toolbar}
        {exportCols.length ? (
          <div className="ml-auto flex gap-1">
            <Button variant="secondary" size="sm" icon={<Download className="h-4 w-4" />} loading={exporting} onClick={() => doExport('csv')}>CSV{selected.size ? ` (${selected.size})` : ''}</Button>
            <Button variant="secondary" size="sm" icon={<Download className="h-4 w-4" />} disabled={exporting} onClick={() => doExport('xlsx')}>Excel</Button>
          </div>
        ) : null}
      </div>
      {table.error ? <div className="p-4"><ErrorState error={table.error} onRetry={() => table.refetch()} /></div> : (
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-stone-50 text-left text-xs uppercase tracking-wide text-stone-500">
              <tr>
                {selectable ? <th className="w-8 px-3 py-2"><input type="checkbox" aria-label="Select page" className="h-4 w-4"
                  checked={table.rows.length > 0 && table.rows.every((r) => r.id && selected.has(r.id))}
                  onChange={(e) => { const s = new Set(selected); table.rows.forEach((r) => r.id && (e.target.checked ? s.add(r.id) : s.delete(r.id))); setSelected(s); }} /></th> : null}
                {columns.map((c) => (
                  <th key={c.key} scope="col" className={cn('whitespace-nowrap px-3 py-2 font-medium', c.hideOnMobile && 'hidden md:table-cell', c.className)}>
                    {c.sort ? (
                      <button type="button" className="inline-flex items-center gap-1 hover:text-stone-800" onClick={() => table.toggleSort(c.sort!)}>
                        {c.header}{table.sort.column === c.sort ? (table.sort.ascending ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />) : null}
                      </button>
                    ) : c.header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {table.isLoading ? Array.from({ length: 6 }).map((_, i) => (
                <tr key={i}>{columns.map((c) => <td key={c.key} className={cn('px-3 py-3', c.hideOnMobile && 'hidden md:table-cell')}><Skeleton className="h-4 w-full" /></td>)}</tr>
              )) : table.rows.map((row, i) => {
                const link = rowLink?.(row);
                return (
                  <tr key={row.id ?? i} className={cn(link && 'cursor-pointer hover:bg-stone-50', table.isFetching && 'opacity-70')}
                    onClick={(e) => { if (link && !(e.target as HTMLElement).closest('button,a,input,select')) navigate(link); }}>
                    {selectable ? <td className="px-3 py-2"><input type="checkbox" aria-label="Select row" className="h-4 w-4" checked={!!row.id && selected.has(row.id)}
                      onChange={(e) => { const s = new Set(selected); if (row.id) { if (e.target.checked) s.add(row.id); else s.delete(row.id); } setSelected(s); }} /></td> : null}
                    {columns.map((c) => <td key={c.key} className={cn('px-3 py-2.5 align-top', c.hideOnMobile && 'hidden md:table-cell', c.className)}>{c.render(row)}</td>)}
                  </tr>
                );
              })}
            </tbody>
          </table>
          {!table.isLoading && table.rows.length === 0 ? <EmptyState title={empty?.title ?? 'Nothing here yet'} message={table.search ? 'No results match your search.' : empty?.message} action={table.search ? undefined : empty?.action} /> : null}
        </div>
      )}
      <div className="flex items-center justify-between border-t border-stone-100 px-3 py-2 text-sm text-stone-600">
        <span>{table.count.toLocaleString()} record(s)</span>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" aria-label="Previous page" disabled={table.page === 0} onClick={() => table.setPage(table.page - 1)}><ChevronLeft className="h-4 w-4" /></Button>
          <span>Page {table.page + 1} of {pages}</span>
          <Button variant="ghost" size="sm" aria-label="Next page" disabled={table.page + 1 >= pages} onClick={() => table.setPage(table.page + 1)}><ChevronRight className="h-4 w-4" /></Button>
        </div>
      </div>
    </div>
  );
}

/** Simple select used in table toolbars. */
export function FilterSelect({ value, onChange, options, label }: { value: string; onChange: (v: string) => void; options: { value: string; label: string }[]; label: string }) {
  return (
    <select aria-label={label} className={cn(inputClass, 'h-10 w-auto')} value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">{label}: all</option>
      {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
}
