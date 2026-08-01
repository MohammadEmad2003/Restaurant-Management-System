import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Save, Store, MapPin, Plus, Trash2, Truck } from 'lucide-react';
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
      <Card title={t('settings.loyaltyAutomation', 'Loyalty Automation')} style={{ marginTop: 18 }}>
        <div className="row" style={{ gap: 12 }}>
          <div className="field" style={{ flex: 1 }}><label>{t('settings.loyaltyMinOrderValue', 'Minimum Order Value')}</label><input className="input" type="number" step="0.01" value={form.loyaltyMinOrderValue ?? ''} onChange={(e) => setForm({ ...form, loyaltyMinOrderValue: Number(e.target.value) })} /></div>
          <div className="field" style={{ flex: 1 }}><label>{t('settings.loyaltyVisitThreshold', 'Visit Threshold')}</label><input className="input" type="number" min={0} step={1} value={form.loyaltyVisitThreshold ?? ''} onChange={(e) => setForm({ ...form, loyaltyVisitThreshold: Number(e.target.value) })} /></div>
          <div className="field" style={{ flex: 1 }}><label>{t('settings.loyaltyBonusPoints', 'Bonus Points')}</label><input className="input" type="number" min={0} step={1} value={form.loyaltyBonusPoints ?? ''} onChange={(e) => setForm({ ...form, loyaltyBonusPoints: Number(e.target.value) })} /></div>
        </div>
        <div className="row" style={{ gap: 12 }}>
          <div className="field" style={{ flex: 1 }}><label>{t('settings.loyaltyRandomChance', 'Random Reward Chance (0-1)')}</label><input className="input" type="number" min={0} max={1} step="0.01" value={form.loyaltyRandomChance ?? ''} onChange={(e) => setForm({ ...form, loyaltyRandomChance: Number(e.target.value) })} /></div>
          <div className="field" style={{ flex: 1 }}><label>{t('settings.loyaltyRandomPoints', 'Random Reward Points')}</label><input className="input" type="number" min={0} step={1} value={form.loyaltyRandomPoints ?? ''} onChange={(e) => setForm({ ...form, loyaltyRandomPoints: Number(e.target.value) })} /></div>
        </div>
        <p className="muted" style={{ fontSize: 12.5 }}>{t('settings.loyaltyAutomationHint', 'Orders above minimum value earn points based on loyalty rate. Reaching the visit threshold awards bonus points. Random chance (0-1) gives a surprise reward on each order.')}</p>
      </Card>
      <Card title={t('settings.operations', 'Operations & Payroll')} style={{ marginTop: 18 }}>
        <div className="row" style={{ gap: 12 }}>
          <div className="field" style={{ flex: 1 }}><label>{t('settings.deliveryFee', 'Delivery Fee')}</label><input className="input" type="number" step="0.01" value={form.deliveryFee ?? ''} onChange={(e) => setForm({ ...form, deliveryFee: Number(e.target.value) })} /></div>
          <div className="field" style={{ flex: 1 }}><label>{t('settings.lateDeduction', 'Late Deduction (per minute)')}</label><input className="input" type="number" step="0.01" value={form.lateDeductionPerMin ?? ''} onChange={(e) => setForm({ ...form, lateDeductionPerMin: Number(e.target.value) })} /></div>
          <div className="field" style={{ flex: 1 }}><label>{t('settings.overtimeMultiplier', 'Overtime Multiplier')}</label><input className="input" type="number" step="0.1" value={form.overtimeMultiplier ?? ''} onChange={(e) => setForm({ ...form, overtimeMultiplier: Number(e.target.value) })} /></div>
        </div>
        <p className="muted" style={{ fontSize: 12.5 }}>{t('settings.opsHint', 'Delivery fee is added to phone/delivery orders (waived for walk-ins). Late deduction × late minutes is subtracted at payroll; overtime pay = hourly rate × this multiplier.')}</p>
      </Card>

      <Card title={t('settings.posTypography', 'POS Typography')} style={{ marginTop: 18 }}>
        <div className="row" style={{ gap: 12 }}>
          <div className="field" style={{ flex: 1 }}>
            <label>{t('settings.posFontSize', 'Font Size (px)')}</label>
            <input className="input" type="number" min={10} max={32} step={1} value={form.posFontSize ?? ''} onChange={(e) => setForm({ ...form, posFontSize: Number(e.target.value) })} />
          </div>
          <div className="field" style={{ flex: 1 }}>
            <label>{t('settings.posFontFamily', 'Font Family')}</label>
            <select className="select" value={form.posFontFamily ?? 'inherit'} onChange={(e) => setForm({ ...form, posFontFamily: e.target.value })}>
              <option value="inherit">{t('settings.fontSystemDefault', 'System Default')}</option>
              <option value="arial">{t('settings.fontArial', 'Arial')}</option>
              <option value="helvetica">{t('settings.fontHelvetica', 'Helvetica')}</option>
              <option value="'courier new'">{t('settings.fontCourierNew', 'Courier New')}</option>
              <option value="georgia">{t('settings.fontGeorgia', 'Georgia')}</option>
              <option value="'times new roman'">{t('settings.fontTimesNewRoman', 'Times New Roman')}</option>
            </select>
          </div>
        </div>
      </Card>

      <LocationsCard />
      <DeliveryAgentsCard />
    </div>
  );
}

