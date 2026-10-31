// Small DOM toolkit. No framework, no build step.

const ICONS = {
  home: '<path d="M3.5 10.6 12 3.8l8.5 6.8V19a1.5 1.5 0 0 1-1.5 1.5h-4.2v-5.6H9.2v5.6H5A1.5 1.5 0 0 1 3.5 19z"/>',
  library:
    '<rect x="3" y="4" width="5" height="16" rx="1.2"/><rect x="10" y="4" width="5" height="16" rx="1.2"/><path d="m17.2 5.3 3.3-.9 2 15.6-3.3.9z"/>',
  activity: '<path d="M12 3.5v10.5"/><path d="m7.5 9.6 4.5 4.5 4.5-4.5"/><path d="M4 15.5v3a1.5 1.5 0 0 0 1.5 1.5h13a1.5 1.5 0 0 0 1.5-1.5v-3"/>',
  server:
    '<rect x="3.5" y="4" width="17" height="7" rx="2"/><rect x="3.5" y="13" width="17" height="7" rx="2"/><path d="M7.5 7.5h.01M7.5 16.5h.01"/><path d="M11.5 7.5h5M11.5 16.5h5"/>',
  settings: '<path d="M4 7h9M18 7h2M4 17h3M12 17h8"/><circle cx="15.5" cy="7" r="2.3"/><circle cx="9.5" cy="17" r="2.3"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.2-4.2"/>',
  close: '<path d="M6 6l12 12M18 6 6 18"/>',
  chevron: '<path d="m9.5 6 6 6-6 6"/>',
  back: '<path d="m14.5 6-6 6 6 6"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  alert: '<path d="M12 8.5v5"/><path d="M12 17h.01"/><path d="M10.3 3.9 2.6 17.5A2 2 0 0 0 4.3 20.5h15.4a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/>',
  down: '<path d="M12 5v13"/><path d="m6.5 12.5 5.5 5.5 5.5-5.5"/>',
  up: '<path d="M12 19V6"/><path d="m6.5 11.5 5.5-5.5 5.5 5.5"/>',
  play: '<path d="M7 4.8v14.4a.8.8 0 0 0 1.2.7l11.3-7.2a.8.8 0 0 0 0-1.4L8.2 4.1a.8.8 0 0 0-1.2.7z"/>',
  pause: '<path d="M8 5v14M16 5v14"/>',
  stop: '<rect x="6" y="6" width="12" height="12" rx="2"/>',
  restart: '<path d="M4.5 12a7.5 7.5 0 1 0 2.3-5.4"/><path d="M4.5 4.5v4h4"/>',
  trash: '<path d="M4.5 7h15"/><path d="M9.5 7V4.8h5V7"/><path d="M6.5 7l.9 12.2a1.5 1.5 0 0 0 1.5 1.3h6.2a1.5 1.5 0 0 0 1.5-1.3L17.5 7"/>',
  external: '<path d="M13.5 4.5h6v6"/><path d="M19.5 4.5 11 13"/><path d="M18 14v4.5a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 4 18.5v-11A1.5 1.5 0 0 1 5.5 6H10"/>',
  refresh: '<path d="M19.5 12a7.5 7.5 0 0 1-13.1 5"/><path d="M4.5 12a7.5 7.5 0 0 1 13.1-5"/><path d="M17.6 3.5V7h-3.5M6.4 20.5V17h3.5"/>',
  eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/>',
  ban: '<circle cx="12" cy="12" r="8.5"/><path d="m6 6 12 12"/>',
};

export function icon(name, size = 22) {
  const span = document.createElement('span');
  span.className = 'ico';
  span.setAttribute('aria-hidden', 'true');
  span.innerHTML = `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${ICONS[name] || ''}</svg>`;
  return span;
}

export function chevron() {
  const el = icon('chevron', 18);
  el.classList.add('chev');
  return el;
}

const PROPS = new Set(['value', 'checked', 'disabled', 'hidden', 'selected', 'multiple']);

