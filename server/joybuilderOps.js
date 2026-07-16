import { columnForKey, isSupportedKey, toSqlLikePrefix } from './validation.js';

let cachedDbConfigId;

function configured(name, fallback = '') {
  return (process.env[name] || fallback).trim();
}

function opsError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function getApiBase() {
  const value = configured('OPS_API_BASE', 'http://joybuilder-ops.jdcloud.com/api/v1');
  let url;

  try {
    url = new URL(value);
  } catch {
    throw opsError('OPS_NOT_CONFIGURED', 'JoyBuilder Ops API 地址无效。');
  }

  if (!['http:', 'https:'].includes(url.protocol)) {
    throw opsError('OPS_NOT_CONFIGURED', 'JoyBuilder Ops API 仅支持 HTTP 或 HTTPS。');
  }

  return value.replace(/\/$/, '');
}

function getAccessToken() {
  const token = configured('OPS_ACCESS_TOKEN');
  if (!token) {
    throw opsError('OPS_NOT_CONFIGURED', '查询服务尚未配置 JoyBuilder Ops 访问 Token。');
  }
  return token;
}

async function requestOps(path, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);

  try {
    const response = await fetch(`${getApiBase()}${path}`, {
      ...options,
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'X-Access-Token': getAccessToken(),
        ...options.headers,
      },
      signal: controller.signal,
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        throw opsError('OPS_AUTH_FAILED', 'JoyBuilder Ops Token 无效或没有查询权限。');
      }
      throw opsError('OPS_REQUEST_FAILED', payload.message || 'JoyBuilder Ops 查询失败。');
    }

    return payload;
  } catch (error) {
    if (error.name === 'AbortError') {
      throw opsError('OPS_REQUEST_FAILED', 'JoyBuilder Ops 查询超时。');
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function asArray(payload) {
  const data = payload?.data ?? payload;
  if (Array.isArray(data)) return data;
  return data?.configs || data?.items || data?.list || data?.dbConfigs || [];
}

async function resolveDbConfigId() {
  const explicitId = configured('OPS_DB_CONFIG_ID');
  if (explicitId) {
    const numericId = Number(explicitId);
    if (!Number.isInteger(numericId) || numericId <= 0) {
      throw opsError('OPS_NOT_CONFIGURED', 'OPS_DB_CONFIG_ID 必须是正整数。');
    }
    return numericId;
  }
  if (cachedDbConfigId) return cachedDbConfigId;

  const configName = configured('OPS_DB_CONFIG_NAME', '国内');
  const payload = await requestOps('/db-configs', { method: 'GET' });
  const matches = asArray(payload).filter((item) => String(item?.name || '') === configName);

  if (matches.length === 0) {
    throw opsError('OPS_DB_CONFIG_NOT_FOUND', `没有找到名为“${configName}”的数据库连接。`);
  }

  if (matches.length > 1) {
    throw opsError('OPS_DB_CONFIG_AMBIGUOUS', `存在多个名为“${configName}”的数据库连接，请配置 OPS_DB_CONFIG_ID。`);
  }

  cachedDbConfigId = Number(matches[0].id);
  if (!Number.isInteger(cachedDbConfigId) || cachedDbConfigId <= 0) {
    throw opsError('OPS_RESPONSE_INVALID', 'JoyBuilder Ops 返回了无效的数据库连接 ID。');
  }
  return cachedDbConfigId;
}

function safeTableName() {
  const table = configured('OPS_TABLE', 'api_key');
  if (!/^[a-zA-Z0-9_]+$/.test(table)) {
    throw opsError('OPS_NOT_CONFIGURED', 'OPS_TABLE 配置无效。');
  }
  return table;
}

function valueFromRow(row, columns, column) {
  if (Array.isArray(row)) return row[columns.indexOf(column)];
  return row?.[column];
}

export async function lookupPinViaJoyBuilderOps(key) {
  if (!isSupportedKey(key)) {
    throw opsError('INVALID_KEY', 'API Key 或 Key ID 格式无效。');
  }

  const dbConfigId = await resolveDbConfigId();
  const database = configured('OPS_DATABASE', 'maas');
  const table = safeTableName();
  const column = columnForKey(key);
  const prefix = toSqlLikePrefix(key).replaceAll("'", "''");
  const sql = `SELECT user_id, api_key_id FROM \`${table}\` WHERE \`${column}\` LIKE '${prefix}' ESCAPE '=' LIMIT 2`;

  const payload = await requestOps('/query/execute', {
    method: 'POST',
    body: JSON.stringify({
      dbConfigId,
      database,
      sql,
      page: 1,
      pageSize: 2,
    }),
  });

  const data = payload?.data ?? payload;
  const columns = Array.isArray(data?.columns) ? data.columns : [];
  const rows = Array.isArray(data?.rows) ? data.rows : [];

  if (rows.length === 0) return null;
  if (rows.length > 1) throw opsError('AMBIGUOUS_MAPPING', '当前前缀匹配到多个 Key。');

  const pin = valueFromRow(rows[0], columns, 'user_id');
  const keyId = valueFromRow(rows[0], columns, 'api_key_id');
  if (pin === undefined || pin === null || pin === '') {
    throw opsError('OPS_RESPONSE_INVALID', 'JoyBuilder Ops 返回结果中缺少 user_id。');
  }

  return {
    pin: String(pin),
    keyId: keyId === undefined || keyId === null ? null : String(keyId),
  };
}
