// Shape of get_dashboard(from, to, service, zone, customer_type) — computed in SQL (0015),
// never in the browser, so the dashboard stays fast with large data sets.

export interface Metric { value: number; prev: number }

export interface DashboardData {
  revenue: Metric;
  cash_collected: Metric;
  expenses: Metric;
  direct_costs: Metric;
  gross_profit: Metric;
  gross_margin: Metric;
  receivables: { outstanding: number; overdue: number; overdue_count: number };
  balances: Record<string, number> | null;
  jobs: { pending_approval: number; scheduled_today: number; in_progress: number; completed_this_month: number; completed_period: number };
  fleet: { total: number; on_road: number; on_job: number; off_road: number; availability_pct: number | null; availability_prev: number | null };
  contracts: { active: number; mrr: number };
  surveys: { csat: number | null; responses: number; nps: number | null; csat_prev: number | null } | null;
  zonal: { planned: number; completed: number; completion_pct: number | null } | null;
  charts: {
    revenue_vs_expenses: { month: string; month_start: string; revenue: number; expenses: number }[] | null;
    revenue_by_service: { service_id: string | null; name: string; value: number }[];
    aging: { current: number; '1_30': number; '31_60': number; '61_90': number; '90_plus': number };
    funnel: { leads: number; estimates: number; jobs: number; paid: number };
    contract_profitability: { contract_id: string; contract_no: string | null; title: string; gp: number; margin: number | null; loss: boolean }[];
    top_customers: { customer_id: string; name: string | null; revenue: number }[];
    collections: { month: string; month_start: string; collected: number; invoiced: number }[] | null;
    estimate_variance: { estimate_id: string; estimate_no: string | null; target_type: string | null; target_id: string | null; estimated: number; actual: number; variance: number }[];
  };
  alerts: {
    jobs_waiting_24h: { id: string; job_no: string | null; customer: string | null; since: string }[];
    overdue_invoices: { count: number; amount: number };
    loss_contracts: { id: string; contract_no: string | null; month: string; gross_profit: number }[];
    off_road_trucks: { id: string; registration_no: string; reason: string | null; return: string | null }[];
    expiring_documents: { truck_id: string; registration_no: string; doc_type: string; expiry: string }[];
    low_stock: { item: string; quantity: number; reorder: number }[];
    low_surveys: { id: string; title: string; created_at: string }[];
  };
}
