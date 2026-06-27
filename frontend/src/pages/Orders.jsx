import { useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus, Minus, Trash2, Printer, Search, Receipt, User, X, Phone } from 'lucide-react';
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
  const { data: settings } = useFetch('/settings', []);
  const { refetch: refetchOrders } = useFetch('/orders', []);

  const [cart, setCart] = useState([]);
  const [cat, setCat] = useState('all');
  const [q, setQ] = useState('');
  const [custQuery, setCustQuery] = useState('');
  const [client, setClient] = useState(null);
  const [payment, setPayment] = useState('cash');
  const [walkIn, setWalkIn] = useState(false);
  const [deliveryAddress, setDeliveryAddress] = useState('');
  const [placing, setPlacing] = useState(false);

  const categories = useMemo(() => ['all', ...new Set((products || []).map((p) => p.category))], [products]);
  const filtered = (products || []).filter((p) =>
    (cat === 'all' || p.category === cat) && shortName(p.name, lang).toLowerCase().includes(q.toLowerCase()));

  // Look the customer up by phone (or name) instead of an unwieldy dropdown.
  const norm = (s) => String(s || '').replace(/[\s\-()]/g, '').toLowerCase();
  const custMatches = useMemo(() => {
    const term = custQuery.trim();
    if (client || term.length < 2) return [];
    const nterm = norm(term);
    return (clients || []).filter((c) =>
      (c.phoneNumbers || []).some((p) => norm(p).includes(nterm)) ||
      shortName(c.name, lang).toLowerCase().includes(term.toLowerCase()),
    ).slice(0, 6);
  }, [custQuery, clients, client, lang]);

  const add = (p) => setCart((c) => {
    const ex = c.find((x) => x.productId === p.id);
    if (ex) return c.map((x) => x.productId === p.id ? { ...x, quantity: x.quantity + 1 } : x);
    return [...c, { productId: p.id, name: p.name, unitPrice: p.price, quantity: 1 }];
  });
  const setQty = (id, d) => setCart((c) => c.map((x) => x.productId === id ? { ...x, quantity: Math.max(1, x.quantity + d) } : x));
  const removeLine = (id) => setCart((c) => c.filter((x) => x.productId !== id));
  const subtotal = cart.reduce((s, x) => s + x.quantity * x.unitPrice, 0);
  // Delivery fee applies to phone/delivery customers, waived for walk-ins.
  const isDelivery = !!client && !walkIn;
  const deliveryFee = isDelivery ? Number(settings?.deliveryFee || 0) : 0;
  const total = subtotal + deliveryFee;

  const charge = async () => {
    if (!cart.length) return;
    setPlacing(true);
    try {
      const { data } = await api.post('/orders', {
        products: cart.map((x) => ({ productId: x.productId, quantity: x.quantity, unitPrice: x.unitPrice })),
        clientId: client?.id || null,
        clientName: client?.name || 'Walk-in',
        clientPhone: client?.phoneNumbers?.[0] || null,
        walkIn, isDelivery,
        deliveryAddress: isDelivery ? (deliveryAddress || client?.addresses?.[0] || '') : '',
        paymentMethod: payment, status: 'completed',
      });
      notify(`${t('orders.placed')} ${data.invoiceNo}`);
      setCart([]); setClient(null); setCustQuery(''); setWalkIn(false); setDeliveryAddress('');
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
            {client ? (
              <div className="row between" style={{ padding: '8px 12px', borderRadius: 'var(--r-sm)', background: 'var(--brand-100)', gap: 8 }}>
                <div style={{ minWidth: 0 }}>
                  <div className="row" style={{ gap: 6 }}>
                    <User size={14} color="var(--brand-ink)" />
                    <span style={{ fontWeight: 700, fontSize: 13, color: 'var(--brand-ink)' }}>{shortName(client.name, lang)}</span>
                  </div>
                  <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>
                    <span className="ltr">{client.phoneNumbers?.[0] || '—'}</span> · {client.loyaltyPoints || 0} pts · {client.visitCount || 0} visits
                  </div>
                </div>
                <button className="btn btn--icon btn--sm" title={t('orders.walkIn')} onClick={() => { setClient(null); setCustQuery(''); }}>
                  <X size={14} />
                </button>
              </div>
            ) : (
              <div style={{ position: 'relative' }}>
                <div className="search" style={{ borderRadius: 'var(--r-sm)' }}>
                  <Phone size={15} color="var(--muted)" />
                  <input
                    inputMode="tel"
                    placeholder={t('orders.customerSearch')}
                    value={custQuery}
                    onChange={(e) => setCustQuery(e.target.value)}
                  />
                </div>
                {custMatches.length > 0 && (
                  <div className="card" style={{ position: 'absolute', insetInline: 0, top: 'calc(100% + 4px)', zIndex: 30, padding: 6, maxHeight: 240, overflowY: 'auto' }}>
                    {custMatches.map((c) => (
                      <button
                        key={c.id}
                        className="btn btn--ghost"
                        style={{ width: '100%', justifyContent: 'flex-start', textAlign: 'start', padding: '8px 10px' }}
                        onClick={() => { setClient(c); setCustQuery(''); }}
                      >
                        <div style={{ minWidth: 0 }}>
                          <div style={{ fontWeight: 600, fontSize: 13 }}>{shortName(c.name, lang)}</div>
                          <div className="muted" style={{ fontSize: 12 }}>{c.phoneNumbers?.[0] || '—'}</div>
                        </div>
                      </button>
                    ))}
                  </div>
                )}
                {custQuery.trim().length >= 2 && custMatches.length === 0 && (
                  <div className="muted" style={{ fontSize: 12, padding: '6px 4px 0' }}>{t('orders.customerNone')}</div>
                )}
              </div>
            )}
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

          <button className={`btn btn--sm ${walkIn ? 'btn--primary' : ''}`} style={{ width: '100%', justifyContent: 'center', marginBottom: 10 }} onClick={() => setWalkIn((w) => !w)}>
            {walkIn ? '✓ ' : ''}{t('orders.walkInNoFee', 'Walk-in (no delivery fee)')}
          </button>

          {isDelivery && (
            <div className="field" style={{ marginBottom: 10 }}>
              <label>{t('orders.deliveryAddress', 'Delivery Address')}</label>
              <input className="input" value={deliveryAddress}
                onChange={(e) => setDeliveryAddress(e.target.value)}
                placeholder={client?.addresses?.[0] || t('clients.addressPlaceholder', 'Street, building, floor…')} />
            </div>
          )}

          <div className="row between" style={{ fontSize: 13.5, margin: '4px 0', color: 'var(--muted)' }}>
            <span>{t('orders.subtotalLabel', 'Subtotal')}</span><span>{money(subtotal)}</span>
          </div>
          {deliveryFee > 0 && (
            <div className="row between" style={{ fontSize: 13.5, margin: '4px 0', color: 'var(--muted)' }}>
              <span>{t('orders.delivery', 'Delivery')}</span><span>{money(deliveryFee)}</span>
            </div>
          )}
          <div className="row between" style={{ fontSize: 20, fontWeight: 800, margin: '6px 0 14px' }}>
            <span>{t('common.total')}</span><span style={{ color: 'var(--brand-ink)' }}>{money(total)}</span>
          </div>
          <button className="btn btn--primary" style={{ width: '100%', justifyContent: 'center', padding: 13 }} disabled={!cart.length || placing} onClick={charge}>
            <Printer size={17} /> {t('orders.checkout')} · {money(total)}
          </button>
        </Card>
      </div>
    </div>
  );
}
