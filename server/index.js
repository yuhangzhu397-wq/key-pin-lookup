import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import { accessControl } from './auth.js';
import { lookupPin } from './db.js';
import { isSupportedKey } from './validation.js';

const app = express();
const port = Number(process.env.PORT || 8080);
const currentDir = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.resolve(currentDir, '..');
const distDir = path.resolve(currentDir, '../dist');

if (process.env.TRUST_PROXY === 'true') {
  app.set('trust proxy', 1);
}

app.disable('x-powered-by');
app.use(helmet());
app.use(express.json({ limit: '4kb', strict: true }));

app.get('/healthz', (_request, response) => {
  response.set('Cache-Control', 'no-store');
  response.json({ status: 'ok' });
});

app.use(accessControl);

app.use('/api/lookup', rateLimit({
  windowMs: 60_000,
  limit: 30,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { message: '查询过于频繁，请稍后重试。' },
}));

app.post('/api/lookup', async (request, response) => {
  response.set('Cache-Control', 'no-store');
  response.set('Pragma', 'no-cache');

  const key = typeof request.body?.key === 'string' ? request.body.key.trim() : '';
  if (!isSupportedKey(key)) {
    response.status(400).json({ message: '请输入 pk- 或 key- 开头，且总长度至少为 7 位的 Key 或 Key ID。' });
    return;
  }

  try {
    const result = await lookupPin(key);
    if (!result) {
      if (process.env.AUDIT_LOG === 'true') {
        console.info('lookup_audit', {
          operator: request.operator,
          keyType: key.startsWith('key-') ? 'key_id' : 'api_key',
          keySuffix: key.slice(-4),
          outcome: 'not_found',
        });
      }
      response.status(404).json({ message: '没有查询到对应 PIN。' });
      return;
    }

    if (process.env.AUDIT_LOG === 'true') {
      console.info('lookup_audit', {
        operator: request.operator,
        keyType: key.startsWith('key-') ? 'key_id' : 'api_key',
        keySuffix: key.slice(-4),
        outcome: 'found',
      });
    }
    response.json(result);
  } catch (error) {
    if (error.code === 'AMBIGUOUS_MAPPING') {
      response.status(409).json({ message: '当前前缀匹配到多个 Key，请继续输入更多字符。' });
      return;
    }

    if (error.code === 'DB_NOT_CONFIGURED') {
      response.status(503).json({ message: '查询服务尚未完成数据库配置。' });
      return;
    }

    if (error.code === 'OPS_NOT_CONFIGURED') {
      response.status(503).json({ message: error.message });
      return;
    }

    if (error.code === 'OPS_AUTH_FAILED') {
      response.status(502).json({ message: 'JoyBuilder Ops Token 无效或没有查询权限。' });
      return;
    }

    if (error.code?.startsWith('OPS_')) {
      response.status(502).json({ message: error.message || 'JoyBuilder Ops 查询失败。' });
      return;
    }

    console.error('lookup_failed', { code: error.code || 'UNKNOWN' });
    response.status(500).json({ message: '查询服务暂时不可用。' });
  }
});

app.all(['/api/model-tpm', '/api/quotas', '/api/usage-monitor'], (_request, response) => {
  response.set('Cache-Control', 'no-store');
  response.status(503).json({ message: '该功能已暂时停用，目前仅开放 Key 归属查询。' });
});

app.use(express.static(distDir, {
  etag: true,
  maxAge: '1h',
  index: false,
}));

app.use((request, response, next) => {
  if (request.method !== 'GET' || !request.accepts('html')) {
    next();
    return;
  }

  response.sendFile(path.join(distDir, 'index.html'));
});

app.listen(port, '0.0.0.0', () => {
  console.log(`Key PIN lookup listening on http://0.0.0.0:${port}`);
});
