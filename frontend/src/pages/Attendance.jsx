import { useTranslation } from 'react-i18next';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid } from 'recharts';
import { Clock, Timer } from 'lucide-react';
import { useFetch } from '../hooks/useApi.js';
import { Card, PageHeader, Spinner, DataTable, Badge } from '../components/ui.jsx';
import { shortName, datetime } from '../utils/format.js';
import { useUI } from '../store/ui.js';

export default function Attendance() {
  const { t } = useTranslation();
  const lang = useUI((s) => s.lang);
  const { data: monthly, loading } = useFetch('/attendance/reports/monthly', []);
  const { data: records } = useFetch('/attendance', []);

  if (loading || !monthly) return <Spinner />;
  const totalHours = monthly.reduce((s, m) => s + m.totalHours, 0).toFixed(0);
  const totalOt = monthly.reduce((s, m) => s + m.overtime, 0).toFixed(1);

  return (
    <div className="fade-in">
      <PageHeader title={t('nav.attendance')} subtitle={`This month · ${totalHours}h worked · ${totalOt}h overtime`} />
      <div className="grid grid--2" style={{ marginBottom: 18 }}>
        <Card title="Hours by Employee (this month)">
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={monthly.map((m) => ({ ...m, label: shortName(m.workerName, lang) }))} margin={{ left: -14 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 10.5, fill: 'var(--muted)' }} />
              <YAxis tick={{ fontSize: 11, fill: 'var(--muted)' }} />
              <Tooltip contentStyle={{ borderRadius: 12, border: '1px solid var(--border)' }} />
              <Bar dataKey="totalHours" name="Hours" fill="#7c3aed" radius={[6, 6, 0, 0]} />
              <Bar dataKey="overtime" name="Overtime" fill="#f59e0b" radius={[6, 6, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </Card>
        <Card title="Monthly Summary">
          <DataTable
            columns={[
              { key: 'workerName', label: 'Employee', render: (v) => shortName(v, lang) },
              { key: 'days', label: 'Days', align: 'end' },
              { key: 'totalHours', label: 'Hours', align: 'end', render: (v) => `${v}h` },
              { key: 'overtime', label: 'Overtime', align: 'end', render: (v) => <Badge kind={v > 0 ? 'warning' : ''}>{v}h</Badge> },
            ]}
            rows={monthly}
          />
        </Card>
      </div>

      <Card title={<span className="row" style={{ gap: 8 }}><Clock size={16} /> Recent Clock-ins</span>}>
        <DataTable
          columns={[
            { key: 'date', label: t('common.date') },
            { key: 'checkInTime', label: 'Check In', render: (v) => datetime(v) },
            { key: 'checkOutTime', label: 'Check Out', render: (v) => v ? datetime(v) : <Badge kind="success"><span className="dot" />On shift</Badge> },
            { key: 'totalHours', label: 'Hours', align: 'end', render: (v) => <span className="row" style={{ gap: 4, justifyContent: 'flex-end' }}><Timer size={13} />{v}h</span> },
            { key: 'overtimeHours', label: 'OT', align: 'end', render: (v) => v > 0 ? <Badge kind="warning">{v}h</Badge> : '—' },
          ]}
          rows={(records || []).slice(0, 20)}
        />
      </Card>
    </div>
  );
}
