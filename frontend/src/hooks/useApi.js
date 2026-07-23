import { useState, useEffect, useCallback } from 'react';
import { api } from '../api/client.js';

/** Simple GET hook with loading/error/refetch. Pass `initial` to declare the empty shape (e.g. []).
 * Pass a falsy `path` (e.g. conditionally `null`) to skip the request entirely — useful when
 * which endpoint to call depends on something like the user's role. */
export function useFetch(path, deps = [], initial = null) {
  const [data, setData] = useState(initial);
  const [loading, setLoading] = useState(!!path);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    if (!path) { setLoading(false); return; }
    setLoading(true);
    setError(null);
    try {
      const res = await api.get(path);
      setData(res.data);
    } catch (e) {
      setError(e.response?.data?.error || e.message);
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  useEffect(() => { load(); }, [load]);
  return { data, loading, error, refetch: load, setData };
}

export default useFetch;
