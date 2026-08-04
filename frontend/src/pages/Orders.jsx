import { useState, useMemo, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus, Minus, Trash2, Printer, Search, Receipt, User, X, Phone, Pencil, Wallet, Clock } from 'lucide-react';
import { useFetch } from '../hooks/useApi.js';
import { api, openReport } from '../api/client.js';
import { useUI } from '../store/ui.js';
import { usePosStats } from '../store/posStats.js';
import { Card, PageHeader, Spinner, Badge, Modal, LocationSelect } from '../components/ui.jsx';
import { money, shortName } from '../utils/format.js';
import { posFontStyle } from '../utils/posTypography.js';

const emptyCustForm = { name: '', phone: '', address: '', city: '', area: '' };

export default function Orders() {
  const { t } = useTranslation();
  const lang = useUI((s) => s.lang);
  const notify = useUI((s) => s.notify);
  const { data: products, loading } = useFetch('/products', []);
  const { data: clients, refetch: refetchClients } = useFetch('/clients', []);
  const { data: settings } = useFetch('/settings', []);
  const { refetch: refetchOrders } = useFetch('/orders', []);
  const { data: agents } = useFetch('/delivery-agents', []);
  // Restaurant-wide authoritative Cash Drawer total and Pending Payments
  // count come from a SHARED store (usePosStats), not a page-local fetch —
  // any page that settles a payment (e.g. PendingPayments.jsx) updates the
  // same store, so these figures are correct here the instant that happens,
  // not only after this page happens to remount. The backend Restaurant Cash
  // Ledger remains the only source of truth; this store just holds its last
  // fetched value so pages don't independently drift.
  const drawerAmount = usePosStats((s) => s.cashDrawerTotal);
  const pendingCount = usePosStats((s) => s.pendingPaymentsCount);
  const refreshCashDrawer = usePosStats((s) => s.refreshCashDrawer);
  const refreshPendingCount = usePosStats((s) => s.refreshPendingCount);
  useEffect(() => { refreshCashDrawer(); refreshPendingCount(); }, [refreshCashDrawer, refreshPendingCount]);
  const { data: locTree } = useFetch('/locations/tree', []);
  const confirm = useUI((s) => s.confirm);

  const [cart, setCart] = useState([]);
  const [cat, setCat] = useState('all');
  const [q, setQ] = useState('');
  const [custQuery, setCustQuery] = useState('');
  const [client, setClient] = useState(null);
  const [payment, setPayment] = useState('cash');
  const [walkIn, setWalkIn] = useState(false);
  const [deliveryAddress, setDeliveryAddress] = useState('');
  const [deliveryPerson, setDeliveryPerson] = useState('');
  const [deliveryAgentId, setDeliveryAgentId] = useState('');
  // When the cashier genuinely doesn't know who's delivering yet — the order
  // still goes out, but with no receipt printed and no delivery man name; it
  // lands in Pending Payments where one can be assigned and printed later.
  const [deliveryPersonUnknown, setDeliveryPersonUnknown] = useState(false);
  const [placing, setPlacing] = useState(false);
  // Shows the four simultaneous collection-method options (Paid Now / End of
  // Day / Print Unpaid / Cancel) the moment the cashier checks out a
  // delivery-agent order — all four visible at once, never one hidden behind
  // another screen.
  const [collectionModalOpen, setCollectionModalOpen] = useState(false);

  const [custModal, setCustModal] = useState(false);
  const [custForm, setCustForm] = useState(emptyCustForm);
  const [custEditingId, setCustEditingId] = useState(null);
  const [custSaving, setCustSaving] = useState(false);

  // A product created with no category (blank/undefined) used to add an
  // empty string into this list — an extra filter chip with no label at
  // all, rendering as a blank white button next to the real categories.
  const categories = useMemo(() => ['all', ...new Set((products || []).map((p) => p.category).filter(Boolean))], [products]);
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

  // A full phone number (7+ digits) typed with no match → offer to add a new customer.
  const looksLikePhone = /\d{7,}/.test(norm(custQuery));
  const showAddCustomer = !client && custQuery.trim().length >= 2 && custMatches.length === 0 && looksLikePhone;

  const openNewCustomer = () => {
    setCustEditingId(null);
    setCustForm({ ...emptyCustForm, phone: custQuery.trim() });
    setCustModal(true);
  };
  const openEditCustomer = () => {
    if (!client) return;
    setCustEditingId(client.id);
    setCustForm({
      name: client.name || '', phone: client.phoneNumbers?.[0] || '', address: client.addresses?.[0] || '',
      city: client.city || '', area: client.area || '',
    });
    setCustModal(true);
  };
  const saveCustomer = async () => {
    if (!custForm.name.trim()) { notify(t('common.name') + ' ' + t('common.required', 'is required'), 'error'); return; }
    setCustSaving(true);
    try {
      const payload = {
        name: custForm.name.trim(),
        phoneNumbers: custForm.phone ? [custForm.phone] : [],
        addresses: custForm.address ? [custForm.address] : [],
        city: custForm.city || '', area: custForm.area || '',
      };
      let saved;
      if (custEditingId) {
        const { data } = await api.put(`/clients/${custEditingId}`, payload);
        saved = data;
      } else {
        const { data } = await api.post('/clients', payload);
        saved = data;
      }
      notify(custEditingId ? t('clients.updated', 'Customer updated') : t('clients.added', 'Customer added'));
      setCustModal(false);
      refetchClients();
      // Select the new/updated customer immediately — continue the order flow
      // without forcing the cashier to search again.
      setClient(saved);
      setCustQuery('');
    } catch (e) {
      notify(e.response?.data?.error || 'Failed', 'error');
    } finally { setCustSaving(false); }
  };

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
  const activeAgents = (agents || []).filter((a) => a.active !== false);

  const selectAgent = (id) => {
    setDeliveryAgentId(id);
    const agent = activeAgents.find((a) => a.id === id);
    if (agent) setDeliveryPerson(agent.name);
  };

  const resetCart = () => {
    setCart([]); setClient(null); setCustQuery(''); setWalkIn(false); setDeliveryAddress(''); setDeliveryPerson('');
    setDeliveryAgentId(''); setDeliveryPersonUnknown(false);
  };

  /** Creates the order via the API, resets the cart, and returns the created
   * order — printing is left to the caller. `paymentTiming` is sent for ANY
   * delivery order (registered agent OR manual/free-text courier) — both
   * follow the exact same collection decision, so neither one bypasses the
   * other (see orderService.create's isDeliveryCollection gate). */
  const placeOrder = async ({ paymentTiming } = {}) => {
    const { data } = await api.post('/orders', {
      products: cart.map((x) => ({ productId: x.productId, quantity: x.quantity, unitPrice: x.unitPrice })),
      clientId: client?.id || null,
      clientName: client?.name || 'Walk-in',
      clientPhone: client?.phoneNumbers?.[0] || null,
      walkIn, isDelivery,
      deliveryAddress: isDelivery ? (deliveryAddress || client?.addresses?.[0] || '') : '',
      deliveryPerson: isDelivery ? deliveryPerson.trim() : '',
      deliveryAgentId: deliveryAgentId || null,
      paymentTiming: isDelivery ? paymentTiming : undefined,
      paymentMethod: payment, status: 'completed',
    });
    notify(`${t('orders.placed')} ${data.invoiceNo}`);
    resetCart();
    refetchOrders();
    return data;
  };

  const printInvoice = (order) => {
    // Receipt follows the current system language (no prompt).
    const ar = lang === 'ar';
    openReport(`/orders/${order.id}/invoice.pdf${ar ? '?lang=ar' : ''}`);
  };

  const charge = () => {
    if (!cart.length) return;
    // Delivery orders must record the delivery man's name (it is printed on
    // the receipt) — UNLESS the cashier has explicitly said they don't know
    // who it is yet, in which case the order still goes out, just without a
    // name and without printing right now.
    if (isDelivery && !deliveryPerson.trim() && !deliveryPersonUnknown) {
      notify(t('orders.deliveryPersonRequired', 'Enter the delivery man name first'), 'error');
      return;
    }
    if (isDelivery && deliveryPersonUnknown) {
      placeUnknownDelivery();
      return;
    }
    if (isDelivery) {
      // ANY delivery order — a registered Delivery Agent or a manual/free-text
      // courier name — goes through the exact same four-option collection
      // modal. Neither flow may bypass it or immediately count the order as
      // paid; the cashier decides right here, at checkout.
      setCollectionModalOpen(true);
      return;
    }
    // Non-delivery orders (the common walk-in/takeaway case) skip the
    // 4-option collection modal and are paid immediately — cash sales are
    // real money landing in the drawer right now, so refresh the shared
    // figure the instant the order is created, same as the delivery paths do.
    placeAndPrint().then((order) => { if (order && payment === 'cash') refreshCashDrawer(); });
  };

  /** Delivery man unknown at checkout time — save the order as a real pending
   * payment (nothing is collected/printed yet, exactly like End of Day), but
   * skip printing entirely: there is no delivery man name to put on a receipt
   * yet. It shows up in Pending Payments, where the name can be filled in and
   * the receipt printed once it's actually known. */
  const placeUnknownDelivery = async () => {
    setPlacing(true);
    try {
      const order = await placeOrder({ paymentTiming: 'END_OF_DAY' });
      notify(t('orders.deliveryPersonUnknownSaved', 'Order saved as pending — assign a delivery man in Pending Payments to print the receipt.'));
      refreshPendingCount();
      return order;
    } catch (e) {
      notify(e.response?.data?.error || 'Failed', 'error');
      return null;
    } finally { setPlacing(false); }
  };

  const placeAndPrint = async (paymentTiming) => {
    setPlacing(true);
    try {
      const order = await placeOrder({ paymentTiming });
      printInvoice(order);
      return order;
    } catch (e) {
      notify(e.response?.data?.error || 'Failed', 'error');
      return null;
    } finally { setPlacing(false); }
  };

  /** Option 1 — الدفع الآن + طباعة الإيصال. A SECOND confirmation step (not
   * one of the four options) verifies the cash was actually received before
   * the order is created at all — cancelling here creates nothing: no order,
   * no payment, no Cash Ledger/Drawer change. */
  const choosePaidNow = async () => {
    setCollectionModalOpen(false);
    const ok = await confirm({
      title: t('orders.collectTitle', 'Cash collected?'),
      message: t('orders.collectConfirm', 'Confirm you collected the payment from delivery man {{name}} before printing the receipt.').replace('{{name}}', deliveryPerson.trim()),
      confirmLabel: t('orders.collectedPrint', 'Collected — print receipt'),
    });
    if (!ok) return;
    const order = await placeAndPrint('PAID_NOW');
    if (order) refreshCashDrawer();
  };

  /** Option 2 — الدفع آخر اليوم + طباعة الإيصال. Order is created as a real
   * PENDING record immediately, printed immediately, no "cash received"
   * prompt (the money hasn't been received). */
  const choosePayEndOfDay = async () => {
    setCollectionModalOpen(false);
    const order = await placeAndPrint('END_OF_DAY');
    if (order) refreshPendingCount();
  };

  /** Option 3 — طباعة الإيصال فقط — لم يتم الدفع بعد. Distinct paymentTiming
   * from END_OF_DAY (different business intent), same PENDING mechanics. */
  const choosePrintUnpaid = async () => {
    setCollectionModalOpen(false);
    const order = await placeAndPrint('UNPAID_PRINTED');
    if (order) refreshPendingCount();
  };

  /** Option 4 — إلغاء. Closes the dialog; nothing was created, nothing changes. */
  const cancelCollectionChoice = () => setCollectionModalOpen(false);

  if (loading) return <Spinner />;

  return (
    <div className="fade-in">
      <PageHeader title={t('orders.title')} subtitle={t('orders.subtitle')}>
        <div className="row wrap" style={{ gap: 8 }}>
          {drawerAmount != null && (
            <Badge kind="brand"><Wallet size={12} /> {t('orders.cashInDrawer', 'Cash in Drawer')}: {money(drawerAmount)}</Badge>
          )}
          <Badge kind={pendingCount > 0 ? 'warning' : 'brand'}><Clock size={12} /> {t('pendingPayments.title', 'Pending Payments')}: {pendingCount}</Badge>
        </div>
      </PageHeader>
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 360px', gap: 18, alignItems: 'start', ...posFontStyle(settings) }}>
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
                <div className="row" style={{ gap: 4 }}>
                  <button className="btn btn--icon btn--sm" title={t('common.edit')} onClick={openEditCustomer}>
                    <Pencil size={13} />
                  </button>
                  <button className="btn btn--icon btn--sm" title={t('orders.walkIn')} onClick={() => { setClient(null); setCustQuery(''); }}>
                    <X size={14} />
                  </button>
                </div>
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
                {custQuery.trim().length >= 2 && custMatches.length === 0 && !showAddCustomer && (
                  <div className="muted" style={{ fontSize: 12, padding: '6px 4px 0' }}>{t('orders.customerNone')}</div>
                )}
                {showAddCustomer && (
                  <button className="btn btn--sm btn--primary" style={{ width: '100%', justifyContent: 'center', marginTop: 8 }} onClick={openNewCustomer}>
                    <Plus size={14} /> {t('clients.notFound', 'Customer not found')} — {t('clients.addCustomer', 'Add Customer')}
                  </button>
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
            <>
              {activeAgents.length > 0 && (
                <div className="field" style={{ marginBottom: 10 }}>
                  <label>{t('orders.deliveryAgent', 'Delivery Agent')}</label>
                  <select className="select" value={deliveryAgentId} onChange={(e) => selectAgent(e.target.value)}>
                    <option value="">{t('orders.noAgent', 'No agent (walk-in courier)')}</option>
                    {activeAgents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                  </select>
                </div>
              )}
              <div className="field" style={{ marginBottom: 10 }}>
                <label>{t('orders.deliveryPerson', 'Delivery Man')} {!deliveryPersonUnknown && '*'}</label>
                {/* Required for delivery orders — printed on the receipt —
                  * unless the cashier doesn't know it yet (see checkbox below). */}
                <input className="input" value={deliveryPerson} disabled={deliveryPersonUnknown}
                  onChange={(e) => setDeliveryPerson(e.target.value)}
                  placeholder={t('orders.deliveryPersonPlaceholder', "Delivery man's name")} />
              </div>
              <button className={`btn btn--sm ${deliveryPersonUnknown ? 'btn--primary' : ''}`}
                style={{ width: '100%', justifyContent: 'center', marginBottom: 10 }}
                onClick={() => { setDeliveryPersonUnknown((v) => !v); if (!deliveryPersonUnknown) setDeliveryPerson(''); }}>
                {deliveryPersonUnknown ? '✓ ' : ''}{t('orders.deliveryPersonUnknown', "I don't know the delivery man yet")}
              </button>
              {deliveryPersonUnknown && (
                <div className="muted" style={{ fontSize: 11.5, marginBottom: 10 }}>
                  {t('orders.deliveryPersonUnknownHint', 'The order will be saved as pending and nothing will print now. Assign the delivery man later from Pending Payments to print the receipt.')}
                </div>
              )}
              <div className="field" style={{ marginBottom: 10 }}>
                <label>{t('orders.deliveryAddress', 'Delivery Address')}</label>
                {/* Multi-line textarea for detailed delivery addresses (landmarks, floor, apartment) */}
                <textarea className="textarea" rows={3} value={deliveryAddress}
                  onChange={(e) => setDeliveryAddress(e.target.value)}
                  placeholder={client?.addresses?.[0] || t('orders.deliveryAddressPlaceholder', 'Street, building, floor, apartment, landmarks…')} />
              </div>
              {/* Applies whether or not a registered agent is picked — a
                * manual/free-text courier goes through the exact same
                * collection decision as a registered Delivery Agent. */}
              {!deliveryPersonUnknown && (
                <div className="muted" style={{ fontSize: 11.5, marginBottom: 10 }}>
                  {t('orders.collectionChoiceHint', 'Choosing to checkout will ask how the delivery agent will pay.')}
                </div>
              )}
            </>
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

      {/* Inline add/edit customer — keeps the cashier in the order flow */}
      <Modal open={custModal} onClose={() => setCustModal(false)} title={custEditingId ? t('clients.edit', 'Edit Customer') : t('clients.new', 'New Customer')}
        footer={<><button className="btn" onClick={() => setCustModal(false)}>{t('common.cancel')}</button><button className="btn btn--primary" disabled={custSaving} onClick={saveCustomer}>{t('common.save')}</button></>}>
        <div className="field"><label>{t('common.name')}</label><input className="input" autoFocus value={custForm.name} onChange={(e) => setCustForm({ ...custForm, name: e.target.value })} /></div>
        <div className="field"><label>{t('common.phone')}</label><input className="input ltr" value={custForm.phone} onChange={(e) => setCustForm({ ...custForm, phone: e.target.value })} placeholder="+20 100 000 0000" /></div>
        <div style={{ marginBottom: 14 }}>
          <LocationSelect tree={locTree || {}} city={custForm.city} area={custForm.area}
            onChange={({ city, area }) => setCustForm({ ...custForm, city, area })} />
        </div>
        <div className="field">
          <label>{t('clients.deliveryAddress', 'Delivery Address')}</label>
          <textarea className="textarea" rows={3} value={custForm.address} onChange={(e) => setCustForm({ ...custForm, address: e.target.value })} placeholder={t('clients.addressPlaceholder', 'Street, building, floor, apartment, landmarks…')} />
        </div>
      </Modal>

      {/* Delivery-agent collection choice — all four options visible at once.
       * The "cash received?" confirmation is a SEPARATE, second step that only
       * follows choosing Option 1 (see choosePaidNow) — it never replaces or
       * hides these four options. */}
      <Modal open={collectionModalOpen} onClose={cancelCollectionChoice} title={t('orders.collectionChooseTitle', 'Choose Collection Method')} footer={null}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <button className="btn btn--primary" style={{ width: '100%', justifyContent: 'center', padding: 12 }} disabled={placing} onClick={choosePaidNow}>
            {t('orders.paidNowPrint', 'Pay Now + Print Receipt')}
          </button>
          <button className="btn" style={{ width: '100%', justifyContent: 'center', padding: 12 }} disabled={placing} onClick={choosePayEndOfDay}>
            {t('orders.payEndOfDayPrint', 'Pay at End of Day + Print Receipt')}
          </button>
          <div className="muted" style={{ fontSize: 11.5, marginTop: -6 }}>
            {t('orders.pendingUntilCollected', 'The order will be saved as a pending payment. The amount will not be added to the Cash Drawer until collection is confirmed.')}
          </div>
          <button className="btn" style={{ width: '100%', justifyContent: 'center', padding: 12 }} disabled={placing} onClick={choosePrintUnpaid}>
            {t('orders.printUnpaid', 'Print receipt only — not paid yet')}
          </button>
          <div className="muted" style={{ fontSize: 11.5, marginTop: -6 }}>
            {t('orders.unpaidPrintedHint', 'The receipt will print now, but the payment has not been received. The order will be saved as a pending payment until it is collected and confirmed.')}
          </div>
          <button className="btn btn--ghost" style={{ width: '100%', justifyContent: 'center', padding: 12 }} onClick={cancelCollectionChoice}>
            {t('common.cancel')}
          </button>
        </div>
      </Modal>
    </div>
  );
}
