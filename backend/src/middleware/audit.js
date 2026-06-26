import { repo } from '../repositories/index.js';

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
