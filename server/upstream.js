import http from 'node:http';
import https from 'node:https';
import { SERVICE_TYPES } from './types.js';

const MAX_BYTES = 64 * 1024 * 1024; // big Sonarr libraries can be tens of MB of JSON
const qbitSessions = new Map(); // service id -> cookie header

export class UpstreamError extends Error {}

/** Minimal HTTP(S) client with per-request TLS verification control. */
export function rawRequest(urlStr, { method = 'GET', headers = {}, body = null, insecure = false, timeout = 20000 } = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlStr);
    const lib = url.protocol === 'https:' ? https : http;
    const opts = { method, headers: { ...headers }, timeout };
    if (url.protocol === 'https:' && insecure) opts.rejectUnauthorized = false;

    let payload = body;
    if (payload != null && !Buffer.isBuffer(payload)) {
      payload = Buffer.from(typeof payload === 'string' ? payload : JSON.stringify(payload));
    }
    if (payload) opts.headers['content-length'] = payload.length;
    else if (method !== 'GET' && method !== 'HEAD') opts.headers['content-length'] = 0;

    const req = lib.request(url, opts, (res) => {
      const chunks = [];
      let size = 0;
      res.on('data', (chunk) => {
        size += chunk.length;
        if (size > MAX_BYTES) {
          req.destroy(new UpstreamError('The response was too large.'));
          return;
        }
        chunks.push(chunk);
      });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
      res.on('error', reject);
    });
    req.on('timeout', () => {
      const err = new Error('timeout');
      err.code = 'TIMEOUT';
      req.destroy(err);
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

function buildUrl(service, path, query) {
  const base = new URL(service.url);
  const basePath = base.pathname.replace(/\/+$/, '');
  const cleanPath = '/' + String(path || '').replace(/^\/+/, '');
  const url = new URL(base.origin + basePath + cleanPath);
  if (query) url.search = query;
  return url;
}

async function qbitLogin(service) {
  const url = buildUrl(service, '/api/v2/auth/login');
  const body = new URLSearchParams({ username: service.username || '', password: service.password || '' }).toString();
  const res = await rawRequest(url.href, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', referer: url.origin },
    body,
    insecure: service.insecure,
  });
  const text = res.body.toString('utf8').trim();
  if (res.status === 403) {
    throw new UpstreamError(`${service.name} has temporarily blocked this server after too many failed sign-ins. Wait a while, then check the username and password.`);
  }
  if (res.status !== 200 || /^fails/i.test(text)) {
    throw new UpstreamError(`${service.name} rejected the username or password.`);
  }
  const cookies = [].concat(res.headers['set-cookie'] || []).map((c) => c.split(';')[0]).filter(Boolean);
  if (!cookies.length) throw new UpstreamError(`${service.name} accepted the sign-in but didn't return a session.`);
  const cookie = cookies.join('; ');
  qbitSessions.set(service.id, cookie);
  return cookie;
}

export function clearSession(serviceId) {
  qbitSessions.delete(serviceId);
}

/** Calls a service with its credentials injected. Returns { status, headers, body }. */
export async function callService(service, { method = 'GET', path = '/', query = '', body = null, contentType = null, timeout, retry = true } = {}) {
  const url = buildUrl(service, path, query);
  const headers = { accept: 'application/json, text/plain, */*' };
  if (contentType) headers['content-type'] = contentType;

  switch (service.type) {
    case 'sabnzbd':
      url.searchParams.set('apikey', service.apiKey || '');
      if (!url.searchParams.has('output')) url.searchParams.set('output', 'json');
      break;
    case 'jellyfin':
      headers.authorization = `MediaBrowser Client="Deckarr", Device="Deckarr server", DeviceId="deckarr-server", Version="1.0.0", Token="${service.apiKey || ''}"`;
      break;
    case 'qbittorrent':
      headers.referer = url.origin;
      if (service.username) {
        headers.cookie = qbitSessions.get(service.id) || (await qbitLogin(service));
      }
      break;
    default:
      headers['x-api-key'] = service.apiKey || '';
  }

  const res = await rawRequest(url.href, { method, headers, body, insecure: service.insecure, timeout });

  if (service.type === 'qbittorrent' && res.status === 403 && service.username && retry) {
    qbitSessions.delete(service.id);
    return callService(service, { method, path, query, body, contentType, timeout, retry: false });
  }
  return res;
}

function hostOf(service) {
  try {
    return new URL(service.url).host;
  } catch {
    return service.url;
  }
}

export function credentialMessage(service) {
  const meta = SERVICE_TYPES[service.type];
  if (meta?.auth === 'login') {
    return service.username
      ? `${service.name} rejected the username or password. Update them in Settings.`
      : `${service.name} needs a username and password. Add them in Settings.`;
  }
  return `${service.name} rejected the API key. Update it in Settings.`;
}

/** Turns low-level network errors into something a person can act on. */
export function describeError(err, service) {
  if (err instanceof UpstreamError) return err.message;
  const host = hostOf(service);
  switch (err.code) {
    case 'ECONNREFUSED':
      return `Nothing is answering at ${host}. Check the address and that ${service.name} is running.`;
    case 'ENOTFOUND':
    case 'EAI_AGAIN':
      return `Couldn't find ${host}. Check the address.`;
    case 'EHOSTUNREACH':
    case 'ENETUNREACH':
      return `The Deckarr container can't reach ${host}. Check the address and the container's network.`;
    case 'ECONNRESET':
    case 'EPIPE':
      return `${service.name} closed the connection. If it uses HTTPS, make sure the address starts with https://.`;
    case 'TIMEOUT':
    case 'ETIMEDOUT':
      return `${service.name} took too long to answer.`;
    case 'DEPTH_ZERO_SELF_SIGNED_CERT':
    case 'SELF_SIGNED_CERT_IN_CHAIN':
    case 'UNABLE_TO_VERIFY_LEAF_SIGNATURE':
    case 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY':
    case 'ERR_TLS_CERT_ALTNAME_INVALID':
    case 'CERT_HAS_EXPIRED':
      return `${service.name} uses a certificate Deckarr doesn't trust. Turn on "Allow self-signed certificate" for this service.`;
    case 'EPROTO':
    case 'ERR_SSL_WRONG_VERSION_NUMBER':
    case 'HPE_INVALID_CONSTANT':
      return `The address doesn't match how ${service.name} is served. Try switching between http:// and https://.`;
    default:
      return `Couldn't reach ${service.name}: ${err.message}`;
  }
}

/** Cheap request that proves the address and credentials work. */
export async function testService(service, timeout = 8000) {
  const meta = SERVICE_TYPES[service.type];
  if (!meta) return { ok: false, error: 'Unknown service type.' };
  const t = meta.test;
  const started = Date.now();
  const fail = (error) => ({ ok: false, error });
  const ok = (version, detail) => ({ ok: true, version: version || null, detail: detail || null, ms: Date.now() - started });

  try {
    const res = await callService(service, {
      method: t.method || 'GET',
      path: t.path,
      query: t.query || '',
      body: t.body ? JSON.stringify(t.body) : null,
      contentType: t.body ? 'application/json' : null,
      timeout,
    });

    if (res.status >= 300 && res.status < 400) {
      return fail(`${service.name} redirected to ${res.headers.location || 'another address'}. Use that address instead.`);
    }
    if (res.status === 401 || res.status === 403) return fail(credentialMessage(service));
    if (res.status >= 400) {
      return fail(`${service.name} answered with HTTP ${res.status}. The address may point to a different app.`);
    }

    const text = res.body.toString('utf8');
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {
      /* not JSON */
    }

    switch (service.type) {
      case 'qbittorrent':
        if (!/^v?\d/.test(text.trim())) return fail("This address doesn't look like the qBittorrent Web UI.");
        return ok(text.trim().replace(/^v/, ''));
      case 'unraid':
        if (!json) return fail("This address doesn't look like the Unraid API. Unraid 7.2 or newer is required.");
        if (json.errors?.length) return fail(`Unraid: ${json.errors[0].message}`);
        return ok(null, json.data?.array?.state ? `Array ${String(json.data.array.state).toLowerCase()}` : null);
      case 'sabnzbd':
        if (!json) return fail("This address doesn't look like SABnzbd.");
        if (json.error) return fail(`SABnzbd: ${json.error}`);
        return ok(json.queue?.version);
      case 'jellyfin':
        if (!json) return fail("This address doesn't look like Jellyfin.");
        return ok(json.Version, json.ServerName);
      case 'bazarr':
        if (!json) return fail("This address doesn't look like Bazarr.");
        return ok(json.data?.bazarr_version);
      default:
        if (!json) return fail(`Got a web page instead of the ${meta.label} API. Check the address.`);
        return ok(json.version);
    }
  } catch (err) {
    return fail(describeError(err, service));
  }
}
