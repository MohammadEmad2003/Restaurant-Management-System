import { Outlet } from 'react-router-dom';
import { useEffect } from 'react';
import { WifiOff } from 'lucide-react';
import Sidebar from './Sidebar.jsx';
import Topbar from './Topbar.jsx';
import OfflineBlock from '../components/OfflineBlock.jsx';
import { useUI } from '../store/ui.js';
import { useAuth } from '../store/auth.js';
import { useConnectivity } from '../store/connectivity.js';
import { api } from '../api/client.js';
import { setCurrency } from '../utils/format.js';

const HEARTBEAT_INTERVAL_MS = 120000;

export default function AppShell() {
  const sidebarOpen = useUI((s) => s.sidebarOpen);
  const online = useConnectivity((s) => s.online);
  const offlineStatus = useAuth((s) => s.offlineStatus);

  // Load currency from settings once.
  useEffect(() => {
    api.get('/settings').then((r) => setCurrency(r.data?.currency)).catch(() => {});
  }, []);

  // Keep the login_sessions row fresh so the idle-timeout sweep doesn't
  // release this session's concurrent-cashier slot while still in use.
  useEffect(() => {
    useAuth.getState().heartbeat();
    const id = setInterval(() => useAuth.getState().heartbeat(), HEARTBEAT_INTERVAL_MS);
    return () => clearInterval(id);
  }, []);

  // Re-evaluate the rolling-validation window whenever connectivity drops.
  useEffect(() => {
    if (!online) useAuth.getState().checkOfflineAccess();
  }, [online]);

  if (!online && (offlineStatus?.tier === 'stale' || offlineStatus?.tier === 'blocked')) {
    return <OfflineBlock reason={offlineStatus.reason} />;
  }

  return (
    <div className="app">
      <Sidebar open={sidebarOpen} />
      <div className="app__main">
        <Topbar />
        {!online && (
          <div className="badge badge--warning" style={{ margin: '8px 16px', display: 'inline-flex', gap: 6, alignItems: 'center' }}>
            <WifiOff size={14} /> Offline — using cached session
          </div>
        )}
        <main className="app__content">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
