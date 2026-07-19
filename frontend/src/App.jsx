import { HashRouter, Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './store/auth.js';
import { useUI } from './store/ui.js';
import { ConfirmHost } from './components/ui.jsx';
import AppShell from './layout/AppShell.jsx';
import Login from './pages/Login.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Orders from './pages/Orders.jsx';
import CashierShift from './pages/CashierShift.jsx';
import Kitchen from './pages/Kitchen.jsx';
import Products from './pages/Products.jsx';
import Inventory from './pages/Inventory.jsx';
import GoodsCheck from './pages/GoodsCheck.jsx';
import Clients from './pages/Clients.jsx';
import Complaints from './pages/Complaints.jsx';
import Loyalty from './pages/Loyalty.jsx';
import Reservations from './pages/Reservations.jsx';
import Workers from './pages/Workers.jsx';
import Attendance from './pages/Attendance.jsx';
import Clock from './pages/Clock.jsx';
import Scheduling from './pages/Scheduling.jsx';
import Finance from './pages/Finance.jsx';
import PettyCash from './pages/PettyCash.jsx';
import Rent from './pages/Rent.jsx';
import CashAvances from './pages/CashAdvances.jsx';
import Reports from './pages/Reports.jsx';
import AuditLogs from './pages/AuditLogs.jsx';
import Settings from './pages/Settings.jsx';
import Sync from './pages/Sync.jsx';

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

export default function App() {
  return (
    <HashRouter>
      <Toast />
      <ConfirmHost />
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route element={<Protected><AppShell /></Protected>}>
          <Route index element={<Dashboard />} />
          <Route path="orders" element={<Orders />} />
          <Route path="cashier-shift" element={<CashierShift />} />
          <Route path="kitchen" element={<Kitchen />} />
          <Route path="products" element={<Protected admin><Products /></Protected>} />
          <Route path="inventory" element={<Inventory />} />
          <Route path="goods-check" element={<Protected admin><GoodsCheck /></Protected>} />
          <Route path="clients" element={<Clients />} />        <Route path="complaints" element={<Complaints />} />          <Route path="loyalty" element={<Loyalty />} />
          <Route path="reservations" element={<Reservations />} />
          <Route path="clock" element={<Clock />} />
          <Route path="workers" element={<Protected admin><Workers /></Protected>} />
          <Route path="attendance" element={<Protected admin><Attendance /></Protected>} />
          <Route path="scheduling" element={<Protected admin><Scheduling /></Protected>} />
          <Route path="finance" element={<Protected admin><Finance /></Protected>} />        <Route path="petty-cash" element={<PettyCash />} />
        <Route path="rents" element={<Rent />} />
        <Route path="cash-advances" element={<CashAvances />} />
        <Route path="reports" element={<Protected admin><Reports /></Protected>} />
          <Route path="audit" element={<Protected admin><AuditLogs /></Protected>} />
          <Route path="settings" element={<Protected admin><Settings /></Protected>} />
          <Route path="sync" element={<Sync />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </HashRouter>
  );
}
