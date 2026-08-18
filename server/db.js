import mysql from 'mysql2/promise';
import { fetchModelTpmViaJoyBuilderOps, fetchQuotaCatalogViaJoyBuilderOps, fetchUsageMonitorViaJoyBuilderOps, lookupPinViaJoyBuilderOps, usageSql } from './joybuilderOps.js';
import { columnForKey, toSqlLikePrefix } from './validation.js';
import { buildQuotaCatalog } from './quotaCatalog.js';
import { buildUsageMonitor, monitoringDays } from './usageMonitor.js';

let pool;

function isMockMode() {
  return process.env.MOCK_MODE === 'true';
}

function configuredDataSource() {
  const preferred = (process.env.JOYMAAS_DATA_SOURCE || '').trim().toLowerCase();
  if (preferred) return preferred;

  const legacy = (process.env.DATA_SOURCE || '').trim().toLowerCase();
  return ['joybuilder_ops', 'mysql'].includes(legacy) ? legacy : 'joybuilder_ops';
}

function requireConfig(name) {
  const value = process.env[name];
  if (!value) {
    const error = new Error(`Missing ${name}`);
    error.code = 'DB_NOT_CONFIGURED';
    throw error;
  }
  return value;
}

function getTableName() {
  const table = process.env.DB_TABLE || 'api_key';
  if (!/^[a-zA-Z0-9_]+$/.test(table)) {
    const error = new Error('Invalid DB_TABLE');
    error.code = 'DB_NOT_CONFIGURED';
    throw error;
  }
  return table;
}

function getPool() {
  if (pool) return pool;

  pool = mysql.createPool({
    host: requireConfig('DB_HOST'),
    port: Number(process.env.DB_PORT || 3306),
    user: requireConfig('DB_USER'),
    password: requireConfig('DB_PASSWORD'),
    database: requireConfig('DB_NAME'),
    waitForConnections: true,
    connectionLimit: 5,
    queueLimit: 20,
    enableKeepAlive: true,
    ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: true } : undefined,
  });

  return pool;
}

function mockLookup(key) {
  if ('key-demo-zjpt888'.startsWith(key) || 'pk-demo-zjpt888'.startsWith(key)) {
    return {
      pin: 'ZJPT888',
      keyId: 'key-demo-zjpt888',
      apiKey: 'pk-demo-zjpt888',
      keyType: 'autoBind',
      appId: 'app-demo',
      description: '本地演示 Key',
      erp: 'demo.user',
    };
  }
  return null;
}

async function lookupPinViaMySql(key) {
  const table = getTableName();
  const column = columnForKey(key);
  const sql = `SELECT user_id, api_key_id, api_key, key_type, app_id, description, erp FROM \`${table}\` WHERE \`${column}\` LIKE ? ESCAPE '=' LIMIT 2`;
  const [rows] = await getPool().execute(sql, [toSqlLikePrefix(key)]);

  if (rows.length === 0) return null;
  if (rows.length > 1) {
    const error = new Error('Ambiguous key mapping');
    error.code = 'AMBIGUOUS_MAPPING';
    throw error;
  }
  if (!rows[0].user_id || !rows[0].api_key) {
    const error = new Error('Lookup result is missing required credential fields');
    error.code = 'DB_RESPONSE_INVALID';
    throw error;
  }

  return {
    pin: String(rows[0].user_id),
    keyId: rows[0].api_key_id ? String(rows[0].api_key_id) : null,
    apiKey: String(rows[0].api_key),
    keyType: rows[0].key_type ? String(rows[0].key_type) : null,
    appId: rows[0].app_id ? String(rows[0].app_id) : null,
    description: rows[0].description ? String(rows[0].description) : null,
    erp: rows[0].erp ? String(rows[0].erp) : null,
  };
}

