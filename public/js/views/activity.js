import { h, light, statusMark, bar, fmt, pageHead, segmented, chips, skeletonList, notice, emptyState, openSheet, actionSheet, toast, runAction } from '../ui.js';
import { arrQueues, removeFromQueue, qbit, torrentState, sab, isLibrary, byType } from '../services.js';

const STATE_LIGHT = { active: 'active', queued: '', paused: '', ok: 'ok', warn: 'warn', bad: 'bad' };

export function render(root, ctx) {
  const { services } = ctx.state;
  const libraries = services.filter(isLibrary);
  const qbits = byType(services, 'qbittorrent');
  const sabs = byType(services, 'sabnzbd');
  const head = pageHead('Activity');
  root.append(head.el);

  const tabs = [];
  if (libraries.length) tabs.push({ value: 'queue', label: 'Queue' });
  if (qbits.length) tabs.push({ value: 'torrents', label: 'Torrents' });
  if (sabs.length) tabs.push({ value: 'usenet', label: 'Usenet' });

  if (!tabs.length) {
    root.append(
      h(
        'div',
        { class: 'section' },
        emptyState({
          title: 'Nothing to show yet',
          body: 'Add Sonarr, Radarr, Lidarr, qBittorrent or SABnzbd to follow downloads here.',
          action: { label: 'Add a service', onClick: () => ctx.navigate('settings', { add: '1' }) },
        }),
      ),
    );
    return;
  }

  let tab = tabs.some((t) => t.value === sessionStorage.getItem('deckarr:activity')) ? sessionStorage.getItem('deckarr:activity') : tabs[0].value;
  let torrentFilter = 'all';
  const body = h('div', { class: 'section' });
  let busy = false;
  let fresh = true;

  if (tabs.length > 1) {
    root.append(
      segmented(tabs, tab, (v) => {
        tab = v;
        sessionStorage.setItem('deckarr:activity', v);
        fresh = true;
        load();
      }),
    );
  }
  root.append(body);

  // ---- speed in the header ----
  async function loadSpeed() {
    const [t, u] = await Promise.all([
      Promise.allSettled(qbits.map((s) => qbit.transfer(s))),
      Promise.allSettled(sabs.map((s) => sab.queue(s))),
    ]);
    let down = 0;
    let up = 0;
    for (const r of t) if (r.status === 'fulfilled') {
      down += r.value.dl_info_speed || 0;
      up += r.value.up_info_speed || 0;
    }
    for (const r of u) if (r.status === 'fulfilled') down += (Number(r.value.queue?.kbpersec) || 0) * 1024;
    head.setSub(down || up ? `Down ${fmt.speed(down)}, up ${fmt.speed(up)}` : 'Idle');
  }

  async function load() {
    if (busy) return;
    busy = true;
    if (fresh) body.replaceChildren(skeletonList(4));
    try {
      if (tab === 'queue') await drawQueue();
      else if (tab === 'torrents') await drawTorrents();
      else await drawUsenet();
      fresh = false;
    } catch (err) {
      body.replaceChildren(notice(err.message, { retry: load }));
    } finally {
      busy = false;
    }
  }

  // ---- arr queue ----
  async function drawQueue() {
    const { items, errors } = await arrQueues(libraries);
    const nodes = [];
    if (errors.length) nodes.push(h('div', { style: { marginBottom: '12px' } }, notice(errors[0].message, { kind: 'warn' })));
    if (!items.length) {
      nodes.push(emptyState({ title: 'The queue is empty', body: 'Anything Sonarr, Radarr or Lidarr sends to a download client shows up here.' }));
    } else {
      const order = { bad: 0, warn: 1, active: 2, ok: 3, paused: 4, queued: 5 };
      items.sort((a, b) => order[a.state] - order[b.state] || b.progress - a.progress);
      nodes.push(
        h(
          'div',
          { class: 'list' },
          items.map((q) =>
            h(
              'button',
              { type: 'button', class: 'row', onClick: () => queueSheet(q) },
              statusMark(STATE_LIGHT[q.state]),
              h(
                'span',
                { class: 'row-main' },
                h('span', { class: 'row-title', text: q.title }),
                h('span', { class: `row-sub${q.state === 'warn' || q.state === 'bad' ? ` ${q.state}` : ''}`, text: q.state === 'active' ? q.sub : `${q.stateLabel}${q.sub ? `, ${q.sub}` : ''}` }),
                bar(q.progress, q.state === 'active' ? '' : q.state),
              ),
              h('span', { class: 'row-trail' }, h('b', { text: fmt.percent(q.progress) }), fmt.eta(q.eta)),
            ),
          ),
        ),
      );
    }
    body.replaceChildren(...nodes);
  }

  function queueSheet(q) {
    const sheet = openSheet({ title: q.title });
    const rows = [
      ['Status', q.stateLabel],
      ['Progress', `${fmt.percent(q.progress)} of ${fmt.bytes(q.size)}`],
      q.eta ? ['Time left', fmt.eta(q.eta)] : null,
      q.quality ? ['Quality', q.quality] : null,
      q.client ? ['Client', q.client] : null,
      q.indexer ? ['Indexer', q.indexer] : null,
      ['Added by', q.svc.name],
    ].filter(Boolean);

    const remove = async (blocklist) => {
      const ok = await runAction(null, () => removeFromQueue(q.svc, q.queueId, blocklist), {
        success: blocklist ? 'Removed and blocklisted' : 'Removed from queue',
      });
      if (ok !== undefined) {
        sheet.close();
        load();
      }
    };

    sheet.set(
      q.sub ? h('p', { class: 'sheet-msg', text: q.sub }) : null,
      q.messages.length ? h('div', { style: { marginBottom: '14px' } }, notice(q.messages.join(' '), { kind: q.state === 'bad' ? '' : 'warn' })) : null,
      h(
        'div',
        { class: 'list' },
        rows.map(([k, v]) => h('div', { class: 'row' }, h('span', { class: 'row-main row-title', text: k }), h('span', { class: 'row-trail', text: v }))),
      ),
      h('p', { class: 'group-label', text: 'Release' }),
      h('div', { class: 'list' }, h('div', { class: 'row' }, h('span', { class: 'row-main' }, h('span', { class: 'row-sub wrap', text: q.release })))),
      h(
        'div',
        { class: 'stack' },
        h('button', { type: 'button', class: 'btn btn-block', onClick: () => remove(false) }, 'Remove from queue'),
        h('button', { type: 'button', class: 'btn btn-danger btn-block', onClick: () => remove(true) }, 'Remove and blocklist release'),
      ),
      h('p', { class: 'hint', text: 'Both remove the download from the client. Blocklisting stops this exact release from being grabbed again.' }),
    );
  }

  // ---- torrents ----
  const filterChips = chips([], torrentFilter, (v) => {
    torrentFilter = v;
    load();
  });

  async function drawTorrents() {
    const results = await Promise.allSettled(qbits.map(async (s) => (await qbit.torrents(s)).map((t) => ({ ...t, svc: s, st: torrentState(t) }))));
    const failed = results.filter((r) => r.status === 'rejected');
    if (failed.length === results.length) throw failed[0].reason;
    const all = results.filter((r) => r.status === 'fulfilled').flatMap((r) => r.value);
    const groups = { downloading: 0, seeding: 0, stopped: 0, error: 0 };
    for (const t of all) if (t.st.group in groups) groups[t.st.group] += 1;
    const options = [
      { value: 'all', label: 'All', count: all.length },
      { value: 'downloading', label: 'Downloading', count: groups.downloading },
      { value: 'seeding', label: 'Seeding', count: groups.seeding },
      { value: 'stopped', label: 'Stopped', count: groups.stopped },
    ];
    if (groups.error) options.push({ value: 'error', label: 'Errors', count: groups.error });
    filterChips.update(options);

    const list = torrentFilter === 'all' ? all : all.filter((t) => t.st.group === torrentFilter);
    const multi = qbits.length > 1;
    const nodes = [filterChips.el, h('div', { style: { height: '12px' } })];
    if (failed.length) nodes.push(h('div', { style: { marginBottom: '12px' } }, notice(failed[0].reason.message, { kind: 'warn' })));
    if (!list.length) {
      nodes.push(h('p', { class: 'quiet', text: torrentFilter === 'all' ? 'No torrents.' : 'No torrents in this group.' }));
    } else {
      nodes.push(
        h(
          'div',
          { class: 'list' },
          list.slice(0, 300).map((t) => {
            const g = t.st.group;
            const lightState = g === 'downloading' ? 'active' : g === 'seeding' ? 'ok' : g === 'error' ? 'bad' : '';
            const detail = g === 'downloading'
              ? `${t.st.label}, ${fmt.speed(t.dlspeed)}`
              : g === 'seeding'
                ? `${t.st.label}, ratio ${Number(t.ratio || 0).toFixed(2)}`
                : t.st.label;
            return h(
              'button',
              { type: 'button', class: 'row', onClick: () => torrentActions(t) },
              light(lightState),
              h(
                'span',
                { class: 'row-main' },
                h('span', { class: 'row-title', text: t.name }),
                h('span', { class: 'row-sub', text: multi ? `${detail} (${t.svc.name})` : detail }),
                t.progress < 1 ? bar(t.progress, g === 'stopped' ? 'paused' : g === 'error' ? 'bad' : '') : null,
              ),
              h('span', { class: 'row-trail' }, h('b', { text: t.progress < 1 ? fmt.percent(t.progress) : fmt.bytes(t.size) }), g === 'downloading' ? fmt.eta(t.eta) : ''),
            );
          }),
        ),
      );
    }
    body.replaceChildren(...nodes);
  }

  async function torrentActions(t) {
    const stopped = t.st.group === 'stopped';
    const choice = await actionSheet({
      title: t.name,
      message: `${fmt.bytes(t.size)}${t.category ? `, category ${t.category}` : ''}`,
      actions: [
        { label: stopped ? 'Resume' : 'Pause', value: 'toggle' },
        { label: 'Delete torrent, keep files', value: 'delete', destructive: true },
        { label: 'Delete torrent and files', value: 'purge', destructive: true },
      ],
    });
    if (!choice) return;
    const run = {
      toggle: () => (stopped ? qbit.resume(t.svc, t.hash) : qbit.pause(t.svc, t.hash)),
      delete: () => qbit.remove(t.svc, t.hash, false),
      purge: () => qbit.remove(t.svc, t.hash, true),
    }[choice];
    const label = { toggle: stopped ? 'Resumed' : 'Paused', delete: 'Torrent deleted', purge: 'Torrent and files deleted' }[choice];
    await runAction(null, run, { success: label });
    load();
  }

  // ---- usenet ----
  async function drawUsenet() {
    const results = await Promise.allSettled(sabs.map(async (s) => ({ svc: s, queue: (await sab.queue(s)).queue })));
    const failed = results.filter((r) => r.status === 'rejected');
    if (failed.length === results.length) throw failed[0].reason;
    const nodes = [];
    for (const r of results) {
      if (r.status !== 'fulfilled') continue;
      const { svc, queue } = r.value;
      const paused = Boolean(queue.paused);
      const toggle = h('button', { type: 'button', class: 'btn btn-small' }, paused ? 'Resume all' : 'Pause all');
      toggle.addEventListener('click', async () => {
        await runAction(toggle, () => (paused ? sab.resumeAll(svc) : sab.pauseAll(svc)), { success: paused ? 'Queue resumed' : 'Queue paused' });
        load();
      });
      const slots = queue.slots || [];
      nodes.push(
        h(
          'div',
          { class: 'list', style: { marginBottom: '14px' } },
          h(
            'div',
            { class: 'row' },
            light(paused ? '' : slots.length ? 'active' : 'ok'),
            h('span', { class: 'row-main' }, h('span', { class: 'row-title', text: svc.name }), h('span', { class: 'row-sub', text: paused ? 'Paused' : slots.length ? `Downloading at ${fmt.speed((Number(queue.kbpersec) || 0) * 1024)}` : 'Idle' })),
            toggle,
          ),
          slots.map((slot) => {
            const pct = (Number(slot.percentage) || 0) / 100;
            const itemPaused = slot.status === 'Paused';
            return h(
              'button',
              { type: 'button', class: 'row', onClick: () => slotActions(svc, slot) },
              h(
                'span',
                { class: 'row-main' },
                h('span', { class: 'row-title', text: slot.filename }),
                h('span', { class: 'row-sub', text: [slot.status, Number(slot.mbleft) ? `${fmt.bytes(Number(slot.mbleft) * 1048576)} left` : ''].filter(Boolean).join(', ') }),
                bar(pct, itemPaused ? 'paused' : ''),
              ),
              h('span', { class: 'row-trail' }, h('b', { text: fmt.percent(pct) }), fmt.eta(fmt.timeleft(slot.timeleft))),
            );
          }),
          slots.length ? null : h('div', { class: 'row' }, h('span', { class: 'row-sub', text: 'Nothing in the queue.' })),
        ),
      );
    }
    body.replaceChildren(...nodes);
  }

  async function slotActions(svc, slot) {
    const paused = slot.status === 'Paused';
    const choice = await actionSheet({
      title: slot.filename,
      actions: [
        { label: paused ? 'Resume' : 'Pause', value: 'toggle' },
        { label: 'Delete from queue', value: 'delete', destructive: true },
      ],
    });
    if (!choice) return;
    if (choice === 'toggle') await runAction(null, () => (paused ? sab.resumeItem(svc, slot.nzo_id) : sab.pauseItem(svc, slot.nzo_id)), { success: paused ? 'Resumed' : 'Paused' });
    else await runAction(null, () => sab.removeItem(svc, slot.nzo_id), { success: 'Deleted from queue' });
    load();
  }

  load();
  loadSpeed();
  ctx.poll(load, 3000);
  ctx.poll(loadSpeed, 3000);
}
