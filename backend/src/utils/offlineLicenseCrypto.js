import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config/index.js';
import { logger } from './logger.js';

let _privateKey = null;
let _publicKey = null;

/** .env commonly stores PEM values with escaped \n — restore real newlines. */
function unescapeNewlines(pem) {
  return pem.includes('\\n') ? pem.replace(/\\n/g, '\n') : pem;
}

function generateEphemeralKeys() {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
  return { privateKey, publicKey };
}

// Every packaged build ships with NO `.env` (see frontend/package.json's
// extraResources filter — only src/**, fonts/**, package.json are bundled),
// so OFFLINE_LICENSE_PRIVATE_KEY/PUBLIC_KEY are never actually configured in
// a real installed app. A PURELY ephemeral (never-persisted) keypair used to
// be generated fresh on every single process restart — which happens on
// every close/reopen of this embedded-backend desktop app — silently
// invalidating every previously-issued offline license's signature on every
// restart. That's not just a reliability bug (offline access breaking after
// every restart): `evaluateOfflineAccess` checks the signature BEFORE the
// expiration date, so a signature failure reports tier 'blocked' instead of
// the license's real 'expired' status — and 'blocked' is only enforced by
// the frontend while offline, not online — so an already-expired license
// could regain full access after a restart simply by being online at that
// moment. Persisting the keypair once (same durable per-installation
// location the local JSON store itself already uses) closes this: the same
// keypair — and therefore every previously-issued signature — survives
// every restart, so the real expiration check always actually runs.
function keyFilePath() {
  return path.join(config.dataDir, '.offline-license-key.json');
}

function loadOrCreatePersistedKeys() {
  const file = keyFilePath();
  try {
    if (fs.existsSync(file)) {
      const { privateKeyPem, publicKeyPem } = JSON.parse(fs.readFileSync(file, 'utf8'));
      const privateKey = crypto.createPrivateKey(privateKeyPem);
      const publicKey = crypto.createPublicKey(publicKeyPem);
      return { privateKey, publicKey };
    }
  } catch (err) {
    logger.warn(`Persisted offline-license signing key at ${file} is unreadable/corrupt (${err.message}) — generating a fresh one. Offline licenses issued before this point will stop verifying.`);
  }
  const { privateKey, publicKey } = generateEphemeralKeys();
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify({
      privateKeyPem: privateKey.export({ type: 'pkcs8', format: 'pem' }),
      publicKeyPem: publicKey.export({ type: 'spki', format: 'pem' }),
    }), { mode: 0o600 });
  } catch (err) {
    logger.warn(`Could not persist the newly-generated offline-license signing key to ${file} (${err.message}) — it will not survive a restart until this is writable.`);
  }
  return { privateKey, publicKey };
}

function loadKeys() {
  if (_privateKey && _publicKey) return { privateKey: _privateKey, publicKey: _publicKey };

  const { privateKeyPem, publicKeyPem } = config.offlineLicense;
  if (privateKeyPem && publicKeyPem) {
    try {
      const privateKey = crypto.createPrivateKey(unescapeNewlines(privateKeyPem));
      const publicKey = crypto.createPublicKey(unescapeNewlines(publicKeyPem));
      // Web Crypto's ECDSA verify (what the browser uses) needs a P-256 EC
      // key — a leftover/misconfigured key of the wrong type (e.g. Ed25519)
      // must not be silently used, or signing fails in confusing ways later.
      if (privateKey.asymmetricKeyType !== 'ec' || privateKey.asymmetricKeyDetails?.namedCurve !== 'prime256v1') {
        throw new Error(`expected an EC P-256 key, got ${privateKey.asymmetricKeyType}`);
      }
      _privateKey = privateKey;
      _publicKey = publicKey;
      return { privateKey: _privateKey, publicKey: _publicKey };
    } catch (err) {
      logger.warn(`OFFLINE_LICENSE_PRIVATE_KEY/PUBLIC_KEY is set but unusable (${err.message}); falling back to a persisted per-installation keypair.`);
    }
  } else {
    logger.warn(
      'OFFLINE_LICENSE_PRIVATE_KEY/OFFLINE_LICENSE_PUBLIC_KEY not set; using a persisted ' +
        'per-installation keypair instead (generated once, stored under DATA_DIR). For a ' +
        'centrally-hosted deployment shared across machines, set a dedicated ECDSA P-256 ' +
        'keypair explicitly so every instance shares the same one.',
    );
  }
  const { privateKey, publicKey } = loadOrCreatePersistedKeys();
  _privateKey = privateKey;
  _publicKey = publicKey;
  return { privateKey: _privateKey, publicKey: _publicKey };
}

/**
 * Signs the exact JSON string the caller will also send to the client, so
 * verification never depends on both sides re-serializing an object the same
 * way. IEEE-P1363 (raw r‖s) encoding — not Node's DER default — because
 * browser Web Crypto's ECDSA verify expects the raw format.
 */
export function signOfflinePayload(payloadString) {
  const { privateKey } = loadKeys();
  const signature = crypto.sign('sha256', Buffer.from(payloadString, 'utf8'), {
    key: privateKey,
    dsaEncoding: 'ieee-p1363',
  });
  return signature.toString('base64');
}

export function getPublicKeySpkiBase64() {
  const { publicKey } = loadKeys();
  return publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
}

export default { signOfflinePayload, getPublicKeySpkiBase64 };
