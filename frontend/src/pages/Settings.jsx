import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Save, Store, MapPin, Plus, Trash2 } from 'lucide-react';
import { useFetch } from '../hooks/useApi.js';
import { api } from '../api/client.js';
import { useUI } from '../store/ui.js';
import { Card, PageHeader, Spinner, Badge } from '../components/ui.jsx';
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
      notify(t('settings.saved', 'Settings saved'));
    } catch (e) { notify(e.response?.data?.error || 'Failed', 'error'); }
  };

  const f = (k) => ({ value: form[k] ?? '', onChange: (e) => setForm({ ...form, [k]: e.target.value }) });

  return (
    <div className="fade-in">
      <PageHeader title={t('nav.settings')} subtitle={t('settings.subtitle', 'System configuration')}>
        <button className="btn btn--primary" onClick={save}><Save size={16} /> {t('common.save')}</button>
      </PageHeader>
      <div className="grid grid--2">
        <Card title={<span className="row" style={{ gap: 8 }}><Store size={16} /> {t('settings.restaurant', 'Restaurant')}</span>}>
          <div className="field"><label>{t('settings.restaurantName', 'Restaurant Name')}</label><input className="input" {...f('restaurantName')} /></div>
          <div className="field"><label>{t('settings.address', 'Address')}</label><input className="input" {...f('address')} /></div>
          <div className="field"><label>{t('settings.phone', 'Phone')}</label><input className="input ltr" {...f('phone')} /></div>
        </Card>
        <Card title={t('settings.financial', 'Financial & Localization')}>
          <div className="row" style={{ gap: 12 }}>
            <div className="field" style={{ flex: 1 }}><label>{t('settings.currency', 'Currency')}</label><input className="input" {...f('currency')} /></div>
            <div className="field" style={{ flex: 1 }}><label>{t('settings.taxRate', 'Tax Rate (%)')}</label><input className="input" type="number" value={form.taxRate ?? ''} onChange={(e) => setForm({ ...form, taxRate: Number(e.target.value) })} /></div>
          </div>
          <div className="row" style={{ gap: 12 }}>
            <div className="field" style={{ flex: 1 }}><label>{t('settings.loyaltyRate', 'Loyalty Rate (points per unit)')}</label><input className="input" type="number" step="0.01" value={form.loyaltyRate ?? ''} onChange={(e) => setForm({ ...form, loyaltyRate: Number(e.target.value) })} /></div>
            <div className="field" style={{ flex: 1 }}><label>{t('settings.defaultLanguage', 'Default Language')}</label><select className="select" {...f('language')}><option value="en">English</option><option value="ar">العربية</option></select></div>
          </div>
        </Card>
      </div>
      <Card title={t('settings.operations', 'Operations & Payroll')} style={{ marginTop: 18 }}>
        <div className="row" style={{ gap: 12 }}>
          <div className="field" style={{ flex: 1 }}><label>{t('settings.deliveryFee', 'Delivery Fee')}</label><input className="input" type="number" step="0.01" value={form.deliveryFee ?? ''} onChange={(e) => setForm({ ...form, deliveryFee: Number(e.target.value) })} /></div>
          <div className="field" style={{ flex: 1 }}><label>{t('settings.lateDeduction', 'Late Deduction (per minute)')}</label><input className="input" type="number" step="0.01" value={form.lateDeductionPerMin ?? ''} onChange={(e) => setForm({ ...form, lateDeductionPerMin: Number(e.target.value) })} /></div>
          <div className="field" style={{ flex: 1 }}><label>{t('settings.overtimeMultiplier', 'Overtime Multiplier')}</label><input className="input" type="number" step="0.1" value={form.overtimeMultiplier ?? ''} onChange={(e) => setForm({ ...form, overtimeMultiplier: Number(e.target.value) })} /></div>
        </div>
        <p className="muted" style={{ fontSize: 12.5 }}>{t('settings.opsHint', 'Delivery fee is added to phone/delivery orders (waived for walk-ins). Late deduction × late minutes is subtracted at payroll; overtime pay = hourly rate × this multiplier.')}</p>
      </Card>

      <LocationsCard />

      <Card title={t('settings.firebase', 'Firebase Connection')} style={{ marginTop: 18 }}>
        <p className="muted" style={{ fontSize: 13.5, lineHeight: 1.7 }}>
          The system runs <b>offline-first</b> on a local JSON store with mock data. To enable cloud sync, paste your Firebase
          credentials into <code>backend/.env</code> (get them from the Firebase Console → Project Settings). The sync engine
          detects the connection automatically and pushes all pending changes — no restart of your workflow required.
        </p>
      </Card>
    </div>
  );
}

/** Admin-managed governorates + areas used for customer profiling & profit-by-area. */
function LocationsCard() {
  const { t } = useTranslation();
  const notify = useUI((s) => s.notify);
  const { data: locations, refetch } = useFetch('/locations', []);
  const [gov, setGov] = useState('');
  const [area, setArea] = useState('');

  const add = async () => {
    if (!gov.trim()) { notify(t('locations.govRequired', 'Governorate is required'), 'error'); return; }
    try {
      await api.post('/locations', { governorate: gov.trim(), area: area.trim() });
      notify(t('locations.added', 'Location added'));
      setArea('');
      refetch();
    } catch (e) { notify(e.response?.data?.error || 'Failed', 'error'); }
  };
  const del = async (id) => {
    try { await api.delete(`/locations/${id}`); refetch(); }
    catch (e) { notify(e.response?.data?.error || 'Failed', 'error'); }
  };

  // group by governorate for display
  const byGov = {};
  for (const l of locations || []) (byGov[l.governorate] ||= []).push(l);

  return (
    <Card title={<span className="row" style={{ gap: 8 }}><MapPin size={16} /> {t('locations.title', 'Locations (Governorates & Areas)')}</span>}
      sub={t('locations.hint', 'Customers and delivery orders are tagged with these so you can report profit by area.')} style={{ marginTop: 18 }}>
      <div className="row" style={{ gap: 12, alignItems: 'flex-end', marginBottom: 16 }}>
        <div className="field" style={{ flex: 1, marginBottom: 0 }}><label>{t('locations.governorate', 'Governorate')}</label><input className="input" value={gov} onChange={(e) => setGov(e.target.value)} placeholder="Cairo — القاهرة" /></div>
        <div className="field" style={{ flex: 1, marginBottom: 0 }}><label>{t('locations.area', 'Area / Place')}</label><input className="input" value={area} onChange={(e) => setArea(e.target.value)} placeholder="Maadi — المعادي" /></div>
        <button className="btn btn--primary" onClick={add}><Plus size={15} /> {t('common.add')}</button>
      </div>
      {Object.keys(byGov).sort().map((g) => (
        <div key={g} style={{ marginBottom: 12 }}>
          <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 6 }}>{g}</div>
          <div className="chip-row">
            {byGov[g].map((l) => (
              <span key={l.id} className="badge" style={{ gap: 6 }}>
                {l.area || '—'}
                <button className="btn btn--icon" style={{ padding: 2 }} onClick={() => del(l.id)}><Trash2 size={12} /></button>
              </span>
            ))}
          </div>
        </div>
      ))}
      {!(locations || []).length && <div className="empty">{t('locations.none', 'No locations yet — add your governorates and areas above.')}</div>}
    </Card>
  );
}
