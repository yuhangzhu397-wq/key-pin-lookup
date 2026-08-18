import assert from 'node:assert/strict';
import http from 'node:http';
import test from 'node:test';
import {
  fetchQuotaCatalogViaJoyBuilderOps,
  fetchUsageMonitorViaJoyBuilderOps,
  lookupPinViaJoyBuilderOps,
  mergeDailyUsageResults,
  usageSql,
} from './joybuilderOps.js';

test('uses JoyBuilder Ops token and resolves a Key ID to PIN', async () => {
  const requests = [];
  const server = http.createServer((request, response) => {
    let body = '';
    request.on('data', (chunk) => {
      body += chunk;
    });
    request.on('end', () => {
      requests.push({
        url: request.url,
        method: request.method,
        token: request.headers['x-access-token'],
        body: body ? JSON.parse(body) : null,
      });

      response.setHeader('Content-Type', 'application/json');
      if (request.url === '/api/v1/db-configs') {
        response.end(JSON.stringify({ data: { configs: [{ id: 42, name: '国内' }] } }));
        return;
      }

      response.end(JSON.stringify({
        data: {
          columns: ['user_id', 'api_key_id', 'api_key', 'key_type', 'app_id', 'description', 'erp'],
          rows: [['ZJPT888', 'key-demo-zjpt888', 'pk-demo-zjpt888', 'autoBind', 'app-demo', '演示 Key', 'demo.user']],
          total: 1,
        },
      }));
    });
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const previous = { ...process.env };

  try {
    process.env.JOYBUILDER_OPS_API_BASE = `http://127.0.0.1:${address.port}/api/v1`;
    process.env.OPS_ACCESS_TOKEN = 'test-token';
    process.env.OPS_DB_CONFIG_NAME = '国内';
    process.env.OPS_DATABASE = 'maas';
    process.env.OPS_TABLE = 'api_key';
    delete process.env.OPS_DB_CONFIG_ID;

    const result = await lookupPinViaJoyBuilderOps('key-demo-zjpt888');
    const apiKeyResult = await lookupPinViaJoyBuilderOps('pk-demo-zjpt888');

    const expected = {
      pin: 'ZJPT888',
      keyId: 'key-demo-zjpt888',
      apiKey: 'pk-demo-zjpt888',
      keyType: 'autoBind',
      appId: 'app-demo',
      description: '演示 Key',
      erp: 'demo.user',
    };
    assert.deepEqual(result, expected);
    assert.deepEqual(apiKeyResult, expected);
    assert.equal(requests.length, 3);
    assert.equal(requests[0].url, '/api/v1/db-configs');
    assert.equal(requests[1].url, '/api/v1/query/execute');
    assert.equal(requests[1].token, 'test-token');
    assert.deepEqual(requests[1].body, {
      dbConfigId: 42,
      database: 'maas',
      sql: "SELECT user_id, api_key_id, api_key, key_type, app_id, description, erp FROM `api_key` WHERE `api_key_id` LIKE 'key-demo-zjpt888%' ESCAPE '=' LIMIT 2",
      page: 1,
      pageSize: 2,
    });
    assert.equal(
      requests[2].body.sql,
      "SELECT user_id, api_key_id, api_key, key_type, app_id, description, erp FROM `api_key` WHERE `api_key` LIKE 'pk-demo-zjpt888%' ESCAPE '=' LIMIT 2",
    );
  } finally {
    process.env = previous;
    await new Promise((resolve) => server.close(resolve));
  }
});

test('loads endpoint quota aggregates through JoyBuilder Ops', async () => {
  let queryBody;
  const server = http.createServer((request, response) => {
    let body = '';
    request.on('data', (chunk) => { body += chunk; });
    request.on('end', () => {
      response.setHeader('Content-Type', 'application/json');
      if (request.url === '/api/v1/db-configs') {
        response.end(JSON.stringify({ data: { configs: [{ id: 42, name: '国内' }] } }));
        return;
      }

      queryBody = JSON.parse(body);
      response.end(JSON.stringify({
        data: {
          columns: ['service_id', 'service_name', 'model', 'platform_tpm', 'platform_rpm', 'supplier', 'endpoint_count', 'total_tpm', 'total_rpm', 'total_rps'],
          rows: [['s-1', 'Model One', 'Model-1', 1000, 100, 'jcloud', 2, 800, 80, 8]],
        },
      }));
    });
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const previous = { ...process.env };

  try {
    process.env.JOYBUILDER_OPS_API_BASE = `http://127.0.0.1:${address.port}/api/v1`;
    process.env.OPS_ACCESS_TOKEN = 'test-token';
    process.env.OPS_DB_CONFIG_ID = '42';
    process.env.OPS_DATABASE = 'maas';

    const result = await fetchQuotaCatalogViaJoyBuilderOps();

    assert.equal(queryBody.pageSize, 2000);
    assert.match(queryBody.sql, /FROM model_service ms/);
    assert.match(queryBody.sql, /LEFT JOIN service_endpoints se/);
    assert.equal(result.models[0].totalTpm, 800);
    assert.equal(result.suppliers[0].supplier, 'jcloud');
  } finally {
    process.env = previous;
    await new Promise((resolve) => server.close(resolve));
  }
});

test('merges daily usage slices using peak utilization and cumulative requests', () => {
  const result = mergeDailyUsageResults([
    {
      rows: [{
        api_key_id: 'key-1',
        user_id: 'pin-1',
        service_id: 's-1',
        peak_tpm: 100,
        peak_rpm: 4,
        request_count: 12,
        active_days: 1,
        last_used_at: '2026-07-23 12:00:00',
      }],
      truncated: false,
    },
    {
      rows: [{
        api_key_id: 'key-1',
        user_id: 'pin-1',
        service_id: 's-1',
        peak_tpm: 80,
        peak_rpm: 7,
        request_count: 9,
        active_days: 1,
        last_used_at: '2026-07-24 08:00:00',
      }],
      truncated: false,
    },
  ], 5_000);

  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].peak_tpm, 100);
  assert.equal(result.rows[0].peak_rpm, 7);
  assert.equal(result.rows[0].request_count, 21);
  assert.equal(result.rows[0].active_days, 2);
  assert.equal(result.rows[0].last_used_at, '2026-07-24 08:00:00');
  assert.equal(result.truncated, false);
});

test('never queries the full key rate-limit table for key monitoring', () => {
  assert.doesNotMatch(usageSql('key', 14), /api_key_rate_limit/);
});

test('loads usage monitoring in daily slices and never returns raw API keys', async () => {
  const queryBodies = [];
  const server = http.createServer((request, response) => {
    let body = '';
    request.on('data', (chunk) => { body += chunk; });
    request.on('end', () => {
      response.setHeader('Content-Type', 'application/json');
      const queryBody = JSON.parse(body);
      queryBodies.push(queryBody);
      const sql = queryBody.sql;

      if (sql.includes('FROM record r')) {
        const olderDay = sql.includes('INTERVAL 2 DAY');
        response.end(JSON.stringify({
          data: {
            columns: ['api_key_id', 'user_id', 'key_type', 'erp', 'service_id', 'peak_tpm', 'peak_rpm', 'request_count', 'active_days', 'last_used_at'],
            rows: [[
              'key-1',
              'pin-1',
              'autoBind',
              'owner.1',
              's-1',
              olderDay ? 80 : 100,
              olderDay ? 7 : 4,
              olderDay ? 9 : 12,
              1,
              olderDay ? '2026-07-23 08:00:00' : '2026-07-24 08:00:00',
            ]],
            total: 1,
          },
        }));
        return;
      }

      if (sql.includes('FROM user_rate_limit limits')) {
        response.end(JSON.stringify({
          data: {
            columns: ['user_id', 'api_key_id', 'service_id', 'limit_tpm', 'limit_rpm', 'peak_tpm', 'peak_rpm', 'request_count', 'active_days', 'last_used_at'],
            rows: [['pin-1', null, 's-1', 5000, 500, 0, 0, 0, 0, null]],
            total: 1,
          },
        }));
        return;
      }

      response.end(JSON.stringify({
        data: {
          columns: ['service_id', 'service_name', 'model'],
          rows: [['s-1', 'Model One', 'model-1']],
          total: 1,
        },
      }));
    });
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const previous = { ...process.env };

  try {
    process.env.JOYBUILDER_OPS_API_BASE = `http://127.0.0.1:${address.port}/api/v1`;
    process.env.OPS_ACCESS_TOKEN = 'test-token';
    process.env.OPS_DB_CONFIG_ID = '42';
    process.env.OPS_DATABASE = 'maas';
    process.env.USAGE_MONITOR_DAYS = '2';
    process.env.USAGE_MONITOR_MAX_ROWS = '5000';

    const result = await fetchUsageMonitorViaJoyBuilderOps();
    const usageQueries = queryBodies.filter((body) => body.sql.includes('FROM record r'));
    const keyLimitQueries = queryBodies.filter((body) => body.sql.includes('api_key_rate_limit'));

    assert.equal(usageQueries.length, 2);
    assert.equal(keyLimitQueries.length, 0);
    assert.match(usageQueries[0].sql, /NOW\(\) - INTERVAL 1 DAY/);
    assert.match(usageQueries[1].sql, /NOW\(\) - INTERVAL 2 DAY/);
    assert.doesNotMatch(usageQueries[0].sql, /SHA2/);
    assert.equal('apiKey' in result.keys[0], false);
    assert.equal(result.keys[0].peakTpm, 100);
    assert.equal(result.keys[0].peakRpm, 7);
    assert.equal(result.keys[0].requestCount, 21);
    assert.equal(result.keys[0].limitTpm, 0);
    assert.equal(result.keys[0].limitRpm, 0);
    assert.equal(result.diagnostics.keyLimitQueryDisabled, true);
    assert.equal(result.diagnostics.usageSlices, 2);
  } finally {
    process.env = previous;
    await new Promise((resolve) => server.close(resolve));
  }
});
