import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from 'react-hot-toast';
import { useEffect, lazy, Suspense } from 'react';

import { useAuthStore } from './store/authStore';
import Layout from './components/Layout';

// ─── Lazy-load tất cả page (code-split) ─────────────────────────────────────
const LoginPage          = lazy(() => import('./pages/LoginPage'));
const DashboardPage      = lazy(() => import('./pages/DashboardPage'));
const CustomersPage      = lazy(() => import('./pages/CustomersPage'));
const SalesPage          = lazy(() => import('./pages/SalesPage'));
const SalesNewPage       = lazy(() => import('./pages/SalesNewPage'));
const SalesDetailPage    = lazy(() => import('./pages/SalesDetailPage'));
const VehiclesPage       = lazy(() => import('./pages/VehiclesPage'));
const InventoryPage      = lazy(() => import('./pages/InventoryPage'));
const FinancePage        = lazy(() => import('./pages/FinancePage'));
const UsersPage          = lazy(() => import('./pages/UsersPage'));
const SparePartsPage     = lazy(() => import('./pages/SparePartsPage'));
const AccessoriesPage    = lazy(() => import('./pages/AccessoriesPage'));
const GiftsPage          = lazy(() => import('./pages/GiftsPage'));
const PromotionsPage     = lazy(() => import('./pages/PromotionsPage'));
const PurchaseOrdersPage = lazy(() => import('./pages/PurchaseOrdersPage'));
const SuppliersPage      = lazy(() => import('./pages/SuppliersPage'));
const PaymentPage        = lazy(() => import('./pages/PaymentPage'));
const CashflowPage       = lazy(() => import('./pages/CashflowPage'));
const SettingsPage       = lazy(() => import('./pages/SettingsPage'));
const ReportDailyPage    = lazy(() => import('./pages/ReportDailyPage'));
const ServiceTicketsPage = lazy(() => import('./pages/ServiceTicketsPage'));
const AccessoryOrdersPage = lazy(() => import('./pages/AccessoryOrdersPage'));
const BatteryRentalsPage = lazy(() => import('./pages/BatteryRentalsPage'));
const CashAdvancesPage   = lazy(() => import('./pages/CashAdvancesPage'));
const BranchesPage       = lazy(() => import('./pages/BranchesPage'));
const LicenseManagementPage = lazy(() => import('./pages/LicenseManagementPage'));

// ─── Loading fallback ────────────────────────────────────────────────────────
function PageLoader() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '60vh' }}>
      <div className="spinner" style={{ width: 36, height: 36 }} />
    </div>
  );
}

const qc = new QueryClient({
  defaultOptions: { queries: { retry: 1, staleTime: 30_000 } },
});

/** GitHub Pages: app nằm dưới /<tên-repo>/ — basename khớp Vite `base` */
function routerBasename(): string | undefined {
  const b = import.meta.env.BASE_URL;
  if (b === '/') return undefined;
  return b.endsWith('/') ? b.slice(0, -1) : b;
}

// Guard: kiểm tra đăng nhập — chờ init() xong rồi mới quyết định redirect
function PrivateRoute({ children }: { children: React.ReactNode }) {
  const { token, isInitialized } = useAuthStore();
  if (!isInitialized) return null;
  return token ? <>{children}</> : <Navigate to="/login" replace />;
}

// Guard: chỉ admin mới truy cập được — chặn vào URL trực tiếp
function AdminRoute({ children }: { children: React.ReactNode }) {
  const { user, isInitialized } = useAuthStore();
  if (!isInitialized) return null;
  return user?.role === 'admin' ? <>{children}</> : <Navigate to="/" replace />;
}

export default function App() {
  const { init } = useAuthStore();
  useEffect(() => { init(); }, [init]);

  return (
    <QueryClientProvider client={qc}>
      <BrowserRouter basename={routerBasename()}>
        <Suspense fallback={<PageLoader />}>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/" element={<PrivateRoute><Layout /></PrivateRoute>}>
              <Route index element={<DashboardPage />} />
              <Route path="customers"       element={<CustomersPage />} />
              <Route path="sales"           element={<SalesPage />} />
              <Route path="sales/new"       element={<SalesNewPage />} />
              <Route path="sales/:id"       element={<SalesDetailPage />} />
              <Route path="vehicles"        element={<AdminRoute><VehiclesPage /></AdminRoute>} />
              <Route path="inventory"       element={<InventoryPage />} />
              <Route path="spare-parts"     element={<SparePartsPage />} />
              <Route path="accessories"     element={<AccessoriesPage />} />
              <Route path="gifts"           element={<GiftsPage />} />
              <Route path="promotions"      element={<AdminRoute><PromotionsPage /></AdminRoute>} />
              <Route path="purchase-orders" element={<PurchaseOrdersPage />} />
              <Route path="suppliers"       element={<SuppliersPage />} />
              <Route path="services"        element={<ServiceTicketsPage />} />
              <Route path="accessory-orders" element={<AccessoryOrdersPage />} />
              <Route path="battery-rentals"  element={<BatteryRentalsPage />} />
              <Route path="cash-advances"    element={<CashAdvancesPage />} />
              <Route path="finance"         element={<FinancePage />} />
              <Route path="users"           element={<UsersPage />} />
              <Route path="settings"        element={<AdminRoute><SettingsPage /></AdminRoute>} />
              <Route path="branches"        element={<AdminRoute><BranchesPage /></AdminRoute>} />
              <Route path="license"         element={<AdminRoute><LicenseManagementPage /></AdminRoute>} />
              <Route path="payment/:orderId"    element={<PaymentPage />} />
              <Route path="accounting/cashflow" element={<CashflowPage />} />
              <Route path="reports/daily"       element={<ReportDailyPage />} />
            </Route>
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Suspense>
      </BrowserRouter>
      <Toaster position="top-right" toastOptions={{ duration: 3500 }} />
    </QueryClientProvider>
  );
}
