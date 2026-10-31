// Unraid detail sheets opened from the Server tab: disks, shares, parity, notifications, logs, containers, VMs.

import { h, light, bar, fmt, openSheet, skeletonList, notice, chips, actionSheet, confirmAction, runAction, icon } from '../ui.js';
import { unraid, webBase } from '../services.js';

const cap = (v) => {
  const t = String(v || '').toLowerCase().replace(/_/g, ' ');
  return t.charAt(0).toUpperCase() + t.slice(1);
};

const tempState = (t, warn = 45, crit = 55) => (t == null ? '' : t >= crit ? 'bad' : t >= warn ? 'warn' : 'ok');

/** Loads into a sheet with a skeleton, an error with retry, and a refresh helper. */
function loader(sheet, load, draw) {
  const run = async (first = false) => {
    if (first) sheet.set(skeletonList(4));
    try {
      draw(await load());
    } catch (err) {
      sheet.set(notice(err.message, { retry: () => run(true) }));
    }
  };
  run(true);
  return run;
}

// ---------- disks ----------

const DISK_STATUS = {
  DISK_OK: ['ok', 'Normal'],
  DISK_NP: ['', 'Not installed'],
  DISK_NP_MISSING: ['bad', 'Missing'],
  DISK_INVALID: ['bad', 'Invalid'],
  DISK_WRONG: ['bad', 'Wrong disk'],
  DISK_DSBL: ['bad', 'Disabled'],
  DISK_NP_DSBL: ['bad', 'Disabled, not installed'],
  DISK_DSBL_NEW: ['warn', 'Disabled, new disk'],
  DISK_NEW: ['warn', 'New disk'],
};

function diskRow(d) {
  const [state, label] = DISK_STATUS[d.status] || ['', cap(d.status)];
  const errors = Number(d.numErrors) || 0;
  const size = Number(d.fsSize) * 1024 || Number(d.size) * 1024 || 0;
  const used = Number(d.fsUsed) * 1024 || 0;
  const spun = d.isSpinning === false ? 'Spun down' : d.temp != null ? `${d.temp} °C` : null;
  const sub = [d.device, label !== 'Normal' ? label : null, errors ? fmt.count(errors, 'error') : null, d.fsType].filter(Boolean).join(' · ');
  return h(
    'div',
    { class: 'row' },
    light(errors || state === 'bad' ? 'bad' : d.isSpinning === false ? '' : tempState(d.temp, d.warning || 45, d.critical || 55) || state),
    h(
      'span',
      { class: 'row-main' },
      h('span', { class: 'row-title', text: cap(d.name) || d.device || 'Disk' }),
      h('span', { class: 'row-sub', text: sub }),
      used && size ? bar(used / size, used / size > 0.9 ? 'bad' : used / size > 0.8 ? 'warn' : 'ok') : null,
    ),
    h('span', { class: 'row-trail' }, h('b', { text: spun || '' }), size ? (used ? `${fmt.bytes(size - used)} free` : fmt.bytes(size)) : ''),
  );
}

export function openDisks(s) {
  const sheet = openSheet({ title: 'Disks', tall: true });
  loader(
    sheet,
    () => unraid.disks(s),
    (a) => {
      const groups = [
        ['Parity', a.parities],
        ['Array', a.disks],
        ['Cache pools', a.caches],
      ].filter(([, list]) => list?.length);
      const present = (list) => list.filter((d) => d.status !== 'DISK_NP');
      sheet.set(
        groups.map(([label, list]) => [h('p', { class: 'group-label', text: label }), h('div', { class: 'list' }, present(list).map(diskRow))]),
        h('p', { class: 'hint', text: 'Opening this list asks Unraid for disk details, which can wake sleeping disks.' }),
      );
    },
  );
}

// ---------- shares ----------

export function openShares(s) {
  const sheet = openSheet({ title: 'Shares', tall: true });
  loader(
    sheet,
    () => unraid.shares(s),
    (shares) => {
      if (!shares.length) return sheet.set(h('p', { class: 'quiet', text: 'No user shares.' }));
      shares.sort((a, b) => String(a.name).localeCompare(String(b.name)));
      sheet.set(
        h(
          'div',
          { class: 'list' },
          shares.map((sh) => {
            const used = Number(sh.used) * 1024 || 0;
            const free = Number(sh.free) * 1024 || 0;
            return h(
              'div',
              { class: 'row' },
              h('span', { class: 'row-main' }, h('span', { class: 'row-title', text: sh.name }), h('span', { class: 'row-sub', text: sh.comment || (sh.cache ? 'Uses cache' : '') })),
              h('span', { class: 'row-trail' }, h('b', { text: used ? fmt.bytes(used) : '' }), free ? `${fmt.bytes(free)} free` : ''),
            );
          }),
        ),
      );
    },
  );
}