export function mount(el, children) {
  for (const child of [children].flat(Infinity)) {
    if (child == null || child === false || child === true) continue;
    el.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return el;
}

export function h(tag, props, ...children) {
  const el = document.createElement(tag);
  if (props) {
    for (const [key, value] of Object.entries(props)) {
      if (value == null || value === false) continue;
      if (key === 'class') el.className = value;
      else if (key === 'text') el.textContent = value;
      else if (key === 'style') {
        for (const [k, v] of Object.entries(value)) {
          if (k.startsWith('--')) el.style.setProperty(k, v);
          else el.style[k] = v;
        }
      } else if (key === 'dataset') Object.assign(el.dataset, value);
      else if (key.startsWith('on') && typeof value === 'function') el.addEventListener(key.slice(2).toLowerCase(), value);
      else if (PROPS.has(key)) el[key] = value;
      else el.setAttribute(key, value === true ? '' : value);
    }
  }
  return mount(el, children);
}

export const light = (state = '') => h('span', { class: `light ${state}`, 'aria-hidden': 'true' });

/** A light for normal states, a warning sign when something needs attention. */
export const statusMark = (state = '') =>
  state === 'warn' || state === 'bad' ? h('span', { class: `mark ${state}`, 'aria-hidden': 'true' }, icon('alert', 18)) : light(state);

export function bar(fraction, state = '') {
  const pct = Math.max(0, Math.min(1, Number(fraction) || 0)) * 100;
  return h(
    'div',
    { class: `bar ${state}`, role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': pct.toFixed(0) },
    h('i', { style: { '--p': `${pct.toFixed(1)}%` } }),
  );
}

export function initials(text = '') {
  const words = String(text).replace(/[^\p{L}\p{N} ]/gu, ' ').trim().split(/\s+/).filter(Boolean);
  return (words.length > 1 ? words[0][0] + words[1][0] : (words[0] || '?').slice(0, 2)).toUpperCase();
}

/** Poster image that walks through fallback URLs before showing initials. */
export function posterImg(sources, alt = '', { done = false, cls = 'poster' } = {}) {
  const wrap = h('div', { class: 'poster-wrap' });
  const empty = () => h('div', { class: `${cls} poster-empty`, role: 'img', 'aria-label': alt }, initials(alt));
  const list = (sources || []).filter(Boolean);
  if (!list.length) {
    wrap.append(empty());
  } else {
    let i = 0;
    const img = h('img', { class: cls, alt, loading: 'lazy', decoding: 'async', src: list[0] });
    img.addEventListener('error', () => {
      i += 1;
      if (i < list.length) img.src = list[i];
      else img.replaceWith(empty());
    });
    wrap.append(img);
  }
  if (done) wrap.append(h('span', { class: 'poster-done', title: 'Downloaded' }, icon('check', 14)));
  return wrap;
}

export function pageHead(title, sub, ...actions) {
  const titleEl = h('h1', { class: 'large-title', text: title });
  const subEl = h('p', { class: 'page-sub', text: sub || '' });
  if (!sub) subEl.hidden = true;
  const el = h('header', { class: 'page-head' }, h('div', null, titleEl, subEl), actions.length ? h('div', { class: 'page-actions' }, actions) : null);
  return {
    el,
    setTitle: (t) => (titleEl.textContent = t),
    setSub: (t) => {
      subEl.textContent = t || '';
      subEl.hidden = !t;
    },
  };
}

export function section(title, aside) {
  const asideEl = h('span', { class: 'section-aside' });
  if (aside instanceof Node) asideEl.append(aside);
  else if (aside) asideEl.textContent = aside;
  const body = h('div');
  const el = h('section', { class: 'section' }, h('div', { class: 'section-head' }, h('h2', { class: 'section-title', text: title }), asideEl), body);
  return {
    el,
    body,
    aside: asideEl,
    set: (...nodes) => mount(body.replaceChildren() ?? body, nodes),
    setAside: (content) => asideEl.replaceChildren(...(content == null ? [] : [content instanceof Node ? content : document.createTextNode(content)])),
  };
}

export const skeletonList = (rows = 3) => h('div', { class: 'list', 'aria-busy': 'true' }, Array.from({ length: rows }, () => h('div', { class: 'skel-row' })));

export const skeletonShelf = (n = 4) =>
  h('div', { class: 'shelf', 'aria-busy': 'true' }, Array.from({ length: n }, () => h('div', null, h('div', { class: 'poster skel' }))));

export function notice(message, { retry, kind = '' } = {}) {
  return h(
    'div',
    { class: `notice ${kind}`, role: 'alert' },
    icon('alert', 20),
    h('div', { class: 'notice-body' }, h('div', { text: message }), retry ? h('button', { class: 'link-btn', onClick: retry }, 'Try again') : null),
  );
}

export function emptyState({ title, body, action }) {
  return h(
    'div',
    { class: 'empty' },
    title ? h('h3', { text: title }) : null,
    body ? h('p', { text: body }) : null,
    action ? h('button', { class: 'btn btn-primary', onClick: action.onClick }, action.label) : null,
  );
}

export function segmented(options, value, onChange) {
  const el = h('div', { class: 'seg', role: 'group' });
  const draw = (current) => {
    el.replaceChildren(
      ...options.map((o) =>
        h('button', {
          type: 'button',
          'aria-pressed': String(o.value === current),
          text: o.label,
          onClick: () => {
            if (o.value === current) return;
            draw(o.value);
            onChange(o.value);
          },
        }),
      ),
    );
  };
  draw(value);
  return el;
}

export function chips(options, value, onChange) {
  const el = h('div', { class: 'chips', role: 'group' });
  let current = value;
  const draw = () =>
    el.replaceChildren(
      ...options.map((o) =>
        h('button', {
          type: 'button',
          class: 'chip',
          'aria-pressed': String(o.value === current),
          text: o.count != null ? `${o.label} ${o.count}` : o.label,
          onClick: () => {
            current = o.value;
            draw();
            onChange(o.value);
          },
        }),
      ),
    );
  draw();
  return { el, update(next) { options = next; draw(); } };
}

export function searchField(placeholder, onInput, { value = '', autofocus = false } = {}) {
  const input = h('input', {
    type: 'search',
    placeholder,
    value,
    autocomplete: 'off',
    autocorrect: 'off',
    autocapitalize: 'off',
    spellcheck: 'false',
    enterkeyhint: 'search',
    'aria-label': placeholder,
  });
  let timer;
  input.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(() => onInput(input.value.trim()), 180);
  });
  const el = h('label', { class: 'search' }, icon('search', 18), input);
  if (autofocus) setTimeout(() => input.focus(), 350);
  return { el, input };
}

