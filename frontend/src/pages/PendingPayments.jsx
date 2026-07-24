import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Search, CheckCircle2, Printer, Clock, Wallet, ListChecks } from 'lucide-react';
import { api, openReport } from '../api/client.js';
import { useFetch } from '../hooks/useApi.js';
import { usePaginated } from '../hooks/usePaginated.js';
import { useUI } from '../store/ui.js';
import { usePosStats } from '../store/posStats.js';
import { Card, PageHeader, Spinner, Badge, DataTable, Dropdown, DateField, Stat } from '../components/ui.jsx';
import { money, shortName, date } from '../utils/format.js';

export default function PendingPayments() {
  const { t } = useTranslation();
  const lang = useUI((s) => s.lang);
  const notify = useUI((s) => s.notify);
  const confirm = useUI((s) => s.confirm);
  const { data: agents } = useFetch('/delivery-agents', []);

  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [agentId, setAgentId] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  // `q` is what the input displays (updates on every keystroke so typing feels
  // responsive); `debouncedQ` is what actually drives the request, updated
  // only once the user pauses typing — so we don't fire a request per
  // character.
  const [q, setQ] = useState('');
  const [debouncedQ, setDebouncedQ] = useState('');
  const [status, setStatus] = useState('pending');
  const [selected, setSelected] = useState([]);

  useEffect(() => {
    const id = setTimeout(() => setDebouncedQ(q.trim()), 400);
    return () => clearTimeout(id);
  }, [q]);

  // Requests can resolve out of order (e.g. the user changes several filters
  // in quick succession before the first request returns) — without a guard,
  // a slower, now-stale response can land AFTER a faster, newer one and
  // silently overwrite the table with results that don't match the current
  // filters. `requestSeq` tags every in-flight request so only the most
  // recently *issued* one is ever allowed to update state.
  const requestSeq = useRef(0);

  const fetchPending = useCallback(async () => {
    const seq = ++requestSeq.current;
    setLoading(true);
    try {
      const params = { status };
      if (agentId) params.agentId = agentId;
      if (dateFrom) params.dateFrom = dateFrom;
      if (dateTo) params.dateTo = dateTo;
      if (debouncedQ) params.q = debouncedQ;
      const { data } = await api.get('/orders/pending-payments', { params });
      if (seq !== requestSeq.current) return; // a newer request has since been issued — discard this stale response
      setRows(data || []);
      setSelected([]);
    } catch { /* ignore */ }
    finally { if (seq === requestSeq.current) setLoading(false); }
  }, [agentId, dateFrom, dateTo, debouncedQ, status]);

  useEffect(() => { fetchPending(); }, [fetchPending]);

  // The restaurant-wide "Pending Orders"/"Pending Amount" summary must stay
  // correct regardless of whatever agent/date/status/search filter is
  // currently applied to the table below — sourced from the same shared
  // store the POS badge uses, refreshed once on mount and again after any
  // settlement here.
  const truePendingCount = usePosStats((s) => s.pendingPaymentsCount);
  const truePendingTotal = usePosStats((s) => s.pendingPaymentsTotal);
  const refreshPendingCount = usePosStats((s) => s.refreshPendingCount);
  useEffect(() => { refreshPendingCount(); }, [refreshPendingCount]);

  const { page, pageSize, totalPages, totalItems, setPage, setPageSize, paginatedData } = usePaginated(rows, 10);

  const toggleSelect = (id) => setSelected((s) => s.includes(id) ? s.filter((x) => x !== id) : [...s, id]);

  const printInvoice = (order) => {
    const ar = lang === 'ar';
    openReport(`/orders/${order.id}/invoice.pdf${ar ? '?lang=ar' : ''}`);
  };

  const markPaid = async (order) => {
    const agentName = order.deliveryAgentName || order.deliveryPerson || '';
    const ok = await confirm({
      title: t('pendingPayments.confirmSettleTitle', 'Was the payment received?'),
      message: t('pendingPayments.confirmSettleSingle', 'Confirm that you received the payment from delivery agent {{name}}.').replace('{{name}}', agentName),
      confirmLabel: t('pendingPayments.confirmSettleAction', 'Received — Confirm Collection'),
    });
    if (!ok) return;
    try {
      await api.patch(`/orders/${order.id}/mark-paid`);
      notify(t('pendingPayments.settled', 'Payment settled'));
      await fetchPending();
      // Settlement succeeded on the backend — immediately update the SHARED
      // Cash Drawer/Pending Payments store so any other mounted component
      // (or the next page the cashier visits) reflects it instantly, with no
      // navigation, reload, or logout required.
      usePosStats.getState().refreshAll();
      // Collect is a payment-settlement action only — the receipt was already
      // printed once from the POS when the order was created (End of Day /
      // Print Unpaid both print immediately at creation time). Do NOT print
      // again here; use the row's own Print Invoice button if a reprint is
      // ever needed.
    } catch (e) { notify(e.response?.data?.error || 'Failed', 'error'); }
  };

  // Selection can only ever contain still-pending rows (the checkbox is
  // hidden for already-paid ones below), but filter defensively anyway.
  const selectedTotal = useMemo(
    () => rows.filter((r) => selected.includes(r.id) && r.paymentStatus !== 'paid').reduce((s, r) => s + (r.totalPrice || 0), 0),
    [rows, selected],
  );
  // The amount actually OWED by this agent — must exclude already-settled
  // orders, otherwise switching the Status filter to "Paid"/"All" would
  // inflate this figure with money that was already collected.
  const agentTotal = useMemo(
    () => (agentId ? rows.filter((r) => r.deliveryAgentId === agentId && r.paymentStatus !== 'paid').reduce((s, r) => s + (r.totalPrice || 0), 0) : 0),
    [rows, agentId],
  );
  const agentName = (agents || []).find((a) => a.id === agentId)?.name || '';

  const settleSelected = async () => {
    if (!selected.length) return;
    const ok = await confirm({
      title: t('pendingPayments.settleSelected', 'Settle Selected'),
      message: t('pendingPayments.confirmReceiveAmount', 'Confirm receiving {{amount}} ({{count}} orders)?')
        .replace('{{amount}}', money(selectedTotal)).replace('{{count}}', String(selected.length)),
      confirmLabel: t('pendingPayments.confirmReceive', 'Confirm Receipt'),
    });
    if (!ok) return;
    try {
      const { data } = await api.patch('/orders/bulk-mark-paid', { orderIds: selected });
      notify(t('pendingPayments.bulkSettled', 'Payments settled') + (data?.skipped ? ` (${data.skipped} ${t('pendingPayments.alreadySettled', 'already settled')})` : ''));
      fetchPending();
      usePosStats.getState().refreshAll();
    } catch (e) { notify(e.response?.data?.error || 'Failed', 'error'); }
  };

  const settleForAgent = async () => {
    if (!agentId) return;
    const ok = await confirm({
      title: t('pendingPayments.settleSelected', 'Settle Selected'),
      message: t('pendingPayments.confirmReceiveFromAgent', 'Confirm receiving {{amount}} from delivery agent {{name}}?')
        .replace('{{amount}}', money(agentTotal)).replace('{{name}}', agentName),
      confirmLabel: t('pendingPayments.confirmReceive', 'Confirm Receipt'),
    });
    if (!ok) return;
    try {
      const { data } = await api.patch('/orders/bulk-mark-paid', { agentId });
      notify(t('pendingPayments.bulkSettled', 'Payments settled') + (data?.skipped ? ` (${data.skipped} ${t('pendingPayments.alreadySettled', 'already settled')})` : ''));
      fetchPending();
      usePosStats.getState().refreshAll();
    } catch (e) { notify(e.response?.data?.error || 'Failed', 'error'); }
  };

  if (loading && !rows.length) return <Spinner />;

  return (
    <div className="fade-in">
      <PageHeader title={t('pendingPayments.title', 'Pending Payments')} subtitle={t('pendingPayments.subtitle', 'Delivery-agent orders awaiting cash collection')} />

      {/* Summary stats — same Stat component/tokens as Dashboard/Inventory/Goods
       * Check, but width-capped instead of stretched to fill the row: with
       * only 3 tiles, letting them grow to 1fr each left large empty areas
       * inside every card. */}
      <div className="row wrap" style={{ gap: 14, marginBottom: 16 }}>
        <div style={{ flex: '0 1 240px' }}><Stat label={t('pendingPayments.pendingCount', 'Pending Orders')} value={truePendingCount ?? 0} icon={Clock} color="linear-gradient(135deg,#f59e0b,#fbbf24)" /></div>
        <div style={{ flex: '0 1 240px' }}><Stat label={t('pendingPayments.pendingAmount', 'Pending Amount')} value={money(truePendingTotal ?? 0)} icon={Wallet} color="linear-gradient(135deg,#ef4444,#f87171)" /></div>
        <div style={{ flex: '0 1 240px' }}><Stat label={t('pendingPayments.filteredResults', 'Filtered Results')} value={rows.length} icon={ListChecks} color="linear-gradient(135deg,#7c3aed,#a855f7)" /></div>
      </div>

      <div className="card" style={{ padding: 14, marginBottom: 16 }}>
        {/* flexWrap: 'wrap' (not overflowX: 'auto' + flexWrap: 'nowrap') — per
         * the CSS spec, giving a container overflow-x:auto forces its
         * overflow-y to auto as well, which silently clips the Dropdown/
         * DateField popovers below (they're absolutely positioned and open
         * outside this row's own box), making every filter list unusable. */}
        <div className="row" style={{ gap: 10, alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <div className="field" style={{ flex: '1 1 0', minWidth: 130, marginBottom: 0 }}>
            <label>{t('pendingPayments.filterByAgent', 'Delivery Agent')}</label>
            <Dropdown value={agentId} onChange={setAgentId}
              placeholder={t('pendingPayments.allAgents', 'All agents')}
              options={[{ value: '', label: t('pendingPayments.allAgents', 'All agents') }, ...(agents || []).map((a) => ({ value: a.id, label: a.name }))]} />
          </div>
          <div className="field" style={{ flex: '1 1 0', minWidth: 115, marginBottom: 0 }}>
            <DateField label={t('reports.from', 'From')} value={dateFrom} onChange={setDateFrom} />
          </div>
          <div className="field" style={{ flex: '1 1 0', minWidth: 115, marginBottom: 0 }}>
            <DateField label={t('reports.to', 'To')} value={dateTo} onChange={setDateTo} />
          </div>
          <div className="field" style={{ flex: '1 1 0', minWidth: 115, marginBottom: 0 }}>
            <label>{t('common.status')}</label>
            <Dropdown value={status} onChange={setStatus} options={[
              { value: 'pending', label: t('orders.paymentPending', 'Pending Payment') },
              { value: 'paid', label: t('orders.paymentPaid', 'Paid') },
              { value: 'all', label: t('common.all') },
            ]} />
          </div>
          <div className="field" style={{ flex: '1.6 1 0', minWidth: 170, marginBottom: 0 }}>
            <label>&nbsp;</label>
            <div className="search"><Search size={15} color="var(--muted)" /><input placeholder={t('pendingPayments.searchPlaceholder', 'Search order ID or customer…')} value={q} onChange={(e) => setQ(e.target.value)} /></div>
          </div>
        </div>
        {agentId && (
          <div className="row between wrap" style={{
            marginTop: 14, padding: '12px 14px', gap: 10, borderRadius: 'var(--r-md)',
            background: 'var(--brand-100)', border: '1px solid var(--border)',
          }}>
            <span style={{ fontWeight: 700, color: 'var(--brand-ink)' }}>
              {t('pendingPayments.totalOwedByAgent', 'Total owed by agent {{name}}').replace('{{name}}', agentName)}: {money(agentTotal)}
            </span>
            <button className="btn btn--primary btn--sm" disabled={!agentTotal} onClick={settleForAgent}><CheckCircle2 size={14} /> {t('pendingPayments.settleSelected', 'Settle Selected')}</button>
          </div>
        )}
      </div>

      {selected.length > 0 && (
        <div className="row between wrap" style={{
          marginBottom: 16, padding: '10px 14px', gap: 10, borderRadius: 'var(--r-md)',
          background: 'var(--brand-100)', border: '1px solid var(--border)',
        }}>
          <Badge kind="brand">{selected.length} {t('pendingPayments.selected', 'selected')} · {money(selectedTotal)}</Badge>
          <button className="btn btn--primary btn--sm" onClick={settleSelected}><CheckCircle2 size={14} /> {t('pendingPayments.settleSelected', 'Settle Selected')}</button>
        </div>
      )}

      <Card title={t('pendingPayments.title', 'Pending Payments')} sub={`${totalItems} ${t('pendingPayments.results', 'results')}`}>
        <DataTable
          columns={[
            { key: 'sel', label: '', render: (_, r) => (
              // Only still-pending rows can be selected for bulk settlement —
              // an already-paid row has nothing left to collect, and letting
              // it be selected would silently inflate the "N selected" total
              // preview with money that was already received.
              r.paymentStatus !== 'paid'
                ? <input type="checkbox" checked={selected.includes(r.id)} onChange={() => toggleSelect(r.id)} style={{ accentColor: 'var(--brand)' }} />
                : null) },
            { key: 'invoiceNo', label: t('pendingPayments.orderId', 'Order ID'), render: (v, r) => <span style={{ fontWeight: 600 }}>{v || r.id}</span> },
            { key: 'deliveryAgentName', label: t('pendingPayments.filterByAgent', 'Delivery Agent'), render: (v, r) => v || r.deliveryPerson || '—' },
            { key: 'clientName', label: t('pendingPayments.customer', 'Customer'), render: (v) => shortName(v, lang) },
            { key: 'orderDate', label: t('pendingPayments.orderDate', 'Order Date'), render: (v) => date(v) },
            { key: 'totalPrice', label: t('pendingPayments.total', 'Total'), align: 'end', render: (v) => <span style={{ fontWeight: 700 }}>{money(v)}</span> },
            // Payment Status + Payment Timing carried no independent
            // information from each other on this page — every non-paid row
            // is, by definition, "Pending Payment", so its timing label alone
            // (Pay at End of Day / Print receipt only) already communicates
            // that. Merging them into one column removes an entire redundant
            // column, which was pushing the Actions column out of view and
            // forcing horizontal scrolling on normal desktop widths.
            { key: 'paymentStatus', label: t('orders.paymentStatus', 'Payment Status'), render: (v, r) => {
              if (v === 'paid') {
                return r.paymentTiming === 'PAID_NOW'
                  ? <Badge kind="success">{t('orders.paidNow', 'Paid Now')}</Badge>
                  : <Badge kind="success">{t('orders.paymentPaid', 'Paid')}</Badge>;
              }
              if (r.paymentTiming === 'UNPAID_PRINTED') return <Badge kind="warning">{t('orders.printUnpaid', 'Print receipt only — not paid yet')}</Badge>;
              return <Badge kind="warning">{t('orders.payEndOfDay', 'Pay at End of Day')}</Badge>;
            } },
            { key: 'cashierName', label: t('pendingPayments.createdBy', 'Created By'), render: (v) => <span className="muted">{v || '—'}</span> },
            { key: 'paidAt', label: t('pendingPayments.paymentDate', 'Payment Date'), render: (v) => <span className="muted">{v ? date(v) : '—'}</span> },
            { key: 'actions', label: t('common.actions'), render: (_, r) => (
              <div className="row" style={{ gap: 6 }}>
                {r.paymentStatus !== 'paid' && (
                  <button className="btn btn--sm btn--primary" onClick={() => markPaid(r)}><CheckCircle2 size={13} /> {t('pendingPayments.collect', 'Collect')}</button>
                )}
                <button className="btn btn--icon btn--sm" title={t('pendingPayments.printInvoice', 'Print Invoice')} onClick={() => printInvoice(r)}><Printer size={13} /></button>
              </div>) },
          ]}
          rows={paginatedData}
          empty={t('pendingPayments.empty', 'No pending payments.')}
          pagination={{ currentPage: page, totalPages, onPageChange: setPage, pageSize, totalItems, onPageSizeChange: setPageSize }}
        />
      </Card>
    </div>
  );
}
