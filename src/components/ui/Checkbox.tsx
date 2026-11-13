import { forwardRef, type InputHTMLAttributes } from 'react';

export interface CheckboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
  label: string;
  hint?: string;
}

export const Checkbox = forwardRef<HTMLInputElement, CheckboxProps>(function Checkbox({ label, hint, id, ...rest }, ref) {
  const inputId = id ?? (rest.name ? `c-${rest.name}` : undefined);
  return (
    <label htmlFor={inputId} className="flex min-h-[40px] cursor-pointer items-start gap-2 py-1 text-sm text-stone-700">
      <input ref={ref} id={inputId} type="checkbox" className="mt-0.5 h-5 w-5 rounded border-stone-300 text-brand-600 focus:ring-brand-500" {...rest} />
      <span>{label}{hint ? <span className="block text-xs text-stone-500">{hint}</span> : null}</span>
    </label>
  );
});
