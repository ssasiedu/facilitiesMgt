import { createContext, useContext, useEffect, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from './supabaseClient';
import { applyBrandColor } from './theme';
import { useAuth } from './auth';
import type { Tables } from '@/types/database';

export type CompanySettings = Tables<'company_settings'>;

const SettingsContext = createContext<CompanySettings | null>(null);

export function SettingsProvider({ children }: { children: ReactNode }) {
  const { session } = useAuth();
  const { data } = useQuery({
    queryKey: ['company_settings'],
    enabled: !!session,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.from('company_settings').select('*').eq('id', 1).single();
      if (error) throw error;
      return data as CompanySettings;
    },
  });
  useEffect(() => { applyBrandColor(data?.brand_color); }, [data?.brand_color]);
  return <SettingsContext.Provider value={data ?? null}>{children}</SettingsContext.Provider>;
}

export function useSettings(): CompanySettings | null {
  return useContext(SettingsContext);
}
