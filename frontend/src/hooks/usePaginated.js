import { useState, useMemo } from 'react';

/**
 * Hook that takes an array and returns a paginated subset.
 *
 * Returns:
 *  - page        : number (1-based current page)
 *  - pageSize    : number
 *  - totalPages  : number
 *  - totalItems  : number
 *  - setPage     : (page) => void
 *  - setPageSize : (size) => void  (resets to page 1)
 *  - paginatedData : array (current page slice)
 *
 * @param {Array} data - full array to paginate
 * @param {number} defaultPageSize - initial page size (default 10)
 */
export function usePaginated(data = [], defaultPageSize = 10) {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(defaultPageSize);

  const totalPages = Math.max(1, Math.ceil(data.length / pageSize));

  // Reset to page 1 if current page is out of bounds (e.g. pageSize changed or data shrunk)
  const safePage = page > totalPages ? 1 : page;

  const paginatedData = useMemo(() => {
    const start = (safePage - 1) * pageSize;
    return data.slice(start, start + pageSize);
  }, [data, safePage, pageSize]);

  const handleSetPageSize = (size) => {
    setPageSize(size);
    setPage(1);
  };

  return {
    page: safePage,
    pageSize,
    totalPages,
    totalItems: data.length,
    setPage,
    setPageSize: handleSetPageSize,
    paginatedData,
  };
}
