import { useEffect, useState } from 'react';
import { X, Inbox } from 'lucide-react';
import { useTranslation } from 'react-i18next';

export function Card({ title, sub, actions, children, className = '', hover = false, style }) {
  return (
    <div className={`card ${hover ? 'card--hover' : ''} ${className}`} style={style}>
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
    <div className="loader fade-in">
      <div className="loader__bar" />
      <div className="loader__ring" />
      <div className="loader__text">{label || t('common.loading')}</div>
    </div>
  );
}

/** Wrap phone numbers / codes so they render left-to-right even in Arabic (RTL). */
export function Phone({ children, className = '' }) {
  if (children == null || children === '') return <span className="muted">—</span>;
  return <span dir="ltr" className={`ltr ${className}`}>{children}</span>;
}

/**
 * Category picker: choose from existing categories or add a brand-new one.
 * `options` is the list of currently-used categories.
 */
export function CategorySelect({ value, onChange, options = [], placeholder }) {
  const { t } = useTranslation();
  const uniq = [...new Set((options || []).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  const [adding, setAdding] = useState(false);
  const showInput = adding || uniq.length === 0;

  if (showInput) {
    return (
      <div className="row" style={{ gap: 8 }}>
        <input
          className="input" value={value} autoFocus
          placeholder={placeholder || t('common.newCategory', 'New category')}
          onChange={(e) => onChange(e.target.value)}
        />
        {uniq.length > 0 && (
          <button type="button" className="btn btn--icon" title={t('common.cancel')}
            onClick={() => { setAdding(false); onChange(''); }}><X size={15} /></button>
        )}
      </div>
    );
  }

  return (
    <select
      className="select"
      value={uniq.includes(value) ? value : ''}
      onChange={(e) => {
        if (e.target.value === '__new__') { setAdding(true); onChange(''); }
        else onChange(e.target.value);
      }}
    >
      <option value="" disabled>{t('common.selectCategory', 'Select category…')}</option>
      {uniq.map((c) => <option key={c} value={c}>{c}</option>)}
      <option value="__new__">＋ {t('common.addCategory', 'Add new category…')}</option>
    </select>
  );
}

/**
 * Cascading location picker: choose a governorate, then an area within it.
 * `tree` is the { governorate: [areas] } map from /locations/tree.
 */
export function LocationSelect({ tree = {}, governorate, area, onChange }) {
  const { t } = useTranslation();
  const govs = Object.keys(tree).sort((a, b) => a.localeCompare(b));
  const areas = tree[governorate] || [];
  return (
    <div className="row" style={{ gap: 12 }}>
      <div className="field" style={{ flex: 1, marginBottom: 0 }}>
        <label>{t('locations.governorate', 'Governorate')}</label>
        <select className="select" value={governorate || ''} onChange={(e) => onChange({ governorate: e.target.value, area: '' })}>
          <option value="">{t('locations.selectGov', 'Select governorate…')}</option>
          {govs.map((g) => <option key={g} value={g}>{g}</option>)}
        </select>
      </div>
      <div className="field" style={{ flex: 1, marginBottom: 0 }}>
        <label>{t('locations.area', 'Area / Place')}</label>
        <select className="select" value={area || ''} onChange={(e) => onChange({ governorate, area: e.target.value })} disabled={!governorate}>
          <option value="">{t('locations.selectArea', 'Select area…')}</option>
          {areas.map((a) => <option key={a} value={a}>{a}</option>)}
        </select>
      </div>
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

export function Modal({ open, onClose, title, children, footer, wide, xl }) {
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose?.();
    if (open) window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="modal-overlay" onMouseDown={onClose}>
      <div className={`modal ${xl ? 'modal--xl' : wide ? 'modal--wide' : ''}`} onMouseDown={(e) => e.stopPropagation()}>
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