async function fetchModelTpmViaMySql() {
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
    SELECT service_id,
      SUM(COALESCE(prompt_tokens, 0) + COALESCE(completion_tokens, 0)) AS used_tpm,
      COUNT(*) AS request_count
    FROM record
    WHERE create_time >= NOW() - INTERVAL 60 SECOND
    GROUP BY service_id
  ) usage_60s ON usage_60s.service_id = ms.service_id
  WHERE ms.status = 1 AND ms.tpm > 0
  ORDER BY used_tpm DESC, ms.model ASC
  LIMIT 500`;
  const [rows] = await getPool().query(sql);

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

async function fetchQuotaCatalogViaMySql() {
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
  const [rows] = await getPool().query(sql);
  return buildQuotaCatalog(rows);
}

async function fetchUsageMonitorViaMySql() {
  const days = monitoringDays();
  const [keyRows, pinRows] = await Promise.all([
    getPool().query(usageSql('key', days)).then(([rows]) => rows),
    getPool().query(usageSql('pin', days)).then(([rows]) => rows),
  ]);
  return buildUsageMonitor(keyRows, pinRows, days);
}

export async function lookupPin(key) {
  if (isMockMode()) return mockLookup(key);

  const dataSource = configuredDataSource();
  if (dataSource === 'joybuilder_ops') return lookupPinViaJoyBuilderOps(key);
  if (dataSource === 'mysql') return lookupPinViaMySql(key);

  const error = new Error('Unsupported DATA_SOURCE');
  error.code = 'DB_NOT_CONFIGURED';
  throw error;
}

export async function fetchModelTpm() {
  if (isMockMode()) {
    return [
      { serviceId: 's-demo-1', serviceName: 'DeepSeek V3', model: 'DeepSeek-V3', totalTpm: 5_000_000, usedTpm: 3_802_000, requestCount: 233, waterPercent: 76.04, measuredAt: new Date().toISOString() },
      { serviceId: 's-demo-2', serviceName: 'DeepSeek V4', model: 'DeepSeek-V4-Flash', totalTpm: 120_000_000, usedTpm: 3_320_000, requestCount: 244, waterPercent: 2.77, measuredAt: new Date().toISOString() },
      { serviceId: 's-demo-3', serviceName: 'GPT 5', model: 'GPT-5', totalTpm: 59_000_000, usedTpm: 1_890_000, requestCount: 233, waterPercent: 3.2, measuredAt: new Date().toISOString() },
      { serviceId: 's-demo-4', serviceName: 'Qwen 3.5', model: 'Qwen3.5-397B-A17B', totalTpm: 10_000_000, usedTpm: 1_650_000, requestCount: 172, waterPercent: 16.5, measuredAt: new Date().toISOString() },
      { serviceId: 's-demo-5', serviceName: 'JoyAI 81B', model: 'JoyAI-81B-pro', totalTpm: 36_000_000, usedTpm: 1_084_000, requestCount: 176, waterPercent: 3.01, measuredAt: new Date().toISOString() },
      { serviceId: 's-demo-6', serviceName: 'Qwen 3', model: 'Qwen3-235B-A22B', totalTpm: 4_500_000, usedTpm: 684_000, requestCount: 121, waterPercent: 15.2, measuredAt: new Date().toISOString() },
      { serviceId: 's-demo-7', serviceName: 'Kimi K2.5', model: 'Kimi-K2.5', totalTpm: 50_000_000, usedTpm: 517_000, requestCount: 56, waterPercent: 1.03, measuredAt: new Date().toISOString() },
      { serviceId: 's-demo-8', serviceName: 'Doubao Vision', model: 'doubao-seed-1.6-vision', totalTpm: 5_000_000, usedTpm: 478_000, requestCount: 86, waterPercent: 9.56, measuredAt: new Date().toISOString() },
      { serviceId: 's-demo-9', serviceName: 'Kimi K2', model: 'Kimi-K2-0905', totalTpm: 12_500_000, usedTpm: 468_000, requestCount: 51, waterPercent: 3.74, measuredAt: new Date().toISOString() },
      { serviceId: 's-demo-10', serviceName: 'GLM 5', model: 'GLM-5', totalTpm: 32_500_000, usedTpm: 405_000, requestCount: 49, waterPercent: 1.25, measuredAt: new Date().toISOString() },
      { serviceId: 's-demo-11', serviceName: 'Claude Sonnet', model: 'Claude-Sonnet', totalTpm: 180_000_000, usedTpm: 362_000, requestCount: 43, waterPercent: 0.2, measuredAt: new Date().toISOString() },
      { serviceId: 's-demo-12', serviceName: 'Doubao Pro', model: 'Doubao-Seed-2.0-pro', totalTpm: 85_000_000, usedTpm: 318_000, requestCount: 37, waterPercent: 0.37, measuredAt: new Date().toISOString() },
      { serviceId: 's-demo-13', serviceName: 'Gemini Flash', model: 'Gemini-2.5-flash', totalTpm: 20_000_000, usedTpm: 276_000, requestCount: 34, waterPercent: 1.38, measuredAt: new Date().toISOString() },
      { serviceId: 's-demo-14', serviceName: 'Qwen Plus', model: 'Qwen3.5-Plus', totalTpm: 20_000_000, usedTpm: 221_000, requestCount: 29, waterPercent: 1.11, measuredAt: new Date().toISOString() },
      { serviceId: 's-demo-15', serviceName: 'Claude Opus', model: 'Claude-Opus', totalTpm: 100_000, usedTpm: 184_000, requestCount: 21, waterPercent: 184, measuredAt: new Date().toISOString() },
    ];
  }

  const dataSource = configuredDataSource();
  if (dataSource === 'joybuilder_ops') return fetchModelTpmViaJoyBuilderOps();
  if (dataSource === 'mysql') return fetchModelTpmViaMySql();

  const error = new Error('Unsupported DATA_SOURCE');
  error.code = 'DB_NOT_CONFIGURED';
  throw error;
}

export async function fetchQuotaCatalog() {
  if (isMockMode()) {
    return buildQuotaCatalog([
      { service_id: 's-demo-1', service_name: 'DeepSeek V4', model: 'DeepSeek-V4-Flash', platform_tpm: 120_000_000, platform_rpm: 8_000, supplier: 'jcloud', endpoint_count: 2, total_tpm: 80_000_000, total_rpm: 5_000, total_rps: 90 },
      { service_id: 's-demo-1', service_name: 'DeepSeek V4', model: 'DeepSeek-V4-Flash', platform_tpm: 120_000_000, platform_rpm: 8_000, supplier: 'huoshan', endpoint_count: 1, total_tpm: 44_000_000, total_rpm: 3_000, total_rps: 50 },
      { service_id: 's-demo-2', service_name: 'GLM 5', model: 'GLM-5', platform_tpm: 32_500_000, platform_rpm: 1_500, supplier: 'jcloud', endpoint_count: 1, total_tpm: 20_000_000, total_rpm: 1_500, total_rps: 25 },
    ]);
  }

  const dataSource = configuredDataSource();
  if (dataSource === 'joybuilder_ops') return fetchQuotaCatalogViaJoyBuilderOps();
  if (dataSource === 'mysql') return fetchQuotaCatalogViaMySql();

  const error = new Error('Unsupported DATA_SOURCE');
  error.code = 'DB_NOT_CONFIGURED';
  throw error;
}

export async function fetchUsageMonitor() {
  if (isMockMode()) {
    const days = monitoringDays();
    return buildUsageMonitor([
      { user_id: 'ZJPT888', api_key_id: 'key-demo-a18f', service_id: 's-demo-1', model: 'DeepSeek-V3', limit_tpm: 100000, limit_rpm: 60, peak_tpm: 3200, peak_rpm: 4, request_count: 284, active_days: 6, last_used_at: new Date().toISOString() },
      { user_id: 'ZJPT888', api_key_id: 'key-demo-b42c', service_id: 's-demo-2', model: 'GPT-5', limit_tpm: 500000, limit_rpm: 100, peak_tpm: 58000, peak_rpm: 14, request_count: 1380, active_days: 13, last_used_at: new Date().toISOString() },
      { user_id: 'JD-DEPT-07', api_key_id: 'key-demo-idle', service_id: 's-demo-3', model: 'Qwen3-235B', limit_tpm: 200000, limit_rpm: 80, peak_tpm: 0, peak_rpm: 0, request_count: 0, active_days: 0, last_used_at: null },
      { user_id: 'JD-DEPT-11', api_key_id: 'key-demo-inherit', service_id: 's-demo-1', model: 'DeepSeek-V3', limit_tpm: 0, limit_rpm: 0, peak_tpm: 9200, peak_rpm: 8, request_count: 621, active_days: 11, last_used_at: new Date().toISOString() },
      { user_id: 'JD-DEPT-11', api_key_id: 'key-demo-capacity', service_id: 's-demo-2', model: 'GPT-5', limit_tpm: 100000, limit_rpm: 100, peak_tpm: 86000, peak_rpm: 72, request_count: 2048, active_days: 14, last_used_at: new Date().toISOString() },
    ], [
      { user_id: 'ZJPT888', service_id: 's-demo-1', model: 'DeepSeek-V3', limit_tpm: 1000000, limit_rpm: 600, peak_tpm: 46000, peak_rpm: 31, request_count: 5210, active_days: 14, last_used_at: new Date().toISOString() },
      { user_id: 'JD-DEPT-07', service_id: 's-demo-3', model: 'Qwen3-235B', limit_tpm: 2000000, limit_rpm: 800, peak_tpm: 0, peak_rpm: 0, request_count: 0, active_days: 0, last_used_at: null },
    ], days);
  }

  const dataSource = configuredDataSource();
  if (dataSource === 'joybuilder_ops') return fetchUsageMonitorViaJoyBuilderOps();
  if (dataSource === 'mysql') return fetchUsageMonitorViaMySql();

  const error = new Error('Unsupported DATA_SOURCE');
  error.code = 'DB_NOT_CONFIGURED';
  throw error;
}
