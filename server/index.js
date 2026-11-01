import http from 'node:http';
import fs from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { Auth } from './auth.js';
import { ConfigStore, ValidationError } from './config.js';
import { callService, testService, clearSession, describeError, credentialMessage } from './upstream.js';
import { publicTypes } from './types.js';
import { PushStore, LEVELS, sendPush, startWatching } from './push.js';

const gzip = promisify(zlib.gzip);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const VERSION = JSON.parse(readFileSync(path.resolve(__dirname, '..', 'package.json'), 'utf8')).version;
const PUBLIC_DIR = path.resolve(__dirname, '..', 'public');
const PORT = Number(process.env.PORT) || 8484;
const CONFIG_DIR = path.resolve(process.env.CONFIG_DIR || '/config');
const COOKIE = 'deckarr_session';

await fs.mkdir(CONFIG_DIR, { recursive: true });
const auth = new Auth(path.join(CONFIG_DIR, 'auth.json'), process.env.APP_PASSWORD);
await auth.load();
const store = new ConfigStore(path.join(CONFIG_DIR, 'config.json'));
await store.load();
const pushStore = new PushStore(path.join(CONFIG_DIR, 'push.json'));
await pushStore.load();

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
};

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'X-Frame-Options': 'DENY',
  'Content-Security-Policy': [
    "default-src 'self'",
    "img-src 'self' https: http: data: blob:",
    "style-src 'self'",
    "script-src 'self'",
    "connect-src 'self'",
    "manifest-src 'self'",
    "worker-src 'self'",
    "frame-ancestors 'none'",
    "base-uri 'none'",
    "form-action 'self'",
  ].join('; '),
};

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// ---------- response helpers ----------

async function send(req, res, status, body, headers = {}) {
  let payload = Buffer.isBuffer(body) ? body : Buffer.from(body ?? '');
  const out = { ...SECURITY_HEADERS, ...headers };
  const type = String(out['Content-Type'] || '');
  const compressible = /json|text|javascript|svg|xml/.test(type);
  if (compressible && payload.length > 1024 && /\bgzip\b/.test(req.headers['accept-encoding'] || '')) {
    payload = await gzip(payload);
    out['Content-Encoding'] = 'gzip';
    out.Vary = 'Accept-Encoding';
  }
  out['Content-Length'] = payload.length;
  res.writeHead(status, out);
  res.end(req.method === 'HEAD' ? undefined : payload);
}

const sendJson = (req, res, status, data, headers = {}) =>
  send(req, res, status, JSON.stringify(data ?? null), {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...headers,
  });

