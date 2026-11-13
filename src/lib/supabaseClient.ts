import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

/** True when .env is missing; the app shows a setup screen instead of failing. */
export const configMissing = !url || !anonKey;

// Only the public anon key is used in the browser. Row Level Security and the workflow functions
// decide what each signed-in user can read or change.
export const supabase = createClient(url || 'http://localhost:54321', anonKey || 'missing-anon-key', {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
  realtime: { params: { eventsPerSecond: 5 } },
});

export const functionsUrl = `${(url || '').replace(/\/$/, '')}/functions/v1`;
export const appName = import.meta.env.VITE_APP_NAME || 'FacilitiesManagement';
export const publicAppUrl = (import.meta.env.VITE_PUBLIC_APP_URL || window.location.origin).replace(/\/$/, '');
