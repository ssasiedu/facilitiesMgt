import { formatGHS } from '@/lib/format';
import { cn } from '@/lib/cn';

export function Money({ value, className, colored }: { value: number | string | null | undefined; className?: string; colored?: boolean }) {
  const n = Number(value ?? 0);
  return <span className={cn('tabular-nums', colored && n < 0 && 'text-red-700', className)}>{formatGHS(n)}</span>;
}
