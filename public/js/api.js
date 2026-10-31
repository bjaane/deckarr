// All requests are relative so the app also works behind a reverse proxy sub-path.

export class ApiError extends Error {
  constructor(message, status, data) {
    super(message);
    this.status = status;
    this.data = data;
  }
}

const listeners = new Map();
export const events = {
  on(name, fn) {
    if (!listeners.has(name)) listeners.set(name, new Set());
    listeners.get(name).add(fn);
  },
  emit(name, payload) {
    listeners.get(name)?.forEach((fn) => fn(payload));
  },
};

// Pulls a readable message out of whatever a service sent back.
function upstreamMessage(data) {
  if (!data) return null;
  if (typeof data === 'string') {
    const text = data.trim();
    return text && text.length < 200 && !text.startsWith('<') ? text : null;
  }
  if (data.error) return typeof data.error === 'string' ? data.error : data.error.message || null;
  if (Array.isArray(data)) {
    const first = data.find((d) => d && (d.errorMessage || d.message));
    return first ? first.errorMessage || first.message : null;
  }
  return data.message || data.title || null;
}

export async function api(path, { method = 'GET', body, form, signal, timeout } = {}) {
  const opts = { method, signal, credentials: 'same-origin', headers: { 'X-Requested-With': 'deckarr' } };
  // Lets slow upstream calls (pulling a Docker image) run longer than the usual 20 seconds.
  if (timeout) opts.headers['X-Deckarr-Timeout'] = String(Math.round(timeout / 1000));
  if (form) {
    opts.headers['Content-Type'] = 'application/x-www-form-urlencoded';
    opts.body = new URLSearchParams(form).toString();
  } else if (body !== undefined) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }

  let res;
  try {
    res = await fetch(path.replace(/^\//, ''), opts);
  } catch (err) {
    if (err.name === 'AbortError') throw err;
    throw new ApiError("Can't reach the Deckarr server. Check your connection.", 0);
  }

  const type = res.headers.get('content-type') || '';
  const text = await res.text();
  let data = text;
  if (type.includes('json') && text) {
    try {
      data = JSON.parse(text);
    } catch {
      /* leave as text */
    }
  }

  if (res.status === 401 && !path.startsWith('/api/auth/')) {
    events.emit('unauthorized');
  }
  if (!res.ok) {
    throw new ApiError(upstreamMessage(data) || `Request failed (HTTP ${res.status}).`, res.status, data);
  }
  return data;
}

export const proxyUrl = (serviceId, path) => `api/svc/${encodeURIComponent(serviceId)}/${String(path).replace(/^\/+/, '')}`;

export const call = (serviceId, path, opts) => api('/' + proxyUrl(serviceId, path), opts);
