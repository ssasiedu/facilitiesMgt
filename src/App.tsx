import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from 'react-router-dom';
import { Toaster } from 'sonner';
import { AuthProvider } from './lib/auth';
import { SettingsProvider } from './lib/settings';
import { configMissing } from './lib/supabaseClient';
import { router } from './routes';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 30_000, retry: 1, refetchOnWindowFocus: false },
    mutations: { retry: 0 },
  },
});

function SetupNeeded() {
  return (
    <div className="flex min-h-screen items-center justify-center p-6">
      <div className="max-w-lg rounded-xl border border-amber-200 bg-amber-50 p-6 text-sm text-amber-900">
        <h1 className="mb-2 text-lg font-semibold">Almost there</h1>
        <p>Copy <code>.env.example</code> to <code>.env</code> and set <code>VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_ANON_KEY</code>, then restart <code>npm run dev</code>. On Vercel or Netlify, add them as environment variables and redeploy.</p>
      </div>
    </div>
  );
}

export default function App() {
  if (configMissing) return <SetupNeeded />;
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <SettingsProvider>
          <RouterProvider router={router} />
          <Toaster richColors position="top-center" closeButton />
        </SettingsProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
}
