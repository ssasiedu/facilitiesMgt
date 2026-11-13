import { Navigate } from 'react-router-dom';
import { useAuth } from '@/lib/auth';
import { homePath } from '@/lib/permissions';
import { FullPageSpinner } from '@/components/ui/Spinner';

/**
 * "/" sends each user to the home page their role needs (spec section 6):
 * dashboard for management, today's jobs for operations, my tasks for a zonal officer,
 * my jobs for a driver, receivables for an accountant.
 */
export default function HomePage() {
  const { roles, loading } = useAuth();
  if (loading) return <FullPageSpinner />;
  return <Navigate to={homePath(roles)} replace />;
}
