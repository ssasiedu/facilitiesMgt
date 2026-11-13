import { useForm, type FieldValues } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';
import { rpc, useAction } from '@/lib/rpc';
import { truckStatusSchema, OFF_ROAD_REASONS } from '@/lib/schemas';
import { isoDate } from '@/lib/format';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select, enumOptions } from '@/components/ui/Select';
import { Textarea } from '@/components/ui/Textarea';

interface StatusForm { status: 'on_road' | 'off_road'; reason: string; expected_return: string; note: string }

/**
 * Change a truck's status (spec 4.5). Off-Road needs a reason, an expected return date and a note;
 * the database flags any future job orders that lose this truck and notifies their officers.
 */
export function TruckStatusModal({ truck, onClose }: { truck: { id: string; registration_no: string; status: string }; onClose: () => void }) {
  const form = useForm<FieldValues>({
    resolver: zodResolver(truckStatusSchema),
    defaultValues: {
      status: truck.status === 'off_road' ? 'on_road' : 'off_road',
      reason: '', expected_return: isoDate(), note: '',
    } as unknown as FieldValues,
  });
  const values = form.watch() as StatusForm;

  const change = useAction((v: StatusForm) => rpc<{ flagged: number }>('set_truck_status', {
    p_truck_id: truck.id,
    p_status: v.status,
    p_reason: v.status === 'off_road' ? v.reason : undefined,
    p_expected_return: v.status === 'off_road' ? v.expected_return : undefined,
    p_note: v.note || undefined,
  }), {
    invalidate: [['table', 'trucks'], ['lookup', 'trucks'], ['truck', truck.id]],
    onSuccess: (res) => {
      const flagged = Number(res?.flagged ?? 0);
      toast.success(flagged > 0
        ? `Status changed. ${flagged} future job order(s) flagged for reassignment and their officers notified.`
        : 'Status changed.');
      onClose();
    },
  });

  const submit = form.handleSubmit((v) => change.mutate(v as StatusForm));

  return (
    <Modal open onClose={onClose} title={`${truck.registration_no} — change status`} size="sm"
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button loading={change.isPending} onClick={submit}>Save status</Button></>}>
      <div className="space-y-4">
        <Select label="New status" required options={[
          { value: 'on_road', label: 'On-Road (available for jobs)' },
          { value: 'off_road', label: 'Off-Road (not available)' },
        ]} {...form.register('status')} />

        {values.status === 'off_road' ? <>
          <Select label="Reason" required options={enumOptions(OFF_ROAD_REASONS)} placeholder="Choose…"
            error={form.formState.errors.reason?.message as string | undefined} {...form.register('reason')} />
          <Input label="Expected return date" type="date" required
            error={form.formState.errors.expected_return?.message as string | undefined} {...form.register('expected_return')} />
          <Textarea label="Note" required error={form.formState.errors.note?.message as string | undefined}
            placeholder="What happened and what is being done" {...form.register('note')} />
          <p className="flex items-start gap-2 rounded-lg bg-amber-50 p-3 text-xs text-amber-900">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            Any job order already booked on this truck for a future date will be flagged, and the officer in charge
            notified so they can assign another truck.
          </p>
        </> : (
          <Textarea label="Note (optional)" placeholder="e.g. repairs finished" {...form.register('note')} />
        )}

        {truck.status === 'on_job' ? (
          <p className="rounded-lg bg-stone-100 p-3 text-xs text-stone-700">
            This truck is On Job right now. It returns to On-Road by itself when the job is completed.
          </p>
        ) : null}
      </div>
    </Modal>
  );
}
