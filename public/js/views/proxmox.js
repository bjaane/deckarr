// Proxmox VE on the Server tab: nodes, VMs and LXC containers, storage, disks, package updates, tasks and logs.

import { h, light, bar, fmt, section, openSheet, skeletonList, notice, chips, searchField, confirmAction, runAction, chevron, initials } from '../ui.js';
import { proxmox, webBase } from '../services.js';

const pct = (used, total) => (total ? used / total : 0);
const meterState = (f) => (f > 0.9 ? 'bad' : f > 0.8 ? 'warn' : 'ok');
const guestName = (g) => g.name || `${g.type === 'lxc' ? 'CT' : 'VM'} ${g.vmid}`;
const kind = (g) => (g.type === 'lxc' ? 'LXC' : 'VM');

/** Loads into a sheet with a skeleton and an error with retry. */
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

/** Runs fn for every online node and groups the results, so one failing node doesn't hide the rest. */
async function perNode(nodes, fn) {
  return Promise.all(
    nodes.map(async (n) => {
      try {
        return { node: n.node, data: await fn(n.node) };
      } catch (err) {
        return { node: n.node, error: err };
      }
    }),
  );
}

const nodeLabel = (results, node) => (results.length > 1 ? [h('p', { class: 'group-label', text: node })] : []);

// ---------- the Server tab section ----------

