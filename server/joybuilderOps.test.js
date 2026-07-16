import assert from 'node:assert/strict';
import http from 'node:http';
import test from 'node:test';
import { lookupPinViaJoyBuilderOps } from './joybuilderOps.js';

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
          columns: ['user_id', 'api_key_id'],
          rows: [['ZJPT888', 'key-demo-zjpt888']],
          total: 1,
        },
      }));
    });
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const previous = { ...process.env };

  try {
    process.env.OPS_API_BASE = `http://127.0.0.1:${address.port}/api/v1`;
    process.env.OPS_ACCESS_TOKEN = 'test-token';
    process.env.OPS_DB_CONFIG_NAME = '国内';
    process.env.OPS_DATABASE = 'maas';
    process.env.OPS_TABLE = 'api_key';
    delete process.env.OPS_DB_CONFIG_ID;

    const result = await lookupPinViaJoyBuilderOps('key-demo-zjpt888');
    const apiKeyResult = await lookupPinViaJoyBuilderOps('pk-demo-zjpt888');

    assert.deepEqual(result, { pin: 'ZJPT888', keyId: 'key-demo-zjpt888' });
    assert.deepEqual(apiKeyResult, { pin: 'ZJPT888', keyId: 'key-demo-zjpt888' });
    assert.equal(requests.length, 3);
    assert.equal(requests[0].url, '/api/v1/db-configs');
    assert.equal(requests[1].url, '/api/v1/query/execute');
    assert.equal(requests[1].token, 'test-token');
    assert.deepEqual(requests[1].body, {
      dbConfigId: 42,
      database: 'maas',
      sql: "SELECT user_id, api_key_id FROM `api_key` WHERE `api_key_id` LIKE 'key-demo-zjpt888%' ESCAPE '=' LIMIT 2",
      page: 1,
      pageSize: 2,
    });
    assert.equal(
      requests[2].body.sql,
      "SELECT user_id, api_key_id FROM `api_key` WHERE `api_key` LIKE 'pk-demo-zjpt888%' ESCAPE '=' LIMIT 2",
    );
  } finally {
    process.env = previous;
    await new Promise((resolve) => server.close(resolve));
  }
});
