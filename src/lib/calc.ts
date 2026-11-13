import { round2 } from './format';

// Mirror of the database functions estimate_line_cost / estimates_compute (0013). The database is the
// source of truth; this lets the what-if panel update live while the user types.

export type CostCategory = 'consumable' | 'equipment' | 'labour' | 'vehicle' | 'subcontract' | 'overhead';
export const CATEGORIES: CostCategory[] = ['consumable', 'equipment', 'labour', 'vehicle', 'subcontract', 'overhead'];

export interface EstimateLineInput {
  category: CostCategory;
  basis: 'per_visit' | 'total';
  quantity: number; headcount: number; days: number; km: number;
  unit_cost: number; cost_per_trip: number; cost_per_km: number; cost_per_day: number;
  rate_basis: 'day' | 'hour';
}

export interface EstimateInputs {
  duration_days: number; hours_per_day: number; is_recurring: boolean; visits_per_period: number;
  visit_period: 'week' | 'month'; contract_months: number; overhead_pct: number; contingency_pct: number;
  target_margin_pct: number; proposed_price: number; margin_threshold?: number;
}

export function totalVisits(e: Pick<EstimateInputs, 'is_recurring' | 'visits_per_period' | 'visit_period' | 'contract_months'>): number {
  if (!e.is_recurring) return 1;
  const v = e.visit_period === 'week' ? e.visits_per_period * e.contract_months * 52 / 12 : e.visits_per_period * e.contract_months;
  return Math.round(v * 1000) / 1000;
}

export function lineCost(l: EstimateLineInput, hoursPerDay: number, visits: number): number {
  let base: number;
  switch (l.category) {
    case 'labour': base = l.headcount * l.days * l.unit_cost * (l.rate_basis === 'hour' ? hoursPerDay : 1); break;
    case 'vehicle': base = l.quantity * (l.cost_per_trip + l.km * l.cost_per_km) + l.days * l.cost_per_day; break;
    case 'equipment': base = l.quantity * l.days * l.unit_cost; break;
    default: base = l.quantity * l.unit_cost;
  }
  return round2(base * (l.basis === 'per_visit' ? visits : 1));
}

export interface EstimateResult {
  visits: number;
  byCategory: Record<CostCategory, number>;
  direct: number; overhead: number; contingency: number; total: number;
  breakEven: number; recommended: number; profit: number; marginPct: number;
  perVisit: number; perDay: number; perMonth: number;
  warning: 'none' | 'below_margin' | 'below_cost';
  requiresApproval: boolean;
}

export function computeEstimate(e: EstimateInputs, lines: EstimateLineInput[]): EstimateResult {
  const visits = totalVisits(e);
  const byCategory = Object.fromEntries(CATEGORIES.map((c) => [c, 0])) as Record<CostCategory, number>;
  for (const l of lines) byCategory[l.category] = round2(byCategory[l.category] + lineCost(l, e.hours_per_day, visits));
  const direct = round2(CATEGORIES.reduce((s, c) => s + byCategory[c], 0));
  const overhead = round2(direct * e.overhead_pct / 100);
  const contingency = round2(direct * e.contingency_pct / 100);
  const total = round2(direct + overhead + contingency);
  const recommended = e.target_margin_pct >= 100 ? 0 : round2(total / (1 - e.target_margin_pct / 100));
  const profit = round2(e.proposed_price - total);
  const marginPct = e.proposed_price > 0 ? Math.round((profit / e.proposed_price) * 100 * 1000) / 1000 : 0;
  const warning = e.proposed_price > 0 && e.proposed_price < total ? 'below_cost' : e.proposed_price > 0 && marginPct < e.target_margin_pct ? 'below_margin' : 'none';
  return {
    visits, byCategory, direct, overhead, contingency, total, breakEven: total, recommended, profit, marginPct,
    perVisit: visits ? round2(total / visits) : 0,
    perDay: e.duration_days * visits ? round2(total / (e.duration_days * visits)) : 0,
    perMonth: e.is_recurring ? round2(total / e.contract_months) : total,
    warning, requiresApproval: e.proposed_price > 0 && marginPct < (e.margin_threshold ?? 15),
  };
}
