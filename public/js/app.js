import { api, events } from './api.js';
import './install.js';
import { h, icon, notice } from './ui.js';
import * as home from './views/home.js';
import * as library from './views/library.js';
import * as activity from './views/activity.js';
import * as server from './views/server.js';
import * as settings from './views/settings.js';

const TABS = [
  { id: 'home', label: 'Home', icon: 'home', view: home },
  { id: 'library', label: 'Library', icon: 'library', view: library },
  { id: 'activity', label: 'Activity', icon: 'activity', view: activity },
  { id: 'server', label: 'Server', icon: 'server', view: server },
  { id: 'settings', label: 'Settings', icon: 'settings', view: settings },
];

const app = document.getElementById('app');

const state = {
  services: [],
  types: {},
  auth: {},
};

let viewEl;
let tabLinks = {};
let current = { id: null, dispose: [] };

function parseHash() {
  const [, id = 'home', query = ''] = location.hash.match(/^#\/(\w+)\??(.*)$/) || [];
  return { id, params: new URLSearchParams(query) };
}

export function navigate(id, params) {
  const qs = params ? `?${new URLSearchParams(params)}` : '';
  const target = `#/${id}${qs}`;
  if (location.hash === target) route();
  else location.hash = target;
}

async function reloadServices() {
  const [services, types] = await Promise.all([api('/api/services'), Object.keys(state.types).length ? state.types : api('/api/types')]);
  state.services = services;
  state.types = types;
  return services;
}

function makeContext() {
  const dispose = [];
  current.dispose = dispose;
  return {
    state,
    navigate,
    reloadServices,
    rerender: () => route(true),
    onDispose: (fn) => dispose.push(fn),
    // Repeats fn while this tab is open and the app is visible.
    poll(fn, ms) {
      const tick = () => {
        if (document.visibilityState === 'visible') fn();
      };
      const timer = setInterval(tick, ms);
      const onVisible = () => {
        if (document.visibilityState === 'visible') fn();
      };
      document.addEventListener('visibilitychange', onVisible);
      dispose.push(() => {
        clearInterval(timer);
        document.removeEventListener('visibilitychange', onVisible);
      });
    },
  };
}

function route(keepScroll = false) {
  const { id, params } = parseHash();
  const tab = TABS.find((t) => t.id === id) || TABS[0];
  current.dispose.forEach((fn) => fn());
  const sameTab = current.id === tab.id;
  current.id = tab.id;

  for (const [tid, link] of Object.entries(tabLinks)) {
    if (tid === tab.id) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  }

  const root = h('div', { class: 'page' });
  viewEl.replaceChildren(root);
  if (!(keepScroll && sameTab)) window.scrollTo(0, 0);
  document.title = `${tab.label} · Deckarr`;
  tab.view.render(root, makeContext(), params);
}

function renderShell() {
  document.body.classList.remove('gate-mode');
  viewEl = h('main', { id: 'view' });
  tabLinks = {};
  const nav = h(
    'nav',
    { class: 'tabbar', 'aria-label': 'Sections' },
    TABS.map((t) => {
      const link = h('a', { class: 'tab', href: `#/${t.id}` }, icon(t.icon, 25), h('span', { text: t.label }));
      // Tapping the tab you're on scrolls to the top.
      link.addEventListener('click', (e) => {
        if (current.id === t.id && location.hash.startsWith(`#/${t.id}`)) {
          e.preventDefault();
          window.scrollTo({ top: 0, behavior: 'smooth' });
        }
      });
      tabLinks[t.id] = link;
      return link;
    }),
  );
  app.replaceChildren(viewEl, nav);
}

function renderGate(mode) {
  current.dispose.forEach((fn) => fn());
  current = { id: null, dispose: [] };
  viewEl = null;
  document.body.classList.add('gate-mode');
  document.querySelectorAll('.sheet, .sheet-scrim').forEach((el) => el.remove());
  document.documentElement.classList.remove('locked');

  const setup = mode === 'setup';
  const error = h('p', { class: 'error', role: 'alert' });
  error.hidden = true;
  const password = h('input', {
    type: 'password',
    autocomplete: setup ? 'new-password' : 'current-password',
    placeholder: setup ? 'At least 8 characters' : 'Password',
    'aria-label': 'Password',
    required: true,
  });
  const confirm = setup
    ? h('input', { type: 'password', autocomplete: 'new-password', placeholder: 'Type it again', 'aria-label': 'Confirm password', required: true })
    : null;
  const submit = h('button', { type: 'submit', class: 'btn btn-primary btn-block' }, setup ? 'Create password' : 'Sign in');

  const form = h(
    'form',
    { class: 'gate-card', novalidate: true },
    h('img', { class: 'gate-icon', src: 'icons/icon-192.png', alt: '' }),
    h('h1', { text: setup ? 'Welcome to Deckarr' : 'Sign in to Deckarr' }),
    h('p', {
      text: setup
        ? 'Create a password to protect your server controls. You’ll use it once on each device.'
        : 'Enter the password you created for Deckarr.',
    }),
    h('div', { class: 'list' }, h('label', { class: 'field' }, h('span', { text: setup ? 'New password' : 'Password' }), password), confirm ? h('label', { class: 'field' }, h('span', { text: 'Confirm password' }), confirm) : null),
    error,
    h('div', { class: 'stack' }, submit),
  );

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    error.hidden = true;
    if (setup && password.value.length < 8) {
      error.textContent = 'Use at least 8 characters.';
      error.hidden = false;
      return;
    }
    if (setup && password.value !== confirm.value) {
      error.textContent = 'The passwords don’t match.';
      error.hidden = false;
      return;
    }
    submit.disabled = true;
    try {
      await api(setup ? '/api/auth/setup' : '/api/auth/login', { method: 'POST', body: { password: password.value } });
      await start();
    } catch (err) {
      error.textContent = err.message;
      error.hidden = false;
      submit.disabled = false;
      password.select();
    }
  });

  app.replaceChildren(h('div', { class: 'gate' }, form));
  setTimeout(() => password.focus(), 50);
}

async function start() {
  await reloadServices();
  renderShell();
  route();
}

let routing = false;
async function boot() {
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
  events.on('unauthorized', () => renderGate('login'));

  let status;
  try {
    status = await api('/api/auth/status');
  } catch (err) {
    document.body.classList.add('gate-mode');
    app.replaceChildren(h('div', { class: 'gate' }, h('div', { class: 'gate-card' }, notice(err.message, { retry: () => location.reload() }))));
    return;
  }
  state.auth = status;
  if (!routing) {
    window.addEventListener('hashchange', () => viewEl && route());
    routing = true;
  }
  if (!status.setUp) return renderGate('setup');
  if (!status.signedIn) return renderGate('login');
  try {
    await start();
  } catch (err) {
    app.replaceChildren(h('div', { class: 'gate' }, h('div', { class: 'gate-card' }, notice(err.message, { retry: () => location.reload() }))));
  }
}

boot();
