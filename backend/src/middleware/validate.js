import { validate as runValidation } from '../models/index.js';

/** Validate req.body against an entity schema before it reaches the service. */
export function validateBody(collection, { partial = false } = {}) {
  return (req, res, next) => {
    const { valid, errors, value } = runValidation(collection, req.body, { partial });
    if (!valid) return res.status(400).json({ error: 'Validation failed', details: errors });
    req.body = value;
    next();
  };
}

export default validateBody;
