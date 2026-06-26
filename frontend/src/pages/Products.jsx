import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus, Pizza } from 'lucide-react';
import { useFetch } from '../hooks/useApi.js';
import { api } from '../api/client.js';
import { useUI } from '../store/ui.js';
import { Card, PageHeader, Spinner, DataTable, Badge, Modal } from '../components/ui.jsx';
import { money, shortName } from '../utils/format.js';

export default function Products() {
  const { t } = useTranslation();
  const lang = useUI((s) => s.lang);
  const notify = useUI((s) => s.notify);
  const { data, loading, refetch } = useFetch('/products', []);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: '', category: '', price: '' });

  const save = async () => {
    try {
      await api.post('/products', { ...form, price: Number(form.price), ingredients: [] });
      notify('Product created');
      setOpen(false); setForm({ name: '', category: '', price: '' });
      refetch();
    } catch (e) { notify(e.response?.data?.error || 'Failed', 'error'); }
  };

  if (loading) return <Spinner />;
  const avgMargin = data.length ? (data.reduce((s, p) => s + (p.margin || 0), 0) / data.length).toFixed(1) : 0;

  return (
    <div className="fade-in">
      <PageHeader title={t('nav.products')} subtitle={`${data.length} products · avg margin ${avgMargin}%`}>
        <button className="btn btn--primary" onClick={() => setOpen(true)}><Plus size={16} /> {t('common.add')}</button>
      </PageHeader>

      <Card>
        <DataTable
          columns={[
            { key: 'name', label: t('common.name'), render: (v) => (
              <div className="row" style={{ gap: 10 }}>
                <div style={{ width: 34, height: 34, borderRadius: 10, background: 'var(--brand-100)', display: 'grid', placeItems: 'center' }}><Pizza size={16} color="var(--brand-700)" /></div>
                <span style={{ fontWeight: 600 }}>{shortName(v, lang)}</span>
              </div>) },
            { key: 'category', label: 'Category', render: (v) => <Badge>{v}</Badge> },
            { key: 'cost', label: 'Cost', align: 'end', render: (v) => money(v) },
            { key: 'price', label: t('common.price'), align: 'end', render: (v) => money(v) },
            { key: 'profit', label: 'Profit', align: 'end', render: (v) => <span style={{ color: 'var(--success)', fontWeight: 700 }}>{money(v)}</span> },
            { key: 'margin', label: 'Margin', align: 'end', render: (v) => <Badge kind={v > 50 ? 'success' : v > 30 ? 'warning' : 'danger'}>{v}%</Badge> },
            { key: 'ingredients', label: 'Recipe', render: (v) => <span className="muted">{v.length} ingredients</span> },
          ]}
          rows={data}
        />
      </Card>

      <Modal open={open} onClose={() => setOpen(false)} title="New Product"
        footer={<><button className="btn" onClick={() => setOpen(false)}>{t('common.cancel')}</button><button className="btn btn--primary" onClick={save}>{t('common.save')}</button></>}>
        <div className="field"><label>{t('common.name')}</label><input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Veggie Pizza" /></div>
        <div className="field"><label>Category</label><input className="input" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} placeholder="Pizza" /></div>
        <div className="field"><label>{t('common.price')}</label><input className="input" type="number" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} placeholder="12" /></div>
        <p className="muted" style={{ fontSize: 12.5 }}>Recipe ingredients can be linked from the inventory module.</p>
      </Modal>
    </div>
  );
}