export function switchInput(checked, onChange, label) {
  const input = h('input', { type: 'checkbox', class: 'switch', checked, role: 'switch', 'aria-label': label });
  input.addEventListener('change', () => onChange(input.checked, input));
  return input;
}

// ---------- sheets ----------

// Open sheets, newest last. The back button (Android, browsers) closes the newest one.
const openSheets = [];
const SHEET_STATE = 'deckarr-sheet';

// history.back() calls we made ourselves, so their popstate doesn't close the next sheet down.
let ownBacks = 0;
let ownBackTimer;
function dropSheetEntry() {
  ownBacks += 1;
  clearTimeout(ownBackTimer);
  ownBackTimer = setTimeout(() => (ownBacks = 0), 600);
  history.back();
}

window.addEventListener('popstate', (e) => {
  if (ownBacks > 0) {
    ownBacks -= 1;
    return;
  }
  const top = openSheets[openSheets.length - 1];
  if (top) {
    top.close({ fromHistory: true });
  } else if (e.state === SHEET_STATE) {
    // A sheet closed with its own button left this entry behind; skip it.
    dropSheetEntry();
  }
});

let lockCount = 0;
const lock = () => {
  lockCount += 1;
  document.documentElement.classList.add('locked');
};
const unlock = () => {
  lockCount = Math.max(0, lockCount - 1);
  if (!lockCount) document.documentElement.classList.remove('locked');
};

