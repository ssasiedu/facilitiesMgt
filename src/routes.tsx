import { lazy, Suspense, type ComponentType } from 'react';
import { createBrowserRouter, Navigate } from 'react-router-dom';
import { AppLayout } from './components/layout/AppLayout';
import { ProtectedRoute } from './components/layout/ProtectedRoute';
import { RoleGate } from './components/layout/RoleGate';
import { FullPageSpinner } from './components/ui/Spinner';
import { EmptyState } from './components/ui/EmptyState';
import type { Role } from './lib/permissions';

const L = (load: () => Promise<{ default: ComponentType }>) => lazy(load);

const Login = L(() => import('./pages/public/Login'));
const ResetPassword = L(() => import('./pages/public/ResetPassword'));
const PublicInvoice = L(() => import('./pages/public/PublicInvoice'));
const PublicReceipt = L(() => import('./pages/public/PublicReceipt'));
const PublicStatement = L(() => import('./pages/public/PublicStatement'));
const PublicSurvey = L(() => import('./pages/public/PublicSurvey'));

const HomePage = L(() => import('./features/dashboard/HomePage'));
const DashboardPage = L(() => import('./features/dashboard/DashboardPage'));
const CustomersPage = L(() => import('./features/customers/CustomersPage'));
const CustomerFormPage = L(() => import('./features/customers/CustomerFormPage'));
const CustomerProfilePage = L(() => import('./features/customers/CustomerProfilePage'));
const LeadsPage = L(() => import('./features/leads/LeadsPage'));
const LeadDetailPage = L(() => import('./features/leads/LeadDetailPage'));
const ServicesPage = L(() => import('./features/services/ServicesPage'));
const CostItemsPage = L(() => import('./features/estimates/CostItemsPage'));
const EstimateTemplatesPage = L(() => import('./features/estimates/EstimateTemplatesPage'));
const EstimatesPage = L(() => import('./features/estimates/EstimatesPage'));
const EstimateBuilderPage = L(() => import('./features/estimates/EstimateBuilderPage'));
const QuotationsPage = L(() => import('./features/estimates/QuotationsPage'));
const QuotationDetailPage = L(() => import('./features/estimates/QuotationDetailPage'));
const JobOrdersPage = L(() => import('./features/job-orders/JobOrdersPage'));
const JobOrderFormPage = L(() => import('./features/job-orders/JobOrderFormPage'));
const JobOrderDetailPage = L(() => import('./features/job-orders/JobOrderDetailPage'));
const DispatchCalendarPage = L(() => import('./features/job-orders/DispatchCalendarPage'));
const TodayBoardPage = L(() => import('./features/job-orders/TodayBoardPage'));
const TrucksPage = L(() => import('./features/fleet/TrucksPage'));
const TruckDetailPage = L(() => import('./features/fleet/TruckDetailPage'));
const EmployeesPage = L(() => import('./features/fleet/EmployeesPage'));
const MaintenancePage = L(() => import('./features/fleet/MaintenancePage'));
const FuelLogPage = L(() => import('./features/fleet/FuelLogPage'));
const FleetReportsPage = L(() => import('./features/fleet/FleetReportsPage'));
const ContractsPage = L(() => import('./features/contracts/ContractsPage'));
const ContractFormPage = L(() => import('./features/contracts/ContractFormPage'));
const ContractDetailPage = L(() => import('./features/contracts/ContractDetailPage'));
const UpcomingBillsPage = L(() => import('./features/contracts/UpcomingBillsPage'));
const SuppliesLogPage = L(() => import('./features/supplies/SuppliesLogPage'));
const StockPage = L(() => import('./features/supplies/StockPage'));
const InvoicesPage = L(() => import('./features/invoices/InvoicesPage'));
const InvoiceDetailPage = L(() => import('./features/invoices/InvoiceDetailPage'));
const InvoiceFormPage = L(() => import('./features/invoices/InvoiceFormPage'));
const ArAgingPage = L(() => import('./features/invoices/ArAgingPage'));
const PaymentsPage = L(() => import('./features/payments/PaymentsPage'));
const ReceiptsPage = L(() => import('./features/payments/ReceiptsPage'));
const AccountsPage = L(() => import('./features/accounting/AccountsPage'));
const JournalsPage = L(() => import('./features/accounting/JournalsPage'));
const JournalFormPage = L(() => import('./features/accounting/JournalFormPage'));
const SuppliersPage = L(() => import('./features/accounting/SuppliersPage'));
const BillsPage = L(() => import('./features/accounting/BillsPage'));
const BillFormPage = L(() => import('./features/accounting/BillFormPage'));
const ExpensesPage = L(() => import('./features/accounting/ExpensesPage'));
const BankAccountsPage = L(() => import('./features/accounting/BankAccountsPage'));
const ReportsPage = L(() => import('./features/accounting/ReportsPage'));
const PostingRulesPage = L(() => import('./features/accounting/PostingRulesPage'));
const SurveysPage = L(() => import('./features/surveys/SurveysPage'));
const SurveyReportsPage = L(() => import('./features/surveys/SurveyReportsPage'));
const MyTasksPage = L(() => import('./features/zonal/MyTasksPage'));
const PlanFormPage = L(() => import('./features/zonal/PlanFormPage'));
const TaskDetailPage = L(() => import('./features/zonal/TaskDetailPage'));
const ManagerBoardPage = L(() => import('./features/zonal/ManagerBoardPage'));
const ZonesPage = L(() => import('./features/zonal/ZonesPage'));
const MyJobsPage = L(() => import('./features/driver/MyJobsPage'));
const CompanySettingsPage = L(() => import('./features/settings/CompanySettingsPage'));
const UsersPage = L(() => import('./features/settings/UsersPage'));
const TaxesPage = L(() => import('./features/settings/TaxesPage'));
const TemplatesPage = L(() => import('./features/settings/TemplatesPage'));
const ConfigurationPage = L(() => import('./features/settings/ConfigurationPage'));
const AuditLogPage = L(() => import('./features/settings/AuditLogPage'));
const DataExportPage = L(() => import('./features/settings/DataExportPage'));
const FollowUpsPage = L(() => import('./features/settings/FollowUpsPage'));
const ProfilePage = L(() => import('./features/settings/ProfilePage'));

