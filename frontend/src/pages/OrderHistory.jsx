import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { MessageSquareWarning, Printer } from 'lucide-react';
import { useFetch } from '../hooks/useApi.js';
import { usePaginated } from '../hooks/usePaginated.js';
import { useUI } from '../store/ui.js';
import { openReport } from '../api/client.js';
import { Card, PageHeader, Spinner, Badge, DataTable, DateField } from '../components/ui.jsx';
import { money, date } from '../utils/format.js';

const STATUS_KIND = { completed: 'success', pending: 'warning', preparing: 'info', cancelled: 'danger' };

/**
 * Full, searchable order history — every order the restaurant has ever
 * placed, not just the last handful shown on the Dashboard. Available to
 * Cashier and Admin alike (no time/shift-based restriction on which orders a
 * Cashier can see); the only per-row action is filing a complaint, since
 * deleting an order is not a supported operation anywhere in this app.
 */
export default function OrderHistory() {
  const { t } = useTranslation();
  const lang = useUI((s) => s.lang);
  const navigate = useNavigate();
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [q, setQ] = useState('');

  const qs = new URLSearchParams({
    ...(dateFrom ? { dateFrom } : {}),
    ...(dateTo ? { dateTo } : {}),
    ...(q ? { q } : {}),
  }).toString();
  const url = `/orders${qs ? `?${qs}` : ''}`;
  const { data: orders, loading } = useFetch(url, [url]);

  const { page, pageSize, totalPages, totalItems, setPage, setPageSize, paginatedData } = usePaginated(orders ?? [], 15);

  const printInvoice = (o) => {
    const ar = lang === 'ar';
    openReport(`/orders/${o.id}/invoice.pdf${ar ? '?lang=ar' : ''}`);
  };

  const fileComplaint = (o) => {
    navigate('/complaints', {
      state: {
        prefillComplaint: {
          orderId: o.id,
          orderNumber: o.orderNumber || o.invoiceNo || '',
          clientId: o.clientId || null,
          clientName: o.clientName || '',
          phone: o.clientPhone || '',
        },
      },
    });
  };

  return (
    <div className="fade-in">
      <PageHeader title={t('orderHistory.title', 'Order History')} subtitle={t('orderHistory.subtitle', 'Every order this restaurant has placed — search and filter by date')} />

      <div className="card" style={{ padding: 14, marginBottom: 16 }}>
        <div className="row wrap" style={{ gap: 10, alignItems: 'flex-end' }}>
          <div style={{ flex: '0 0 auto', minWidth: 160 }}>
            <DateField label={t('reports.from', 'From')} value={dateFrom} onChange={setDateFrom} />
          </div>
          <div style={{ flex: '0 0 auto', minWidth: 160 }}>
            <DateField label={t('reports.to', 'To')} value={dateTo} onChange={setDateTo} />
          </div>
          <div className="field" style={{ flex: 1, minWidth: 200, marginBottom: 0 }}>
            <label>{t('common.search')}</label>
            <input className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('orderHistory.searchPlaceholder', 'Order number, invoice, customer name…')} />
          </div>
          {(dateFrom || dateTo || q) && (
            <button className="btn btn--sm" onClick={() => { setDateFrom(''); setDateTo(''); setQ(''); }}>
              {t('common.clear', 'Clear')}
            </button>
          )}
        </div>
      </div>

      <Card>
        {loading || !orders ? <Spinner /> : (
          <DataTable
            columns={[
              { key: 'orderNumber', label: t('orderHistory.orderNumber', 'Order #'), render: (v, r) => <span className="ltr" style={{ fontWeight: 700 }}>{v || r.invoiceNo || '—'}</span> },
              { key: 'orderDate', label: t('common.date'), render: (v) => date(v) },
              { key: 'clientName', label: t('common.name') },
              { key: 'cashierName', label: t('orderHistory.cashier', 'Cashier') },
              { key: 'totalPrice', label: t('common.total'), align: 'end', render: (v) => money(v) },
              { key: 'status', label: t('common.status'), render: (v) => <Badge kind={STATUS_KIND[v]}>{t(`status.${v}`, v)}</Badge> },
              {
                key: 'paymentStatus', label: t('pendingPayments.paymentStatus', 'Payment'), render: (v, r) => (
                  !r.paymentTiming ? <span className="muted">—</span>
                    : v === 'paid' ? <Badge kind="success">{t('common.paid', 'Paid')}</Badge> : <Badge kind="warning">{t('common.pending', 'Pending')}</Badge>
                ),
              },
              {
                key: '_act', label: t('common.actions'), render: (_, r) => (
                  <div className="row" style={{ gap: 6 }}>
                    <button className="btn btn--icon btn--sm" title={t('pendingPayments.printInvoice', 'Print Invoice')} onClick={() => printInvoice(r)}><Printer size={13} /></button>
                    <button className="btn btn--sm" onClick={() => fileComplaint(r)}>
                      <MessageSquareWarning size={13} /> {t('orderHistory.fileComplaint', 'File Complaint')}
                    </button>
                  </div>
                ),
              },
            ]}
            rows={paginatedData}
            empty={t('orderHistory.empty', 'No orders found.')}
            pagination={{ currentPage: page, totalPages, onPageChange: setPage, pageSize, totalItems, onPageSizeChange: setPageSize }}
          />
        )}
      </Card>
    </div>
  );
}
