import { auditService } from '../services/auditService.js';

/**
 * Records an audit log entry in the secure audit_logs table. Call from services
 * after a mutating operation:
 *   await recordAudit(req.user, 'ORDER_CREATED', 'orders', order.id, { after: order });
 *   // or
 *   await recordAudit(req.user, 'ORDER_CREATED', { orderId: order.id, after: order });
 */
export async function recordAudit(user, action, entityTypeOrMetadata, entityId, detail = {}) {
  let metadata = {};
  if (typeof entityTypeOrMetadata === 'string') {
    metadata = { entityType: entityTypeOrMetadata, entityId: entityId || null, ...detail };
  } else if (entityTypeOrMetadata && typeof entityTypeOrMetadata === 'object') {
    metadata = entityTypeOrMetadata;
  }
  try {
    await auditService.log({
      userId: user?.sub || null,
      restaurantId: user?.restaurantId || null,
      action,
      deviceId: user?.deviceId || null,
      ipAddress: user?.ip || null,
      metadata,
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
      recordAudit(req.user, `${req.method} ${req.originalUrl}`, { path: req.originalUrl });
    }
  });
  next();
}

export default auditMiddleware;
