import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabaseClient';
import { friendlyError, nullify } from '@/lib/rpc';
import { useSettings } from '@/lib/settings';
import { applyBrandColor } from '@/lib/theme';
import { companySettingsSchema, type CompanySettingsValues } from '@/lib/schemas';
import { safeName } from '@/lib/storage';
import { PageHeader } from '@/components/ui/PageHeader';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Textarea } from '@/components/ui/Textarea';
import { Checkbox } from '@/components/ui/Checkbox';
import { Spinner } from '@/components/ui/Spinner';
import { SettingsTabs } from './SettingsTabs';

/** Company profile: what appears on every quotation, invoice, receipt and SMS (spec 4.14). */
export default function CompanySettingsPage() {
  const settings = useSettings();
  const qc = useQueryClient();
  const [logoBusy, setLogoBusy] = useState(false);

  const form = useForm<CompanySettingsValues>({
    resolver: zodResolver(companySettingsSchema),
    defaultValues: {
      company_name: '', trading_name: '', address: '', digital_address: '', tin: '', phones: '', email: '', website: '',
      bank_details: '', momo_details: '', payment_details_sms: '', invoice_terms: '', invoice_footer: '',
      brand_color: '#15803d', sms_sender_id: '', public_app_url: '', default_payment_terms_days: 30,
    },
  });

  useEffect(() => {
    if (!settings) return;
    form.reset({
      company_name: settings.company_name,
      trading_name: settings.trading_name ?? '',
      address: settings.address ?? '',
      digital_address: settings.digital_address ?? '',
      tin: settings.tin ?? '',
      phones: settings.phones ?? '',
      email: settings.email ?? '',
      website: settings.website ?? '',
      bank_details: settings.bank_details ?? '',
      momo_details: settings.momo_details ?? '',
      payment_details_sms: settings.payment_details_sms,
      invoice_terms: settings.invoice_terms ?? '',
      invoice_footer: settings.invoice_footer ?? '',
      brand_color: settings.brand_color,
      sms_sender_id: settings.sms_sender_id,
      public_app_url: settings.public_app_url,
      default_payment_terms_days: settings.default_payment_terms_days,
    });
  }, [settings, form]);

  const brand = form.watch('brand_color');
  useEffect(() => { if (/^#[0-9a-fA-F]{6}$/.test(brand)) applyBrandColor(brand); }, [brand]);

  const save = form.handleSubmit(async (values) => {
    const { error } = await supabase.from('company_settings').update(nullify(values)).eq('id', 1);
    if (error) { toast.error(friendlyError(error)); return; }
    toast.success('Company profile saved');
    await qc.invalidateQueries({ queryKey: ['company_settings'] });
  });

  const uploadLogo = async (file: File) => {
    if (file.size > 2 * 1024 * 1024) { toast.error('The logo must be 2 MB or smaller'); return; }
    setLogoBusy(true);
    try {
      // 'branding' is the one public bucket, so the logo can be embedded in emails and PDFs.
      const path = `logo-${Date.now()}-${safeName(file.name)}`;
      const up = await supabase.storage.from('branding').upload(path, file, { contentType: file.type, upsert: true });
      if (up.error) throw up.error;
      const url = supabase.storage.from('branding').getPublicUrl(path).data.publicUrl;
      const { error } = await supabase.from('company_settings').update({ logo_url: url }).eq('id', 1);
      if (error) throw error;
      toast.success('Logo updated');
      await qc.invalidateQueries({ queryKey: ['company_settings'] });
    } catch (e) {
      toast.error(friendlyError(e));
    } finally { setLogoBusy(false); }
  };

  if (!settings) return <Spinner />;

  return (
    <div>
      <PageHeader title="Settings" subtitle="Your company details, as they appear on documents and messages" />
      <SettingsTabs />

      <form onSubmit={(e) => { e.preventDefault(); void save(); }} className="mt-4 space-y-4">
        <Card title="Identity">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <Input label="Registered name" required {...form.register('company_name')} error={form.formState.errors.company_name?.message} />
            <Input label="Trading name" {...form.register('trading_name')} hint="Shown on documents when it differs from the registered name" />
            <Input label="TIN" {...form.register('tin')} placeholder="C0001234567" />
            <Input label="GhanaPost GPS" {...form.register('digital_address')} placeholder="GA-123-4567"
              error={form.formState.errors.digital_address?.message} />
            <Textarea label="Postal address" className="md:col-span-2" rows={2} {...form.register('address')} />
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-4 border-t border-stone-100 pt-4">
            {settings.logo_url ? (
              <img src={settings.logo_url} alt="Company logo" className="h-16 w-auto rounded-lg border border-stone-200 bg-white p-1" />
            ) : (
              <div className="flex h-16 w-28 items-center justify-center rounded-lg border border-dashed border-stone-300 text-xs text-stone-500">No logo</div>
            )}
            <div>
              <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm font-medium hover:bg-stone-50">
                <input type="file" accept="image/png,image/jpeg,image/svg+xml" className="sr-only"
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) void uploadLogo(f); }} />
                {logoBusy ? 'Uploading…' : settings.logo_url ? 'Replace logo' : 'Upload logo'}
              </label>
              <p className="mt-1 text-xs text-stone-500">PNG, JPG or SVG. It appears on quotations, invoices and receipts.</p>
            </div>
          </div>
        </Card>

        <Card title="How customers reach you">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <Input label="Phone numbers" {...form.register('phones')} hint="Separate several with a comma" placeholder="0302 123 456, 024 123 4567" />
            <Input label="Email" type="email" {...form.register('email')} error={form.formState.errors.email?.message} />
            <Input label="Website" {...form.register('website')} placeholder="https://" />
            <Input label="Public app address" {...form.register('public_app_url')}
              hint="Used to build quotation, survey and statement links sent to customers"
              error={form.formState.errors.public_app_url?.message} />
          </div>
        </Card>

        <Card title="Payment details">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <Textarea label="Bank details" rows={3} {...form.register('bank_details')}
              hint="Printed at the bottom of invoices" placeholder={'Bank: …\nAccount name: …\nAccount number: …\nBranch: …'} />
            <Textarea label="Mobile money details" rows={3} {...form.register('momo_details')}
              placeholder={'MTN MoMo: 024 … (Merchant name)\nTelecel Cash: …'} />
            <Textarea label="Payment line for SMS" className="md:col-span-2" rows={2} required
              {...form.register('payment_details_sms')} error={form.formState.errors.payment_details_sms?.message}
              hint="Kept short, because it is added to invoice and reminder text messages" />
          </div>
        </Card>

        <Card title="Document wording">
          <div className="grid grid-cols-1 gap-4">
            <Input label="Default payment terms (days)" type="number" min={0} max={365}
              {...form.register('default_payment_terms_days', { valueAsNumber: true })}
              error={form.formState.errors.default_payment_terms_days?.message}
              hint="Invoice due dates are worked out from this unless the customer has their own terms" />
            <Textarea label="Invoice terms" rows={3} {...form.register('invoice_terms')}
              placeholder="Payment due within 30 days. Cheques payable to …" />
            <Textarea label="Document footer" rows={2} {...form.register('invoice_footer')}
              placeholder="Thank you for your business." />
          </div>
        </Card>

        <Card title="Branding and sender">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div>
              <label htmlFor="brand_color" className="mb-1 block text-sm font-medium text-stone-700">Brand colour</label>
              <div className="flex items-center gap-3">
                <input id="brand_color" type="color" className="h-10 w-16 cursor-pointer rounded border border-stone-300"
                  value={/^#[0-9a-fA-F]{6}$/.test(brand) ? brand : '#15803d'}
                  onChange={(e) => form.setValue('brand_color', e.target.value, { shouldDirty: true })} />
                <Input aria-label="Brand colour hex" className="w-32" {...form.register('brand_color')} />
              </div>
              {form.formState.errors.brand_color ? (
                <p className="mt-1 text-xs text-red-600">{form.formState.errors.brand_color.message}</p>
              ) : <p className="mt-1 text-xs text-stone-500">Buttons, links and document headings follow this colour.</p>}
            </div>
            <Input label="SMS sender ID" {...form.register('sms_sender_id')} maxLength={11}
              error={form.formState.errors.sms_sender_id?.message}
              hint="Up to 11 characters, registered with your SMS provider" />
          </div>
          <div className="mt-4 rounded-lg border border-stone-200 p-3">
            <p className="text-sm font-medium text-stone-800">Preview</p>
            <div className="mt-2 flex flex-wrap items-center gap-3">
              <Button type="button" size="sm">Primary button</Button>
              <span className="text-brand-700">Link colour</span>
              <span className="rounded px-2 py-1 text-xs font-semibold text-white" style={{ backgroundColor: /^#[0-9a-fA-F]{6}$/.test(brand) ? brand : '#15803d' }}>
                {form.watch('sms_sender_id') || 'SENDER'}
              </span>
            </div>
          </div>
        </Card>

        <Card title="Data protection">
          <Checkbox label="Customers have been told how their data is used" checked disabled
            hint="Consent is recorded per customer when you add them. Act 843 (2012) requires a lawful basis for holding personal data; marketing messages only go to customers who agreed to them." />
          <p className="mt-2 text-xs text-stone-500">
            Consent, the date it was given and who recorded it are stored on each customer record and shown on their profile.
          </p>
        </Card>

        <div className="sticky bottom-0 -mx-4 flex justify-end gap-2 border-t border-stone-200 bg-white/95 px-4 py-3 backdrop-blur">
          <Button type="button" variant="secondary" onClick={() => form.reset()} disabled={!form.formState.isDirty}>Undo changes</Button>
          <Button type="submit" loading={form.formState.isSubmitting} disabled={!form.formState.isDirty}>Save</Button>
        </div>
      </form>
    </div>
  );
}