export function renderProxmox(root, ctx, s, { head, multiple, open }) {
  const overview = section('Overview');
  const manage = section('Manage');
  const guestsSec = section('VMs and containers');
  root.append(overview.el, manage.el, guestsSec.el);

  let nodes = null;
  let guests = null;
  let query = '';
  let filter = 'all';
  let disposed = false;
  ctx.onDispose(() => (disposed = true));

  const search = searchField('Search VMs and containers', (v) => {
    query = v;
    drawGuests();
  });
  const filters = chips([], filter, (v) => {
    filter = v;
    drawGuests();
  });

  const online = () => (nodes || []).filter((n) => n.status === 'online');

  function drawManage() {
    const rows = [
      ['Storage', () => openStorage(s, online())],
      ['Disks', () => openDisks(s, online())],
      ['Package updates', () => openUpdates(s, online())],
      ['Tasks', () => openTasks(s, online())],
      ['System log', () => openSyslog(s, online())],
    ];
    manage.set(
      h(
        'div',
        { class: 'list' },
        rows.map(([title, onClick]) => h('button', { type: 'button', class: 'row', onClick }, h('span', { class: 'row-main row-title', text: title }), chevron())),
      ),
      h('div', { class: 'stack' }, h('a', { class: 'btn', href: webBase(s), target: '_blank', rel: 'noopener' }, 'Open Proxmox')),
    );
  }

  async function loadOverview() {
    try {
      nodes = (await proxmox.nodes(s)) || [];
      nodes.sort((a, b) => String(a.node).localeCompare(String(b.node)));
      const details = await perNode(online(), (node) => proxmox.nodeStatus(s, node));
      if (nodes.length === 1 && !multiple) head.setTitle(nodes[0].node);
      overview.setAside(nodes.length > 1 ? `${online().length} of ${nodes.length} online` : null);
      overview.set(
        nodes.map((n) => {
          const st = details.find((d) => d.node === n.node)?.data;
          const up = n.status === 'online';
          const memF = pct(n.mem, n.maxmem);
          const rootF = st?.rootfs ? pct(st.rootfs.used, st.rootfs.total) : null;
          const stats = [];
          if (up) {
            stats.push(['CPU', `${Math.round((n.cpu || 0) * 100)}%`]);
            stats.push(['Memory', fmt.percent(memF)]);
            if (st?.loadavg?.length) stats.push(['Load', Number(st.loadavg[0]).toFixed(2)]);
            if (rootF != null) stats.push(['Root disk', fmt.percent(rootF)]);
            if (n.uptime) stats.push(['Uptime', fmt.eta(n.uptime)]);
          }
          const version = st?.pveversion ? st.pveversion.split('/')[1] : null;
          return h(
            'div',
            { class: 'list', style: { marginBottom: '12px' } },
            h(
              'div',
              { class: 'panel' },
              h('div', { class: 'panel-title' }, light(up ? 'ok' : 'bad'), up ? n.node : `${n.node} is offline`),
              up ? bar(memF, meterState(memF)) : null,
              up ? h('div', { class: 'panel-sub', text: [`${fmt.bytes(n.mem)} of ${fmt.bytes(n.maxmem)} memory`, n.maxcpu ? `${n.maxcpu} CPUs` : null, version ? `Proxmox VE ${version}` : null].filter(Boolean).join(' · ') }) : null,
            ),
            stats.length ? h('div', { class: 'stats' }, stats.map(([k, v]) => h('div', { class: 'stat' }, h('b', { text: v }), h('span', { text: k })))) : null,
          );
        }),
      );
      overview.el.querySelectorAll('.bar').forEach((b) => b.classList.add('meter'));
      // Opened from a push notification: show what it was about, once the nodes are known.
      if (open) {
        const sheet = { tasks: openTasks, storage: openStorage, disks: openDisks }[open];
        open = null;
        sheet?.(s, online());
      }
    } catch (err) {
      overview.set(notice(err.message, { retry: loadOverview }));
    }
  }

  async function loadGuests(first = false) {
    if (first) guestsSec.set(skeletonList(4));
    try {
      guests = await proxmox.guests(s);
      guests.sort((a, b) => a.vmid - b.vmid);
      drawGuests();
    } catch (err) {
      if (!guests) guestsSec.set(notice(err.message, { retry: () => loadGuests(true) }));
    }
  }

  function refreshSoon() {
    for (const ms of [1500, 5000, 12000, 25000]) setTimeout(() => !disposed && loadGuests(), ms);
  }

  function drawGuests() {
    if (!guests) return;
    const running = guests.filter((g) => g.status === 'running');
    const stopped = guests.filter((g) => g.status !== 'running');
    const vms = guests.filter((g) => g.type === 'qemu');
    const cts = guests.filter((g) => g.type === 'lxc');
    guestsSec.setAside(guests.length ? `${running.length} of ${guests.length} running` : null);
    if (!guests.length) {
      guestsSec.set(h('p', { class: 'quiet', text: 'No VMs or containers yet, or the token can’t see them. Give it the PVEAuditor role on /.' }));
      return;
    }
    const options = [
      { label: 'All', value: 'all', count: guests.length },
      { label: 'Running', value: 'running', count: running.length },
      { label: 'Stopped', value: 'stopped', count: stopped.length },
    ];
    if (vms.length && cts.length) options.push({ label: 'VMs', value: 'qemu', count: vms.length }, { label: 'LXC', value: 'lxc', count: cts.length });
    filters.update(options);

    const q = query.toLowerCase();
    const pool = { all: guests, running, stopped, qemu: vms, lxc: cts }[filter] || guests;
    const shown = pool.filter((g) => !q || guestName(g).toLowerCase().includes(q) || String(g.vmid).includes(q) || (g.tags || '').toLowerCase().includes(q));

    const rows = shown.map((g) => {
      const isRunning = g.status === 'running';
      let quick = null;
      if (!isRunning && !g.lock) {
        quick = h('button', { type: 'button', class: 'btn btn-small' }, 'Start');
        quick.addEventListener('click', async (e) => {
          e.stopPropagation();
          if (await runGuestAction(s, g, 'start', quick)) refreshSoon();
        });
      }
      const sub = [
        `${kind(g)} ${g.vmid}`,
        online().length > 1 ? g.node : null,
        isRunning ? `CPU ${Math.round((g.cpu || 0) * 100)}% · ${fmt.bytes(g.mem)} of ${fmt.bytes(g.maxmem)}` : g.lock ? `Locked (${g.lock})` : 'Stopped',
      ].filter(Boolean);
      return h(
        'div',
        { class: 'row has-lead vm-row', role: 'button', tabindex: '0', onClick: () => openGuest(s, g, { onDone: refreshSoon }), onKeydown: (e) => e.key === 'Enter' && openGuest(s, g, { onDone: refreshSoon }) },
        h('span', { class: 'lead', 'aria-hidden': 'true', text: initials(guestName(g)) }),
        h('span', { class: 'row-main' }, h('span', { class: 'row-title', text: guestName(g) }), h('span', { class: 'row-sub', text: sub.join(' · ') })),
        quick,
        light(isRunning ? 'ok' : g.lock ? 'warn' : ''),
      );
    });

    const listNode = h('div', { class: 'guest-list' }, rows.length ? h('div', { class: 'list' }, rows) : h('p', { class: 'quiet', text: 'Nothing matches.' }));
    if (guestsSec.body.contains(search.el)) guestsSec.body.querySelector(':scope > .guest-list')?.replaceWith(listNode);
    else if (guests.length > 8) guestsSec.set(search.el, filters.el, h('div', { style: { height: '12px' } }), listNode);
    else guestsSec.set(filters.el, h('div', { style: { height: '12px' } }), listNode);
  }

  drawManage();
  loadOverview();
  loadGuests(true);
  ctx.poll(loadOverview, 15000);
  ctx.poll(loadGuests, 10000);
}

