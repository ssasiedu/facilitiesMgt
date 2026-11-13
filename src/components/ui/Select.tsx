import { forwardRef, type SelectHTMLAttributes } from 'react';
import { cn } from '@/lib/cn';
import { Field, inputClass } from './Field';

export interface Option { value: string; label: string; disabled?: boolean }

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
  error?: string;
  hint?: string;
  options: Option[];
  placeholder?: string;
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select({ label, error, hint, required, id, className, options, placeholder, ...rest }, ref) {
  const inputId = id ?? (rest.name ? `f-${rest.name}` : undefined);
  return (
    <Field label={label} htmlFor={inputId} required={required} error={error} hint={hint} className={className}>
      <select ref={ref} id={inputId} aria-invalid={!!error} className={cn(inputClass, 'h-10 pr-8')} {...rest}>
        {placeholder !== undefined ? <option value="">{placeholder}</option> : null}
        {options.map((o) => <option key={o.value} value={o.value} disabled={o.disabled}>{o.label}</option>)}
      </select>
    </Field>
  );
});

/** Build select options from an enum-like list of snake_case values. */
export function enumOptions(values: readonly string[]): Option[] {
  return values.map((v) => ({ value: v, label: v.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase()) }));
}
