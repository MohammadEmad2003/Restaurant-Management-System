import { logger } from '../utils/logger.js';

/** Wrap async route handlers so thrown errors reach the error middleware. */
export const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

export function notFound(req, res) {
  res.status(404).json({ error: `Not found: ${req.method} ${req.originalUrl}` });
}

// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, next) {
  const status = err.status || 500;
  if (status >= 500) logger.error(`${req.method} ${req.originalUrl} → ${err.message}`);
  res.status(status).json({
    error: err.message || 'Internal server error',
    ...(err.details ? { details: err.details } : {}),
  });
}

/** Throw this from services for clean HTTP errors. */
export class HttpError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

export default errorHandler;
