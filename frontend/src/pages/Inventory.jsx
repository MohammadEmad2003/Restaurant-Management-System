import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus, PackagePlus, AlertTriangle, Boxes } from 'lucide-react';
import { useFetch } from '../hooks/useApi.js';
import { api } from '../api/client.js';
import { useAuth } from '../store/auth.js';
import { useUI } from '../store/ui.js';
import { Card, PageHeader, Spinner, DataTable, Badge, Modal, Stat, CategorySelect } from '../components/ui.jsx';
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
  const blankItem = { name: '', category: '', unit: 'kg', quantityAvailable: '', minimumStockLevel: '', purchasePrice: '' };
  const [addOpen, setAddOpen] = useState(false);
  const [iForm, setIForm] = useState(blankItem);

  const doPurchase = async () => {
    try {
      await api.post(`/goods/${purchase.id}/purchase`, { quantity: Number(pForm.quantity), unitPrice: Number(pForm.unitPrice), supplier: pForm.supplier });
      notify('Stock added & expense recorded');
      setPurchase(null); setPForm({ quantity: '', unitPrice: '', supplier: '' });
      refetch();
    } catch (e) { notify(e.response?.data?.error || 'Failed', 'error'); }
  };

  const addItem = async () => {
    if (!iForm.name || !iForm.unit) { notify(t('inventory.fillRequired', 'Name and unit are required'), 'error'); return; }
    try {
      await api.post('/goods', {
        name: iForm.name,
        category: iForm.category,
        unit: iForm.unit,
        quantityAvailable: Number(iForm.quantityAvailable || 0),
        minimumStockLevel: Number(iForm.minimumStockLevel || 0),
        purchasePrice: Number(iForm.purchasePrice || 0),
      });
      notify(t('inventory.itemAdded', 'Item added'));
      setAddOpen(false); setIForm(blankItem);
      refetch();
    } catch (e) { notify(e.response?.data?.error || 'Failed', 'error'); }
  };

  if (loading) return <Spinner />;
  const low = data.filter((g) => g.quantityAvailable <= g.minimumStockLevel);

  return (
    <div className="fade-in">
      <PageHeader title={t('nav.inventory')} subtitle={`${data.length} goods tracked`}>
        {isAdmin && <button className="btn btn--primary" onClick={() => { setIForm(blankItem); setAddOpen(true); }}><Plus size={16} /> {t('common.add')}</button>}
      </PageHeader>
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

      <Modal open={addOpen} onClose={() => setAddOpen(false)} title={t('inventory.newItem', 'New Inventory Item')}
        footer={<><button className="btn" onClick={() => setAddOpen(false)}>{t('common.cancel')}</button><button className="btn btn--primary" onClick={addItem}><Plus size={15} /> {t('common.save')}</button></>}>
        <div className="row" style={{ gap: 12 }}>
          <div className="field" style={{ flex: 2 }}><label>{t('common.name')}</label><input className="input" value={iForm.name} onChange={(e) => setIForm({ ...iForm, name: e.target.value })} placeholder="Mozzarella Cheese" /></div>
          <div className="field" style={{ flex: 1 }}><label>{t('inventory.category', 'Category')}</label><CategorySelect value={iForm.category} onChange={(v) => setIForm({ ...iForm, category: v })} options={data.map((g) => g.category)} /></div>
        </div>
        <div className="row" style={{ gap: 12 }}>
          <div className="field" style={{ flex: 1 }}><label>{t('inventory.unit', 'Unit')}</label>
            <select className="select" value={iForm.unit} onChange={(e) => setIForm({ ...iForm, unit: e.target.value })}>
              {['kg', 'g', 'L', 'ml', 'pcs', 'box', 'pack', 'bottle'].map((u) => <option key={u} value={u}>{u}</option>)}
            </select>
          </div>
          <div className="field" style={{ flex: 1 }}><label>{t('inventory.qty', 'Quantity in stock')}</label><input className="input" type="number" step="any" value={iForm.quantityAvailable} onChange={(e) => setIForm({ ...iForm, quantityAvailable: e.target.value })} placeholder="0" /></div>
        </div>
        <div className="row" style={{ gap: 12 }}>
          <div className="field" style={{ flex: 1 }}><label>{t('inventory.lowStock', 'Low-stock level')}</label><input className="input" type="number" step="any" value={iForm.minimumStockLevel} onChange={(e) => setIForm({ ...iForm, minimumStockLevel: e.target.value })} placeholder="0" /></div>
          <div className="field" style={{ flex: 1 }}><label>{t('inventory.unitCost', 'Unit cost')}</label><input className="input" type="number" step="0.001" value={iForm.purchasePrice} onChange={(e) => setIForm({ ...iForm, purchasePrice: e.target.value })} placeholder="0.00" /></div>
        </div>
        <p className="muted" style={{ fontSize: 12.5 }}>{t('inventory.lowStockHint', 'You’ll get a low-stock alert when quantity drops to or below this level.')}</p>
      </Modal>
    </div>
  );
}