// ---------- VMs and containers ----------

const GUEST_DONE = { start: 'Starting', shutdown: 'Shutting down', reboot: 'Restarting', suspend: 'Paused', resume: 'Resumed', stop: 'Stopped', reset: 'Reset' };

export async function runGuestAction(s, g, action, button) {
  const name = guestName(g);
  const confirm = {
    shutdown: { title: `Shut down ${name}?`, message: 'The guest is asked to shut down cleanly. If it ignores the request, use Stop.', label: 'Shut down' },
    stop: { title: `Stop ${name} now?`, message: 'This is like pulling the power cord. Unsaved work is lost.', label: 'Stop' },
    reset: { title: `Reset ${name}?`, message: 'This is like pressing the reset button. Unsaved work is lost.', label: 'Reset' },
  }[action];
  if (confirm && !(await confirmAction(confirm))) return false;
  const res = await runAction(button, () => proxmox.guestAction(s, g, action), { success: `${GUEST_DONE[action]} ${name}` });
  return res !== undefined;
}

export function openGuest(s, g, { onDone } = {}) {
  const sheet = openSheet({ title: guestName(g) });
  loader(
    sheet,
    () => proxmox.guestStatus(s, g).catch(() => null),
    (st) => {
      // status/current knows when a running VM is actually paused.
      const paused = st?.qmpstatus === 'paused' || st?.status === 'paused';
      const running = (st?.status || g.status) === 'running' && !paused;
      const buttons = [];
      const add = (text, action, cls = 'btn') => {
        const b = h('button', { type: 'button', class: cls }, text);
        b.addEventListener('click', async () => {
          if (await runGuestAction(s, g, action, b)) {
            sheet.close();
            onDone?.(action);
          }
        });
        buttons.push(b);
      };
      if (g.lock) {
        // A locked guest (backup, migration, snapshot) refuses most actions.
      } else if (running) {
        add('Shut down', 'shutdown', 'btn btn-danger');
        add('Restart', 'reboot');
        if (g.type === 'qemu') add('Pause', 'suspend');
        add('Stop', 'stop', 'btn btn-danger');
        if (g.type === 'qemu') add('Reset', 'reset', 'btn btn-danger');
      } else if (paused) {
        add('Resume', 'resume', 'btn btn-primary');
        add('Stop', 'stop', 'btn btn-danger');
      } else {
        add('Start', 'start', 'btn btn-primary');
      }

      const state = g.lock ? `Locked: ${g.lock}` : paused ? 'Paused' : running ? 'Running' : 'Stopped';
      const info = [
        ['Type', g.type === 'lxc' ? 'LXC container' : 'Virtual machine'],
        ['ID', String(g.vmid)],
        ['Node', g.node],
        running && st?.uptime ? ['Uptime', fmt.eta(st.uptime)] : null,
        running ? ['CPU', `${Math.round((st?.cpu ?? g.cpu ?? 0) * 100)}% of ${st?.cpus || g.maxcpu || '?'} cores`] : ['CPU', `${st?.cpus || g.maxcpu || '?'} cores`],
        ['Memory', running ? `${fmt.bytes(st?.mem ?? g.mem)} of ${fmt.bytes(st?.maxmem ?? g.maxmem)}` : fmt.bytes(st?.maxmem ?? g.maxmem)],
        g.maxdisk ? ['Disk', fmt.bytes(g.maxdisk)] : null,
        g.tags ? ['Tags', g.tags.split(/[;,]/).join(', ')] : null,
      ].filter(Boolean);

      sheet.set(
        h('div', { class: 'list' }, h('div', { class: 'panel' }, h('div', { class: 'panel-title' }, light(g.lock ? 'warn' : running ? 'ok' : paused ? 'warn' : ''), state))),
        buttons.length ? h('div', { class: 'btn-row vm-actions' }, buttons) : h('p', { class: 'hint', text: 'Proxmox is busy with this guest. Try again when the task is done.' }),
        h('div', { class: 'list', style: { marginTop: '14px' } }, info.map(([k, v]) => h('div', { class: 'row' }, h('span', { class: 'row-main row-title', text: k }), h('span', { class: 'row-trail wrap', text: v })))),
        h('div', { class: 'stack' }, h('a', { class: 'btn', href: `${webBase(s)}/#v1:0:=${g.type}%2F${g.vmid}`, target: '_blank', rel: 'noopener' }, 'Open in Proxmox')),
        h('p', { class: 'hint', text: 'Shut down asks the guest to power off cleanly. Stop and Reset cut power immediately. Use Proxmox for the console and settings.' }),
      );
    },
  );
  return sheet;
}

