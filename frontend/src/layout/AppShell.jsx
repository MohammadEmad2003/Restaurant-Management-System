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
const OFFLINE_LICENSE_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000; // once a day

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

  // Re-evaluate the rolling-validation window whenever connectivity drops —
  // reacts immediately to losing the connection.
  useEffect(() => {
    if (!online) useAuth.getState().checkOfflineAccess();
  }, [online]);

  // Also re-check once a day regardless of connectivity transitions — a
  // device that simply stays offline for a long stretch (or was already
  // offline when the app started) never fires an "online → offline" edge, so
  // without this the offline license's own expiration would never actually
  // get enforced until something else happened to flip connectivity.
  useEffect(() => {
    useAuth.getState().checkOfflineAccess();
    const id = setInterval(() => useAuth.getState().checkOfflineAccess(), OFFLINE_LICENSE_CHECK_INTERVAL_MS);
    return () => clearInterval(id);
  }, []);

  // Once the offline license has fully expired, the app stays blocked no
  // matter what the CURRENT connectivity flag says (it may only update on the
  // next transition) — but the instant the device is genuinely back online,
  // force a real logout so the only way back in is a fresh, actually-online
  // login (which re-validates the license and reactivates a new offline
  // license) rather than silently continuing on the expired one.
  useEffect(() => {
    if (online && offlineStatus?.tier === 'expired') useAuth.getState().logout();
  }, [online, offlineStatus]);

  if (offlineStatus?.tier === 'expired') {
    // evaluateOfflineAccess already supplies the exact right message for
    // whichever specific reason triggered this (restaurant license expired,
    // offline grace period ended, or the monthly online-validation deadline
    // was missed) — no need to override it with a single generic message.
    return <OfflineBlock reason={offlineStatus.reason} />;
  }
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