const gate = (roles: Role[], el: JSX.Element) => <RoleGate roles={roles}>{el}</RoleGate>;
const pub = (el: JSX.Element) => <Suspense fallback={<FullPageSpinner />}>{el}</Suspense>;

const SALES: Role[] = ['manager', 'ops_officer', 'sales_exec', 'accountant', 'executive'];
const CUST: Role[] = [...SALES, 'zonal_officer'];
const JOBS: Role[] = ['manager', 'ops_officer', 'sales_exec', 'accountant', 'fleet_manager', 'executive'];
const FLEET: Role[] = ['fleet_manager', 'manager', 'ops_officer', 'accountant', 'executive'];
const CONTRACTS: Role[] = ['manager', 'ops_officer', 'sales_exec', 'accountant', 'executive'];
const SUPPLIES: Role[] = ['manager', 'ops_officer', 'accountant', 'executive'];
const BILLING: Role[] = ['accountant', 'manager', 'ops_officer', 'sales_exec', 'executive'];
const FINANCE: Role[] = ['accountant', 'manager', 'executive'];
const EXPENSES: Role[] = ['accountant', 'manager', 'executive', 'fleet_manager'];
const MGMT: Role[] = ['manager', 'executive'];

export const router = createBrowserRouter([
  { path: '/login', element: pub(<Login />) },
  { path: '/reset-password', element: pub(<ResetPassword />) },
  { path: '/p/invoice/:token', element: pub(<PublicInvoice />) },
  { path: '/p/receipt/:token', element: pub(<PublicReceipt />) },
  { path: '/p/statement/:token', element: pub(<PublicStatement />) },
  { path: '/p/survey/:token', element: pub(<PublicSurvey />) },
  {
    path: '/',
    element: <ProtectedRoute><AppLayout /></ProtectedRoute>,
    children: [
      { index: true, element: <HomePage /> },
      { path: 'no-access', element: <EmptyState title="No role assigned yet" message="Ask a Super Admin to assign you a role in Settings > Users." /> },
      { path: 'profile', element: <ProfilePage /> },
      { path: 'dashboard', element: gate(['manager', 'executive', 'accountant'], <DashboardPage />) },
      { path: 'customers', element: gate(CUST, <CustomersPage />) },
      { path: 'customers/new', element: gate(['manager', 'ops_officer', 'sales_exec', 'zonal_officer'], <CustomerFormPage />) },
      { path: 'customers/:id', element: gate(CUST, <CustomerProfilePage />) },
      { path: 'customers/:id/edit', element: gate(['manager', 'ops_officer', 'sales_exec', 'zonal_officer'], <CustomerFormPage />) },
      { path: 'leads', element: gate(['manager', 'ops_officer', 'sales_exec', 'zonal_officer', 'executive'], <LeadsPage />) },
      { path: 'leads/:id', element: gate(['manager', 'ops_officer', 'sales_exec', 'zonal_officer', 'executive'], <LeadDetailPage />) },
      { path: 'services', element: gate(CUST, <ServicesPage />) },
      { path: 'estimates', element: gate(SALES, <EstimatesPage />) },
      { path: 'estimates/new', element: gate(['manager', 'ops_officer', 'sales_exec'], <EstimateBuilderPage />) },
      { path: 'estimates/cost-items', element: gate([...SALES, 'fleet_manager'], <CostItemsPage />) },
      { path: 'estimates/templates', element: gate(SALES, <EstimateTemplatesPage />) },
      { path: 'estimates/:id', element: gate(SALES, <EstimateBuilderPage />) },
      { path: 'quotations', element: gate(SALES, <QuotationsPage />) },
      { path: 'quotations/:id', element: gate(SALES, <QuotationDetailPage />) },
      { path: 'jobs', element: gate(JOBS, <JobOrdersPage />) },
      { path: 'jobs/new', element: gate(['manager', 'ops_officer', 'sales_exec'], <JobOrderFormPage />) },
      { path: 'jobs/calendar', element: gate(JOBS, <DispatchCalendarPage />) },
      { path: 'jobs/today', element: gate(JOBS, <TodayBoardPage />) },
      { path: 'jobs/:id', element: gate([...JOBS, 'driver'], <JobOrderDetailPage />) },
      { path: 'jobs/:id/edit', element: gate(['manager', 'ops_officer', 'sales_exec'], <JobOrderFormPage />) },
      { path: 'fleet/trucks', element: gate(FLEET, <TrucksPage />) },
      { path: 'fleet/trucks/:id', element: gate([...FLEET, 'driver'], <TruckDetailPage />) },
      { path: 'fleet/employees', element: gate(FLEET, <EmployeesPage />) },
      { path: 'fleet/maintenance', element: gate(FLEET, <MaintenancePage />) },
      { path: 'fleet/fuel', element: gate([...FLEET, 'driver'], <FuelLogPage />) },
      { path: 'fleet/reports', element: gate(FLEET, <FleetReportsPage />) },
      { path: 'contracts', element: gate(CONTRACTS, <ContractsPage />) },
      { path: 'contracts/new', element: gate(['manager', 'ops_officer', 'sales_exec', 'accountant'], <ContractFormPage />) },
      { path: 'contracts/upcoming', element: gate(CONTRACTS, <UpcomingBillsPage />) },
      { path: 'contracts/:id', element: gate(CONTRACTS, <ContractDetailPage />) },
      { path: 'contracts/:id/edit', element: gate(['manager', 'ops_officer', 'sales_exec', 'accountant'], <ContractFormPage />) },
      { path: 'supplies', element: gate(SUPPLIES, <SuppliesLogPage />) },
      { path: 'supplies/stock', element: gate(SUPPLIES, <StockPage />) },
      { path: 'finance/invoices', element: gate(BILLING, <InvoicesPage />) },
      { path: 'finance/invoices/new', element: gate(['accountant'], <InvoiceFormPage />) },
      { path: 'finance/invoices/:id', element: gate(BILLING, <InvoiceDetailPage />) },
      { path: 'finance/invoices/:id/edit', element: gate(['accountant'], <InvoiceFormPage />) },
      { path: 'finance/aging', element: gate(BILLING, <ArAgingPage />) },
      { path: 'finance/payments', element: gate(BILLING, <PaymentsPage />) },
      { path: 'finance/receipts', element: gate(BILLING, <ReceiptsPage />) },
      { path: 'finance/accounts', element: gate(FINANCE, <AccountsPage />) },
      { path: 'finance/journals', element: gate(FINANCE, <JournalsPage />) },
      { path: 'finance/journals/new', element: gate(['accountant'], <JournalFormPage />) },
      { path: 'finance/journals/:id', element: gate(FINANCE, <JournalFormPage />) },
      { path: 'finance/suppliers', element: gate(EXPENSES, <SuppliersPage />) },
      { path: 'finance/bills', element: gate(EXPENSES, <BillsPage />) },
      { path: 'finance/bills/new', element: gate(['accountant', 'fleet_manager'], <BillFormPage />) },
      { path: 'finance/bills/:id', element: gate(EXPENSES, <BillFormPage />) },
      { path: 'finance/expenses', element: gate(EXPENSES, <ExpensesPage />) },
      { path: 'finance/banks', element: gate(FINANCE, <BankAccountsPage />) },
      { path: 'finance/reports', element: gate(FINANCE, <ReportsPage />) },
      { path: 'finance/posting-rules', element: gate(FINANCE, <PostingRulesPage />) },
      { path: 'surveys', element: gate(['manager'], <SurveysPage />) },
      { path: 'surveys/reports', element: gate(['manager', 'ops_officer', 'sales_exec', 'executive'], <SurveyReportsPage />) },
      { path: 'followups', element: gate(MGMT, <FollowUpsPage />) },
      { path: 'zonal/my-tasks', element: gate(['zonal_officer', 'manager'], <MyTasksPage />) },
      { path: 'zonal/plans/new', element: gate(['zonal_officer', 'manager'], <PlanFormPage />) },
      { path: 'zonal/tasks/:id', element: gate(['zonal_officer', 'manager', 'executive'], <TaskDetailPage />) },
      { path: 'zonal/board', element: gate(MGMT, <ManagerBoardPage />) },
      { path: 'zonal/zones', element: gate(['manager'], <ZonesPage />) },
      { path: 'driver/jobs', element: gate(['driver'], <MyJobsPage />) },
      { path: 'settings', element: <Navigate to="/settings/company" replace /> },
      { path: 'settings/company', element: gate(['super_admin'], <CompanySettingsPage />) },
      { path: 'settings/users', element: gate(['super_admin'], <UsersPage />) },
      { path: 'settings/taxes', element: gate(['super_admin'], <TaxesPage />) },
      { path: 'settings/templates', element: gate(['super_admin'], <TemplatesPage />) },
      { path: 'settings/config', element: gate(['super_admin'], <ConfigurationPage />) },
      { path: 'settings/audit', element: gate(['manager', 'accountant', 'executive'], <AuditLogPage />) },
      { path: 'settings/export', element: gate(['super_admin'], <DataExportPage />) },
      { path: '*', element: <EmptyState title="Page not found" message="The page you opened does not exist." /> },
    ],
  },
]);
