// Web Push for Unraid and Proxmox VE alerts, with no dependencies.
//
// Once a minute Deckarr checks every Unraid server for new unread notifications and every
// Proxmox server for failed tasks, offline nodes, full storage and failing disks, and sends
// what's new to the devices that turned alerts on. Messages go straight to the browser's
// push service (Apple, Google or Mozilla), encrypted for that device (RFC 8291) and signed
// with this server's own VAPID key (RFC 8292). No account or relay is involved.

import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import { callService, rawRequest } from './upstream.js';

const POLL_MS = 60 * 1000;
const SEEN_LIMIT = 1000;
const IMPORTANCE = { INFO: 1, WARNING: 2, ALERT: 3 };
export const LEVELS = { alert: 3, warning: 2, all: 1 };
const VAPID_SUBJECT = 'https://github.com/bjaane/deckarr';

const b64url = (buf) => Buffer.from(buf).toString('base64url');
const fromB64url = (s) => Buffer.from(String(s), 'base64url');

// ---------- encryption (RFC 8291, aes128gcm) ----------

/**
 * Encrypts a payload for one subscription. `salt` and `serverKeys` are only passed in by tests.
 * Returns the request body: header (salt, record size, server public key) + ciphertext.
 */
export function encrypt(payload, { p256dh, auth }, { salt = crypto.randomBytes(16), serverKeys } = {}) {
  const uaPublic = fromB64url(p256dh);
  const authSecret = fromB64url(auth);
  if (uaPublic.length !== 65 || authSecret.length !== 16) throw new Error('Invalid subscription keys.');

  const ecdh = crypto.createECDH('prime256v1');
  if (serverKeys) ecdh.setPrivateKey(serverKeys.privateKey);
  else ecdh.generateKeys();
  const asPublic = ecdh.getPublicKey();
  const shared = ecdh.computeSecret(uaPublic);

  const keyInfo = Buffer.concat([Buffer.from('WebPush: info\0'), uaPublic, asPublic]);
  const ikm = Buffer.from(crypto.hkdfSync('sha256', shared, authSecret, keyInfo, 32));
  const cek = Buffer.from(crypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16));
  const nonce = Buffer.from(crypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12));

  // One record: the payload plus the 0x02 "last record" delimiter.
  const plaintext = Buffer.concat([Buffer.from(payload), Buffer.from([2])]);
  const cipher = crypto.createCipheriv('aes-128-gcm', cek, nonce);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final(), cipher.getAuthTag()]);

  const header = Buffer.alloc(21);
  salt.copy(header, 0);
  header.writeUInt32BE(4096, 16);
  header.writeUInt8(asPublic.length, 20);
  return Buffer.concat([header, asPublic, ciphertext]);
}

// ---------- VAPID (RFC 8292) ----------

function createVapidKeys() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const jwk = publicKey.export({ format: 'jwk' });
  const raw = Buffer.concat([Buffer.from([4]), fromB64url(jwk.x), fromB64url(jwk.y)]);
  return { publicKey: b64url(raw), privateJwk: privateKey.export({ format: 'jwk' }) };
}

export function vapidHeader(endpoint, vapid, now = Date.now()) {
  const header = b64url(JSON.stringify({ typ: 'JWT', alg: 'ES256' }));
  const claims = b64url(JSON.stringify({ aud: new URL(endpoint).origin, exp: Math.floor(now / 1000) + 12 * 3600, sub: VAPID_SUBJECT }));
  const key = crypto.createPrivateKey({ key: vapid.privateJwk, format: 'jwk' });
  const signature = crypto.sign('sha256', Buffer.from(`${header}.${claims}`), { key, dsaEncoding: 'ieee-p1363' });
  return `vapid t=${header}.${claims}.${b64url(signature)}, k=${vapid.publicKey}`;
}

// ---------- store ----------

export class PushStore {
  constructor(file) {
    this.file = file;
    this.data = null;
  }

  async load() {
    try {
      this.data = JSON.parse(await fs.readFile(this.file, 'utf8'));
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
      this.data = {};
    }
    let changed = false;
    if (!this.data.vapid) {
      this.data.vapid = createVapidKeys();
      changed = true;
    }
    this.data.subscriptions ||= [];
    this.data.seen ||= {};
    if (changed) await this.save();
  }

