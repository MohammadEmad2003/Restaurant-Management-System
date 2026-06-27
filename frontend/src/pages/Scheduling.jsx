import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CalendarRange, TrendingUp, Plus, Pencil, Trash2 } from 'lucide-react';
import { useFetch } from '../hooks/useApi.js';
import { api } from '../api/client.js';
import { Card, PageHeader, Spinner, Badge, Modal } from '../components/ui.jsx';
import { shortName } from '../utils/format.js';
import { useUI } from '../store/ui.js';

const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const blank = { workerId: '', dayOfWeek: 0, start: '12:00', end: '00:00' };

export default function Scheduling() {
  const { t } = useTranslation();
  const lang = useUI((s) => s.lang);
  const notify = useUI((s) => s.notify);
  const { data: shifts, loading, refetch } = useFetch('/shifts', []);
  const { data: forecast } = useFetch('/shifts/forecast', []);
  const { data: workers } = useFetch('/workers', []);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(blank);

  const dayName = (d) => t(`scheduling.days.${DAY_KEYS[d]}`, DAY_KEYS[d]);
  const openNew = (dow = 0) => { setEditing(null); setForm({ ...blank, dayOfWeek: dow }); setOpen(true); };
  const openEdit = (s) => { setEditing(s); setForm({ workerId: s.workerId, dayOfWeek: Number(s.dayOfWeek), start: s.start, end: s.end }); setOpen(true); };

  const save = async () => {
    if (!form.workerId) { notify(t('scheduling.fillRequired', 'Pick a worker and day'), 'error'); return; }
    const worker = (workers || []).find((w) => w.id === form.workerId);
    const payload = { ...form, dayOfWeek: Number(form.dayOfWeek), workerName: worker?.name, role: worker?.role };
    try {
      if (editing) { await api.put(`/shifts/${editing.id}`, payload); notify(t('scheduling.updated', 'Shift updated')); }
      else { await api.post('/shifts', payload); notify(t('scheduling.created', 'Shift added')); }
      setOpen(false); refetch();
    } catch (e) { notify(e.response?.data?.error || 'Failed', 'error'); }
  };

  const del = async (id) => {
    if (!window.confirm(t('scheduling.deleteConfirm', 'Delete this shift?'))) return;
    try { await api.delete(`/shifts/${id}`); notify(t('scheduling.deleted', 'Shift deleted')); refetch(); }
    catch (e) { notify(e.response?.data?.error || 'Failed', 'error'); }
  };

  if (loading) return <Spinner />;

  const byDay = {};
  for (let d = 0; d < 7; d++) byDay[d] = [];
  for (const s of shifts) (byDay[Number(s.dayOfWeek)] ||= []).push(s);

  return (
    <div className="fade-in">
      <PageHeader title={t('nav.scheduling')} subtitle={t('scheduling.subtitle', 'Weekly shift planning & forecast-based staffing')}>
        <button className="btn btn--primary" onClick={() => openNew()}><Plus size={16} /> {t('scheduling.addShift', 'Add Shift')}</button>
      </PageHeader>
      <div className="grid grid--2" style={{ marginBottom: 18 }}>
        <Card title={<span className="row" style={{ gap: 8 }}><CalendarRange size={16} /> {t('scheduling.weekly', 'Weekly Schedule')}</span>}>
          {[0, 1, 2, 3, 4, 5, 6].map((d) => (
            <div key={d} style={{ marginBottom: 14 }}>
              <div className="row between" style={{ marginBottom: 6 }}>
                <div style={{ fontWeight: 700, fontSize: 12.5, color: 'var(--muted)' }}>{dayName(d)}</div>
                <button className="btn btn--icon" style={{ padding: 2 }} title={t('scheduling.addShift', 'Add Shift')} onClick={() => openNew(d)}><Plus size={13} /></button>
              </div>
              <div className="chip-row">
                {byDay[d].length === 0 && <span className="muted" style={{ fontSize: 12 }}>{t('scheduling.dayOff', 'Day off')}</span>}
                {byDay[d].map((s) => (
                  <span key={s.id} className="badge badge--brand" style={{ gap: 8 }}>
                    {shortName(s.workerName, lang)} · <span className="ltr">{s.start}–{s.end}</span>
                    <button className="btn btn--icon" style={{ padding: 2 }} title={t('common.edit', 'Edit')} onClick={() => openEdit(s)}><Pencil size={12} /></button>
                    <button className="btn btn--icon" style={{ padding: 2 }} title={t('common.delete', 'Delete')} onClick={() => del(s.id)}><Trash2 size={12} /></button>
                  </span>
                ))}
              </div>
            </div>
          ))}
        </Card>
        <Card title={<span className="row" style={{ gap: 8 }}><TrendingUp size={16} /> {t('scheduling.forecast', 'Staffing Forecast')}</span>} sub={t('scheduling.forecastSub', 'Based on historical order volume by hour')}>
          {(forecast?.recommendation || []).map((r) => (
            <div key={r.hour} className="row between" style={{ padding: '12px 0', borderBottom: '1px solid var(--border)' }}>
              <span style={{ fontWeight: 700 }} className="ltr">{r.hour}</span>
              <Badge kind="warning">{t('scheduling.peak', 'Peak')}</Badge>
              <span className="muted">{t('scheduling.suggested', 'Suggested')}: <b style={{ color: 'var(--ink)' }}>{r.suggestedStaff} {t('scheduling.staff', 'staff')}</b></span>
            </div>
          ))}
        </Card>
      </div>

      <Modal open={open} onClose={() => setOpen(false)} title={editing ? t('scheduling.editShift', 'Edit Shift') : t('scheduling.addShift', 'Add Shift')}
        footer={<><button className="btn" onClick={() => setOpen(false)}>{t('common.cancel')}</button><button className="btn btn--primary" onClick={save}>{t('common.save')}</button></>}>
        <div className="field"><label>{t('nav.workers')}</label>
          <select className="select" value={form.workerId} onChange={(e) => setForm({ ...form, workerId: e.target.value })}>
            <option value="">—</option>
            {(workers || []).filter((w) => w.status === 'active').map((w) => <option key={w.id} value={w.id}>{shortName(w.name, lang)}</option>)}
          </select>
        </div>
        <div className="field"><label>{t('scheduling.dayOfWeek', 'Day of week')}</label>
          <select className="select" value={form.dayOfWeek} onChange={(e) => setForm({ ...form, dayOfWeek: Number(e.target.value) })}>
            {[0, 1, 2, 3, 4, 5, 6].map((d) => <option key={d} value={d}>{dayName(d)}</option>)}
          </select>
        </div>
        <div className="row" style={{ gap: 12 }}>
          <div className="field" style={{ flex: 1 }}><label>{t('scheduling.start', 'Start')}</label><input className="input ltr" type="time" value={form.start} onChange={(e) => setForm({ ...form, start: e.target.value })} /></div>
          <div className="field" style={{ flex: 1 }}><label>{t('scheduling.end', 'End')}</label><input className="input ltr" type="time" value={form.end} onChange={(e) => setForm({ ...form, end: e.target.value })} /></div>
        </div>
        <p className="muted" style={{ fontSize: 12.5 }}>{t('scheduling.shiftHint', 'Lateness is measured from the shift start. Working on an unscheduled day counts as overtime; a missed scheduled day is marked absent.')}</p>
      </Modal>
    </div>
  );
}
