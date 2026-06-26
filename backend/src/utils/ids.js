import { randomUUID } from 'crypto';

/** Prefixed, human-readable unique id, e.g. ORD-9f3a2b. */
export function newId(prefix = 'id') {
  return `${prefix}-${randomUUID().slice(0, 8)}`;
}

/** Short human code, e.g. for invoice numbers. */
export function shortCode(prefix = 'INV') {
  const n = Date.now().toString(36).toUpperCase().slice(-5);
  const r = Math.random().toString(36).toUpperCase().slice(2, 5);
  return `${prefix}-${n}${r}`;
}

export default { newId, shortCode };