export function openSheet({ title = '', tall = false, onClose } = {}) {
  const scrim = h('div', { class: 'sheet-scrim' });
  const titleEl = h('h2', { class: 'sheet-title', text: title });
  const body = h('div', { class: 'sheet-body' });
  const closeBtn = h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Close' }, icon('close', 18));
  const head = h('div', { class: 'sheet-head' }, titleEl, closeBtn);
  const panel = h('div', { class: `sheet${tall ? ' tall' : ''}`, role: 'dialog', 'aria-modal': 'true', 'aria-label': title || 'Details' }, h('div', { class: 'sheet-grab' }), head, body);

  let closed = false;
  const previousFocus = document.activeElement;

  function close({ fromHistory = false } = {}) {
    if (closed) return;
    closed = true;
    const i = openSheets.indexOf(api);
    if (i !== -1) openSheets.splice(i, 1);
    // Closed with a button: drop the history entry the sheet added, so Back isn't needed twice.
    if (!fromHistory && history.state === SHEET_STATE) dropSheetEntry();
    panel.classList.remove('open');
    scrim.classList.remove('open');
    document.removeEventListener('keydown', onKey);
    setTimeout(() => {
      panel.remove();
      scrim.remove();
    }, 330);
    unlock();
    previousFocus?.focus?.({ preventScroll: true });
    onClose?.();
  }

  const onKey = (e) => {
    if (e.key === 'Escape') close();
  };

  // Drag the header down to dismiss.
  let startY = null;
  let delta = 0;
  head.addEventListener('touchstart', (e) => {
    startY = e.touches[0].clientY;
    delta = 0;
    panel.classList.add('dragging');
  }, { passive: true });
  head.addEventListener('touchmove', (e) => {
    if (startY == null) return;
    delta = Math.max(0, e.touches[0].clientY - startY);
    panel.style.transform = `translateY(${delta}px)`;
  }, { passive: true });
  head.addEventListener('touchend', () => {
    panel.classList.remove('dragging');
    panel.style.transform = '';
    if (delta > 90) close();
    startY = null;
  });

  closeBtn.addEventListener('click', close);
  scrim.addEventListener('click', close);
  document.addEventListener('keydown', onKey);

  document.body.append(scrim, panel);
  lock();
  history.pushState(SHEET_STATE, '');
  requestAnimationFrame(() => {
    scrim.classList.add('open');
    panel.classList.add('open');
    closeBtn.focus({ preventScroll: true });
  });

  const api = {
    el: panel,
    body,
    close,
    get closed() {
      return closed;
    },
    setTitle: (t) => (titleEl.textContent = t),
    set: (...nodes) => {
      body.replaceChildren();
      mount(body, nodes);
      body.scrollTop = 0;
    },
  };
  openSheets.push(api);
  return api;
}

/** Bottom action sheet. Resolves with the chosen action's value, or null. */
export function actionSheet({ title, message, actions }) {
  return new Promise((resolve) => {
    let chosen = null;
    const sheet = openSheet({ title, onClose: () => resolve(chosen) });
    sheet.set(
      message ? h('p', { class: 'sheet-msg', text: message }) : null,
      h(
        'div',
        { class: 'list' },
        actions.map((a) =>
          h(
            'button',
            {
              type: 'button',
              class: `row action${a.destructive ? ' destructive' : ''}`,
              onClick: () => {
                chosen = a.value ?? a.label;
                sheet.close();
              },
            },
            a.label,
          ),
        ),
      ),
      h('button', { type: 'button', class: 'btn btn-block cancel', onClick: () => sheet.close() }, 'Cancel'),
    );
  });
}

export async function confirmAction({ title, message, label, destructive = true }) {
  const result = await actionSheet({ title, message, actions: [{ label, value: true, destructive }] });
  return result === true;
}

// ---------- toast ----------

