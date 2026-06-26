import { useTranslation } from 'react-i18next';
import {
  ResponsiveContainer, AreaChart, Area, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, Tooltip, CartesianGrid,
} from 'recharts';
import {
  TrendingUp, DollarSign, ShoppingBag, Wallet, Boxes, AlertTriangle, Users, Percent,
} from 'lucide-react';
import { useFetch } from '../hooks/useApi.js';
import { useAuth } from '../store/auth.js';
import { Card, Stat, Spinner, DataTable, StatusBadge, Avatar } from '../components/ui.jsx';
import { money, num, shortName, date } from '../utils/format.js';
import { useUI } from '../store/ui.js';

const PIE_COLORS = ['#7c3aed', '#a855f7', '#ec4899', '#f59e0b', '#10b981', '#3b82f6', '#ef4444', '#06b6d4'];

function ChartTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="card" style={{ padding: '8px 12px', fontSize: 12.5 }}>
      <div style={{ fontWeight: 700, marginBottom: 2 }}>{label}</div>
      {payload.map((p) => <div key={p.name} style={{ color: p.color }}>{p.name}: {money(p.value)}</div>)}
    </div>
  );
}

export default function Dashboard() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const lang = useUI((s) => s.lang);
  const isAdmin = user?.role === 'admin';

  if (!isAdmin) return <CashierHome />;

  const { data, loading } = useFetch('/analytics/dashboard', []);
  const { data: orders } = useFetch('/orders', []);
  if (loading || !data) return <Spinner />;

  const { sales, finance, inventory, workers, customers } = data;
  const recent = (orders || []).slice().sort((a, b) => b.orderDate - a.orderDate).slice(0, 6);

  const categoryMix = Object.values((sales.bestSelling || []).reduce((acc, p) => {
    acc[p.name] = { name: shortName(p.name, lang), value: (acc[p.name]?.value || 0) + p.revenue };
    return acc;
  }, {}));

  return (
    <div className="fade-in">
      <div className="page-head">
        <div>
          <h1>{t('dashboard.title')}</h1>
          <p>{t('dashboard.subtitle')}</p>
        </div>
      </div>

      {/* KPI row */}
      <div className="grid grid--stats" style={{ marginBottom: 18 }}>
        <Stat label={t('dashboard.salesToday')} value={money(sales.daily)} icon={TrendingUp} color="linear-gradient(135deg,#7c3aed,#a855f7)" delta="live" />
        <Stat label={t('dashboard.salesMonth')} value={money(finance.revenue)} icon={DollarSign} color="linear-gradient(135deg,#10b981,#34d399)" />
        <Stat label={t('dashboard.netProfit')} value={money(finance.netProfit)} icon={Wallet} color="linear-gradient(135deg,#f59e0b,#fbbf24)" delta={`${finance.profitMargin}%`} />
        <Stat label={t('dashboard.orders')} value={num(sales.orderCount)} icon={ShoppingBag} color="linear-gradient(135deg,#3b82f6,#60a5fa)" />
        <Stat label={t('dashboard.inventoryValue')} value={money(inventory.inventoryValue)} icon={Boxes} color="linear-gradient(135deg,#06b6d4,#22d3ee)" />
        <Stat label={t('dashboard.lowStock')} value={num(inventory.lowStockCount)} icon={AlertTriangle} color="linear-gradient(135deg,#ef4444,#f87171)" deltaDir={inventory.lowStockCount > 0 ? 'down' : 'up'} delta={inventory.lowStockCount > 0 ? 'attention' : 'ok'} />
        <Stat label={t('dashboard.customers')} value={num(customers.totalCustomers)} icon={Users} color="linear-gradient(135deg,#8b5cf6,#c084fc)" delta={`${customers.retentionRate}%`} />
        <Stat label={t('dashboard.wasteValue')} value={money(inventory.wasteValue)} icon={Percent} color="linear-gradient(135deg,#64748b,#94a3b8)" />
      </div>

      {/* Charts */}
      <div className="grid grid--2" style={{ marginBottom: 18 }}>
        <Card title={t('dashboard.salesTrend')} sub={`${money(sales.monthly)} / 30d`} className="card--hover">
          <ResponsiveContainer width="100%" height={260}>
            <AreaChart data={sales.trend} margin={{ left: -16, right: 8, top: 8 }}>
              <defs>
                <linearGradient id="g1" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#7c3aed" stopOpacity={0.5} />
                  <stop offset="100%" stopColor="#7c3aed" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
              <XAxis dataKey="key" tick={{ fontSize: 11, fill: 'var(--muted)' }} tickFormatter={(v) => v.slice(5)} />
              <YAxis tick={{ fontSize: 11, fill: 'var(--muted)' }} />
              <Tooltip content={<ChartTooltip />} />
              <Area type="monotone" dataKey="value" name="Sales" stroke="#7c3aed" strokeWidth={2.5} fill="url(#g1)" />
            </AreaChart>
          </ResponsiveContainer>
        </Card>

        <Card title={t('dashboard.categoryMix')} className="card--hover">
          <ResponsiveContainer width="100%" height={260}>
            <PieChart>
              <Pie data={categoryMix} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={62} outerRadius={100} paddingAngle={3}>
                {categoryMix.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
              </Pie>
              <Tooltip content={<ChartTooltip />} />
            </PieChart>
          </ResponsiveContainer>
          <div className="chip-row" style={{ justifyContent: 'center', marginTop: 6 }}>
            {categoryMix.slice(0, 5).map((c, i) => (
              <span key={c.name} className="badge"><span className="dot" style={{ color: PIE_COLORS[i % PIE_COLORS.length] }} />{c.name}</span>
            ))}
          </div>
        </Card>
      </div>

      <div className="grid grid--2" style={{ marginBottom: 18 }}>
        <Card title={t('dashboard.bestSellers')} className="card--hover">
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={sales.bestSelling.map((p) => ({ ...p, label: shortName(p.name, lang) }))} margin={{ left: -16, right: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 10.5, fill: 'var(--muted)' }} interval={0} angle={-12} textAnchor="end" height={50} />
              <YAxis tick={{ fontSize: 11, fill: 'var(--muted)' }} />
              <Tooltip content={<ChartTooltip />} />
              <Bar dataKey="revenue" name="Revenue" radius={[8, 8, 0, 0]} fill="#a855f7" />
            </BarChart>
          </ResponsiveContainer>
        </Card>

        <Card title={t('dashboard.topCustomers')} className="card--hover">
          {customers.topCustomers.map((c) => (
            <div key={c.id} className="row between" style={{ padding: '9px 0', borderBottom: '1px solid var(--border)' }}>
              <div className="row" style={{ gap: 11 }}>
                <Avatar name={c.name} size={36} />
                <div>
                  <div style={{ fontWeight: 600, fontSize: 13.5 }}>{shortName(c.name, lang)}</div>
                  <div className="muted" style={{ fontSize: 12 }}>{c.visits} visits</div>
                </div>
              </div>
              <div style={{ fontWeight: 700 }}>{money(c.totalSpent)}</div>
            </div>
          ))}
        </Card>
      </div>

      <Card title={t('dashboard.recentOrders')} className="card--hover">
        <DataTable
          columns={[
            { key: 'invoiceNo', label: t('orders.invoice') },
            { key: 'clientName', label: t('orders.customer'), render: (v) => shortName(v, lang) },
            { key: 'orderDate', label: t('common.date'), render: (v) => date(v) },
            { key: 'products', label: t('common.quantity'), render: (v) => `${v.length} items` },
            { key: 'status', label: t('common.status'), render: (v) => <StatusBadge status={v} /> },
            { key: 'totalPrice', label: t('common.total'), align: 'end', render: (v) => money(v) },
          ]}
          rows={recent}
        />
      </Card>
    </div>
  );
}

