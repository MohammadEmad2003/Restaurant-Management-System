import { logger } from '../utils/logger.js';
import { config } from '../config/index.js';

/** Wrap async route handlers so thrown errors reach the error middleware. */
export const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

export function notFound(req, res) {
  res.status(404).json({ error: `Not found: ${req.method} ${req.originalUrl}` });
}

// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, next) {
  const status = err.status || 500;
  if (status >= 500) logger.error(`${req.method} ${req.originalUrl} → ${err.message}`);
  // Every error thrown deliberately via HttpError (4xx, and any intentional
  // 5xx) has an already-safe, user-facing message. An UNEXPECTED 500 (a bug,
  // a raw driver/fs error bubbling up uncaught) never goes through HttpError,
  // so its raw `err.message` can contain SQL fragments, file paths, or other
  // internal detail — never send that to the client in production, only log
  // it server-side (above) where it's actually useful for debugging.
  const message = status >= 500 && config.env === 'production' && !(err instanceof HttpError)
    ? 'Internal server error'
    : (err.message || 'Internal server error');
  res.status(status).json({
    error: message,
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