/** Admin-managed cities + areas used for customer profiling & profit-by-area. */
function LocationsCard() {
  const { t } = useTranslation();
  const notify = useUI((s) => s.notify);
  const confirm = useUI((s) => s.confirm);
  const { data: locations, refetch } = useFetch('/locations', []);
  const [city, setCity] = useState('');
  const [area, setArea] = useState('');

  const add = async () => {
    if (!city.trim()) { notify(t('locations.cityRequired', 'City is required'), 'error'); return; }
    try {
      await api.post('/locations', { city: city.trim(), area: area.trim() });
      notify(t('locations.added', 'Location added'));
      setArea('');
      refetch();
    } catch (e) { notify(e.response?.data?.error || 'Failed', 'error'); }
  };
  const del = async (id) => {
    const ok = await confirm({ message: t('locations.confirmDelete', 'Delete this location?'), danger: true, confirmLabel: t('common.delete') });
    if (!ok) return;
    try { await api.delete(`/locations/${id}`); refetch(); }
    catch (e) { notify(e.response?.data?.error || 'Failed', 'error'); }
  };

  // group by city for display
  const byCity = {};
  for (const l of locations || []) (byCity[l.city] ||= []).push(l);

  return (
    <Card title={<span className="row" style={{ gap: 8 }}><MapPin size={16} /> {t('locations.title', 'Locations (Cities & Areas)')}</span>}
      sub={t('locations.hint', 'Customers and delivery orders are tagged with these so you can report profit by area.')} style={{ marginTop: 18 }}>
      <div className="row" style={{ gap: 12, alignItems: 'flex-end', marginBottom: 16 }}>
        <div className="field" style={{ flex: 1, marginBottom: 0 }}><label>{t('locations.city', 'City')}</label><input className="input" value={city} onChange={(e) => setCity(e.target.value)} placeholder="Cairo — القاهرة" /></div>
        <div className="field" style={{ flex: 1, marginBottom: 0 }}><label>{t('locations.area', 'Area / District')}</label><input className="input" value={area} onChange={(e) => setArea(e.target.value)} placeholder="Maadi — المعادي" /></div>
        <button className="btn btn--primary" onClick={add}><Plus size={15} /> {t('common.add')}</button>
      </div>
      {Object.keys(byCity).sort().map((g) => (
        <div key={g} style={{ marginBottom: 12 }}>
          <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 6 }}>{g}</div>
          <div className="chip-row">
            {byCity[g].map((l) => (
              <span key={l.id} className="badge" style={{ gap: 6 }}>
                {l.area || '—'}
                <button className="btn btn--icon" style={{ padding: 2 }} onClick={() => del(l.id)}><Trash2 size={12} /></button>
              </span>
            ))}
          </div>
        </div>
      ))}
      {!(locations || []).length && <div className="empty">{t('locations.none', 'No locations yet — add your cities and areas above.')}</div>}
    </Card>
  );
}

