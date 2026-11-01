import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import { SERVICE_TYPES } from './types.js';

export class ValidationError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

const str = (v, max) => (typeof v === 'string' ? v.slice(0, max) : '');

function normalizeUrl(value, label, required, scheme = 'http') {
  let v = str(value, 2048).trim();
  if (!v) {
    if (required) throw new ValidationError(`Enter the ${label.toLowerCase()}.`);
    return '';
  }
  if (!/^https?:\/\//i.test(v)) v = `${scheme}://${v}`;
  let url;
  try {
    url = new URL(v);
  } catch {
    throw new ValidationError(`The ${label.toLowerCase()} isn't a valid web address.`);
  }
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new ValidationError(`The ${label.toLowerCase()} must start with http:// or https://.`);
  }
  url.search = '';
  url.hash = '';
  return url.href.replace(/\/+$/, '');
}

function normalize(input, existing) {
  const type = existing ? existing.type : input.type;
  const meta = SERVICE_TYPES[type];
  if (!meta) throw new ValidationError('Choose a service type.');

  const pick = (key) => (input[key] !== undefined ? input[key] : existing?.[key]);

  const service = {
    type,
    name: str(pick('name'), 40).trim() || meta.label,
    url: normalizeUrl(pick('url'), 'Address', true, meta.scheme),
    backupUrl: normalizeUrl(pick('backupUrl'), 'Backup address', false, meta.scheme),
    webUrl: normalizeUrl(pick('webUrl'), 'Web UI address', false, meta.scheme),
    insecure: Boolean(pick('insecure')),
  };

  if (service.backupUrl === service.url) service.backupUrl = '';

  if (meta.auth === 'login') {
    service.username = str(pick('username'), 200).trim();
    service.password = input.password !== undefined ? str(input.password, 512) : existing?.password || '';
    // qBittorrent 5.2+ can use an API key instead of signing in.
    if (meta.apiKeyOption) {
      const useKey = input.authMode !== undefined ? input.authMode === 'apikey' : Boolean(existing?.apiKey);
      service.apiKey = useKey ? (input.apiKey ? str(input.apiKey, 512).trim() : existing?.apiKey || '') : '';
      if (useKey && !service.apiKey) throw new ValidationError('Enter the API key.');
    }
  } else {
    service.apiKey = input.apiKey !== undefined && input.apiKey !== '' ? str(input.apiKey, 512).trim() : existing?.apiKey || '';
    if (!service.apiKey) throw new ValidationError('Enter the API key.');
    if (type === 'proxmox') {
      // Accept the token with or without the header prefix Proxmox shows in some guides.
      service.apiKey = service.apiKey.replace(/^PVEAPIToken=/i, '');
      if (!/^[^\s!@]+@[^\s!]+![^\s=]+=\S+$/.test(service.apiKey)) {
        throw new ValidationError('Paste the whole Proxmox token as user@realm!tokenid=secret, for example root@pam!deckarr=1234abcd-….');
      }
    }
  }
  return service;
}

export class ConfigStore {
  constructor(file) {
    this.file = file;
    this.data = { services: [] };
  }

  async load() {
    try {
      const parsed = JSON.parse(await fs.readFile(this.file, 'utf8'));
      this.data = { ...parsed, services: Array.isArray(parsed.services) ? parsed.services : [] };
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
      this.data = { services: [] };
    }
  }

  async save() {
    const tmp = `${this.file}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(this.data, null, 2), { mode: 0o600 });
    await fs.rename(tmp, this.file);
  }

  list() {
    return this.data.services;
  }

  get(id) {
    return this.data.services.find((s) => s.id === id) || null;
  }

  toPublic(service) {
    const { apiKey, password, ...rest } = service;
    return { ...rest, hasApiKey: Boolean(apiKey), hasPassword: Boolean(password) };
  }

  publicList() {
    return this.data.services.map((s) => this.toPublic(s));
  }

  /** Builds an unsaved service for "Test connection", reusing saved secrets when editing. */
  candidate(input) {
    const existing = input.id ? this.get(input.id) : null;
    const service = normalize(input, existing);
    service.id = existing?.id || `test-${crypto.randomBytes(4).toString('hex')}`;
    return service;
  }

  async create(input) {
    const service = normalize(input, null);
    service.id = `${service.type}-${crypto.randomBytes(3).toString('hex')}`;
    this.data.services.push(service);
    await this.save();
    return service;
  }

  async update(id, input) {
    const index = this.data.services.findIndex((s) => s.id === id);
    if (index === -1) throw new ValidationError('That service no longer exists.', 404);
    const service = { id, ...normalize(input, this.data.services[index]) };
    this.data.services[index] = service;
    await this.save();
    return service;
  }

  async remove(id) {
    const before = this.data.services.length;
    this.data.services = this.data.services.filter((s) => s.id !== id);
    if (this.data.services.length === before) throw new ValidationError('That service no longer exists.', 404);
    await this.save();
  }

  async reorder(ids) {
    if (!Array.isArray(ids)) throw new ValidationError('Send a list of service ids.');
    const byId = new Map(this.data.services.map((s) => [s.id, s]));
    const ordered = ids.map((id) => byId.get(id)).filter(Boolean);
    const rest = this.data.services.filter((s) => !ids.includes(s.id));
    this.data.services = [...ordered, ...rest];
    await this.save();
  }
}
