// Role and permission matrix (spec section 3). The database enforces the same rules with RLS and RPC checks;
// the UI uses this to hide what a user cannot do.
export type Role = 'super_admin' | 'manager' | 'ops_officer' | 'sales_exec' | 'zonal_officer' | 'accountant' | 'fleet_manager' | 'driver' | 'executive';

export const ROLE_LABELS: Record<Role, string> = {
  super_admin: 'Super Admin', manager: 'Manager', ops_officer: 'Operations Officer', sales_exec: 'Sales Executive',
  zonal_officer: 'Zonal Officer', accountant: 'Accountant', fleet_manager: 'Fleet Manager', driver: 'Driver', executive: 'Executive',
};
export const ALL_ROLES = Object.keys(ROLE_LABELS) as Role[];

/** F full · C create/edit · A approve · V view · O own records only · - none */
export type Level = 'F' | 'C' | 'A' | 'V' | 'O' | '-';

export type Module =
  | 'customers' | 'leads' | 'estimates' | 'jobs_raise' | 'jobs_approve' | 'jobs_execute' | 'fleet' | 'contracts' | 'supplies'
  | 'billing' | 'accounting' | 'zonal' | 'surveys' | 'dashboard' | 'settings' | 'audit';

//                         super  manager ops   sales zonal  acct  fleet driver exec
const M: Record<Module, [Level, Level, Level, Level, Level, Level, Level, Level, Level]> = {
  customers:    ['F', 'C', 'C', 'C', 'C', 'V', '-', '-', 'V'],
  leads:        ['F', 'C', 'V', 'C', 'O', '-', '-', '-', 'V'],
  estimates:    ['F', 'A', 'C', 'C', '-', 'V', '-', '-', 'V'],
  jobs_raise:   ['F', 'C', 'C', 'C', '-', 'V', 'V', 'O', 'V'],
  jobs_approve: ['F', 'A', '-', '-', '-', '-', '-', '-', '-'],
  jobs_execute: ['F', 'C', 'C', '-', '-', '-', '-', 'O', 'V'],
  fleet:        ['F', 'V', 'V', '-', '-', 'V', 'F', 'O', 'V'],
  contracts:    ['F', 'A', 'C', 'C', '-', 'C', '-', '-', 'V'],
  supplies:     ['F', 'V', 'C', '-', '-', 'V', '-', '-', 'V'],
  billing:      ['F', 'V', 'V', 'V', '-', 'F', '-', '-', 'V'],
  accounting:   ['F', 'A', '-', '-', '-', 'F', 'C', '-', 'V'],
  zonal:        ['F', 'F', '-', '-', 'O', '-', '-', '-', 'V'],
  surveys:      ['F', 'C', 'V', 'V', '-', '-', '-', '-', 'V'],
  dashboard:    ['F', 'V', '-', '-', '-', 'V', '-', '-', 'V'],
  settings:     ['F', '-', '-', '-', '-', '-', '-', '-', '-'],
  audit:        ['F', 'V', '-', '-', '-', 'V', '-', '-', 'V'],
};
const ORDER: Role[] = ['super_admin', 'manager', 'ops_officer', 'sales_exec', 'zonal_officer', 'accountant', 'fleet_manager', 'driver', 'executive'];
const RANK: Record<Level, number> = { '-': 0, O: 1, V: 2, C: 3, A: 4, F: 5 };

export function level(roles: Role[], module: Module): Level {
  let best: Level = '-';
  for (const r of roles) {
    const l = M[module][ORDER.indexOf(r)];
    if (l && RANK[l] > RANK[best]) best = l;
  }
  return best;
}

export const canView = (roles: Role[], m: Module) => level(roles, m) !== '-';
export const canEdit = (roles: Role[], m: Module) => ['F', 'C', 'A'].includes(level(roles, m)) || (level(roles, m) === 'O' && m !== 'jobs_raise' && m !== 'fleet' && m !== 'jobs_execute');
export const canApprove = (roles: Role[], m: Module) => ['F', 'A'].includes(level(roles, m));

export function hasAny(roles: Role[], ...wanted: Role[]): boolean {
  return roles.includes('super_admin') || wanted.some((w) => roles.includes(w));
}

export const MATRIX = M;
export const MATRIX_ORDER = ORDER;
export const MODULE_LABELS: Record<Module, string> = {
  customers: 'Customers', leads: 'Leads and pipeline', estimates: 'Estimates and quotes', jobs_raise: 'Job orders: raise',
  jobs_approve: 'Job orders: approve', jobs_execute: 'Job orders: start and complete', fleet: 'Fleet and maintenance',
  contracts: 'Contracts and recurring billing', supplies: 'Supplies log', billing: 'Invoices, payments, receipts',
  accounting: 'Accounting and expenses', zonal: 'Zonal task tracker', surveys: 'Surveys', dashboard: 'Executive dashboard',
  settings: 'Settings, users, templates', audit: 'Audit log',
};

/** Home page by role (spec section 6). */
export function homePath(roles: Role[]): string {
  if (roles.includes('super_admin') || roles.includes('executive') || roles.includes('manager')) return '/dashboard';
  if (roles.includes('ops_officer')) return '/jobs/today';
  if (roles.includes('zonal_officer')) return '/zonal/my-tasks';
  if (roles.includes('driver')) return '/driver/jobs';
  if (roles.includes('accountant')) return '/finance/aging';
  if (roles.includes('fleet_manager')) return '/fleet/trucks';
  if (roles.includes('sales_exec')) return '/leads';
  return '/no-access';
}