/* Cashier sees a focused home: their activity + shortcuts. */
function CashierHome() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const lang = useUI((s) => s.lang);
  const { data: activity } = useFetch(`/workers/${user.sub}/activity`, []);
  const { data: orders } = useFetch('/orders', []);
  const mine = (orders || []).filter((o) => o.cashierId === user.sub).sort((a, b) => b.orderDate - a.orderDate).slice(0, 8);

  return (
    <div className="fade-in">
      <div className="page-head"><div><h1>{t('dashboard.title')}</h1><p>{t('dashboard.subtitle')}</p></div></div>
      <div className="grid grid--stats" style={{ marginBottom: 18 }}>
        <Stat label={t('dashboard.orders')} value={num(activity?.ordersCreated || 0)} icon={ShoppingBag} />
        <Stat label="Revenue Generated" value={money(activity?.revenueGenerated || 0)} icon={DollarSign} color="linear-gradient(135deg,#10b981,#34d399)" />
      </div>
      <Card title={t('orders.history')}>
        <DataTable
          columns={[
            { key: 'invoiceNo', label: t('orders.invoice') },
            { key: 'clientName', label: t('orders.customer'), render: (v) => shortName(v, lang) },
            { key: 'orderDate', label: t('common.date'), render: (v) => date(v) },
            { key: 'status', label: t('common.status'), render: (v) => <StatusBadge status={v} /> },
            { key: 'totalPrice', label: t('common.total'), align: 'end', render: (v) => money(v) },
          ]}
          rows={mine}
        />
      </Card>
    </div>
  );
}
