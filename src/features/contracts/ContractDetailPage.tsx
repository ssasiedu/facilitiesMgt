import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { AlertTriangle, Ban, Check, Pause, Pencil, Play, Receipt, Send, X } from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { hasAny } from '@/lib/permissions';
import { useAction } from '@/lib/rpc';
import { useSettings } from '@/lib/settings';
import { formatDate, formatGHS, formatNumber, formatPct, humanize } from '@/lib/format';
import { PageHeader } from '@/components/ui/PageHeader';
import { Card, DetailList } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { Tabs } from '@/components/ui/Tabs';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { CommentsPanel } from '@/components/ui/CommentsPanel';
import { AttachmentsPanel } from '@/components/ui/AttachmentsPanel';
import { Spinner } from '@/components/ui/Spinner';
import { ErrorState } from '@/components/ui/ErrorState';
import { EmptyState } from '@/components/ui/EmptyState';
import {
  approveContract, billNow, loadContract, loadMonthlyProfitability, loadProfitabilitySummary,
  rejectContract, setContractStatus, submitContract,
} from './api';

type Tab = 'overview' | 'billing' | 'profitability' | 'jobs' | 'comments' | 'files';

/** Contract detail with the monthly profitability view (spec 4.7 and 4.8). */
export default function ContractDetailPage() {
  const { id = '' } = useParams<{ id: string }>();
  const { roles } = useAuth();
  const settings = useSettings();
  const [tab, setTab] = useState<Tab>('overview');
  const [confirm, setConfirm] = useState<null | 'approve' | 'reject' | 'suspend' | 'terminate' | 'bill'>(null);

  const isManager = hasAny(roles, 'manager');
  const canEditContract = hasAny(roles, 'manager', 'ops_officer', 'sales_exec', 'accountant');
  const canBill = hasAny(roles, 'accountant', 'manager', 'ops_officer');

  const query = useQuery({ queryKey: ['contract', id], queryFn: () => loadContract(id) });
  const monthly = useQuery({ queryKey: ['contract-monthly', id], queryFn: () => loadMonthlyProfitability(id) });
  const summary = useQuery({ queryKey: ['contract-summary', id], queryFn: () => loadProfitabilitySummary(id) });

  const invalidate = [['contract', id], ['contract-monthly', id], ['contract-summary', id], ['table', 'contracts']];
  const submit = useAction(() => submitContract(id), { success: 'Sent for approval', invalidate });
  const approve = useAction(() => approveContract(id), { success: 'Contract approved and activated', invalidate, onSuccess: () => setConfirm(null) });
  const reject = useAction((reason: string) => rejectContract(id, reason), { success: 'Contract rejected', invalidate, onSuccess: () => setConfirm(null) });
  const suspend = useAction((reason: string) => setContractStatus(id, 'suspended', reason), { success: 'Contract suspended — billing paused', invalidate, onSuccess: () => setConfirm(null) });
  const resume = useAction(() => setContractStatus(id, 'active', 'Resumed'), { success: 'Contract active again', invalidate });
  const terminate = useAction((reason: string) => setContractStatus(id, 'terminated', reason), { success: 'Contract terminated', invalidate, onSuccess: () => setConfirm(null) });
  const bill = useAction(() => billNow(id, true), {
    invalidate,
    success: (count) => (Number(count) > 0 ? `${count} invoice(s) raised` : 'Nothing to bill — this period is already invoiced'),
    onSuccess: () => setConfirm(null),
  });

  if (query.isLoading) return <Spinner />;
  if (query.error || !query.data) return <ErrorState error={query.error ?? new Error('Not found')} onRetry={() => void query.refetch()} />;

  const k = query.data;
  const months = monthly.data ?? [];
  const s = summary.data;
  const recurring = k.contract_type === 'recurring';
  const threshold = Number(settings?.contract_margin_threshold ?? 10);
  const billed = k.contract_billing_periods.reduce((t, p) => t + Number(p.amount), 0);

  const tabs: { value: Tab; label: string; count?: number }[] = [
    { value: 'overview', label: 'Overview' },
    { value: 'billing', label: recurring ? 'Billing periods' : 'Billing', count: k.contract_billing_periods.length },
    { value: 'profitability', label: 'Profitability', count: months.length },
    { value: 'jobs', label: 'Job orders' },
    { value: 'comments', label: 'Comments' },
    { value: 'files', label: 'Documents' },
  ];

  return (
    <div>
      <PageHeader back="/contracts" title={`Contract ${k.contract_no ?? 'draft'}`}
        subtitle={<span className="flex flex-wrap items-center gap-2">
          <StatusBadge status={k.status} />
          <Badge tone={recurring ? 'purple' : 'grey'}>{recurring ? `${humanize(k.billing_frequency)} · ${formatGHS(k.amount_per_period)}` : `One-off · ${formatGHS(k.total_agreed)}`}</Badge>
          <span className="text-stone-500">{formatDate(k.start_date)} – {formatDate(k.end_date)}</span>
        </span>}
        actions={<>
          {['draft', 'rejected'].includes(k.status) && canEditContract ? <>
            <Link to={`/contracts/${k.id}/edit`}><Button variant="secondary" icon={<Pencil className="h-4 w-4" />}>Edit</Button></Link>
            <Button icon={<Send className="h-4 w-4" />} loading={submit.isPending} onClick={() => submit.mutate()}>Send for approval</Button>
          </> : null}
          {k.status === 'pending_approval' && isManager ? <>
            <Button variant="success" icon={<Check className="h-4 w-4" />} onClick={() => setConfirm('approve')}>Approve</Button>
            <Button variant="danger" icon={<X className="h-4 w-4" />} onClick={() => setConfirm('reject')}>Reject</Button>
          </> : null}
          {k.status === 'active' && recurring && canBill ? (
            <Button variant="secondary" icon={<Receipt className="h-4 w-4" />} onClick={() => setConfirm('bill')}>Bill now</Button>
          ) : null}
          {k.status === 'active' && isManager ? (
            <Button variant="secondary" icon={<Pause className="h-4 w-4" />} onClick={() => setConfirm('suspend')}>Suspend</Button>
          ) : null}
          {k.status === 'suspended' && isManager ? (
            <Button variant="secondary" icon={<Play className="h-4 w-4" />} loading={resume.isPending} onClick={() => resume.mutate()}>Resume</Button>
          ) : null}
          {['active', 'suspended'].includes(k.status) && isManager ? (
            <Button variant="danger" icon={<Ban className="h-4 w-4" />} onClick={() => setConfirm('terminate')}>Terminate</Button>
          ) : null}
        </>} />

      {k.status === 'suspended' ? (
        <p className="mb-4 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
          Suspended{k.status_reason ? `: ${k.status_reason}` : ''}. The recurring billing job skips suspended contracts.
        </p>
      ) : null}
      {k.status === 'rejected' && k.status_reason ? (
        <p className="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-800">Rejected: {k.status_reason}</p>
      ) : null}
      {s && Number(s.loss_months ?? 0) > 0 ? (
        <p className="mb-4 flex items-start gap-2 rounded-lg bg-red-50 p-3 text-sm text-red-800">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          {s.loss_months} month(s) on this contract lost money. Check the supplies and labour recorded against it.
        </p>
      ) : null}

      <Tabs tabs={tabs} value={tab} onChange={setTab} />

      <div className="mt-4 space-y-4">
        {tab === 'overview' ? (
          <>
            <Card title="Contract">
              <DetailList items={[
                ['Customer', k.customer ? <Link to={`/customers/${k.customer.id}`} className="text-brand-700 hover:underline">{k.customer.display_name}</Link> : '—'],
                ['Title', k.title],
                ['Type', recurring ? 'Recurring' : 'One-off'],
                ['Main service', k.service?.name ?? '—'],
                ['Period', `${formatDate(k.start_date)} – ${formatDate(k.end_date)}`],
                ['Billing', recurring ? `${humanize(k.billing_frequency)}, day ${k.billing_day} · ${formatGHS(k.amount_per_period)} per period` : `One agreed total of ${formatGHS(k.total_agreed)}`],
                ['Next billing date', k.next_billing_date ? formatDate(k.next_billing_date) : '—'],
                ['Payment terms', `${k.payment_terms_days} days`],
                ['Pro-rate first and last period', k.prorate ? 'Yes' : 'No'],
                ['Send invoices automatically', k.auto_send ? 'Yes, by email and SMS' : 'No'],
                ['Supervisor', k.supervisor?.full_name ?? '—'],
                ['Approved by', k.approver?.full_name ? `${k.approver.full_name} · ${formatDate(k.approved_at)}` : '—'],
                ['Price review', k.price_review_date ? formatDate(k.price_review_date) : '—'],
                ['Budgeted monthly cost', formatGHS(k.budgeted_monthly_cost)],
                ['Overhead allocation', formatPct(k.overhead_pct)],
                ['From estimate', k.estimate ? <Link to={`/estimates/${k.estimate.id}`} className="text-brand-700 hover:underline">{k.estimate.estimate_no}</Link> : '—'],
                ['Description', k.description ?? '—'],
              ]} />
            </Card>

            <Card title="Services">
              {k.contract_services.length ? (
                <table className="min-w-full text-sm">
                  <thead className="bg-stone-50 text-left text-xs uppercase tracking-wide text-stone-500">
                    <tr>
                      <th scope="col" className="px-3 py-2 font-medium">Service</th>
                      <th scope="col" className="px-3 py-2 font-medium">Description</th>
                      <th scope="col" className="px-3 py-2 text-right font-medium">Qty</th>
                      <th scope="col" className="px-3 py-2 text-right font-medium">Unit price</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-stone-100">
                    {k.contract_services.map((cs) => (
                      <tr key={cs.id}>
                        <td className="px-3 py-2">{cs.service?.name}</td>
                        <td className="px-3 py-2 text-stone-600">{cs.description ?? '—'}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{formatNumber(cs.quantity)}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{formatGHS(cs.unit_price)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : <p className="text-sm text-stone-500">No services listed.</p>}
            </Card>

            <Card title="Sites">
              {k.contract_sites.length ? (
                <ul className="divide-y divide-stone-100 text-sm">
                  {k.contract_sites.map((site) => (
                    <li key={site.id} className="py-2">
                      <p className="font-medium">{site.name}</p>
                      <p className="text-stone-600">{[site.address, site.digital_address].filter(Boolean).join(' · ') || '—'}</p>
                    </li>
                  ))}
                </ul>
              ) : <p className="text-sm text-stone-500">No sites listed.</p>}
            </Card>
          </>
        ) : null}

        {tab === 'billing' ? (
          <>
            {!recurring ? (
              <Card title="One-off contract">
                <DetailList items={[
                  ['Agreed total', formatGHS(k.total_agreed)],
                  ['Billed so far', formatGHS(s?.billed_to_date ?? billed)],
                  ['Left to bill', formatGHS(Number(k.total_agreed) - Number(s?.billed_to_date ?? billed))],
                ]} />
                <p className="mt-3 text-xs text-stone-500">
                  Job orders raised under this contract are invoiced against the agreed total. The database refuses to
                  bill more than the total.
                </p>
              </Card>
            ) : null}
            <Card title="Invoiced periods">
              {k.contract_billing_periods.length ? (
                <table className="min-w-full text-sm">
                  <thead className="bg-stone-50 text-left text-xs uppercase tracking-wide text-stone-500">
                    <tr>
                      <th scope="col" className="px-3 py-2 font-medium">Period</th>
                      <th scope="col" className="px-3 py-2 text-right font-medium">Amount</th>
                      <th scope="col" className="px-3 py-2 font-medium">Invoice</th>
                      <th scope="col" className="px-3 py-2 font-medium">Status</th>
                      <th scope="col" className="px-3 py-2 text-right font-medium">Balance</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-stone-100">
                    {[...k.contract_billing_periods].sort((a, b) => b.period_start.localeCompare(a.period_start)).map((p) => (
                      <tr key={p.id}>
                        <td className="px-3 py-2">{formatDate(p.period_start)} – {formatDate(p.period_end)}{p.prorated ? <Badge tone="grey" className="ml-1">Pro-rated</Badge> : null}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{formatGHS(p.amount)}</td>
                        <td className="px-3 py-2">{p.invoice ? <Link to={`/finance/invoices/${p.invoice.id}`} className="text-brand-700 hover:underline">{p.invoice.invoice_no}</Link> : '—'}</td>
                        <td className="px-3 py-2">{p.invoice ? <StatusBadge status={p.invoice.status} /> : '—'}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{p.invoice ? formatGHS(p.invoice.balance) : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : <p className="text-sm text-stone-500">No periods billed yet.</p>}
            </Card>
          </>
        ) : null}

        {tab === 'profitability' ? (
          <>
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <Card title="Revenue to date"><p className="text-lg font-semibold tabular-nums">{formatGHS(s?.revenue_to_date ?? 0)}</p>
                <p className="text-xs text-stone-500">Collected {formatGHS(s?.collected_to_date ?? 0)}</p></Card>
              <Card title="Cost to date"><p className="text-lg font-semibold tabular-nums">{formatGHS(s?.cost_to_date ?? 0)}</p></Card>
              <Card title="Gross profit to date">
                <p className={`text-lg font-semibold tabular-nums ${Number(s?.gross_profit_to_date ?? 0) < 0 ? 'text-red-700' : 'text-emerald-700'}`}>
                  {formatGHS(s?.gross_profit_to_date ?? 0)}
                </p>
                <p className="text-xs text-stone-500">Margin {s?.margin_pct_to_date === null || s?.margin_pct_to_date === undefined ? '—' : formatPct(s.margin_pct_to_date)}</p>
              </Card>
              <Card title="Projected to contract end"><p className="text-lg font-semibold tabular-nums">{formatGHS(s?.projected_gross_profit ?? 0)}</p>
                <p className="text-xs text-stone-500">{s?.months_remaining ?? 0} month(s) left</p></Card>
            </div>

            {months.length ? (
              <>
                <Card title="Gross profit by month">
                  <div className="h-64">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={months.map((m) => ({ month: formatDate(m.month).slice(3), gp: Number(m.gross_profit), loss: m.is_loss }))}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#e7e5e4" />
                        <XAxis dataKey="month" fontSize={11} />
                        <YAxis fontSize={11} tickFormatter={(v: number) => (Math.abs(v) >= 1000 ? `${Math.round(v / 1000)}k` : String(v))} />
                        <Tooltip formatter={(v: number) => formatGHS(v)} />
                        <Bar dataKey="gp" name="Gross profit" radius={[4, 4, 0, 0]}>
                          {months.map((m) => <Cell key={m.month ?? ''} fill={m.is_loss ? '#dc2626' : '#059669'} />)}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </Card>

                <Card title="Revenue against cost">
                  <div className="h-64">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={months.map((m) => ({ month: formatDate(m.month).slice(3), revenue: Number(m.revenue), cost: Number(m.direct_cost), budget: Number(m.budgeted_monthly_cost) }))}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#e7e5e4" />
                        <XAxis dataKey="month" fontSize={11} />
                        <YAxis fontSize={11} tickFormatter={(v: number) => (Math.abs(v) >= 1000 ? `${Math.round(v / 1000)}k` : String(v))} />
                        <Tooltip formatter={(v: number) => formatGHS(v)} />
                        <Legend />
                        <Line type="monotone" dataKey="revenue" name="Revenue" stroke="#0f766e" strokeWidth={2} />
                        <Line type="monotone" dataKey="cost" name="Direct cost" stroke="#dc2626" strokeWidth={2} />
                        <Line type="monotone" dataKey="budget" name="Budgeted cost" stroke="#a8a29e" strokeDasharray="4 4" />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                </Card>

                <Card title="Month by month" bodyClassName="p-0">
                  <div className="overflow-x-auto">
                    <table className="min-w-full text-sm">
                      <thead className="bg-stone-50 text-left text-xs uppercase tracking-wide text-stone-500">
                        <tr>
                          <th scope="col" className="px-3 py-2 font-medium">Month</th>
                          <th scope="col" className="px-3 py-2 text-right font-medium">Revenue</th>
                          <th scope="col" className="px-3 py-2 text-right font-medium">Collected</th>
                          <th scope="col" className="px-3 py-2 text-right font-medium">Supplies</th>
                          <th scope="col" className="px-3 py-2 text-right font-medium">Labour</th>
                          <th scope="col" className="px-3 py-2 text-right font-medium">Vehicle</th>
                          <th scope="col" className="px-3 py-2 text-right font-medium">Other</th>
                          <th scope="col" className="px-3 py-2 text-right font-medium">Direct cost</th>
                          <th scope="col" className="px-3 py-2 text-right font-medium">Overhead</th>
                          <th scope="col" className="px-3 py-2 text-right font-medium">Gross profit</th>
                          <th scope="col" className="px-3 py-2 text-right font-medium">Margin</th>
                          <th scope="col" className="px-3 py-2 text-right font-medium">vs budget</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-stone-100">
                        {[...months].reverse().map((m) => (
                          <tr key={m.month ?? ''} className={m.is_loss ? 'bg-red-50' : undefined}>
                            <td className="whitespace-nowrap px-3 py-2">{formatDate(m.month)}</td>
                            <td className="px-3 py-2 text-right tabular-nums">{formatGHS(m.revenue)}</td>
                            <td className="px-3 py-2 text-right tabular-nums">{formatGHS(m.collected)}</td>
                            <td className="px-3 py-2 text-right tabular-nums">{formatGHS(m.supplies)}</td>
                            <td className="px-3 py-2 text-right tabular-nums">{formatGHS(m.labour)}</td>
                            <td className="px-3 py-2 text-right tabular-nums">{formatGHS(m.vehicle)}</td>
                            <td className="px-3 py-2 text-right tabular-nums">{formatGHS(m.other)}</td>
                            <td className="px-3 py-2 text-right tabular-nums">{formatGHS(m.direct_cost)}</td>
                            <td className="px-3 py-2 text-right tabular-nums text-stone-500">{formatGHS(m.overhead)}</td>
                            <td className={`px-3 py-2 text-right tabular-nums font-medium ${Number(m.gross_profit) < 0 ? 'text-red-700' : ''}`}>{formatGHS(m.gross_profit)}</td>
                            <td className="px-3 py-2 text-right">
                              {m.margin_pct === null ? '—' : (
                                <Badge tone={Number(m.margin_pct) < 0 ? 'red' : Number(m.margin_pct) < threshold ? 'amber' : 'green'}>{formatPct(m.margin_pct)}</Badge>
                              )}
                            </td>
                            <td className={`px-3 py-2 text-right tabular-nums ${Number(m.budget_variance) > 0 ? 'text-red-700' : 'text-emerald-700'}`}>
                              {Number(m.budget_variance) > 0 ? '+' : ''}{formatGHS(m.budget_variance)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <p className="p-3 text-xs text-stone-500">
                    Gross profit is revenue less direct costs. Overhead is shown separately so it never hides a thin margin.
                    Loss-making months are red, and the Manager is alerted when a margin falls below {formatPct(threshold)}.
                  </p>
                </Card>
              </>
            ) : (
              <EmptyState title="No monthly figures yet" message="Figures appear once the contract has been billed and supplies or labour recorded." />
            )}

            <Card title="Record costs against this contract">
              <div className="flex flex-wrap gap-2">
                <Link to={`/supplies?contract=${k.id}`}><Button variant="secondary" size="sm">Supplies log</Button></Link>
                <Link to={`/finance/expenses?contract=${k.id}`}><Button variant="secondary" size="sm">Expenses</Button></Link>
                <Link to={`/finance/bills?contract=${k.id}`}><Button variant="secondary" size="sm">Supplier bills</Button></Link>
              </div>
            </Card>
          </>
        ) : null}

        {tab === 'jobs' ? (
          <Card title="Job orders under this contract">
            <ContractJobs contractId={k.id} />
          </Card>
        ) : null}

        {tab === 'comments' ? <Card title="Comments"><CommentsPanel entityType="contract" entityId={k.id} /></Card> : null}
        {tab === 'files' ? <Card title="Signed contract and other documents"><AttachmentsPanel entityType="contract" entityId={k.id} bucket="contracts" folder={`${k.id}`} /></Card> : null}
      </div>

      <ConfirmDialog open={confirm === 'approve'} onClose={() => setConfirm(null)} title="Approve this contract?"
        confirmLabel="Approve" loading={approve.isPending} onConfirm={() => approve.mutate()}
        message={recurring
          ? 'The contract becomes Active and the first billing date is set. The daily job will raise each period invoice automatically.'
          : 'The contract becomes Active. Job orders raised under it will be billed against the agreed total.'} />

      <ConfirmDialog open={confirm === 'reject'} onClose={() => setConfirm(null)} title="Reject this contract" danger
        confirmLabel="Reject" reasonLabel="Reason" loading={reject.isPending} onConfirm={(reason) => reject.mutate(reason)} />

      <ConfirmDialog open={confirm === 'suspend'} onClose={() => setConfirm(null)} title="Suspend this contract"
        confirmLabel="Suspend" reasonLabel="Reason" loading={suspend.isPending} onConfirm={(reason) => suspend.mutate(reason)}
        message="Billing pauses while a contract is suspended. Nothing already invoiced changes." />

      <ConfirmDialog open={confirm === 'terminate'} onClose={() => setConfirm(null)} title="Terminate this contract" danger
        confirmLabel="Terminate" reasonLabel="Reason" loading={terminate.isPending} onConfirm={(reason) => terminate.mutate(reason)}
        message="Termination is final. Invoices already raised stay as they are." />

      <ConfirmDialog open={confirm === 'bill'} onClose={() => setConfirm(null)} title="Bill this contract now?"
        confirmLabel="Bill now" loading={bill.isPending} onConfirm={() => bill.mutate()}
        message="This raises the invoice for the next unbilled period. Running it twice cannot create a duplicate." />
    </div>
  );
}

/** Job orders raised under a contract. */
function ContractJobs({ contractId }: { contractId: string }) {
  const { data = [], isLoading } = useQuery({
    queryKey: ['contract-jobs', contractId],
    queryFn: async () => {
      const { supabase } = await import('@/lib/supabaseClient');
      const { data: rows, error } = await supabase.from('job_orders')
        .select('id, job_no, customer_name, execution_date, status, agreed_amount')
        .eq('contract_id', contractId).order('execution_date', { ascending: false });
      if (error) throw new Error(error.message);
      return (rows ?? []) as { id: string; job_no: string | null; customer_name: string | null; execution_date: string; status: string; agreed_amount: number }[];
    },
  });
  if (isLoading) return <Spinner />;
  if (!data.length) return <p className="text-sm text-stone-500">No job orders raised under this contract yet.</p>;
  return (
    <ul className="divide-y divide-stone-100 text-sm">
      {data.map((j) => (
        <li key={j.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
          <Link to={`/jobs/${j.id}`} className="font-medium text-brand-700 hover:underline">{j.job_no}</Link>
          <span className="text-stone-500">{formatDate(j.execution_date)}</span>
          <span className="tabular-nums">{formatGHS(j.agreed_amount)}</span>
          <StatusBadge status={j.status} />
        </li>
      ))}
    </ul>
  );
}
