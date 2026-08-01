import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rbac } from './rbac.js';

function call(mw, role) {
  let status = null;
  let body = null;
  let nextCalled = false;
  const req = { user: role ? { role } : null };
  const res = {
    status(code) { status = code; return this; },
    json(payload) { body = payload; return this; },
  };
  mw(req, res, () => { nextCalled = true; });
  return { status, body, nextCalled };
}

test('rbac("ADMIN") blocks CASHIER and allows ADMIN', () => {
  const mw = rbac('ADMIN');
  assert.equal(call(mw, 'admin').nextCalled, true);
  assert.equal(call(mw, 'cashier').nextCalled, false);
  assert.equal(call(mw, 'cashier').status, 403);
});

test('rbac("ADMIN","CASHIER") allows both roles — used for complaints creation and cashier-shift handover routes', () => {
  const mw = rbac('ADMIN', 'CASHIER');
  assert.equal(call(mw, 'admin').nextCalled, true);
  assert.equal(call(mw, 'cashier').nextCalled, true);
  assert.equal(call(mw, 'chef').nextCalled, false);
});

test('SUPER_ADMIN always bypasses any role restriction', () => {
  const mw = rbac('ADMIN');
  assert.equal(call(mw, 'SUPER_ADMIN').nextCalled, true);
});

test('a missing req.user (no auth) is rejected with 401, not 403', () => {
  const mw = rbac('ADMIN');
  const result = call(mw, null);
  assert.equal(result.nextCalled, false);
  assert.equal(result.status, 401);
});