// ---------- parity ----------

export function openParity(s, { onChange } = {}) {
  const sheet = openSheet({ title: 'Parity check', tall: true });
  const act = async (button, action, correct) => {
    const verb = { start: 'Parity check started', pause: 'Parity check paused', resume: 'Parity check resumed', cancel: 'Parity check cancelled' }[action];
    const res = await runAction(button, () => unraid.parityAction(s, action, correct), { success: verb });
    if (res !== undefined) {
      setTimeout(() => refresh(), 1500);
      onChange?.();
    }
  };
  const refresh = loader(
    sheet,
    () => unraid.parity(s),
    ({ status, history }) => {
      const running = status?.running;
      const buttons = [];
      if (running) {
        const pr = h('button', { type: 'button', class: 'btn' }, status.paused ? 'Resume' : 'Pause');
        pr.addEventListener('click', () => act(pr, status.paused ? 'resume' : 'pause'));
        const cancel = h('button', { type: 'button', class: 'btn btn-danger' }, 'Cancel check');
        cancel.addEventListener('click', async () => {
          if (await confirmAction({ title: 'Cancel the parity check?', label: 'Cancel check' })) act(cancel, 'cancel');
        });
        buttons.push(pr, cancel);
      } else {
        const start = h('button', { type: 'button', class: 'btn btn-primary' }, 'Start check');
        start.addEventListener('click', async () => {
          const choice = await actionSheet({
            title: 'Start a parity check',
            message: 'A check reads every disk and can take many hours.',
            actions: [
              { label: 'Check and correct errors', value: 'correct' },
              { label: 'Check only (read-only)', value: 'check' },
            ],
          });
          if (choice) act(start, 'start', choice === 'correct');
        });
        buttons.push(start);
      }
      const progress = Number(status?.progress) || 0;
      sheet.set(
        h(
          'div',
          { class: 'list' },
          h(
            'div',
            { class: 'panel' },
            h('div', { class: 'panel-title' }, light(running ? (status.paused ? 'warn' : 'active') : status?.status === 'FAILED' ? 'bad' : 'ok'), running ? (status.paused ? 'Paused' : status.correcting ? 'Checking and correcting' : 'Checking') : cap(status?.status || 'never run')),
            running ? bar(progress / 100, status.paused ? 'paused' : '') : null,
            h('div', { class: 'panel-sub', text: [running ? `${progress}%` : null, status?.speed ? `${status.speed}` : null, status?.errors ? fmt.count(Number(status.errors), 'error') : running ? 'No errors so far' : null].filter(Boolean).join(' · ') }),
          ),
        ),
        h('div', { class: 'btn-row' }, buttons),
        history?.length
          ? [
              h('p', { class: 'group-label', text: 'History' }),
              h(
                'div',
                { class: 'list' },
                history
                  .slice()
                  .sort((a, b) => new Date(b.date) - new Date(a.date))
                  .slice(0, 20)
                  .map((p) =>
                    h(
                      'div',
                      { class: 'row' },
                      light(p.status === 'COMPLETED' && !p.errors ? 'ok' : p.status === 'CANCELLED' ? '' : 'bad'),
                      h(
                        'span',
                        { class: 'row-main' },
                        h('span', { class: 'row-title', text: p.date ? fmt.longDate(new Date(p.date)) : 'Unknown date' }),
                        h('span', { class: 'row-sub', text: [cap(p.status), p.duration ? fmt.eta(p.duration) : null, p.speed].filter(Boolean).join(' · ') }),
                      ),
                      h('span', { class: 'row-trail', text: p.errors ? fmt.count(Number(p.errors), 'error') : '' }),
                    ),
                  ),
              ),
            ]
          : null,
      );
    },
  );
}

// ---------- notifications ----------

const IMPORTANCE = { ALERT: 'bad', WARNING: 'warn', INFO: 'ok' };

