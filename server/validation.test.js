import assert from 'node:assert/strict';
import test from 'node:test';
import { isSupportedKey, toSqlLikePrefix } from './validation.js';

test('accepts a Key prefix with at least four characters after its type prefix', () => {
  assert.equal(isSupportedKey('pk-1234'), true);
  assert.equal(isSupportedKey('key-ab_cd'), true);
  assert.equal(isSupportedKey('pk-123'), false);
  assert.equal(isSupportedKey('key-'), false);
});

test('builds a literal SQL LIKE prefix without treating underscores as wildcards', () => {
  assert.equal(toSqlLikePrefix('pk-ab_cd'), 'pk-ab=_cd%');
  assert.equal(toSqlLikePrefix('key-a=b%'), 'key-a==b=%%');
});
