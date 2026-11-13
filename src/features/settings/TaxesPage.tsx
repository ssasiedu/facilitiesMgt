import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabaseClient';
import { check, rpc } from '@/lib/rpc';
import { taxSchema } from '@/lib/schemas';
import { formatGHS, formatPct } from '@/lib/format';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { CrudPage } from '@/components/ui/CrudPage';
import { PageHeader } from '@/components/ui/PageHeader';
import { SettingsTabs } from './SettingsTabs';
import type { Tables } from '@/types/database';

type Tax = Tables<'tax_rates'>;
interface TaxLine { tax_rate_id: string; name: string; rate: number; compound: boolean; base_amount: number; amount: number; account_id: string | null }

/**
 * Tax rates (spec 2 and 4.14). Nothing is hard-coded: rates, order and whether a rate compounds
 * on the ones before it all live here, and every invoice applies whatever is active at the time.
 */
export default function TaxesPage() {
  const { data: accounts = [] } = useQuery({
    queryKey: ['lookup', 'tax-accounts'],
    queryFn: async () => check(await supabase.from('accounts').select('id, code, name')
      .eq('type', 'liability').is('archived_at', null).order('code')) as { id: string; code: string; name: string }[],
  });
  // The worked example calls the same database function invoices use, so the two can never disagree.
  const { data: example = [] } = useQuery({
    queryKey: ['tax-example'],
    queryFn: () => rpc<TaxLine[]>('compute_taxes', { p_taxable: 1000 }),
  });
  const exampleTotal = example.reduce((t, l) => t + Number(l.amount), 0);

  return (
    <div>
      <PageHeader title="Settings" subtitle="Tax rates applied to quotations, invoices and credit notes" />
      <SettingsTabs />

      <div className="mt-4">
        <CrudPage<Tax>
          title="Tax rates"
          subtitle="Order matters: a compounding rate is worked out on the running total, not on the net amount"
          table="tax_rates"
          schema={taxSchema}
          canEdit
          exportName="tax-rates"
          defaultSort={{ column: 'sort_order', ascending: true }}
          searchColumns={['code', 'name']}
          defaultValues={{ code: '', name: '', rate: 0, compound: false, account_id: '', active: true, sort_order: 10 }}
          fields={[
            { name: 'code', label: 'Code', required: true, placeholder: 'VAT', hint: 'Short code shown on documents' },
            { name: 'name', label: 'Name', required: true, placeholder: 'Value Added Tax' },
            { name: 'rate', label: 'Rate (%)', type: 'number', step: '0.001', required: true },
            { name: 'sort_order', label: 'Order', type: 'number', required: true, hint: 'Lower numbers are applied first' },
            { name: 'account_id', label: 'Liability account', type: 'select', options: accounts.map((a) => ({ value: a.id, label: `${a.code} — ${a.name}` })), hint: 'Where the tax collected is posted' },
            { name: 'compound', label: 'Charge on the running total (compounds)', type: 'checkbox', wide: true },
            { name: 'active', label: 'Active — applied to new documents', type: 'checkbox', wide: true },
          ]}
          columns={[
            { key: 'code', header: 'Code', sort: 'code', render: (r) => <span className="font-medium">{r.code}</span>, exportValue: (r) => r.code },
            { key: 'name', header: 'Name', sort: 'name', render: (r) => r.name, exportValue: (r) => r.name },
            { key: 'rate', header: 'Rate', sort: 'rate', className: 'text-right', render: (r) => <span className="tabular-nums">{formatPct(Number(r.rate))}</span>, exportValue: (r) => Number(r.rate) },
            { key: 'compound', header: 'Compounds', render: (r) => r.compound ? <Badge tone="amber">On running total</Badge> : <span className="text-stone-500">On net</span>, exportValue: (r) => r.compound },
            { key: 'sort_order', header: 'Order', sort: 'sort_order', className: 'text-right', hideOnMobile: true, render: (r) => r.sort_order, exportValue: (r) => r.sort_order },
            { key: 'active', header: 'Status', render: (r) => r.active ? <Badge tone="green">Active</Badge> : <Badge tone="grey">Inactive</Badge>, exportValue: (r) => r.active },
          ]}
        />
      </div>

      <Card className="mt-4" title="Worked example on GH₵ 1,000.00">
        {example.length ? (
          <>
            <table className="min-w-full text-sm">
              <tbody className="divide-y divide-stone-100">
                <tr><td className="py-1.5">Net amount</td><td className="py-1.5 text-right tabular-nums">{formatGHS(1000)}</td></tr>
                {example.map((l) => (
                  <tr key={l.tax_rate_id}>
                    <td className="py-1.5">
                      {l.name} ({formatPct(Number(l.rate))})
                      {l.compound ? <span className="text-xs text-stone-500"> on {formatGHS(l.base_amount)}</span> : null}
                    </td>
                    <td className="py-1.5 text-right tabular-nums">{formatGHS(l.amount)}</td>
                  </tr>
                ))}
                <tr className="font-semibold">
                  <td className="py-1.5">Total payable</td>
                  <td className="py-1.5 text-right tabular-nums">{formatGHS(1000 + exampleTotal)}</td>
                </tr>
              </tbody>
            </table>
            <p className="mt-3 text-xs text-stone-500">
              The same calculation runs in the database (compute_taxes) when a document is issued, so the figures here and on
              the invoice always agree. Changing a rate does not alter invoices already issued.
            </p>
          </>
        ) : <p className="text-sm text-stone-600">No active tax rates, so documents are issued without tax.</p>}
      </Card>
    </div>
  );
}
