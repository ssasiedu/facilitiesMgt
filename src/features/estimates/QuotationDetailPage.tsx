import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useFieldArray, useForm } from 'react-hook-form';
import { useQuery } from '@tanstack/react-query';
import { Download, Plus, Save, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { friendlyError, useAction } from '@/lib/rpc';
import { useAuth } from '@/lib/auth';
import { hasAny } from '@/lib/permissions';
import { useSettings } from '@/lib/settings';
import { useListOptions, useTaxRates, toOptions } from '@/lib/lookups';
import { formatDate, formatGHS, round2 } from '@/lib/format';
import { PageHeader } from '@/components/ui/PageHeader';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Textarea } from '@/components/ui/Textarea';
import { Checkbox } from '@/components/ui/Checkbox';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { Spinner } from '@/components/ui/Spinner';
import { ErrorState } from '@/components/ui/ErrorState';
import { downloadPdf } from '@/lib/pdf/download';
import { companyFromSettings } from '@/lib/pdf/company';
import { QuotationPdf } from '@/lib/pdf/QuotationPdf';
import { loadQuotation, saveQuotationLines, saveQuotationTerms, toQuotationDoc, type QuotationLineValues } from './quotationApi';
import { useServices } from '@/lib/lookups';

interface FormShape {
  payment_terms: string;
  lines: QuotationLineValues[];
}

const EMPTY_LINE: QuotationLineValues = { service_id: '', description: '', quantity: 1, unit_price: 0, discount: 0, taxable: true };

/**
 * What the customer will read, laid out as they will read it. The lines start from the estimate
 * and can be split, reworded or repriced before the quotation goes out; the figures on the page
 * are a preview, and the database recalculates them on save so the quotation and the invoice
 * that follows it can never disagree.
 */