// ---------- storage ----------

function openStorage(s, nodes) {
  const sheet = openSheet({ title: 'Storage', tall: true });
  loader(
    sheet,
    () => perNode(nodes, (node) => proxmox.storage(s, node)),
    (results) =>
      sheet.set(
        results.map((r) => [
          ...nodeLabel(results, r.node),
          r.error
            ? notice(r.error.message)
            : h(
                'div',
                { class: 'list' },
                (r.data || [])
                  .filter((st) => st.enabled !== 0 && st.enabled !== false)
                  .sort((a, b) => String(a.storage).localeCompare(String(b.storage)))
                  .map((st) => {
                    const f = pct(st.used, st.total);
                    return h(
                      'div',
                      { class: 'row' },
                      light(st.active ? meterState(f) : 'bad'),
                      h(
                        'span',
                        { class: 'row-main' },
                        h('span', { class: 'row-title', text: st.storage }),
                        h('span', { class: 'row-sub', text: [st.type, st.shared ? 'shared' : null, st.active ? null : 'not active'].filter(Boolean).join(' · ') }),
                        st.total ? bar(f, meterState(f)) : null,
                      ),
                      h('span', { class: 'row-trail' }, h('b', { text: st.total ? fmt.percent(f) : '' }), st.total ? `${fmt.bytes(st.avail)} free` : ''),
                    );
                  }),
              ),
        ]),
      ),
  );
}

// ---------- disks ----------

