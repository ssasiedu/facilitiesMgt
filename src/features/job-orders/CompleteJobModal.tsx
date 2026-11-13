import { useRef, useState } from 'react';
import { useFieldArray, useForm, type FieldValues } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Camera, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { completeJobSchema, type CompleteJobForm } from '@/lib/schemas';
import { formatGHS, humanize } from '@/lib/format';
import { uploadFile } from '@/lib/storage';
import { useAction } from '@/lib/rpc';
import { useCostItems, useEmployees, useStockLocations, toOptions } from '@/lib/lookups';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Textarea } from '@/components/ui/Textarea';
import { FileUpload } from '@/components/ui/FileUpload';
import { SignaturePad, type SignaturePadHandle } from '@/components/ui/SignaturePad';
import { addJobPhoto, completeJob, type JobOrderFull } from './api';

const ACTUAL_CATEGORIES = ['consumable', 'labour', 'vehicle', 'fuel', 'equipment', 'subcontract', 'other'] as const;

/**
 * Mark Completed (spec 4.4 step 6): after photos, the customer's sign-off and signature, and the
 * resources actually used, which feed actual costing. Completion recognises revenue in the database.
 */
export function CompleteJobModal({ job, open, onClose, onDone }: { job: JobOrderFull; open: boolean; onClose: () => void; onDone: () => void }) {
  const { data: costItems } = useCostItems();
  const { data: employees } = useEmployees();
  const { data: locations } = useStockLocations();
  const signature = useRef<SignaturePadHandle>(null);
  const [photos, setPhotos] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);

  const form = useForm<FieldValues>({
    resolver: zodResolver(completeJobSchema),
    defaultValues: { signoff_name: job.customer?.display_name ?? '', notes: '', actuals: [] } as unknown as FieldValues,
  });
  const actuals = useFieldArray({ control: form.control, name: 'actuals' });
  const values = form.watch() as CompleteJobForm;
  const totalCost = (values.actuals ?? []).reduce((t, a) => t + Number(a.quantity || 0) * Number(a.unit_cost || 0), 0);

  const complete = useAction(async (v: CompleteJobForm) => {
    let signaturePath: string | undefined;
    if (!signature.current?.isEmpty()) {
      const blob = await signature.current?.toBlob();
      if (blob) {
        const file = new File([blob], `signature-${job.job_no ?? job.id}.png`, { type: 'image/png' });
        const { path } = await uploadFile('job-photos', `${job.id}/signature`, file);
        signaturePath = path;
        await addJobPhoto(job.id, 'signature', path, `Signed by ${v.signoff_name}`);
      }
    }
    return completeJob(job.id, v, signaturePath);
  }, {
    success: 'Job completed. Revenue recognised and the customer has been notified.',
    onSuccess: () => { onDone(); onClose(); },
  });

  const addActual = () => actuals.append({ category: 'consumable', cost_item_id: '', description: '', quantity: 1, unit_cost: 0, stock_location_id: '' });

  /** Choosing a catalogue item copies its name and current cost into the line. */
  const pickItem = (index: number, itemId: string) => {
    const item = (costItems ?? []).find((c) => c.id === itemId);
    form.setValue(`actuals.${index}.cost_item_id`, itemId);
    if (item) {
      form.setValue(`actuals.${index}.description`, item.name);
      form.setValue(`actuals.${index}.unit_cost`, Number(item.category === 'vehicle' ? item.cost_per_trip : item.unit_cost));
      form.setValue(`actuals.${index}.category`, item.category === 'overhead' ? 'other' : item.category);
    }
  };

  const submit = form.handleSubmit((v) => complete.mutate(v as CompleteJobForm));

  return (
    <Modal open={open} onClose={onClose} title={`Complete job ${job.job_no ?? ''}`} size="xl"
      footer={<>
        <Button variant="secondary" onClick={onClose}>Back</Button>
        <Button variant="success" size="lg" loading={complete.isPending} onClick={submit}>Mark completed</Button>
      </>}>
      <div className="space-y-5">
        <section>
          <h3 className="mb-2 text-sm font-semibold text-stone-800">"After" photos</h3>
          <div className="flex flex-wrap items-center gap-2">
            <FileUpload bucket="job-photos" folder={`${job.id}/after`} label="Take or choose a photo" capture
              accept="image/jpeg,image/png" disabled={uploading}
              onUploaded={async (path) => {
                setUploading(true);
                try { await addJobPhoto(job.id, 'after', path); setPhotos((p) => [...p, path]); }
                catch (e) { toast.error((e as Error).message); } finally { setUploading(false); }
              }} />
            {photos.length ? <span className="text-sm text-stone-600">{photos.length} photo(s) added</span> : null}
          </div>
          {!photos.length && !job.job_order_photos.some((p) => p.kind === 'after') ? (
            <p className="mt-1 text-xs text-stone-500">Photos are optional but settle most disputes about work done.</p>
          ) : null}
        </section>

        <section className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Input label="Customer sign-off name" required error={form.formState.errors.signoff_name?.message as string | undefined}
            hint="Who at the site accepted the work" {...form.register('signoff_name')} />
          <Textarea label="Completion notes" {...form.register('notes')} />
          <div className="sm:col-span-2">
            <p className="mb-1 text-sm font-medium text-stone-700">Signature (optional)</p>
            <SignaturePad ref={signature} />
            <Button variant="ghost" size="sm" className="mt-1" onClick={() => signature.current?.clear()}>Clear signature</Button>
          </div>
        </section>

        <section>
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-stone-800">Resources actually used</h3>
            <Button variant="secondary" size="sm" icon={<Plus className="h-4 w-4" />} onClick={addActual}>Add</Button>
          </div>
          <p className="mb-2 text-xs text-stone-500">
            These feed the job's actual cost and the estimate-against-actual report. Consumables issued from a store also
            reduce stock. Labour and trips are recorded for costing; the ledger gets them when the wage or expense is paid.
          </p>
          {actuals.fields.length ? (
            <div className="space-y-2">
              {actuals.fields.map((field, i) => {
                const row = (values.actuals ?? [])[i];
                return (
                  <div key={field.id as string} className="grid grid-cols-2 items-end gap-2 rounded-lg border border-stone-200 p-2 sm:grid-cols-12">
                    <Select className="sm:col-span-2" label="Category" options={ACTUAL_CATEGORIES.map((c) => ({ value: c, label: humanize(c) }))}
                      {...form.register(`actuals.${i}.category`)} />
                    <Select className="sm:col-span-3" label="Catalogue item" options={toOptions(costItems, (c) => `${c.code} · ${c.name}`)} placeholder="Custom…"
                      value={row?.cost_item_id ?? ''} onChange={(e) => pickItem(i, e.target.value)} />
                    <Input className="sm:col-span-3" label="Description" {...form.register(`actuals.${i}.description`)} />
                    <Input className="sm:col-span-1" label="Qty" type="number" step="0.001" {...form.register(`actuals.${i}.quantity`)} />
                    <Input className="sm:col-span-2" label="Unit cost" type="number" step="0.01" {...form.register(`actuals.${i}.unit_cost`)} />
                    <div className="flex items-center justify-end sm:col-span-1">
                      <Button variant="ghost" size="sm" aria-label="Remove" onClick={() => actuals.remove(i)}><Trash2 className="h-4 w-4" /></Button>
                    </div>
                    {row?.category === 'consumable' ? (
                      <Select className="sm:col-span-4" label="Issued from store" options={toOptions(locations, (l) => l.name)} placeholder="Not from stock"
                        hint="Reduces stock when chosen" {...form.register(`actuals.${i}.stock_location_id`)} />
                    ) : null}
                    {row?.category === 'labour' ? (
                      <Select className="sm:col-span-4" label="Staff member" options={toOptions(employees, (e) => e.full_name)} placeholder="—"
                        {...form.register(`actuals.${i}.employee_id`)} />
                    ) : null}
                  </div>
                );
              })}
              <p className="text-right text-sm text-stone-700">Actual cost so far <span className="font-semibold tabular-nums">{formatGHS(totalCost)}</span></p>
            </div>
          ) : (
            <Button variant="secondary" size="sm" icon={<Camera className="h-4 w-4" />} onClick={addActual}>Record what was used</Button>
          )}
        </section>

        <p className="rounded-lg bg-stone-50 p-3 text-xs text-stone-600">
          On completion the database recognises the revenue, sets the invoice due date to today plus the customer's
          payment terms ({job.customer?.payment_terms_days ?? 0} days) and queues the "job completed, invoice due" message.
        </p>
      </div>
    </Modal>
  );
}
