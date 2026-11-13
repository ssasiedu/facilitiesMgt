import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { CalendarRange, Mail, Receipt } from 'lucide-react';
import { supabase } from '@/lib/supabaseClient';
import { check, useAction } from '@/lib/rpc';
import { useAuth } from '@/lib/auth';
import { hasAny } from '@/lib/permissions';
import { addDays } from 'date-fns';
import { daysFrom, formatDate, formatGHS, humanize, isoDate } from '@/lib/format';
import { PageHeader } from '@/components/ui/PageHeader';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Spinner } from '@/components/ui/Spinner';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { billNow } from './api';
import type { Views } from '@/types/database';

type Row = Views<'v_upcoming_contract_bills'>;

/** "Upcoming bills, next 30 days" preview (spec 4.7), with a manual Bill now per contract. */
export default function UpcomingBillsPage() {
  const { roles } = useAuth();
  const canBill = hasAny(roles, 'accountant', 'manager', 'ops_officer');
  const horizon = isoDate(addDays(new Date(), 30));

  const { data = [], isLoading, error, refetch } = useQuery({
    queryKey: ['upcoming-bills', horizon],
    queryFn: async () => check(await supabase.from('v_upcoming_contract_bills').select('*')
      .lte('next_billing_date', horizon).order('next_billing_date')) as Row[],
  });

  const bill = useAction((contractId: string) => billNow(contractId, false), {
    success: (count) => (Number(count) > 0 ? `${count} invoice(s) raised` : 'Not due yet — nothing raised'),
    invalidate: [['upcoming-bills', horizon], ['table', 'invoices']],
    onSuccess: () => void refetch(),
  });

  if (isLoading) return <Spinner />;
  if (error) return <ErrorState error={error} onRetry={() => void refetch()} />;

  const total = data.reduce((t, r) => t + Number(r.amount_per_period ?? 0), 0);
  const dueNow = data.filter((r) => (daysFrom(r.next_billing_date) ?? -1) >= 0);

  return (
    <div>
      <PageHeader title="Upcoming bills" subtitle="Recurring contracts due to be invoiced in the next 30 days"
        actions={<Link to="/contracts"><Button variant="secondary">All contracts</Button></Link>} />

      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Card title="Contracts due"><p className="text-xl font-semibold tabular-nums">{data.length}</p></Card>
        <Card title="Value"><p className="text-xl font-semibold tabular-nums">{formatGHS(total)}</p></Card>
        <Card title="Due today or overdue"><p className="text-xl font-semibold tabular-nums">{dueNow.length}</p>
          <p className="text-xs text-stone-500">The 07:00 job raises these automatically</p></Card>
      </div>

      {!data.length ? (
        <EmptyState icon={<CalendarRange className="h-6 w-6" />} title="Nothing due in the next 30 days"
          message="Active recurring contracts appear here as their billing date approaches." />
      ) : (
        <Card bodyClassName="p-0">
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-stone-50 text-left text-xs uppercase tracking-wide text-stone-500">
                <tr>
                  <th scope="col" className="px-3 py-2 font-medium">Billing date</th>
                  <th scope="col" className="px-3 py-2 font-medium">Contract</th>
                  <th scope="col" className="px-3 py-2 font-medium">Customer</th>
                  <th scope="col" className="px-3 py-2 font-medium">Frequency</th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">Amount</th>
                  <th scope="col" className="px-3 py-2 font-medium">Auto-send</th>
                  {canBill ? <th scope="col" className="px-3 py-2" /> : null}
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                {data.map((r) => {
                  const days = daysFrom(r.next_billing_date);
                  const due = (days ?? -1) >= 0;
                  return (
                    <tr key={r.contract_id ?? ''} className={due ? 'bg-amber-50' : undefined}>
                      <td className="whitespace-nowrap px-3 py-2">
                        {formatDate(r.next_billing_date)}
                        <span className="block text-xs text-stone-500">
                          {due ? 'due now' : `in ${Math.abs(days ?? 0)} day(s)`}
                        </span>
                      </td>
                      <td className="px-3 py-2">
                        <Link to={`/contracts/${r.contract_id}`} className="font-medium text-brand-700 hover:underline">{r.contract_no}</Link>
                        <span className="block text-xs text-stone-500">{r.title}</span>
                      </td>
                      <td className="px-3 py-2">
                        {r.customer_id ? <Link to={`/customers/${r.customer_id}`} className="text-brand-700 hover:underline">{r.customer_name}</Link> : r.customer_name}
                      </td>
                      <td className="px-3 py-2">{humanize(r.billing_frequency)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{formatGHS(r.amount_per_period)}</td>
                      <td className="px-3 py-2">
                        {r.auto_send ? <Badge tone="green"><Mail className="mr-1 inline h-3 w-3" />Yes</Badge> : <Badge tone="grey">No</Badge>}
                      </td>
                      {canBill ? (
                        <td className="px-3 py-2 text-right">
                          <Button variant="secondary" size="sm" icon={<Receipt className="h-4 w-4" />} loading={bill.isPending}
                            onClick={() => bill.mutate(r.contract_id as string)}>Bill now</Button>
                        </td>
                      ) : null}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="p-3 text-xs text-stone-500">
            Invoices are raised automatically at 07:00 Africa/Accra each day. "Bill now" only raises an invoice that is
            already due; the period is unique per contract, so a duplicate is impossible.
          </p>
        </Card>
      )}
    </div>
  );
}
