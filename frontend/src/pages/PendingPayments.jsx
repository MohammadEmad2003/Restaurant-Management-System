import { useState, useCallback, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Search, CheckCircle2, Printer } from 'lucide-react';
import { api, openReport } from '../api/client.js';
import { useFetch } from '../hooks/useApi.js';
import { usePaginated } from '../hooks/usePaginated.js';
import { useUI } from '../store/ui.js';
import { usePosStats } from '../store/posStats.js';
import { Card, PageHeader, Spinner, Badge, DataTable, Dropdown, DateField } from '../components/ui.jsx';
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
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('pending');
  const [selected, setSelected] = useState([]);

  const fetchPending = useCallback(async () => {
    setLoading(true);
    try {
      const params = { status };
      if (agentId) params.agentId = agentId;
      if (dateFrom) params.dateFrom = dateFrom;
      if (dateTo) params.dateTo = dateTo;
      if (q.trim()) params.q = q.trim();
      const { data } = await api.get('/orders/pending-payments', { params });
      setRows(data || []);
      setSelected([]);
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, [agentId, dateFrom, dateTo, q, status]);

  useEffect(() => { fetchPending(); }, [fetchPending]);

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
      printInvoice(order);
    } catch (e) { notify(e.response?.data?.error || 'Failed', 'error'); }
  };

  const selectedTotal = useMemo(
    () => rows.filter((r) => selected.includes(r.id)).reduce((s, r) => s + (r.totalPrice || 0), 0),
    [rows, selected],
  );
  const agentTotal = useMemo(
    () => (agentId ? rows.filter((r) => r.deliveryAgentId === agentId).reduce((s, r) => s + (r.totalPrice || 0), 0) : 0),
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

      <div className="card" style={{ padding: 14, marginBottom: 16 }}>
        <div className="row wrap" style={{ gap: 10, alignItems: 'flex-end' }}>
          <div className="field" style={{ flex: 1, minWidth: 160, marginBottom: 0 }}>
            <label>{t('pendingPayments.filterByAgent', 'Delivery Agent')}</label>
            <Dropdown value={agentId} onChange={setAgentId}
              placeholder={t('pendingPayments.allAgents', 'All agents')}
              options={[{ value: '', label: t('pendingPayments.allAgents', 'All agents') }, ...(agents || []).map((a) => ({ value: a.id, label: a.name }))]} />
          </div>
          <div className="field" style={{ flex: 1, minWidth: 140, marginBottom: 0 }}>
            <DateField label={t('reports.from', 'From')} value={dateFrom} onChange={setDateFrom} />
          </div>
          <div className="field" style={{ flex: 1, minWidth: 140, marginBottom: 0 }}>
            <DateField label={t('reports.to', 'To')} value={dateTo} onChange={setDateTo} />
          </div>
          <div className="field" style={{ flex: 1, minWidth: 140, marginBottom: 0 }}>
            <label>{t('common.status')}</label>
            <Dropdown value={status} onChange={setStatus} options={[
              { value: 'pending', label: t('orders.paymentPending', 'Pending Payment') },
              { value: 'paid', label: t('orders.paymentPaid', 'Paid') },
              { value: 'all', label: t('common.all') },
            ]} />
          </div>
          <div className="field" style={{ flex: 2, minWidth: 200, marginBottom: 0 }}>
            <label>&nbsp;</label>
            <div className="search"><Search size={15} color="var(--muted)" /><input placeholder={t('pendingPayments.searchPlaceholder', 'Search order ID or customer…')} value={q} onChange={(e) => setQ(e.target.value)} /></div>
          </div>
        </div>
        {agentId && (
          <div className="row between" style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--border)' }}>
            <span style={{ fontWeight: 700 }}>
              {t('pendingPayments.totalOwedByAgent', 'Total owed by agent {{name}}').replace('{{name}}', agentName)}: {money(agentTotal)}
            </span>
            <button className="btn btn--primary" disabled={!agentTotal} onClick={settleForAgent}><CheckCircle2 size={15} /> {t('pendingPayments.settleSelected', 'Settle Selected')}</button>
          </div>
        )}
      </div>

      {selected.length > 0 && (
        <div className="row between" style={{ marginBottom: 12 }}>
          <span className="badge badge--brand">{selected.length} {t('pendingPayments.selected', 'selected')} · {money(selectedTotal)}</span>
          <button className="btn btn--primary btn--sm" onClick={settleSelected}><CheckCircle2 size={14} /> {t('pendingPayments.settleSelected', 'Settle Selected')}</button>
        </div>
      )}

      <Card>
        <DataTable
          columns={[
            { key: 'sel', label: '', render: (_, r) => (
              <input type="checkbox" checked={selected.includes(r.id)} onChange={() => toggleSelect(r.id)} />) },
            { key: 'invoiceNo', label: t('pendingPayments.orderId', 'Order ID'), render: (v, r) => v || r.id },
            { key: 'deliveryAgentName', label: t('pendingPayments.filterByAgent', 'Delivery Agent'), render: (v, r) => v || r.deliveryPerson || '—' },
            { key: 'clientName', label: t('pendingPayments.customer', 'Customer'), render: (v) => shortName(v, lang) },
            { key: 'orderDate', label: t('pendingPayments.orderDate', 'Order Date'), render: (v) => date(v) },
            { key: 'totalPrice', label: t('pendingPayments.total', 'Total'), align: 'end', render: (v) => money(v) },
            { key: 'paymentStatus', label: t('orders.paymentStatus', 'Payment Status'), render: (v) => (
              v === 'paid'
                ? <Badge kind="success">{t('orders.paymentPaid', 'Paid')}</Badge>
                : <Badge kind="warning">{t('orders.paymentPending', 'Pending Payment')}</Badge>) },
            { key: 'paymentTiming', label: t('orders.paymentTiming', 'Payment Timing'), render: (v) => {
              if (v === 'PAID_NOW') return t('orders.paidNow', 'Paid Now');
              if (v === 'UNPAID_PRINTED') return t('orders.printUnpaid', 'Print receipt only — not paid yet');
              return t('orders.payEndOfDay', 'Pay at End of Day');
            } },
            { key: 'cashierName', label: t('pendingPayments.createdBy', 'Created By'), render: (v) => v || '—' },
            { key: 'paidAt', label: t('pendingPayments.paymentDate', 'Payment Date'), render: (v) => (v ? date(v) : '—') },
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
