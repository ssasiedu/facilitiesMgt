import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Session, User } from '@supabase/supabase-js';
import { supabase } from './supabaseClient';
import type { Role } from './permissions';
import { hasAny } from './permissions';
import type { Tables } from '@/types/database';

export type Profile = Tables<'profiles'>;

interface AuthState {
  session: Session | null;
  user: User | null;
  profile: Profile | null;
  roles: Role[];
  zoneIds: string[];
  loading: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  refresh: () => Promise<void>;
  is: (...roles: Role[]) => boolean;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [roles, setRoles] = useState<Role[]>([]);
  const [zoneIds, setZoneIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  const loadProfile = useCallback(async (s: Session | null) => {
    if (!s) { setProfile(null); setRoles([]); setZoneIds([]); return; }
    const { data: p } = await supabase.from('profiles').select('*').eq('user_id', s.user.id).maybeSingle();
    setProfile((p as Profile) ?? null);
    if (p) {
      const [{ data: r }, { data: z }] = await Promise.all([
        supabase.from('user_roles').select('role_code').eq('profile_id', p.id),
        supabase.from('user_zones').select('zone_id').eq('profile_id', p.id),
      ]);
      setRoles(((r ?? []) as { role_code: Role }[]).map((x) => x.role_code));
      setZoneIds(((z ?? []) as { zone_id: string }[]).map((x) => x.zone_id));
    } else {
      setRoles([]); setZoneIds([]);
    }
  }, []);

  useEffect(() => {
    let active = true;
    supabase.auth.getSession().then(async ({ data }) => {
      if (!active) return;
      setSession(data.session);
      await loadProfile(data.session);
      setLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s);
      // defer DB calls out of the auth callback (recommended by supabase-js)
      setTimeout(() => { void loadProfile(s); }, 0);
    });
    return () => { active = false; sub.subscription.unsubscribe(); };
  }, [loadProfile]);

  const value = useMemo<AuthState>(() => ({
    session, user: session?.user ?? null, profile, roles, zoneIds, loading,
    signIn: async (email, password) => {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw new Error(error.message === 'Invalid login credentials' ? 'Wrong email or password' : error.message);
    },
    signOut: async () => { await supabase.auth.signOut(); },
    refresh: async () => { await loadProfile(session); },
    is: (...r: Role[]) => hasAny(roles, ...r),
  }), [session, profile, roles, zoneIds, loading, loadProfile]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
