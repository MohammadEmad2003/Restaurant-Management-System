import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { RefreshCw, Wifi, WifiOff, Database, UploadCloud, CheckCircle2, AlertCircle } from 'lucide-react';
import { api } from '../api/client.js';
import { useAuth } from '../store/auth.js';
import { useUI } from '../store/ui.js';
import { Card, PageHeader, Stat, Spinner } from '../components/ui.jsx';
import { datetime } from '../utils/format.js';

export default function Sync() {
  const { t } = useTranslation();
  const isAdmin = useAuth((s) => s.user?.role === 'admin');
  const notify = useUI((s) => s.notify);
  const [status, setStatus] = useState(null);
  const [flushing, setFlushing] = useState(false);

  const load = () => api.get('/sync/status').then((r) => setStatus(r.data)).catch(() => {});
  useEffect(() => { load(); const id = setInterval(load, 6000); return () => clearInterval(id); }, []);

  const flush = async () => {
    setFlushing(true);
    try { await api.post('/sync/flush'); notify('Sync flush triggered'); load(); }
    catch (e) { notify(e.response?.data?.error || 'Failed', 'error'); }
    finally { setFlushing(false); }
  };

  if (!status) return <Spinner />;

  return (
    <div className="fade-in">
      <PageHeader title={t('nav.sync')} subtitle="Offline-first synchronization engine">
        {isAdmin && <button className="btn btn--primary" onClick={flush} disabled={flushing}><RefreshCw size={16} className={flushing ? 'spin' : ''} /> Flush now</button>}
      </PageHeader>

      <div className="grid grid--stats" style={{ marginBottom: 18 }}>
        <Stat label="Connectivity" value={status.online ? t('common.online') : t('common.offline')} icon={status.online ? Wifi : WifiOff} color={status.online ? 'linear-gradient(135deg,#10b981,#34d399)' : 'linear-gradient(135deg,#f59e0b,#fbbf24)'} />
        <Stat label="Pending Changes" value={status.pending} icon={UploadCloud} color="linear-gradient(135deg,#3b82f6,#60a5fa)" />
        <Stat label="Synced (session)" value={status.pushed || 0} icon={CheckCircle2} color="linear-gradient(135deg,#7c3aed,#a855f7)" />
        <Stat label="Conflicts Resolved" value={status.conflicts || 0} icon={AlertCircle} color="linear-gradient(135deg,#ef4444,#f87171)" />
      </div>

      <div className="grid grid--2">
        <Card title={<span className="row" style={{ gap: 8 }}><Database size={16} /> Engine Status</span>}>
          <Row label="Mode" value={status.online ? 'Firebase (online)' : 'Local JSON (offline)'} />
          <Row label="Conflict policy" value={status.policy} />
          <Row label="Last run" value={status.lastRun ? datetime(status.lastRun) : 'Not run yet'} />
          <Row label="Errors" value={status.errors || 0} />
        </Card>
        <Card title="How it works">
          <ol style={{ paddingInlineStart: 18, lineHeight: 1.9, fontSize: 13.5, color: 'var(--ink-2)' }}>
            <li>Every write saves to the <b>local JSON store</b> instantly and queues in the <b>outbox</b>.</li>
            <li>A monitor checks Firebase connectivity continuously.</li>
            <li>When online, the engine <b>flushes</b> the outbox to Firestore.</li>
            <li>Conflicts resolve via <b>{status.policy}</b> (+ field-merge for phones/addresses, tombstones for deletes).</li>
            <li>Synced records are marked; <b>no data is ever lost</b>.</li>
          </ol>
        </Card>
      </div>
    </div>
  );
}

function Row({ label, value }) {
  return (
    <div className="row between" style={{ padding: '11px 0', borderBottom: '1px solid var(--border)' }}>
      <span className="muted">{label}</span><span style={{ fontWeight: 700, textTransform: 'capitalize' }}>{value}</span>
    </div>
  );
}
