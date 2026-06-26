import { useEffect } from 'react';
import { X, Inbox } from 'lucide-react';
import { useTranslation } from 'react-i18next';

export function Card({ title, sub, actions, children, className = '', hover = false }) {
  return (
    <div className={`card ${hover ? 'card--hover' : ''} ${className}`}>
      {(title || actions) && (
        <div className="card__head">
          <div>
            {title && <div className="card__title">{title}</div>}
            {sub && <div className="card__sub">{sub}</div>}
          </div>
          {actions}
        </div>
      )}
      <div className="card__body">{children}</div>
    </div>
  );
}

export function Stat({ label, value, icon: Icon, color = 'var(--brand-grad)', delta, deltaDir }) {
  return (
    <div className="stat fade-in">
      <div className="stat__icon" style={{ background: color }}>{Icon && <Icon size={22} />}</div>
      <div className="stat__label">{label}</div>
      <div className="stat__value">{value}</div>
      {delta != null && (
        <div className={`stat__delta stat__delta--${deltaDir || 'up'}`}>
          {deltaDir === 'down' ? '▼' : '▲'} {delta}
        </div>
      )}
    </div>
  );
}

export function Badge({ children, kind = '' }) {
  return <span className={`badge ${kind ? `badge--${kind}` : ''}`}>{children}</span>;
}

const STATUS_KIND = {
  completed: 'success', paid: 'success', ready: 'success', active: 'success', seated: 'success', booked: 'info',
  pending: 'warning', preparing: 'warning', waitlist: 'warning', new: 'info', unpaid: 'warning',
  cancelled: 'danger', no_show: 'danger', inactive: 'danger',
};
export function StatusBadge({ status }) {
  const { t } = useTranslation();
  const key = String(status || '').toLowerCase();
  return <Badge kind={STATUS_KIND[key] || ''}><span className="dot" />{t(`status.${key}`, status)}</Badge>;
}

export function PageHeader({ title, subtitle, children }) {
  return (
    <div className="page-head">
      <div>
        <h1>{title}</h1>
        {subtitle && <p>{subtitle}</p>}
      </div>
      <div className="row wrap">{children}</div>
    </div>
  );
}

export function Spinner({ label }) {
  const { t } = useTranslation();
  return (
    <div style={{ padding: 40, textAlign: 'center', color: 'var(--muted)' }}>
      <div className="skeleton" style={{ height: 8, width: 120, margin: '0 auto 16px', borderRadius: 99 }} />
      {label || t('common.loading')}
    </div>
  );
}

export function Empty({ label }) {
  const { t } = useTranslation();
  return (
    <div className="empty">
      <Inbox size={40} />
      <div>{label || t('common.noData')}</div>
    </div>
  );
}

export function DataTable({ columns, rows, empty }) {
  if (!rows || rows.length === 0) return <Empty label={empty} />;
  return (
    <div className="table-wrap">
      <table className="tbl">
        <thead>
          <tr>{columns.map((c) => <th key={c.key} style={{ textAlign: c.align === 'end' ? 'end' : 'start' }}>{c.label}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={row.id || i}>
              {columns.map((c) => (
                <td key={c.key} className={c.align === 'end' ? 'num' : ''}>
                  {c.render ? c.render(row[c.key], row) : row[c.key]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Modal({ open, onClose, title, children, footer, wide }) {
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose?.();
    if (open) window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="modal-overlay" onMouseDown={onClose}>
      <div className={`modal ${wide ? 'modal--wide' : ''}`} onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal__head">
          <h3>{title}</h3>
          <button className="btn btn--icon btn--ghost" onClick={onClose}><X size={18} /></button>
        </div>
        <div className="modal__body">{children}</div>
        {footer && <div className="modal__foot">{footer}</div>}
      </div>
    </div>
  );
}

export function Avatar({ name, size = 38 }) {
  const init = (name || '?').replace(/—.*/, '').trim().split(/\s+/).slice(0, 2).map((s) => s[0]).join('').toUpperCase();
  return (
    <div style={{
      width: size, height: size, borderRadius: '50%', flexShrink: 0,
      background: 'var(--brand-grad)', color: '#fff', display: 'grid', placeItems: 'center',
      fontWeight: 700, fontSize: size * 0.36,
    }}>{init}</div>
  );
}
