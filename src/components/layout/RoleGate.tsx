import type { ReactNode } from 'react';
import { ShieldAlert } from 'lucide-react';
import { useAuth } from '@/lib/auth';
import type { Role } from '@/lib/permissions';
import { EmptyState } from '@/components/ui/EmptyState';

/** Renders children only for the given roles (Super Admin always passes). Use `fallback={null}` to hide quietly. */
export function RoleGate({ roles, children, fallback }: { roles: Role[]; children: ReactNode; fallback?: ReactNode }) {
  const { is, loading } = useAuth();
  if (loading) return null;
  if (is(...roles)) return <>{children}</>;
  return fallback !== undefined ? <>{fallback}</> : (
    <EmptyState icon={<ShieldAlert className="h-6 w-6" />} title="You do not have access to this page" message="Ask a Super Admin to give you the right role." />
  );
}
