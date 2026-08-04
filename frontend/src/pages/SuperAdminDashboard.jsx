import { useState, useEffect, useRef } from 'react';
import { useAuth } from '../store/auth.js';
import { useUI } from '../store/ui.js';
import { api } from '../api/client.js';
import { Modal } from '../components/ui.jsx';
import {
  Building2, Users, KeyRound, Monitor, Activity, Plus, Trash2, RefreshCw,
  PauseCircle, KeySquare, Laptop,
} from 'lucide-react';

const TABS = [
  { key: 'restaurants', label: 'Restaurants', icon: Building2 },
  { key: 'users', label: 'Users', icon: Users },
  { key: 'licenses', label: 'Licenses', icon: KeyRound },
  { key: 'devices', label: 'Devices', icon: Monitor },
  { key: 'sessions', label: 'Sessions', icon: Activity },
];

/** Matches the backend's FOREVER_DATE sentinel (see licenseService.js) —
 * shown as "Never" instead of a raw far-future date. */
const isForeverLicense = (expirationDate) => new Date(expirationDate).getFullYear() >= 9999;

export default function SuperAdminDashboard() {
  const { user, logout } = useAuth();
  const confirm = useUI((s) => s.confirm);
  const [tab, setTab] = useState('restaurants');
  const [data, setData] = useState({ restaurants: [], users: [], usersRestaurantId: '', licenses: {}, licensesRestaurantId: '', devices: [], devicesRestaurantId: '', sessions: [], sessionsRestaurantId: '', activeSessions: [], userDevices: {} });
  const [expandedUser, setExpandedUser] = useState(null);
  const [resetPasswordUser, setResetPasswordUser] = useState(null);
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
      const [restaurants, sessions] = await Promise.all([
        api.get('/superadmin/restaurants').then((r) => r.data),
        api.get('/superadmin/sessions').then((r) => r.data),
      ]);
      setData((d) => ({ ...d, restaurants, sessions }));
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

  const toggleUserDevices = async (userId) => {
    if (expandedUser === userId) { setExpandedUser(null); return; }
    setExpandedUser(userId);
    if (!data.userDevices[userId]) {
      try {
        const devices = await api.get(`/superadmin/users/${userId}/devices`).then((r) => r.data);
        setData((d) => ({ ...d, userDevices: { ...d.userDevices, [userId]: devices } }));
      } catch (e) { notify('Failed to load devices', 'danger'); }
    }
  };

  const deleteRestaurant = async (r) => {
    const ok = await confirm({
      title: 'Delete restaurant?',
      message: `Delete "${r.restaurantName}"? Its license is suspended and every active session is logged out immediately — nobody there can keep using the app. The restaurant name becomes free to reuse; its data is otherwise left in place.`,
      confirmLabel: 'Delete',
      danger: true,
    });
    if (!ok) return;
    await action('delete', `/superadmin/restaurants/${r.id}`, 'Restaurant deleted');
  };

  const suspendRestaurant = async (r) => {
    const ok = await confirm({
      title: 'Suspend restaurant?',
      message: `Suspend "${r.restaurantName}"? Every active session is logged out immediately, and nobody there can log back in until it's reactivated.`,
      confirmLabel: 'Suspend',
      danger: true,
    });
    if (!ok) return;
    await action('patch', `/superadmin/restaurants/${r.id}/suspend`, 'Suspended');
  };

  const deleteUser = async (u) => {
    const ok = await confirm({
      title: 'Delete user?',
      message: `Delete ${u.username}? Their past orders/salaries are kept for history; this only deactivates the account and revokes its sessions.`,
      confirmLabel: 'Delete',
      danger: true,
    });
    if (!ok) return;
    await action('delete', `/superadmin/users/${u.id}`, 'User deleted');
  };

  const resetPassword = async (userId, password) => {
    try {
      await api.patch(`/superadmin/users/${userId}`, { password });
      notify('Password reset — the user\'s existing sessions were revoked');
      setResetPasswordUser(null);
    } catch (e) { notify(e.response?.data?.error || 'Failed to reset password', 'danger'); }
  };

  const loadActiveSessions = async (restaurantId) => {
    try {
      const activeSessions = await api.get(`/superadmin/restaurants/${restaurantId}/sessions/active`).then((r) => r.data);
      setData((d) => ({ ...d, activeSessions, sessionsRestaurantId: restaurantId }));
    } catch (e) { notify('Failed to load sessions', 'danger'); }
  };

  const revokeLicense = async (lic) => {
    const ok = await confirm({
      title: 'Revoke license?',
      message: 'Revoke this license? Every user at this restaurant is immediately blocked from logging in, online or offline, until a new license is issued.',
      confirmLabel: 'Revoke',
      danger: true,
    });
    if (!ok) return;
    await action('patch', `/superadmin/licenses/${lic.restaurantId}/revoke`, 'Revoked');
  };

  const forceLogoutCashiers = async (restaurantId) => {
    const ok = await confirm({
      title: 'Force logout all cashiers?',
      message: 'Immediately log out every active cashier session at this restaurant? Anyone mid-shift will be signed out right away.',
      confirmLabel: 'Force Logout',
      danger: true,
    });
    if (!ok) return;
    await action('post', `/superadmin/restaurants/${restaurantId}/force-logout-cashiers`, 'All cashiers logged out');
  };

  const terminateSession = async (s) => {
    const ok = await confirm({
      title: 'Terminate session?',
      message: `Immediately end this ${s.userType}${s.role ? ` (${s.role})` : ''} session? The device will be signed out on its next request.`,
      confirmLabel: 'Terminate',
      danger: true,
    });
    if (!ok) return;
    await action('patch', `/superadmin/sessions/${s.id}/terminate`, 'Session terminated');
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
                      <button className="btn btn--danger btn--sm" onClick={() => suspendRestaurant(r)}><PauseCircle size={14} /></button>
                      <button className="btn btn--danger btn--sm" title="Delete restaurant" onClick={() => deleteRestaurant(r)}><Trash2 size={14} /></button>
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
                {/* Delete is a soft delete server-side (status → 'inactive',
                    keeping historical orders/salaries intact) — filtered out
                    here so a deleted user actually disappears from view
                    instead of lingering in the list. Suspended users still
                    show (with an Activate button) since suspend is meant to
                    be visibly reversible; delete is not. */}
                {data.users.filter((u) => u.status !== 'inactive').map((u) => (
                  <div key={u.id} className="card" style={{ padding: 16 }}>
                    <div style={{ fontWeight: 700 }}>{u.username}</div>
                    <div className="muted" style={{ fontSize: 12, marginBottom: 8 }}>{u.role} · {u.status} · restaurant {u.restaurantId?.slice(0, 8)}</div>
                    <div className="row" style={{ gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
                      {u.status === 'suspended' ? (
                        <button className="btn btn--sm" onClick={() => action('patch', `/superadmin/users/${u.id}/activate`, 'Activated')}>Activate</button>
                      ) : (
                        <button className="btn btn--sm" onClick={() => action('patch', `/superadmin/users/${u.id}/suspend`, 'Suspended')}>Suspend</button>
                      )}
                      <button className="btn btn--sm" onClick={() => setResetPasswordUser(u)}><KeySquare size={13} /> Reset Password</button>
                      <button className="btn btn--sm" onClick={() => toggleUserDevices(u.id)}><Laptop size={13} /> Devices</button>
                      <button className="btn btn--danger btn--sm" onClick={() => deleteUser(u)}><Trash2 size={13} /> Delete</button>
                    </div>
                    {expandedUser === u.id && (
                      <div style={{ borderTop: '1px solid var(--border)', paddingTop: 8 }}>
                        {(data.userDevices[u.id] || []).length === 0 && <div className="muted" style={{ fontSize: 12 }}>No devices registered.</div>}
                        {(data.userDevices[u.id] || []).map((d) => (
                          <div key={d.id} className="muted" style={{ fontSize: 12, marginBottom: 4 }}>
                            {d.deviceName} ({d.operatingSystem}) · <span className={`badge badge--${d.status === 'active' ? 'success' : 'danger'}`} style={{ fontSize: 10 }}>{d.status}</span>
                          </div>
                        ))}
                      </div>
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
                    <div className="row" style={{ gap: 12, flexWrap: 'wrap', marginBottom: 4 }}>
                      <span className={`badge badge--${lic.status === 'active' ? 'success' : lic.status === 'expired' ? 'danger' : 'warning'}`}>{lic.status}</span>
                      <span className="badge" title="License Expiration — whether the restaurant's subscription is licensed to use the app at all">
                        Expires: {isForeverLicense(lic.expirationDate) ? 'Never' : new Date(lic.expirationDate).toLocaleDateString()}
                      </span>
                      <span className="badge">Devices: {lic.activeDevices}/{lic.maximumDevices}</span>
                      <span className="badge" title="Offline Access Lease — how long a device may keep working offline before it must validate online again">Offline Lease: {lic.offlineDays}d</span>
                      <span className="badge">Max Cashier Sessions: {lic.maxConcurrentCashierSessions ?? 1}</span>
                    </div>
                    <div className="row" style={{ gap: 8, flexWrap: 'wrap', marginTop: 8, marginBottom: 12 }}>
                      <button className="btn btn--sm" onClick={() => { navigator.clipboard.writeText(lic.activationToken); notify('Token copied'); }}>Copy Token</button>
                      <button className="btn btn--sm" onClick={() => action('post', `/superadmin/licenses/${lic.restaurantId}/regenerate-token`, 'Token regenerated')}>Regenerate</button>
                      <button className="btn btn--sm" onClick={() => action('post', `/superadmin/licenses/${lic.restaurantId}/set-forever`, 'License set to never expire')}>Never Expire</button>
                      <button className="btn btn--danger btn--sm" onClick={() => revokeLicense(lic)}>Revoke</button>
                    </div>
                    <LicenseDurationSettings
                      key={`${lic.id}-duration`}
                      onRenew={(days) => action('post', `/superadmin/licenses/${lic.restaurantId}/renew`, `Renewed for ${days} day(s)`, { days })}
                      onExtend={(days) => action('post', `/superadmin/licenses/${lic.restaurantId}/extend`, `Extended by ${days} day(s)`, { days })}
                      onReduce={(days) => action('post', `/superadmin/licenses/${lic.restaurantId}/reduce`, `Reduced by ${days} day(s)`, { days })}
                    />
                    <MaxDevicesSettings
                      key={`${lic.id}-devices`}
                      lic={lic}
                      onSaveMax={(count) => action('patch', `/superadmin/licenses/${lic.restaurantId}/max-devices`, 'Max devices updated', { count })}
                    />
                    <CashierSessionSettings
                      key={lic.id}
                      lic={lic}
                      onSaveMax={(count) => action('patch', `/superadmin/licenses/${lic.restaurantId}/max-concurrent-cashiers`, 'Max cashier sessions updated', { count })}
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
                {/* Delete is a soft delete server-side (status → 'revoked') —
                    filtered out here so a deleted device actually
                    disappears from view instead of lingering in the list.
                    A 'reset' device still shows (it's meant to be reusable —
                    the next login from that fingerprint reactivates it). */}
                {data.devices.filter((d) => d.status !== 'revoked').map((d) => (
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
                  <button className="btn btn--danger btn--sm" onClick={() => forceLogoutCashiers(data.sessionsRestaurantId)}>Force Logout All Cashiers</button>
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
                    <button className="btn btn--danger btn--sm" onClick={() => terminateSession(s)}>Terminate</button>
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
        </main>
      </div>

      <Modal open={modal === 'createRestaurant'} onClose={() => setModal(null)} title="Create Restaurant" footer={null}>
        <CreateRestaurantForm onClose={() => setModal(null)} onCreate={createRestaurant} />
      </Modal>
      <Modal open={modal === 'createUser'} onClose={() => setModal(null)} title="Create Restaurant User" footer={null}>
        <CreateUserForm restaurants={data.restaurants} defaultRestaurantId={data.usersRestaurantId || data.restaurants[0]?.id} onClose={() => setModal(null)} onCreate={createUser} />
      </Modal>
      <Modal open={!!resetPasswordUser} onClose={() => setResetPasswordUser(null)} title={`Reset Password — ${resetPasswordUser?.username || ''}`} footer={null}>
        <ResetPasswordForm onClose={() => setResetPasswordUser(null)} onSubmit={(password) => resetPassword(resetPasswordUser.id, password)} />
      </Modal>
    </div>
  );
}

function ResetPasswordForm({ onClose, onSubmit }) {
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    if (!password) return;
    setSubmitting(true);
    try { await onSubmit(password); } finally { setSubmitting(false); }
  };

  return (
    <div>
      <p className="muted" style={{ fontSize: 12.5, marginBottom: 12 }}>
        This immediately revokes the user's existing active sessions — a still-open device/tab will be signed out on its next request.
      </p>
      <div className="field"><label>New Password</label><input className="input" type="text" value={password} onChange={(e) => setPassword(e.target.value)} /></div>
      <div className="row" style={{ gap: 10, justifyContent: 'flex-end', marginTop: 20 }}>
        <button className="btn btn--ghost" onClick={onClose}>Cancel</button>
        <button className="btn btn--primary" disabled={submitting || !password} onClick={submit}>Save</button>
      </div>
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
    maxConcurrentCashierSessions: 1,
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
        maxConcurrentCashierSessions: form.maxConcurrentCashierSessions,
        // Offline access is merged with License Days on the backend — no
        // separate field to send. Session Timeout and Validation Interval
        // are no longer configurable here; the backend always uses its
        // fixed defaults for both.
      },
    }); } finally { setSubmitting(false); }
  };

  return (
    <div>
      <div className="field"><label>Restaurant Name</label><input className="input" value={form.restaurantName} onChange={(e) => setForm({ ...form, restaurantName: e.target.value })} /></div>
      <div className="field"><label>Admin Username</label><input className="input" value={form.adminUsername} onChange={(e) => setForm({ ...form, adminUsername: e.target.value })} /></div>
      <div className="field"><label>Admin Password</label><input className="input" value={form.adminPassword} onChange={(e) => setForm({ ...form, adminPassword: e.target.value })} /></div>
      <div className="field"><label>License Days</label><input className="input" type="number" min={1} value={form.licenseDays} onChange={(e) => setForm({ ...form, licenseDays: Number(e.target.value) })} /></div>
      <p className="muted" style={{ fontSize: 11.5, marginTop: -8, marginBottom: 14 }}>Offline access is granted for the same number of days as the license itself.</p>
      <div className="field"><label>Max Devices</label><input className="input" type="number" min={1} value={form.maxDevices} onChange={(e) => setForm({ ...form, maxDevices: Number(e.target.value) })} /></div>
      <div className="field"><label>Max Concurrent Cashier Sessions</label><input className="input" type="number" min={1} value={form.maxConcurrentCashierSessions} onChange={(e) => setForm({ ...form, maxConcurrentCashierSessions: Number(e.target.value) })} /></div>
      <div className="row" style={{ gap: 10, justifyContent: 'flex-end', marginTop: 20 }}>
        <button className="btn btn--ghost" onClick={onClose}>Cancel</button>
        <button className="btn btn--primary" disabled={submitting} onClick={submit}>Create</button>
      </div>
    </div>
  );
}

function LicenseDurationSettings({ onRenew, onExtend, onReduce }) {
  const [days, setDays] = useState(30);

  return (
    <div style={{ marginBottom: 12 }}>
      <div className="row" style={{ gap: 16, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <div className="field" style={{ margin: 0 }}>
          <label>Days</label>
          <input className="input" type="number" min={1} value={days} onChange={(e) => setDays(Number(e.target.value))} style={{ width: 100 }} />
        </div>
        <button className="btn btn--sm" title="Set the expiration to exactly this many days from now" onClick={() => days > 0 && onRenew(days)}>Renew for N days</button>
        <button className="btn btn--sm" title="Add this many days to the current expiration" onClick={() => days > 0 && onExtend(days)}>Extend by N days</button>
        <button className="btn btn--sm" title="Subtract this many days from the current expiration" onClick={() => days > 0 && onReduce(days)}>Reduce by N days</button>
      </div>
      <p className="muted" style={{ fontSize: 11.5, marginTop: 6 }}>
        Renew resets the expiration to N days from today. Extend/Reduce shift the current expiration date forward or backward by N days instead.
      </p>
    </div>
  );
}

function MaxDevicesSettings({ lic, onSaveMax }) {
  const [maxDevices, setMaxDevices] = useState(lic.maximumDevices ?? 1);

  return (
    <div className="row" style={{ gap: 16, flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: 12 }}>
      <div className="field" style={{ margin: 0 }}>
        <label>Max Devices</label>
        <input className="input" type="number" min={1} value={maxDevices} onChange={(e) => setMaxDevices(Number(e.target.value))} style={{ width: 100 }} />
      </div>
      <button className="btn btn--sm" onClick={() => onSaveMax(maxDevices)}>Save</button>
      <span className="muted" style={{ fontSize: 11.5 }}>Currently {lic.activeDevices}/{lic.maximumDevices} devices in use.</span>
    </div>
  );
}

function CashierSessionSettings({ lic, onSaveMax }) {
  const [maxSessions, setMaxSessions] = useState(lic.maxConcurrentCashierSessions ?? 1);

  return (
    <div className="row" style={{ gap: 16, flexWrap: 'wrap', alignItems: 'flex-end' }}>
      <div className="field" style={{ margin: 0 }}>
        <label>Max Concurrent Cashier Sessions</label>
        <input className="input" type="number" min={1} value={maxSessions} onChange={(e) => setMaxSessions(Number(e.target.value))} style={{ width: 100 }} />
      </div>
      <button className="btn btn--sm" onClick={() => onSaveMax(maxSessions)}>Save</button>
    </div>
  );
}

function CreateUserForm({ restaurants, defaultRestaurantId, onClose, onCreate }) {
  const [restaurantId, setRestaurantId] = useState(defaultRestaurantId || restaurants[0]?.id || '');
  const [form, setForm] = useState({ username: 'cashier', password: 'cashier123', role: 'CASHIER', name: '' });
  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    if (!restaurantId || !form.username.trim() || !form.password) return;
    setSubmitting(true);
    try {
      await onCreate(restaurantId, { username: form.username.trim(), password: form.password, role: form.role, name: form.name.trim() || undefined });
      onClose();
    } finally { setSubmitting(false); }
  };

  return (
    <div>
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
      {form.role === 'CASHIER' && (
        <div className="field"><label>Full Name (shown in Workers/Employees)</label>
          <input className="input" placeholder={form.username || 'defaults to username'} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </div>
      )}
      <div className="row" style={{ gap: 10, justifyContent: 'flex-end', marginTop: 20 }}>
        <button className="btn btn--ghost" onClick={onClose}>Cancel</button>
        <button className="btn btn--primary" disabled={submitting} onClick={submit}>Create</button>
      </div>
    </div>
  );
}