export function openNotifications(s, { onChange } = {}) {
  const sheet = openSheet({ title: 'Notifications', tall: true });
  let type = 'UNREAD';
  let level = 'all';
  let data = null;

  const reload = async (first = false) => {
    if (first) sheet.set(skeletonList(4));
    try {
      data = await unraid.notifications(s, type);
      draw();
    } catch (err) {
      sheet.set(notice(err.message, { retry: () => reload(true) }));
    }
  };

  const changed = () => {
    onChange?.();
    reload();
  };

  async function itemActions(n) {
    const actions = type === 'UNREAD'
      ? [{ label: 'Archive', value: 'archive' }, { label: 'Delete', value: 'delete', destructive: true }]
      : [{ label: 'Mark as unread', value: 'unread' }, { label: 'Delete', value: 'delete', destructive: true }];
    if (n.link) actions.unshift({ label: 'Open link', value: 'open' });
    const choice = await actionSheet({ title: n.subject || n.title, message: n.description, actions });
    if (!choice) return;
    if (choice === 'open') return window.open(n.link, '_blank', 'noopener');
    const fn = { archive: () => unraid.archiveNotification(s, n.id), unread: () => unraid.unreadNotification(s, n.id), delete: () => unraid.deleteNotification(s, n.id, type) }[choice];
    if ((await runAction(null, fn, { success: { archive: 'Archived', unread: 'Marked as unread', delete: 'Deleted' }[choice] })) !== undefined) changed();
  }

  function draw() {
    const list = (data.list || []).filter((n) => level === 'all' || n.importance === level);
    const counts = data.overview || {};
    const tabs = chips(
      [
        { label: 'Unread', value: 'UNREAD', count: counts.unread?.total },
        { label: 'Archived', value: 'ARCHIVE', count: counts.archive?.total },
      ],
      type,
      (v) => {
        type = v;
        reload(true);
      },
    );
    const levels = chips(
      [
        { label: 'All', value: 'all' },
        { label: 'Alerts', value: 'ALERT' },
        { label: 'Warnings', value: 'WARNING' },
        { label: 'Info', value: 'INFO' },
      ],
      level,
      (v) => {
        level = v;
        draw();
      },
    );
    const bulk = h('button', { type: 'button', class: 'btn btn-small' }, type === 'UNREAD' ? 'Archive all' : 'Delete all archived');
    bulk.addEventListener('click', async () => {
      if (type === 'UNREAD') {
        if ((await runAction(bulk, () => unraid.archiveAll(s), { success: 'All archived' })) !== undefined) changed();
      } else if (await confirmAction({ title: 'Delete all archived notifications?', label: 'Delete all' })) {
        if ((await runAction(bulk, () => unraid.deleteArchived(s), { success: 'Archived notifications deleted' })) !== undefined) changed();
      }
    });
    sheet.set(
      tabs.el,
      levels.el,
      h('div', { style: { height: '12px' } }),
      list.length
        ? h(
            'div',
            { class: 'list' },
            list.map((n) =>
              h(
                'button',
                { type: 'button', class: 'row', onClick: () => itemActions(n) },
                light(IMPORTANCE[n.importance] || ''),
                h(
                  'span',
                  { class: 'row-main' },
                  h('span', { class: 'row-title', text: n.subject || n.title }),
                  h('span', { class: 'row-sub wrap', text: [n.description, n.timestamp ? `${fmt.dayLabel(n.timestamp)} ${fmt.time(n.timestamp)}` : null].filter(Boolean).join(' · ') }),
                ),
              ),
            ),
          )
        : h('p', { class: 'quiet', text: type === 'UNREAD' ? 'No unread notifications.' : 'No archived notifications.' }),
      data.list?.length ? h('div', { class: 'btn-row' }, bulk) : null,
    );
  }

  reload(true);
}

// ---------- logs ----------

function logView(text) {
  const pre = h('pre', { class: 'log', text: text || 'The log is empty.' });
  requestAnimationFrame(() => (pre.scrollTop = pre.scrollHeight));
  return pre;
}

function filterLines(text, q) {
  if (!q) return text;
  const needle = q.toLowerCase();
  return text
    .split('\n')
    .filter((l) => l.toLowerCase().includes(needle))
    .join('\n');
}

