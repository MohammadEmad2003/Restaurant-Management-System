import { useState, useEffect, useRef } from 'react';
import { useAuth } from '../store/auth.js';
import { api } from '../api/client.js';
import { Modal } from '../components/ui.jsx';
import {
  Building2, Users, KeyRound, Monitor, Activity, ScrollText, Plus, Trash2, RefreshCw,
  PauseCircle,
} from 'lucide-react';

const TABS = [
  { key: 'restaurants', label: 'Restaurants', icon: Building2 },
  { key: 'users', label: 'Users', icon: Users },
  { key: 'licenses', label: 'Licenses', icon: KeyRound },
  { key: 'devices', label: 'Devices', icon: Monitor },
  { key: 'sessions', label: 'Sessions', icon: Activity },
  { key: 'audit', label: 'Audit Logs', icon: ScrollText },
];

export default function SuperAdminDashboard() {
  const { user, logout } = useAuth();
  const [tab, setTab] = useState('restaurants');
  const [data, setData] = useState({ restaurants: [], users: [], usersRestaurantId: '', licenses: {}, licensesRestaurantId: '', devices: [], devicesRestaurantId: '', sessions: [], sessionsRestaurantId: '', activeSessions: [], audit: [] });
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [messageType, setMessageType] = useState('success');
  const [modal, setModal] = useState(null);

  const timeoutRef = useRef(null);

  const notify = (msg, type = 'success') => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    setMessage(msg);
    setMessageType(type);
    timeoutRef.current = setTimeout(() => { setMessage(''); setMessageType('success'); }, 5000);
  };

  const fetchAll = async () => {
    setLoading(true);
    try {
      const [restaurants, sessions, audit] = await Promise.all([
        api.get('/superadmin/restaurants').then((r) => r.data),
        api.get('/superadmin/sessions').then((r) => r.data),
        api.get('/superadmin/audit-logs').then((r) => r.data),
      ]);
      setData((d) => ({ ...d, restaurants, sessions, audit }));
    } catch (e) { notify('Failed to load data', 'danger'); }
    setLoading(false);
  };

  useEffect(() => {
    fetchAll();
    return () => { if (timeoutRef.current) clearTimeout(timeoutRef.current); };
  }, []);

  const createRestaurant = async (form) => {
    try {
      const res = await api.post('/superadmin/restaurants', form);
      const created = res.data.restaurant;
      notify(`Created ${created.restaurantName}. Token: ${res.data.activationToken}`);
      await fetchAll();
      setTab('users');
      await loadRestaurantUsers(created.id);
      setModal(null);
    } catch (e) { notify(e.response?.data?.error || 'Failed to create restaurant', 'danger'); }
  };

  const createUser = async (restaurantId, form) => {
    try {
      await api.post(`/superadmin/restaurants/${restaurantId}/users`, form);
      notify('User created');
      loadRestaurantUsers(restaurantId);
    } catch (e) { notify(e.response?.data?.error || 'Failed to create user', 'danger'); }
  };

  const loadRestaurantUsers = async (restaurantId) => {
    try {
      const users = await api.get(`/superadmin/restaurants/${restaurantId}/users`).then((r) => r.data);
      setData((d) => ({ ...d, users, usersRestaurantId: restaurantId }));
    } catch (e) { notify('Failed to load users', 'danger'); }
  };

  const loadLicense = async (restaurantId) => {
    try {
      const license = await api.get(`/superadmin/licenses/${restaurantId}`).then((r) => r.data);
      setData((d) => ({ ...d, licenses: { ...d.licenses, [restaurantId]: license }, licensesRestaurantId: restaurantId }));
    } catch (e) { notify('Failed to load license', 'danger'); }
  };

  const loadDevices = async (restaurantId) => {
    try {
      const devices = await api.get(`/superadmin/restaurants/${restaurantId}/devices`).then((r) => r.data);
      setData((d) => ({ ...d, devices, devicesRestaurantId: restaurantId }));
    } catch (e) { notify('Failed to load devices', 'danger'); }
  };

  const loadActiveSessions = async (restaurantId) => {
    try {
      const activeSessions = await api.get(`/superadmin/restaurants/${restaurantId}/sessions/active`).then((r) => r.data);
      setData((d) => ({ ...d, activeSessions, sessionsRestaurantId: restaurantId }));
    } catch (e) { notify('Failed to load sessions', 'danger'); }
  };

  const action = async (method, path, success, body) => {
    try {
      if (method === 'get' || body === undefined) await api[method](path);
      else await api[method](path, body);
      notify(success);
      await fetchAll();
      if (tab === 'users' && data.usersRestaurantId) await loadRestaurantUsers(data.usersRestaurantId);
      if (tab === 'licenses' && data.licensesRestaurantId) await loadLicense(data.licensesRestaurantId);
      if (tab === 'devices' && data.devicesRestaurantId) await loadDevices(data.devicesRestaurantId);
      if (tab === 'sessions' && data.sessionsRestaurantId) await loadActiveSessions(data.sessionsRestaurantId);
    } catch (e) { notify(e.response?.data?.error || 'Action failed', 'danger'); }
  };

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)' }}>
      <header style={{ padding: '18px 24px', borderBottom: '1px solid var(--border)', background: 'var(--surface)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div className="row" style={{ gap: 12 }}>
          <div style={{ width: 40, height: 40, borderRadius: 12, background: 'var(--brand-grad)', display: 'grid', placeItems: 'center' }}>
            <Activity size={20} color="#fff" />
          </div>
          <div>
            <div style={{ fontWeight: 800, fontSize: 16 }}>Super Admin Dashboard</div>
            <div className="muted" style={{ fontSize: 12 }}>{user?.username}</div>
          </div>
        </div>
        <button className="btn btn--ghost btn--sm" onClick={logout}>Logout</button>
      </header>

      <div style={{ display: 'grid', gridTemplateColumns: '240px 1fr', minHeight: 'calc(100vh - 77px)' }}>
        <aside style={{ borderInlineEnd: '1px solid var(--border)', background: 'var(--surface)', padding: 16 }}>
          {TABS.map((t) => (
            <button key={t.key} onClick={() => setTab(t.key)} className="btn" style={{ width: '100%', justifyContent: 'flex-start', gap: 10, marginBottom: 4, background: tab === t.key ? 'var(--bg-elev)' : 'transparent' }}>
              <t.icon size={18} /> {t.label}
            </button>
          ))}
        </aside>

        <main style={{ padding: 24 }}>
          {message && <div className={`badge badge--${messageType}`} style={{ marginBottom: 16 }}>{message}</div>}

          {loading && <div className="badge badge--muted" style={{ marginBottom: 16 }}>Loading…</div>}

          {tab === 'restaurants' && (
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                <h2 style={{ fontSize: 20, fontWeight: 800 }}>Restaurants</h2>
                <button className="btn btn--primary btn--sm" onClick={() => setModal('createRestaurant')}><Plus size={16} /> Create Restaurant</button>
              </div>
              <div className="card-grid">
                {data.restaurants.map((r) => (
                  <div key={r.id} className="card" style={{ padding: 16 }}>
                    <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 6 }}>{r.restaurantName}</div>
                    <div className="muted" style={{ fontSize: 12, marginBottom: 12 }}>ID: {r.id.slice(0, 8)}</div>
                    <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                      <span className={`badge badge--${r.status === 'active' ? 'success' : 'danger'}`}>{r.status}</span>
                      <button className="btn btn--ghost btn--sm" onClick={() => { setTab('users'); loadRestaurantUsers(r.id); }}>Users</button>
                      <button className="btn btn--ghost btn--sm" onClick={() => { setTab('licenses'); loadLicense(r.id); }}>License</button>
                      <button className="btn btn--ghost btn--sm" onClick={() => { setTab('devices'); loadDevices(r.id); }}>Devices</button>
                      <button className="btn btn--danger btn--sm" onClick={() => action('patch', `/superadmin/restaurants/${r.id}/suspend`, 'Suspended')}><PauseCircle size={14} /></button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {tab === 'users' && (
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                <h2 style={{ fontSize: 20, fontWeight: 800 }}>Users</h2>
                <button className="btn btn--primary btn--sm" onClick={() => setModal('createUser')}><Plus size={16} /> Create User</button>
              </div>
              <div className="field" style={{ maxWidth: 360 }}>
                <label>Restaurant</label>
                <select className="select" value={data.usersRestaurantId || ''} onChange={(e) => { const id = e.target.value; setData((d) => ({ ...d, usersRestaurantId: id })); if (id) loadRestaurantUsers(id); }}>
                  <option value="">Select a restaurant</option>
                  {data.restaurants.map((r) => <option key={r.id} value={r.id}>{r.restaurantName}</option>)}
                </select>
              </div>
              <div className="card-grid">
                {data.users.map((u) => (
                  <div key={u.id} className="card" style={{ padding: 16 }}>
                    <div style={{ fontWeight: 700 }}>{u.username}</div>
                    <div className="muted" style={{ fontSize: 12, marginBottom: 8 }}>{u.role} · {u.status}</div>
                    {u.status === 'suspended' ? (
                      <button className="btn btn--sm" onClick={() => action('patch', `/superadmin/users/${u.id}/activate`, 'Activated')}>Activate</button>
                    ) : (
                      <button className="btn btn--danger btn--sm" onClick={() => action('patch', `/superadmin/users/${u.id}/suspend`, 'Suspended')}>Suspend</button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {tab === 'licenses' && (
            <div>
              <h2 style={{ fontSize: 20, fontWeight: 800, marginBottom: 16 }}>Licenses</h2>
              <div className="field" style={{ maxWidth: 360, marginBottom: 16 }}>
                <label>Restaurant</label>
                <select className="select" value={data.licensesRestaurantId || ''} onChange={(e) => { const id = e.target.value; if (id) loadLicense(id); }}>
                  <option value="">Select a restaurant</option>
                  {data.restaurants.map((r) => <option key={r.id} value={r.id}>{r.restaurantName}</option>)}
                </select>
              </div>
              {data.licensesRestaurantId && data.licenses[data.licensesRestaurantId] && (() => {
                const lic = data.licenses[data.licensesRestaurantId];
                const restaurant = data.restaurants.find((r) => r.id === lic.restaurantId);
                return (
                  <div key={lic.id} className="card" style={{ padding: 16, marginBottom: 12 }}>
                    <div style={{ fontWeight: 700, marginBottom: 8 }}>{restaurant?.restaurantName || lic.restaurantId}</div>
                    <div className="row" style={{ gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
                      <span className={`badge badge--${lic.status === 'active' ? 'success' : lic.status === 'expired' ? 'danger' : 'warning'}`}>{lic.status}</span>
                      <span className="badge">Expires: {new Date(lic.expirationDate).toLocaleDateString()}</span>
                      <span className="badge">Devices: {lic.activeDevices}/{lic.maximumDevices}</span>
                      <span className="badge">Validation: {lic.validationIntervalHours}h</span>
                      <span className="badge">Max Cashier Sessions: {lic.maxConcurrentCashierSessions ?? 1}</span>
                      <span className="badge">Session Timeout: {lic.sessionTimeoutMinutes ?? 30}m</span>
                    </div>
                    <div className="row" style={{ gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
                      <button className="btn btn--sm" onClick={() => { navigator.clipboard.writeText(lic.activationToken); notify('Token copied'); }}>Copy Token</button>
                      <button className="btn btn--sm" onClick={() => action('post', `/superadmin/licenses/${lic.restaurantId}/regenerate-token`, 'Token regenerated')}>Regenerate</button>
                      <button className="btn btn--sm" onClick={() => action('post', `/superadmin/licenses/${lic.restaurantId}/renew`, 'Renewed')}>Renew</button>
                      <button className="btn btn--danger btn--sm" onClick={() => action('patch', `/superadmin/licenses/${lic.restaurantId}/revoke`, 'Revoked')}>Revoke</button>
                    </div>
                    <CashierSessionSettings
                      key={lic.id}
                      lic={lic}
                      onSaveMax={(count) => action('patch', `/superadmin/licenses/${lic.restaurantId}/max-concurrent-cashiers`, 'Max cashier sessions updated', { count })}
                      onSaveTimeout={(minutes) => action('patch', `/superadmin/licenses/${lic.restaurantId}/session-timeout`, 'Session timeout updated', { minutes })}
                    />
                  </div>
                );
              })()}
            </div>
          )}

          {tab === 'devices' && (
            <div>
              <h2 style={{ fontSize: 20, fontWeight: 800, marginBottom: 16 }}>Devices</h2>
              <div className="field" style={{ maxWidth: 360, marginBottom: 16 }}>
                <label>Restaurant</label>
                <select className="select" value={data.devicesRestaurantId || ''} onChange={(e) => { const id = e.target.value; if (id) loadDevices(id); }}>
                  <option value="">Select a restaurant</option>
                  {data.restaurants.map((r) => <option key={r.id} value={r.id}>{r.restaurantName}</option>)}
                </select>
              </div>
              <div className="card-grid">
                {data.devices.map((d) => (
                  <div key={d.id} className="card" style={{ padding: 16 }}>
                    <div style={{ fontWeight: 700 }}>{d.deviceName}</div>
                    <div className="muted" style={{ fontSize: 12, marginBottom: 8 }}>{d.operatingSystem} · {d.status}</div>
                    <div className="muted" style={{ fontSize: 11, marginBottom: 12 }}>Last online: {d.lastOnline ? new Date(d.lastOnline).toLocaleString() : '—'}</div>
                    <div className="row" style={{ gap: 8 }}>
                      <button className="btn btn--danger btn--sm" onClick={() => action('delete', `/superadmin/devices/${d.id}`, 'Deleted')}><Trash2 size={14} /></button>
                      <button className="btn btn--sm" onClick={() => action('patch', `/superadmin/devices/${d.id}/reset`, 'Reset')}><RefreshCw size={14} /></button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {tab === 'sessions' && (
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                <h2 style={{ fontSize: 20, fontWeight: 800 }}>Sessions</h2>
                {data.sessionsRestaurantId && (
                  <button className="btn btn--danger btn--sm" onClick={() => action('post', `/superadmin/restaurants/${data.sessionsRestaurantId}/force-logout-cashiers`, 'All cashiers logged out')}>Force Logout All Cashiers</button>
                )}
              </div>
              <div className="field" style={{ maxWidth: 360, marginBottom: 16 }}>
                <label>Restaurant (active sessions + controls)</label>
                <select className="select" value={data.sessionsRestaurantId || ''} onChange={(e) => { const id = e.target.value; if (id) loadActiveSessions(id); else setData((d) => ({ ...d, sessionsRestaurantId: '', activeSessions: [] })); }}>
                  <option value="">All (read-only overview)</option>
                  {data.restaurants.map((r) => <option key={r.id} value={r.id}>{r.restaurantName}</option>)}
                </select>
              </div>
              {data.sessionsRestaurantId ? (
                data.activeSessions.map((s) => (
                  <div key={s.id} className="card" style={{ padding: 12, marginBottom: 8, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                      <div style={{ fontWeight: 600, fontSize: 14 }}>{s.userType}{s.role ? ` · ${s.role}` : ''}</div>
                      <div className="muted" style={{ fontSize: 12 }}>{new Date(s.loginTime).toLocaleString()} · {s.status}</div>
                    </div>
                    <button className="btn btn--danger btn--sm" onClick={() => action('patch', `/superadmin/sessions/${s.id}/terminate`, 'Session terminated')}>Terminate</button>
                  </div>
                ))
              ) : (
                data.sessions.slice(0, 50).map((s) => (
                  <div key={s.id} className="card" style={{ padding: 12, marginBottom: 8, display: 'flex', justifyContent: 'space-between' }}>
                    <div>
                      <div style={{ fontWeight: 600, fontSize: 14 }}>{s.userType}</div>
                      <div className="muted" style={{ fontSize: 12 }}>{new Date(s.loginTime).toLocaleString()} · {s.status}</div>
                    </div>
                    <span className={`badge badge--${s.status === 'active' ? 'success' : 'muted'}`}>{s.status}</span>
                  </div>
                ))
              )}
            </div>
          )}

          {tab === 'audit' && (
            <div>
              <h2 style={{ fontSize: 20, fontWeight: 800, marginBottom: 16 }}>Audit Logs</h2>
              {data.audit.slice(0, 50).map((log) => (
                <div key={log.id} className="card" style={{ padding: 12, marginBottom: 8, display: 'flex', justifyContent: 'space-between' }}>
                  <div>
                    <div style={{ fontWeight: 600, fontSize: 14 }}>{log.action}</div>
                    <div className="muted" style={{ fontSize: 12 }}>{new Date(log.timestamp).toLocaleString()}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </main>
      </div>

      <Modal open={modal === 'createRestaurant'} onClose={() => setModal(null)} title="Create Restaurant" footer={null}>
        <CreateRestaurantForm onClose={() => setModal(null)} onCreate={createRestaurant} />
      </Modal>
      <Modal open={modal === 'createUser'} onClose={() => setModal(null)} title="Create Restaurant User" footer={null}>
        <CreateUserForm restaurants={data.restaurants} defaultRestaurantId={data.usersRestaurantId || data.restaurants[0]?.id} onClose={() => setModal(null)} onCreate={createUser} />
      </Modal>
    </div>
  );
}

function CreateRestaurantForm({ onClose, onCreate }) {
  const [form, setForm] = useState({
    restaurantName: '',
    adminUsername: 'admin',
    adminPassword: 'admin123',
    licenseDays: 30,
    maxDevices: 2,
    offlineDays: 7,
    validationIntervalHours: 24,
    maxConcurrentCashierSessions: 1,
    sessionTimeoutMinutes: 30,
  });
  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    if (!form.restaurantName.trim()) return;
    setSubmitting(true);
    try { await onCreate({
      restaurantName: form.restaurantName.trim(),
      adminUsername: form.adminUsername.trim(),
      adminPassword: form.adminPassword,
      license: {
        days: form.licenseDays,
        maximumDevices: form.maxDevices,
        offlineDays: form.offlineDays,
        validationIntervalHours: form.validationIntervalHours,
        maxConcurrentCashierSessions: form.maxConcurrentCashierSessions,
        sessionTimeoutMinutes: form.sessionTimeoutMinutes,
      },
    }); } finally { setSubmitting(false); }
  };

  return (
    <div>
      <div className="field"><label>Restaurant Name</label><input className="input" value={form.restaurantName} onChange={(e) => setForm({ ...form, restaurantName: e.target.value })} /></div>
      <div className="field"><label>Admin Username</label><input className="input" value={form.adminUsername} onChange={(e) => setForm({ ...form, adminUsername: e.target.value })} /></div>
      <div className="field"><label>Admin Password</label><input className="input" value={form.adminPassword} onChange={(e) => setForm({ ...form, adminPassword: e.target.value })} /></div>
      <div className="field"><label>License Days</label><input className="input" type="number" min={1} value={form.licenseDays} onChange={(e) => setForm({ ...form, licenseDays: Number(e.target.value) })} /></div>
      <div className="field"><label>Max Devices</label><input className="input" type="number" min={1} value={form.maxDevices} onChange={(e) => setForm({ ...form, maxDevices: Number(e.target.value) })} /></div>
      <div className="field"><label>Offline Days</label><input className="input" type="number" min={1} value={form.offlineDays} onChange={(e) => setForm({ ...form, offlineDays: Number(e.target.value) })} /></div>
      <div className="field"><label>Validation Interval (hours)</label><input className="input" type="number" min={1} value={form.validationIntervalHours} onChange={(e) => setForm({ ...form, validationIntervalHours: Number(e.target.value) })} /></div>
      <div className="field"><label>Max Concurrent Cashier Sessions</label><input className="input" type="number" min={1} value={form.maxConcurrentCashierSessions} onChange={(e) => setForm({ ...form, maxConcurrentCashierSessions: Number(e.target.value) })} /></div>
      <div className="field"><label>Session Timeout (minutes)</label><input className="input" type="number" min={1} value={form.sessionTimeoutMinutes} onChange={(e) => setForm({ ...form, sessionTimeoutMinutes: Number(e.target.value) })} /></div>
      <div className="row" style={{ gap: 10, justifyContent: 'flex-end', marginTop: 20 }}>
        <button className="btn btn--ghost" onClick={onClose}>Cancel</button>
        <button className="btn btn--primary" disabled={submitting} onClick={submit}>Create</button>
      </div>
    </div>
  );
}

function CashierSessionSettings({ lic, onSaveMax, onSaveTimeout }) {
  const [maxSessions, setMaxSessions] = useState(lic.maxConcurrentCashierSessions ?? 1);
  const [timeoutMinutes, setTimeoutMinutes] = useState(lic.sessionTimeoutMinutes ?? 30);

  return (
    <div className="row" style={{ gap: 16, flexWrap: 'wrap', alignItems: 'flex-end' }}>
      <div className="field" style={{ margin: 0 }}>
        <label>Max Concurrent Cashier Sessions</label>
        <input className="input" type="number" min={1} value={maxSessions} onChange={(e) => setMaxSessions(Number(e.target.value))} style={{ width: 100 }} />
      </div>
      <button className="btn btn--sm" onClick={() => onSaveMax(maxSessions)}>Save</button>
      <div className="field" style={{ margin: 0 }}>
        <label>Session Timeout (minutes)</label>
        <input className="input" type="number" min={1} value={timeoutMinutes} onChange={(e) => setTimeoutMinutes(Number(e.target.value))} style={{ width: 100 }} />
      </div>
      <button className="btn btn--sm" onClick={() => onSaveTimeout(timeoutMinutes)}>Save</button>
    </div>
  );
}

function CreateUserForm({ restaurants, defaultRestaurantId, onClose, onCreate }) {
  const [restaurantId, setRestaurantId] = useState(defaultRestaurantId || restaurants[0]?.id || '');
  const [form, setForm] = useState({ username: 'cashier', password: 'cashier123', role: 'CASHIER' });
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState('');

  const submit = async () => {
    if (!restaurantId || !form.username.trim() || !form.password) return;
    setSubmitting(true);
    try {
      await onCreate(restaurantId, { username: form.username.trim(), password: form.password, role: form.role });
      setDone(`Created ${form.username.trim()}`);
      setForm({ username: '', password: '', role: form.role });
      setTimeout(() => setDone(''), 2000);
    } finally { setSubmitting(false); }
  };

  return (
    <div>
      {done && <div className="badge badge--success" style={{ marginBottom: 14 }}>{done}</div>}
      <div className="field"><label>Restaurant</label>
        <select className="select" value={restaurantId} onChange={(e) => setRestaurantId(e.target.value)}>
          {restaurants.map((r) => <option key={r.id} value={r.id}>{r.restaurantName}</option>)}
        </select>
      </div>
      <div className="field"><label>Username</label><input className="input" value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} /></div>
      <div className="field"><label>Password</label><input className="input" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} /></div>
      <div className="field"><label>Role</label>
        <select className="select" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
          <option value="ADMIN">ADMIN</option>
          <option value="CASHIER">CASHIER</option>
        </select>
      </div>
      <div className="row" style={{ gap: 10, justifyContent: 'flex-end', marginTop: 20 }}>
        <button className="btn btn--ghost" onClick={onClose}>Cancel</button>
        <button className="btn btn--primary" disabled={submitting} onClick={submit}>Create</button>
      </div>
    </div>
  );
}
