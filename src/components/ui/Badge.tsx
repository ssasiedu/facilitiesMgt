import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

export type Tone = 'green' | 'blue' | 'amber' | 'red' | 'grey' | 'brand' | 'purple';

const tones: Record<Tone, string> = {
  green: 'bg-emerald-50 text-emerald-800 ring-emerald-600/20',
  blue: 'bg-blue-50 text-blue-800 ring-blue-600/20',
  amber: 'bg-amber-50 text-amber-800 ring-amber-600/25',
  red: 'bg-red-50 text-red-800 ring-red-600/20',
  grey: 'bg-stone-100 text-stone-700 ring-stone-500/20',
  brand: 'bg-brand-50 text-brand-700 ring-brand-600/20',
  purple: 'bg-violet-50 text-violet-800 ring-violet-600/20',
};

export function Badge({ tone = 'grey', children, className }: { tone?: Tone; children: ReactNode; className?: string }) {
  return <span className={cn('inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset', tones[tone], className)}>{children}</span>;
}
