import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import { promisify } from 'node:util';

const scrypt = promisify(crypto.scrypt);
const SESSION_DAYS = 30;

const b64url = (buf) => Buffer.from(buf).toString('base64url');

export class Auth {
  constructor(file, envPassword) {
    this.file = file;
    this.envPassword = envPassword || '';
    this.data = {};
  }

  get fromEnv() {
    return Boolean(this.envPassword);
  }

  get maxAgeSeconds() {
    return SESSION_DAYS * 24 * 60 * 60;
  }

  async load() {
    try {
      this.data = JSON.parse(await fs.readFile(this.file, 'utf8'));
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
      this.data = {};
    }
    if (!this.data.secret) {
      this.data.secret = crypto.randomBytes(32).toString('hex');
      this.data.version = this.data.version || 1;
      await this.save();
    }
  }

  async save() {
    const tmp = `${this.file}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(this.data, null, 2), { mode: 0o600 });
    await fs.rename(tmp, this.file);
  }

  isSetUp() {
    return this.fromEnv || Boolean(this.data.hash);
  }

  async setPassword(password) {
    const salt = crypto.randomBytes(16);
    const hash = await scrypt(password, salt, 64);
    this.data.salt = salt.toString('hex');
    this.data.hash = hash.toString('hex');
    this.data.version = (this.data.version || 1) + 1; // signs out every other session
    await this.save();
  }

  async verify(password) {
    if (typeof password !== 'string' || !password) return false;
    if (this.fromEnv) {
      const a = crypto.createHash('sha256').update(password).digest();
      const b = crypto.createHash('sha256').update(this.envPassword).digest();
      return crypto.timingSafeEqual(a, b);
    }
    if (!this.data.hash) return false;
    const hash = await scrypt(password, Buffer.from(this.data.salt, 'hex'), 64);
    return crypto.timingSafeEqual(hash, Buffer.from(this.data.hash, 'hex'));
  }

  get tokenVersion() {
    if (this.fromEnv) {
      return 'e' + crypto.createHmac('sha256', this.data.secret).update(this.envPassword).digest('hex').slice(0, 16);
    }
    return String(this.data.version || 1);
  }

  sign(payload) {
    return b64url(crypto.createHmac('sha256', this.data.secret).update(payload).digest());
  }

  issue() {
    const payload = b64url(JSON.stringify({ exp: Date.now() + this.maxAgeSeconds * 1000, v: this.tokenVersion }));
    return `${payload}.${this.sign(payload)}`;
  }

  check(token) {
    if (!token || typeof token !== 'string') return false;
    const [payload, sig] = token.split('.');
    if (!payload || !sig) return false;
    const expected = Buffer.from(this.sign(payload));
    const given = Buffer.from(sig);
    if (expected.length !== given.length || !crypto.timingSafeEqual(expected, given)) return false;
    try {
      const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
      return data.exp > Date.now() && data.v === this.tokenVersion;
    } catch {
      return false;
    }
  }
}
