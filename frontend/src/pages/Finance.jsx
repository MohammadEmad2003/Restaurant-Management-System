import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ResponsiveContainer, BarChart, Bar, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid, Legend } from 'recharts';
import { DollarSign, TrendingDown, Wallet, Percent } from 'lucide-react';
import { useFetch } from '../hooks/useApi.js';
import { Card, PageHeader, Spinner, Stat } from '../components/ui.jsx';
import { money } from '../utils/format.js';

export default function Finance() {
  const { t } = useTranslation();
  const [period, setPeriod] = useState('daily');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const rangeQ = `${from ? `&from=${from}` : ''}${to ? `&to=${to}` : ''}`;
  const { data: income, loading } = useFetch(`/finance/income?period=${period}${rangeQ}`, [period, from, to]);
  const { data: expenses } = useFetch(`/finance/expenses?period=${period}${rangeQ}`, [period, from, to]);
  const { data: profit } = useFetch(`/finance/profit?period=${period}${rangeQ}`, [period, from, to]);
  const { data: cashflow } = useFetch(`/finance/cashflow?period=${period}${rangeQ}`, [period, from, to]);
  const { data: locations } = useFetch(`/analytics/locations?${rangeQ.slice(1)}`, [from, to]);

  if (loading || !income) return <Spinner />;

  const expByType = Object.entries(expenses?.byType || {}).map(([name, value]) => ({ name, value }));

  return (
    <div className="fade-in">
      <PageHeader title={t('nav.finance')} subtitle={t('finance.subtitle', 'Income, expenses, profit & cash flow')}>
        <div className="chip-row">
          {['daily', 'weekly', 'monthly', 'annual'].map((p) => (
            <button key={p} className={`btn btn--sm ${period === p ? 'btn--primary' : ''}`} onClick={() => setPeriod(p)}>{t(`finance.${p}`, p)}</button>
          ))}
        </div>
        <div className="row" style={{ gap: 6, alignItems: 'center' }}>
          <input className="input ltr" type="date" value={from} onChange={(e) => setFrom(e.target.value)} title={t('reports.from', 'From')} style={{ padding: '6px 8px' }} />
          <span className="muted">→</span>
          <input className="input ltr" type="date" value={to} onChange={(e) => setTo(e.target.value)} title={t('reports.to', 'To')} style={{ padding: '6px 8px' }} />
          {(from || to) && <button className="btn btn--sm" onClick={() => { setFrom(''); setTo(''); }}>{t('reports.clear', 'Clear')}</button>}
        </div>
      </PageHeader>

      <div className="grid grid--stats" style={{ marginBottom: 18 }}>
        <Stat label="Revenue (30d)" value={money(profit?.revenue || 0)} icon={DollarSign} color="linear-gradient(135deg,#10b981,#34d399)" />
        <Stat label="Expenses (30d)" value={money(profit?.expenses || 0)} icon={TrendingDown} color="linear-gradient(135deg,#ef4444,#f87171)" />
        <Stat label={t('dashboard.netProfit')} value={money(profit?.netProfit || 0)} icon={Wallet} color="linear-gradient(135deg,#7c3aed,#a855f7)" />
        <Stat label={t('dashboard.profitMargin')} value={`${profit?.profitMargin || 0}%`} icon={Percent} color="linear-gradient(135deg,#f59e0b,#fbbf24)" />
      </div>

      <div className="grid grid--2" style={{ marginBottom: 18 }}>
        <Card title={`Cash Flow (${period})`}>
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={cashflow?.series || []} margin={{ left: -14 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
              <XAxis dataKey="key" tick={{ fontSize: 10.5, fill: 'var(--muted)' }} />
              <YAxis tick={{ fontSize: 11, fill: 'var(--muted)' }} />
              <Tooltip formatter={(v) => money(v)} contentStyle={{ borderRadius: 12, border: '1px solid var(--border)' }} />
              <Legend />
              <Bar dataKey="inflow" name="Income" fill="#10b981" radius={[6, 6, 0, 0]} />
              <Bar dataKey="outflow" name="Expenses" fill="#ef4444" radius={[6, 6, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </Card>

        <Card title={`Income Trend (${period})`}>
          <ResponsiveContainer width="100%" height={280}>
            <LineChart data={income.series} margin={{ left: -14 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
              <XAxis dataKey="key" tick={{ fontSize: 10.5, fill: 'var(--muted)' }} />
              <YAxis tick={{ fontSize: 11, fill: 'var(--muted)' }} />
              <Tooltip formatter={(v) => money(v)} contentStyle={{ borderRadius: 12, border: '1px solid var(--border)' }} />
              <Line type="monotone" dataKey="value" name="Income" stroke="#7c3aed" strokeWidth={2.6} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </Card>
      </div>

      <Card title={t('finance.byLocation', 'Profit & Orders by Location')} style={{ marginBottom: 18 }}>
        <ResponsiveContainer width="100%" height={280}>
          <BarChart data={locations || []} margin={{ left: -14 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
            <XAxis dataKey="name" tick={{ fontSize: 10.5, fill: 'var(--muted)' }} tickFormatter={undefined} />
            <YAxis yAxisId="l" tick={{ fontSize: 11, fill: 'var(--muted)' }} />
            <YAxis yAxisId="r" orientation="right" tick={{ fontSize: 11, fill: 'var(--muted)' }} />
            <Tooltip contentStyle={{ borderRadius: 12, border: '1px solid var(--border)' }} />
            <Legend />
            <Bar yAxisId="l" dataKey="revenue" name="Revenue" fill="#10b981" radius={[6, 6, 0, 0]} />
            <Bar yAxisId="l" dataKey="profit" name="Profit" fill="#7c3aed" radius={[6, 6, 0, 0]} />
            <Bar yAxisId="r" dataKey="orders" name="Orders" fill="#06b6d4" radius={[6, 6, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </Card>

      <Card title={t('finance.expenseBreakdown', 'Expense Breakdown')}>
        <div className="grid grid--3">
          {expByType.map((e) => (
            <div key={e.name} className="card" style={{ padding: 16 }}>
              <div className="muted" style={{ fontSize: 12.5, textTransform: 'capitalize' }}>{e.name}</div>
              <div style={{ fontWeight: 800, fontSize: 20, marginTop: 4 }}>{money(e.value)}</div>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
