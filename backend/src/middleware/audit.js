import { repo } from '../repositories/index.js';
import { localStore } from '../repositories/localStore.js';

/**
 * Audit logs are append-only and otherwise grow without bound, which slows every
 * write (the whole file is re-serialised) and the /audit-logs query (it loads
 * everything). Keep a rolling window of the most recent entries in the local
 * store. Trimming is amortised — only when a high-water margin is crossed — so
 * it is O(1) per write on average.
 */
const AUDIT_CAP = Number(process.env.AUDIT_LOG_CAP) || 2000;
const AUDIT_HIGH_WATER = AUDIT_CAP + 500;

function trimAuditLog() {
  const rows = localStore.load('auditLogs');
  if (rows.length <= AUDIT_HIGH_WATER) return;
  localStore.set('auditLogs', rows.slice(rows.length - AUDIT_CAP));
}

/**
 * Records an audit log entry. Call from services after a mutating operation:
 *   await recordAudit(req.user, 'ORDER_CREATED', 'orders', order.id, { after: order });
 */
export async function recordAudit(user, action, entityType, entityId, { before, after } = {}) {
  try {
    await repo('auditLogs').create({
      userId: user?.sub || 'system',
      userName: user?.name || 'system',
      action,
      entityType,
      entityId: entityId || null,
      before: before || null,
      after: after || null,
      timestamp: Date.now(),
    });
    trimAuditLog();
  } catch {
    /* never let audit failure break the request */
  }
}

/**
 * Express middleware that auto-logs successful mutating requests. Used as a
 * safety net; services also log richer, domain-specific events.
 */
export function auditMiddleware(req, res, next) {
  const mutating = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method);
  if (!mutating) return next();
  res.on('finish', () => {
    if (res.statusCode >= 200 && res.statusCode < 300) {
      const entityType = (req.baseUrl || '').replace('/api/', '') || 'unknown';
      recordAudit(req.user, `${req.method} ${req.originalUrl}`, entityType, null, {});
    }
  });
  next();
}

export default auditMiddleware;
