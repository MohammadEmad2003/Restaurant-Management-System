import { NavLink } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../store/auth.js';
import {
  LayoutDashboard, ShoppingCart, ChefHat, Pizza, Boxes, ClipboardCheck,
  Users, Gift, CalendarClock, UserCog, Clock, CalendarRange,
  Wallet, FileBarChart, Building2, ScrollText, Settings as Cog, RefreshCw, UtensilsCrossed,
} from 'lucide-react';

const SECTIONS = [
  {
    key: 'sectionMain',
    items: [
      { to: '/', icon: LayoutDashboard, label: 'dashboard', end: true },
      { to: '/orders', icon: ShoppingCart, label: 'orders' },
      { to: '/kitchen', icon: ChefHat, label: 'kitchen' },
    ],
  },
  {
    key: 'sectionBusiness',
    items: [
      { to: '/products', icon: Pizza, label: 'products', admin: true },
      { to: '/inventory', icon: Boxes, label: 'inventory' },
      { to: '/goods-check', icon: ClipboardCheck, label: 'goodsCheck', admin: true },
      { to: '/finance', icon: Wallet, label: 'finance', admin: true },
      { to: '/reports', icon: FileBarChart, label: 'reports', admin: true },
    ],
  },
  {
    key: 'sectionPeople',
    items: [
      { to: '/clients', icon: Users, label: 'clients' },
      { to: '/loyalty', icon: Gift, label: 'loyalty' },
      { to: '/reservations', icon: CalendarClock, label: 'reservations' },
      { to: '/workers', icon: UserCog, label: 'workers', admin: true },
      { to: '/attendance', icon: Clock, label: 'attendance', admin: true },
      { to: '/scheduling', icon: CalendarRange, label: 'scheduling', admin: true },
    ],
  },
  {
    key: 'sectionSystem',
    items: [
      { to: '/branches', icon: Building2, label: 'branches', admin: true },
      { to: '/audit', icon: ScrollText, label: 'audit', admin: true },
      { to: '/sync', icon: RefreshCw, label: 'sync' },
      { to: '/settings', icon: Cog, label: 'settings', admin: true },
    ],
  },
];

export default function Sidebar({ open }) {
  const { t } = useTranslation();
  const isAdmin = useAuth((s) => s.user?.role === 'admin');

  return (
    <aside style={{
      width: open ? 'var(--sidebar-w)' : 0, flexShrink: 0,
      background: 'var(--bg-elev)', borderInlineEnd: '1px solid var(--border)',
      height: '100vh', position: 'sticky', top: 0, overflow: 'hidden',
      transition: 'width var(--transition)',
    }}>
      <div style={{ width: 'var(--sidebar-w)', height: '100%', overflowY: 'auto', padding: '18px 14px' }}>
        <div className="row" style={{ padding: '6px 10px 18px', gap: 12 }}>
          <div style={{ width: 42, height: 42, borderRadius: 'var(--r-md)', background: 'var(--brand-grad)', display: 'grid', placeItems: 'center', boxShadow: 'var(--shadow-brand)' }}>
            <UtensilsCrossed size={22} color="#fff" />
          </div>
          <div>
            <div style={{ fontWeight: 800, fontSize: 15 }}>{t('app.name')}</div>
            <div style={{ fontSize: 11.5, color: 'var(--muted)' }}>{t('app.tagline')}</div>
          </div>
        </div>

        {SECTIONS.map((section) => {
          const items = section.items.filter((i) => !i.admin || isAdmin);
          if (!items.length) return null;
          return (
            <div key={section.key} style={{ marginBottom: 18 }}>
              <div style={{ padding: '0 12px 8px', fontSize: 10.5, fontWeight: 800, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--muted)' }}>
                {t(`nav.${section.key}`)}
              </div>
              {items.map((item) => (
                <NavLink key={item.to} to={item.to} end={item.end} className="navlink">
                  {({ isActive }) => (
                    <div className="navlink__inner" data-active={isActive}>
                      <item.icon size={18.5} />
                      <span>{t(`nav.${item.label}`)}</span>
                    </div>
                  )}
                </NavLink>
              ))}
            </div>
          );
        })}
      </div>
    </aside>
  );
}
