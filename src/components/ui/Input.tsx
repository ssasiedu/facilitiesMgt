import { forwardRef, type InputHTMLAttributes } from 'react';
import { cn } from '@/lib/cn';
import { Field, inputClass } from './Field';

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  hint?: string;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input({ label, error, hint, required, id, className, ...rest }, ref) {
  const inputId = id ?? (rest.name ? `f-${rest.name}` : undefined);
  return (
    <Field label={label} htmlFor={inputId} required={required} error={error} hint={hint} className={className}>
      <input ref={ref} id={inputId} aria-invalid={!!error} aria-required={required} className={cn(inputClass, 'h-10')} {...rest} />
    </Field>
  );
});
