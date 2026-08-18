import assert from 'node:assert/strict';
import test from 'node:test';
import { evaluateUsageRow } from './usageMonitor.js';

test('marks low peak utilization and proposes conservative lower limits', () => {
  const result = evaluateUsageRow({
    user_id: 'PIN-1', api_key_id: 'key-1', service_id: 's-1', model: 'Model 1',
    limit_tpm: 100000, limit_rpm: 100, peak_tpm: 4000, peak_rpm: 3,
    request_count: 20, active_days: 2,
  }, 'key', 14);

  assert.equal(result.level, 'critical');
  assert.equal(result.utilization, 4);
  assert.equal(result.recommendedTpm, 8000);
  assert.equal(result.recommendedRpm, 10);
});

test('does not recommend a limit when the key inherits PIN quota', () => {
  const result = evaluateUsageRow({
    user_id: 'PIN-1', api_key_id: 'key-1', service_id: 's-1',
    limit_tpm: 0, limit_rpm: 0, peak_tpm: 4000, peak_rpm: 3, request_count: 20,
  }, 'key', 14);

  assert.equal(result.level, 'unconfigured');
  assert.equal(result.recommendedTpm, null);
  assert.equal(result.recommendedRpm, null);
});

test('requires an age check instead of proposing a blind minimum for zero-usage keys', () => {
  const result = evaluateUsageRow({
    user_id: 'PIN-1', api_key_id: 'key-idle', service_id: 's-1',
    limit_tpm: 100000, limit_rpm: 100, peak_tpm: 0, peak_rpm: 0,
    request_count: 0, active_days: 0,
  }, 'key', 14);

  assert.equal(result.level, 'critical');
  assert.equal(result.confidence, 'needs-age-check');
  assert.equal(result.recommendedTpm, null);
  assert.equal(result.recommendedRpm, null);
});

test('separates near-capacity and exceeded quota risks from low-utilization alerts', () => {
  const nearCapacity = evaluateUsageRow({
    user_id: 'PIN-1', api_key_id: 'key-hot', service_id: 's-1',
    limit_tpm: 100000, limit_rpm: 100, peak_tpm: 85000, peak_rpm: 60,
    request_count: 200, active_days: 10,
  }, 'key', 14);
  const exceeded = evaluateUsageRow({
    user_id: 'PIN-1', api_key_id: 'key-over', service_id: 's-1',
    limit_tpm: 100000, limit_rpm: 100, peak_tpm: 110000, peak_rpm: 70,
    request_count: 200, active_days: 10,
  }, 'key', 14);

  assert.equal(nearCapacity.level, 'capacity');
  assert.equal(exceeded.level, 'exceeded');
  assert.equal(nearCapacity.recommendedTpm, null);
});

test('separates auto-bound member keys from PIN-owned keys', () => {
  const memberKey = evaluateUsageRow({
    user_id: 'PIN-1', api_key_id: 'key-member', key_type: 'autoBind', erp: 'member.1',
    service_id: 's-1', limit_tpm: 1000, limit_rpm: 10,
  }, 'key', 14);
  const pinOwnedKey = evaluateUsageRow({
    user_id: 'PIN-1', api_key_id: 'key-pin', key_type: '', erp: '',
    service_id: 's-1', limit_tpm: 1000, limit_rpm: 10,
  }, 'key', 14);

  assert.equal(memberKey.keyKind, 'member');
  assert.equal(memberKey.memberId, 'member.1');
  assert.equal(pinOwnedKey.keyKind, 'pin-owned');
});
