import { useTranslation } from 'react-i18next';
import { ScrollText } from 'lucide-react';
import { useFetch } from '../hooks/useApi.js';
import { Card, PageHeader, Spinner, DataTable, Badge } from '../components/ui.jsx';
import { datetime, shortName } from '../utils/format.js';
import { useUI } from '../store/ui.js';

const KIND = (action = '') =>
  action.includes('DELETE') || action.includes('CANCEL') ? 'danger'
    : action.includes('CREATE') ? 'success'
    : action.includes('UPDATE') || action.includes('CHECK') ? 'warning' : 'info';

export default function AuditLogs() {
  const { t } = useTranslation();
  const lang = useUI((s) => s.lang);
  const { data, loading } = useFetch('/audit-logs', []);
  if (loading) return <Spinner />;

  return (
    <div className="fade-in">
      <PageHeader title={<span className="row" style={{ gap: 10 }}><ScrollText size={22} /> {t('nav.audit')}</span>} subtitle={`${data.length} recorded operations · append-only`} />
      <Card>
        <DataTable
          columns={[
            { key: 'timestamp', label: 'Time', render: (v) => datetime(v) },
            { key: 'userName', label: 'User', render: (v) => shortName(v || 'system', lang) },
            { key: 'action', label: 'Action', render: (v) => <Badge kind={KIND(v)}>{v}</Badge> },
            { key: 'entityType', label: 'Entity', render: (v) => <span className="muted">{v}</span> },
            { key: 'entityId', label: 'Record', render: (v) => <code style={{ fontSize: 12 }}>{v || '—'}</code> },
          ]}
          rows={data}
        />
      </Card>
    </div>
  );
}
