import type { CompanyInfo } from './PdfKit';
import type { CompanySettings } from '../settings';

export function companyFromSettings(s: CompanySettings): CompanyInfo {
  return {
    name: s.company_name, logo_url: s.logo_url, address: s.address, digital_address: s.digital_address, tin: s.tin, phones: s.phones, email: s.email,
    website: s.website, bank_details: s.bank_details, momo_details: s.momo_details, invoice_terms: s.invoice_terms, invoice_footer: s.invoice_footer, brand_color: s.brand_color,
  };
}
