import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus, Pizza, Pencil, Trash2, X } from 'lucide-react';
import { useFetch } from '../hooks/useApi.js';
import { api } from '../api/client.js';
import { useUI } from '../store/ui.js';
import { Card, PageHeader, Spinner, DataTable, Badge, Modal, CategorySelect } from '../components/ui.jsx';
import { money, shortName } from '../utils/format.js';

const blank = { name: '', category: '', price: '', ingredients: [] };

export default function Products() {
  const { t } = useTranslation();
  const lang = useUI((s) => s.lang);
  const notify = useUI((s) => s.notify);
  const { data, loading, refetch } = useFetch('/products', []);
  const { data: goods } = useFetch('/goods', []);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(blank);
  const [saving, setSaving] = useState(false);

  const goodById = Object.fromEntries((goods || []).map((g) => [g.id, g]));

  const openNew = () => { setEditing(null); setForm(blank); setOpen(true); };
  const openEdit = (p) => {
    setEditing(p);
    setForm({ name: p.name, category: p.category, price: p.price, ingredients: (p.ingredients || []).map((i) => ({ ...i })) });
    setOpen(true);
  };

  const addIngredient = () => {
    const first = (goods || [])[0];
    if (!first) { notify(t('products.noGoods', 'Add inventory items first'), 'error'); return; }
    setForm((f) => ({ ...f, ingredients: [...f.ingredients, { goodId: first.id, quantityRequired: 1 }] }));
  };
  const setIngredient = (idx, patch) => setForm((f) => ({
    ...f, ingredients: f.ingredients.map((ing, i) => i === idx ? { ...ing, ...patch } : ing),
  }));
  const removeIngredient = (idx) => setForm((f) => ({ ...f, ingredients: f.ingredients.filter((_, i) => i !== idx) }));

  // Live cost preview from the chosen ingredients so the user sees numbers instantly.
  const previewCost = form.ingredients.reduce((s, ing) => s + (ing.quantityRequired || 0) * (goodById[ing.goodId]?.purchasePrice || 0), 0);
  const previewProfit = Number(form.price || 0) - previewCost;
  const previewMargin = Number(form.price) ? (previewProfit / Number(form.price)) * 100 : 0;

  const save = async () => {
    if (!form.name || !form.category || form.price === '') { notify(t('products.fillRequired', 'Name, category and price are required'), 'error'); return; }
    setSaving(true);
    try {
      const payload = {
        name: form.name, category: form.category, price: Number(form.price),
        ingredients: form.ingredients
          .filter((i) => i.goodId && Number(i.quantityRequired) > 0)
          .map((i) => ({ goodId: i.goodId, quantityRequired: Number(i.quantityRequired) })),
      };
      if (editing) {
        const { data: updated } = await api.put(`/products/${editing.id}`, payload);
        notify(t('products.updated', 'Product updated'));
        refetch(); // server returns computed cost; refresh list
        void updated;
      } else {
        await api.post('/products', payload);
        notify(t('products.created', 'Product created'));
        refetch();
      }
      setOpen(false); setForm(blank); setEditing(null);
    } catch (e) { notify(e.response?.data?.error || 'Failed', 'error'); }
    finally { setSaving(false); }
  };

  const del = async (id) => {
    if (!window.confirm(t('products.deleteConfirm', 'Delete this product?'))) return;
    try { await api.delete(`/products/${id}`); notify(t('products.deleted', 'Product deleted')); refetch(); }
    catch (e) { notify(e.response?.data?.error || 'Failed', 'error'); }
  };

  if (loading) return <Spinner />;
  const avgMargin = data.length ? (data.reduce((s, p) => s + (p.margin || 0), 0) / data.length).toFixed(1) : 0;

  return (
    <div className="fade-in">
      <PageHeader title={t('nav.products')} subtitle={`${data.length} ${t('products.count', 'products')} · ${t('products.avgMargin', 'avg margin')} ${avgMargin}%`}>
        <button className="btn btn--primary" onClick={openNew}><Plus size={16} /> {t('common.add')}</button>
      </PageHeader>

      <Card>
        <DataTable
          columns={[
            { key: 'name', label: t('common.name'), render: (v) => (
              <div className="row" style={{ gap: 10 }}>
                <div style={{ width: 34, height: 34, borderRadius: 10, background: 'var(--brand-100)', display: 'grid', placeItems: 'center' }}><Pizza size={16} color="var(--brand-ink)" /></div>
                <span style={{ fontWeight: 600 }}>{shortName(v, lang)}</span>
              </div>) },
            { key: 'category', label: t('products.category', 'Category'), render: (v) => <Badge>{v}</Badge> },
            { key: 'cost', label: t('products.cost', 'Cost'), align: 'end', render: (v) => money(v) },
            { key: 'price', label: t('common.price'), align: 'end', render: (v) => money(v) },
            { key: 'profit', label: t('products.profit', 'Profit'), align: 'end', render: (v) => <span style={{ color: 'var(--success)', fontWeight: 700 }}>{money(v)}</span> },
            { key: 'margin', label: t('products.margin', 'Margin'), align: 'end', render: (v) => <Badge kind={v > 50 ? 'success' : v > 30 ? 'warning' : 'danger'}>{v}%</Badge> },
            { key: 'ingredients', label: t('products.recipe', 'Recipe'), render: (v) => <span className="muted">{(v || []).length} {t('products.ingredients', 'ingredients')}</span> },
            { key: '_act', label: t('common.actions'), render: (_, r) => (
              <div className="row" style={{ gap: 6 }}>
                <button className="btn btn--sm" onClick={() => openEdit(r)}><Pencil size={13} /> {t('common.edit', 'Edit')}</button>
                <button className="btn btn--sm btn--danger" onClick={() => del(r.id)}><Trash2 size={13} /></button>
              </div>
            ) },
          ]}
          rows={data}
        />
      </Card>

      <Modal open={open} onClose={() => setOpen(false)} wide title={editing ? t('products.edit', 'Edit Product') : t('products.new', 'New Product')}
        footer={<><button className="btn" onClick={() => setOpen(false)}>{t('common.cancel')}</button><button className="btn btn--primary" onClick={save} disabled={saving}>{saving ? t('common.loading') : t('common.save')}</button></>}>
        <div className="row" style={{ gap: 12 }}>
          <div className="field" style={{ flex: 2 }}><label>{t('common.name')}</label><input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Veggie Pizza" /></div>
          <div className="field" style={{ flex: 1 }}><label>{t('products.category', 'Category')}</label><CategorySelect value={form.category} onChange={(v) => setForm({ ...form, category: v })} options={data.map((p) => p.category)} /></div>
          <div className="field" style={{ width: 110 }}><label>{t('common.price')}</label><input className="input" type="number" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} placeholder="12" /></div>
        </div>

        <div className="row between" style={{ marginTop: 6, marginBottom: 8 }}>
          <label style={{ fontWeight: 700, fontSize: 13 }}>{t('products.recipe', 'Recipe')} · {t('products.ingredients', 'ingredients')}</label>
          <button className="btn btn--sm" onClick={addIngredient}><Plus size={13} /> {t('products.addIngredient', 'Add ingredient')}</button>
        </div>

        {form.ingredients.length === 0 ? (
          <div className="muted" style={{ fontSize: 12.5, padding: '4px 0 10px' }}>{t('products.noIngredients', 'No ingredients yet — cost will be 0.')}</div>
        ) : form.ingredients.map((ing, idx) => {
          const g = goodById[ing.goodId];
          return (
            <div key={idx} className="row" style={{ gap: 8, marginBottom: 8 }}>
              <select className="select" style={{ flex: 2 }} value={ing.goodId} onChange={(e) => setIngredient(idx, { goodId: e.target.value })}>
                {(goods || []).map((gd) => <option key={gd.id} value={gd.id}>{shortName(gd.name, lang)} ({gd.unit})</option>)}
              </select>
              <input className="input" type="number" step="any" style={{ width: 90 }} value={ing.quantityRequired}
                onChange={(e) => setIngredient(idx, { quantityRequired: e.target.value })} />
              <span className="muted" style={{ width: 90, textAlign: 'end', fontSize: 12.5 }}>{money((ing.quantityRequired || 0) * (g?.purchasePrice || 0))}</span>
              <button className="btn btn--icon btn--sm btn--danger" onClick={() => removeIngredient(idx)}><X size={13} /></button>
            </div>
          );
        })}

        <div className="row between" style={{ marginTop: 12, padding: '12px 14px', background: 'var(--surface-2)', borderRadius: 'var(--r-sm)' }}>
          <span className="muted">{t('products.cost', 'Cost')}: <b style={{ color: 'var(--ink)' }}>{money(previewCost)}</b></span>
          <span className="muted">{t('products.profit', 'Profit')}: <b style={{ color: 'var(--success)' }}>{money(previewProfit)}</b></span>
          <Badge kind={previewMargin > 50 ? 'success' : previewMargin > 30 ? 'warning' : 'danger'}>{previewMargin.toFixed(1)}% {t('products.margin', 'margin')}</Badge>
        </div>
      </Modal>
    </div>
  );
}
