import { supabase } from './supabaseClient';

/**
 * Call an Edge Function as the signed-in user, and surface the reason it refused.
 *
 * supabase-js reports every non-2xx as the same opaque "Edge Function returned a non-2xx status
 * code" and hands the actual Response back on error.context. Our functions always answer with
 * { error: "..." }, and that sentence is the whole value of the message — "Invoice INV-00042 only
 * owes GH₵ 300.00" tells someone what to do, where the generic text tells them nothing.
 */
export async function callFunction<T>(
  name: string,
  init: { method?: 'POST'; body?: unknown } = {},
): Promise<T> {
  const { data, error } = await supabase.functions.invoke(name, { body: init.body });
  if (!error) return data as T;

  let message = error.message;
  const ctx: unknown = (error as { context?: unknown }).context;
  let raw = '';

  if (typeof Response !== 'undefined' && ctx instanceof Response) {
    raw = await ctx.clone().text().catch(() => '');
    if (!raw) message = `${message} (HTTP ${ctx.status})`;
  } else if (typeof ctx === 'string') {
    raw = ctx;
  } else if (ctx && typeof ctx === 'object' && typeof (ctx as { body?: unknown }).body === 'string') {
    raw = (ctx as { body: string }).body;
  }

  if (raw) {
    try { message = (JSON.parse(raw) as { error?: string }).error ?? raw; } catch { message = raw; }
  }

  throw new Error(message);
}
