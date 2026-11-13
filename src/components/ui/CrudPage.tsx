import { useState, type ReactNode } from 'react';
import { useForm, type FieldValues, type DefaultValues, type Path } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import type { ZodTypeAny } from 'zod';
import { Archive, Pencil, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabaseClient';
import { friendlyError, nullify } from '@/lib/rpc';
import { useServerTable } from '@/lib/useServerTable';
import { DataTable, type Column } from './DataTable';
import { PageHeader } from './PageHeader';
import { Button } from './Button';
import { Modal } from './Modal';
import { Input } from './Input';
import { Select, type Option } from './Select';
import { Checkbox } from './Checkbox';
import { Textarea } from './Textarea';

export interface CrudField {
  name: string;
  label: string;
  type?: 'text' | 'number' | 'select' | 'checkbox' | 'textarea' | 'date' | 'email' | 'tel';
  options?: Option[];
  required?: boolean;
  hint?: string;
  step?: string;
  wide?: boolean;
  placeholder?: string;
}

/** Generic list + create/edit form for master data tables (services, suppliers, zones, task types, ...). */
export function CrudPage<T extends { id?: string; archived_at?: string | null }>({
  title, subtitle, table, select, schema, fields, columns, defaultValues, searchColumns, canEdit, archivable, toForm, beforeSave, defaultSort, filters, extraActions, exportName, idColumn = 'id',
}: {
  title: string; subtitle?: string; table: string; select?: string; schema: ZodTypeAny; fields: CrudField[]; columns: Column<T>[];
  defaultValues: Record<string, unknown>; searchColumns: string[]; canEdit: boolean; archivable?: boolean;
  toForm?: (row: T) => Record<string, unknown>; beforeSave?: (values: Record<string, unknown>) => Record<string, unknown>;
  defaultSort?: { column: string; ascending: boolean }; filters?: Record<string, string | number | boolean | null | undefined>;
  extraActions?: (row: T) => ReactNode; exportName?: string; idColumn?: string;
}) {
  const [editing, setEditing] = useState<T | null>(null);
  const [open, setOpen] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const t = useServerTable<T>({ table, select, searchColumns, defaultSort, filters: { ...(filters ?? {}), ...(archivable && !showArchived ? { 'is:archived_at': 'null' } : {}) } });
  const form = useForm<FieldValues>({ resolver: zodResolver(schema), defaultValues: defaultValues as DefaultValues<FieldValues> });

  const openForm = (row: T | null) => {
    setEditing(row);
    form.reset((row ? (toForm ? toForm(row) : { ...defaultValues, ...Object.fromEntries(Object.entries(row as Record<string, unknown>).map(([k, v]) => [k, v ?? ''])) }) : defaultValues) as DefaultValues<FieldValues>);
    setOpen(true);
  };

  const save = form.handleSubmit(async (values) => {
    const payload = nullify(beforeSave ? beforeSave(values) : values);
    const res = editing
      ? await supabase.from(table).update(payload).eq(idColumn, (editing as Record<string, unknown>)[idColumn] as string)
      : await supabase.from(table).insert(payload);
    if (res.error) { toast.error(friendlyError(res.error)); return; }
    toast.success(editing ? 'Saved' : 'Created');
    setOpen(false); await t.refetch();
  });

  const archive = async (row: T) => {
    const res = await supabase.from(table).update({ archived_at: row.archived_at ? null : new Date().toISOString() }).eq('id', row.id as string);
    if (res.error) toast.error(friendlyError(res.error)); else { toast.success(row.archived_at ? 'Restored' : 'Archived'); await t.refetch(); }
  };

  const actionCol: Column<T> = {
    key: '_actions', header: '', className: 'text-right', render: (row) => (
      <div className="flex justify-end gap-1">
        {extraActions?.(row)}
        {canEdit ? <Button variant="ghost" size="sm" aria-label="Edit" onClick={() => openForm(row)}><Pencil className="h-4 w-4" /></Button> : null}
        {canEdit && archivable ? <Button variant="ghost" size="sm" aria-label={row.archived_at ? 'Restore' : 'Archive'} onClick={() => archive(row)}><Archive className="h-4 w-4" /></Button> : null}
      </div>
    ),
  };

  return (
    <div>
      <PageHeader title={title} subtitle={subtitle} actions={canEdit ? <Button icon={<Plus className="h-4 w-4" />} onClick={() => openForm(null)}>Add</Button> : null} />
      <DataTable table={t} columns={[...columns, actionCol]} exportName={exportName ?? table}
        toolbar={archivable ? <label className="flex items-center gap-2 text-sm text-stone-600"><input type="checkbox" className="h-4 w-4" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />Show archived</label> : null}
        empty={{ title: `No ${title.toLowerCase()} yet`, action: canEdit ? <Button onClick={() => openForm(null)}>Add the first one</Button> : undefined }} />
      <Modal open={open} onClose={() => setOpen(false)} title={editing ? `Edit ${title.replace(/s$/, '').toLowerCase()}` : `New ${title.replace(/s$/, '').toLowerCase()}`} size="lg"
        footer={<><Button variant="secondary" onClick={() => setOpen(false)}>Cancel</Button><Button loading={form.formState.isSubmitting} onClick={save}>Save</Button></>}>
        <form onSubmit={save} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {fields.map((f) => {
            const err = form.formState.errors[f.name]?.message as string | undefined;
            const reg = form.register(f.name as Path<FieldValues>);
            if (f.type === 'checkbox') return <div key={f.name} className={f.wide ? 'sm:col-span-2' : ''}><Checkbox label={f.label} hint={f.hint} {...reg} /></div>;
            if (f.type === 'select') return <Select key={f.name} className={f.wide ? 'sm:col-span-2' : ''} label={f.label} required={f.required} error={err} hint={f.hint} options={f.options ?? []} placeholder={f.required ? 'Choose…' : '—'} {...reg} />;
            if (f.type === 'textarea') return <Textarea key={f.name} className="sm:col-span-2" label={f.label} required={f.required} error={err} hint={f.hint} {...reg} />;
            return <Input key={f.name} className={f.wide ? 'sm:col-span-2' : ''} label={f.label} required={f.required} error={err} hint={f.hint} placeholder={f.placeholder}
              type={f.type === 'number' ? 'number' : f.type ?? 'text'} step={f.step ?? (f.type === 'number' ? 'any' : undefined)} {...reg} />;
          })}
          <button type="submit" className="hidden" />
        </form>
      </Modal>
    </div>
  );
}
