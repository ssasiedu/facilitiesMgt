import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Mail, MessageSquare, Send } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabaseClient';
import { check, friendlyError, rpc } from '@/lib/rpc';
import { useSettings } from '@/lib/settings';
import { humanize } from '@/lib/format';
import { PageHeader } from '@/components/ui/PageHeader';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Modal } from '@/components/ui/Modal';
import { Input } from '@/components/ui/Input';
import { Textarea } from '@/components/ui/Textarea';
import { Checkbox } from '@/components/ui/Checkbox';
import { Spinner } from '@/components/ui/Spinner';
import { SettingsTabs } from './SettingsTabs';
import type { Tables } from '@/types/database';

type Template = Tables<'notification_templates'>;

/** Every placeholder the Edge Function fills in, with an example used for the preview. */
const PLACEHOLDERS: { token: string; sample: string; note: string }[] = [
  { token: 'company_name', sample: 'Ridge Facility Services', note: 'Your trading name' },
  { token: 'customer_name', sample: 'Ama Mensah', note: 'Customer or contact' },
  { token: 'service', sample: 'Cesspit emptying', note: 'Service, document or item in question' },
  { token: 'job_no', sample: 'JOB-2026-0142', note: 'Job order number' },
  { token: 'invoice_no', sample: 'INV-2026-0311', note: 'Invoice number' },
  { token: 'receipt_no', sample: 'RCT-2026-0288', note: 'Receipt number' },
  { token: 'contract_no', sample: 'CON-2026-0019', note: 'Contract number' },
  { token: 'amount', sample: '1,250.00', note: 'Amount, without the currency symbol' },
  { token: 'balance', sample: '450.00', note: 'Balance left, or a percentage in alerts' },
  { token: 'date', sample: '14/11/2026', note: 'Relevant date, DD/MM/YYYY' },
  { token: 'time_window', sample: '09:00 – 12:00', note: 'Arrival window' },
  { token: 'site', sample: 'Adenta Housing Down, GA-492-1038', note: 'Site address' },
  { token: 'period', sample: 'November 2026', note: 'Billing period' },
  { token: 'truck_reg', sample: 'GT 4821-23', note: 'Truck registration' },
  { token: 'driver_name', sample: 'Kofi Boateng', note: 'Driver' },
  { token: 'driver_phone', sample: '0244123456', note: "Driver's phone" },
  { token: 'officer_name', sample: 'Yaw Owusu', note: 'Officer in charge' },
  { token: 'payment_details', sample: 'MTN MoMo 024 000 0000', note: 'The payment line from Company settings' },
  { token: 'invoice_link', sample: 'https://app.example.com/p/i/9f3a…', note: 'Signed link to the document' },
  { token: 'receipt_link', sample: 'https://app.example.com/p/r/41cb…', note: 'Signed link to the receipt' },
  { token: 'survey_link', sample: 'https://app.example.com/p/s/7be2…', note: 'Signed link to the survey' },
  { token: 'reason', sample: 'Truck unavailable on that date', note: 'Reason given on rejection' },
];

function render(body: string, payments: string) {
  return body.replace(/\{([a-z_]+)\}/g, (m, key: string) => {
    if (key === 'payment_details') return payments || 'MTN MoMo 024 000 0000';
    const found = PLACEHOLDERS.find((p) => p.token === key);
    return found ? found.sample : m;
  });
}

/** GSM-7 unless the text needs Unicode, in which case 70 characters per part. */
function segments(text: string) {
  const unicode = /[^\u0000-\u007F€£¥èéùìòÇØøÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ¤ÄÖÑÜ§¿äöñüà\n\r]/.test(text);
  const per = unicode ? 70 : 160;
  const multi = unicode ? 67 : 153;
  const n = text.length;
  return { unicode, characters: n, segments: n <= per ? 1 : Math.ceil(n / multi) };
}

