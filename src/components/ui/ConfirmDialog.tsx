import { useState, type ReactNode } from 'react';
import { Modal } from './Modal';
import { Button } from './Button';
import { Textarea } from './Textarea';

/** Confirmation before approve, complete, cancel and post actions. Optionally asks for a reason. */
export function ConfirmDialog({ open, onClose, onConfirm, title, message, confirmLabel = 'Confirm', danger, reasonLabel, loading, children }: {
  open: boolean; onClose: () => void; onConfirm: (reason: string) => void | Promise<void>; title: string; message?: ReactNode;
  confirmLabel?: string; danger?: boolean; reasonLabel?: string; loading?: boolean; children?: ReactNode;
}) {
  const [reason, setReason] = useState('');
  const needsReason = !!reasonLabel;
  return (
    <Modal open={open} onClose={onClose} title={title} size="sm" footer={<>
      <Button variant="secondary" onClick={onClose}>Back</Button>
      <Button variant={danger ? 'danger' : 'primary'} loading={loading} disabled={needsReason && !reason.trim()}
        onClick={async () => { await onConfirm(reason.trim()); setReason(''); }}>{confirmLabel}</Button>
    </>}>
      {message ? <div className="text-sm text-stone-700">{message}</div> : null}
      {children}
      {needsReason ? <Textarea className="mt-3" label={reasonLabel} required value={reason} onChange={(e) => setReason(e.target.value)} /> : null}
    </Modal>
  );
}
