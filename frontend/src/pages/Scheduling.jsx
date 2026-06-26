import { useTranslation } from 'react-i18next';
import { CalendarRange, TrendingUp } from 'lucide-react';
import { useFetch } from '../hooks/useApi.js';
import { Card, PageHeader, Spinner, Badge } from '../components/ui.jsx';
import { shortName } from '../utils/format.js';
import { useUI } from '../store/ui.js';

export default function Scheduling() {
  const { t } = useTranslation();
  const lang = useUI((s) => s.lang);
  const { data: shifts, loading } = useFetch('/shifts', []);
  const { data: forecast } = useFetch('/shifts/forecast', []);

  if (loading) return <Spinner />;

  // group by date
  const byDate = {};
  for (const s of shifts) (byDate[s.date] ||= []).push(s);
  const dates = Object.keys(byDate).sort();

  return (
    <div className="fade-in">
      <PageHeader title={t('nav.scheduling')} subtitle="Shift planning & forecast-based staffing" />
      <div className="grid grid--2" style={{ marginBottom: 18 }}>
        <Card title={<span className="row" style={{ gap: 8 }}><CalendarRange size={16} /> Weekly Schedule</span>}>
          {dates.map((d) => (
            <div key={d} style={{ marginBottom: 14 }}>
              <div style={{ fontWeight: 700, fontSize: 12.5, color: 'var(--muted)', marginBottom: 6 }}>{new Date(d).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'short' })}</div>
              <div className="chip-row">
                {byDate[d].map((s) => (
                  <span key={s.id} className="badge badge--brand">{shortName(s.workerName, lang)} · {s.start}–{s.end}</span>
                ))}
              </div>
            </div>
          ))}
        </Card>
        <Card title={<span className="row" style={{ gap: 8 }}><TrendingUp size={16} /> Staffing Forecast</span>} sub="Based on historical order volume by hour">
          {(forecast?.recommendation || []).map((r) => (
            <div key={r.hour} className="row between" style={{ padding: '12px 0', borderBottom: '1px solid var(--border)' }}>
              <span style={{ fontWeight: 700 }}>{r.hour}</span>
              <Badge kind="warning">Peak</Badge>
              <span className="muted">Suggested: <b style={{ color: 'var(--ink)' }}>{r.suggestedStaff} staff</b></span>
            </div>
          ))}
        </Card>
      </div>
    </div>
  );
}
