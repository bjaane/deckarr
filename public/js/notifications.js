// Turning server push notifications (Unraid and Proxmox alerts) on and off for this device.

import { api } from './api.js';
import { platform, isInstalled } from './install.js';

export const LEVEL_OPTIONS = [
  { label: 'Alerts', value: 'alert' },
  { label: 'Warnings', value: 'warning' },
  { label: 'Everything', value: 'all' },
];

/** Why push can't work here, in plain language, or null when it can. */
export function unsupportedReason() {
  if (!window.isSecureContext) {
    return 'Notifications need Deckarr to be opened over https://. Browsers don’t allow them over plain http://. Set up Tailscale Serve or a reverse proxy with HTTPS, then open Deckarr from that address.';
  }
  if (platform() === 'ios' && !isInstalled()) {
    return 'On iPhone and iPad, add Deckarr to your Home Screen first (Share, then Add to Home Screen), then open it from the icon to turn on notifications. Needs iOS 16.4 or newer.';
  }
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
    return 'This browser doesn’t support notifications.';
  }
  return null;
}

const keyBytes = (b64url) => Uint8Array.from(atob(b64url.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));

function deviceName() {
  const p = platform();
  if (p === 'ios') return /iPad/.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && /Macintosh/.test(navigator.userAgent)) ? 'iPad' : 'iPhone';
  if (p.startsWith('android')) return 'Android';
  return 'Browser';
}

async function registration() {
  return navigator.serviceWorker.ready;
}

/** The level this device gets ('alert', 'warning', 'all'), or null when notifications are off. */
export async function currentLevel() {
  const sub = await (await registration()).pushManager.getSubscription();
  if (!sub) return null;
  const found = await api('/api/push/find', { method: 'POST', body: { endpoint: sub.endpoint } });
  return found?.level || null;
}

/** Asks for permission and subscribes. Must be called from a tap. */
export async function enable(level) {
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') {
    throw new Error('Notifications are blocked for Deckarr. Allow them in your browser or system settings, then try again.');
  }
  const reg = await registration();
  const { publicKey } = await api('/api/push/key');
  let sub = await reg.pushManager.getSubscription();
  // A subscription made for another server key (for example after a reinstall) can't be reused.
  if (sub && sub.options?.applicationServerKey) {
    const current = new Uint8Array(sub.options.applicationServerKey);
    const wanted = keyBytes(publicKey);
    if (current.length !== wanted.length || current.some((b, i) => b !== wanted[i])) {
      await sub.unsubscribe();
      sub = null;
    }
  }
  if (!sub) {
    try {
      sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(publicKey) });
    } catch (err) {
      throw new Error(subscribeError(err));
    }
  }
  await api('/api/push/subscribe', { method: 'POST', body: { subscription: sub.toJSON(), level, name: deviceName() } });
}

function subscribeError(err) {
  const base = 'The browser couldn’t set up notifications.';
  if (platform() === 'android') {
    // Chromium browsers deliver push through Google's service; without Google Play
    // (for example GrapheneOS without sandboxed Google Play) there is nothing to deliver it.
    return `${base} Chrome, Vanadium and other Chromium browsers need Google Play services for notifications. On GrapheneOS, install sandboxed Google Play, or use Firefox, which has its own push service.`;
  }
  return `${base} ${err?.message || ''}`.trim();
}

export async function setLevel(level) {
  const sub = await (await registration()).pushManager.getSubscription();
  if (!sub) throw new Error('Notifications are off on this device.');
  await api('/api/push/subscribe', { method: 'POST', body: { subscription: sub.toJSON(), level, name: deviceName() } });
}

export async function disable() {
  const sub = await (await registration()).pushManager.getSubscription();
  if (!sub) return;
  await api('/api/push/unsubscribe', { method: 'POST', body: { endpoint: sub.endpoint } }).catch(() => {});
  await sub.unsubscribe();
}

export async function sendTest() {
  const sub = await (await registration()).pushManager.getSubscription();
  if (!sub) throw new Error('Notifications are off on this device.');
  await api('/api/push/test', { method: 'POST', body: { endpoint: sub.endpoint } });
}
