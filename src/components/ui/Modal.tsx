import { useEffect, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { cn } from '@/lib/cn';

/** Things a person can tab to, ignoring anything disabled or deliberately skipped. */
const FOCUSABLE = 'input:not([type="hidden"]):not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])';

export function Modal({ open, onClose, title, children, footer, size = 'md' }: {
  open: boolean; onClose: () => void; title: string; children: ReactNode; footer?: ReactNode; size?: 'sm' | 'md' | 'lg' | 'xl';
}) {
  const dialog = useRef<HTMLDivElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const returnTo = useRef<HTMLElement | null>(null);

  /* Escape closes the dialog. The handler is read from a ref so that a parent passing an inline
     onClose — which almost every caller does — does not re-subscribe the listener on each render. */
  const close = useRef(onClose);
  useEffect(() => { close.current = onClose; });

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close.current(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  /* Move the focus into the dialog once, as it opens, and put it back where it was on close.
     This deliberately depends on `open` alone: when it also depended on onClose it ran again on
     every keystroke, and each run dragged the focus back out of the field being typed in. */
  useEffect(() => {
    if (!open) return;
    returnTo.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    // The first field in the body, not the close button in the header, which comes first in the markup.
    const target = body.current?.querySelector<HTMLElement>(FOCUSABLE) ?? dialog.current?.querySelector<HTMLElement>(FOCUSABLE);
    target?.focus();
    return () => returnTo.current?.focus();
  }, [open]);

  if (!open) return null;
  const width = { sm: 'max-w-md', md: 'max-w-xl', lg: 'max-w-3xl', xl: 'max-w-5xl' }[size];
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-stone-900/40 p-0 sm:items-center sm:p-4" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div ref={dialog} role="dialog" aria-modal="true" aria-label={title} className={cn('flex max-h-[92vh] w-full flex-col rounded-t-2xl bg-white shadow-xl sm:rounded-2xl', width)}>
        <div className="flex items-center justify-between border-b border-stone-200 px-5 py-3">
          <h2 className="text-base font-semibold">{title}</h2>
          <button type="button" onClick={onClose} className="rounded-lg p-2 text-stone-500 hover:bg-stone-100" aria-label="Close"><X className="h-5 w-5" /></button>
        </div>
        <div ref={body} className="overflow-y-auto px-5 py-4">{children}</div>
        {footer ? <div className="flex flex-wrap justify-end gap-2 border-t border-stone-200 px-5 py-3">{footer}</div> : null}
      </div>
    </div>
  );
}
