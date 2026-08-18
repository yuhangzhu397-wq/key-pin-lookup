import { columnForKey, isSupportedKey, toSqlLikePrefix } from './validation.js';
import { buildQuotaCatalog } from './quotaCatalog.js';
import { buildUsageMonitor, monitoringDays } from './usageMonitor.js';

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
  const fallback = 'http://joybuilder-ops.jdcloud.com/api/v1';
  const preferred = configured('JOYBUILDER_OPS_API_BASE');
  const legacy = configured('OPS_API_BASE');
  const value = preferred || (/^https?:\/\//i.test(legacy) ? legacy : fallback);
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
  const { timeoutMs = 15_000, ...fetchOptions } = options;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(`${getApiBase()}${path}`, {
      ...fetchOptions,
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'X-Access-Token': getAccessToken(),
        ...fetchOptions.headers,
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

function isRetryableQueryError(error) {
  return error?.code === 'OPS_REQUEST_FAILED'
    && /invalid connection|failed to execute count query|too many concurrent queries/i.test(error.message || '');
}

async function requestQueryWithRetry(options) {
  let lastError;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await requestOps('/query/execute', options);
    } catch (error) {
      lastError = error;
      if (!isRetryableQueryError(error) || attempt === 2) throw error;
      await new Promise((resolve) => setTimeout(resolve, 600 * (attempt + 1)));
    }
  }
  throw lastError;
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

function rowsFromPayload(payload) {
  const data = payload?.data ?? payload;
  const columns = Array.isArray(data?.columns) ? data.columns : [];
  const rows = Array.isArray(data?.rows) ? data.rows : [];

  return rows.map((row) => Object.fromEntries(
    columns.map((column) => [column, valueFromRow(row, columns, column)]),
  ));
}

async function executeQuery(sql, pageSize = 500, timeoutMs = 15_000) {
  const dbConfigId = await resolveDbConfigId();
  const database = configured('OPS_DATABASE', 'maas');

  return requestQueryWithRetry({
    method: 'POST',
    timeoutMs,
    body: JSON.stringify({
      dbConfigId,
      database,
      sql,
      page: 1,
      pageSize,
    }),
  });
}

async function executeRowsPaged(sql, maxRows = 5_000, timeoutMs = 30_000) {
  return (await executeRowsPagedWithMeta(sql, maxRows, timeoutMs)).rows;
}

async function executeRowsPagedWithMeta(sql, maxRows = 5_000, timeoutMs = 30_000) {
  const dbConfigId = await resolveDbConfigId();
  const database = configured('OPS_DATABASE', 'maas');
  const pageSize = 1_000;
  const rows = [];
  let reportedTotal = 0;
  let lastBatchSize = 0;

  for (let page = 1; rows.length < maxRows; page += 1) {
    const payload = await requestQueryWithRetry({
      method: 'POST',
      timeoutMs,
      body: JSON.stringify({ dbConfigId, database, sql, page, pageSize }),
    });
    const batch = rowsFromPayload(payload);
    rows.push(...batch);
    const total = Number(payload?.data?.total ?? payload?.total ?? 0);
    reportedTotal = Math.max(reportedTotal, total);
    lastBatchSize = batch.length;
    if (batch.length < pageSize || (total > 0 && rows.length >= total)) break;
  }

  return {
    rows: rows.slice(0, maxRows),
    total: reportedTotal || rows.length,
    truncated: reportedTotal > maxRows || (rows.length >= maxRows && lastBatchSize === pageSize),
  };
}

export async function lookupPinViaJoyBuilderOps(key) {
  if (!isSupportedKey(key)) {
    throw opsError('INVALID_KEY', 'API Key 或 Key ID 格式无效。');
  }

  const table = safeTableName();
  const column = columnForKey(key);
  const prefix = toSqlLikePrefix(key).replaceAll("'", "''");
  const sql = `SELECT user_id, api_key_id, api_key, key_type, app_id, description, erp FROM \`${table}\` WHERE \`${column}\` LIKE '${prefix}' ESCAPE '=' LIMIT 2`;

  const payload = await executeQuery(sql, 2);

  const data = payload?.data ?? payload;
  const columns = Array.isArray(data?.columns) ? data.columns : [];
  const rows = Array.isArray(data?.rows) ? data.rows : [];

  if (rows.length === 0) return null;
  if (rows.length > 1) throw opsError('AMBIGUOUS_MAPPING', '当前前缀匹配到多个 Key。');

  const pin = valueFromRow(rows[0], columns, 'user_id');
  const keyId = valueFromRow(rows[0], columns, 'api_key_id');
  const apiKey = valueFromRow(rows[0], columns, 'api_key');
  const keyType = valueFromRow(rows[0], columns, 'key_type');
  const appId = valueFromRow(rows[0], columns, 'app_id');
  const description = valueFromRow(rows[0], columns, 'description');
  const erp = valueFromRow(rows[0], columns, 'erp');
  if (pin === undefined || pin === null || pin === '') {
    throw opsError('OPS_RESPONSE_INVALID', 'JoyBuilder Ops 返回结果中缺少 user_id。');
  }
  if (apiKey === undefined || apiKey === null || apiKey === '') {
    throw opsError('OPS_RESPONSE_INVALID', 'JoyBuilder Ops 返回结果中缺少完整 api_key。');
  }

  return {
    pin: String(pin),
    keyId: keyId === undefined || keyId === null ? null : String(keyId),
    apiKey: String(apiKey),
    keyType: keyType === undefined || keyType === null ? null : String(keyType),
    appId: appId === undefined || appId === null ? null : String(appId),
    description: description === undefined || description === null ? null : String(description),
    erp: erp === undefined || erp === null ? null : String(erp),
  };
}

export async function fetchModelTpmViaJoyBuilderOps() {
  const sql = `SELECT
    ms.service_id,
    ms.service_name,
    ms.model,
    CAST(ms.tpm AS UNSIGNED) AS total_tpm,
    COALESCE(usage_60s.used_tpm, 0) AS used_tpm,
    COALESCE(usage_60s.request_count, 0) AS request_count,
    ROUND(100 * COALESCE(usage_60s.used_tpm, 0) / NULLIF(ms.tpm, 0), 2) AS water_percent,
    DATE_FORMAT(NOW(), '%Y-%m-%d %H:%i:%s') AS measured_at
  FROM model_service ms
  LEFT JOIN (
    SELECT
      service_id,
      SUM(COALESCE(prompt_tokens, 0) + COALESCE(completion_tokens, 0)) AS used_tpm,
      COUNT(*) AS request_count
    FROM record
    WHERE create_time >= NOW() - INTERVAL 60 SECOND
    GROUP BY service_id
  ) usage_60s ON usage_60s.service_id = ms.service_id
  WHERE ms.status = 1 AND ms.tpm > 0
  ORDER BY used_tpm DESC, ms.model ASC
  LIMIT 500`;

  const rows = rowsFromPayload(await executeQuery(sql));
  return rows.map((row) => ({
    serviceId: String(row.service_id || ''),
    serviceName: String(row.service_name || ''),
    model: String(row.model || row.service_name || row.service_id || ''),
    totalTpm: Number(row.total_tpm || 0),
    usedTpm: Number(row.used_tpm || 0),
    requestCount: Number(row.request_count || 0),
    waterPercent: Number(row.water_percent || 0),
    measuredAt: String(row.measured_at || ''),
  }));
}

export async function fetchQuotaCatalogViaJoyBuilderOps() {
  const sql = `SELECT
    ms.service_id,
    ms.service_name,
    ms.model,
    CAST(ms.tpm AS UNSIGNED) AS platform_tpm,
    CAST(ms.rpm AS UNSIGNED) AS platform_rpm,
    COALESCE(NULLIF(LOWER(TRIM(se.vendor)), ''), '未标注供应商') AS supplier,
    COUNT(se.id) AS endpoint_count,
    SUM(COALESCE(se.tpm, 0)) AS total_tpm,
    SUM(COALESCE(se.rpm, 0)) AS total_rpm,
    SUM(COALESCE(se.rps, 0)) AS total_rps
  FROM model_service ms
  LEFT JOIN service_endpoints se
    ON se.service_id = ms.service_id
    AND se.status = 1
    AND COALESCE(se.is_offline, 0) = 0
  WHERE ms.status = 1
  GROUP BY
    ms.service_id,
    ms.service_name,
    ms.model,
    ms.tpm,
    ms.rpm,
    COALESCE(NULLIF(LOWER(TRIM(se.vendor)), ''), '未标注供应商')
  ORDER BY ms.service_id, total_tpm DESC`;

  return buildQuotaCatalog(rowsFromPayload(await executeQuery(sql, 2_000)));
}

export function usageSql(scope, days) {
  const identity = scope === 'key'
    ? 'minute_usage.api_key_id'
    : 'minute_usage.user_id';
  const keyColumn = scope === 'key' ? 'base.api_key_id,' : "NULL AS api_key_id,";
  const keyMetaColumns = scope === 'key'
    ? ", MAX(COALESCE(key_meta.key_type, '')) AS key_type, MAX(COALESCE(key_meta.erp, '')) AS erp"
    : '';
  const keyMetaJoin = scope === 'key'
    ? `LEFT JOIN (
      SELECT api_key_id, MAX(key_type) AS key_type, MAX(erp) AS erp
      FROM api_key
      GROUP BY api_key_id
    ) key_meta ON key_meta.api_key_id = base.api_key_id`
    : '';
  const minuteUsageSql = scope === 'key'
    ? `SELECT
        COALESCE(NULLIF(raw_usage.user_id, ''), key_map.user_id) AS user_id,
        COALESCE(NULLIF(raw_usage.api_key_id, ''), key_map.api_key_id) AS api_key_id,
        raw_usage.service_id,
        raw_usage.minute_at,
        raw_usage.used_tpm,
        raw_usage.used_rpm,
        raw_usage.last_used_at
      FROM (
        SELECT
          r.user AS user_id,
          r.api_key_id,
          r.api_key,
          r.service_id,
          DATE_FORMAT(r.create_time, '%Y-%m-%d %H:%i:00') AS minute_at,
          SUM(COALESCE(r.prompt_tokens, 0) + COALESCE(r.completion_tokens, 0)) AS used_tpm,
          COUNT(*) AS used_rpm,
          MAX(r.create_time) AS last_used_at
        FROM record r
        WHERE r.create_time >= NOW() - INTERVAL ${days} DAY
          AND r.service_id IS NOT NULL
          AND r.api_key IS NOT NULL
          AND r.api_key <> ''
        GROUP BY r.user, r.api_key_id, r.api_key, r.service_id, minute_at
      ) raw_usage
      LEFT JOIN api_key key_map ON key_map.api_key = raw_usage.api_key
      WHERE COALESCE(NULLIF(raw_usage.api_key_id, ''), key_map.api_key_id) IS NOT NULL`
    : `SELECT
        r.user AS user_id,
        NULL AS api_key_id,
        r.service_id,
        DATE_FORMAT(r.create_time, '%Y-%m-%d %H:%i:00') AS minute_at,
        SUM(COALESCE(r.prompt_tokens, 0) + COALESCE(r.completion_tokens, 0)) AS used_tpm,
        COUNT(*) AS used_rpm,
        MAX(r.create_time) AS last_used_at
      FROM record r
      WHERE r.create_time >= NOW() - INTERVAL ${days} DAY
        AND r.service_id IS NOT NULL
        AND r.user IS NOT NULL
        AND r.user <> ''
      GROUP BY r.user, r.service_id, minute_at`;
  const pinLimitUnion = scope === 'pin'
    ? `

    UNION ALL

    SELECT
      limits.user_id,
      NULL AS api_key_id,
      limits.service_id,
      CAST(limits.tpm AS UNSIGNED) AS limit_tpm,
      CAST(limits.rpm AS UNSIGNED) AS limit_rpm,
      0 AS peak_tpm,
      0 AS peak_rpm,
      0 AS request_count,
      0 AS active_days,
      NULL AS last_used_at
    FROM user_rate_limit limits
    WHERE limits.status = 1`
    : '';

  return `SELECT
    base.user_id,
    ${keyColumn}
    base.service_id,
    ms.service_name,
    ms.model,
    MAX(base.limit_tpm) AS limit_tpm,
    MAX(base.limit_rpm) AS limit_rpm,
    MAX(base.peak_tpm) AS peak_tpm,
    MAX(base.peak_rpm) AS peak_rpm,
    MAX(base.request_count) AS request_count,
    MAX(base.active_days) AS active_days,
    MAX(base.last_used_at) AS last_used_at${keyMetaColumns}
  FROM (
    SELECT
      minute_usage.user_id,
      minute_usage.api_key_id,
      minute_usage.service_id,
      0 AS limit_tpm,
      0 AS limit_rpm,
      MAX(minute_usage.used_tpm) AS peak_tpm,
      MAX(minute_usage.used_rpm) AS peak_rpm,
      SUM(minute_usage.used_rpm) AS request_count,
      COUNT(DISTINCT DATE(minute_usage.minute_at)) AS active_days,
      MAX(minute_usage.last_used_at) AS last_used_at
    FROM (${minuteUsageSql}) minute_usage
    GROUP BY minute_usage.user_id, ${identity}, minute_usage.service_id

    ${pinLimitUnion}
  ) base
  LEFT JOIN model_service ms ON ms.service_id = base.service_id
  ${keyMetaJoin}
  GROUP BY base.user_id, ${scope === 'key' ? 'base.api_key_id,' : ''} base.service_id, ms.service_name, ms.model
  ORDER BY MAX(base.limit_tpm) DESC, MAX(base.peak_tpm) DESC`;
}

export async function fetchUsageMonitorViaJoyBuilderOps() {
  const days = monitoringDays();
  const configuredMaxRows = Number(process.env.USAGE_MONITOR_MAX_ROWS || 5_000);
  const maxRows = Number.isInteger(configuredMaxRows) && configuredMaxRows >= 5_000 && configuredMaxRows <= 100_000
    ? configuredMaxRows
    : 5_000;
  const fetchRows = maxRows + 1;
  const pinLimitSql = `SELECT
    limits.user_id,
    NULL AS api_key_id,
    limits.service_id,
    CAST(limits.tpm AS UNSIGNED) AS limit_tpm,
    CAST(limits.rpm AS UNSIGNED) AS limit_rpm,
    0 AS peak_tpm,
    0 AS peak_rpm,
    0 AS request_count,
    0 AS active_days,
    NULL AS last_used_at
  FROM user_rate_limit limits
  WHERE limits.status = 1
  ORDER BY limits.tpm DESC
  LIMIT ${fetchRows}`;

  // JoyBuilder Ops limits concurrent SQL jobs per token, so keep these sequential.
  const capResult = (result) => ({
    ...result,
    rows: result.rows.slice(0, maxRows),
    truncated: result.truncated || result.rows.length > maxRows,
  });

  const dailyUsageResults = [];
  for (let dayOffset = 0; dayOffset < days; dayOffset += 1) {
    const olderBoundary = dayOffset + 1;
    const newerBoundary = dayOffset;
    const dailyUsageSql = `SELECT
      keys_table.api_key_id,
      MAX(keys_table.user_id) AS user_id,
      MAX(keys_table.key_type) AS key_type,
      MAX(keys_table.erp) AS erp,
      minute_usage.service_id,
      MAX(minute_usage.used_tpm) AS peak_tpm,
      MAX(minute_usage.used_rpm) AS peak_rpm,
      SUM(minute_usage.used_rpm) AS request_count,
      1 AS active_days,
      MAX(minute_usage.last_used_at) AS last_used_at
    FROM (
      SELECT
        r.api_key,
        r.service_id,
        DATE_FORMAT(r.create_time, '%Y-%m-%d %H:%i:00') AS minute_at,
        SUM(COALESCE(r.prompt_tokens, 0) + COALESCE(r.completion_tokens, 0)) AS used_tpm,
        COUNT(*) AS used_rpm,
        MAX(r.create_time) AS last_used_at
      FROM record r
      WHERE r.create_time >= NOW() - INTERVAL ${olderBoundary} DAY
        AND r.create_time < NOW() - INTERVAL ${newerBoundary} DAY
        AND r.api_key IS NOT NULL AND r.api_key <> ''
        AND r.service_id IS NOT NULL
      GROUP BY r.api_key, r.service_id, minute_at
    ) minute_usage
    INNER JOIN api_key keys_table ON keys_table.api_key = minute_usage.api_key
    WHERE keys_table.api_key_id IS NOT NULL
    GROUP BY keys_table.api_key_id, minute_usage.service_id
    ORDER BY request_count DESC
    LIMIT ${fetchRows}`;
    dailyUsageResults.push(capResult(
      await executeRowsPagedWithMeta(dailyUsageSql, fetchRows, 90_000),
    ));
  }

  const keyUsageResult = mergeDailyUsageResults(dailyUsageResults, maxRows);
  const pinResult = capResult(await executeRowsPagedWithMeta(pinLimitSql, fetchRows, 90_000));
  const keyUsage = keyUsageResult.rows;
  const pinRows = pinResult.rows;
  const keyRows = keyUsage
    .filter((row) => row.api_key_id)
    .map((row) => ({ ...row, limit_tpm: 0, limit_rpm: 0 }));
  const serviceIds = [...new Set([...keyRows, ...pinRows].map((row) => String(row.service_id || '')).filter(Boolean))];
  if (serviceIds.length) {
    const quoted = serviceIds.map((id) => `'${id.replaceAll("'", "''")}'`).join(',');
    const services = await executeRowsPaged(`SELECT service_id, service_name, model FROM model_service WHERE service_id IN (${quoted})`, 5_000);
    const serviceMap = new Map(services.map((row) => [String(row.service_id), row]));
    for (const row of [...keyRows, ...pinRows]) Object.assign(row, serviceMap.get(String(row.service_id)) || {});
  }

  const sources = {
    keyUsage: keyUsageResult,
    pinRows: pinResult,
  };
  const truncatedSources = Object.entries(sources)
    .filter(([, result]) => result.truncated)
    .map(([name]) => name);

  return buildUsageMonitor(keyRows, pinRows, days, {
    complete: truncatedSources.length === 0,
    maxRows,
    usageSlices: days,
    keyLimitQueryDisabled: true,
    truncatedSources,
    sourceCounts: Object.fromEntries(Object.entries(sources).map(([name, result]) => [name, result.rows.length])),
  });
}

export function mergeDailyUsageResults(results, maxRows = 5_000) {
  const merged = new Map();

  for (const result of results) {
    for (const row of result.rows) {
      const id = `${row.api_key_id}\u0000${row.service_id}`;
      const current = merged.get(id);
      if (!current) {
        merged.set(id, { ...row });
        continue;
      }

      current.peak_tpm = Math.max(Number(current.peak_tpm) || 0, Number(row.peak_tpm) || 0);
      current.peak_rpm = Math.max(Number(current.peak_rpm) || 0, Number(row.peak_rpm) || 0);
      current.request_count = (Number(current.request_count) || 0) + (Number(row.request_count) || 0);
      current.active_days = (Number(current.active_days) || 0) + (Number(row.active_days) || 0);
      if (row.last_used_at && (!current.last_used_at || String(row.last_used_at) > String(current.last_used_at))) {
        current.last_used_at = row.last_used_at;
      }
      if (row.user_id) current.user_id = row.user_id;
      if (row.key_type) current.key_type = row.key_type;
      if (row.erp) current.erp = row.erp;
    }
  }

  const rows = [...merged.values()]
    .sort((left, right) => (Number(right.request_count) || 0) - (Number(left.request_count) || 0));

  return {
    rows: rows.slice(0, maxRows),
    total: rows.length,
    truncated: results.some((result) => result.truncated) || rows.length > maxRows,
  };
}