  async save() {
    const tmp = `${this.file}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(this.data, null, 2), { mode: 0o600 });
    await fs.rename(tmp, this.file);
  }

  get publicKey() {
    return this.data.vapid.publicKey;
  }

  find(endpoint) {
    return this.data.subscriptions.find((s) => s.endpoint === endpoint) || null;
  }

  async upsert({ endpoint, keys }, level, name) {
    if (typeof endpoint !== 'string' || !/^https:\/\//.test(endpoint) || !keys?.p256dh || !keys?.auth) {
      throw Object.assign(new Error('The browser sent an incomplete push subscription.'), { status: 400 });
    }
    if (!(level in LEVELS)) level = 'warning';
    const existing = this.find(endpoint);
    // First device after none: start counting from now, so nothing from the quiet period is replayed.
    if (!this.data.subscriptions.length) {
      this.data.seen = {};
      this.data.pve = {};
    }
    const sub = { endpoint, keys: { p256dh: String(keys.p256dh), auth: String(keys.auth) }, level, name: String(name || '').slice(0, 60), created: existing?.created || new Date().toISOString() };
    if (existing) Object.assign(existing, sub);
    else this.data.subscriptions.push(sub);
    await this.save();
    return sub;
  }

  async remove(endpoint) {
    const before = this.data.subscriptions.length;
    this.data.subscriptions = this.data.subscriptions.filter((s) => s.endpoint !== endpoint);
    if (this.data.subscriptions.length !== before) await this.save();
  }
}

// ---------- sending ----------

/** Sends one message. Resolves 'ok', 'gone' (subscription expired) or 'failed'. */
export async function sendPush(sub, message, vapid, { urgency = 'normal' } = {}) {
  let body;
  try {
    body = encrypt(JSON.stringify(message), sub.keys);
  } catch (err) {
    // Keys the browser sent that can't be used: the subscription is worthless.
    console.error(`Push: unusable subscription keys (${err.message}).`);
    return 'gone';
  }
  try {
    const res = await rawRequest(sub.endpoint, {
      method: 'POST',
      headers: {
        authorization: vapidHeader(sub.endpoint, vapid),
        'content-encoding': 'aes128gcm',
        'content-type': 'application/octet-stream',
        ttl: '86400',
        urgency,
      },
      body,
      timeout: 15000,
    });
    if (res.status >= 200 && res.status < 300) return 'ok';
    if (res.status === 404 || res.status === 410) return 'gone';
    console.error(`Push to ${new URL(sub.endpoint).host} failed: HTTP ${res.status} ${res.body.toString('utf8').slice(0, 200)}`);
    return 'failed';
  } catch (err) {
    console.error(`Push to ${new URL(sub.endpoint).host} failed: ${err.message}`);
    return 'failed';
  }
}

/** Sends to every device whose chosen level includes this importance (1 info, 2 warning, 3 alert). */
export async function sendToAll(pushStore, message, importance) {
  const subs = pushStore.data.subscriptions.filter((s) => importance >= (LEVELS[s.level] || 2));
  const urgency = importance >= 3 ? 'high' : 'normal';
  const results = await Promise.all(subs.map(async (s) => [s, await sendPush(s, message, pushStore.data.vapid, { urgency })]));
  for (const [s, result] of results) if (result === 'gone') await pushStore.remove(s.endpoint);
}

// ---------- watching Unraid ----------

async function unreadNotifications(service) {
  const query = '{ notifications { list(filter: { type: UNREAD, offset: 0, limit: 50 }) { id title subject description importance timestamp } } }';
  const res = await callService(service, { method: 'POST', path: '/graphql', body: JSON.stringify({ query }), contentType: 'application/json', timeout: 15000 });
  if (res.status !== 200) throw new Error(`HTTP ${res.status}`);
  const json = JSON.parse(res.body.toString('utf8'));
  if (json.errors?.length) throw new Error(json.errors[0].message);
  return json.data?.notifications?.list || [];
}

// ---------- watching Proxmox VE ----------

async function pveGet(service, path) {
  const res = await callService(service, { path: `/api2/json/${path}`, timeout: 20000 });
  if (res.status !== 200) throw new Error(`HTTP ${res.status}${res.statusText ? ` ${res.statusText}` : ''}`);
  return JSON.parse(res.body.toString('utf8')).data;
}

const PVE_TASKS = {
  vzdump: 'Backup',
  qmstart: 'VM start',
  qmstop: 'VM stop',
  qmshutdown: 'VM shutdown',
  qmreboot: 'VM restart',
  qmigrate: 'VM migration',
  qmclone: 'VM clone',
  qmsnapshot: 'VM snapshot',
  vzstart: 'Container start',
  vzstop: 'Container stop',
  vzshutdown: 'Container shutdown',
  vzmigrate: 'Container migration',
  vzsnapshot: 'Container snapshot',
  aptupdate: 'Update check',
  zfsscrub: 'ZFS scrub',
  startall: 'Start of all guests',
  stopall: 'Stop of all guests',
};
const DISK_CHECK_MS = 15 * 60 * 1000;
const FULL = 0.9;
const NOT_FULL = 0.85;

/**
 * Finds what changed on a Proxmox server since the last look: failed tasks, nodes going
 * offline or coming back, storage passing 90% and disks whose SMART health turns bad.
 * Returns [message, importance] pairs. Without a previous state it only records the present.
 */
async function proxmoxEvents(service, prev) {
  const first = !prev;
  const state = prev || { tasks: [], offline: [], full: [], badDisks: [], diskAt: 0 };
  const events = [];
  const link = (open) => `./#/server?server=${encodeURIComponent(service.id)}${open ? `&open=${open}` : ''}`;

  const nodes = (await pveGet(service, 'nodes')) || [];
  const online = nodes.filter((n) => n.status === 'online').map((n) => n.node);

  // Nodes
  const offline = nodes.filter((n) => n.status !== 'online').map((n) => n.node);
  for (const node of offline.filter((n) => !state.offline.includes(n))) {
    events.push([{ title: `Node ${node} is offline`, body: `Proxmox reports ${node} as offline. Its VMs and containers may be down.`, tag: `pve-node-${node}`, url: link() }, 3]);
  }
  for (const node of state.offline.filter((n) => online.includes(n))) {
    events.push([{ title: `Node ${node} is back online`, body: `${node} is reachable again.`, tag: `pve-node-${node}`, url: link() }, 1]);
  }
  state.offline = offline;

  // Failed tasks (failed backups, guests that wouldn't start, ...)
  let names = null;
  const guestName = async (id) => {
    if (!/^\d+$/.test(String(id || ''))) return id || '';
    names ||= Object.fromEntries(((await pveGet(service, 'cluster/resources?type=vm').catch(() => [])) || []).map((g) => [String(g.vmid), g.name]));
    return names[id] ? `${names[id]} (${id})` : `ID ${id}`;
  };
  const seenTasks = new Set(state.tasks);
  for (const node of online) {
    const tasks = (await pveGet(service, `nodes/${encodeURIComponent(node)}/tasks?limit=50`).catch(() => [])) || [];
    for (const t of tasks) {
      if (!t.endtime || !t.status || t.status === 'OK' || seenTasks.has(t.upid)) continue;
      seenTasks.add(t.upid);
      state.tasks.push(t.upid);
      const what = PVE_TASKS[t.type] || `Task ${t.type}`;
      const warnings = /^WARNINGS/i.test(t.status);
      const who = t.id ? `${await guestName(t.id)} on ${node}` : node;
      events.push([{ title: warnings ? `${what} finished with warnings` : `${what} failed`, body: `${who}: ${t.status}`, tag: `pve-task-${t.upid}`, url: link('tasks') }, warnings ? 2 : 3]);
    }
  }
  state.tasks = state.tasks.slice(-500);

  // Storage, counted once even when shared between nodes
  const storages = new Map();
  for (const node of online) {
    for (const st of (await pveGet(service, `nodes/${encodeURIComponent(node)}/storage`).catch(() => [])) || []) {
      if (!st.total || !st.active) continue;
      const key = st.shared ? st.storage : `${node}/${st.storage}`;
      storages.set(key, { ...st, node, key });
    }
  }
  for (const st of storages.values()) {
    const used = st.used / st.total;
    const isFull = state.full.includes(st.key);
    if (used >= FULL && !isFull) {
      state.full.push(st.key);
      events.push([{ title: `Storage ${st.storage} is ${Math.round(used * 100)}% full`, body: `${st.shared ? 'Shared storage' : `On ${st.node}`}: ${Math.round((st.avail || 0) / 1e9)} GB left.`, tag: `pve-storage-${st.key}`, url: link('storage') }, 2]);
    } else if (used < NOT_FULL && isFull) {
      state.full = state.full.filter((k) => k !== st.key);
    }
  }

  // Disk health. Reading SMART is slower, so only every 15 minutes.
  if (Date.now() - state.diskAt >= DISK_CHECK_MS) {
    state.diskAt = Date.now();
    const bad = [];
    for (const node of online) {
      for (const d of (await pveGet(service, `nodes/${encodeURIComponent(node)}/disks/list`).catch(() => [])) || []) {
        const health = String(d.health || '').toUpperCase();
        if (!health || ['PASSED', 'OK', 'UNKNOWN'].includes(health)) continue;
        const key = `${node}:${d.devpath}`;
        bad.push(key);
        if (!state.badDisks.includes(key)) {
          events.push([{ title: `Disk ${d.devpath} on ${node} is failing`, body: `SMART health: ${health}. ${d.model || ''}`.trim(), tag: `pve-disk-${key}`, url: link('disks') }, 3]);
        }
      }
    }
    state.badDisks = bad;
  }

  return { state, events: first ? [] : events };
}

export function startWatching(pushStore, configStore) {
  const failing = new Set();
  const report = (service, what, err) => {
    if (err) {
      if (!failing.has(service.id)) console.error(`Push: can't read ${service.name} ${what}: ${err.message}`);
      failing.add(service.id);
    } else if (failing.delete(service.id)) {
      console.log(`Push: reading ${service.name} ${what} works again.`);
    }
  };
  const servers = () => configStore.list().filter((s) => s.type === 'unraid' || s.type === 'proxmox');
  // With several servers, the notification title says which one it's about.
  const label = (service) => (servers().length > 1 ? service.name : undefined);

  async function checkUnraid(service) {
    let list;
    try {
      list = await unreadNotifications(service);
      report(service, 'notifications');
    } catch (err) {
      report(service, 'notifications', err);
      return;
    }
    const seen = pushStore.data.seen[service.id];
    const known = new Set(seen || []);
    const fresh = list.filter((n) => !known.has(n.id));
    // The first look at a server only records what's there, so turning alerts on doesn't replay old ones.
    if (seen) {
      for (const n of fresh.reverse()) {
        await sendToAll(
          pushStore,
          {
            title: n.subject || n.title || 'Unraid',
            body: n.description || '',
            tag: `unraid-${n.id}`,
            importance: n.importance,
            url: `./#/server?notifications=${encodeURIComponent(service.id)}`,
            server: label(service),
          },
          IMPORTANCE[n.importance] || 1,
        );
      }
    }
    if (!seen || fresh.length) {
      pushStore.data.seen[service.id] = [...known, ...fresh.map((n) => n.id)].slice(-SEEN_LIMIT);
      await pushStore.save();
    }
  }

  async function checkProxmox(service) {
    pushStore.data.pve ||= {};
    let result;
    try {
      result = await proxmoxEvents(service, pushStore.data.pve[service.id]);
      report(service, 'status');
    } catch (err) {
      report(service, 'status', err);
      return;
    }
    for (const [message, importance] of result.events) {
      await sendToAll(pushStore, { ...message, importance: Object.keys(IMPORTANCE).find((k) => IMPORTANCE[k] === importance), server: label(service) }, importance);
    }
    pushStore.data.pve[service.id] = result.state;
    await pushStore.save();
  }

  async function tick() {
    if (!pushStore.data.subscriptions.length) return;
    for (const service of servers()) {
      if (service.type === 'unraid') await checkUnraid(service);
      else await checkProxmox(service);
    }
  }

  let running = false;
  const run = async () => {
    if (running) return;
    running = true;
    try {
      await tick();
    } catch (err) {
      console.error(`Push: ${err.message}`);
    } finally {
      running = false;
    }
  };
  setTimeout(run, 5000).unref();
  setInterval(run, POLL_MS).unref();
  return { run };
}
