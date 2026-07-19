import { useState, useCallback, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { ClipboardCheck, AlertTriangle, Plus, Filter } from 'lucide-react';
import { useFetch } from '../hooks/useApi.js';
import { usePaginated } from '../hooks/usePaginated.js';
import { api } from '../api/client.js';
import { useUI } from '../store/ui.js';
import { Card, PageHeader, Spinner, DataTable, Badge, Modal, Stat, DateField } from '../components/ui.jsx';
import { money, num, date, shortName } from '../utils/format.js';

export default function GoodsCheck() {
  const { t } = useTranslation();
  const lang = useUI((s) => s.lang);
  const notify = useUI((s) => s.notify);
  const { data: checks, loading, refetch } = useFetch('/goods-checks', [], []);
  const { data: goods } = useFetch('/goods', []);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ goodId: '', actualQuantity: '', reason: 'Spoilage' });

  const [reasonFilter, setReasonFilter] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  const fetchWaste = useCallback(async () => {
    const params = {};
    if (reasonFilter) params.reason = reasonFilter;
    if (dateFrom) params.from = dateFrom;
    if (dateTo) params.to = dateTo;
    try {
      const { data } = await api.get('/goods-checks/reports/waste', { params });
      setWaste(data);
    } catch { /* ignore */ }
  }, [reasonFilter, dateFrom, dateTo]);

  const [waste, setWaste] = useState(null);

  const submit = async () => {
    try {
      await api.post('/goods-checks', { ...form, actualQuantity: Number(form.actualQuantity), date: new Date().toISOString().slice(0, 10) });
      notify(t('goodsCheck.checkRecorded', 'Check recorded & stock adjusted'));
      setOpen(false); setForm({ goodId: '', actualQuantity: '', reason: 'Spoilage' });
      refetch(); fetchWaste();
    } catch (e) { notify(e.response?.data?.error || 'Failed', 'error'); }
  };

  useEffect(() => { fetchWaste(); }, [fetchWaste]);

  const recentChecks = (checks || []).slice().sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  const { page, pageSize, totalPages, totalItems, setPage, setPageSize, paginatedData: paginatedChecks } = usePaginated(recentChecks, 10);

  if (loading) return <Spinner />;
  const goodName = (id) => shortName(goods?.find((g) => g.id === id)?.name || id, lang);

  return (
    <div className="fade-in">
      <PageHeader title={t('nav.goodsCheck')} subtitle={t('goodsCheck.subtitle', 'Physical counts, waste & loss detection')}>
        <button className="btn btn--primary" onClick={() => setOpen(true)}><Plus size={16} /> {t('goodsCheck.newCount', 'New Count')}</button>
      </PageHeader>

      <div className="grid grid--stats" style={{ marginBottom: 18 }}>
        <Stat label={t('dashboard.wasteValue')} value={money(waste?.totalLossValue || 0)} icon={AlertTriangle} color="linear-gradient(135deg,#ef4444,#f87171)" />
        <Stat label={t('goodsCheck.mostWasted', 'Most Wasted')} value={shortName(waste?.mostWasted || '—', lang)} icon={ClipboardCheck} color="linear-gradient(135deg,#f59e0b,#fbbf24)" />
        <Stat label={t('goodsCheck.checksDone', 'Checks Done')} value={num(checks.length)} icon={ClipboardCheck} />
      </div>

      <div className="grid grid--2">
        <Card title={t('goodsCheck.wasteByIngredient', 'Waste by Ingredient')}>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12, alignItems: 'end' }}>
            <div className="field" style={{ flex: 1, minWidth: 140 }}>
              <label>{t('goodsCheck.filterByReason', 'Filter by Reason')}</label>
              <select className="select" value={reasonFilter} onChange={(e) => setReasonFilter(e.target.value)}>
                <option value="">{t('common.all', 'All Reasons')}</option>
                {Object.entries(t('goodsCheck.reasons')).map(([key, val]) => <option key={key}>{val}</option>)}
              </select>
            </div>
            <div className="field" style={{ flex: 1, minWidth: 130 }}>
              <label>{t('goodsCheck.dateFrom', 'From Date')}</label>
              <DateField value={dateFrom} onChange={setDateFrom} />
            </div>
            <div className="field" style={{ flex: 1, minWidth: 130 }}>
              <label>{t('goodsCheck.dateTo', 'To Date')}</label>
              <DateField value={dateTo} onChange={setDateTo} />
            </div>
          </div>
          <DataTable
            columns={[
              { key: 'name', label: t('goodsCheck.ingredient', 'Ingredient'), render: (v) => shortName(v, lang) },
              { key: 'totalLoss', label: t('goodsCheck.qtyLost', 'Qty Lost'), align: 'end', render: (v) => num(v.toFixed(1)) },
              { key: 'lossValue', label: t('goodsCheck.value', 'Value'), align: 'end', render: (v) => <span style={{ color: 'var(--danger)', fontWeight: 700 }}>{money(v)}</span> },
            ]}
            rows={waste?.items || []}
          />
        </Card>
        <Card title={t('goodsCheck.recentChecks', 'Recent Checks')}>
          <DataTable
            columns={[
              { key: 'auditId', label: t('goodsCheck.auditId', 'Audit ID'), render: (v) => <code style={{ fontSize: 12 }}>{v || '-'}</code> },
              { key: 'date', label: t('common.date'), render: (v) => v },
              { key: 'goodId', label: t('goodsCheck.item', 'Item'), render: (v) => goodName(v) },
              { key: 'difference', label: t('goodsCheck.diff', 'Diff'), align: 'end', render: (v) => <Badge kind={v > 0 ? 'danger' : 'success'}>{v > 0 ? '-' : '+'}{Math.abs(v).toFixed(1)}</Badge> },
              { key: 'reason', label: t('goodsCheck.reason', 'Reason'), render: (v) => <span className="muted">{v}</span> },
            ]}
            rows={paginatedChecks}
            pagination={{ currentPage: page, totalPages, onPageChange: setPage, pageSize, totalItems, onPageSizeChange: setPageSize }}
          />
        </Card>
      </div>

      <Modal open={open} onClose={() => setOpen(false)} title={t('goodsCheck.physicalInventoryCount', 'Physical Inventory Count')}
        footer={<><button className="btn" onClick={() => setOpen(false)}>{t('common.cancel')}</button><button className="btn btn--primary" onClick={submit}>{t('common.save')}</button></>}>
        <div className="field"><label>{t('goodsCheck.item', 'Item')}</label>
          <select className="select" value={form.goodId} onChange={(e) => setForm({ ...form, goodId: e.target.value })}>
            <option value="">{t('common.selectCategory', 'Select…')}</option>
            {(goods || []).map((g) => <option key={g.id} value={g.id}>{shortName(g.name, lang)} (system: {num(g.quantityAvailable)} {g.unit})</option>)}
          </select>
        </div>
        <div className="field"><label>{t('goodsCheck.actualCountedQuantity', 'Actual Counted Quantity')}</label><input className="input" type="number" value={form.actualQuantity} onChange={(e) => setForm({ ...form, actualQuantity: e.target.value })} /></div>
        <div className="field"><label>{t('goodsCheck.reasonForDifference', 'Reason for difference')}</label>
          <select className="select" value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })}>
            {Object.entries(t('goodsCheck.reasons')).map(([key, val]) => <option key={key}>{val}</option>)}
          </select>
        </div>
      </Modal>
    </div>
  );
}
