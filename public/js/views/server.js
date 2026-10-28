import { h, light, bar, fmt, pageHead, section, skeletonList, notice, emptyState, searchField, actionSheet, runAction, initials, toast } from '../ui.js';
import { unraid, jellyfin, prowlarr, healthIssues, byType, webBase } from '../services.js';

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
    const containers = section('Containers');
    const vms = section('Virtual machines');
    vms.el.hidden = true;
    root.append(overview.el, containers.el, vms.el);

    let query = '';
    let list = null;
    const search = searchField('Search containers', (v) => {
      query = v;
      drawContainers();
    });

    async function loadOverview() {
      try {
        const o = await unraid.overview(s);
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
        );
        overview.el.querySelector('.bar')?.classList.add('meter');
      } catch (err) {
        overview.set(notice(err.message, { retry: loadOverview }));
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
      const running = list.filter((c) => c.state === 'RUNNING').length;
      containers.setAside(`${running} of ${list.length} running`);
      const q = query.toLowerCase();
      const shown = list.filter((c) => !q || cname(c).toLowerCase().includes(q) || (c.image || '').toLowerCase().includes(q));
      const rows = shown.map((c) => {
        const name = cname(c);
        const state = c.state === 'RUNNING' ? 'ok' : c.state === 'PAUSED' ? 'warn' : '';
        return h(
          'button',
          { type: 'button', class: 'row has-lead', onClick: () => containerActions(c) },
          containerIcon(s, c),
          h('span', { class: 'row-main' }, h('span', { class: 'row-title', text: name }), h('span', { class: 'row-sub', text: c.status || c.state })),
          light(state),
        );
      });
      const nodes = list.length > 8 ? [search.el, h('div', { style: { height: '12px' } })] : [];
      nodes.push(rows.length ? h('div', { class: 'list' }, rows) : h('p', { class: 'quiet', text: list.length ? 'No containers match.' : 'No containers.' }));
      // Keep focus in the search box while filtering.
      if (containers.body.contains(search.el)) {
        const listEl = containers.body.querySelector(':scope > .list, :scope > .quiet');
        if (listEl) listEl.replaceWith(nodes[nodes.length - 1]);
        else containers.set(...nodes);
      } else {
        containers.set(...nodes);
      }
    }

    async function containerActions(c) {
      const name = cname(c);
      const running = c.state === 'RUNNING';
      const actions = running
        ? [
            { label: 'Restart', value: 'restart' },
            { label: 'Stop', value: 'stop', destructive: true },
          ]
        : [{ label: 'Start', value: 'start' }];
      if (running && c.webUiUrl) actions.unshift({ label: 'Open web UI', value: 'open' });
      const choice = await actionSheet({ title: name, message: c.image, actions });
      if (!choice) return;
      if (choice === 'open') {
        window.open(c.webUiUrl, '_blank', 'noopener');
        return;
      }
      const verb = { start: 'Started', stop: 'Stopped', restart: 'Restarted' }[choice];
      await runAction(null, () => unraid.dockerAction(s, choice, c.id), { success: `${verb} ${name}` });
      loadContainers();
    }

    async function loadVms() {
      const domains = await unraid.vms(s);
      vms.el.hidden = !domains?.length;
      if (!domains?.length) return;
      vms.set(
        h(
          'div',
          { class: 'list' },
          domains.map((vm) => {
            const running = vm.state === 'RUNNING';
            return h(
              'button',
              {
                type: 'button',
                class: 'row',
                onClick: async () => {
                  const choice = await actionSheet({
                    title: vm.name,
                    actions: [running ? { label: 'Shut down', value: 'stop', destructive: true } : { label: 'Start', value: 'start' }],
                  });
                  if (!choice) return;
                  await runAction(null, () => unraid.vmAction(s, choice, vm.id), { success: choice === 'start' ? `Starting ${vm.name}` : `Shutting down ${vm.name}` });
                  setTimeout(loadVms, 1500);
                },
              },
              h('span', { class: 'row-main' }, h('span', { class: 'row-title', text: vm.name }), h('span', { class: 'row-sub', text: vm.state.charAt(0) + vm.state.slice(1).toLowerCase() })),
              light(running ? 'ok' : vm.state === 'PAUSED' ? 'warn' : ''),
            );
          }),
        ),
      );
    }

    loadOverview();
    loadContainers(true);
    loadVms();
    ctx.poll(loadContainers, 10000);
    ctx.poll(loadOverview, 30000);
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