function readBody(req, limit = 1_000_000) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(new HttpError(413, 'Request is too large.'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function readJson(req) {
  const body = await readBody(req);
  if (!body.length) return {};
  try {
    return JSON.parse(body.toString('utf8'));
  } catch {
    throw new HttpError(400, 'Request body is not valid JSON.');
  }
}

function parseCookies(header = '') {
  return Object.fromEntries(
    header
      .split(';')
      .map((part) => part.trim().split('='))
      .filter(([k]) => k)
      .map(([k, ...v]) => [k, decodeURIComponent(v.join('='))]),
  );
}

const isHttps = (req) => req.socket.encrypted || req.headers['x-forwarded-proto'] === 'https';

function sessionCookie(req, token, maxAge) {
  return [
    `${COOKIE}=${token}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Strict',
    `Max-Age=${maxAge}`,
    isHttps(req) ? 'Secure' : '',
  ]
    .filter(Boolean)
    .join('; ');
}

const signedIn = (req) => auth.check(parseCookies(req.headers.cookie)[COOKIE]);

// ---------- sign-in rate limit ----------

const attempts = new Map();
function checkRateLimit(req) {
  const ip = req.socket.remoteAddress || 'unknown';
  const now = Date.now();
  const entry = attempts.get(ip);
  if (!entry || entry.reset < now) {
    attempts.set(ip, { count: 1, reset: now + 15 * 60 * 1000 });
    return;
  }
  entry.count += 1;
  if (entry.count > 10) throw new HttpError(429, 'Too many attempts. Wait 15 minutes and try again.');
}

// ---------- status of all services (cached briefly) ----------

const statusCache = { at: 0, data: null, pending: null };
async function allStatus(force = false) {
  if (!force && statusCache.data && Date.now() - statusCache.at < 15000) return statusCache.data;
  if (statusCache.pending) return statusCache.pending;
  statusCache.pending = (async () => {
    const entries = await Promise.all(store.list().map(async (s) => [s.id, await testService(s, 6000)]));
    statusCache.data = Object.fromEntries(entries);
    statusCache.at = Date.now();
    statusCache.pending = null;
    return statusCache.data;
  })();
  return statusCache.pending;
}
const invalidateStatus = () => {
  statusCache.at = 0;
};

// ---------- proxy ----------

async function proxy(req, res, serviceId, subpath, url) {
  const service = store.get(serviceId);
  if (!service) throw new HttpError(404, 'That service no longer exists. Reload the app.');
  if (!['GET', 'POST', 'PUT', 'DELETE'].includes(req.method)) throw new HttpError(405, 'Method not allowed.');

  const body = req.method === 'GET' ? null : await readBody(req, 5_000_000);
  // The app asks for more time on slow actions such as container updates (at most 15 minutes).
  const seconds = Number(req.headers['x-deckarr-timeout']);
  const timeout = Number.isFinite(seconds) && seconds > 0 ? Math.min(seconds, 900) * 1000 : undefined;
  let upstream;
  try {
    upstream = await callService(service, {
      method: req.method,
      path: subpath || '/',
      query: url.search.slice(1),
      body: body && body.length ? body : null,
      contentType: req.headers['content-type'] || null,
      timeout,
    });
  } catch (err) {
    throw new HttpError(502, describeError(err, service));
  }

  const { status } = upstream;
  // Proxmox answers 403 when the token works but lacks a permission for this one call.
  if (status === 403 && service.type === 'proxmox') {
    const reason = upstream.statusText && upstream.statusText !== 'Forbidden' ? ` (${upstream.statusText})` : '';
    return sendJson(req, res, 403, { error: `The Proxmox token doesn’t have permission for this${reason}.`, upstreamStatus: status });
  }
  if (status === 401 || status === 403) {
    return sendJson(req, res, 502, { error: credentialMessage(service), upstreamStatus: status });
  }
  if (status >= 300 && status < 400) {
    return sendJson(req, res, 502, {
      error: `${service.name} redirected to ${upstream.headers.location || 'another address'}. Update the address in Settings.`,
      upstreamStatus: status,
    });
  }

  const type = upstream.headers['content-type'] || 'application/octet-stream';
  return send(req, res, status, upstream.body, {
    'Content-Type': type,
    'Cache-Control': type.startsWith('image/') ? 'private, max-age=86400' : 'no-store',
  });
}

// ---------- API routes ----------

async function handleApi(req, res, url) {
  const p = url.pathname;
  const m = req.method;

  if (p === '/api/health') return sendJson(req, res, 200, { ok: true, version: VERSION });

  if (m !== 'GET' && m !== 'HEAD' && req.headers['x-requested-with'] !== 'deckarr') {
    throw new HttpError(403, 'Missing request header.');
  }

  if (p === '/api/auth/status' && m === 'GET') {
    return sendJson(req, res, 200, {
      setUp: auth.isSetUp(),
      signedIn: signedIn(req),
      passwordFromEnv: auth.fromEnv,
      version: VERSION,
    });
  }

  if (p === '/api/auth/setup' && m === 'POST') {
    if (auth.isSetUp()) throw new HttpError(409, 'A password is already set. Sign in instead.');
    const { password } = await readJson(req);
    if (typeof password !== 'string' || password.length < 8) throw new HttpError(400, 'Use at least 8 characters.');
    await auth.setPassword(password);
    return sendJson(req, res, 200, { ok: true }, { 'Set-Cookie': sessionCookie(req, auth.issue(), auth.maxAgeSeconds) });
  }

  if (p === '/api/auth/login' && m === 'POST') {
    checkRateLimit(req);
    const { password } = await readJson(req);
    if (!(await auth.verify(password))) throw new HttpError(401, 'That password is incorrect.');
    return sendJson(req, res, 200, { ok: true }, { 'Set-Cookie': sessionCookie(req, auth.issue(), auth.maxAgeSeconds) });
  }

  if (p === '/api/auth/logout' && m === 'POST') {
    return sendJson(req, res, 200, { ok: true }, { 'Set-Cookie': sessionCookie(req, '', 0) });
  }

  // Everything below needs a session.
  if (!signedIn(req)) throw new HttpError(401, 'Sign in to continue.');

  if (p === '/api/auth/password' && m === 'POST') {
    if (auth.fromEnv) throw new HttpError(400, 'The password is set with APP_PASSWORD on the container. Change it there.');
    const { current, next } = await readJson(req);
    if (!(await auth.verify(current))) throw new HttpError(400, 'The current password is incorrect.');
    if (typeof next !== 'string' || next.length < 8) throw new HttpError(400, 'Use at least 8 characters for the new password.');
    await auth.setPassword(next);
    return sendJson(req, res, 200, { ok: true }, { 'Set-Cookie': sessionCookie(req, auth.issue(), auth.maxAgeSeconds) });
  }

  if (p === '/api/types' && m === 'GET') return sendJson(req, res, 200, publicTypes());

  if (p === '/api/services' && m === 'GET') return sendJson(req, res, 200, store.publicList());

  if (p === '/api/services' && m === 'POST') {
    const service = await store.create(await readJson(req));
    invalidateStatus();
    return sendJson(req, res, 201, store.toPublic(service));
  }

  if (p === '/api/services/test' && m === 'POST') {
    const candidate = store.candidate(await readJson(req));
    clearSession(candidate.id);
    return sendJson(req, res, 200, await testService(candidate));
  }

  if (p === '/api/services/order' && m === 'PUT') {
    const { ids } = await readJson(req);
    await store.reorder(ids);
    return sendJson(req, res, 200, store.publicList());
  }

  // ---------- push notifications ----------

  if (p === '/api/push/key' && m === 'GET') return sendJson(req, res, 200, { publicKey: pushStore.publicKey });

  if (p === '/api/push/find' && m === 'POST') {
    const sub = pushStore.find((await readJson(req)).endpoint);
    return sendJson(req, res, 200, sub ? { level: sub.level } : null);
  }

  if (p === '/api/push/subscribe' && m === 'POST') {
    const { subscription, level, name } = await readJson(req);
    if (level && !(level in LEVELS)) throw new HttpError(400, 'Choose which alerts to get.');
    try {
      const sub = await pushStore.upsert(subscription || {}, level, name);
      return sendJson(req, res, 200, { level: sub.level });
    } catch (err) {
      throw new HttpError(err.status || 500, err.message);
    }
  }

  if (p === '/api/push/unsubscribe' && m === 'POST') {
    await pushStore.remove((await readJson(req)).endpoint);
    return sendJson(req, res, 200, { ok: true });
  }

  if (p === '/api/push/test' && m === 'POST') {
    const sub = pushStore.find((await readJson(req)).endpoint);
    if (!sub) throw new HttpError(404, 'Notifications are off on this device.');
    const result = await sendPush(sub, { title: 'Deckarr', body: 'Notifications work. Unraid alerts will show up like this.', tag: 'deckarr-test', url: './#/settings' }, pushStore.data.vapid);
    if (result === 'gone') {
      await pushStore.remove(sub.endpoint);
      throw new HttpError(410, 'This device’s notification subscription expired. Turn notifications off and on again.');
    }
    if (result !== 'ok') throw new HttpError(502, 'The push service didn’t accept the message. Check the container log.');
    return sendJson(req, res, 200, { ok: true });
  }

  if (p === '/api/status' && m === 'GET') {
    return sendJson(req, res, 200, await allStatus(url.searchParams.has('fresh')));
  }

  let match = p.match(/^\/api\/services\/([\w-]+)$/);
  if (match) {
    const id = match[1];
    if (m === 'PUT') {
      const service = await store.update(id, await readJson(req));
      clearSession(id);
      invalidateStatus();
      return sendJson(req, res, 200, store.toPublic(service));
    }
    if (m === 'DELETE') {
      await store.remove(id);
      clearSession(id);
      invalidateStatus();
      return sendJson(req, res, 200, { ok: true });
    }
  }

  match = p.match(/^\/api\/svc\/([\w-]+)(\/.*)?$/);
  if (match) return proxy(req, res, match[1], match[2], url);

  throw new HttpError(404, 'Not found.');
}

// ---------- static files ----------

async function serveStatic(req, res, url) {
  if (req.method !== 'GET' && req.method !== 'HEAD') throw new HttpError(405, 'Method not allowed.');
  let rel;
  try {
    rel = decodeURIComponent(url.pathname);
  } catch {
    throw new HttpError(400, 'Bad path.');
  }
  if (rel.endsWith('/')) rel += 'index.html';
  const file = path.resolve(PUBLIC_DIR, '.' + rel);
  if (!file.startsWith(PUBLIC_DIR + path.sep)) throw new HttpError(404, 'Not found.');

  let stat;
  try {
    stat = await fs.stat(file);
  } catch {
    throw new HttpError(404, 'Not found.');
  }
  if (!stat.isFile()) throw new HttpError(404, 'Not found.');

  const etag = `W/"${stat.size.toString(16)}-${Math.floor(stat.mtimeMs).toString(16)}"`;
  const headers = {
    'Content-Type': MIME[path.extname(file)] || 'application/octet-stream',
    'Cache-Control': 'no-cache',
    ETag: etag,
  };
  if (req.headers['if-none-match'] === etag) {
    res.writeHead(304, { ...SECURITY_HEADERS, ...headers });
    return res.end();
  }
  return send(req, res, 200, await fs.readFile(file), headers);
}

// ---------- server ----------

const server = http.createServer(async (req, res) => {
  let url;
  try {
    url = new URL(req.url, 'http://localhost');
  } catch {
    res.writeHead(400).end();
    return;
  }
  const isApi = url.pathname.startsWith('/api/');
  try {
    if (isApi) await handleApi(req, res, url);
    else await serveStatic(req, res, url);
  } catch (err) {
    const status = err.status || 500;
    if (!(err instanceof HttpError) && !(err instanceof ValidationError)) console.error(err);
    const message = status === 500 ? 'Something went wrong on the Deckarr server. Check the container log.' : err.message;
    if (res.headersSent) return res.end();
    if (isApi) await sendJson(req, res, status, { error: message });
    else await send(req, res, status, message, { 'Content-Type': 'text/plain; charset=utf-8' });
  }
});

startWatching(pushStore, store);

server.listen(PORT, () => {
  console.log(`Deckarr ${VERSION} listening on port ${PORT}`);
  console.log(`Config directory: ${CONFIG_DIR}`);
  if (!auth.isSetUp()) console.log('No password yet. Open the app to create one.');
});

const shutdown = () => {
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000).unref();
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
