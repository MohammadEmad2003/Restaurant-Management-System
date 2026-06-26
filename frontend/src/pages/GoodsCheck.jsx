import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ClipboardCheck, AlertTriangle, Plus } from 'lucide-react';
import { useFetch } from '../hooks/useApi.js';
import { api } from '../api/client.js';
import { useUI } from '../store/ui.js';
import { Card, PageHeader, Spinner, DataTable, Badge, Modal, Stat } from '../components/ui.jsx';
import { money, num, date, shortName } from '../utils/format.js';

export default function GoodsCheck() {
  const { t } = useTranslation();
  const lang = useUI((s) => s.lang);
  const notify = useUI((s) => s.notify);
  const { data: checks, loading, refetch } = useFetch('/goods-checks', []);
  const { data: waste, refetch: refetchWaste } = useFetch('/goods-checks/reports/waste', []);
  const { data: goods } = useFetch('/goods', []);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ goodId: '', actualQuantity: '', reason: 'Spoilage' });

  const submit = async () => {
    try {
      await api.post('/goods-checks', { ...form, actualQuantity: Number(form.actualQuantity), date: new Date().toISOString().slice(0, 10) });
      notify('Check recorded & stock adjusted');
      setOpen(false); setForm({ goodId: '', actualQuantity: '', reason: 'Spoilage' });
      refetch(); refetchWaste();
    } catch (e) { notify(e.response?.data?.error || 'Failed', 'error'); }
  };

  if (loading) return <Spinner />;
  const goodName = (id) => shortName(goods?.find((g) => g.id === id)?.name || id, lang);

  return (
    <div className="fade-in">
      <PageHeader title={t('nav.goodsCheck')} subtitle="Physical counts, waste & loss detection">
        <button className="btn btn--primary" onClick={() => setOpen(true)}><Plus size={16} /> New Count</button>
      </PageHeader>

      <div className="grid grid--stats" style={{ marginBottom: 18 }}>
        <Stat label={t('dashboard.wasteValue')} value={money(waste?.totalLossValue || 0)} icon={AlertTriangle} color="linear-gradient(135deg,#ef4444,#f87171)" />
        <Stat label="Most Wasted" value={shortName(waste?.mostWasted || '—', lang)} icon={ClipboardCheck} color="linear-gradient(135deg,#f59e0b,#fbbf24)" />
        <Stat label="Checks Done" value={num(checks.length)} icon={ClipboardCheck} />
      </div>

      <div className="grid grid--2">
        <Card title="Waste by Ingredient">
          <DataTable
            columns={[
              { key: 'name', label: 'Ingredient', render: (v) => shortName(v, lang) },
              { key: 'totalLoss', label: 'Qty Lost', align: 'end', render: (v) => num(v.toFixed(1)) },
              { key: 'lossValue', label: 'Value', align: 'end', render: (v) => <span style={{ color: 'var(--danger)', fontWeight: 700 }}>{money(v)}</span> },
            ]}
            rows={waste?.items || []}
          />
        </Card>
        <Card title="Recent Checks">
          <DataTable
            columns={[
              { key: 'date', label: t('common.date'), render: (v) => v },
              { key: 'goodId', label: 'Item', render: (v) => goodName(v) },
              { key: 'difference', label: 'Diff', align: 'end', render: (v) => <Badge kind={v > 0 ? 'danger' : 'success'}>{v > 0 ? '-' : '+'}{Math.abs(v).toFixed(1)}</Badge> },
              { key: 'reason', label: 'Reason', render: (v) => <span className="muted">{v}</span> },
            ]}
            rows={(checks || []).slice().sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)).slice(0, 20)}
          />
        </Card>
      </div>

      <Modal open={open} onClose={() => setOpen(false)} title="Physical Inventory Count"
        footer={<><button className="btn" onClick={() => setOpen(false)}>{t('common.cancel')}</button><button className="btn btn--primary" onClick={submit}>{t('common.save')}</button></>}>
        <div className="field"><label>Item</label>
          <select className="select" value={form.goodId} onChange={(e) => setForm({ ...form, goodId: e.target.value })}>
            <option value="">Select…</option>
            {(goods || []).map((g) => <option key={g.id} value={g.id}>{shortName(g.name, lang)} (system: {num(g.quantityAvailable)} {g.unit})</option>)}
          </select>
        </div>
        <div className="field"><label>Actual Counted Quantity</label><input className="input" type="number" value={form.actualQuantity} onChange={(e) => setForm({ ...form, actualQuantity: e.target.value })} /></div>
        <div className="field"><label>Reason for difference</label>
          <select className="select" value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })}>
            {['Spoilage', 'Over-portioning', 'Spillage', 'Theft suspected', 'Expired', 'Counting error'].map((r) => <option key={r}>{r}</option>)}
          </select>
        </div>
      </Modal>
    </div>
  );
}
