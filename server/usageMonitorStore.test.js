import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  readUsageMonitorCache,
  resolveUsageMonitorCacheFile,
  writeUsageMonitorCache,
} from './usageMonitorStore.js';

const payload = {
  keys: [{ keyId: 'key-test' }],
  pins: [],
  policy: { observationDays: 14 },
};

test('resolves default and configured cache paths inside the app directory', () => {
  assert.equal(
    resolveUsageMonitorCacheFile('/tmp/app'),
    path.join('/tmp/app', '.data', 'usage-monitor-cache.json'),
  );
  assert.equal(
    resolveUsageMonitorCacheFile('/tmp/app', 'var/cache.json'),
    path.join('/tmp/app', 'var', 'cache.json'),
  );
});

test('writes and reads a valid usage monitor cache atomically', async (context) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'usage-monitor-cache-'));
  context.after(() => fs.rm(directory, { recursive: true, force: true }));
  const filePath = path.join(directory, 'nested', 'cache.json');

  const savedAt = await writeUsageMonitorCache(filePath, payload);
  const cached = await readUsageMonitorCache(filePath);

  assert.deepEqual(cached.value, payload);
  assert.equal(cached.savedAt, savedAt);
  const stat = await fs.stat(filePath);
  assert.equal(stat.mode & 0o777, 0o600);
});

test('returns null for missing, malformed, or unsupported cache records', async (context) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'usage-monitor-cache-invalid-'));
  context.after(() => fs.rm(directory, { recursive: true, force: true }));
  const missing = path.join(directory, 'missing.json');
  const malformed = path.join(directory, 'malformed.json');
  const unsupported = path.join(directory, 'unsupported.json');

  await fs.writeFile(malformed, '{');
  await fs.writeFile(unsupported, JSON.stringify({ version: 3, savedAt: new Date().toISOString(), value: payload }));

  assert.equal(await readUsageMonitorCache(missing), null);
  assert.equal(await readUsageMonitorCache(malformed), null);
  assert.equal(await readUsageMonitorCache(unsupported), null);
});
