import { lazy, Suspense } from 'react';
import { HashRouter, Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './store/auth.js';
import { useUI } from './store/ui.js';
import { ConfirmHost, Spinner } from './components/ui.jsx';
import AppShell from './layout/AppShell.jsx';
import Login from './pages/Login.jsx';
import SuperAdminLogin from './pages/SuperAdminLogin.jsx';
import SuperAdminDashboard from './pages/SuperAdminDashboard.jsx';
import LicenseActivation from './pages/LicenseActivation.jsx';

const Dashboard = lazy(() => import('./pages/Dashboard.jsx'));
const Orders = lazy(() => import('./pages/Orders.jsx'));
const CashierShift = lazy(() => import('./pages/CashierShift.jsx'));
const Kitchen = lazy(() => import('./pages/Kitchen.jsx'));
const Products = lazy(() => import('./pages/Products.jsx'));
const Inventory = lazy(() => import('./pages/Inventory.jsx'));
const GoodsCheck = lazy(() => import('./pages/GoodsCheck.jsx'));
const Clients = lazy(() => import('./pages/Clients.jsx'));
const Complaints = lazy(() => import('./pages/Complaints.jsx'));
const Loyalty = lazy(() => import('./pages/Loyalty.jsx'));
const Reservations = lazy(() => import('./pages/Reservations.jsx'));
const Workers = lazy(() => import('./pages/Workers.jsx'));
const Attendance = lazy(() => import('./pages/Attendance.jsx'));
const Clock = lazy(() => import('./pages/Clock.jsx'));
const Scheduling = lazy(() => import('./pages/Scheduling.jsx'));
const Finance = lazy(() => import('./pages/Finance.jsx'));
const PettyCash = lazy(() => import('./pages/PettyCash.jsx'));
const Rent = lazy(() => import('./pages/Rent.jsx'));
const CashAvances = lazy(() => import('./pages/CashAdvances.jsx'));
const Reports = lazy(() => import('./pages/Reports.jsx'));
const AuditLogs = lazy(() => import('./pages/AuditLogs.jsx'));
const Settings = lazy(() => import('./pages/Settings.jsx'));
const Sync = lazy(() => import('./pages/Sync.jsx'));

function Toast() {
  const toast = useUI((s) => s.toast);
  if (!toast) return null;
  const colors = { success: 'var(--success)', error: 'var(--danger)', info: 'var(--info)' };
  return (
    <div style={{
      position: 'fixed', bottom: 24, insetInlineEnd: 24, zIndex: 200,
      background: 'var(--surface)', border: '1px solid var(--border)', borderInlineStart: `4px solid ${colors[toast.kind]}`,
      padding: '14px 20px', borderRadius: 'var(--r-md)', boxShadow: 'var(--shadow-lg)', fontWeight: 600,
    }} className="fade-in">{toast.message}</div>
  );
}

function Protected({ children, admin }) {
  const user = useAuth((s) => s.user);
  if (!user) return <Navigate to="/login" replace />;
  if (admin && user.role !== 'admin') return <Navigate to="/" replace />;
  return children;
}

function SuperAdminProtected({ children }) {
  const user = useAuth((s) => s.user);
  if (!user || user.role !== 'super_admin') return <Navigate to="/superadmin/login" replace />;
  return children;
}

function ActivationGuard({ children }) {
  const { requiresActivation, user } = useAuth((s) => ({ requiresActivation: s.requiresActivation, user: s.user }));
  if (requiresActivation && user?.role === 'admin') return <LicenseActivation />;
  return children;
}

function RootRoute() {
  const user = useAuth((s) => s.user);
  if (!user) return <Navigate to="/login" replace />;
  if (user.role === 'super_admin') return <Navigate to="/superadmin" replace />;
  return <Dashboard />;
}

export default function App() {
  return (
    <HashRouter>
      <Toast />
      <ConfirmHost />
      <Suspense fallback={<Spinner />}>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/superadmin/login" element={<SuperAdminLogin />} />
          <Route path="/superadmin" element={<SuperAdminProtected><SuperAdminDashboard /></SuperAdminProtected>} />

          <Route element={<Protected><ActivationGuard><AppShell /></ActivationGuard></Protected>}>
            <Route index element={<RootRoute />} />
            <Route path="orders" element={<Orders />} />
            <Route path="cashier-shift" element={<CashierShift />} />
            <Route path="kitchen" element={<Kitchen />} />
            <Route path="products" element={<Protected admin><Products /></Protected>} />
            <Route path="inventory" element={<Inventory />} />
            <Route path="goods-check" element={<Protected admin><GoodsCheck /></Protected>} />
            <Route path="clients" element={<Clients />} />
            <Route path="complaints" element={<Complaints />} />
            <Route path="loyalty" element={<Loyalty />} />
            <Route path="reservations" element={<Reservations />} />
            <Route path="clock" element={<Clock />} />
            <Route path="workers" element={<Protected admin><Workers /></Protected>} />
            <Route path="attendance" element={<Protected admin><Attendance /></Protected>} />
            <Route path="scheduling" element={<Protected admin><Scheduling /></Protected>} />
            <Route path="finance" element={<Protected admin><Finance /></Protected>} />
            <Route path="petty-cash" element={<PettyCash />} />
            <Route path="rents" element={<Rent />} />
            <Route path="cash-advances" element={<CashAvances />} />
            <Route path="reports" element={<Protected admin><Reports /></Protected>} />
            <Route path="audit" element={<Protected admin><AuditLogs /></Protected>} />
            <Route path="settings" element={<Protected admin><Settings /></Protected>} />
            <Route path="sync" element={<Sync />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
    </HashRouter>
  );
}
