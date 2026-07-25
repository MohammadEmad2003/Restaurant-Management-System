import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Wallet, LockOpen, Lock, RefreshCw, CheckCircle2, ArrowRightLeft } from 'lucide-react';
import { useFetch } from '../hooks/useApi.js';
import { api } from '../api/client.js';
import { useUI } from '../store/ui.js';
import { useAuth } from '../store/auth.js';
import { Card, PageHeader, Spinner, Dropdown, DataTable, Badge } from '../components/ui.jsx';
import { money, shortName, datetime } from '../utils/format.js';

export default function CashierShift() {
  const { t } = useTranslation();
  const lang = useUI((s) => s.lang);
  const notify = useUI((s) => s.notify);
  const user = useAuth((s) => s.user);
  const { data: shift, loading, refetch } = useFetch('/cashier-shifts/current');
  const { data: cashiers } = useFetch('/workers/cashiers', []);
  const { data: history, refetch: refetchHistory } = useFetch('/cashier-shifts', []);

  const [openingFloat, setOpeningFloat] = useState('');
  const [countedCash, setCountedCash] = useState('');
  const [nextCashierId, setNextCashierId] = useState('');
  const [depositedToOwner, setDepositedToOwner] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);

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
    } catch (e) { notify(e.response?.data?.error || 'Failed', 'error'); }
    finally { setBusy(false); }
  };

  if (loading) return <Spinner />;

  const cashierOptions = (cashiers || []).filter((c) => c.id !== user?.id).map((c) => ({ value: c.id, label: shortName(c.name, lang) }));
  const expected = shift?.expectedCash || 0;
  const counted = countedCash === '' ? null : Number(countedCash);
  const diff = counted == null ? null : +(counted - expected).toFixed(2);

  // Difference banner: exact / over (positive) / short (negative).
  const diffView = () => {
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
          <button className="btn btn--primary" style={{ width: '100%', justifyContent: 'center' }} disabled={busy} onClick={openShift}>
            <LockOpen size={15} /> {t('cashierShift.openBtn', 'Open shift')}
          </button>
        </Card>
      ) : (
        <div className="grid grid--2" style={{ alignItems: 'start' }}>
          {/* Live status */}
          <Card title={<span className="row" style={{ gap: 8 }}><Wallet size={17} /> {t('cashierShift.currentTitle', 'Current shift')}</span>}
            actions={<button className="btn btn--sm" onClick={refetch}><RefreshCw size={13} /> {t('cashierShift.refresh', 'Refresh')}</button>}>
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
            {diffView()}

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
        <DataTable
          columns={[
            { key: 'openedAt', label: t('cashierShift.openedAt', 'Opened'), render: (v) => datetime(v) },
            { key: 'closedAt', label: t('cashierShift.closedAt', 'Closed'), render: (v) => v ? datetime(v) : <Badge kind="success">{t('cashierShift.open', 'Open')}</Badge> },
            { key: 'expectedCash', label: t('cashierShift.expected', 'Expected'), align: 'end', render: (v) => money(v) },
            { key: 'countedCash', label: t('cashierShift.counted', 'Counted'), align: 'end', render: (v, r) => r.status === 'closed' ? money(v) : '—' },
            { key: 'difference', label: t('cashierShift.difference', 'Difference'), align: 'end', render: (v, r) => r.status !== 'closed' ? '—' : (
              <Badge kind={v === 0 ? 'success' : v > 0 ? 'info' : 'danger'}>{v > 0 ? '+' : v < 0 ? '−' : ''}{money(Math.abs(v))}</Badge>
            ) },
            { key: 'nextCashierName', label: t('cashierShift.nextCashier', 'Next cashier'), render: (v, r) => v ? shortName(v, lang) : (r.depositedToOwner ? <Badge kind="brand">{t('cashierShift.toOwner', 'To owner')}</Badge> : '—') },
          ]}
          rows={history || []}
        />
      </Card>
    </div>
  );
}
