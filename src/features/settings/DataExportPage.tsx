import { useState } from 'react';
import { Database, Download, FileSpreadsheet, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabaseClient';
import { friendlyError } from '@/lib/rpc';
import { exportCsv, exportWorkbook } from '@/lib/export';
import { isoDate } from '@/lib/format';
import { PageHeader } from '@/components/ui/PageHeader';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Checkbox } from '@/components/ui/Checkbox';
import { SettingsTabs } from './SettingsTabs';

interface Group { key: string; label: string; note: string; tables: string[] }

/** Every table a Super Admin can take out of the system, grouped the way the business thinks of them. */
const GROUPS: Group[] = [
  { key: 'customers', label: 'Customers and contacts', note: 'Customers, their contacts and their documents index', tables: ['customers', 'customer_contacts', 'customer_documents'] },
  { key: 'sales', label: 'Leads, estimates and quotations', note: 'The pipeline and every priced estimate', tables: ['leads', 'lead_activities', 'estimates', 'estimate_lines', 'quotations'] },
  { key: 'jobs', label: 'Job orders', note: 'Jobs, their lines, assignments, status history and actual costs', tables: ['job_orders', 'job_order_lines', 'job_order_assignments', 'job_order_status_history', 'job_order_actual_costs'] },
  { key: 'contracts', label: 'Contracts', note: 'Contracts, sites, services, labour and billing periods', tables: ['contracts', 'contract_sites', 'contract_services', 'contract_labour', 'contract_supplies', 'contract_billing_periods'] },
  { key: 'fleet', label: 'Fleet and staff', note: 'Trucks, employees, bookings, maintenance and fuel', tables: ['trucks', 'truck_documents', 'truck_status_history', 'employees', 'truck_bookings', 'employee_bookings', 'maintenance_schedules', 'maintenance_records', 'fuel_logs'] },
  { key: 'billing', label: 'Invoices, payments and receipts', note: 'Everything a customer was billed and paid', tables: ['invoices', 'invoice_lines', 'invoice_taxes', 'payments', 'payment_allocations', 'receipts', 'credit_notes', 'refunds', 'customer_credits'] },
  { key: 'accounting', label: 'Accounting', note: 'Chart of accounts, journals, bills, expenses and bank accounts', tables: ['accounts', 'journal_entries', 'journal_lines', 'suppliers', 'bills', 'bill_lines', 'bill_payments', 'expenses', 'bank_accounts', 'bank_transfers'] },
  { key: 'supplies', label: 'Supplies and stock', note: 'Stock locations, levels and every movement', tables: ['stock_locations', 'stock_levels', 'stock_movements', 'cost_items', 'cost_item_prices'] },
  { key: 'zonal', label: 'Zonal tracker', note: 'Plans, tasks, updates, check-ins and comments', tables: ['zones', 'task_plans', 'tasks', 'task_updates', 'task_checkins', 'task_comments'] },
  { key: 'surveys', label: 'Surveys', note: 'Questions, invitations and every answer received', tables: ['surveys', 'survey_questions', 'survey_invitations', 'survey_responses', 'survey_answers'] },
  { key: 'admin', label: 'Settings and people', note: 'Company settings, users, roles, taxes, templates and numbering', tables: ['company_settings', 'profiles', 'roles', 'user_roles', 'user_zones', 'tax_rates', 'notification_templates', 'document_sequences', 'posting_rules', 'payment_methods', 'services'] },
  { key: 'audit', label: 'Audit log and notifications', note: 'The full trail of changes and every message sent', tables: ['audit_log', 'notifications'] },
];

const PAGE = 1000;

/** Read a whole table in pages, so a large table does not hit the API row limit. */
async function fetchAll(table: string): Promise<Record<string, unknown>[]> {
  const out: Record<string, unknown>[] = [];
  for (let page = 0; ; page += 1) {
    const { data, error } = await supabase.from(table).select('*').range(page * PAGE, page * PAGE + PAGE - 1);
    if (error) throw new Error(`${table}: ${friendlyError(error)}`);
    const rows = (data ?? []) as Record<string, unknown>[];
    out.push(...rows);
    if (rows.length < PAGE) return out;
    if (page > 200) return out; // 200k rows is already far past a sensible browser export
  }
}

