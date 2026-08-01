/** A network error means we likely lost connectivity — fail over to offline
 * and retry later. Anything else (e.g. a constraint violation, a genuine
 * data bug) is NOT a connectivity problem — retrying it forever would just
 * spin uselessly, so callers should surface it instead of queuing/going
 * offline for it. Shared by the sync engine and secureStore's write-through
 * mirror so both classify errors identically. */
export function isNetworkError(err) {
  const m = String(err?.message || '');
  // ENETUNREACH ("Network is unreachable" — e.g. no route to the DB host at
  // all, as opposed to a refused/reset/timed-out connection to a reachable
  // one) doesn't contain any of "connection"/"network" in Node's actual error
  // text, so it fell through this check entirely and never flipped the app
  // into offline mode on that specific failure — confirmed via a real
  // connection attempt to an unreachable host during this review.
  return /timed out|ENOTFOUND|ECONNREFUSED|ECONNRESET|ETIMEDOUT|ENETUNREACH|EHOSTUNREACH|connection|network/i.test(m);
}

export default isNetworkError;
