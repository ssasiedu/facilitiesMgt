// Service-role Supabase client. Only ever used inside Edge Functions; the key never reaches the browser.
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2.46.1";

let client: SupabaseClient | null = null;

export function adminClient(): SupabaseClient {
  if (client) return client;
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be available to the function");
  client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  return client;
}

export interface CompanySettings {
  company_name: string;
  logo_url: string | null;
  address: string | null;
  digital_address: string | null;
  tin: string | null;
  phones: string | null;
  email: string | null;
  website: string | null;
  bank_details: string | null;
  momo_details: string | null;
  invoice_terms: string | null;
  invoice_footer: string | null;
  brand_color: string;
  sms_sender_id: string;
  sms_provider: "hubtel" | "arkesel" | "mnotify";
  email_provider: "resend" | "smtp";
  payment_provider: "paystack" | "hubtel";
  online_payments_enabled: boolean;
  public_app_url: string;
}

export async function getSettings(): Promise<CompanySettings> {
  const { data, error } = await adminClient().from("company_settings").select("*").eq("id", 1).single();
  if (error) throw new Error(`Could not load company settings: ${error.message}`);
  return data as CompanySettings;
}

export function publicCompany(s: CompanySettings) {
  return {
    name: s.company_name, logo_url: s.logo_url, address: s.address, digital_address: s.digital_address, tin: s.tin,
    phones: s.phones, email: s.email, website: s.website, bank_details: s.bank_details, momo_details: s.momo_details,
    invoice_terms: s.invoice_terms, invoice_footer: s.invoice_footer, brand_color: s.brand_color,
  };
}
