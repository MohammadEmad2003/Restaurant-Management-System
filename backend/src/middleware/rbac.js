import { can, ROLES } from '../config/permissions.js';

export const APP_ROLES = {
  SUPER_ADMIN: 'SUPER_ADMIN',
  ADMIN: 'ADMIN',
  CASHIER: 'CASHIER',
};

/**
 * Role guard. Usage:
 *   rbac('ADMIN')                  → admins only
 *   rbac('ADMIN','CASHIER')        → either role
 *   rbac.action('orders:create')   → permission-based check
 */
export function rbac(...allowedRoles) {
  const normalized = allowedRoles.map((r) => r.toUpperCase());
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Authentication required' });
    const role = (req.user.role || '').toUpperCase();
    if (role === APP_ROLES.SUPER_ADMIN) return next(); // super admin bypasses
    if (normalized.includes(role)) return next();
    return res.status(403).json({ error: 'Forbidden: insufficient role' });
  };
}

rbac.action = (action) => (req, res, next) => {
  if (!req.user) return res.status(401).json({ error: 'Authentication required' });
  const role = (req.user.role || '').toLowerCase();
  if (role === 'super_admin' || can(role, action)) return next();
  return res.status(403).json({ error: `Forbidden: missing permission "${action}"` });
};

export function requireSuperAdmin(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Authentication required' });
  if ((req.user.role || '').toUpperCase() !== APP_ROLES.SUPER_ADMIN) {
    return res.status(403).json({ error: 'Forbidden: super admin required' });
  }
  next();
}

export default rbac;
