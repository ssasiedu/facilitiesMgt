import { BarChart3, BookOpen, Boxes, Briefcase, Building2, CalendarDays, CalendarRange, ClipboardCheck, ClipboardList, Cog, Contact, Database, FileSpreadsheet,
  FileText, Fuel, Gauge, Landmark, LayoutDashboard, ListChecks, Map, MessageSquare, Package, Receipt, ScrollText, Settings2, ShieldCheck, Sparkles, Tag, Target,
  Truck, Users, UserSquare2, Wallet, Wrench, ListTodo, Percent, Smile, Flag, Calculator, type LucideIcon } from 'lucide-react';
import { canView, hasAny, type Role } from '@/lib/permissions';

export interface NavItem { to: string; label: string; icon: LucideIcon; show: (r: Role[]) => boolean }
export interface NavGroup { label: string; items: NavItem[] }

export const NAV: NavGroup[] = [
  { label: 'Operations', items: [
    { to: '/jobs/today', label: 'Today board', icon: ClipboardCheck, show: (r) => hasAny(r, 'ops_officer', 'manager') },
    { to: '/jobs', label: 'Job orders', icon: ClipboardList, show: (r) => canView(r, 'jobs_raise') && !r.every((x) => x === 'driver') },
    { to: '/jobs/calendar', label: 'Dispatch calendar', icon: CalendarDays, show: (r) => hasAny(r, 'ops_officer', 'manager', 'fleet_manager', 'sales_exec', 'executive') },
    { to: '/contracts', label: 'Contracts', icon: ScrollText, show: (r) => canView(r, 'contracts') },
    { to: '/contracts/upcoming', label: 'Upcoming bills', icon: CalendarRange, show: (r) => canView(r, 'contracts') },
    { to: '/supplies', label: 'Supplies log', icon: Package, show: (r) => canView(r, 'supplies') },
    { to: '/supplies/stock', label: 'Stock', icon: Boxes, show: (r) => canView(r, 'supplies') },
    { to: '/driver/jobs', label: 'My jobs', icon: Truck, show: (r) => r.includes('driver') },
  ] },
  { label: 'Sales', items: [
    { to: '/customers', label: 'Customers', icon: Contact, show: (r) => canView(r, 'customers') },
    { to: '/leads', label: 'Leads', icon: Target, show: (r) => canView(r, 'leads') },
    { to: '/estimates', label: 'Estimates', icon: Calculator, show: (r) => canView(r, 'estimates') },
    { to: '/quotations', label: 'Quotations', icon: FileText, show: (r) => canView(r, 'estimates') },
    { to: '/services', label: 'Services', icon: Sparkles, show: (r) => canView(r, 'customers') || canView(r, 'estimates') },
    { to: '/estimates/cost-items', label: 'Cost catalogue', icon: Tag, show: (r) => hasAny(r, 'manager', 'accountant', 'ops_officer', 'sales_exec', 'executive') },
    { to: '/estimates/templates', label: 'Estimate templates', icon: ListChecks, show: (r) => hasAny(r, 'manager', 'accountant', 'ops_officer', 'sales_exec', 'executive') },
  ] },
  { label: 'Fleet', items: [
    { to: '/fleet/trucks', label: 'Trucks', icon: Truck, show: (r) => canView(r, 'fleet') && !r.every((x) => x === 'driver') },
    { to: '/fleet/employees', label: 'Drivers and crew', icon: UserSquare2, show: (r) => hasAny(r, 'fleet_manager', 'manager', 'ops_officer', 'accountant', 'executive') },
    { to: '/fleet/maintenance', label: 'Maintenance', icon: Wrench, show: (r) => hasAny(r, 'fleet_manager', 'manager', 'ops_officer', 'accountant', 'executive') },
    { to: '/fleet/fuel', label: 'Fuel log', icon: Fuel, show: (r) => hasAny(r, 'fleet_manager', 'manager', 'ops_officer', 'accountant', 'executive') },
    { to: '/fleet/reports', label: 'Fleet reports', icon: Gauge, show: (r) => hasAny(r, 'fleet_manager', 'manager', 'ops_officer', 'accountant', 'executive') },
  ] },
  { label: 'Finance', items: [
    { to: '/finance/invoices', label: 'Invoices', icon: FileSpreadsheet, show: (r) => canView(r, 'billing') },
    { to: '/finance/payments', label: 'Payments', icon: Wallet, show: (r) => canView(r, 'billing') },
    { to: '/finance/receipts', label: 'Receipts', icon: Receipt, show: (r) => canView(r, 'billing') },
    { to: '/finance/aging', label: 'Receivables', icon: Briefcase, show: (r) => canView(r, 'billing') },
    { to: '/finance/bills', label: 'Supplier bills', icon: FileText, show: (r) => hasAny(r, 'accountant', 'manager', 'executive', 'fleet_manager') },
    { to: '/finance/expenses', label: 'Expenses', icon: Receipt, show: (r) => hasAny(r, 'accountant', 'manager', 'executive', 'fleet_manager') },
    { to: '/finance/suppliers', label: 'Suppliers', icon: Building2, show: (r) => hasAny(r, 'accountant', 'manager', 'executive', 'fleet_manager') },
    { to: '/finance/journals', label: 'Journals', icon: BookOpen, show: (r) => hasAny(r, 'accountant', 'manager', 'executive') },
    { to: '/finance/accounts', label: 'Chart of accounts', icon: Database, show: (r) => hasAny(r, 'accountant', 'manager', 'executive') },
    { to: '/finance/banks', label: 'Bank and MoMo', icon: Landmark, show: (r) => hasAny(r, 'accountant', 'manager', 'executive') },
    { to: '/finance/posting-rules', label: 'Posting rules', icon: Settings2, show: (r) => hasAny(r, 'accountant', 'manager', 'executive') },
  ] },
  { label: 'Field Team', items: [
    { to: '/zonal/my-tasks', label: 'My tasks', icon: ListTodo, show: (r) => r.includes('zonal_officer') },
    { to: '/zonal/plans/new', label: 'New plan', icon: CalendarRange, show: (r) => r.includes('zonal_officer') || hasAny(r, 'manager') },
    { to: '/zonal/board', label: 'Field board', icon: Map, show: (r) => hasAny(r, 'manager', 'executive') },
    { to: '/zonal/zones', label: 'Zones', icon: Flag, show: (r) => hasAny(r, 'manager') },
  ] },
  { label: 'Reports', items: [
    { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard, show: (r) => canView(r, 'dashboard') },
    { to: '/finance/reports', label: 'Financial reports', icon: BarChart3, show: (r) => hasAny(r, 'accountant', 'manager', 'executive') },
    { to: '/surveys/reports', label: 'Satisfaction', icon: Smile, show: (r) => canView(r, 'surveys') },
    { to: '/followups', label: 'Follow-ups', icon: MessageSquare, show: (r) => hasAny(r, 'manager', 'executive') },
  ] },
  { label: 'Admin', items: [
    { to: '/surveys', label: 'Survey builder', icon: ListChecks, show: (r) => hasAny(r, 'manager') },
    { to: '/settings/company', label: 'Company', icon: Building2, show: (r) => r.includes('super_admin') },
    { to: '/settings/users', label: 'Users', icon: Users, show: (r) => r.includes('super_admin') },
    { to: '/settings/taxes', label: 'Taxes', icon: Percent, show: (r) => r.includes('super_admin') },
    { to: '/settings/templates', label: 'Message templates', icon: MessageSquare, show: (r) => r.includes('super_admin') },
    { to: '/settings/config', label: 'Configuration', icon: Cog, show: (r) => r.includes('super_admin') },
    { to: '/settings/audit', label: 'Audit log', icon: ShieldCheck, show: (r) => canView(r, 'audit') },
    { to: '/settings/export', label: 'Data export', icon: Database, show: (r) => r.includes('super_admin') },
  ] },
];
