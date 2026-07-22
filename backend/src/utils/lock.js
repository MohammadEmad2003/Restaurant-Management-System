const chains = new Map();

/**
 * In-process async mutex keyed by an arbitrary string (e.g. a restaurantId).
 * Serializes concurrent callers sharing the same key so check-then-act
 * sequences (count sessions, then create one) can't race each other.
 *
 * Assumes a single Node process — if this app is ever horizontally scaled
 * (clustering/PM2/multiple containers), this stops being sufficient and a
 * DB-level lock (e.g. Postgres pg_advisory_xact_lock) would be needed instead.
 */
export function withLock(key, fn) {
  const prev = chains.get(key) || Promise.resolve();
  const run = prev.then(fn, fn);
  // Chain a settled (never-rejecting) continuation for the next caller to wait
  // on, so one caller's rejection doesn't poison the queue for callers behind it.
  const settled = run.then(
    () => {},
    () => {},
  );
  chains.set(key, settled);
  settled.finally(() => {
    if (chains.get(key) === settled) chains.delete(key);
  });
  return run;
}

export default { withLock };
