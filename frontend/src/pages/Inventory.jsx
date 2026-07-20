import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus, PackagePlus, AlertTriangle, Boxes } from 'lucide-react';
import { useFetch } from '../hooks/useApi.js';
import { api } from '../api/client.js';
import { usePaginated } from '../hooks/usePaginated.js';
import { useAuth } from '../store/auth.js';
import { useUI } from '../store/ui.js';
import { Card, PageHeader, Spinner, DataTable, Badge, Modal, Stat, CategorySelect, SupplierSelect } from '../components/ui.jsx';
import { money, num, shortName } from '../utils/format.js';

/**
 * Renders a quantity input with a visible unit label suffix.
 * @param {Object} props - Component properties.
 * @param {string} props.value - The current quantity value.
 * @param {string} props.unit - The measurement unit (e.g., "kg", "L").
 * @param {Function} props.onChange - Callback when the value changes.
 * @param {string} props.label - The input label text.
 * @returns {JSX.Element} A field div with label, input, and unit suffix.
 */
function QuantityWithUnit({ value, unit, onChange, label }) {
  return (
    <div className="field">
      <label>{label}</label>
      <div className="row" style={{ alignItems: 'center', gap: 6 }}>
        <input className="input" type="number" value={value} onChange={onChange} />
        {unit && <span className="muted" style={{ fontSize: 12 }}>{unit}</span>}
      </div>
    </div>
  );
}

