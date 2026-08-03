import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus, CalendarClock, Users, UserX, LogIn, CheckCircle2 } from 'lucide-react';
import { useFetch } from '../hooks/useApi.js';
import { api } from '../api/client.js';
import { useUI } from '../store/ui.js';
import { Card, PageHeader, Spinner, Badge, Modal, StatusBadge } from '../components/ui.jsx';
import { shortName, datetime } from '../utils/format.js';

function nowLocalISO() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function Reservations() {
  const { t } = useTranslation();
  const lang = useUI((s) => s.lang);
  const notify = useUI((s) => s.notify);
  const { data, loading, refetch } = useFetch('/reservations', []);
  const { data: clients } = useFetch('/clients', []);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ clientId: '', partySize: 2, dateTime: '', tableId: '', notes: '' });
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (new Date(form.dateTime).getTime() < Date.now()) {
      notify(t('reservations.pastDateError'), 'error');
      return;
    }
    // Guards against a double-click creating two identical reservations for
    // the same table/time before the modal closes.
    if (saving) return;
    setSaving(true);
    try {
      await api.post('/reservations', {
        clientId: form.clientId || null,
        clientName: clients?.find((c) => c.id === form.clientId)?.name || t('reservations.guest', 'Guest'),
        partySize: Number(form.partySize), tableId: form.tableId, notes: form.notes,
        dateTime: new Date(form.dateTime).getTime(), status: 'booked',
      });
      notify(t('reservations.created', 'Reservation created'));
      setOpen(false); setForm({ clientId: '', partySize: 2, dateTime: '', tableId: '', notes: '' });
      refetch();
    } catch (e) { notify(e.response?.data?.error || 'Failed', 'error'); }
    finally { setSaving(false); }
  };

  const noShow = async (id) => { await api.patch(`/reservations/${id}/no-show`); notify(t('reservations.markedNoShow', 'Marked no-show')); refetch(); };
  const setStatus = async (id, status) => {
    try { await api.put(`/reservations/${id}`, { status }); notify(t('reservations.statusUpdated', 'Reservation updated')); refetch(); }
    catch (e) { notify(e.response?.data?.error || 'Failed', 'error'); }
  };

  if (loading || !data) return <Spinner />;
  const upcoming = [...data].filter((r) => r.dateTime >= Date.now()).sort((a, b) => a.dateTime - b.dateTime);
  const past = [...data].filter((r) => r.dateTime < Date.now()).sort((a, b) => b.dateTime - a.dateTime);

  const Item = ({ r, showNoShow }) => (
    <div className="row between" style={{ padding: '12px 0', borderBottom: '1px solid var(--border)' }}>
      <div className="row" style={{ gap: 12 }}>
        <div style={{ width: 42, height: 42, borderRadius: 12, background: 'var(--brand-100)', display: 'grid', placeItems: 'center', color: 'var(--brand-700)', fontWeight: 800 }}>{r.tableId}</div>
        <div>
          <div style={{ fontWeight: 700 }}>{shortName(r.clientName || t('reservations.guest', 'Guest'), lang)}</div>
          <div className="muted row" style={{ fontSize: 12.5, gap: 8 }}><span><CalendarClock size={12} /> {datetime(r.dateTime)}</span><span><Users size={12} /> {r.partySize}</span></div>
        </div>
      </div>
      <div className="row" style={{ gap: 6 }}>
        <StatusBadge status={r.status} />
        {r.status === 'booked' && (
          <button className="btn btn--sm" title={t('reservations.seat', 'Seat / Attended')} onClick={() => setStatus(r.id, 'seated')}><LogIn size={13} /> {t('reservations.seat', 'Seat')}</button>
        )}
        {(r.status === 'booked' || r.status === 'seated') && (
          <button className="btn btn--sm" title={t('reservations.complete', 'Complete')} onClick={() => setStatus(r.id, 'completed')}><CheckCircle2 size={13} /> {t('reservations.complete', 'Complete')}</button>
        )}
        {r.status === 'booked' && <button className="btn btn--sm btn--danger" title={t('reservations.noShow', 'No-show')} onClick={() => noShow(r.id)}><UserX size={13} /></button>}
      </div>
    </div>
  );

  return (
    <div className="fade-in">
      <PageHeader title={t('nav.reservations')} subtitle={`${upcoming.length} ${t('reservations.upcoming', 'upcoming')} · ${data.filter((r) => r.status === 'waitlist').length} ${t('reservations.waitlisted', 'waitlisted')}`}>
        <button className="btn btn--primary" onClick={() => setOpen(true)}><Plus size={16} /> {t('common.add')}</button>
      </PageHeader>

      <div className="grid grid--2">
        <Card title={`${t('reservations.upcoming', 'Upcoming')} (${upcoming.length})`}>
          {upcoming.length ? upcoming.map((r) => <Item key={r.id} r={r} showNoShow />) : <div className="empty">{t('reservations.noUpcoming', 'No upcoming reservations')}</div>}
        </Card>
        <Card title={t('reservations.history', 'History')}>
          {past.map((r) => <Item key={r.id} r={r} />)}
        </Card>
      </div>

      <Modal open={open} onClose={() => setOpen(false)} title={t('reservations.newReservation', 'New Reservation')}
        footer={<><button className="btn" onClick={() => setOpen(false)}>{t('common.cancel')}</button><button className="btn btn--primary" disabled={saving} onClick={save}>{t('common.save')}</button></>}>
        <div className="field"><label>{t('orders.customer')}</label>
          <select className="select" value={form.clientId} onChange={(e) => setForm({ ...form, clientId: e.target.value })}>
            <option value="">{t('reservations.guest', 'Guest')}</option>
            {(clients || []).map((c) => <option key={c.id} value={c.id}>{shortName(c.name, lang)}</option>)}
          </select>
        </div>
        <div className="row" style={{ gap: 12 }}>
          <div className="field" style={{ flex: 1 }}><label>{t('reservations.dateTime', 'Date & Time')}</label><input className="input" type="datetime-local" min={nowLocalISO()} value={form.dateTime} onChange={(e) => setForm({ ...form, dateTime: e.target.value })} /></div>
          <div className="field" style={{ width: 100 }}><label>{t('reservations.party', 'Party')}</label><input className="input" type="number" value={form.partySize} onChange={(e) => setForm({ ...form, partySize: e.target.value })} /></div>
        </div>
        <div className="field"><label>{t('reservations.table', 'Table')}</label><input className="input" value={form.tableId} onChange={(e) => setForm({ ...form, tableId: e.target.value })} placeholder="T5" /></div>
        <div className="field"><label>{t('common.notes', 'Notes')}</label><input className="input" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></div>
      </Modal>
    </div>
  );
}
