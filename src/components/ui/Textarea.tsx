import { forwardRef, type TextareaHTMLAttributes } from 'react';
import { cn } from '@/lib/cn';
import { Field, inputClass } from './Field';

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
  error?: string;
  hint?: string;
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea({ label, error, hint, required, id, className, rows = 3, ...rest }, ref) {
  const inputId = id ?? (rest.name ? `f-${rest.name}` : undefined);
  return (
    <Field label={label} htmlFor={inputId} required={required} error={error} hint={hint} className={className}>
      <textarea ref={ref} id={inputId} rows={rows} aria-invalid={!!error} className={cn(inputClass, 'py-2')} {...rest} />
    </Field>
  );
});