let toastRoot;
export function toast(message, kind = '') {
  if (!toastRoot) {
    toastRoot = h('div', { class: 'toast-root', role: 'status', 'aria-live': 'polite' });
    document.body.append(toastRoot);
  }
  const el = h('div', { class: `toast ${kind}`, text: message });
  toastRoot.replaceChildren(el);
  requestAnimationFrame(() => el.classList.add('show'));
  setTimeout(() => {
    el.classList.remove('show');
    setTimeout(() => el.remove(), 250);
  }, kind === 'bad' ? 4200 : 2600);
}

/** Runs an async action from a button, showing a spinner and a toast. */
export async function runAction(button, fn, { success, failure } = {}) {
  if (button) button.disabled = true;
  try {
    const result = await fn();
    if (success) toast(typeof success === 'function' ? success(result) : success);
    return result;
  } catch (err) {
    toast(failure ? `${failure} ${err.message}` : err.message, 'bad');
    return undefined;
  } finally {
    if (button) button.disabled = false;
  }
}

// ---------- formatting ----------

const UNITS = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];

export const fmt = {
  bytes(n) {
    let value = Number(n) || 0;
    if (value < 1024) return `${value} B`;
    let i = 0;
    while (value >= 1024 && i < UNITS.length - 1) {
      value /= 1024;
      i += 1;
    }
    return `${value >= 100 ? value.toFixed(0) : value.toFixed(1)} ${UNITS[i]}`;
  },
  speed(n) {
    return `${fmt.bytes(n)}/s`;
  },
  eta(seconds) {
    const s = Number(seconds);
    if (!Number.isFinite(s) || s <= 0 || s >= 8640000) return '';
    if (s < 60) return 'Under a minute';
    const m = Math.round(s / 60);
    if (m < 60) return `${m} min`;
    const hrs = Math.floor(m / 60);
    if (hrs < 24) return m % 60 ? `${hrs} h ${m % 60} min` : `${hrs} h`;
    const d = Math.floor(hrs / 24);
    return hrs % 24 ? `${d} d ${hrs % 24} h` : `${d} d`;
  },
  // "1.02:03:04" or "02:03:04" -> seconds
  timeleft(value) {
    if (!value) return null;
    const m = String(value).match(/^(?:(\d+)\.)?(\d+):(\d+):(\d+)/);
    if (!m) return null;
    return (Number(m[1] || 0) * 86400) + Number(m[2]) * 3600 + Number(m[3]) * 60 + Number(m[4]);
  },
  percent(fraction) {
    const p = Math.max(0, Math.min(1, Number(fraction) || 0)) * 100;
    return p >= 99.95 ? '100%' : `${p < 10 ? p.toFixed(1) : p.toFixed(0)}%`;
  },
  dayLabel(date) {
    const d = new Date(date);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const day = new Date(d);
    day.setHours(0, 0, 0, 0);
    const diff = Math.round((day - today) / 86400000);
    if (diff === 0) return 'Today';
    if (diff === 1) return 'Tomorrow';
    if (diff === -1) return 'Yesterday';
    return new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric' }).format(d);
  },
  isToday(date) {
    return new Date(date).toDateString() === new Date().toDateString();
  },
  time(date) {
    return new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit' }).format(new Date(date));
  },
  weekday(date = new Date()) {
    return new Intl.DateTimeFormat('en-GB', { weekday: 'long' }).format(date);
  },
  longDate(date = new Date()) {
    return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }).format(date);
  },
  count(n, singular, plural = `${singular}s`) {
    return `${n} ${n === 1 ? singular : plural}`;
  },
  // "PARITY_CHECK" -> "Parity check"
  sentence(value) {
    const t = String(value || '').toLowerCase().replace(/_/g, ' ');
    return t.charAt(0).toUpperCase() + t.slice(1);
  },
  since(date) {
    const t = new Date(date).getTime();
    if (!Number.isFinite(t)) return '';
    return fmt.eta((Date.now() - t) / 1000);
  },
};
