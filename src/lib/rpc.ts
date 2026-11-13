import { useMutation, useQueryClient, type QueryKey } from '@tanstack/react-query';
import { toast } from 'sonner';
import { supabase } from './supabaseClient';
import type { RpcArgs, RpcName } from '@/types/database';

/** Make Postgres/PostgREST errors readable for users. */
export function friendlyError(e: unknown): string {
  const err = e as { message?: string; code?: string; details?: string };
  const msg = err?.message ?? String(e);
  if (err?.code === '42501' || /permission denied|row-level security/i.test(msg)) return msg.startsWith('Permission denied') || msg.startsWith('Segregation') ? msg : 'You do not have permission to do that.';
  if (err?.code === '23505') return 'This record already exists (duplicate value).';
  if (err?.code === '23P01') return msg.includes('book') ? msg : 'That truck or staff member is already booked for those dates.';
  if (err?.code === '23514') return `A value is not allowed: ${err.details ?? msg}`;
  if (/Failed to fetch|NetworkError/i.test(msg)) return 'No connection. Check your internet and try again.';
  return msg;
}

/** Call a workflow function. Business rules run in Postgres; the browser only asks. */
export async function rpc<T = unknown, N extends RpcName = RpcName>(fn: N, args?: RpcArgs<N>): Promise<T> {
  const { data, error } = await supabase.rpc(fn as string, (args ?? {}) as Record<string, unknown>);
  if (error) throw new Error(friendlyError(error));
  return data as T;
}

/** Throw a friendly error from a PostgREST result. */
export function check<T>(res: { data: T; error: unknown }): T {
  if (res.error) throw new Error(friendlyError(res.error));
  return res.data;
}

export function useAction<TVars, TResult = unknown>(fn: (v: TVars) => Promise<TResult>, opts: { success?: string | ((r: TResult) => string); invalidate?: QueryKey[]; onSuccess?: (r: TResult) => void } = {}) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: (r) => {
      if (opts.success) toast.success(typeof opts.success === 'function' ? opts.success(r) : opts.success);
      opts.invalidate?.forEach((k) => qc.invalidateQueries({ queryKey: k }));
      opts.onSuccess?.(r);
    },
    onError: (e) => toast.error((e as Error).message),
  });
}

/** Replace empty strings with null before sending a form to the database. */
export function nullify<T extends Record<string, unknown>>(obj: T): T {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) out[k] = v === '' ? null : v;
  return out as T;
}
