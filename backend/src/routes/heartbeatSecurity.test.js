import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const routesSource = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'index.js'), 'utf8');

// Regression: POST /auth/heartbeat previously only required `auth` (a valid
// JWT signature), not `requireDeviceBound` — which is the middleware that
// actually re-checks, on every request, whether the device has been revoked
// or the session has been terminated. Without it, a Super Admin revoking a
// device or terminating a session had no effect on that device's ability to
// keep calling heartbeat and receiving a freshly-signed offline license,
// silently undermining the revocation. This test only checks the route
// wiring itself (this codebase has no HTTP-level test harness, only
// service-level tests) — it exists specifically to catch a future refactor
// accidentally dropping requireDeviceBound from this one route again.
test('POST /auth/heartbeat is wired through both auth AND requireDeviceBound', () => {
  const match = routesSource.match(/router\.post\('\/auth\/heartbeat',\s*([^)]+?)h\(/);
  assert.ok(match, 'could not find the /auth/heartbeat route registration to check');
  const middlewareChain = match[1];
  assert.match(middlewareChain, /\bauth\b/, 'heartbeat must require a valid JWT');
  assert.match(middlewareChain, /\brequireDeviceBound\b/, 'heartbeat must re-validate device/session revocation on every call, not just at login');
});
