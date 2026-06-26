import { useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus, Minus, Trash2, Printer, Search, Receipt, User } from 'lucide-react';
import { useFetch } from '../hooks/useApi.js';
import { api, openReport } from '../api/client.js';
import { useUI } from '../store/ui.js';
import { Card, PageHeader, Spinner, Badge } from '../components/ui.jsx';
import { money, shortName } from '../utils/format.js';

export default function Orders() {
  const { t } = useTranslation();
  const lang = useUI((s) => s.lang);
  const notify = useUI((s) => s.notify);
  const { data: products, loading } = useFetch('/products', []);
  const { data: clients } = useFetch('/clients', []);
  const { refetch: refetchOrders } = useFetch('/orders', []);

  const [cart, setCart] = useState([]);
  const [cat, setCat] = useState('all');
  const [q, setQ] = useState('');
  const [clientId, setClientId] = useState('');
  const [payment, setPayment] = useState('cash');
  const [placing, setPlacing] = useState(false);

  const categories = useMemo(() => ['all', ...new Set((products || []).map((p) => p.category))], [products]);
  const filtered = (products || []).filter((p) =>
    (cat === 'all' || p.category === cat) && shortName(p.name, lang).toLowerCase().includes(q.toLowerCase()));

  const add = (p) => setCart((c) => {
    const ex = c.find((x) => x.productId === p.id);
    if (ex) return c.map((x) => x.productId === p.id ? { ...x, quantity: x.quantity + 1 } : x);
    return [...c, { productId: p.id, name: p.name, unitPrice: p.price, quantity: 1 }];
  });
  const setQty = (id, d) => setCart((c) => c.map((x) => x.productId === id ? { ...x, quantity: Math.max(1, x.quantity + d) } : x));
  const removeLine = (id) => setCart((c) => c.filter((x) => x.productId !== id));
  const total = cart.reduce((s, x) => s + x.quantity * x.unitPrice, 0);

  const charge = async () => {
    if (!cart.length) return;
    setPlacing(true);
    try {
      const { data } = await api.post('/orders', {
        products: cart.map((x) => ({ productId: x.productId, quantity: x.quantity, unitPrice: x.unitPrice })),
        clientId: clientId || null,
        clientName: clients?.find((c) => c.id === clientId)?.name || 'Walk-in',
        paymentMethod: payment, status: 'completed',
      });
      notify(`${t('orders.placed')} ${data.invoiceNo}`);
      setCart([]); setClientId('');
      refetchOrders();
      if (window.confirm(`${t('orders.placed')} ${data.invoiceNo}\n${t('common.print')} ${t('orders.invoice')}?`)) {
        openReport(`/orders/${data.id}/invoice.pdf`);
      }
    } catch (e) {
      notify(e.response?.data?.error || 'Failed', 'error');
    } finally { setPlacing(false); }
  };

  if (loading) return <Spinner />;

  return (
    <div className="fade-in">
      <PageHeader title={t('orders.title')} subtitle={t('orders.subtitle')} />
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 360px', gap: 18, alignItems: 'start' }}>
        {/* Menu */}
        <div>
          <div className="row between wrap" style={{ marginBottom: 14, gap: 10 }}>
            <div className="chip-row">
              {categories.map((c) => (
                <button key={c} className={`btn btn--sm ${cat === c ? 'btn--primary' : ''}`} onClick={() => setCat(c)}>
                  {c === 'all' ? t('common.all') : c}
                </button>
              ))}
            </div>
            <div className="search">
              <Search size={15} color="var(--muted)" />
              <input placeholder={t('common.search')} value={q} onChange={(e) => setQ(e.target.value)} />
            </div>
          </div>

          <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill,minmax(150px,1fr))' }}>
            {filtered.map((p) => (
              <button key={p.id} className="card card--hover" style={{ padding: 16, textAlign: 'start', cursor: 'pointer' }} onClick={() => add(p)}>
                <div style={{ width: 44, height: 44, borderRadius: 'var(--r-md)', background: 'var(--brand-100)', display: 'grid', placeItems: 'center', fontSize: 22, marginBottom: 10 }}>🍽️</div>
                <div style={{ fontWeight: 700, fontSize: 13.5, lineHeight: 1.3, minHeight: 34 }}>{shortName(p.name, lang)}</div>
                <div className="row between" style={{ marginTop: 8 }}>
                  <span style={{ fontWeight: 800, color: 'var(--brand-700)' }}>{money(p.price)}</span>
                  <Badge kind="brand">{p.margin}%</Badge>
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* Cart */}
        <Card title={<span className="row" style={{ gap: 8 }}><Receipt size={17} /> {t('orders.cart')}</span>} className="card--hover" >
          <div style={{ marginBottom: 12 }}>
            <div className="search" style={{ borderRadius: 'var(--r-sm)', marginBottom: 10 }}>
              <User size={15} color="var(--muted)" />
              <select className="select" style={{ border: 'none', background: 'transparent', padding: '2px 4px' }} value={clientId} onChange={(e) => setClientId(e.target.value)}>
                <option value="">{t('orders.walkIn')}</option>
                {(clients || []).map((c) => <option key={c.id} value={c.id}>{shortName(c.name, lang)}</option>)}
              </select>
            </div>
          </div>

          {cart.length === 0 ? (
            <div className="empty" style={{ padding: '30px 10px' }}>{t('orders.empty')}</div>
          ) : (
            <div style={{ maxHeight: 320, overflowY: 'auto', marginInline: -4, paddingInline: 4 }}>
              {cart.map((x) => (
                <div key={x.productId} className="row between" style={{ padding: '10px 0', borderBottom: '1px solid var(--border)' }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 600, fontSize: 13 }}>{shortName(x.name, lang)}</div>
                    <div className="muted" style={{ fontSize: 12 }}>{money(x.unitPrice)}</div>
                  </div>
                  <div className="row" style={{ gap: 6 }}>
                    <button className="btn btn--icon btn--sm" onClick={() => setQty(x.productId, -1)}><Minus size={13} /></button>
                    <span style={{ fontWeight: 700, minWidth: 18, textAlign: 'center' }}>{x.quantity}</span>
                    <button className="btn btn--icon btn--sm" onClick={() => setQty(x.productId, 1)}><Plus size={13} /></button>
                    <button className="btn btn--icon btn--sm btn--danger" onClick={() => removeLine(x.productId)}><Trash2 size={13} /></button>
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="chip-row" style={{ margin: '14px 0' }}>
            {['cash', 'card', 'wallet'].map((m) => (
              <button key={m} className={`btn btn--sm ${payment === m ? 'btn--primary' : ''}`} onClick={() => setPayment(m)}>{t(`orders.${m}`)}</button>
            ))}
          </div>

          <div className="row between" style={{ fontSize: 20, fontWeight: 800, margin: '6px 0 14px' }}>
            <span>{t('orders.subtotal')}</span><span style={{ color: 'var(--brand-700)' }}>{money(total)}</span>
          </div>
          <button className="btn btn--primary" style={{ width: '100%', justifyContent: 'center', padding: 13 }} disabled={!cart.length || placing} onClick={charge}>
            <Printer size={17} /> {t('orders.checkout')} · {money(total)}
          </button>
        </Card>
      </div>
    </div>
  );
}
