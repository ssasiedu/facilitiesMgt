import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Copy, Smartphone } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabaseClient';
import { check, friendlyError, useAction } from '@/lib/rpc';
import { callFunction } from '@/lib/functions';
import { useSettings } from '@/lib/settings';
import { displayPhone, formatGHS, round2 } from '@/lib/format';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Spinner } from '@/components/ui/Spinner';

interface OpenInvoice { id: string; invoice_no: string | null; balance: number; due_date: string | null }

interface RequestResult { sent: 'prompt' | 'link'; reference: string; url?: string; note?: string }

/**
 * Ask a customer to pay, from the payments screen.
 *
 * Where Configuration has mobile money prompts switched on, the request goes straight to the
 * payer's handset and they approve it with their PIN. Otherwise — and whenever Hubtel refuses a
 * prompt for a reason nobody here can fix — a payment link is sent by SMS instead, which the
 * customer taps. Either way the money lands through the same webhook and is recorded against the
 * invoice, so nothing has to be keyed in afterwards.
 */
export function RequestPaymentModal({ open, onClose, customerId, customerName, onDone }: {
  open: boolean;
  onClose: () => void;
  customerId: string;
  customerName: string;
  onDone?: () => void;
}) {
  const settings = useSettings();
  const [invoiceId, setInvoiceId] = useState('');
  const [amount, setAmount] = useState('');
  const [phone, setPhone] = useState('');
  const [result, setResult] = useState<RequestResult | null>(null);

  const customer = useQuery({
    queryKey: ['request-payment', 'customer', customerId],
    enabled: open && !!customerId,
    queryFn: async () => check(await supabase.from('customers')
      .select('id, display_name, phone, company_phone').eq('id', customerId).single()) as
      { id: string; display_name: string | null; phone: string | null; company_phone: string | null },
  });

  const invoices = useQuery({
    queryKey: ['request-payment', 'open-invoices', customerId],
    enabled: open && !!customerId,
    queryFn: async () => check(await supabase.from('invoices')
      .select('id, invoice_no, balance, due_date')
      .eq('customer_id', customerId)
      .in('status', ['issued', 'due', 'partially_paid', 'overdue'])
      .gt('balance', 0)
      .order('due_date', { ascending: true })) as OpenInvoice[],
  });

  // Start on the invoice that has been owing longest, for its outstanding amount.
  useEffect(() => {
    if (!open) return;
    const oldest = (invoices.data ?? [])[0];
    if (oldest && !invoiceId) {
      setInvoiceId(oldest.id);
      setAmount(String(round2(Number(oldest.balance))));
    }
  }, [open, invoices.data, invoiceId]);

  useEffect(() => {
    if (!open) return;
    const c = customer.data;
    if (c && !phone) setPhone(c.phone ?? c.company_phone ?? '');
  }, [open, customer.data, phone]);

  const chosen = (invoices.data ?? []).find((i) => i.id === invoiceId) ?? null;
  const asked = Number(amount);
  const promptMode = settings?.payment_request_mode === 'prompt';

  const problem = !settings?.online_payments_enabled
    ? 'Online payments are switched off in Settings · Configuration.'
    : !Number.isFinite(asked) || asked <= 0 ? 'Enter the amount to request'
    : asked < 1 ? 'The smallest request is GH₵ 1.00'
    : chosen && asked > Number(chosen.balance) ? `Invoice ${chosen.invoice_no} only owes ${formatGHS(chosen.balance)}`
    : !phone.trim() ? 'Enter the mobile money number to charge'
    : null;

  const send = useAction(
    () => callFunction<RequestResult>('request-payment', {
      method: 'POST',
      body: { customer_id: customerId, amount: asked, phone: phone.trim(), invoice_id: invoiceId || null },
    }),
    {
      onSuccess: (r: RequestResult) => {
        setResult(r);
        toast.success(r.sent === 'prompt' ? 'Prompt sent to the customer’s phone' : 'Payment link sent by SMS');
        onDone?.();
      },
    },
  );

  const close = () => {
    setResult(null);
    setInvoiceId('');
    setAmount('');
    setPhone('');
    onClose();
  };

  return (
    <Modal open={open} onClose={close} size="sm"
      title={result ? 'Payment requested' : `Ask ${customerName} to pay`}
      footer={result ? (
        <Button onClick={close}>Done</Button>
      ) : (
        <>
          <Button variant="secondary" onClick={close}>Cancel</Button>
          <Button icon={<Smartphone className="h-4 w-4" />} loading={send.isPending} disabled={!!problem}
            onClick={() => send.mutate()}>
            {promptMode ? 'Send the prompt' : 'Send the link'}
          </Button>
        </>
      )}>
      {result ? (
        <div className="space-y-3">
          <p className="text-sm text-stone-700">
            {result.sent === 'prompt'
              ? `A mobile money prompt for ${formatGHS(asked)} has gone to ${displayPhone(phone)}. The customer approves it with their PIN and the payment records itself.`
              : `A payment link for ${formatGHS(asked)} has been sent by SMS to ${displayPhone(phone)}. The payment records itself once they pay.`}
          </p>

          {result.note ? (
            <p role="status" className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">{result.note}</p>
          ) : null}

          {result.url ? (
            <div>
              <p className="text-xs uppercase tracking-wide text-stone-500">The link, if you need to read it out</p>
              <div className="mt-1 flex items-start gap-2">
                <code className="min-w-0 flex-1 break-all rounded-lg bg-stone-100 p-2 text-xs">{result.url}</code>
                <Button variant="secondary" size="sm" icon={<Copy className="h-4 w-4" />}
                  onClick={async () => {
                    try { await navigator.clipboard.writeText(result.url!); toast.success('Link copied'); }
                    catch (e) { toast.error(friendlyError(e)); }
                  }}>Copy</Button>
              </div>
            </div>
          ) : null}

          <p className="text-xs text-stone-500">
            Nothing is recorded until the customer actually pays. An unpaid request expires on its own and can be
            sent again.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {invoices.isPending ? <Spinner /> : (
            <Select label="Against which invoice?" value={invoiceId}
              onChange={(e) => {
                const next = e.target.value;
                setInvoiceId(next);
                const inv = (invoices.data ?? []).find((i) => i.id === next);
                setAmount(inv ? String(round2(Number(inv.balance))) : '');
              }}
              hint="Leave it on account for a deposit taken before the work is invoiced"
              options={[
                { value: '', label: 'On account (no invoice yet)' },
                ...(invoices.data ?? []).map((i) => ({
                  value: i.id,
                  label: `${i.invoice_no} — ${formatGHS(i.balance)} owing`,
                })),
              ]} />
          )}

          <Input label="Amount to request (GH₵)" type="number" step="0.01" min="1" required
            value={amount} onChange={(e) => setAmount(e.target.value)}
            hint={chosen ? `This invoice owes ${formatGHS(chosen.balance)}` : 'Recorded as credit until an invoice is raised'} />

          <Input label="Mobile money number to charge" required value={phone}
            onChange={(e) => setPhone(e.target.value)} placeholder="024 412 3456"
            hint="The wallet that is paying. It need not be the number on the customer's record." />

          {problem ? <p role="alert" className="text-sm text-red-700">{problem}</p> : null}

          <p className="rounded-lg bg-stone-50 p-3 text-xs text-stone-600">
            {promptMode
              ? 'The prompt goes straight to that handset. If Hubtel will not take it — the Receive Money capability is not enabled, or this server is not on their allow-list — a payment link is sent by SMS instead and you will be told.'
              : 'An SMS goes to that number with a link to pay. To send prompts straight to the handset instead, a Super Admin switches it on in Settings · Configuration, once Hubtel has enabled Receive Money on the merchant account.'}
          </p>
        </div>
      )}
    </Modal>
  );
}