export default function Inventory() {
  const { t } = useTranslation();
  const lang = useUI((s) => s.lang);
  const notify = useUI((s) => s.notify);
  const can = useAuth((s) => s.can);
  const { data, loading, refetch } = useFetch('/goods', []);
  const { data: val } = useFetch('/goods/valuation', []);
  const [purchase, setPurchase] = useState(null);
  const [pForm, setPForm] = useState({ quantity: '', unitPrice: '', supplierId: '' });
  const blankItem = { name: '', category: '', unit: 'kg', quantityAvailable: '', minimumStockLevel: '', purchasePrice: '' };
  const [addOpen, setAddOpen] = useState(false);
  const [iForm, setIForm] = useState(blankItem);

  const doPurchase = async () => {
    try {
      await api.post(`/goods/${purchase.id}/purchase`, { quantity: Number(pForm.quantity), unitPrice: Number(pForm.unitPrice), supplierId: pForm.supplierId });
      notify(t('inventory.stockAdded', 'Stock added & expense recorded'));
      setPurchase(null); setPForm({ quantity: '', unitPrice: '', supplierId: '' });
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

  const { page, pageSize, totalPages, totalItems, setPage, setPageSize, paginatedData: paginatedGoods } = usePaginated(data ?? [], 10);

  if (loading || !data) return <Spinner />;
  const low = data.filter((g) => g.quantityAvailable <= g.minimumStockLevel);

  return (
    <div className="fade-in">
      <PageHeader title={t('nav.inventory')} subtitle={t('inventory.goodsTracked', '{{count}} goods tracked', { count: data.length })}>
        {can('admin') && <button className="btn btn--primary" onClick={() => { setIForm(blankItem); setAddOpen(true); }}><Plus size={16} /> {t('common.add')}</button>}
      </PageHeader>
      <div className="grid grid--stats" style={{ marginBottom: 18 }}>
        <Stat label={t('dashboard.inventoryValue')} value={money(val?.totalValue || 0)} icon={Boxes} color="linear-gradient(135deg,#06b6d4,#22d3ee)" />
        <Stat label={t('dashboard.lowStock')} value={num(low.length)} icon={AlertTriangle} color="linear-gradient(135deg,#ef4444,#f87171)" />
        <Stat label={t('inventory.totalItems', 'Total Items')} value={num(data.length)} icon={Boxes} />
      </div>

      <Card title={t('nav.inventory')}>
        <DataTable
          columns={[
            { key: 'name', label: t('common.name'), render: (v) => <span style={{ fontWeight: 600 }}>{shortName(v, lang)}</span> },
            { key: 'category', label: t('inventory.category', 'Category'), render: (v) => <Badge>{v}</Badge> },
            { key: 'quantityAvailable', label: t('inventory.inStock', 'In Stock'), align: 'end', render: (v, r) => <span>{num(v)} {r.unit}</span> },
            { key: 'minimumStockLevel', label: t('inventory.minStock', 'Min'), align: 'end', render: (v, r) => `${num(v)} ${r.unit}` },
            { key: 'purchasePrice', label: t('inventory.unitCost', 'Unit Cost'), align: 'end', render: (v) => money(v) },
            { key: 'id', label: t('common.status'), render: (_, r) => r.quantityAvailable <= r.minimumStockLevel ? <Badge kind="danger"><span className="dot" />{t('inventory.low', 'Low')}</Badge> : <Badge kind="success"><span className="dot" />{t('inventory.ok', 'OK')}</Badge> },
            ...(can('admin') ? [{ key: '_act', label: t('common.actions'), render: (_, r) => <button className="btn btn--sm" onClick={() => { setPurchase(r); setPForm({ quantity: '', unitPrice: r.purchasePrice, supplierId: '' }); }}><PackagePlus size={14} /> {t('inventory.restock', 'Restock')}</button> }] : []),
          ]}
          rows={paginatedGoods}
          pagination={{ currentPage: page, totalPages, onPageChange: setPage, pageSize, totalItems, onPageSizeChange: setPageSize }}
        />
      </Card>

      <Modal open={!!purchase} onClose={() => setPurchase(null)} title={`${t('inventory.restock', 'Restock')} — ${shortName(purchase?.name || '', lang)}`}
        footer={<><button className="btn" onClick={() => setPurchase(null)}>{t('common.cancel')}</button><button className="btn btn--primary" onClick={doPurchase}><Plus size={15} /> {t('inventory.addStock', 'Add Stock')}</button></>}>
        <div className="field">
          <label>{t('inventory.quantityLabel', 'Quantity')}</label>
          <div className="row" style={{ alignItems: 'center', gap: 6 }}>
            <input className="input" type="number" value={pForm.quantity} onChange={(e) => setPForm({ ...pForm, quantity: e.target.value })} />
            {purchase?.unit && <span className="muted" style={{ fontSize: 12 }}>{purchase.unit}</span>}
          </div>
        </div>
        <div className="field"><label>{t('inventory.unitPrice', 'Unit Price')}</label><input className="input" type="number" step="0.001" value={pForm.unitPrice} onChange={(e) => setPForm({ ...pForm, unitPrice: e.target.value })} /></div>
        <div className="field"><label>{t('inventory.supplier', 'Supplier')}</label><SupplierSelect value={pForm.supplierId} onChange={(v) => setPForm({ ...pForm, supplierId: v })} placeholder={t('suppliers.selectSupplier', 'Select supplier…')} /></div>
      </Modal>

      <Modal open={addOpen} onClose={() => setAddOpen(false)} title={t('inventory.newItem', 'New Inventory Item')}
        footer={<><button className="btn" onClick={() => setAddOpen(false)}>{t('common.cancel')}</button><button className="btn btn--primary" onClick={addItem}><Plus size={15} /> {t('common.save')}</button></>}>
        <div className="row" style={{ gap: 12 }}>
          <div className="field" style={{ flex: 2 }}><label>{t('common.name')}</label><input className="input" value={iForm.name} onChange={(e) => setIForm({ ...iForm, name: e.target.value })} placeholder={t('inventory.namePlaceholder', 'Mozzarella Cheese')} /></div>
          <div className="field" style={{ flex: 1 }}><label>{t('inventory.category', 'Category')}</label><CategorySelect value={iForm.category} onChange={(v) => setIForm({ ...iForm, category: v })} options={data.map((g) => g.category)} /></div>
        </div>
        <div className="row" style={{ gap: 12 }}>
          <div className="field" style={{ flex: 1 }}><label>{t('inventory.unit', 'Unit')}</label>
            <select className="select" value={iForm.unit} onChange={(e) => setIForm({ ...iForm, unit: e.target.value })}>
              {['kg', 'g', 'L', 'ml', 'pcs', 'box', 'pack', 'bottle'].map((u) => <option key={u} value={u}>{u}</option>)}
            </select>
          </div>
          <div className="field" style={{ flex: 1 }}>
            <label>{t('inventory.qty', 'Quantity in stock')}</label>
            <div className="row" style={{ alignItems: 'center', gap: 6 }}>
              <input className="input" type="number" step="any" value={iForm.quantityAvailable} onChange={(e) => setIForm({ ...iForm, quantityAvailable: e.target.value })} placeholder="0" />
              <span className="muted" style={{ fontSize: 12 }}>{iForm.unit}</span>
            </div>
          </div>
        </div>
        <div className="row" style={{ gap: 12 }}>
          <div className="field" style={{ flex: 1 }}>
            <label>{t('inventory.lowStock', 'Low-stock level')}</label>
            <div className="row" style={{ alignItems: 'center', gap: 6 }}>
              <input className="input" type="number" step="any" value={iForm.minimumStockLevel} onChange={(e) => setIForm({ ...iForm, minimumStockLevel: e.target.value })} placeholder="0" />
              <span className="muted" style={{ fontSize: 12 }}>{iForm.unit}</span>
            </div>
          </div>
          <div className="field" style={{ flex: 1 }}><label>{t('inventory.unitCost', 'Unit cost')}</label><input className="input" type="number" step="0.001" value={iForm.purchasePrice} onChange={(e) => setIForm({ ...iForm, purchasePrice: e.target.value })} placeholder="0.00" /></div>
        </div>
        <p className="muted" style={{ fontSize: 12.5 }}>{t('inventory.lowStockHint', 'You’ll get a low-stock alert when quantity drops to or below this level.')}</p>
      </Modal>
    </div>
  );
}
