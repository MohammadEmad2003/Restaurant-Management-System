import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus, PackagePlus, AlertTriangle, Boxes } from 'lucide-react';
import { useFetch } from '../hooks/useApi.js';
import { api } from '../api/client.js';
import { useAuth } from '../store/auth.js';
import { useUI } from '../store/ui.js';
import { Card, PageHeader, Spinner, DataTable, Badge, Modal, Stat } from '../components/ui.jsx';
import { money, num, shortName } from '../utils/format.js';

export default function Inventory() {
  const { t } = useTranslation();
  const lang = useUI((s) => s.lang);
  const notify = useUI((s) => s.notify);
  const isAdmin = useAuth((s) => s.user?.role === 'admin');
  const { data, loading, refetch } = useFetch('/goods', []);
  const { data: val } = useFetch('/goods/valuation', []);
  const [purchase, setPurchase] = useState(null);
  const [pForm, setPForm] = useState({ quantity: '', unitPrice: '', supplier: '' });

  const doPurchase = async () => {
    try {
      await api.post(`/goods/${purchase.id}/purchase`, { quantity: Number(pForm.quantity), unitPrice: Number(pForm.unitPrice), supplier: pForm.supplier });
      notify('Stock added & expense recorded');
      setPurchase(null); setPForm({ quantity: '', unitPrice: '', supplier: '' });
      refetch();
    } catch (e) { notify(e.response?.data?.error || 'Failed', 'error'); }
  };

  if (loading) return <Spinner />;
  const low = data.filter((g) => g.quantityAvailable <= g.minimumStockLevel);

  return (
    <div className="fade-in">
      <PageHeader title={t('nav.inventory')} subtitle={`${data.length} goods tracked`} />
      <div className="grid grid--stats" style={{ marginBottom: 18 }}>
        <Stat label={t('dashboard.inventoryValue')} value={money(val?.totalValue || 0)} icon={Boxes} color="linear-gradient(135deg,#06b6d4,#22d3ee)" />
        <Stat label={t('dashboard.lowStock')} value={num(low.length)} icon={AlertTriangle} color="linear-gradient(135deg,#ef4444,#f87171)" />
        <Stat label="Total Items" value={num(data.length)} icon={Boxes} />
      </div>

      <Card title={t('nav.inventory')}>
        <DataTable
          columns={[
            { key: 'name', label: t('common.name'), render: (v) => <span style={{ fontWeight: 600 }}>{shortName(v, lang)}</span> },
            { key: 'category', label: 'Category', render: (v) => <Badge>{v}</Badge> },
            { key: 'quantityAvailable', label: 'In Stock', align: 'end', render: (v, r) => <span>{num(v)} {r.unit}</span> },
            { key: 'minimumStockLevel', label: 'Min', align: 'end', render: (v, r) => `${num(v)} ${r.unit}` },
            { key: 'purchasePrice', label: 'Unit Cost', align: 'end', render: (v) => money(v) },
            { key: 'id', label: t('common.status'), render: (_, r) => r.quantityAvailable <= r.minimumStockLevel ? <Badge kind="danger"><span className="dot" />Low</Badge> : <Badge kind="success"><span className="dot" />OK</Badge> },
            ...(isAdmin ? [{ key: '_act', label: t('common.actions'), render: (_, r) => <button className="btn btn--sm" onClick={() => { setPurchase(r); setPForm({ quantity: '', unitPrice: r.purchasePrice, supplier: '' }); }}><PackagePlus size={14} /> Restock</button> }] : []),
          ]}
          rows={data}
        />
      </Card>

      <Modal open={!!purchase} onClose={() => setPurchase(null)} title={`Restock — ${shortName(purchase?.name || '', lang)}`}
        footer={<><button className="btn" onClick={() => setPurchase(null)}>{t('common.cancel')}</button><button className="btn btn--primary" onClick={doPurchase}><Plus size={15} /> Add Stock</button></>}>
        <div className="field"><label>Quantity ({purchase?.unit})</label><input className="input" type="number" value={pForm.quantity} onChange={(e) => setPForm({ ...pForm, quantity: e.target.value })} /></div>
        <div className="field"><label>Unit Price</label><input className="input" type="number" step="0.001" value={pForm.unitPrice} onChange={(e) => setPForm({ ...pForm, unitPrice: e.target.value })} /></div>
        <div className="field"><label>Supplier</label><input className="input" value={pForm.supplier} onChange={(e) => setPForm({ ...pForm, supplier: e.target.value })} placeholder="FreshCo" /></div>
      </Modal>
    </div>
  );
}