/** SMS and email wording for every automatic message (spec 4.14 and 5). */
export default function TemplatesPage() {
  const qc = useQueryClient();
  const settings = useSettings();
  const [editing, setEditing] = useState<Template | null>(null);
  const [draft, setDraft] = useState({ subject: '', body: '', active: true });
  const [testOpen, setTestOpen] = useState(false);
  const [test, setTest] = useState({ phone: '', message: '' });

  const { data = [], isLoading } = useQuery({
    queryKey: ['notification_templates'],
    queryFn: async () => check(await supabase.from('notification_templates').select('*')
      .order('event_code').order('channel')) as Template[],
  });

  const grouped = useMemo(() => {
    const map = new Map<string, Template[]>();
    for (const t of data) map.set(t.event_code, [...(map.get(t.event_code) ?? []), t]);
    return [...map.entries()];
  }, [data]);

  const save = useMutation({
    mutationFn: async () => {
      if (!editing) return;
      if (!draft.body.trim()) throw new Error('The message cannot be empty');
      const bad = [...draft.body.matchAll(/\{([a-z_]+)\}/g)].map((m) => m[1]).filter((k) => !PLACEHOLDERS.some((p) => p.token === k));
      if (bad.length) throw new Error(`Unknown placeholder: {${bad[0]}}. It would be sent as written.`);
      check(await supabase.from('notification_templates')
        .update({ subject: draft.subject || null, body: draft.body, active: draft.active })
        .eq('id', editing.id));
    },
    onSuccess: async () => {
      toast.success('Template saved');
      setEditing(null);
      await qc.invalidateQueries({ queryKey: ['notification_templates'] });
    },
    onError: (e) => toast.error(friendlyError(e)),
  });

  const sendTest = useMutation({
    mutationFn: () => rpc<string>('send_test_sms', { p_phone: test.phone, p_message: test.message }),
    onSuccess: () => {
      toast.success('Test queued — it is sent within a minute');
      setTestOpen(false);
      setTest({ phone: '', message: '' });
    },
    onError: (e) => toast.error(friendlyError(e)),
  });

  const open = (t: Template) => {
    setEditing(t);
    setDraft({ subject: t.subject ?? '', body: t.body, active: t.active });
  };

  const preview = render(draft.body, settings?.payment_details_sms ?? '');
  const seg = segments(preview);

  if (isLoading) return <Spinner />;

  return (
    <div>
      <PageHeader title="Settings" subtitle="The wording of every automatic text message and email"
        actions={<Button variant="secondary" icon={<Send className="h-4 w-4" />} onClick={() => setTestOpen(true)}>Send a test SMS</Button>} />
      <SettingsTabs />

      <Card className="mt-4" title="How sending works">
        <p className="text-sm text-stone-600">
          Messages are queued in the database, then sent by a scheduled Edge Function. Your SMS and email keys live in that
          function's secrets, never in the browser. If a send fails it is retried, and you can see every attempt under
          Notifications. Customers who did not agree to marketing are skipped for messages marked as marketing.
        </p>
        {settings ? (
          <p className="mt-2 text-xs text-stone-500">
            Texts are sent with the sender ID <strong>{settings.sms_sender_id}</strong> through {settings.sms_provider}; emails through {settings.email_provider}.
          </p>
        ) : null}
      </Card>

      <div className="mt-4 space-y-3">
        {grouped.map(([event, templates]) => (
          <Card key={event} title={<span className="text-sm font-semibold">{humanize(event)}</span>}>
            <div className="space-y-2">
              {templates.map((t) => {
                const s = segments(render(t.body, settings?.payment_details_sms ?? ''));
                return (
                  <div key={t.id} className="flex flex-wrap items-start justify-between gap-3 rounded-lg border border-stone-200 p-3">
                    <div className="min-w-0 flex-1">
                      <p className="flex items-center gap-2 text-sm font-medium text-stone-800">
                        {t.channel === 'sms' ? <MessageSquare className="h-4 w-4 text-stone-400" /> : <Mail className="h-4 w-4 text-stone-400" />}
                        {t.name}
                        {t.active ? null : <Badge tone="grey">Off</Badge>}
                        {t.is_marketing ? <Badge tone="amber">Marketing</Badge> : null}
                      </p>
                      {t.subject ? <p className="mt-1 text-xs font-medium text-stone-600">Subject: {t.subject}</p> : null}
                      <p className="mt-1 whitespace-pre-wrap break-words text-sm text-stone-600">{t.body}</p>
                      {t.channel === 'sms' ? (
                        <p className="mt-1 text-xs text-stone-500">
                          About {s.characters} characters once filled in · {s.segments} message part{s.segments === 1 ? '' : 's'}
                          {s.unicode ? ' · uses Unicode, so parts hold fewer characters' : ''}
                        </p>
                      ) : null}
                    </div>
                    <Button variant="secondary" size="sm" onClick={() => open(t)}>Edit</Button>
                  </div>
                );
              })}
            </div>
          </Card>
        ))}
      </div>

      <Modal open={editing !== null} onClose={() => setEditing(null)} title={editing ? editing.name : ''} size="lg"
        footer={<><Button variant="secondary" onClick={() => setEditing(null)}>Cancel</Button>
          <Button loading={save.isPending} onClick={() => save.mutate()}>Save</Button></>}>
        {editing ? (
          <div className="space-y-4">
            <p className="text-xs text-stone-500">
              {humanize(editing.event_code)} · {editing.channel === 'sms' ? 'Text message' : 'Email'}
            </p>
            {editing.channel === 'email' ? (
              <Input label="Subject" value={draft.subject} onChange={(e) => setDraft({ ...draft, subject: e.target.value })} />
            ) : null}
            <Textarea label="Message" required rows={editing.channel === 'email' ? 10 : 4} value={draft.body}
              onChange={(e) => setDraft({ ...draft, body: e.target.value })} />
            <Checkbox label="Send this message automatically" checked={draft.active}
              onChange={(e) => setDraft({ ...draft, active: e.target.checked })}
              hint="Turn it off to stop the message without losing the wording" />

            <div>
              <p className="mb-1 text-sm font-medium text-stone-700">Placeholders</p>
              <p className="mb-2 text-xs text-stone-500">Click one to add it where the cursor is. Anything in braces that is not on this list is sent as written.</p>
              <div className="flex flex-wrap gap-1">
                {PLACEHOLDERS.map((p) => (
                  <button key={p.token} type="button" title={p.note}
                    className="rounded-full border border-stone-300 bg-white px-2 py-1 font-mono text-xs hover:border-brand-400 hover:text-brand-700"
                    onClick={() => setDraft({ ...draft, body: `${draft.body}{${p.token}}` })}>
                    {`{${p.token}}`}
                  </button>
                ))}
              </div>
            </div>

            <div className="rounded-lg bg-stone-50 p-3">
              <p className="text-sm font-medium text-stone-700">Preview</p>
              {draft.subject && editing.channel === 'email' ? (
                <p className="mt-1 text-sm font-medium">{render(draft.subject, settings?.payment_details_sms ?? '')}</p>
              ) : null}
              <p className="mt-1 whitespace-pre-wrap break-words text-sm text-stone-800">{preview || '—'}</p>
              {editing.channel === 'sms' ? (
                <p className={`mt-2 text-xs ${seg.segments > 2 ? 'font-medium text-amber-700' : 'text-stone-500'}`}>
                  {seg.characters} characters · {seg.segments} message part{seg.segments === 1 ? '' : 's'}
                  {seg.unicode ? ' · Unicode' : ''}
                  {seg.segments > 2 ? ' — each part is charged separately, so consider shortening it.' : ''}
                </p>
              ) : null}
            </div>
          </div>
        ) : null}
      </Modal>

      <Modal open={testOpen} onClose={() => setTestOpen(false)} title="Send a test SMS" size="sm"
        footer={<><Button variant="secondary" onClick={() => setTestOpen(false)}>Cancel</Button>
          <Button loading={sendTest.isPending} disabled={!test.phone} onClick={() => sendTest.mutate()}>Queue the test</Button></>}>
        <div className="space-y-4">
          <Input label="Phone number" required value={test.phone} placeholder="024 412 3456"
            onChange={(e) => setTest({ ...test, phone: e.target.value })} hint="Any Ghana number; it is normalised before sending" />
          <Textarea label="Message" rows={3} value={test.message} onChange={(e) => setTest({ ...test, message: e.target.value })}
            hint="Leave it empty to send a short default message" />
          <p className="text-xs text-stone-500">
            The test is queued like any other message and sent by the scheduled function, which proves the provider keys and
            the sender ID are working end to end.
          </p>
        </div>
      </Modal>
    </div>
  );
}
