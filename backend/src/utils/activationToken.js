import crypto from 'node:crypto';

/** Human-typeable but high-entropy (128 bits) — unlike the old
 * shortCode()-based token this replaces, brute-forcing this by guessing is
 * infeasible even against an unrated endpoint, which matters once the token
 * is stored hashed (see hashActivationToken) rather than reversibly
 * encrypted: nothing server-side can ever read a lost token back out, so it
 * must be unguessable from the start. */
export function generateActivationToken() {
  const group = () => crypto.randomBytes(4).toString('hex').toUpperCase();
  return `ACT-${group()}-${group()}-${group()}-${group()}`;
}

/** Fast hash, not bcrypt — same reasoning as deviceSecret.js: this is a
 * 128-bit random value, not a guessable human password, so bcrypt's
 * deliberate slowness only adds cost to a lookup that now runs on every
 * activation attempt. */
export function hashActivationToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export default { generateActivationToken, hashActivationToken };