function openDisks(s, nodes) {
  const sheet = openSheet({ title: 'Disks', tall: true });
  loader(
    sheet,
    () => perNode(nodes, (node) => proxmox.disks(s, node)),
    (results) =>
      sheet.set(
        results.map((r) => [
          ...nodeLabel(results, r.node),
          r.error
            ? notice(r.error.message)
            : h(
                'div',
                { class: 'list' },
                (r.data || []).map((d) => {
                  const health = String(d.health || 'UNKNOWN').toUpperCase();
                  const state = health === 'PASSED' || health === 'OK' ? 'ok' : health === 'UNKNOWN' ? '' : 'bad';
                  const wear = d.wearout != null && d.wearout !== 'N/A' ? `${d.wearout}% life left` : null;
                  return h(
                    'div',
                    { class: 'row' },
                    light(state),
                    h('span', { class: 'row-main' }, h('span', { class: 'row-title', text: d.model || d.devpath }), h('span', { class: 'row-sub', text: [d.devpath, d.type ? d.type.toUpperCase() : null, d.used, wear].filter(Boolean).join(' · ') })),
                    h('span', { class: 'row-trail' }, h('b', { text: health === 'UNKNOWN' ? '' : fmt.sentence(health) }), fmt.bytes(d.size)),
                  );
                }),
              ),
        ]),
        h('p', { class: 'hint', text: 'Health is the disk’s own SMART verdict. Proxmox doesn’t report temperatures through its API.' }),
      ),
  );
}

// ---------- package updates ----------

function openUpdates(s, nodes) {
  const sheet = openSheet({ title: 'Package updates', tall: true });
  const run = loader(
    sheet,
    () => perNode(nodes, (node) => proxmox.updates(s, node)),
    (results) => {
      const blocked = results.some((r) => r.error?.status === 403);
      sheet.set(
        results.map((r) => {
          const refresh = h('button', { type: 'button', class: 'btn btn-small' }, 'Check for updates');
          refresh.addEventListener('click', async () => {
            if ((await runAction(refresh, () => proxmox.refreshUpdates(s, r.node), { success: 'Checking for updates. This takes a minute.' })) !== undefined) setTimeout(() => run(), 30000);
          });
          if (r.error) return [...nodeLabel(results, r.node), notice(r.error.status === 403 ? 'The token can’t read package updates. That needs the Sys.Modify permission on the node, for example the PVESysAdmin role.' : r.error.message)];
          const list = (r.data || []).sort((a, b) => String(a.Package).localeCompare(String(b.Package)));
          return [
            ...nodeLabel(results, r.node),
            h(
              'div',
              { class: 'list' },
              h('div', { class: 'row' }, light(list.length ? 'warn' : 'ok'), h('span', { class: 'row-main row-title', text: list.length ? `${fmt.count(list.length, 'update')} available` : 'Everything is up to date' })),
              list.slice(0, 200).map((p) => h('div', { class: 'row' }, h('span', { class: 'row-main' }, h('span', { class: 'row-title', text: p.Package }), h('span', { class: 'row-sub', text: `${p.OldVersion || '?'} → ${p.Version}` })))),
            ),
            h('div', { class: 'btn-row' }, refresh),
          ];
        }),
        blocked ? null : h('p', { class: 'hint', text: 'Install updates in Proxmox (node > Updates > Upgrade). Deckarr only shows what’s waiting.' }),
      );
    },
  );
}

// ---------- tasks ----------

function openTasks(s, nodes) {
  const sheet = openSheet({ title: 'Tasks', tall: true });
  loader(
    sheet,
    async () => {
      const results = await perNode(nodes, (node) => proxmox.tasks(s, node, 50));
      return results.flatMap((r) => (r.data || []).map((t) => ({ ...t, node: r.node })));
    },
    (tasks) => {
      tasks.sort((a, b) => (b.starttime || 0) - (a.starttime || 0));
      if (!tasks.length) return sheet.set(h('p', { class: 'quiet', text: 'No recent tasks.' }));
      sheet.set(
        h(
          'div',
          { class: 'list' },
          tasks.slice(0, 80).map((t) => {
            const okStatus = !t.status || t.status === 'OK';
            const state = !t.endtime ? 'active' : okStatus ? 'ok' : /^WARNINGS/.test(t.status) ? 'warn' : 'bad';
            const what = taskLabel(t);
            const when = t.starttime ? `${fmt.dayLabel(t.starttime * 1000)} ${fmt.time(t.starttime * 1000)}` : '';
            return h(
              'button',
              { type: 'button', class: 'row', onClick: () => openTaskLog(s, t) },
              light(state),
              h('span', { class: 'row-main' }, h('span', { class: 'row-title', text: what }), h('span', { class: 'row-sub wrap', text: [when, nodes.length > 1 ? t.node : null, t.user, !t.endtime ? 'Running' : okStatus ? null : t.status].filter(Boolean).join(' · ') })),
              chevron(),
            );
          }),
        ),
      );
    },
  );
}

