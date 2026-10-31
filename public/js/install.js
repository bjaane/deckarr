// Adding Deckarr to the home screen. Chromium browsers on Android (Chrome, Vanadium on
// GrapheneOS, Samsung Internet, Edge) and on desktop offer an install prompt; Safari and
// Firefox need the browser's own menu.

let deferred = null;
const listeners = new Set();

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferred = e;
  listeners.forEach((fn) => fn());
});

window.addEventListener('appinstalled', () => {
  deferred = null;
  listeners.forEach((fn) => fn());
});

export const canPrompt = () => Boolean(deferred);

export function onInstallChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Shows the browser's install dialog. Resolves true when the user accepted. */
export async function promptInstall() {
  if (!deferred) return false;
  const e = deferred;
  deferred = null;
  e.prompt();
  const { outcome } = await e.userChoice;
  listeners.forEach((fn) => fn());
  return outcome === 'accepted';
}

export function isInstalled() {
  return ['standalone', 'fullscreen', 'minimal-ui'].some((m) => window.matchMedia(`(display-mode: ${m})`).matches) || navigator.standalone === true;
}

export function platform() {
  const ua = navigator.userAgent;
  // iPadOS reports itself as a Mac; touch support gives it away.
  const ios = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  if (ios) return 'ios';
  if (/Android/i.test(ua)) return /Firefox/i.test(ua) ? 'android-firefox' : 'android';
  return 'other';
}

/** Plain-language steps for adding Deckarr to the home screen on this device. */
export function installSteps() {
  switch (platform()) {
    case 'ios':
      return 'In Safari, tap the Share button, then Add to Home Screen.';
    case 'android-firefox':
      return 'Open the Firefox menu (⋮), then tap Add to Home screen.';
    case 'android':
      return 'Open the browser menu (⋮), then tap Install app or Add to Home screen. This works in Chrome, Vanadium (GrapheneOS), Samsung Internet, Edge and Brave.';
    default:
      return 'Use your browser’s Install app or Add to Home Screen option, usually in its menu or the address bar.';
  }
}

/** Android browsers only make a full app over HTTPS; over plain http they add a browser shortcut. */
export const needsHttpsForApp = () => !window.isSecureContext && platform().startsWith('android');
