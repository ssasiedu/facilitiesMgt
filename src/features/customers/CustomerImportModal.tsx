import { useState } from 'react';
import { Download, FileUp } from 'lucide-react';
import { toast } from 'sonner';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { readSpreadsheet, exportCsv } from '@/lib/export';
import { customerSchema } from '@/lib/schemas';
import { normalizePhone } from '@/lib/format';
import { rpc } from '@/lib/rpc';
import { CUSTOMER_IMPORT_COLUMNS } from './api';

interface PreviewRow { row: number; data: Record<string, string>; errors: string[] }

function validate(raw: Record<string, string>): string[] {
  const v = {
    customer_type: (raw.customer_type || 'individual').toLowerCase(), title: raw.title, first_name: raw.first_name, middle_name: raw.middle_name, last_name: raw.last_name,
    gender: raw.gender?.toLowerCase() || '', ghana_card_no: raw.ghana_card_no, phone: raw.phone, alt_phone: raw.alt_phone, whatsapp: raw.whatsapp, email: raw.email,
    occupation: raw.occupation, residential_address: raw.residential_address, company_name: raw.company_name, trading_name: raw.trading_name, registration_no: raw.registration_no,
    tin: raw.tin, sector: raw.sector, company_phone: raw.company_phone, company_email: raw.company_email, digital_address: raw.digital_address, region: raw.region, district: raw.district,
    zone_id: '', source: raw.source || 'call_in', assigned_to: '', preferred_channel: raw.preferred_channel || 'sms', sms_opt_in: raw.sms_opt_in ? !/^(no|false|0)$/i.test(raw.sms_opt_in) : true,
    marketing_consent: false, credit_limit: raw.credit_limit || 0, payment_terms_days: raw.payment_terms_days || 7, tags: '', notes: raw.notes, status: 'active',
  };
  const res = customerSchema.safeParse(v);
  return res.success ? [] : res.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
}

/** CSV / Excel import with a validation preview and a row-level error list. */
export function CustomerImportModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [rows, setRows] = useState<PreviewRow[]>([]);
  const [result, setResult] = useState<{ row: number; ok: boolean; error?: string }[] | null>(null);
  const [busy, setBusy] = useState(false);
  const valid = rows.filter((r) => !r.errors.length);

  return (
    <Modal open={open} onClose={() => { setRows([]); setResult(null); onClose(); }} title="Import customers" size="xl"
      footer={<>
        <Button variant="secondary" icon={<Download className="h-4 w-4" />} onClick={() => exportCsv([{}], CUSTOMER_IMPORT_COLUMNS.map((c) => ({ header: c, value: () => '' })), 'customer-import-template')}>Download template</Button>
        <Button disabled={!valid.length || !!result} loading={busy} onClick={async () => {
          setBusy(true);
          try {
            const payload = valid.map((r) => ({ ...r.data, phone: normalizePhone(r.data.phone) ?? '', alt_phone: normalizePhone(r.data.alt_phone) ?? '', whatsapp: normalizePhone(r.data.whatsapp) ?? '', company_phone: normalizePhone(r.data.company_phone) ?? '' }));
            const out: { row: number; ok: boolean; error?: string }[] = [];
            for (let i = 0; i < payload.length; i += 200) {
              const chunk = await rpc<{ row: number; ok: boolean; error?: string }[]>('import_customers', { p_rows: payload.slice(i, i + 200) });
              out.push(...chunk.map((c) => ({ ...c, row: valid[i + c.row - 1].row })));
            }
            setResult(out);
            toast.success(`${out.filter((o) => o.ok).length} customer(s) imported`);
          } catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
        }}>Import {valid.length} valid row(s)</Button>
      </>}>
      <div className="space-y-4">
        <label className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-stone-300 p-6 text-sm text-stone-600 hover:border-brand-500">
          <FileUp className="h-6 w-6" />Choose a CSV or Excel file (first row = column names)
          <input type="file" className="hidden" accept=".csv,.xlsx,.xls" onChange={async (e) => {
            const f = e.target.files?.[0]; e.target.value = '';
            if (!f) return;
            try {
              const data = await readSpreadsheet(f);
              setResult(null);
              setRows(data.slice(0, 5000).map((d, i) => ({ row: i + 2, data: d, errors: validate(d) })));
            } catch (err) { toast.error((err as Error).message); }
          }} />
        </label>
        {rows.length ? (
          <div>
            <div className="mb-2 flex gap-2 text-sm"><Badge tone="green">{valid.length} valid</Badge><Badge tone="red">{rows.length - valid.length} with errors</Badge></div>
            <div className="max-h-80 overflow-auto rounded-lg border border-stone-200">
              <table className="min-w-full text-xs">
                <thead className="sticky top-0 bg-stone-50 text-left"><tr><th className="px-2 py-1">Row</th><th className="px-2 py-1">Name</th><th className="px-2 py-1">Phone</th><th className="px-2 py-1">Result</th></tr></thead>
                <tbody>
                  {rows.map((r) => {
                    const res = result?.find((x) => x.row === r.row);
                    return (
                      <tr key={r.row} className="border-t border-stone-100">
                        <td className="px-2 py-1">{r.row}</td>
                        <td className="px-2 py-1">{r.data.company_name || [r.data.first_name, r.data.last_name].filter(Boolean).join(' ')}</td>
                        <td className="px-2 py-1">{r.data.phone || r.data.company_phone}</td>
                        <td className="px-2 py-1">{r.errors.length ? <span className="text-red-700">{r.errors.join('; ')}</span> : res ? (res.ok ? <span className="text-emerald-700">Imported</span> : <span className="text-red-700">{res.error}</span>) : <span className="text-stone-500">Ready</span>}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        ) : null}
      </div>
    </Modal>
  );
}
