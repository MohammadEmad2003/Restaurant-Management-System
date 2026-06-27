/**
 * Central permission matrix — the single source of truth for RBAC.
 * Consumed by the rbac middleware (server) and exposed to the frontend
 * (via /auth/me) so the UI can hide/disable what a role cannot do.
 */
export const ROLES = { ADMIN: 'admin', CASHIER: 'cashier', CHEF: 'chef' };

// action keys map to feature groups used across routes + UI.
export const PERMISSIONS = {
  [ROLES.ADMIN]: ['*'], // full access
  [ROLES.CASHIER]: [
    'orders:create',
    'orders:read',
    'orders:print',
    'clients:create',
    'clients:read',
    'clients:update',
    'inventory:read',
    'activity:read:self',
    'kds:read',
    'reservations:read',
    'reservations:create',
    'attendance:self',
  ],
  // Kitchen staff: see and advance kitchen tickets, read recipes/inventory, clock in.
  [ROLES.CHEF]: [
    'orders:read',
    'kds:read',
    'kds:update',
    'inventory:read',
    'products:read',
    'activity:read:self',
    'attendance:self',
  ],
};

export function can(role, action) {
  const perms = PERMISSIONS[role] || [];
  return perms.includes('*') || perms.includes(action);
}

export default { ROLES, PERMISSIONS, can };
