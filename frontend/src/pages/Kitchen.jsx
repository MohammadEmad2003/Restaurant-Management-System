import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Clock, ChefHat, CheckCircle2, Flame } from 'lucide-react';
import { api } from '../api/client.js';
import { PageHeader, Empty, Badge } from '../components/ui.jsx';
import { mmss, shortName } from '../utils/format.js';
import { useUI } from '../store/ui.js';

const NEXT = { new: 'preparing', preparing: 'ready', ready: 'served' };
const ACTION_LABEL = { new: 'Start', preparing: 'Mark Ready', ready: 'Serve' };
const COLOR = { new: 'info', preparing: 'warning', ready: 'success' };

export default function Kitchen() {
  const { t } = useTranslation();
  const lang = useUI((s) => s.lang);
  const [tickets, setTickets] = useState([]);
  const [, setTick] = useState(0);

  const load = () => api.get('/kds/tickets').then((r) => setTickets(r.data)).catch(() => {});
  useEffect(() => {
    load();
    const poll = setInterval(load, 5000);
    const timer = setInterval(() => setTick((x) => x + 1), 1000); // live timers
    return () => { clearInterval(poll); clearInterval(timer); };
  }, []);

  const advance = async (ticket) => {
    const next = NEXT[ticket.status];
    await api.patch(`/kds/tickets/${ticket.id}/status`, { status: next });
    load();
  };

  return (
    <div className="fade-in">
      <PageHeader title={<span className="row" style={{ gap: 10 }}><ChefHat size={24} /> {t('nav.kitchen')}</span>} subtitle={`${tickets.length} active tickets`}>
        <Badge kind="success"><span className="dot" /> Live</Badge>
      </PageHeader>

      {tickets.length === 0 ? (
        <Empty label="No active kitchen tickets" />
      ) : (
        <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill,minmax(260px,1fr))' }}>
          {tickets.map((ticket) => {
            const late = ticket.elapsedSeconds > 600;
            return (
              <div key={ticket.id} className="card" style={{ borderTop: `4px solid var(--${COLOR[ticket.status] === 'warning' ? 'warning' : COLOR[ticket.status] === 'success' ? 'success' : 'info'})`, overflow: 'hidden' }}>
                <div className="card__head">
                  <div className="row" style={{ gap: 8 }}>
                    {ticket.priority === 'high' && <Flame size={16} color="var(--danger)" />}
                    <span style={{ fontWeight: 800 }}>{ticket.invoiceNo}</span>
                  </div>
                  <Badge kind={COLOR[ticket.status]}>{t(`status.${ticket.status}`)}</Badge>
                </div>
                <div className="card__body">
                  {ticket.items.map((it, i) => (
                    <div key={i} className="row" style={{ gap: 8, padding: '5px 0', fontSize: 13.5 }}>
                      <span className="badge badge--brand" style={{ minWidth: 26, justifyContent: 'center' }}>{it.quantity}</span>
                      <span>{shortName(it.name, lang)}</span>
                    </div>
                  ))}
                  <div className="row between" style={{ marginTop: 14 }}>
                    <span className={`row ${late ? '' : 'muted'}`} style={{ gap: 5, fontWeight: 700, color: late ? 'var(--danger)' : undefined }}>
                      <Clock size={14} /> {mmss(ticket.elapsedSeconds)}
                    </span>
                    {NEXT[ticket.status] && (
                      <button className="btn btn--sm btn--primary" onClick={() => advance(ticket)}>
                        <CheckCircle2 size={14} /> {ACTION_LABEL[ticket.status]}
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