export default function QuotationDetailPage() {
  const { id = '' } = useParams();
  const { roles } = useAuth();
  const settings = useSettings();
  const services = useServices();
  const taxes = useTaxRates();
  const termOptions = useListOptions('payment_terms');
  const [customTerms, setCustomTerms] = useState(false);

  const canWrite = hasAny(roles, 'manager', 'ops_officer', 'sales_exec');

  const query = useQuery({ queryKey: ['quotation', id], queryFn: () => loadQuotation(id), enabled: !!id });
  const quote = query.data;

  const form = useForm<FormShape>({ defaultValues: { payment_terms: '', lines: [EMPTY_LINE] } });
  const lines = useFieldArray({ control: form.control, name: 'lines' });
  const values = form.watch();
  // form.watch() widens the array, so the typed view is taken once and used throughout.
  const lineValues = (values.lines ?? []) as QuotationLineValues[];

  useEffect(() => {
    if (!quote) return;
    const sorted = [...(quote.quotation_lines ?? [])].sort((a, b) => a.sort_order - b.sort_order);
    form.reset({
      payment_terms: quote.payment_terms ?? '',
      lines: sorted.length
        ? sorted.map((l) => ({
            service_id: l.service_id ?? '',
            description: l.description,
            quantity: Number(l.quantity),
            unit_price: Number(l.unit_price),
            discount: Number(l.discount),
            taxable: l.taxable,
          }))
        : [EMPTY_LINE],
    });
    // A term typed by hand rather than chosen from the list keeps its own box open.
    const onList = (termOptions.data ?? []).some((o) => o.label === quote.payment_terms);
    setCustomTerms(!!quote.payment_terms && !onList);
  }, [quote, form, termOptions.data]);

  // Once accepted, this is the document the customer agreed to, so it stops moving.
  // A quotation is declined, not rejected; the statuses are quotations_status_check's.
  const frozen = !!quote && ['accepted', 'declined', 'expired'].includes(quote.status);
  const readOnly = frozen || !canWrite;

  const activeTaxes = (taxes.data ?? []).filter((t) => t.active);

  const preview = useMemo(() => {
    const rows: { gross: number; net: number; taxable: boolean }[] = lineValues.map((l) => {
      const gross = round2(Number(l.quantity || 0) * Number(l.unit_price || 0));
      return { gross, net: round2(gross - Number(l.discount || 0)), taxable: !!l.taxable };
    });
    const subtotal = round2(rows.reduce((s: number, r) => s + r.gross, 0));
    const discount = round2(lineValues.reduce((s: number, l) => s + Number(l.discount || 0), 0));
    const net = round2(rows.reduce((s: number, r) => s + r.net, 0));
    const taxableBase = round2(rows.filter((r) => r.taxable).reduce((s: number, r) => s + r.net, 0));
    /* The estimate may carry one flat rate instead of the configured taxes; the quotation shows
       whichever applies, the same choice the database makes when it recalculates. */
    const flatPct = Number(quote?.estimate?.tax_pct ?? 0);
    const taxRows = flatPct > 0
      ? [{ id: 'flat', name: 'Tax', rate: flatPct, amount: round2(taxableBase * flatPct / 100) }]
      : activeTaxes.map((t) => ({ id: t.id, name: t.name, rate: Number(t.rate), amount: round2(taxableBase * Number(t.rate) / 100) }));
    const tax = round2(taxRows.reduce((s: number, t) => s + t.amount, 0));
    return { subtotal, discount, net, taxableBase, taxRows, tax, total: round2(net + tax) };
  }, [lineValues, activeTaxes, quote]);

  const save = useAction(async () => {
    const rows = lineValues.filter((l) => l.description.trim());
    if (!rows.length) throw new Error('A quotation needs at least one line.');
    if (rows.some((l) => Number(l.quantity) <= 0)) throw new Error('Every line needs a quantity above zero.');
    await saveQuotationLines(id, rows.map((l) => ({ ...l, quantity: Number(l.quantity), unit_price: Number(l.unit_price), discount: Number(l.discount || 0) })));
    await saveQuotationTerms(id, values.payment_terms);
  }, {
    success: 'Quotation saved — totals recalculated',
    onSuccess: () => void query.refetch(),
  });

  const download = async () => {
    if (!settings || !quote) return;
    try {
      const fresh = await loadQuotation(id);
      await downloadPdf(
        <QuotationPdf company={companyFromSettings(settings)} quote={toQuotationDoc(fresh, settings.invoice_terms)} />,
        `quotation-${fresh.quote_no ?? 'draft'}`,
      );
    } catch (e) {
      toast.error(friendlyError(e));
    }
  };

  if (query.isLoading) return <Spinner />;
  if (query.error) return <ErrorState error={query.error} onRetry={() => void query.refetch()} />;
  if (!quote) return null;

  const party = quote.customer?.display_name ?? quote.lead?.name ?? 'Customer';

  return (
    <div>
      <PageHeader
        title={`Quotation ${quote.quote_no ?? 'draft'}`}
        subtitle={`${party} · ${formatDate(quote.quote_date)} · valid until ${formatDate(quote.valid_until)}`}
        actions={<>
          <Button variant="secondary" icon={<Download className="h-4 w-4" />} onClick={() => void download()}>Download PDF</Button>
          {!readOnly ? (
            <Button icon={<Save className="h-4 w-4" />} loading={save.isPending} onClick={() => save.mutate()}>Save</Button>
          ) : null}
        </>} />

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <StatusBadge status={quote.status} />
        {quote.estimate ? (
          <Link to={`/estimates/${quote.estimate.id}`} className="text-sm text-brand-700 hover:underline">
            From estimate {quote.estimate.estimate_no}
          </Link>
        ) : null}
      </div>

      {frozen ? (
        <p className="mt-4 rounded-lg bg-stone-100 p-3 text-sm text-stone-700">
          This quotation is {quote.status}. It is the document the customer was given, so its lines no longer change.
          Raise a new quotation from the estimate if the price has to move.
        </p>
      ) : null}

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card title="What the customer is buying"
            actions={!readOnly ? (
              <Button variant="secondary" size="sm" icon={<Plus className="h-4 w-4" />} onClick={() => lines.append(EMPTY_LINE)}>Add line</Button>
            ) : undefined}>
            <div className="space-y-3">
              {lines.fields.map((field, i) => {
                const line = lineValues[i];
                const amount = line ? round2(Number(line.quantity) * Number(line.unit_price)) - Number(line.discount || 0) : 0;
                return (
                  <div key={field.id as string} className="grid grid-cols-2 items-end gap-3 rounded-lg border border-stone-200 p-3 sm:grid-cols-12">
                    <Select className="sm:col-span-3" label="Service" placeholder="None" disabled={readOnly}
                      options={toOptions(services.data ?? [], (s) => s.name)} {...form.register(`lines.${i}.service_id`)} />
                    <Input className="sm:col-span-4" label="Description" required disabled={readOnly} {...form.register(`lines.${i}.description`)} />
                    <Input className="sm:col-span-1" label="Qty" type="number" step="0.001" disabled={readOnly} {...form.register(`lines.${i}.quantity`)} />
                    <Input className="sm:col-span-2" label="Unit price" type="number" step="0.01" disabled={readOnly} {...form.register(`lines.${i}.unit_price`)} />
                    <Input className="sm:col-span-1" label="Discount" type="number" step="0.01" disabled={readOnly} {...form.register(`lines.${i}.discount`)} />
                    <div className="flex items-center justify-between gap-2 sm:col-span-1">
                      <span className="text-sm font-medium tabular-nums">{formatGHS(amount)}</span>
                      {!readOnly && lines.fields.length > 1 ? (
                        <Button variant="ghost" size="sm" aria-label={`Remove line ${i + 1}`} onClick={() => lines.remove(i)}><Trash2 className="h-4 w-4" /></Button>
                      ) : null}
                    </div>
                    <div className="sm:col-span-12">
                      <Checkbox label="Tax applies to this line" disabled={readOnly} {...form.register(`lines.${i}.taxable`)} />
                    </div>
                  </div>
                );
              })}
            </div>
          </Card>

          <Card title="Payment terms"
            actions={!readOnly ? (
              <Button variant="ghost" size="sm" onClick={() => setCustomTerms((v) => !v)}>
                {customTerms ? 'Choose from the list' : 'Write my own'}
              </Button>
            ) : undefined}>
            {customTerms ? (
              <Textarea label="Payment terms as the customer will read them" rows={2} disabled={readOnly}
                {...form.register('payment_terms')} />
            ) : (
              <Select label="Payment terms" disabled={readOnly} placeholder="Choose…"
                options={(termOptions.data ?? []).map((o) => ({ value: o.label, label: o.label }))}
                hint="Maintained under Settings · Configuration" {...form.register('payment_terms')} />
            )}
            <p className="mt-3 text-xs text-stone-500">
              This wording prints on the quotation and carries through to the invoice. The default comes from
              Configuration; a staged job can be agreed differently here.
            </p>
          </Card>
        </div>

        <div className="space-y-4">
          <Card title="Totals">
            <dl className="space-y-1.5 text-sm">
              <div className="flex justify-between"><dt className="text-stone-600">Subtotal</dt><dd className="tabular-nums">{formatGHS(preview.subtotal)}</dd></div>
              {preview.discount ? (
                <div className="flex justify-between"><dt className="text-stone-600">Discount</dt><dd className="tabular-nums">-{formatGHS(preview.discount)}</dd></div>
              ) : null}
              <div className="flex justify-between"><dt className="text-stone-600">Taxable amount</dt><dd className="tabular-nums">{formatGHS(preview.taxableBase)}</dd></div>
              {preview.taxRows.map((t) => (
                <div key={t.id} className="flex justify-between">
                  <dt className="text-stone-600">{t.name} ({t.rate}%)</dt>
                  <dd className="tabular-nums">{formatGHS(t.amount)}</dd>
                </div>
              ))}
              <div className="flex justify-between border-t border-stone-200 pt-1.5 text-base font-semibold">
                <dt>Total</dt><dd className="tabular-nums">{formatGHS(preview.total)}</dd>
              </div>
            </dl>

            {!preview.taxRows.length ? (
              <p className="mt-3 rounded-lg bg-amber-50 p-2.5 text-xs text-amber-900">
                No tax is active. A Super Admin sets the current rates in Settings · Taxes; until then quotations carry no tax.
              </p>
            ) : null}

            <p className="mt-3 text-xs text-stone-500">
              A preview. The database recalculates every total and tax row when you save, which is what keeps the
              quotation and the invoice in step.
            </p>
          </Card>

          <Card title="Saved figures">
            <dl className="space-y-1.5 text-sm">
              <div className="flex justify-between"><dt className="text-stone-600">Net</dt><dd className="tabular-nums">{formatGHS(Number(quote.amount))}</dd></div>
              {(quote.quotation_taxes ?? []).map((t) => (
                <div key={t.id} className="flex justify-between">
                  <dt className="text-stone-600">{t.name} ({Number(t.rate)}%)</dt>
                  <dd className="tabular-nums">{formatGHS(Number(t.amount))}</dd>
                </div>
              ))}
              <div className="flex justify-between border-t border-stone-200 pt-1.5 font-semibold">
                <dt>Total</dt><dd className="tabular-nums">{formatGHS(Number(quote.total))}</dd>
              </div>
            </dl>
          </Card>
        </div>
      </div>
    </div>
  );
}
