import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { signOfflinePayload, getPublicKeySpkiBase64 } from './offlineLicenseCrypto.js';

function verifyWithNode(payloadString, signatureBase64, publicKeySpkiBase64) {
  const publicKey = crypto.createPublicKey({
    key: Buffer.from(publicKeySpkiBase64, 'base64'),
    format: 'der',
    type: 'spki',
  });
  return crypto.verify(
    'sha256',
    Buffer.from(payloadString, 'utf8'),
    { key: publicKey, dsaEncoding: 'ieee-p1363' },
    Buffer.from(signatureBase64, 'base64'),
  );
}

test('a signed payload verifies successfully against the exported public key', () => {
  const payload = JSON.stringify({ restaurantId: 'r1', offlineExpiration: '2030-01-01T00:00:00.000Z' });
  const signature = signOfflinePayload(payload);
  const publicKey = getPublicKeySpkiBase64();
  assert.equal(verifyWithNode(payload, signature, publicKey), true);
});

test('tampering with the payload after signing invalidates the signature', () => {
  const payload = JSON.stringify({ restaurantId: 'r1', offlineExpiration: '2030-01-01T00:00:00.000Z' });
  const signature = signOfflinePayload(payload);
  const publicKey = getPublicKeySpkiBase64();
  const tampered = payload.replace('r1', 'r2');
  assert.equal(verifyWithNode(tampered, signature, publicKey), false);
});

test('tampering with the signature itself invalidates verification', () => {
  const payload = JSON.stringify({ restaurantId: 'r1' });
  const signature = signOfflinePayload(payload);
  const publicKey = getPublicKeySpkiBase64();
  const tamperedSig = signature.slice(0, -4) + (signature.slice(-4) === 'AAAA' ? 'BBBB' : 'AAAA');
  assert.equal(verifyWithNode(payload, tamperedSig, publicKey), false);
});
