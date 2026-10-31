import { h, light, bar, fmt, pageHead, section, skeletonList, notice, emptyState, searchField, chips, confirmAction, runAction, initials, toast, chevron } from '../ui.js';
import { unraid, jellyfin, prowlarr, healthIssues, byType, webBase, vmErrorMessage } from '../services.js';
import { openDisks, openShares, openParity, openNotifications, openLogs, openContainer, openVm, runVmAction, vmState, vmRunning, vmPaused } from './unraid.js';

export function render(root, ctx) {
  const { services } = ctx.state;
  const unraids = byType(services, 'unraid');
  const jellyfins = byType(services, 'jellyfin');
  const prowlarrs = byType(services, 'prowlarr');
  const healthSources = byType(services, 'sonarr', 'radarr', 'lidarr', 'prowlarr', 'bazarr');

  const head = pageHead('Server');
  root.append(head.el);

  if (!unraids.length && !jellyfins.length && !healthSources.length) {
    root.append(
      h(
        'div',
        { class: 'section' },
        emptyState({
          title: 'No server tools yet',
          body: 'Add Unraid to start and stop containers, or Jellyfin to scan libraries and see who’s watching.',
          action: { label: 'Add a service', onClick: () => ctx.navigate('settings', { add: '1' }) },
        }),
      ),
    );
    return;
  }

  // ---------- Unraid ----------
  for (const s of unraids) {
    const overview = section(unraids.length > 1 ? s.name : 'Array');
    const manage = section('Manage');
    const containers = section('Containers');
    const vms = section('Virtual machines');
    vms.set(skeletonList(2));
    root.append(overview.el, manage.el, vms.el, containers.el);

    let query = '';
    let filter = 'all';
    let list = null;
    let last = null;
    const search = searchField('Search containers', (v) => {
      query = v;
      drawContainers();
    });
    const filters = chips([], filter, (v) => {
      filter = v;
      drawContainers();
    });

    function drawManage(o) {
      const unread = o?.unread;
      const alerts = (unread?.alert || 0) + (unread?.warning || 0);
      const p = o?.parity;
      const parityText = p?.running ? `${p.paused ? 'Paused' : 'Running'}, ${p.progress ?? 0}%` : p?.status ? fmt.sentence(p.status) : '';
      const hottest = o?.temperature?.summary?.hottest;
      const rows = [
        ['Notifications', unread ? (unread.total ? `${unread.total} unread` : 'None unread') : '', unread?.total ? (unread.alert ? 'bad' : alerts ? 'warn' : 'active') : null, () => openNotifications(s, { onChange: loadOverview })],
        ['Disks', hottest ? `Hottest ${hottest.name}: ${Math.round(hottest.current.value)} °C` : '', null, () => openDisks(s)],
        ['Shares', '', null, () => openShares(s)],
        ['Parity check', parityText, p?.running ? 'active' : null, () => openParity(s, { onChange: loadOverview })],
        ['System logs', '', null, () => openLogs(s)],
      ];
      manage.set(
        h(
          'div',
          { class: 'list' },
          rows.map(([title, sub, state, onClick]) =>
            h(
              'button',
              { type: 'button', class: 'row', onClick },
              h('span', { class: 'row-main' }, h('span', { class: 'row-title', text: title }), sub ? h('span', { class: 'row-sub', text: sub }) : null),
              state ? light(state) : null,
              chevron(),
            ),
          ),
        ),
      );
    }

    async function loadOverview() {
      try {
        const o = await unraid.overview(s);
        last = o;
        if (o.hostname && unraids.length === 1) head.setTitle(o.hostname);
        const kb = o.array?.capacity?.kilobytes || {};
        const total = Number(kb.total) * 1024 || 0;
        const used = Number(kb.used) * 1024 || 0;
        const free = Number(kb.free) * 1024 || 0;
        const started = o.array?.state === 'STARTED';
        const stats = [];
        if (o.cpu?.percentTotal != null) stats.push(['CPU', `${Math.round(o.cpu.percentTotal)}%`]);
        if (o.memory?.percentTotal != null) stats.push(['Memory', `${Math.round(o.memory.percentTotal)}%`]);
        else if (o.memory?.total) stats.push(['Memory', `${Math.round((1 - o.memory.available / o.memory.total) * 100)}%`]);
        const cpuTemp = o.packages?.temp?.filter((t) => t > 0);
        if (cpuTemp?.length) stats.push(['CPU temp', `${Math.round(Math.max(...cpuTemp))} °C`]);
        else {
          const cpuSensor = o.temperature?.sensors?.find((t) => t.type === 'CPU_PACKAGE' || t.type === 'CPU_CORE');
          if (cpuSensor) stats.push(['CPU temp', `${Math.round(cpuSensor.current.value)} °C`]);
        }
        if (o.packages?.totalPower > 0) stats.push(['CPU power', `${Math.round(o.packages.totalPower)} W`]);
        const nics = o.network.filter((n) => n.name && !/^(lo|veth|docker|virbr|br-|vnet|tun|wg|tailscale)/.test(n.name));
        if (nics.length) {
          const rx = nics.reduce((sum, n) => sum + (Number(n.rxSec) || 0), 0);
          const tx = nics.reduce((sum, n) => sum + (Number(n.txSec) || 0), 0);
          stats.push(['Network ↓', fmt.speed(rx)], ['Network ↑', fmt.speed(tx)]);
        }
        if (o.memory?.swapTotal > 0) stats.push(['Swap', fmt.percent(o.memory.swapUsed / o.memory.swapTotal)]);
        const up = o.uptime && !Number.isNaN(Date.parse(o.uptime)) ? fmt.since(o.uptime) : null;
        if (up) stats.push(['Uptime', up]);
        const parity = o.parity?.running ? `Parity check ${o.parity.paused ? 'paused' : 'running'}, ${o.parity.progress ?? 0}%` : null;

        overview.set(
          h(
            'div',
            { class: 'list' },
            h(
              'div',
              { class: 'panel' },
              h('div', { class: 'panel-title' }, light(started ? 'ok' : 'warn'), started ? 'Array started' : `Array ${String(o.array?.state || 'unknown').toLowerCase().replace(/_/g, ' ')}`),
              total ? bar(used / total, used / total > 0.9 ? 'bad' : used / total > 0.8 ? 'warn' : 'ok') : null,
              total ? h('div', { class: 'panel-sub', text: `${fmt.bytes(free)} free of ${fmt.bytes(total)}` }) : null,
              parity ? h('div', { class: 'panel-sub', text: parity }) : null,
            ),
            stats.length ? h('div', { class: 'stats' }, stats.map(([k, v]) => h('div', { class: 'stat' }, h('b', { text: v }), h('span', { text: k })))) : null,
          ),
          o.ups.map((u) =>
            h(
              'div',
              { class: 'list', style: { marginTop: '12px' } },
              h(
                'div',
                { class: 'row' },
                light(/online|OL/i.test(u.status) ? 'ok' : 'warn'),
                h('span', { class: 'row-main' }, h('span', { class: 'row-title', text: `UPS ${u.model || u.name}` }), h('span', { class: 'row-sub', text: [u.status, u.battery?.estimatedRuntime ? `${fmt.eta(u.battery.estimatedRuntime)} on battery` : null].filter(Boolean).join(' · ') })),
                h('span', { class: 'row-trail' }, h('b', { text: `${u.battery?.chargeLevel ?? '–'}%` }), u.power?.currentPower ? `${Math.round(u.power.currentPower)} W` : u.power?.loadPercentage != null ? `${u.power.loadPercentage}% load` : ''),
              ),
            ),
          ),
        );
        overview.el.querySelector('.bar')?.classList.add('meter');
        drawManage(o);
      } catch (err) {
        overview.set(notice(err.message, { retry: loadOverview }));
        if (!last) drawManage(null);
      }
    }

    async function loadContainers(first = false) {
      if (first) containers.set(skeletonList(5));
      try {
        list = await unraid.containers(s);
        list.sort((a, b) => cname(a).localeCompare(cname(b), 'en', { sensitivity: 'base' }));
        drawContainers();
      } catch (err) {
        if (!list) containers.set(notice(err.message, { retry: () => loadContainers(true) }));
      }
    }

    function drawContainers() {
      if (!list) return;
      const running = list.filter((c) => c.state === 'RUNNING');
      const stopped = list.filter((c) => c.state !== 'RUNNING');
      const updates = list.filter((c) => c.isUpdateAvailable);
      containers.setAside(`${running.length} of ${list.length} running`);
      const options = [
        { label: 'All', value: 'all', count: list.length },
        { label: 'Running', value: 'running', count: running.length },
        { label: 'Stopped', value: 'stopped', count: stopped.length },
      ];
      if (updates.length) options.push({ label: 'Updates', value: 'updates', count: updates.length });
      if (filter === 'updates' && !updates.length) filter = 'all';
      filters.update(options);

      const q = query.toLowerCase();
      const pool = { all: list, running, stopped, updates }[filter] || list;
      const shown = pool.filter((c) => !q || cname(c).toLowerCase().includes(q) || (c.image || '').toLowerCase().includes(q));
      const rows = shown.map((c) => {
        const name = cname(c);
        const state = c.state === 'RUNNING' ? 'ok' : c.state === 'PAUSED' ? 'warn' : '';
        return h(
          'button',
          { type: 'button', class: 'row has-lead', onClick: () => containerActions(c) },
          containerIcon(s, c),
          h('span', { class: 'row-main' }, h('span', { class: 'row-title', text: name }), h('span', { class: 'row-sub', text: [c.status || c.state, c.isUpdateAvailable ? 'Update available' : null].filter(Boolean).join(' · ') })),
          light(state),
        );
      });

      const tools = [];
      if (filter === 'updates' && updates.length) {
        const all = h('button', { type: 'button', class: 'btn btn-small btn-primary' }, `Update ${fmt.count(updates.length, 'container')}`);
        all.addEventListener('click', async () => {
          if (!(await confirmAction({ title: `Update ${fmt.count(updates.length, 'container')}?`, message: 'Each container is pulled again and restarted.', label: 'Update', destructive: false }))) return;
          await runAction(all, () => unraid.updateContainers(s, updates.map((c) => c.id)), { success: 'Updates finished' });
          loadContainers();
        });
        tools.push(h('div', { class: 'btn-row' }, all));
      }
      if (running.length) {
        const stopAll = h('button', { type: 'button', class: 'btn btn-small' }, 'Stop all');
        const restartAll = h('button', { type: 'button', class: 'btn btn-small' }, 'Restart all');
        const batch = (btn, action, targets, verb) => async () => {
          if (!(await confirmAction({ title: `${verb} ${fmt.count(targets.length, 'container')}?`, label: verb }))) return;
          await runAction(btn, async () => {
            const results = await Promise.allSettled(targets.map((c) => unraid.dockerAction(s, action, c.id)));
            const failed = results.filter((r) => r.status === 'rejected').length;
            if (failed) throw new Error(`${failed} of ${targets.length} failed.`);
          }, { success: `${verb} ${fmt.count(targets.length, 'container')}` });
          loadContainers();
        };
        const visibleRunning = shown.filter((c) => c.state === 'RUNNING');
        if (filter === 'running' && visibleRunning.length > 1) {
          stopAll.addEventListener('click', batch(stopAll, 'stop', visibleRunning, 'Stop'));
          restartAll.addEventListener('click', batch(restartAll, 'restart', visibleRunning, 'Restart'));
          tools.push(h('div', { class: 'btn-row' }, restartAll, stopAll));
        }
      }
      const visibleStopped = shown.filter((c) => c.state === 'EXITED');
      if (filter === 'stopped' && visibleStopped.length > 1) {
        const startAll = h('button', { type: 'button', class: 'btn btn-small' }, `Start ${fmt.count(visibleStopped.length, 'container')}`);
        startAll.addEventListener('click', async () => {
          if (!(await confirmAction({ title: `Start ${fmt.count(visibleStopped.length, 'container')}?`, label: 'Start', destructive: false }))) return;
          await runAction(startAll, () => Promise.all(visibleStopped.map((c) => unraid.dockerAction(s, 'start', c.id))), { success: 'Started' });
          loadContainers();
        });
        tools.push(h('div', { class: 'btn-row' }, startAll));
      }

      const listNode = h(
        'div',
        { class: 'container-list' },
        rows.length ? h('div', { class: 'list' }, rows) : h('p', { class: 'quiet', text: list.length ? 'No containers match.' : 'No containers.' }),
        tools,
      );
      // Keep focus in the search box while filtering.
      if (containers.body.contains(search.el)) {
        containers.body.querySelector(':scope > .container-list')?.replaceWith(listNode);
      } else {
        containers.set(search.el, filters.el, h('div', { style: { height: '12px' } }), listNode);
      }
    }

    async function runContainer(c, action, button) {
      const name = cname(c);
      if (action === 'stop' && !(await confirmAction({ title: `Stop ${name}?`, label: 'Stop' }))) return false;
      const verb = { start: 'Started', stop: 'Stopped', restart: 'Restarted', pause: 'Paused', unpause: 'Resumed', updateContainer: 'Updated' }[action];
      const res = await runAction(button, () => unraid.dockerAction(s, action, c.id), { success: `${verb} ${name}` });
      loadContainers();
      return res !== undefined;
    }

    async function containerActions(c) {
      const sheet = openContainer(s, c, cname(c), {
        onAction: async (action, button) => {
          if (await runContainer(c, action, button)) sheet.close();
        },
      });
    }

    let vmList = null;

    // Shutting down or starting takes a while, so check again a few times.
    function refreshVmsSoon() {
      for (const ms of [1500, 5000, 12000, 25000]) setTimeout(loadVms, ms);
    }

    async function loadVms() {
      try {
        vmList = await unraid.vms(s);
      } catch (err) {
        if (!vmList) {
          vms.setAside(null);
          vms.set(notice(vmErrorMessage(err), { retry: loadVms }));
        }
        return;
      }
      vmList.sort((a, b) => String(a.name).localeCompare(String(b.name), 'en', { sensitivity: 'base' }));
      const running = vmList.filter(vmRunning);
      const stopped = vmList.filter((vm) => !vmRunning(vm) && !vmPaused(vm) && vm.state !== 'SHUTDOWN');
      vms.setAside(vmList.length ? `${running.length} of ${vmList.length} running` : null);

      if (!vmList.length) {
        vms.set(
          h('p', { class: 'quiet', text: 'No virtual machines yet. Create them on the VMS tab in Unraid.' }),
          h('div', { class: 'stack' }, h('a', { class: 'btn', href: `${webBase(s)}/VMs`, target: '_blank', rel: 'noopener' }, 'Open VMs in Unraid')),
        );
        return;
      }

      const batch = (label, targets, action, verb) => {
        const btn = h('button', { type: 'button', class: `btn btn-small${action === 'stop' ? ' btn-danger' : ''}` }, label);
        btn.addEventListener('click', async () => {
          if (!(await confirmAction({ title: `${verb} ${fmt.count(targets.length, 'VM')}?`, message: targets.map((vm) => vm.name).join(', '), label: verb, destructive: action === 'stop' }))) return;
          await runAction(btn, async () => {
            const results = await Promise.allSettled(targets.map((vm) => unraid.vmAction(s, action, vm.id)));
            const failed = results.filter((r) => r.status === 'rejected');
            if (failed.length) throw new Error(`${failed.length} of ${targets.length} failed: ${failed[0].reason?.message || ''}`);
          }, { success: `${verb === 'Start' ? 'Starting' : 'Shutting down'} ${fmt.count(targets.length, 'VM')}` });
          refreshVmsSoon();
        });
        return btn;
      };
      const tools = [];
      if (stopped.length > 1) tools.push(batch(`Start ${stopped.length} stopped`, stopped, 'start', 'Start'));
      if (running.length > 1) tools.push(batch(`Shut down ${running.length} running`, running, 'stop', 'Shut down'));

      vms.set(
        h(
          'div',
          { class: 'list' },
          vmList.map((vm) => {
            const [state, label] = vmState(vm);
            const quick = vmRunning(vm) ? null : vmPaused(vm) ? ['Resume', 'resume'] : vm.state === 'SHUTDOWN' ? null : ['Start', 'start'];
            let quickBtn = null;
            if (quick) {
              quickBtn = h('button', { type: 'button', class: 'btn btn-small' }, quick[0]);
              quickBtn.addEventListener('click', async (e) => {
                e.stopPropagation();
                if (await runVmAction(s, vm, quick[1], quickBtn)) refreshVmsSoon();
              });
            }
            return h(
              'div',
              { class: 'row has-lead vm-row', role: 'button', tabindex: '0', onClick: () => openVm(s, vm, { onDone: refreshVmsSoon }), onKeydown: (e) => e.key === 'Enter' && openVm(s, vm, { onDone: refreshVmsSoon }) },
              h('span', { class: 'lead', 'aria-hidden': 'true', text: initials(vm.name) }),
              h('span', { class: 'row-main' }, h('span', { class: 'row-title', text: vm.name }), h('span', { class: 'row-sub', text: label })),
              quickBtn,
              light(state),
            );
          }),
        ),
        tools.length ? h('div', { class: 'btn-row' }, tools) : null,
      );
    }

    drawManage(null);
    loadOverview();
    loadContainers(true);
    loadVms();
    ctx.poll(loadContainers, 10000);
    ctx.poll(loadOverview, 15000);
    ctx.poll(loadVms, 30000);
  }

  // ---------- Jellyfin ----------
  for (const s of jellyfins) {
    const sec = section(jellyfins.length > 1 ? s.name : 'Jellyfin');
    root.append(sec.el);
    sec.set(skeletonList(2));
    const scan = h('button', { type: 'button', class: 'btn btn-small' }, 'Scan libraries');
    scan.addEventListener('click', () => runAction(scan, () => jellyfin.scan(s), { success: 'Library scan started' }));
    (async () => {
      try {
        const [info, counts] = await Promise.all([jellyfin.info(s), jellyfin.counts(s).catch(() => null)]);
        const stats = counts
          ? [
              ['Movies', counts.MovieCount],
              ['Series', counts.SeriesCount],
              ['Episodes', counts.EpisodeCount],
              ['Albums', counts.AlbumCount],
            ].filter(([, n]) => n)
          : [];
        sec.set(
          h(
            'div',
            { class: 'list' },
            h(
              'div',
              { class: 'row' },
              light('ok'),
              h('span', { class: 'row-main' }, h('span', { class: 'row-title', text: info.ServerName || s.name }), h('span', { class: 'row-sub', text: `Version ${info.Version}` })),
              scan,
            ),
            stats.length ? h('div', { class: 'stats' }, stats.map(([k, v]) => h('div', { class: 'stat' }, h('b', { text: Number(v).toLocaleString('en-GB') }), h('span', { text: k })))) : null,
          ),
        );
      } catch (err) {
        sec.set(notice(err.message));
      }
    })();
  }

  // ---------- Prowlarr ----------
  for (const s of prowlarrs) {
    const sec = section(prowlarrs.length > 1 ? s.name : 'Indexers');
    root.append(sec.el);
    sec.set(skeletonList(1));
    const load = async () => {
      try {
        const [indexers, status] = await Promise.all([prowlarr.indexers(s), prowlarr.status(s)]);
        const enabled = indexers.filter((i) => i.enable);
        const failing = status.filter((st) => st.disabledTill && new Date(st.disabledTill) > new Date());
        const nameOf = (id) => indexers.find((i) => i.id === id)?.name || `Indexer ${id}`;
        const test = h('button', { type: 'button', class: 'btn btn-small' }, 'Test all');
        test.addEventListener('click', async () => {
          const res = await runAction(test, () => prowlarr.testAll(s));
          if (res !== undefined) {
            const bad = Array.isArray(res) ? res.filter((r) => !r.isValid).length : 0;
            toast(bad ? `${fmt.count(bad, 'indexer')} failed the test` : 'All indexers passed');
            load();
          }
        });
        sec.set(
          h(
            'div',
            { class: 'list' },
            h(
              'div',
              { class: 'row' },
              light(failing.length ? 'warn' : 'ok'),
              h('span', { class: 'row-main' }, h('span', { class: 'row-title', text: `${fmt.count(enabled.length, 'indexer')} enabled` }), h('span', { class: 'row-sub', text: failing.length ? `${failing.length} temporarily disabled` : 'All working' })),
              test,
            ),
            failing.map((st) =>
              h(
                'div',
                { class: 'row' },
                light('bad'),
                h('span', { class: 'row-main' }, h('span', { class: 'row-title', text: nameOf(st.indexerId) }), h('span', { class: 'row-sub', text: `Disabled until ${fmt.time(st.disabledTill)}` })),
              ),
            ),
          ),
        );
      } catch (err) {
        sec.set(notice(err.message, { retry: load }));
      }
    };
    load();
  }

  // ---------- health ----------
  if (healthSources.length) {
    const sec = section('Health');
    root.append(sec.el);
    sec.set(skeletonList(1));
    (async () => {
      const issues = await healthIssues(healthSources);
      if (!issues.length) {
        sec.set(h('div', { class: 'status-line' }, light('ok'), 'No warnings from your services'));
        return;
      }
      issues.sort((a, b) => (a.level === 'bad' ? 0 : 1) - (b.level === 'bad' ? 0 : 1));
      sec.set(
        h(
          'div',
          { class: 'list' },
          issues.map((i) =>
            h(
              i.url ? 'a' : 'div',
              { class: 'row', href: i.url || null, target: i.url ? '_blank' : null, rel: i.url ? 'noopener' : null },
              light(i.level),
              h('span', { class: 'row-main' }, h('span', { class: 'row-title', text: i.svc.name }), h('span', { class: 'row-sub wrap', text: i.message })),
            ),
          ),
        ),
      );
    })();
  }
}

function cname(c) {
  return (c.names?.[0] || c.id || '').replace(/^\//, '');
}

function containerIcon(s, c) {
  const lead = h('span', { class: 'lead', 'aria-hidden': 'true', text: initials(cname(c)) });
  if (!c.iconUrl) return lead;
  const src = /^https?:/i.test(c.iconUrl) ? c.iconUrl : `${webBase(s)}${c.iconUrl.startsWith('/') ? '' : '/'}${c.iconUrl}`;
  const img = h('img', { src, alt: '', loading: 'lazy' });
  img.addEventListener('load', () => lead.replaceChildren(img));
  return lead;
}