/** Admin-managed delivery-agent roster, used by the POS delivery workflow and Pending Payments. */
function DeliveryAgentsCard() {
  const { t } = useTranslation();
  const notify = useUI((s) => s.notify);
  const confirm = useUI((s) => s.confirm);
  const { data: agents, refetch } = useFetch('/delivery-agents', []);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');

  const add = async () => {
    if (!name.trim()) { notify(t('deliveryAgents.nameRequired', 'Name is required'), 'error'); return; }
    try {
      await api.post('/delivery-agents', { name: name.trim(), phone: phone.trim() });
      notify(t('deliveryAgents.added', 'Delivery agent added'));
      setName(''); setPhone('');
      refetch();
    } catch (e) { notify(e.response?.data?.error || 'Failed', 'error'); }
  };
  const toggleActive = async (agent) => {
    try { await api.put(`/delivery-agents/${agent.id}`, { active: !agent.active }); refetch(); }
    catch (e) { notify(e.response?.data?.error || 'Failed', 'error'); }
  };
  const del = async (id) => {
    // Deactivating (the toggle above) is the safer everyday action — this
    // permanently removes the agent, so it needs a confirmation like every
    // other destructive delete in the app. A deleted agent's own past orders
    // are unaffected (the name/id are snapshotted onto the order at creation
    // time), but they'd immediately vanish from the Pending Payments filter
    // dropdown, so bulk-settling their remaining unpaid orders by agent stops
    // being possible — worth surfacing that instead of a silent one-click delete.
    const ok = await confirm({
      title: t('deliveryAgents.deleteTitle', 'Delete delivery agent?'),
      message: t('deliveryAgents.confirmDelete', 'Delete this delivery agent? If they still have unpaid orders, settling them by agent will no longer be possible — deactivating instead is usually safer.'),
      danger: true,
      confirmLabel: t('common.delete'),
    });
    if (!ok) return;
    try { await api.delete(`/delivery-agents/${id}`); refetch(); }
    catch (e) { notify(e.response?.data?.error || 'Failed', 'error'); }
  };

  return (
    <Card title={<span className="row" style={{ gap: 8 }}><Truck size={16} /> {t('deliveryAgents.title', 'Delivery Agents')}</span>}
      sub={t('deliveryAgents.hint', 'Agents available for assignment on delivery orders in the POS.')} style={{ marginTop: 18 }}>
      <div className="row" style={{ gap: 12, alignItems: 'flex-end', marginBottom: 16 }}>
        <div className="field" style={{ flex: 1, marginBottom: 0 }}><label>{t('common.name')}</label><input className="input" value={name} onChange={(e) => setName(e.target.value)} /></div>
        <div className="field" style={{ flex: 1, marginBottom: 0 }}><label>{t('common.phone')}</label><input className="input ltr" value={phone} onChange={(e) => setPhone(e.target.value)} /></div>
        <button className="btn btn--primary" onClick={add}><Plus size={15} /> {t('common.add')}</button>
      </div>
      <div className="chip-row">
        {(agents || []).map((a) => (
          <span key={a.id} className="badge" style={{ gap: 6, opacity: a.active ? 1 : 0.5 }}>
            {a.name}
            <button className="btn btn--icon" style={{ padding: 2 }} onClick={() => toggleActive(a)} title={a.active ? t('deliveryAgents.deactivate', 'Deactivate') : t('deliveryAgents.activate', 'Activate')}>
              {a.active ? t('common.active') : t('common.inactive')}
            </button>
            <button className="btn btn--icon" style={{ padding: 2 }} onClick={() => del(a.id)}><Trash2 size={12} /></button>
          </span>
        ))}
      </div>
      {!(agents || []).length && <div className="empty">{t('deliveryAgents.empty', 'No delivery agents yet — add one above.')}</div>}
    </Card>
  );
}
