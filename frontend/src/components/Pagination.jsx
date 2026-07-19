import { useTranslation } from 'react-i18next';

/**
 * Pagination bar with page numbers, prev/next, page-size selector, and "Showing X–Y of Z" text.
 *
 * Props:
 *  - currentPage   : number (1-based)
 *  - totalPages    : number
 *  - onPageChange  : (page) => void
 *  - pageSize      : number
 *  - totalItems    : number
 *  - pageSizes     : number[]  (default [10, 25, 50, 100])
 *  - onPageSizeChange : (size) => void
 */
export default function Pagination({ currentPage, totalPages, onPageChange, pageSize, totalItems, pageSizes = [10, 25, 50, 100], onPageSizeChange }) {
  const { t } = useTranslation();

  if (totalPages <= 1) return null;

  const start = (currentPage - 1) * pageSize + 1;
  const end = Math.min(currentPage * pageSize, totalItems);

  /** Build a compact page-number list with ellipsis */
  const pages = [];
  const maxVisible = 5;
  if (totalPages <= maxVisible + 2) {
    for (let i = 1; i <= totalPages; i++) pages.push(i);
  } else {
    pages.push(1);
    if (currentPage > 3) pages.push('...');
    const lo = Math.max(2, currentPage - 1);
    const hi = Math.min(totalPages - 1, currentPage + 1);
    for (let i = lo; i <= hi; i++) pages.push(i);
    if (currentPage < totalPages - 2) pages.push('...');
    pages.push(totalPages);
  }

  return (
    <div className="pagination">
      <div className="pagination__info">
        {t('pagination.showing', 'Showing {{start}}-{{end}} of {{total}} items', { start, end, total: totalItems })}
      </div>

      <div className="pagination__center">
        <button
          className="btn btn--sm btn--ghost"
          disabled={currentPage === 1}
          onClick={() => onPageChange(currentPage - 1)}
          title={t('pagination.prev', 'Previous')}
        >
          ‹
        </button>

        {pages.map((p, i) =>
          p === '...' ? (
            <span key={`e${i}`} className="pagination__ellipsis">…</span>
          ) : (
            <button
              key={p}
              className={`btn btn--sm ${currentPage === p ? 'btn--ghost is-active' : 'btn--ghost'}`}
              onClick={() => onPageChange(p)}
            >
              {p}
            </button>
          ),
        )}

        <button
          className="btn btn--sm btn--ghost"
          disabled={currentPage === totalPages}
          onClick={() => onPageChange(currentPage + 1)}
          title={t('pagination.next', 'Next')}
        >
          ›
        </button>
      </div>

      <div className="pagination__size">
        <label className="muted">{t('pagination.pageSize', 'Rows per page')}</label>
        <select
          className="select select--sm"
          value={pageSize}
          onChange={(e) => onPageSizeChange?.(Number(e.target.value))}
        >
          {pageSizes.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
      </div>
    </div>
  );
}
