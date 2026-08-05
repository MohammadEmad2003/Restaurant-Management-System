import { config } from '../config/index.js';
import { HttpError } from '../middleware/errorHandler.js';

/**
 * Used ONLY by non-authority (packaged desktop) instances — see
 * config.isLicenseAuthority's comment. Every call here goes over real HTTPS
 * to the centrally-hosted authority; there is deliberately no local
 * fallback, which is what makes "activation requires the internet" a
 * structural fact rather than an advisory check a user could defeat by
 * editing local files or spoofing connectivity.
 */
function authorityUrl(pathSuffix) {
  if (!config.licenseAuthorityUrl) {
    throw new HttpError(500, 'LICENSE_AUTHORITY_URL is not configured on this install.');
  }
  return `${config.licenseAuthorityUrl}/api/license${pathSuffix}`;
}

async function post(pathSuffix, body, { timeoutMs = 15000 } = {}) {
  // Deliberately OUTSIDE the try/catch below — a misconfigured install (no
  // LICENSE_AUTHORITY_URL) is a distinct, actionable error from "the
  // network call itself failed" and must not be rewritten into the generic
  // connectivity message.
  const url = authorityUrl(pathSuffix);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (err) {
    throw new HttpError(503, 'Could not reach the licensing server. Please check your internet connection and try again.');
  } finally {
    clearTimeout(timer);
  }
  let json = null;
  try { json = await res.json(); } catch { /* non-JSON error body, fall through */ }
  if (!res.ok) {
    throw new HttpError(res.status, json?.error || `Licensing server returned ${res.status}`);
  }
  return json;
}

async function get(pathSuffix, { timeoutMs = 8000 } = {}) {
  const url = authorityUrl(pathSuffix);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let res;
  try {
    res = await fetch(url, { signal: controller.signal });
  } catch (err) {
    throw new HttpError(503, 'Could not reach the licensing server.');
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) throw new HttpError(res.status, `Licensing server returned ${res.status}`);
  return res.json();
}

export const licenseAuthorityClient = {
  activate(body) {
    return post('/authority/activate', body);
  },
  bindHardware(body) {
    return post('/authority/bind-hardware', body);
  },
  revalidate(body) {
    return post('/authority/revalidate', body, { timeoutMs: 10000 });
  },
  publicKey() {
    return get('/public-key');
  },
};

export default licenseAuthorityClient;
