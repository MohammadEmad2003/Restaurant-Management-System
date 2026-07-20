import jwt from 'jsonwebtoken';
import { config } from '../config/index.js';
import { HttpError } from './errorHandler.js';
import { secureStore } from '../repositories/secureStore.js';
import { deviceService } from '../services/deviceService.js';
import { buildFingerprint } from '../utils/device.js';

/** Verifies the Bearer JWT and attaches req.user = { sub, role, name, restaurantId, deviceId, fingerprint }. */
export function auth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Authentication required' });
  try {
    const decoded = jwt.verify(token, config.jwtSecret);
    req.user = decoded;
    return next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

/**
 * Verifies that the JWT is bound to the current device fingerprint.
 * Rejects if device, fingerprint, or restaurant mismatch.
 */
export async function requireDeviceBound(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Authentication required' });
  try {
    if (req.user.type === 'super_admin') return next();

    const fingerprint = buildFingerprint(req);
    if (req.user.fingerprint && req.user.fingerprint !== fingerprint) {
      return res.status(401).json({ error: 'Device fingerprint mismatch' });
    }
    if (!req.user.deviceId || !req.user.restaurantId) {
      return res.status(401).json({ error: 'Invalid token context' });
    }
    const device = await deviceService.getDevice(req.user.deviceId);
    if (!device || device.status === 'revoked') {
      return res.status(401).json({ error: 'Device has been revoked' });
    }
    if (device.restaurantId !== req.user.restaurantId) {
      return res.status(401).json({ error: 'Device restaurant mismatch' });
    }
    if (device.fingerprint !== fingerprint) {
      return res.status(401).json({ error: 'Device fingerprint mismatch' });
    }
    return next();
  } catch (err) {
    return res.status(401).json({ error: err.message || 'Device validation failed' });
  }
}

export function signToken(payload) {
  return jwt.sign(payload, config.jwtSecret, { expiresIn: config.jwtExpiresIn });
}

export default auth;
