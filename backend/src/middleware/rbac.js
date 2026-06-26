import { can, ROLES } from '../config/permissions.js';

/**
 * Role guard. Usage:
 *   rbac('admin')               → admins only
 *   rbac('admin','cashier')     → either role
 *   rbac.action('orders:create')→ permission-based check
 */
export function rbac(...allowedRoles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Authentication required' });
    if (req.user.role === ROLES.ADMIN) return next(); // admin = full access
    if (allowedRoles.includes(req.user.role)) return next();
    return res.status(403).json({ error: 'Forbidden: insufficient role' });
  };
}

rbac.action = (action) => (req, res, next) => {
  if (!req.user) return res.status(401).json({ error: 'Authentication required' });
  if (can(req.user.role, action)) return next();
  return res.status(403).json({ error: `Forbidden: missing permission "${action}"` });
};

export default rbac;
