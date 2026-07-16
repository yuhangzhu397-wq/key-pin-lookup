import assert from 'node:assert/strict';
import test from 'node:test';
import { accessControl } from './auth.js';

function run(headers = {}) {
  const result = { status: null, body: null, next: false, operator: null };
  const request = {
    get(name) {
      return headers[name.toLowerCase()];
    },
  };
  const response = {
    status(value) {
      result.status = value;
      return this;
    },
    json(value) {
      result.body = value;
    },
  };

  accessControl(request, response, () => {
    result.next = true;
    result.operator = request.operator;
  });
  return result;
}

test('proxy access control requires and accepts the configured user header', () => {
  const original = { ...process.env };
  try {
    process.env.AUTH_MODE = 'proxy';
    process.env.AUTH_USER_HEADER = 'x-erp-user';
    process.env.AUTH_ALLOWED_USERS = 'alice,bob';

    assert.equal(run().status, 401);
    assert.equal(run({ 'x-erp-user': 'mallory' }).status, 403);
    assert.deepEqual(run({ 'x-erp-user': 'alice' }), {
      status: null,
      body: null,
      next: true,
      operator: 'alice',
    });
  } finally {
    process.env = original;
  }
});
