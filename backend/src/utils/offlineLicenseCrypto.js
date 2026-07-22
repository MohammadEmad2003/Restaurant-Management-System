import crypto from 'node:crypto';
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
      logger.warn(`OFFLINE_LICENSE_PRIVATE_KEY/PUBLIC_KEY is set but unusable (${err.message}); falling back to an ephemeral keypair.`);
    }
  } else {
    logger.warn(
      'OFFLINE_LICENSE_PRIVATE_KEY/OFFLINE_LICENSE_PUBLIC_KEY not set; generating an ephemeral ' +
        'keypair. Offline licenses issued before a restart will not verify after one — set a ' +
        'dedicated ECDSA P-256 keypair in production.',
    );
  }
  const { privateKey, publicKey } = generateEphemeralKeys();
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
