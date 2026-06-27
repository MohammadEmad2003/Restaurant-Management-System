import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Clock as ClockIcon, LogIn, LogOut, User, Lock, CheckCircle2, AlertTriangle } from 'lucide-react';
import { api } from '../api/client.js';
import { Card, PageHeader } from '../components/ui.jsx';
import { shortName, time } from '../utils/format.js';
import { useUI } from '../store/ui.js';

/**
 * Shared attendance kiosk. A worker types their own username + password on the
 * device and is toggled clocked-in / clocked-out, with shift + lateness shown.
 */
export default function Clock() {
  const { t } = useTranslation();
  const lang = useUI((s) => s.lang);
  const [form, setForm] = useState({ username: '', password: '' });
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setError(null); setResult(null);
    try {
      const { data } = await api.post('/attendance/check', form);
      setResult(data);
      setForm({ username: '', password: '' });
    } catch (err) {
      setError(err.response?.data?.error || 'Failed');
    } finally { setBusy(false); }
  };

  return (
    <div className="fade-in">
      <PageHeader title={t('nav.clock', 'Clock In / Out')} subtitle={t('clock.subtitle', 'Enter your username and password to record attendance')} />
      <div style={{ maxWidth: 420, margin: '0 auto' }}>
        <Card>
          <form onSubmit={submit}>
            <div className="field">
              <label>{t('login.username', 'Username')}</label>
              <div className="search" style={{ borderRadius: 'var(--r-sm)' }}>
                <User size={16} color="var(--muted)" />
                <input value={form.username} autoFocus autoComplete="off"
                  onChange={(e) => setForm({ ...form, username: e.target.value })} />
              </div>
            </div>
            <div className="field">
              <label>{t('login.password', 'Password')}</label>
              <div className="search" style={{ borderRadius: 'var(--r-sm)' }}>
                <Lock size={16} color="var(--muted)" />
                <input type="password" value={form.password}
                  onChange={(e) => setForm({ ...form, password: e.target.value })} />
              </div>
            </div>
            <button className="btn btn--primary" style={{ width: '100%', justifyContent: 'center', padding: 13 }} disabled={busy}>
              <ClockIcon size={17} /> {busy ? t('common.loading') : t('clock.action', 'Record Attendance')}
            </button>
          </form>

          {error && (
            <div className="badge badge--danger" style={{ marginTop: 16, width: '100%', justifyContent: 'center', padding: 10 }}>
              <AlertTriangle size={14} /> {error}
            </div>
          )}

          {result && (
            <div className="fade-in" style={{ marginTop: 18, textAlign: 'center' }}>
              <div style={{ color: 'var(--success)', marginBottom: 8 }}>
                {result.action === 'clock-in' ? <LogIn size={34} /> : <LogOut size={34} />}
              </div>
              <div style={{ fontWeight: 800, fontSize: 18 }}>
                {result.action === 'clock-in' ? t('clock.welcomeIn', 'Clocked in') : t('clock.welcomeOut', 'Clocked out')} · {shortName(result.worker?.name, lang)}
              </div>
              <div className="muted" style={{ marginTop: 4 }}>
                {result.action === 'clock-in'
                  ? `${time(result.record?.checkInTime)} · ${t('clock.' + (result.record?.shift || 'day'), result.record?.shift)} shift`
                  : `${time(result.record?.checkOutTime)} · ${result.record?.totalHours || 0}h`}
              </div>
              {result.action === 'clock-in' && (
                result.record?.lateMinutes > 0
                  ? <div className="badge badge--warning" style={{ marginTop: 10 }}><AlertTriangle size={13} /> {t('clock.late', 'Late by')} {result.record.lateMinutes} {t('clock.min', 'min')}</div>
                  : <div className="badge badge--success" style={{ marginTop: 10 }}><CheckCircle2 size={13} /> {t('clock.onTime', 'On time')}</div>
              )}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
