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
  const can = useAuth((s) => s.can);
  const notify = useUI((s) => s.notify);
  const [status, setStatus] = useState(null);
  const [flushing, setFlushing] = useState(false);

  const load = () => api.get('/sync/status').then((r) => setStatus(r.data)).catch(() => {});
  useEffect(() => { load(); const id = setInterval(load, 6000); return () => clearInterval(id); }, []);

  const flush = async () => {
    setFlushing(true);
    try { await api.post('/sync/flush'); notify(t('sync.flushTriggered', 'Sync flush triggered')); load(); }
    catch (e) { notify(e.response?.data?.error || 'Failed', 'error'); }
    finally { setFlushing(false); }
  };

  if (!status) return <Spinner />;

  return (
    <div className="fade-in">
      <PageHeader title={t('nav.sync')} subtitle={t('sync.subtitle', 'Offline-first synchronization engine')}>
        {can('admin') && <button className="btn btn--primary" onClick={flush} disabled={flushing}><RefreshCw size={16} className={flushing ? 'spin' : ''} /> {t('sync.flushNow', 'Flush now')}</button>}
      </PageHeader>

      <div className="grid grid--stats" style={{ marginBottom: 18 }}>
        <Stat label={t('sync.connectivity', 'Connectivity')} value={status.online ? t('common.online') : t('common.offline')} icon={status.online ? Wifi : WifiOff} color={status.online ? 'linear-gradient(135deg,#10b981,#34d399)' : 'linear-gradient(135deg,#f59e0b,#fbbf24)'} />
        <Stat label={t('sync.pendingChanges', 'Pending Changes')} value={status.pending} icon={UploadCloud} color="linear-gradient(135deg,#3b82f6,#60a5fa)" />
        <Stat label={t('sync.syncedSession', 'Synced (session)')} value={status.pushed || 0} icon={CheckCircle2} color="linear-gradient(135deg,#7c3aed,#a855f7)" />
        <Stat label={t('sync.conflictsResolved', 'Conflicts Resolved')} value={status.conflicts || 0} icon={AlertCircle} color="linear-gradient(135deg,#ef4444,#f87171)" />
      </div>

      <div className="grid grid--2">
        <Card title={<span className="row" style={{ gap: 8 }}><Database size={16} /> {t('sync.engineStatus', 'Engine Status')}</span>}>
          <Row label="Mode" value={status.online ? t('sync.modeOnline', 'Supabase (online)') : t('sync.modeOffline', 'Local JSON (offline)')} />
          <Row label="Conflict policy" value={status.policy} />
          <Row label="Last run" value={status.lastRun ? datetime(status.lastRun) : t('sync.notRunYet', 'Not run yet')} />
          <Row label="Errors" value={status.errors || 0} />
        </Card>
        <Card title={t('sync.howItWorks', 'How it works')}>
          <ol style={{ paddingInlineStart: 18, lineHeight: 1.9, fontSize: 13.5, color: 'var(--ink-2)' }}>
            <li>{t('sync.step1', 'Every write saves to the local JSON store instantly and queues in the outbox.')}</li>
            <li>{t('sync.step2', 'A monitor checks Supabase connectivity continuously.')}</li>
            <li>{t('sync.step3', 'When online, the engine flushes the outbox to Supabase.')}</li>
            <li>{t('sync.step4', `Conflicts resolve via <b>{status.policy}</b> (+ field-merge for phones/addresses, tombstones for deletes).`)}</li>
            <li>{t('sync.step5', 'Synced records are marked; no data is ever lost.')}</li>
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
