import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

/** Label + control + inline error. Required fields get a red asterisk. */
export function Field({ label, htmlFor, required, error, hint, className, children }: {
  label?: string; htmlFor?: string; required?: boolean; error?: string; hint?: string; className?: string; children: ReactNode;
}) {
  return (
    <div className={cn('flex flex-col gap-1', className)}>
      {label ? (
        <label htmlFor={htmlFor} className="text-sm font-medium text-stone-700">
          {label}{required ? <span className="ml-0.5 text-red-600" aria-hidden>*</span> : null}
        </label>
      ) : null}
      {children}
      {error ? <p role="alert" className="text-xs text-red-600">{error}</p> : hint ? <p className="text-xs text-stone-500">{hint}</p> : null}
    </div>
  );
}

export const inputClass = 'w-full rounded-lg border border-stone-300 bg-white px-3 text-sm text-stone-900 placeholder:text-stone-400 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/30 disabled:bg-stone-100 aria-[invalid=true]:border-red-500';
