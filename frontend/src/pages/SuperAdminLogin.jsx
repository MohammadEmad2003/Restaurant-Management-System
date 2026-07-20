import { useState } from 'react';
import { useNavigate, Navigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Shield, Lock, User } from 'lucide-react';
import { useAuth } from '../store/auth.js';

export default function SuperAdminLogin() {
  const { t } = useTranslation();
  const nav = useNavigate();
  const { loginSuperAdmin, loading, error, user } = useAuth();
  const [form, setForm] = useState({ username: 'superadmin', password: 'superadmin123' });

  if (user?.role === 'super_admin') return <Navigate to="/superadmin" replace />;

  const submit = async (e) => {
    e.preventDefault();
    if (await loginSuperAdmin(form.username, form.password)) nav('/superadmin');
  };

  return (
    <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', background: 'var(--bg)' }}>
      <div style={{ width: '100%', maxWidth: 420, padding: 40, borderRadius: 'var(--r-lg)', background: 'var(--surface)', border: '1px solid var(--border)', boxShadow: 'var(--shadow-lg)' }}>
        <div className="row" style={{ gap: 14, marginBottom: 28 }}>
          <div style={{ width: 52, height: 52, borderRadius: 16, background: 'var(--brand-grad)', display: 'grid', placeItems: 'center' }}>
            <Shield size={28} color="#fff" />
          </div>
          <div>
            <div style={{ fontSize: 20, fontWeight: 800 }}>Super Admin</div>
            <div className="muted" style={{ fontSize: 13 }}>{t('app.name')}</div>
          </div>
        </div>

        <h2 style={{ fontSize: 22, fontWeight: 800, marginBottom: 6 }}>Super Admin Login</h2>
        <p className="muted" style={{ marginBottom: 24 }}>Manage restaurants, licenses, and devices.</p>

        <form onSubmit={submit}>
          <div className="field">
            <label>{t('login.username')}</label>
            <div className="search" style={{ borderRadius: 'var(--r-sm)' }}>
              <User size={16} color="var(--muted)" />
              <input value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} autoFocus />
            </div>
          </div>
          <div className="field">
            <label>{t('login.password')}</label>
            <div className="search" style={{ borderRadius: 'var(--r-sm)' }}>
              <Lock size={16} color="var(--muted)" />
              <input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
            </div>
          </div>

          {error && <div className="badge badge--danger" style={{ marginBottom: 14 }}>{error}</div>}

          <button className="btn btn--primary" style={{ width: '100%', justifyContent: 'center', padding: 13 }} disabled={loading}>
            {loading ? t('login.signingIn') : 'Sign In as Super Admin'}
          </button>
        </form>

        <div style={{ marginTop: 24, textAlign: 'center' }}>
          <a href="#/login" className="muted" style={{ fontSize: 13 }}>Restaurant Login</a>
        </div>
      </div>
    </div>
  );
}