// Proxmox task types in plain words; anything else shows its own name.
const TASK_NAMES = {
  vzdump: 'Backup',
  qmstart: 'Start VM',
  qmstop: 'Stop VM',
  qmshutdown: 'Shut down VM',
  qmreboot: 'Restart VM',
  qmreset: 'Reset VM',
  qmsuspend: 'Pause VM',
  qmresume: 'Resume VM',
  qmigrate: 'Migrate VM',
  qmclone: 'Clone VM',
  qmcreate: 'Create VM',
  qmdestroy: 'Delete VM',
  qmsnapshot: 'Snapshot VM',
  vzstart: 'Start container',
  vzstop: 'Stop container',
  vzshutdown: 'Shut down container',
  vzreboot: 'Restart container',
  vzmigrate: 'Migrate container',
  vzcreate: 'Create container',
  vzdestroy: 'Delete container',
  vzsnapshot: 'Snapshot container',
  aptupdate: 'Check for updates',
  imgcopy: 'Copy image',
  download: 'Download',
  startall: 'Start all guests',
  stopall: 'Stop all guests',
  srvreload: 'Reload service',
  srvrestart: 'Restart service',
  zfsscrub: 'ZFS scrub',
};
const taskLabel = (t) => [TASK_NAMES[t.type] || fmt.sentence(t.type || 'Task'), t.id].filter(Boolean).join(' ');

function openTaskLog(s, t) {
  const sheet = openSheet({ title: taskLabel(t), tall: true });
  loader(
    sheet,
    () => proxmox.taskLog(s, t.node, t.upid, 1000),
    (lines) => sheet.set(logView((lines || []).map((l) => l.t).join('\n'))),
  );
}

// ---------- system log ----------

function logView(text) {
  const pre = h('pre', { class: 'log', text: text || 'The log is empty.' });
  requestAnimationFrame(() => (pre.scrollTop = pre.scrollHeight));
  return pre;
}

function openSyslog(s, nodes) {
  const sheet = openSheet({ title: 'System log', tall: true });
  let node = nodes[0]?.node;
  let content = '';
  let q = '';
  const out = h('div');
  const draw = () => {
    const needle = q.toLowerCase();
    const text = needle ? content.split('\n').filter((l) => l.toLowerCase().includes(needle)).join('\n') : content;
    out.replaceChildren(logView(text));
  };
  const load = async () => {
    out.replaceChildren(skeletonList(4));
    try {
      const lines = await proxmox.syslog(s, node, 500);
      content = (lines || []).map((l) => l.t).join('\n');
      draw();
    } catch (err) {
      out.replaceChildren(notice(err.status === 403 ? 'The token can’t read the system log. That needs the Sys.Syslog permission, included in PVEAuditor.' : err.message, { retry: load }));
    }
  };
  const filterInput = searchField('Filter lines', (v) => {
    q = v;
    draw();
  });
  const picker = nodes.length > 1 ? chips(nodes.map((n) => ({ label: n.node, value: n.node })), node, (v) => ((node = v), load())).el : null;
  const refresh = h('button', { type: 'button', class: 'btn btn-small' }, 'Refresh');
  refresh.addEventListener('click', () => runAction(refresh, load));
  sheet.set(picker, picker ? h('div', { style: { height: '12px' } }) : null, filterInput.el, h('div', { style: { height: '12px' } }), out, h('div', { class: 'btn-row' }, refresh));
  if (!node) return out.replaceChildren(h('p', { class: 'quiet', text: 'No node is online.' }));
  load();
}
