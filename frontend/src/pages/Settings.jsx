import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Save, Store } from 'lucide-react';
import { useFetch } from '../hooks/useApi.js';
import { api } from '../api/client.js';
import { useUI } from '../store/ui.js';
import { Card, PageHeader, Spinner } from '../components/ui.jsx';
import { setCurrency } from '../utils/format.js';

export default function Settings() {
  const { t } = useTranslation();
  const notify = useUI((s) => s.notify);
  const { data, loading } = useFetch('/settings', []);
  const [form, setForm] = useState(null);
  useEffect(() => { if (data) setForm(data); }, [data]);

  if (loading || !form) return <Spinner />;

  const save = async () => {
    try {
      await api.put('/settings', form);
      setCurrency(form.currency);
      notify('Settings saved');
    } catch (e) { notify(e.response?.data?.error || 'Failed', 'error'); }
  };

  const f = (k) => ({ value: form[k] ?? '', onChange: (e) => setForm({ ...form, [k]: e.target.value }) });

  return (
    <div className="fade-in">
      <PageHeader title={t('nav.settings')} subtitle="System configuration">
        <button className="btn btn--primary" onClick={save}><Save size={16} /> {t('common.save')}</button>
      </PageHeader>
      <div className="grid grid--2">
        <Card title={<span className="row" style={{ gap: 8 }}><Store size={16} /> Restaurant</span>}>
          <div className="field"><label>Restaurant Name</label><input className="input" {...f('restaurantName')} /></div>
          <div className="field"><label>Address</label><input className="input" {...f('address')} /></div>
          <div className="field"><label>Phone</label><input className="input" {...f('phone')} /></div>
        </Card>
        <Card title="Financial & Localization">
          <div className="row" style={{ gap: 12 }}>
            <div className="field" style={{ flex: 1 }}><label>Currency</label><input className="input" {...f('currency')} /></div>
            <div className="field" style={{ flex: 1 }}><label>Tax Rate (%)</label><input className="input" type="number" value={form.taxRate ?? ''} onChange={(e) => setForm({ ...form, taxRate: Number(e.target.value) })} /></div>
          </div>
          <div className="row" style={{ gap: 12 }}>
            <div className="field" style={{ flex: 1 }}><label>Loyalty Rate (points per unit)</label><input className="input" type="number" step="0.01" value={form.loyaltyRate ?? ''} onChange={(e) => setForm({ ...form, loyaltyRate: Number(e.target.value) })} /></div>
            <div className="field" style={{ flex: 1 }}><label>Default Language</label><select className="select" {...f('language')}><option value="en">English</option><option value="ar">العربية</option></select></div>
          </div>
        </Card>
      </div>
      <Card title="Firebase Connection" style={{ marginTop: 18 }}>
        <p className="muted" style={{ fontSize: 13.5, lineHeight: 1.7 }}>
          The system runs <b>offline-first</b> on a local JSON store with mock data. To enable cloud sync, paste your Firebase
          credentials into <code>backend/.env</code> (get them from the Firebase Console → Project Settings). The sync engine
          detects the connection automatically and pushes all pending changes — no restart of your workflow required.
        </p>
      </Card>
    </div>
  );
}
