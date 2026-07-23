import { useEffect, useState, useMemo, useRef } from 'react';
import { X, Inbox, Calendar, ChevronLeft, ChevronRight, ChevronDown } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import Pagination from './Pagination.jsx';
import api from '../api/client.js';
import { useUI } from '../store/ui.js';

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
 * SupplierSelect — dropdown with inline supplier creation.
 * Fetches suppliers from the API, shows a dropdown, and allows creating
 * a new supplier mid-flow without breaking the parent form.
 *
 * Props:
 *   value       — current supplierId (string) or empty string
 *   onChange    — callback(supplierId: string) on selection
 *   placeholder — optional placeholder text
 */
export function SupplierSelect({ value, onChange, placeholder }) {
  const { t } = useTranslation();
  const [suppliers, setSuppliers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState('');

  useEffect(() => {
    api.get('/suppliers').then((r) => setSuppliers(r.data || [])).finally(() => setLoading(false));
  }, []);

  const showInput = adding;

  async function handleCreate() {
    const name = newName.trim();
    if (!name) return;
    const res = await api.post('/suppliers', { name });
    onChange(res.data.id);
    setSuppliers([...suppliers, res.data]);
    setAdding(false);
    setNewName('');
  }

  if (loading) return <span className="text--muted">{t('common.loading', 'Loading…')}</span>;

  if (showInput) {
    return (
      <div className="row" style={{ gap: 8 }}>
        <input
          className="input" value={newName} autoFocus
          placeholder={placeholder || t('suppliers.supplierName', 'Supplier name')}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') handleCreate(); }}
          onBlur={() => { if (newName.trim()) handleCreate(); else setAdding(false); }}
        />
      </div>
    );
  }

  return (
    <select
      className="select"
      value={value || ''}
      onChange={(e) => {
        if (e.target.value === '__new__') setAdding(true);
        else onChange(e.target.value);
      }}
    >
      <option value="" disabled>{placeholder || t('suppliers.selectSupplier', 'Select supplier…')}</option>
      {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
      <option value="__new__">＋ {t('suppliers.addNewSupplier', 'Add new supplier…')}</option>
    </select>
  );
}

/**
 * Cascading location picker: choose a city, then an area/district within it.
 * `tree` is the { city: [areas] } map from /locations/tree.
 */
export function LocationSelect({ tree = {}, city, area, onChange }) {
  const { t } = useTranslation();
  const cities = Object.keys(tree).sort((a, b) => a.localeCompare(b));
  const areas = tree[city] || [];
  return (
    <div className="row" style={{ gap: 12 }}>
      <div className="field" style={{ flex: 1, marginBottom: 0 }}>
        <label>{t('locations.city', 'City')}</label>
        <select className="select" value={city || ''} onChange={(e) => onChange({ city: e.target.value, area: '' })}>
          <option value="">{t('locations.selectCity', 'Select city…')}</option>
          {cities.map((g) => <option key={g} value={g}>{g}</option>)}
        </select>
      </div>
      <div className="field" style={{ flex: 1, marginBottom: 0 }}>
        <label>{t('locations.area', 'Area / District')}</label>
        <select className="select" value={area || ''} onChange={(e) => onChange({ city, area: e.target.value })} disabled={!city}>
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

export function DataTable({ columns, rows, empty, pagination, onRowClick }) {
  if (!rows || rows.length === 0) return <Empty label={empty} />;

  // When pagination is enabled, the parent passes paginated data via `rows`
  // and we render the Pagination bar with the supplied state.
  if (pagination) {
    return (
      <div>
        <div className="table-wrap">
          <table className="tbl">
            <thead>
              <tr>{columns.map((c) => <th key={c.key} style={{ textAlign: c.align === 'end' ? 'end' : 'start' }}>{c.label}</th>)}</tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                <tr key={row.id || i}
                    onClick={onRowClick ? () => onRowClick(row) : undefined}
                    style={onRowClick ? { cursor: 'pointer' } : undefined}>
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
        <Pagination {...pagination} />
      </div>
    );
  }

  return (
    <div className="table-wrap">
      <table className="tbl">
        <thead>
          <tr>{columns.map((c) => <th key={c.key} style={{ textAlign: c.align === 'end' ? 'end' : 'start' }}>{c.label}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={row.id || i}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
                style={onRowClick ? { cursor: 'pointer' } : undefined}>
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

export function ConfirmHost() {
  const { t } = useTranslation();
  const req = useUI((s) => s.confirmReq);
  const resolve = useUI((s) => s._resolveConfirm);
  return (
    <Modal open={!!req} onClose={() => resolve(false)} title={req?.title || t('common.confirm', 'Confirm')}
      footer={<>
        <button className="btn" onClick={() => resolve(false)}>{req?.cancelLabel || t('common.cancel')}</button>
        <button className={`btn ${req?.danger ? 'btn--danger' : 'btn--primary'}`} onClick={() => resolve(true)}>
          {req?.confirmLabel || t('common.confirm', 'Confirm')}
        </button>
      </>}>
      <p style={{ margin: 0, lineHeight: 1.6 }}>{req?.message}</p>
    </Modal>
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

/** Text input with label wrapper — uses the `.field` + `.input` CSS classes from globals.css.
 *  `type="date"` renders the custom themed DateField instead of the native picker. */
export function Input({ label, type = 'text', value, onChange, ...props }) {
  if (type === 'date') return <DateField label={label} value={value} onChange={onChange} placeholder={props.placeholder} />;
  return (
    <div className="field">
      {label && <label>{label}</label>}
      <input className="input" type={type} value={value ?? ''} onChange={(e) => onChange?.(e.target.value)} {...props} />
    </div>
  );
}

/** Select dropdown with label wrapper — uses the `.field` + `.select` CSS classes from globals.css. */
export function Select({ label, options = [], value, onChange }) {
  return (
    <div className="field">
      {label && <label>{label}</label>}
      <select className="select" value={value ?? ''} onChange={(e) => onChange?.(e.target.value)}>
        <option value="" disabled>—</option>
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>{opt.label}</option>
        ))}
      </select>
    </div>
  );
}

/** Multi-line text input with label wrapper — uses the `.field` + `.textarea` CSS classes from globals.css. */
export function Textarea({ label, value, onChange, rows = 3, ...props }) {
  return (
    <div className="field">
      {label && <label>{label}</label>}
      <textarea className="textarea" rows={rows} value={value ?? ''} onChange={(e) => onChange?.(e.target.value)} {...props} />
    </div>
  );
}

/** Button with color variants — uses `.btn` CSS classes from globals.css. */
export function Button({ children, onClick, color = 'primary', ...props }) {
  const cls = color === 'primary' ? 'btn btn--primary' : color === 'danger' ? 'btn btn--danger' : color === 'ghost' ? 'btn btn--ghost' : 'btn';
  return (
    <button className={cls} onClick={onClick} {...props}>
      {children}
    </button>
  );
}

/** Close an open popover on outside-click or Escape. Returns a ref for the popover wrapper. */
function usePopover(open, onClose) {
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const onDoc = (e) => { if (ref.current && !ref.current.contains(e.target)) onClose(); };
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onKey); };
  }, [open, onClose]);
  return ref;
}

const _pad2 = (n) => String(n).padStart(2, '0');
const toISODate = (d) => `${d.getFullYear()}-${_pad2(d.getMonth() + 1)}-${_pad2(d.getDate())}`;
const parseISODate = (s) => {
  if (!s) return null;
  const [y, m, d] = String(s).split('-').map(Number);
  return y ? new Date(y, (m || 1) - 1, d || 1) : null;
};

/**
 * Themed date picker with a friendly display ("17 Jul 2026") and a calendar popover — a
 * drop-in replacement for `<input type="date">` (which shows the browser's mm/dd/yyyy).
 * Stores/returns ISO `YYYY-MM-DD` so backend calls are unchanged. Theme- and RTL-aware.
 */
export function DateField({ label, value, onChange, placeholder }) {
  const { t, i18n } = useTranslation();
  const [open, setOpen] = useState(false);
  const [view, setView] = useState(() => parseISODate(value) || new Date());
  const ref = usePopover(open, () => setOpen(false));
  useEffect(() => { if (open) setView(parseISODate(value) || new Date()); }, [open, value]);

  const locale = i18n.language === 'ar' ? 'ar-EG' : 'en-GB';
  const sel = parseISODate(value);
  const display = sel ? sel.toLocaleDateString(locale, { day: '2-digit', month: 'short', year: 'numeric' }) : '';
  const todayISO = toISODate(new Date());

  const y = view.getFullYear();
  const mo = view.getMonth();
  const startDow = new Date(y, mo, 1).getDay();
  const daysInMonth = new Date(y, mo + 1, 0).getDate();
  const weekdays = Array.from({ length: 7 }, (_, i) => new Date(2024, 0, 7 + i).toLocaleDateString(locale, { weekday: 'narrow' }));
  const cells = [...Array(startDow).fill(null), ...Array.from({ length: daysInMonth }, (_, i) => i + 1)];
  const monthLabel = view.toLocaleDateString(locale, { month: 'long', year: 'numeric' });

  const control = (
    <div ref={ref} style={{ position: 'relative' }}>
      <button type="button" className="input" onClick={() => setOpen((o) => !o)}
        style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, cursor: 'pointer', textAlign: 'start', width: '100%' }}>
        <span style={{ color: display ? 'var(--ink)' : 'var(--muted)' }}>{display || placeholder || t('common.selectDate', 'Select date')}</span>
        <Calendar size={15} color="var(--muted)" style={{ flexShrink: 0 }} />
      </button>
      {open && (
        <div className="card" style={{ position: 'absolute', zIndex: 60, top: 'calc(100% + 4px)', insetInlineStart: 0, padding: 10, width: 252, boxShadow: 'var(--shadow-lg)' }}>
          <div className="row between" style={{ marginBottom: 8 }}>
            <button type="button" className="btn btn--icon btn--sm" onClick={() => setView(new Date(y, mo - 1, 1))}><ChevronLeft size={15} /></button>
            <span style={{ fontWeight: 700, fontSize: 13 }}>{monthLabel}</span>
            <button type="button" className="btn btn--icon btn--sm" onClick={() => setView(new Date(y, mo + 1, 1))}><ChevronRight size={15} /></button>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', gap: 2, textAlign: 'center' }}>
            {weekdays.map((w, i) => <div key={i} style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--muted)', padding: '2px 0' }}>{w}</div>)}
            {cells.map((d, i) => {
              if (d === null) return <div key={i} />;
              const iso = toISODate(new Date(y, mo, d));
              const isSel = iso === value;
              const isToday = iso === todayISO;
              return (
                <button type="button" key={i} onClick={() => { onChange?.(iso); setOpen(false); }}
                  style={{
                    padding: '6px 0', borderRadius: 'var(--r-sm)', cursor: 'pointer', fontSize: 12.5,
                    background: isSel ? 'var(--brand)' : 'transparent', color: isSel ? '#fff' : 'var(--ink)',
                    fontWeight: isToday ? 800 : 500, border: isToday && !isSel ? '1px solid var(--brand-400)' : '1px solid transparent',
                  }}>{d}</button>
              );
            })}
          </div>
          <div className="row between" style={{ marginTop: 8 }}>
            <button type="button" className="btn btn--sm" onClick={() => { onChange?.(''); setOpen(false); }}>{t('common.clear', 'Clear')}</button>
            <button type="button" className="btn btn--sm" onClick={() => { onChange?.(todayISO); setOpen(false); }}>{t('common.today', 'Today')}</button>
          </div>
        </div>
      )}
    </div>
  );
  if (!label) return control;
  return <div className="field"><label>{label}</label>{control}</div>;
}

/**
 * Themed custom dropdown (button + popover list) — a nicer, theme/RTL-aware replacement for
 * a native `<select>`. `options` = [{ value, label }]. Returns the chosen value via onChange.
 */
export function Dropdown({ label, value, onChange, options = [], placeholder, disabled }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const ref = usePopover(open, () => setOpen(false));
  const selected = options.find((o) => String(o.value) === String(value));

  const control = (
    <div ref={ref} style={{ position: 'relative' }}>
      <button type="button" className="select" disabled={disabled} onClick={() => setOpen((o) => !o)}
        style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, cursor: disabled ? 'not-allowed' : 'pointer', textAlign: 'start', width: '100%' }}>
        <span style={{ color: selected ? 'var(--ink)' : 'var(--muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {selected ? selected.label : (placeholder || t('common.select', 'Select'))}
        </span>
        <ChevronDown size={15} color="var(--muted)" style={{ flexShrink: 0 }} />
      </button>
      {open && !disabled && (
        <div className="card" style={{ position: 'absolute', zIndex: 60, top: 'calc(100% + 4px)', insetInline: 0, padding: 6, maxHeight: 260, overflowY: 'auto', boxShadow: 'var(--shadow-lg)' }}>
          {options.length === 0 && <div className="muted" style={{ padding: '8px 10px', fontSize: 13 }}>{t('common.noOptions', 'No options')}</div>}
          {options.map((o) => (
            <button type="button" key={String(o.value)} onClick={() => { onChange?.(o.value); setOpen(false); }}
              className="btn btn--ghost"
              style={{ width: '100%', justifyContent: 'flex-start', textAlign: 'start', padding: '8px 10px', background: String(o.value) === String(value) ? 'var(--brand-100)' : 'transparent', fontWeight: String(o.value) === String(value) ? 700 : 500 }}>
              {o.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
  if (!label) return control;
  return <div className="field"><label>{label}</label>{control}</div>;
}