function logSearch(onInput) {
  const input = h('input', { type: 'search', placeholder: 'Filter lines', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', 'aria-label': 'Filter lines' });
  input.addEventListener('input', () => onInput(input.value.trim()));
  return h('label', { class: 'search' }, icon('search', 18), input);
}

export function openLogs(s) {
  const sheet = openSheet({ title: 'System logs', tall: true });
  loader(
    sheet,
    () => unraid.logFiles(s),
    (files) => {
      files.sort((a, b) => (a.name === 'syslog' ? -1 : b.name === 'syslog' ? 1 : new Date(b.modifiedAt) - new Date(a.modifiedAt)));
      sheet.set(
        h(
          'div',
          { class: 'list' },
          files.map((f) =>
            h(
              'button',
              { type: 'button', class: 'row', onClick: () => openLogFile(s, f) },
              h('span', { class: 'row-main' }, h('span', { class: 'row-title', text: f.name }), h('span', { class: 'row-sub', text: f.path })),
              h('span', { class: 'row-trail', text: fmt.bytes(f.size) }),
            ),
          ),
        ),
      );
    },
  );
}

function openLogFile(s, f) {
  const sheet = openSheet({ title: f.name, tall: true });
  let content = '';
  let q = '';
  const out = h('div');
  const draw = () => out.replaceChildren(logView(filterLines(content, q)));
  const refresh = h('button', { type: 'button', class: 'btn btn-small' }, 'Refresh');
  const load = async () => {
    try {
      const d = await unraid.logFile(s, f.path, 500);
      content = d?.content || '';
      draw();
    } catch (err) {
      out.replaceChildren(notice(err.message, { retry: load }));
    }
  };
  refresh.addEventListener('click', () => runAction(refresh, load));
  sheet.set(logSearch((v) => ((q = v), draw())), h('div', { style: { height: '12px' } }), out, h('div', { class: 'btn-row' }, refresh));
  out.append(skeletonList(4));
  load();
}

// ---------- container details ----------

export function openContainer(s, c, name, { onAction } = {}) {
  const sheet = openSheet({ title: name, tall: true });
  const running = c.state === 'RUNNING';
  const paused = c.state === 'PAUSED';

  const actions = [];
  const add = (label, action, cls = 'btn') => {
    const b = h('button', { type: 'button', class: `${cls} btn-small` }, label);
    b.addEventListener('click', () => onAction?.(action, b));
    actions.push(b);
  };
  if (running) {
    if (c.webUiUrl) {
      const open = h('button', { type: 'button', class: 'btn btn-small' }, 'Open web UI');
      open.addEventListener('click', () => window.open(c.webUiUrl, '_blank', 'noopener'));
      actions.push(open);
    }
    add('Restart', 'restart');
    add('Pause', 'pause');
    add('Stop', 'stop', 'btn btn-danger');
  } else if (paused) {
    add('Resume', 'unpause', 'btn btn-primary');
    add('Stop', 'stop', 'btn btn-danger');
  } else {
    add('Start', 'start', 'btn btn-primary');
  }
  if (c.isUpdateAvailable) add('Update', 'updateContainer', 'btn btn-primary');

  const ports = (c.ports || []).filter((p) => p.publicPort || p.privatePort);
  const portText = [...new Set(ports.map((p) => (p.publicPort ? `${p.publicPort} → ${p.privatePort}/${String(p.type || '').toLowerCase()}` : `${p.privatePort}/${String(p.type || '').toLowerCase()}`)))].join(', ');

  const info = [
    ['Status', c.status || cap(c.state)],
    ['Image', c.image],
    portText ? ['Ports', portText] : null,
    ['Autostart', c.autoStart ? 'On' : 'Off'],
    c.isUpdateAvailable != null ? ['Update', c.isUpdateAvailable ? 'Available' : 'Up to date'] : null,
  ].filter(Boolean);

  let lines = [];
  let q = '';
  const logOut = h('div');
  const drawLogs = () => {
    const text = lines.map((l) => l.message).join('\n');
    logOut.replaceChildren(logView(filterLines(text, q)));
  };
  const loadLogs = async () => {
    try {
      lines = await unraid.containerLogs(s, c.id, 300);
      drawLogs();
    } catch (err) {
      logOut.replaceChildren(notice(/Cannot query field/i.test(err.message) ? 'Container logs need a newer Unraid API.' : err.message, { retry: loadLogs }));
    }
  };
  const refresh = h('button', { type: 'button', class: 'btn btn-small' }, 'Refresh');
  refresh.addEventListener('click', () => runAction(refresh, loadLogs));

  sheet.set(
    h('div', { class: 'btn-row wrap' }, actions),
    h('div', { class: 'list' }, info.map(([k, v]) => h('div', { class: 'row' }, h('span', { class: 'row-main row-title', text: k }), h('span', { class: 'row-trail wrap', text: v })))),
    h('p', { class: 'group-label', text: 'Logs' }),
    logSearch((v) => ((q = v), drawLogs())),
    h('div', { style: { height: '12px' } }),
    logOut,
    h('div', { class: 'btn-row' }, refresh),
  );
  logOut.append(skeletonList(3));
  loadLogs();
  return sheet;
}

// ---------- virtual machines ----------

export const VM_LABEL = {
  RUNNING: ['ok', 'Running'],
  IDLE: ['ok', 'Running (idle)'],
  PAUSED: ['warn', 'Paused'],
  PMSUSPENDED: ['warn', 'Suspended'],
  SHUTDOWN: ['', 'Shutting down'],
  SHUTOFF: ['', 'Stopped'],
  NOSTATE: ['', 'Stopped'],
  CRASHED: ['bad', 'Crashed'],
};

export const vmState = (vm) => VM_LABEL[vm.state] || ['', fmt.sentence(vm.state)];
export const vmRunning = (vm) => vm.state === 'RUNNING' || vm.state === 'IDLE';
export const vmPaused = (vm) => vm.state === 'PAUSED' || vm.state === 'PMSUSPENDED';

const VM_DONE = {
  start: 'Starting',
  stop: 'Shutting down',
  pause: 'Paused',
  resume: 'Resumed',
  reboot: 'Restarting',
  forceStop: 'Force stopped',
  reset: 'Reset',
};

/** Runs a VM action with the confirmations a destructive one needs. Resolves true when it went through. */
export async function runVmAction(s, vm, action, button) {
  if (action === 'forceStop' && !(await confirmAction({ title: `Force stop ${vm.name}?`, message: 'This is like pulling the power cord. Unsaved work in the VM is lost.', label: 'Force stop' }))) return false;
  if (action === 'reset' && !(await confirmAction({ title: `Hard reset ${vm.name}?`, message: 'This is like pressing the reset button. Unsaved work in the VM is lost.', label: 'Hard reset' }))) return false;
  if (action === 'stop' && !(await confirmAction({ title: `Shut down ${vm.name}?`, message: 'The VM is asked to shut down cleanly. If it ignores the request, use Force stop.', label: 'Shut down' }))) return false;
  const res = await runAction(button, () => unraid.vmAction(s, action, vm.id), { success: `${VM_DONE[action]} ${vm.name}` });
  return res !== undefined;
}

export function openVm(s, vm, { onDone } = {}) {
  const sheet = openSheet({ title: vm.name });
  const [state, label] = vmState(vm);
  const buttons = [];
  const add = (text, action, cls = 'btn') => {
    const b = h('button', { type: 'button', class: cls }, text);
    b.addEventListener('click', async () => {
      if (await runVmAction(s, vm, action, b)) {
        sheet.close();
        onDone?.(action);
      }
    });
    buttons.push(b);
  };
  if (vmRunning(vm)) {
    add('Shut down', 'stop', 'btn btn-danger');
    add('Restart', 'reboot');
    add('Pause', 'pause');
    add('Force stop', 'forceStop', 'btn btn-danger');
    add('Hard reset', 'reset', 'btn btn-danger');
  } else if (vmPaused(vm)) {
    add('Resume', 'resume', 'btn btn-primary');
    add('Force stop', 'forceStop', 'btn btn-danger');
  } else if (vm.state !== 'SHUTDOWN') {
    add('Start', 'start', 'btn btn-primary');
  }

  const open = h('a', { class: 'btn', href: `${webBase(s)}/VMs`, target: '_blank', rel: 'noopener' }, 'Open VMs in Unraid');
  sheet.set(
    h('div', { class: 'list' }, h('div', { class: 'panel' }, h('div', { class: 'panel-title' }, light(state), label))),
    buttons.length ? h('div', { class: 'btn-row vm-actions' }, buttons) : h('p', { class: 'hint', text: 'The VM is shutting down. Check back in a moment.' }),
    h('div', { class: 'stack' }, open),
    h('p', { class: 'hint', text: 'Shut down asks the VM to power off cleanly. Force stop and Hard reset cut power immediately. Use the Unraid VMs page for the console and settings.' }),
  );
  return sheet;
}
