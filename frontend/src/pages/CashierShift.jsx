import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Wallet, LockOpen, Lock, RefreshCw, CheckCircle2, ArrowRightLeft, Undo2, Printer, Award, BarChart3, Eye, FileDown } from 'lucide-react';
import { useFetch } from '../hooks/useApi.js';
import { api, openReport } from '../api/client.js';
import { useUI } from '../store/ui.js';
import { useAuth } from '../store/auth.js';
import { usePosStats } from '../store/posStats.js';
import { Card, PageHeader, Spinner, Dropdown, DataTable, Badge, DateField, Modal } from '../components/ui.jsx';
import { money, shortName, datetime, date } from '../utils/format.js';

export default function CashierShift() {
  const { t } = useTranslation();
  const lang = useUI((s) => s.lang);
  const notify = useUI((s) => s.notify);
  const confirm = useUI((s) => s.confirm);
  const user = useAuth((s) => s.user);
  const { data: shift, loading, refetch } = useFetch('/cashier-shifts/current');
  const { data: cashiers } = useFetch('/workers/cashiers', []);
  const [shiftFrom, setShiftFrom] = useState('');
  const [shiftTo, setShiftTo] = useState('');
  const historyUrl = `/cashier-shifts${shiftFrom || shiftTo ? `?${new URLSearchParams({ ...(shiftFrom ? { from: shiftFrom } : {}), ...(shiftTo ? { to: shiftTo } : {}) })}` : ''}`;
  const { data: history, refetch: refetchHistory } = useFetch(historyUrl, [historyUrl]);
  const cashDrawerTotal = usePosStats((s) => s.cashDrawerTotal);

  useEffect(() => { usePosStats.getState().refreshCashDrawer(); }, []);

  const [openingFloat, setOpeningFloat] = useState('');
  const [countedCash, setCountedCash] = useState('');
  const [nextCashierId, setNextCashierId] = useState('');
  const [depositedToOwner, setDepositedToOwner] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);

  // Clicking a row in "Recent shifts" (or "View Analytics" on the current
  // open shift) opens the full Shift Analytics report — every metric plus
  // every invoice generated during it, with a print button per invoice and a
  // click-through to see its full line-item detail.
  const [shiftDetail, setShiftDetail] = useState(null);
  const [shiftDetailData, setShiftDetailData] = useState(null);
  const [invoiceDetail, setInvoiceDetail] = useState(null);

  const viewShiftDetail = async (row) => {
    setShiftDetail(row);
    setShiftDetailData(null);
    const { data } = await api.get(`/cashier-shifts/${row.id}/analytics`);
    setShiftDetailData(data);
  };

  const printInvoice = (order) => {
    const ar = lang === 'ar';
    openReport(`/orders/${order.id}/invoice.pdf${ar ? '?lang=ar' : ''}`);
  };

  const exportShiftAnalyticsPdf = () => {
    if (!shiftDetail) return;
    const ar = lang === 'ar';
    openReport(`/cashier-shifts/${shiftDetail.id}/analytics.pdf${ar ? '?lang=ar' : ''}`);
  };

  const reload = () => { refetch(); refetchHistory(); };

  const openShift = async () => {
    setBusy(true);
    try {
      const { data } = await api.post('/cashier-shifts/open', { openingFloat: Number(openingFloat) || 0 });
      const d = data?.openingDifference || 0;
      const openMsg = d === 0
        ? t('cashierShift.opened', 'Shift opened')
        : d > 0
          ? `${t('cashierShift.opened', 'Shift opened')} — ${t('cashierShift.over', 'Over by')} ${money(d)}`
          : `${t('cashierShift.opened', 'Shift opened')} — ${t('cashierShift.short', 'Short by')} ${money(Math.abs(d))}`;
      notify(openMsg, d === 0 ? 'success' : 'info');
      setOpeningFloat('');
      reload();
      // Opening a shift may adjust the Cash Ledger (an over/short difference)
      // — refresh the shared Cash Drawer figure so the Topbar/Dashboard/POS
      // reflect it immediately instead of showing a stale number.
      usePosStats.getState().refreshCashDrawer();
    } catch (e) { notify(e.response?.data?.error || 'Failed', 'error'); }
    finally { setBusy(false); }
  };

  const closeShift = async () => {
    if (countedCash === '') { notify(t('cashierShift.enterCounted', 'Enter the counted cash amount'), 'error'); return; }
    if (!confirmed) { notify(t('cashierShift.mustConfirm', 'Please confirm the counted amount'), 'error'); return; }
    setBusy(true);
    try {
      await api.post(`/cashier-shifts/${shift.id}/close`, {
        countedCash: Number(countedCash),
        nextCashierId: nextCashierId || null,
        depositedToOwner,
        notes,
      });
      notify(t('cashierShift.closed', 'Shift closed & saved'));
      setCountedCash(''); setNextCashierId(''); setDepositedToOwner(false); setConfirmed(false); setNotes('');
      reload();
      // Closing with "deposited to the owner" removes that cash from the
      // drawer — refresh the shared figure immediately either way.
      usePosStats.getState().refreshCashDrawer();
    } catch (e) { notify(e.response?.data?.error || 'Failed', 'error'); }
    finally { setBusy(false); }
  };

  const undoClose = async (row) => {
    const ok = await confirm({
      title: t('cashierShift.undoTitle', 'Undo shift close?'),
      message: t('cashierShift.undoMessage', 'This reopens the shift. Any cash already deposited to the owner for it is put back in the Cash Drawer total — nothing is added on top of that.'),
      confirmLabel: t('cashierShift.undoBtn', 'Undo close'),
      danger: true,
    });
    if (!ok) return;
    setBusy(true);
    try {
      await api.patch(`/cashier-shifts/${row.id}/reopen`);
      notify(t('cashierShift.undone', 'Shift reopened'));
      reload();
      usePosStats.getState().refreshCashDrawer();
    } catch (e) { notify(e.response?.data?.error || 'Failed', 'error'); }
    finally { setBusy(false); }
  };

  if (loading) return <Spinner />;

  // Only cashiers with a real login account can prove their identity with a
  // password, so only they can receive a handover — a plain employee-only
  // "cashier" record with no app access is structurally excluded here.
  const cashierOptions = (cashiers || []).filter((c) => c.id !== user?.id).map((c) => ({ value: c.id, label: shortName(c.name, lang) }));
  const expected = shift?.expectedCash || 0;
  const counted = countedCash === '' ? null : Number(countedCash);
  const diff = counted == null ? null : +(counted - expected).toFixed(2);

  const openingCounted = openingFloat === '' ? null : Number(openingFloat);
  const openingDiff = openingCounted == null || cashDrawerTotal == null ? null : +(openingCounted - cashDrawerTotal).toFixed(2);

  // Difference banner: exact / over (positive) / short (negative). Reused for
  // both the opening-count preview and the closing-count preview — same
  // "counted vs. what the ledger expects" comparison either way.
  const diffView = (diff) => {
    if (diff == null) return null;
    const kind = diff === 0 ? 'success' : diff > 0 ? 'info' : 'danger';
    const label = diff === 0
      ? t('cashierShift.exact', 'Exact — the box matches')
      : diff > 0
        ? `${t('cashierShift.over', 'Over by')} ${money(Math.abs(diff))}`
        : `${t('cashierShift.short', 'Short by')} ${money(Math.abs(diff))}`;
    return (
      <div className={`badge badge--${kind}`} style={{ fontSize: 15, padding: '10px 14px', width: '100%', justifyContent: 'center', marginTop: 4 }}>
        {diff > 0 ? '+' : diff < 0 ? '−' : ''}{diff !== 0 ? money(Math.abs(diff)) : ''} · {label}
      </div>
    );
  };

  const statRow = (label, value, strong) => (
    <div className="row between" style={{ padding: '9px 0', borderBottom: '1px solid var(--border)' }}>
      <span className="muted" style={{ fontSize: 13.5 }}>{label}</span>
      <span style={{ fontWeight: strong ? 800 : 600, fontSize: strong ? 17 : 14, color: strong ? 'var(--brand-700)' : 'var(--ink)' }}>{value}</span>
    </div>
  );

  const formatDuration = (ms) => {
    if (ms == null || ms < 0) return '—';
    const totalMinutes = Math.round(ms / 60000);
    const h = Math.floor(totalMinutes / 60);
    const m = totalMinutes % 60;
    return h > 0 ? `${h}h ${m}m` : `${m}m`;
  };
  const formatHour = (h) => `${String(h).padStart(2, '0')}:00`;
  const analyticsStat = (label, value) => (
    <div className="card" style={{ padding: 14 }}>
      <div className="muted" style={{ fontSize: 12 }}>{label}</div>
      <div style={{ fontWeight: 800, fontSize: 17 }}>{value}</div>
    </div>
  );

  return (
    <div className="fade-in">
      <PageHeader title={t('nav.cashierShift', 'Cashier Shift')} subtitle={t('cashierShift.subtitle', 'Open your till, reconcile the cash, and hand over to the next cashier')} />

      {!shift ? (
        <Card title={<span className="row" style={{ gap: 8 }}><LockOpen size={17} /> {t('cashierShift.openTitle', 'Open a shift')}</span>}
          sub={t('cashierShift.openSub', "Count the cash physically in the drawer — it's compared against the Cash Drawer total, not added to it, so only a real over/short difference is recorded")}
          style={{ maxWidth: 460 }}>
          <div className="field">
            <label>{t('cashierShift.openingFloat', 'Counted cash in the drawer')}</label>
            <input className="input" type="number" min={0} step="0.01" value={openingFloat}
              onChange={(e) => setOpeningFloat(e.target.value)} placeholder="0.00" />
          </div>
          {cashDrawerTotal != null && statRow(t('cashierShift.cashDrawerTotal', 'Cash Drawer total (ledger)'), money(cashDrawerTotal))}
          {diffView(openingDiff)}
          <button className="btn btn--primary" style={{ width: '100%', justifyContent: 'center', marginTop: 12 }} disabled={busy} onClick={openShift}>
            <LockOpen size={15} /> {t('cashierShift.openBtn', 'Open shift')}
          </button>
        </Card>
      ) : (
        <div className="grid grid--2" style={{ alignItems: 'start' }}>
          {/* Live status */}
          <Card title={<span className="row" style={{ gap: 8 }}><Wallet size={17} /> {t('cashierShift.currentTitle', 'Current shift')}</span>}
            actions={<div className="row" style={{ gap: 6 }}>
              <button className="btn btn--sm" onClick={() => viewShiftDetail(shift)}><BarChart3 size={13} /> {t('cashierShift.viewAnalytics', 'View Analytics')}</button>
              <button className="btn btn--sm" onClick={refetch}><RefreshCw size={13} /> {t('cashierShift.refresh', 'Refresh')}</button>
            </div>}>
            <div style={{ marginBottom: 10 }}>
              <Badge kind="success"><span className="dot" /> {t('cashierShift.open', 'Open')}</Badge>
              <span className="muted" style={{ marginInlineStart: 8, fontSize: 12.5 }}>{shift.cashierName ? shortName(shift.cashierName, lang) : ''}</span>
            </div>
            {statRow(t('cashierShift.openedAt', 'Opened at'), datetime(shift.openedAt))}
            {statRow(t('cashierShift.openingFloat', 'Opening cash (float)'), money(shift.openingFloat))}
            {!!shift.openingDifference && statRow(
              t('cashierShift.openingDifference', 'Opening difference'),
              <span style={{ color: shift.openingDifference > 0 ? 'var(--success)' : 'var(--danger)' }}>
                {shift.openingDifference > 0 ? '+' : '−'}{money(Math.abs(shift.openingDifference))}
              </span>,
            )}
            {statRow(t('cashierShift.cashSales', 'Cash sales this shift'), money(shift.cashSales))}
            {statRow(t('cashierShift.expected', 'Expected in the box'), money(expected), true)}
          </Card>

          {/* Count & close */}
          <Card title={<span className="row" style={{ gap: 8 }}><Lock size={17} /> {t('cashierShift.closeTitle', 'Count & close')}</span>}
            sub={t('cashierShift.closeSub', 'Count the cash in the box and confirm the amount')}>
            <div className="field">
              <label>{t('cashierShift.counted', 'Counted cash in the box')}</label>
              <input className="input" type="number" min={0} step="0.01" value={countedCash}
                onChange={(e) => setCountedCash(e.target.value)} placeholder="0.00" />
            </div>
            {diffView(diff)}

            <div className="field" style={{ marginTop: 14 }}>
              <label><ArrowRightLeft size={13} style={{ verticalAlign: 'middle' }} /> {t('cashierShift.nextCashier', 'Next cashier (handover)')}</label>
              <Dropdown value={nextCashierId} onChange={setNextCashierId} options={cashierOptions}
                placeholder={t('cashierShift.selectCashier', 'Select the cashier taking over')} />
            </div>

            <button className={`btn btn--sm ${depositedToOwner ? 'btn--primary' : ''}`} style={{ width: '100%', justifyContent: 'center', marginBottom: 12 }}
              onClick={() => setDepositedToOwner((v) => !v)}>
              {depositedToOwner ? '✓ ' : ''}{t('cashierShift.depositToOwner', 'Cash deposited to owner (reset next float to 0)')}
            </button>

            <div className="field">
              <label>{t('cashierShift.notes', 'Notes (optional)')}</label>
              <textarea className="textarea" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
            </div>

            <label className="row" style={{ gap: 8, cursor: 'pointer', marginBottom: 12, fontSize: 13.5 }}>
              <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
              {t('cashierShift.confirmCheck', 'I counted the cash and confirm the amount above')}
            </label>

            <button className="btn btn--primary" style={{ width: '100%', justifyContent: 'center' }} disabled={busy} onClick={closeShift}>
              <CheckCircle2 size={15} /> {t('cashierShift.closeBtn', 'Close shift & save')}
            </button>
          </Card>
        </div>
      )}

      {/* History */}
      <Card title={t('cashierShift.history', 'Recent shifts')} style={{ marginTop: 18 }}>
        <div className="row wrap" style={{ gap: 10, marginBottom: 14, alignItems: 'flex-end' }}>
          <div style={{ flex: '0 0 auto', minWidth: 160 }}>
            <DateField label={t('reports.from', 'From')} value={shiftFrom} onChange={setShiftFrom} />
          </div>
          <div style={{ flex: '0 0 auto', minWidth: 160 }}>
            <DateField label={t('reports.to', 'To')} value={shiftTo} onChange={setShiftTo} />
          </div>
          {(shiftFrom || shiftTo) && (
            <button className="btn btn--sm" onClick={() => { setShiftFrom(''); setShiftTo(''); }}>
              {t('common.clear', 'Clear')}
            </button>
          )}
        </div>
        <DataTable
          onRowClick={viewShiftDetail}
          columns={[
            { key: 'openedAt', label: t('cashierShift.openedAt', 'Opened'), render: (v) => datetime(v) },
            { key: 'closedAt', label: t('cashierShift.closedAt', 'Closed'), render: (v) => v ? datetime(v) : <Badge kind="success">{t('cashierShift.open', 'Open')}</Badge> },
            { key: 'expectedCash', label: t('cashierShift.expected', 'Expected'), align: 'end', render: (v) => money(v) },
            { key: 'countedCash', label: t('cashierShift.counted', 'Counted'), align: 'end', render: (v, r) => r.status === 'closed' ? money(v) : '—' },
            { key: 'difference', label: t('cashierShift.difference', 'Difference'), align: 'end', render: (v, r) => r.status !== 'closed' ? '—' : (
              <Badge kind={v === 0 ? 'success' : v > 0 ? 'info' : 'danger'}>{v > 0 ? '+' : v < 0 ? '−' : ''}{money(Math.abs(v))}</Badge>
            ) },
            { key: 'nextCashierName', label: t('cashierShift.nextCashier', 'Next cashier'), render: (v, r) => v ? shortName(v, lang) : (r.depositedToOwner ? <Badge kind="brand">{t('cashierShift.toOwner', 'To owner')}</Badge> : '—') },
            { key: '_actions', label: '', render: (v, r) => (r.status === 'closed' && r.cashierId === user?.id) ? (
              <button className="btn btn--sm" disabled={busy} onClick={(e) => { e.stopPropagation(); undoClose(r); }}>
                <Undo2 size={13} /> {t('cashierShift.undoBtn', 'Undo close')}
              </button>
            ) : null },
          ]}
          rows={history || []}
        />
      </Card>

      {/* Shift Analytics — every metric for this cashier's shift plus every
       * invoice generated during it, print per invoice, and a click-through
       * to each invoice's full line-item detail. */}
      <Modal open={!!shiftDetail} onClose={() => setShiftDetail(null)} wide
        title={shiftDetail ? `${t('cashierShift.analyticsTitle', 'Shift Analytics')} · ${datetime(shiftDetail.openedAt)}` : ''}>
        {!shiftDetailData ? <Spinner /> : (() => {
          const s = shiftDetailData.summary;
          return (
            <>
              <div className="row" style={{ justifyContent: 'flex-end', marginBottom: 12 }}>
                <button className="btn btn--sm" onClick={exportShiftAnalyticsPdf}>
                  <FileDown size={13} /> {t('cashierShift.exportPdf', 'Export PDF')}
                </button>
              </div>
              <div className="grid grid--stats" style={{ marginBottom: 16 }}>
                {analyticsStat(t('cashierShift.ordersCount', 'Total Orders'), s.totalOrders)}
                {analyticsStat(t('cashierShift.totalRevenue', 'Total Revenue'), money(s.totalRevenue))}
                {analyticsStat(t('cashierShift.avgOrderValue', 'Average Order Value'), money(s.averageOrderValue))}
                {analyticsStat(t('cashierShift.totalDiscounts', 'Total Discounts'), money(s.totalDiscounts))}
                {analyticsStat(t('cashierShift.totalTaxes', 'Total Taxes'), money(s.totalTaxes))}
                {analyticsStat(t('cashierShift.cancelledCount', 'Cancelled Orders'), s.cancelledCount)}
                {analyticsStat(t('cashierShift.peakHour', 'Peak Hour (Revenue)'), s.peakHour ? `${formatHour(s.peakHour.hour)} · ${money(s.peakHour.revenue)}` : '—')}
                {analyticsStat(t('cashierShift.lowestHour', 'Lowest Hour (Revenue)'), s.lowestHour ? `${formatHour(s.lowestHour.hour)} · ${money(s.lowestHour.revenue)}` : '—')}
                {analyticsStat(t('cashierShift.busiestHour', 'Busiest Hour (Orders)'), s.busiestHour ? `${formatHour(s.busiestHour.hour)} · ${s.busiestHour.count}` : '—')}
                {analyticsStat(t('cashierShift.avgGap', 'Avg. Time Between Orders'), formatDuration(s.averageTimeBetweenOrdersMs))}
                {analyticsStat(t('cashierShift.firstOrder', 'First Order'), s.firstOrderTime ? datetime(s.firstOrderTime) : '—')}
                {analyticsStat(t('cashierShift.lastOrder', 'Last Order'), s.lastOrderTime ? datetime(s.lastOrderTime) : '—')}
                {analyticsStat(t('cashierShift.duration', 'Shift Duration'), formatDuration(s.shiftDurationMs))}
                {analyticsStat(<span><Award size={12} style={{ verticalAlign: 'middle' }} /> {t('clients.mostOrdered', 'Most Ordered')}</span>,
                  s.topProduct ? `${shortName(s.topProduct.name, lang)} × ${s.topProduct.quantity}` : '—')}
              </div>

              <div className="card__title" style={{ marginBottom: 8 }}>{t('cashierShift.paymentBreakdown', 'Payment Method Breakdown')}</div>
              <div className="row wrap" style={{ gap: 8, marginBottom: 16 }}>
                {Object.keys(s.paymentBreakdown).length === 0 && <span className="muted">{t('orderHistory.empty', 'No orders found.')}</span>}
                {Object.entries(s.paymentBreakdown).map(([method, v]) => (
                  <Badge key={method} kind="brand">{t(`orders.${method}`, method)}: {v.count} · {money(v.total)}</Badge>
                ))}
              </div>

              <div className="card__title" style={{ marginBottom: 8 }}>{t('cashierShift.invoices', 'Invoices')}</div>
              <DataTable
                onRowClick={setInvoiceDetail}
                columns={[
                  { key: 'orderNumber', label: t('orderHistory.orderNumber', 'Order #'), render: (v) => <span className="ltr" style={{ fontWeight: 700 }}>{v || '—'}</span> },
                  { key: 'orderDate', label: t('common.date'), render: (v) => date(v) },
                  { key: 'clientName', label: t('common.name'), render: (v) => v ? shortName(v, lang) : <span className="muted">{t('orders.walkIn', 'Walk-in')}</span> },
                  { key: 'cashierName', label: t('orderHistory.cashier', 'Cashier') },
                  { key: 'paymentMethod', label: t('orders.payment', 'Payment'), render: (v) => t(`orders.${v}`, v) },
                  { key: 'totalPrice', label: t('common.total'), align: 'end', render: (v) => money(v) },
                  { key: 'status', label: t('common.status'), render: (v) => <Badge kind={v === 'cancelled' ? 'danger' : 'success'}>{t(`status.${v}`, v)}</Badge> },
                  {
                    key: '_act', label: t('common.actions'), render: (_, r) => (
                      <button className="btn btn--icon btn--sm" title={t('pendingPayments.printInvoice', 'Print Invoice')} onClick={(e) => { e.stopPropagation(); printInvoice(r); }}><Printer size={13} /></button>
                    ),
                  },
                ]}
                rows={shiftDetailData.invoices}
                empty={t('orderHistory.empty', 'No orders found.')}
              />
            </>
          );
        })()}
      </Modal>

      {/* Invoice detail — full line-item breakdown for a single invoice from the report above. */}
      <Modal open={!!invoiceDetail} onClose={() => setInvoiceDetail(null)}
        title={invoiceDetail ? `${t('orderHistory.orderNumber', 'Order #')} ${invoiceDetail.orderNumber}` : ''}
        footer={invoiceDetail && (
          <button className="btn btn--primary" onClick={() => printInvoice(invoiceDetail)}><Printer size={15} /> {t('pendingPayments.printInvoice', 'Print Invoice')}</button>
        )}>
        {invoiceDetail && (
          <>
            <div className="grid grid--3" style={{ marginBottom: 14 }}>
              <div className="card" style={{ padding: 12 }}><div className="muted" style={{ fontSize: 11 }}>{t('common.date')}</div><div style={{ fontWeight: 700 }}>{datetime(invoiceDetail.orderDate)}</div></div>
              <div className="card" style={{ padding: 12 }}><div className="muted" style={{ fontSize: 11 }}>{t('common.name')}</div><div style={{ fontWeight: 700 }}>{invoiceDetail.clientName ? shortName(invoiceDetail.clientName, lang) : t('orders.walkIn', 'Walk-in')}</div></div>
              <div className="card" style={{ padding: 12 }}><div className="muted" style={{ fontSize: 11 }}>{t('orderHistory.cashier', 'Cashier')}</div><div style={{ fontWeight: 700 }}>{invoiceDetail.cashierName || '—'}</div></div>
              <div className="card" style={{ padding: 12 }}><div className="muted" style={{ fontSize: 11 }}>{t('orders.payment', 'Payment')}</div><div style={{ fontWeight: 700 }}>{t(`orders.${invoiceDetail.paymentMethod}`, invoiceDetail.paymentMethod)}</div></div>
              <div className="card" style={{ padding: 12 }}><div className="muted" style={{ fontSize: 11 }}>{t('cashierShift.totalDiscounts', 'Total Discounts')}</div><div style={{ fontWeight: 700 }}>{money(invoiceDetail.discount)}</div></div>
              <div className="card" style={{ padding: 12 }}><div className="muted" style={{ fontSize: 11 }}>{t('cashierShift.totalTaxes', 'Total Taxes')}</div><div style={{ fontWeight: 700 }}>{money(invoiceDetail.tax)}</div></div>
            </div>
            <DataTable
              columns={[
                { key: 'name', label: t('common.name'), render: (v, r) => shortName(v, lang) },
                { key: 'quantity', label: t('common.quantity', 'Qty'), align: 'end' },
                { key: 'unitPrice', label: t('common.price', 'Unit Price'), align: 'end', render: (v) => money(v) },
                { key: 'lineTotal', label: t('common.total'), align: 'end', render: (v) => money(v) },
              ]}
              rows={invoiceDetail.products}
              empty={t('orders.empty', 'Cart is empty — tap a product')}
            />
            <div className="row between" style={{ marginTop: 12, fontSize: 17, fontWeight: 800 }}>
              <span>{t('common.total')}</span><span style={{ color: 'var(--brand-ink)' }}>{money(invoiceDetail.totalPrice)}</span>
            </div>
            {invoiceDetail.notes && (
              <div className="muted" style={{ marginTop: 10, fontSize: 12.5 }}>{t('cashierShift.notes', 'Notes')}: {invoiceDetail.notes}</div>
            )}
          </>
        )}
      </Modal>
    </div>
  );
}
