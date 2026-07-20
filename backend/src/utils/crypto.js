import crypto from 'node:crypto';
import { config } from '../config/index.js';
import { logger } from './logger.js';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const TAG_LENGTH = 16;

function getKey() {
  const raw = process.env.ACTIVATION_TOKEN_ENCRYPTION_KEY || config.jwtSecret;
  if (!process.env.ACTIVATION_TOKEN_ENCRYPTION_KEY) {
    logger.warn('ACTIVATION_TOKEN_ENCRYPTION_KEY is not set; falling back to JWT_SECRET. Set a dedicated 32-byte key in production.');
  }
  // Derive a 32-byte key from the configured secret using SHA-256.
  return crypto.createHash('sha256').update(raw).digest();
}

/**
 * Encrypt a plain text string. Returns a hex string containing:
 *   iv (16 bytes) + authTag (16 bytes) + ciphertext
 */
export function encrypt(text) {
  if (!text) return '';
  const key = getKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  const combined = Buffer.concat([iv, tag, encrypted]);
  return combined.toString('hex');
}

/**
 * Decrypt a hex string produced by encrypt(). Throws on failure.
 */
export function decrypt(hex) {
  if (!hex) return '';
  const key = getKey();
  const combined = Buffer.from(hex, 'hex');
  if (combined.length < IV_LENGTH + TAG_LENGTH) throw new Error('Invalid encrypted payload');
  const iv = combined.subarray(0, IV_LENGTH);
  const tag = combined.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH);
  const encrypted = combined.subarray(IV_LENGTH + TAG_LENGTH);
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
  return decrypted.toString('utf8');
}

/**
 * Sign a payload with HMAC-SHA256 for offline license integrity.
 */
export function signPayload(payload) {
  const key = getKey();
  const data = typeof payload === 'string' ? payload : JSON.stringify(payload);
  return crypto.createHmac('sha256', key).update(data).digest('hex');
}

/**
 * Verify an HMAC signature.
 */
export function verifySignature(payload, signature) {
  return signPayload(payload) === signature;
}

export default { encrypt, decrypt, signPayload, verifySignature };
