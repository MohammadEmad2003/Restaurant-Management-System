import { Outlet } from 'react-router-dom';
import { useEffect } from 'react';
import Sidebar from './Sidebar.jsx';
import Topbar from './Topbar.jsx';
import { useUI } from '../store/ui.js';
import { api } from '../api/client.js';
import { setCurrency } from '../utils/format.js';

export default function AppShell() {
  const sidebarOpen = useUI((s) => s.sidebarOpen);

  // Load currency from settings once.
  useEffect(() => {
    api.get('/settings').then((r) => setCurrency(r.data?.currency)).catch(() => {});
  }, []);

  return (
    <div className="app">
      <Sidebar open={sidebarOpen} />
      <div className="app__main">
        <Topbar />
        <main className="app__content">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
