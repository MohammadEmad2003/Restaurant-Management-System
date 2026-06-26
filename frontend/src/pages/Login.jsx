import { useState } from 'react';
import { useNavigate, Navigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { UtensilsCrossed, Lock, User, Languages } from 'lucide-react';
import { useAuth } from '../store/auth.js';
import { useUI } from '../store/ui.js';

export default function Login() {
  const { t } = useTranslation();
  const nav = useNavigate();
  const { login, loading, error, user } = useAuth();
  const { toggleLang, lang } = useUI();
  const [form, setForm] = useState({ username: 'admin', password: 'admin123' });

  if (user) return <Navigate to="/" replace />;

  const submit = async (e) => {
    e.preventDefault();
    if (await login(form.username, form.password)) nav('/');
  };

  const demo = (username, password) => setForm({ username, password });

  return (
    <div style={{ minHeight: '100vh', display: 'grid', gridTemplateColumns: '1fr 1fr' }}>
      {/* Brand panel */}
      <div style={{
        background: 'var(--brand-grad)', color: '#fff', padding: 56,
        display: 'flex', flexDirection: 'column', justifyContent: 'space-between', position: 'relative', overflow: 'hidden',
      }}>
        <div style={{ position: 'absolute', width: 360, height: 360, borderRadius: '50%', background: 'rgba(255,255,255,.12)', top: -80, insetInlineEnd: -80 }} />
        <div style={{ position: 'absolute', width: 240, height: 240, borderRadius: '50%', background: 'rgba(255,255,255,.10)', bottom: 40, insetInlineStart: -60 }} />
        <div className="row" style={{ gap: 14, position: 'relative' }}>
          <div style={{ width: 52, height: 52, borderRadius: 16, background: 'rgba(255,255,255,.2)', display: 'grid', placeItems: 'center' }}>
            <UtensilsCrossed size={28} />
          </div>
          <div style={{ fontSize: 22, fontWeight: 800 }}>{t('app.name')}</div>
        </div>
        <div style={{ position: 'relative' }}>
          <h1 style={{ fontSize: 40, fontWeight: 800, lineHeight: 1.1, marginBottom: 16 }}>
            {lang === 'ar' ? 'أدر مطعمك بالكامل من مكان واحد' : 'Run your entire restaurant from one place'}
          </h1>
          <p style={{ fontSize: 16, opacity: 0.9, maxWidth: 420 }}>
            {lang === 'ar'
              ? 'الطلبات، المخزون، الموظفون، المالية، التقارير — يعمل حتى بدون إنترنت.'
              : 'Orders, inventory, staff, finance & reports — works even offline.'}
          </p>
          <div className="row" style={{ gap: 10, marginTop: 28, flexWrap: 'wrap' }}>
            {['POS', 'Inventory', 'CRM', 'Kitchen Display', 'Reports', 'Offline-first'].map((f) => (
              <span key={f} style={{ padding: '7px 14px', borderRadius: 99, background: 'rgba(255,255,255,.16)', fontSize: 13, fontWeight: 600 }}>{f}</span>
            ))}
          </div>
        </div>
        <div style={{ position: 'relative', opacity: 0.8, fontSize: 13 }}>© 2026 {t('app.name')}</div>
      </div>

      {/* Form panel */}
      <div className="center-screen">
        <div style={{ width: '100%', maxWidth: 380 }}>
          <button className="btn btn--ghost btn--sm" style={{ marginBottom: 18 }} onClick={toggleLang}>
            <Languages size={16} /> {lang === 'en' ? 'العربية' : 'English'}
          </button>
          <h2 style={{ fontSize: 26, fontWeight: 800, marginBottom: 6 }}>{t('login.title')}</h2>
          <p className="muted" style={{ marginBottom: 26 }}>{t('login.subtitle')}</p>

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

            {error && <div className="badge badge--danger" style={{ marginBottom: 14 }}>{t('login.error')}</div>}

            <button className="btn btn--primary" style={{ width: '100%', justifyContent: 'center', padding: 13 }} disabled={loading}>
              {loading ? t('login.signingIn') : t('login.signIn')}
            </button>
          </form>

          <div style={{ marginTop: 24 }}>
            <div className="muted" style={{ fontSize: 12, marginBottom: 8 }}>{t('login.demo')}</div>
            <div className="row" style={{ gap: 10 }}>
              <button className="btn btn--sm" style={{ flex: 1, justifyContent: 'center' }} onClick={() => demo('admin', 'admin123')}>👑 {t('login.admin')}</button>
              <button className="btn btn--sm" style={{ flex: 1, justifyContent: 'center' }} onClick={() => demo('cashier', 'cashier123')}>🧾 {t('login.cashier')}</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
