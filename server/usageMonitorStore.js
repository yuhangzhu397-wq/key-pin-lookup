import fs from 'node:fs/promises';
import path from 'node:path';

const CACHE_VERSION = 2;

function isUsageMonitorPayload(value) {
  return value
    && typeof value === 'object'
    && Array.isArray(value.keys)
    && Array.isArray(value.pins)
    && value.policy
    && typeof value.policy === 'object';
}

export function resolveUsageMonitorCacheFile(appDir, configuredPath = '') {
  if (!configuredPath) return path.join(appDir, '.data', 'usage-monitor-cache.json');
  return path.isAbsolute(configuredPath)
    ? configuredPath
    : path.resolve(appDir, configuredPath);
}

export async function readUsageMonitorCache(filePath) {
  try {
    const content = await fs.readFile(filePath, 'utf8');
    const record = JSON.parse(content);
    const savedAt = Date.parse(record.savedAt);

    if (record.version !== CACHE_VERSION || !Number.isFinite(savedAt) || !isUsageMonitorPayload(record.value)) {
      return null;
    }

    return { savedAt, value: record.value };
  } catch (error) {
    if (error.code === 'ENOENT' || error instanceof SyntaxError) return null;
    throw error;
  }
}

export async function writeUsageMonitorCache(filePath, value) {
  if (!isUsageMonitorPayload(value)) {
    throw new TypeError('Invalid usage monitor payload.');
  }

  const directory = path.dirname(filePath);
  const temporaryFile = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  const record = {
    version: CACHE_VERSION,
    savedAt: new Date().toISOString(),
    value,
  };

  await fs.mkdir(directory, { recursive: true });
  try {
    await fs.writeFile(temporaryFile, JSON.stringify(record), { encoding: 'utf8', mode: 0o600 });
    await fs.rename(temporaryFile, filePath);
  } catch (error) {
    await fs.rm(temporaryFile, { force: true }).catch(() => {});
    throw error;
  }

  return Date.parse(record.savedAt);
}
