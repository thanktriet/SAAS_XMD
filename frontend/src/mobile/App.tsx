import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from 'react-hot-toast';
import { useEffect, lazy, Suspense } from 'react';

import { useAuthStore } from '../store/authStore';
import MobileLayout from './components/layout/MobileLayout';

// ─── Lazy-load pages ─────────────────────────────────────────────────────────
const LoginPage          = lazy(() => import('./pages/LoginPage'));
const DashboardPage      = lazy(() => import('./pages/DashboardPage'));
const SalesListPage      = lazy(() => import('./pages/SalesListPage'));
const SalesNewPage       = lazy(() => import('./pages/SalesNewPage'));
const SalesDetailPage    = lazy(() => import('./pages/SalesDetailPage'));
const CustomersPage      = lazy(() => import('./pages/CustomersPage'));
const CustomerDetailPage = lazy(() => import('./pages/CustomerDetailPage'));
const NotificationsPage  = lazy(() => import('./pages/NotificationsPage'));

// ─── Loading fallback ────────────────────────────────────────────────────────
function PageLoader() {
  return (
    <div className="m-page-loader">
      <div className="spinner" style={{ width: 32, height: 32 }} />
    </div>
  );
}

const qc = new QueryClient({
  defaultOptions: { queries: { retry: 1, staleTime: 30_000 } },
});

// Guard: kiểm tra đăng nhập
function PrivateRoute({ children }: { children: React.ReactNode }) {
  const { token, isInitialized } = useAuthStore();
  if (!isInitialized) return <PageLoader />;
  return token ? <>{children}</> : <Navigate to="/m/login" replace />;
}

export default function App() {
  const { init } = useAuthStore();
  useEffect(() => { init(); }, [init]);

  return (
    <QueryClientProvider client={qc}>
      <BrowserRouter>
        <Suspense fallback={<PageLoader />}>
          <Routes>
            <Route path="/m/login" element={<LoginPage />} />
            <Route path="/m" element={<PrivateRoute><MobileLayout /></PrivateRoute>}>
              <Route index element={<DashboardPage />} />
              <Route path="sales" element={<SalesListPage />} />
              <Route path="sales/new" element={<SalesNewPage />} />
              <Route path="sales/:id" element={<SalesDetailPage />} />
              <Route path="customers" element={<CustomersPage />} />
              <Route path="customers/:id" element={<CustomerDetailPage />} />
              <Route path="notifications" element={<NotificationsPage />} />
            </Route>
            <Route path="*" element={<Navigate to="/m" replace />} />
          </Routes>
        </Suspense>
      </BrowserRouter>
      <Toaster position="top-center" toastOptions={{ duration: 3000 }} />
    </QueryClientProvider>
  );
}
