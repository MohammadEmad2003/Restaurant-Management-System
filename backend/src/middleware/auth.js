import jwt from 'jsonwebtoken';
import { config } from '../config/index.js';
import { HttpError } from './errorHandler.js';
import { secureStore } from '../repositories/secureStore.js';
import { deviceService } from '../services/deviceService.js';
import { sessionService } from '../services/sessionService.js';
import { licenseService } from '../services/licenseService.js';
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
    if (!deviceService.validateDeviceSecret(device, req.headers['x-device-secret'])) {
      return res.status(401).json({ error: 'Device secret mismatch' });
    }
    // Gives Force-Logout/Terminate-Session/suspend-on-user real teeth: without
    // this, a still-cryptographically-valid JWT keeps working until its natural
    // expiry even after the session row is marked logged_out/revoked/expired.
    const session = await sessionService.getByJwtId(req.user.jti);
    if (!session || session.status !== 'active') {
      return res.status(401).json({ error: 'Session has been terminated' });
    }
    return next();
  } catch (err) {
    return res.status(err.status || 401).json({ error: err.message || 'Device validation failed' });
  }
}

/**
 * The restaurant's license itself was previously only ever checked at LOGIN
 * (authService.loginRestaurantUser) — never on any request afterward. That
 * meant an already-logged-in session (valid JWT, valid device, valid
 * session) could keep using every feature indefinitely — up to the JWT's
 * full lifetime — even after the license expired, was revoked, or was
 * suspended, with zero server-side re-check. It also meant calling the API
 * directly (bypassing the frontend's own client-side offline-license expiry
 * UI entirely, e.g. via curl with a cached token+device-secret) was never
 * actually blocked by anything.
 *
 * A SEPARATE middleware from requireDeviceBound (rather than folded into
 * it) specifically so a small number of license-status/self-service routes
 * (`GET /license/status`, `GET /license/my-devices`, ...) can still use
 * requireDeviceBound alone and remain reachable even once the license has
 * expired — an admin needs to be able to SEE that it expired, not be
 * locked out of the one screen that would tell them so.
 */
export async function requireActiveLicense(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Authentication required' });
  if (req.user.type === 'super_admin') return next();
  try {
    await licenseService.validateLicense(req.user.restaurantId);
    return next();
  } catch (err) {
    return res.status(err.status || 403).json({ error: err.message || 'License validation failed' });
  }
}

export function signToken(payload) {
  return jwt.sign(payload, config.jwtSecret, { expiresIn: config.jwtExpiresIn });
}

export default auth;