/** Taking your data out of the system: whole groups as Excel, or one table as CSV (spec 4.14). */
export default function DataExportPage() {
  const [picked, setPicked] = useState<string[]>(GROUPS.map((g) => g.key));
  const [busy, setBusy] = useState<string | null>(null);
  const [progress, setProgress] = useState('');

  const toggle = (key: string) => setPicked(picked.includes(key) ? picked.filter((k) => k !== key) : [...picked, key]);

  const run = async (groups: Group[], filename: string) => {
    if (!groups.length) { toast.error('Choose at least one group'); return; }
    setBusy(filename);
    const sheets: { name: string; rows: Record<string, unknown>[] }[] = [];
    try {
      for (const g of groups) {
        for (const t of g.tables) {
          setProgress(t);
          const rows = await fetchAll(t);
          // Excel sheet names are capped at 31 characters and must be unique.
          sheets.push({ name: t.slice(0, 31), rows });
        }
      }
      const total = sheets.reduce((n, s) => n + s.rows.length, 0);
      if (!total) { toast.error('Those tables are empty'); return; }
      exportWorkbook(sheets.filter((s) => s.rows.length), filename);
      toast.success(`Exported ${total.toLocaleString()} rows across ${sheets.filter((s) => s.rows.length).length} sheets`);
    } catch (e) {
      toast.error(friendlyError(e));
    } finally { setBusy(null); setProgress(''); }
  };

  const oneTable = async (table: string) => {
    setBusy(table);
    try {
      const rows = await fetchAll(table);
      if (!rows.length) { toast.error(`${table} is empty`); return; }
      const headers = Object.keys(rows[0]);
      exportCsv(rows, headers.map((h) => ({
        header: h,
        value: (r: Record<string, unknown>) => {
          const v = r[h];
          return v === null || v === undefined ? '' : typeof v === 'object' ? JSON.stringify(v) : (v as string | number | boolean);
        },
      })), `${table}-${isoDate()}`);
    } catch (e) { toast.error(friendlyError(e)); } finally { setBusy(null); }
  };

  const selected = GROUPS.filter((g) => picked.includes(g.key));

  return (
    <div>
      <PageHeader title="Settings" subtitle="Take your data out of the system whenever you want" />
      <SettingsTabs />

      <Card className="mt-4" title={<span className="flex items-center gap-2"><ShieldCheck className="h-4 w-4" />Your data stays yours</span>}>
        <p className="text-sm text-stone-600">
          Everything below is exported straight from the database through your own account, so you only ever get rows you are
          allowed to see. Nothing is sent anywhere else: the file is built in your browser and saved to your computer.
          Under the Data Protection Act 2012 (Act 843) you must be able to give a customer a copy of the personal data you
          hold about them — the Customers group does exactly that, and a single customer's record can also be exported from
          their own profile page.
        </p>
      </Card>

      <Card className="mt-4" title="Choose what to export"
        actions={<>
          <Button variant="ghost" size="sm" onClick={() => setPicked(GROUPS.map((g) => g.key))}>All</Button>
          <Button variant="ghost" size="sm" onClick={() => setPicked([])}>None</Button>
        </>}>
        <div className="grid grid-cols-1 gap-x-6 md:grid-cols-2">
          {GROUPS.map((g) => (
            <div key={g.key} className="border-b border-stone-100 py-1 last:border-0">
              <Checkbox label={g.label} hint={g.note} checked={picked.includes(g.key)} onChange={() => toggle(g.key)} />
              <div className="ml-7 flex flex-wrap gap-1 pb-2">
                {g.tables.map((t) => (
                  <button key={t} type="button" disabled={busy !== null} onClick={() => void oneTable(t)}
                    className="rounded-full border border-stone-200 px-2 py-0.5 font-mono text-[11px] text-stone-500 hover:border-brand-400 hover:text-brand-700 disabled:opacity-50"
                    title={`Download ${t} as CSV`}>
                    {t}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
        <p className="mt-2 text-xs text-stone-500">Click any table name to download just that table as CSV.</p>
      </Card>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Button icon={<FileSpreadsheet className="h-4 w-4" />} loading={busy === `facilities-export-${isoDate()}`}
          disabled={busy !== null || !selected.length}
          onClick={() => void run(selected, `facilities-export-${isoDate()}`)}>
          Export {selected.length} group{selected.length === 1 ? '' : 's'} to Excel
        </Button>
        <Button variant="secondary" icon={<Database className="h-4 w-4" />} disabled={busy !== null}
          onClick={() => void run(GROUPS, `facilities-full-backup-${isoDate()}`)}>
          Full backup (every table)
        </Button>
        {busy ? <span className="text-sm text-stone-600">Reading {progress || busy}…</span> : null}
      </div>

      <Card className="mt-4" title={<span className="flex items-center gap-2"><Download className="h-4 w-4" />Other ways to get your data</span>}>
        <ul className="space-y-2 text-sm text-stone-600">
          <li><strong>Reports.</strong> Every financial report has its own Excel and PDF export, already formatted for your accountant.</li>
          <li><strong>A single customer.</strong> Their profile page exports their details, jobs, invoices and payments in one file.</li>
          <li><strong>A full database dump.</strong> From your own machine:
            <code className="ml-1 rounded bg-stone-100 px-1 text-xs">supabase db dump --db-url "$DATABASE_URL" -f backup.sql</code>.
            That includes everything, bypasses row limits and can be restored into any Postgres server.</li>
          <li><strong>Uploaded files.</strong> Photos, signatures and scanned documents live in storage; download them with
            <code className="ml-1 rounded bg-stone-100 px-1 text-xs">supabase storage download</code> or from the Supabase dashboard.</li>
        </ul>
      </Card>
    </div>
  );
}
