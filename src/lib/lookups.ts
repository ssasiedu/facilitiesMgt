import { useQuery } from '@tanstack/react-query';
import { supabase } from './supabaseClient';
import { check } from './rpc';
import type { Tables } from '@/types/database';
import type { Option } from '@/components/ui/Select';

const LONG = 5 * 60_000;

function useList<T>(key: string, fn: () => Promise<T[]>, enabled = true) {
  return useQuery({ queryKey: ['lookup', key], queryFn: fn, staleTime: LONG, enabled });
}

export const useServices = (all = false) => useList<Tables<'services'>>(`services-${all}`, async () => {
  let q = supabase.from('services').select('*').is('archived_at', null).order('name');
  if (!all) q = q.eq('active', true);
  return check(await q) as Tables<'services'>[];
});
export const useCostItems = () => useList<Tables<'cost_items'>>('cost_items', async () => check(await supabase.from('cost_items').select('*').is('archived_at', null).eq('active', true).order('category').order('name')) as Tables<'cost_items'>[]);
export const useTrucks = () => useList<Tables<'trucks'>>('trucks', async () => check(await supabase.from('trucks').select('*').is('archived_at', null).order('registration_no')) as Tables<'trucks'>[]);
export const useEmployees = () => useList<Tables<'employees'>>('employees', async () => check(await supabase.from('employees').select('*').is('archived_at', null).order('full_name')) as Tables<'employees'>[]);
export const useZones = () => useList<Tables<'zones'>>('zones', async () => check(await supabase.from('zones').select('*').is('archived_at', null).order('name')) as Tables<'zones'>[]);
export const useTaskTypes = () => useList<Tables<'task_types'>>('task_types', async () => check(await supabase.from('task_types').select('*').eq('active', true).order('sort_order')) as Tables<'task_types'>[]);
export const useStockLocations = () => useList<Tables<'stock_locations'>>('stock_locations', async () => check(await supabase.from('stock_locations').select('*').is('archived_at', null).order('name')) as Tables<'stock_locations'>[]);
export const useAccounts = (enabled = true) => useList<Tables<'accounts'>>('accounts', async () => check(await supabase.from('accounts').select('*').eq('is_active', true).order('code')) as Tables<'accounts'>[], enabled);
export const useBankAccounts = (enabled = true) => useList<Tables<'bank_accounts'>>('bank_accounts', async () => check(await supabase.from('bank_accounts').select('*').eq('is_active', true).order('name')) as Tables<'bank_accounts'>[], enabled);
export const usePaymentMethods = () => useList<Tables<'payment_methods'>>('payment_methods', async () => check(await supabase.from('payment_methods').select('*').eq('active', true).order('sort_order')) as Tables<'payment_methods'>[]);
export const useSuppliers = (enabled = true) => useList<Tables<'suppliers'>>('suppliers', async () => check(await supabase.from('suppliers').select('*').is('archived_at', null).order('name')) as Tables<'suppliers'>[], enabled);
export const useEstimateTemplates = () => useList<Tables<'estimate_templates'>>('estimate_templates', async () => check(await supabase.from('estimate_templates').select('*').is('archived_at', null).eq('active', true).order('name')) as Tables<'estimate_templates'>[]);
export const useTaxRates = () => useList<Tables<'tax_rates'>>('tax_rates', async () => check(await supabase.from('tax_rates').select('*').order('sort_order')) as Tables<'tax_rates'>[]);
export const useTaskTypesAll = () => useList<Tables<'task_types'>>('task_types_all', async () => check(await supabase.from('task_types').select('*').order('sort_order')) as Tables<'task_types'>[]);

export interface StaffMember { id: string; full_name: string; phone: string | null; email: string | null; roles: string[] }
/** Staff profiles with their roles (for officer / supervisor pickers). */
export const useStaff = (role?: string) => useList<StaffMember>(`staff-${role ?? 'all'}`, async () => {
  const rows = check(await supabase.from('profiles').select('id, full_name, phone, email, is_active, user_roles(role_code)').eq('is_active', true).is('archived_at', null).order('full_name')) as
    { id: string; full_name: string; phone: string | null; email: string | null; user_roles: { role_code: string }[] }[];
  return rows.map((r) => ({ id: r.id, full_name: r.full_name, phone: r.phone, email: r.email, roles: r.user_roles.map((x) => x.role_code) }))
    .filter((r) => !role || r.roles.includes(role) || r.roles.includes('super_admin'));
});

export const toOptions = <T extends { id: string }>(rows: T[] | undefined, label: (r: T) => string): Option[] => (rows ?? []).map((r) => ({ value: r.id, label: label(r) }));

export interface ListOption { id: string; category: string; value: string; label: string; numeric_value: number | null; is_default: boolean; sort_order: number }

/** Dropdown values a Super Admin maintains under Settings (sector, payment terms, and so on). */
export function useListOptions(category: string) {
  return useQuery({
    queryKey: ['lookup', 'list_options', category],
    staleTime: 5 * 60_000,
    queryFn: async () => check(await supabase.from('list_options')
      .select('id, category, value, label, numeric_value, is_default, sort_order')
      .eq('category', category).is('archived_at', null)
      .order('sort_order').order('label')) as ListOption[],
  });
}

/** Payment terms carry their day count, which is what the due date is worked out from. */
export function usePaymentTerms() {
  const q = useListOptions('payment_terms');
  return {
    ...q,
    options: (q.data ?? []).map((o) => ({ value: String(o.numeric_value ?? 0), label: o.label })),
    defaultDays: (q.data ?? []).find((o) => o.is_default)?.numeric_value ?? 7,
  };
}
