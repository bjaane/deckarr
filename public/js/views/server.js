import { h, light, bar, fmt, pageHead, section, skeletonList, notice, emptyState, searchField, chips, confirmAction, runAction, initials, toast, chevron } from '../ui.js';
import { unraid, jellyfin, prowlarr, healthIssues, byType, webBase, vmErrorMessage } from '../services.js';
import { renderProxmox } from './proxmox.js';
import { openDisks, openShares, openParity, openNotifications, openLogs, openContainer, openVm, runVmAction, vmState, vmRunning, vmPaused } from './unraid.js';

export function render(root, ctx, params) {
  const { services } = ctx.state;
  const unraids = byType(services, 'unraid');
  const proxmoxes = byType(services, 'proxmox');
  const jellyfins = byType(services, 'jellyfin');
  const prowlarrs = byType(services, 'prowlarr');
  const healthSources = byType(services, 'sonarr', 'radarr', 'lidarr', 'prowlarr', 'bazarr');

  const head = pageHead('Server');
  root.append(head.el);

  if (!unraids.length && !proxmoxes.length && !jellyfins.length && !healthSources.length) {
    root.append(
      h(
        'div',
        { class: 'section' },
        emptyState({
          title: 'No server tools yet',
          body: 'Add Unraid or Proxmox VE to manage your server, VMs and containers, or Jellyfin to scan libraries and see who’s watching.',
          action: { label: 'Add a service', onClick: () => ctx.navigate('settings', { add: '1' }) },
        }),
      ),
    );
    return;
  }

  // ---------- several servers: show one at a time ----------
  const servers = services.filter((s) => s.type === 'unraid' || s.type === 'proxmox');
  let selected = null;
  if (servers.length > 1) {
    const wanted = params?.get('server') || params?.get('notifications') || readPick();
    selected = (servers.find((s) => s.id === wanted) || servers[0]).id;
    savePick(selected);
    const current = servers.find((s) => s.id === selected);
    head.setTitle(current.name);
    head.setSub(`${current.type === 'proxmox' ? 'Proxmox VE' : 'Unraid'} · ${servers.length} servers`);
    const picker = chips(
      servers.map((s) => ({ label: s.name, value: s.id })),
      selected,
      (id) => {
        savePick(id);
        ctx.navigate('server', { server: id });
      },
    );
    root.append(h('div', { class: 'server-picker' }, picker.el));
  }
  const shown = (s) => !selected || s.id === selected;

  // ---------- Unraid ----------
  for (const s of unraids.filter(shown)) {
    const overview = section('Array');
    const manage = section('Manage');
    const containers = section('Containers');
    // Shown only once Unraid reports at least one VM.
    const vms = section('Virtual machines');
    vms.el.hidden = true;
    root.append(overview.el, manage.el, vms.el, containers.el);

    let query = '';
    let filter = 'all';
    let list = null;
    let last = null;
    // Container updates: progress of a running batch, the last check time and any failures.
    const updatesEl = h('div', { class: 'updates' });
    let updating = null; // { queue: [c], index, current }
    let checking = false;
    let checkedAt = null;
    let updateFailures = [];
    let cannotApply = null; // set when this Unraid can report updates but not apply them
    // Stops background waiting once the user leaves this tab.
    let disposed = false;
    ctx.onDispose(() => (disposed = true));
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
        if (o.hostname && servers.length === 1) head.setTitle(o.hostname);
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

    const updatesSupported = () => Boolean(list?.some((c) => 'isUpdateAvailable' in c));

    function drawUpdates() {
      if (!list) return;
      const pending = list.filter((c) => c.isUpdateAvailable);
      const nodes = [];
      if (!updatesSupported()) {
        nodes.push(
          h(
            'div',
            { class: 'list' },
            h(
              'div',
              { class: 'row' },
              light(''),
              h('span', { class: 'row-main' }, h('span', { class: 'row-title', text: 'Update checks aren’t available' }), h('span', { class: 'row-sub wrap', text: 'This Unraid version doesn’t report container updates through its API. Use the Docker tab in Unraid.' })),
            ),
          ),
        );
      } else if (updating) {
        const { queue, index, current, waiting } = updating;
        nodes.push(
          h(
            'div',
            { class: 'list' },
            h(
              'div',
              { class: 'panel' },
              h('div', { class: 'panel-title' }, light('active'), `Updating ${current} (${index + 1} of ${queue.length})`),
              bar(index / queue.length),
              h('div', { class: 'panel-sub', text: waiting ? 'This is taking a while. Unraid is still working on it, and Deckarr is checking until it’s done.' : 'Pulling the new image and restarting the container. Keep this page open.' }),
            ),
          ),
        );
      } else {
        const check = h('button', { type: 'button', class: 'btn btn-small' }, checking ? 'Checking…' : 'Check now');
        check.disabled = checking;
        check.addEventListener('click', checkUpdates);
        const buttons = [check];
        if (pending.length && cannotApply) {
          buttons.push(h('a', { class: 'btn btn-small btn-primary', href: `${webBase(s)}/Docker`, target: '_blank', rel: 'noopener' }, 'Update in Unraid'));
        } else if (pending.length) {
          const all = h('button', { type: 'button', class: 'btn btn-small btn-primary' }, pending.length === 1 ? 'Update' : `Update all ${pending.length}`);
          all.addEventListener('click', async () => {
            const ok = await confirmAction({
              title: pending.length === 1 ? `Update ${cname(pending[0])}?` : `Update ${pending.length} containers?`,
              message: `${pending.map(cname).join(', ')}. Each one pulls its new image and restarts.`,
              label: 'Update',
              destructive: false,
            });
            if (ok) runUpdates(pending);
          });
          buttons.push(all);
        }
        const title = pending.length ? `${fmt.count(pending.length, 'update')} available` : 'All containers are up to date';
        const sub = checking ? 'Asking the registries for new images…' : checkedAt ? `Checked at ${fmt.time(checkedAt)}` : 'Unraid checks for updates on its own schedule. Tap Check now to check right away.';
        nodes.push(
          h(
            'div',
            { class: 'list' },
            h('div', { class: 'row' }, light(pending.length ? 'warn' : 'ok'), h('span', { class: 'row-main' }, h('span', { class: 'row-title', text: title }), h('span', { class: 'row-sub wrap', text: sub }))),
          ),
          h('div', { class: 'btn-row' }, buttons),
        );
        if (cannotApply) {
          nodes.push(h('div', { style: { marginTop: '12px' } }, notice(cannotApply, { kind: 'warn' })));
        } else if (updateFailures.length) {
          nodes.push(
            h('div', { style: { marginTop: '12px' } }, notice(updateFailures.map((f) => `${f.name}: ${f.error}`).join('\n'), { kind: 'warn' })),
          );
        }
      }
      updatesEl.replaceChildren(...nodes);
    }

    async function checkUpdates() {
      if (checking || updating) return;
      checking = true;
      drawUpdates();
      try {
        await unraid.checkUpdates(s);
        checkedAt = new Date();
        await loadContainers();
        const n = list?.filter((c) => c.isUpdateAvailable).length || 0;
        toast(n ? `${fmt.count(n, 'update')} available` : 'All containers are up to date');
      } catch (err) {
        if (err.stillRunning) {
          // The check carries on in Unraid; pick up its result as it lands.
          checkedAt = new Date();
          toast('Unraid is still checking. New updates show up here in a minute or two.');
          for (const ms of [15000, 45000, 90000, 150000]) setTimeout(() => !disposed && loadContainers(), ms);
        } else {
          toast(err.message, 'bad');
        }
      } finally {
        checking = false;
        drawUpdates();
      }
    }

    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

    // After Unraid stopped answering mid-update, watch the container until it runs the new image.
    async function waitForUpdate(target) {
      const name = cname(target);
      const deadline = Date.now() + 10 * 60 * 1000;
      while (Date.now() < deadline && !disposed) {
        await sleep(5000);
        let fresh;
        try {
          fresh = await unraid.containers(s);
        } catch {
          continue; // Unraid can be briefly busy while it recreates the container.
        }
        list = fresh.sort((a, b) => cname(a).localeCompare(cname(b), 'en', { sensitivity: 'base' }));
        drawContainers();
        // The container is recreated, so match it by name rather than id.
        const c = list.find((x) => cname(x) === name);
        if (c && !c.isUpdateAvailable && (c.state === 'RUNNING' || target.state !== 'RUNNING')) return true;
      }
      return false;
    }

    // One container at a time, so progress is visible and one failure doesn't stop the rest.
    async function runUpdates(targets) {
      if (updating) return;
      updateFailures = [];
      updating = { queue: targets, index: 0, current: cname(targets[0]) };
      drawContainers();
      let done = 0;
      for (let i = 0; i < targets.length; i += 1) {
        updating = { queue: targets, index: i, current: cname(targets[i]) };
        drawContainers();
        try {
          await unraid.updateContainer(s, targets[i].id);
          done += 1;
        } catch (err) {
          if (err.stillRunning) {
            updating = { ...updating, waiting: true };
            drawContainers();
            if (await waitForUpdate(targets[i])) done += 1;
            else if (!disposed) updateFailures.push({ name: cname(targets[i]), error: 'Unraid didn’t finish within 10 minutes. Check the container on the Docker tab in Unraid.' });
            continue;
          }
          updateFailures.push({ name: cname(targets[i]), error: err.message });
          // An API that can't update at all will fail the same way for every container.
          if (/needs Unraid API/.test(err.message)) {
            cannotApply = err.message;
            updateFailures = [];
            break;
          }
        }
      }
      updating = null;
      await loadContainers();
      drawContainers();
      if (cannotApply && !done) toast('Unraid can’t apply updates through its API', 'bad');
      else if (!updateFailures.length) toast(done === 1 ? `Updated ${cname(targets[0])}` : `Updated ${done} containers`);
      else toast(done ? `Updated ${done}, ${updateFailures.length} failed` : 'Update failed', 'bad');
      return !updateFailures.length;
    }

    function drawContainers() {
      if (!list) return;
      drawUpdates();
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
        const busy = updating?.queue[updating.index]?.id === c.id;
        return h(
          'button',
          { type: 'button', class: 'row has-lead', onClick: () => containerActions(c) },
          containerIcon(s, c),
          h('span', { class: 'row-main' }, h('span', { class: 'row-title', text: name }), h('span', { class: 'row-sub', text: busy ? 'Updating…' : c.status || c.state })),
          c.isUpdateAvailable && !busy ? h('span', { class: 'tag warn', text: 'Update' }) : null,
          light(busy ? 'active' : state),
        );
      });

      const tools = [];
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
        containers.set(updatesEl, h('div', { style: { height: '12px' } }), search.el, filters.el, h('div', { style: { height: '12px' } }), listNode);
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
          // Updates run in the background with progress at the top of the list.
          if (action === 'updateContainer') {
            sheet.close();
            runUpdates([c]);
            return;
          }
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
        // VM Manager off or no VMs: stay hidden. A key without VM access is the one case
        // worth showing, since there may be VMs Deckarr can't see.
        if (!vmList) {
          const msg = vmErrorMessage(err);
          vms.el.hidden = !/API key/.test(msg);
          vms.setAside(null);
          vms.set(notice(msg, { retry: loadVms }));
        }
        return;
      }
      vms.el.hidden = !vmList.length;
      vmList.sort((a, b) => String(a.name).localeCompare(String(b.name), 'en', { sensitivity: 'base' }));
      const running = vmList.filter(vmRunning);
      const stopped = vmList.filter((vm) => !vmRunning(vm) && !vmPaused(vm) && vm.state !== 'SHUTDOWN');
      vms.setAside(vmList.length ? `${running.length} of ${vmList.length} running` : null);

      if (!vmList.length) return;

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

    // Opened from a push notification: show that server's notifications.
    if (params?.get('notifications') === s.id) {
      history.replaceState(history.state, '', '#/server');
      openNotifications(s, { onChange: loadOverview });
    }

    drawManage(null);
    loadOverview();
    loadContainers(true);
    loadVms();
    ctx.poll(loadContainers, 10000);
    ctx.poll(loadOverview, 15000);
    ctx.poll(loadVms, 30000);
  }

  // ---------- Proxmox VE ----------
  for (const s of proxmoxes.filter(shown)) renderProxmox(root, ctx, s, { head, multiple: servers.length > 1 });

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

// The server picked last on this device.
const PICK_KEY = 'deckarr.server';
function readPick() {
  try {
    return localStorage.getItem(PICK_KEY);
  } catch {
    return null;
  }
}
function savePick(id) {
  try {
    localStorage.setItem(PICK_KEY, id);
  } catch {
    /* private mode: the first server is shown instead */
  }
}
