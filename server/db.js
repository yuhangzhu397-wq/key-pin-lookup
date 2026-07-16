import mysql from 'mysql2/promise';
import { lookupPinViaJoyBuilderOps } from './joybuilderOps.js';
import { columnForKey } from './validation.js';

let pool;

function isMockMode() {
  return process.env.MOCK_MODE === 'true';
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
  if (key === 'key-demo-zjpt888' || key === 'pk-demo-zjpt888') {
    return {
      pin: 'ZJPT888',
      keyId: 'key-demo-zjpt888',
    };
  }
  return null;
}

async function lookupPinViaMySql(key) {

  const table = getTableName();
  const column = columnForKey(key);
  const sql = `SELECT user_id, api_key_id FROM \`${table}\` WHERE \`${column}\` = ? LIMIT 2`;
  const [rows] = await getPool().execute(sql, [key]);

  if (rows.length === 0) return null;
  if (rows.length > 1) {
    const error = new Error('Ambiguous key mapping');
    error.code = 'AMBIGUOUS_MAPPING';
    throw error;
  }

  return {
    pin: String(rows[0].user_id),
    keyId: rows[0].api_key_id ? String(rows[0].api_key_id) : null,
  };
}

export async function lookupPin(key) {
  if (isMockMode()) return mockLookup(key);

  const dataSource = (process.env.DATA_SOURCE || 'joybuilder_ops').trim().toLowerCase();
  if (dataSource === 'joybuilder_ops') return lookupPinViaJoyBuilderOps(key);
  if (dataSource === 'mysql') return lookupPinViaMySql(key);

  const error = new Error('Unsupported DATA_SOURCE');
  error.code = 'DB_NOT_CONFIGURED';
  throw error;
}
