import { useState, useCallback, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus, Search, Phone, MapPin, Star, History, Filter, X } from 'lucide-react';
import { api } from '../api/client.js';
import { useFetch } from '../hooks/useApi.js';
import { usePaginated } from '../hooks/usePaginated.js';
import { useUI } from '../store/ui.js';
import { Card, PageHeader, Spinner, Badge, Modal, Avatar, DataTable, LocationSelect, Dropdown, Phone as PhoneField } from '../components/ui.jsx';
import { money, shortName, date } from '../utils/format.js';

export default function Clients() {
  const { t } = useTranslation();
  const lang = useUI((s) => s.lang);
  const notify = useUI((s) => s.notify);
  const { data: locTree } = useFetch('/locations/tree', []);
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [detail, setDetail] = useState(null);
  const [history, setHistory] = useState(null);
  const [form, setForm] = useState({ name: '', phone: '', address: '', governorate: '', area: '', notes: '' });
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState({ governorate: '', minVisits: '', maxVisits: '', minSpent: '', maxSpent: '', sortBy: '' });

  const fetchClients = useCallback(async () => {
    setLoading(true);
    try {
      const params = {};
      if (filter.governorate) params.governorate = filter.governorate;
      if (filter.minVisits) params.minVisits = filter.minVisits;
      if (filter.maxVisits) params.maxVisits = filter.maxVisits;
      if (filter.minSpent) params.minSpent = filter.minSpent;
      if (filter.maxSpent) params.maxSpent = filter.maxSpent;
      if (filter.sortBy) params.sortBy = filter.sortBy;
      const hasFilter = Object.keys(params).length > 0;
      const { data: rows } = await api.get(hasFilter ? '/clients/filter' : '/clients', { params });
      setData(rows || []);
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, [filter]);

  useEffect(() => { fetchClients(); }, [fetchClients]);

  const filtered = (data || []).filter((c) =>
    shortName(c.name, lang).toLowerCase().includes(q.toLowerCase()) ||
    (c.phoneNumbers || []).some((p) => p.includes(q)));

  const { page, pageSize, totalPages, totalItems, setPage, setPageSize, paginatedData: paginatedClients } = usePaginated(filtered, 10);

  const governorates = [...new Set(data.map((c) => c.governorate).filter(Boolean))];

  const applyFilter = () => fetchClients();
  const clearFilter = () => { setFilter({ governorate: '', minVisits: '', maxVisits: '', minSpent: '', maxSpent: '', sortBy: '' }); };

  const save = async () => {
    try {
      await api.post('/clients', {
        name: form.name,
        phoneNumbers: form.phone ? [form.phone] : [],
        addresses: form.address ? [form.address] : [],
        governorate: form.governorate || '',
        area: form.area || '',
        notes: form.notes,
      });
      notify(t('clients.added', 'Customer added'));
      setOpen(false); setForm({ name: '', phone: '', address: '', governorate: '', area: '', notes: '' });
      fetchClients();
    } catch (e) { notify(e.response?.data?.error || 'Failed', 'error'); }
  };

  const viewHistory = async (c) => {
    setDetail(c); setHistory(null);
    const { data } = await api.get(`/clients/${c.id}/history`);
    setHistory(data);
  };

  if (loading) return <Spinner />;

  return (
    <div className="fade-in">
      <PageHeader title={t('nav.clients')} subtitle={`${data.length} ${t('clients.customers', 'customers')}`}>
        <div className="search"><Search size={15} color="var(--muted)" /><input placeholder={`${t('common.search')} ${t('common.name')}/${t('common.phone')}`} value={q} onChange={(e) => setQ(e.target.value)} /></div>
        <button className="btn btn--primary" onClick={() => setOpen(true)}><Plus size={16} /> {t('common.add')}</button>
      </PageHeader>

      {/* Filter row */}
      <div className="card" style={{ padding: 14, marginBottom: 16 }}>
        <div className="row wrap" style={{ gap: 10, alignItems: 'flex-end' }}>
          <div className="field" style={{ flex: 1, minWidth: 140, marginBottom: 0 }}>
            <label>{t('clients.filterByGovernorate')}</label>
            <Dropdown value={filter.governorate} onChange={(v) => setFilter({ ...filter, governorate: v })}
              placeholder={t('common.all', 'All')}
              options={[{ value: '', label: t('common.all', 'All') }, ...governorates.map((g) => ({ value: g, label: g }))]} />
          </div>
          <div className="field" style={{ flex: 1, minWidth: 100, marginBottom: 0 }}>
            <label>{t('clients.minVisits')}</label>
            <input type="number" className="input" min={0} value={filter.minVisits} onChange={(e) => setFilter({ ...filter, minVisits: e.target.value })} />
          </div>
          <div className="field" style={{ flex: 1, minWidth: 100, marginBottom: 0 }}>
            <label>{t('clients.maxVisits')}</label>
            <input type="number" className="input" min={0} value={filter.maxVisits} onChange={(e) => setFilter({ ...filter, maxVisits: e.target.value })} />
          </div>
          <div className="field" style={{ flex: 1, minWidth: 100, marginBottom: 0 }}>
            <label>{t('clients.minSpent')}</label>
            <input type="number" className="input" min={0} value={filter.minSpent} onChange={(e) => setFilter({ ...filter, minSpent: e.target.value })} />
          </div>
          <div className="field" style={{ flex: 1, minWidth: 100, marginBottom: 0 }}>
            <label>{t('clients.maxSpent')}</label>
            <input type="number" className="input" min={0} value={filter.maxSpent} onChange={(e) => setFilter({ ...filter, maxSpent: e.target.value })} />
          </div>
          <div className="field" style={{ flex: 1, minWidth: 120, marginBottom: 0 }}>
            <label>{t('clients.sortBy')}</label>
            <Dropdown value={filter.sortBy} onChange={(v) => setFilter({ ...filter, sortBy: v })}
              placeholder="—"
              options={[
                { value: '', label: '—' },
                { value: 'name', label: t('clients.byName') },
                { value: 'totalSpent', label: t('clients.bySpent') },
                { value: 'visitCount', label: t('clients.byVisits') },
              ]} />
          </div>
          <button className="btn btn--primary" onClick={applyFilter}><Filter size={15} /> {t('clients.applyFilters', 'Apply')}</button>
          <button className="btn" onClick={clearFilter}><X size={15} /></button>
        </div>
      </div>

      <Card>
        <DataTable
          onRowClick={viewHistory}
          columns={[
            { key: 'name', label: t('common.name'), render: (v, r) => (
              <div className="row" style={{ gap: 10 }}><Avatar name={v} size={34} />
                <span style={{ fontWeight: 600 }}>{shortName(v, lang)}</span></div>) },
            { key: 'phone', label: t('common.phone'), render: (_, r) => <PhoneField>{r.phoneNumbers?.[0]}</PhoneField> },
            { key: 'location', label: t('clients.location', 'Location'), render: (_, r) => [r.area, r.governorate].filter(Boolean).join(' · ') || '—' },
            { key: 'visitCount', label: t('clients.visits', 'Visits'), align: 'end' },
            { key: 'totalSpent', label: t('clients.totalSpent'), align: 'end', render: (v) => money(v) },
            { key: 'loyaltyPoints', label: t('clients.loyaltyPoints'), align: 'end', render: (v) => <Badge kind="brand"><Star size={12} /> {v}</Badge> },
          ]}
          rows={paginatedClients}
          empty={t('clients.empty', 'No customers yet.')}
          pagination={{ currentPage: page, totalPages, onPageChange: setPage, pageSize, totalItems, onPageSizeChange: setPageSize }}
        />
      </Card>

      {/* Add modal */}
      <Modal open={open} onClose={() => setOpen(false)} title={t('clients.new', 'New Customer')}
        footer={<><button className="btn" onClick={() => setOpen(false)}>{t('common.cancel')}</button><button className="btn btn--primary" onClick={save}>{t('common.save')}</button></>}>
        <div className="field"><label>{t('common.name')}</label><input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
        <div className="field"><label>{t('common.phone')}</label><input className="input ltr" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="+20 100 000 0000" /></div>
        <div style={{ marginBottom: 14 }}>
          <LocationSelect tree={locTree || {}} governorate={form.governorate} area={form.area}
            onChange={({ governorate, area }) => setForm({ ...form, governorate, area })} />
        </div>
        <div className="field">
          <label>{t('clients.deliveryAddress', 'Delivery Address')}</label>
          {/* Multi-line textarea for detailed delivery addresses (landmarks, floor, apartment) */}
          <textarea className="textarea" rows={3} value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} placeholder={t('clients.addressPlaceholder', 'Street, building, floor, apartment, landmarks…')} />
        </div>
        <div className="field"><label>{t('clients.notes', 'Notes')}</label><textarea className="textarea" rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></div>
      </Modal>

      {/* Detail + history */}
      <Modal open={!!detail} onClose={() => setDetail(null)} wide title={<span className="row" style={{ gap: 10 }}><Avatar name={detail?.name} size={34} /> {shortName(detail?.name || '', lang)}</span>}>
        {detail && (
          <>
            <div className="grid grid--3" style={{ marginBottom: 16 }}>
              <div className="card" style={{ padding: 14 }}><div className="muted" style={{ fontSize: 12 }}>{t('clients.totalSpent')}</div><div style={{ fontWeight: 800, fontSize: 18 }}>{money(detail.totalSpent)}</div></div>
              <div className="card" style={{ padding: 14 }}><div className="muted" style={{ fontSize: 12 }}>{t('clients.visits', 'Visits')}</div><div style={{ fontWeight: 800, fontSize: 18 }}>{detail.visitCount}</div></div>
              <div className="card" style={{ padding: 14 }}><div className="muted" style={{ fontSize: 12 }}>{t('clients.loyaltyPoints')}</div><div style={{ fontWeight: 800, fontSize: 18, color: 'var(--brand-700)' }}>{detail.loyaltyPoints}</div></div>
            </div>
            <div className="row wrap" style={{ gap: 8, marginBottom: 8 }}>
              {(detail.phoneNumbers || []).map((p) => <Badge key={p}><Phone size={12} /> <span className="ltr">{p}</span></Badge>)}
            </div>
            <div className="row wrap" style={{ gap: 8, marginBottom: 16 }}>
              {(detail.addresses || []).map((a, i) => <Badge key={i}><MapPin size={12} /> {a}</Badge>)}
            </div>
            <div className="card__title row" style={{ gap: 8, marginBottom: 8 }}><History size={16} /> {t('clients.orderHistory')}</div>
            {!history ? <Spinner /> : (
              <DataTable
                columns={[
                  { key: 'invoiceNo', label: t('orders.invoice') },
                  { key: 'orderDate', label: t('common.date'), render: (v) => date(v) },
                  { key: 'products', label: t('common.items', 'Items'), render: (v) => `${v.length}` },
                  { key: 'status', label: t('common.status'), render: (v) => t(`status.${v}`, v) },
                  { key: 'totalPrice', label: t('common.total'), align: 'end', render: (v) => money(v) },
                ]}
                rows={history.orders}
                empty={t('clients.noOrdersYet')}
              />
            )}
          </>
        )}
      </Modal>
    </div>
  );
}
