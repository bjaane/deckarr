import { api } from '../api.js';
import { h, light, bar, fmt, pageHead, section, skeletonList, skeletonShelf, emptyState, posterImg, chevron } from '../ui.js';
import { upcoming, arrQueues, qbit, torrentState, sab, jellyfin, isLibrary, byType } from '../services.js';
import { openDetail } from './library.js';

export function render(root, ctx) {
  const { services } = ctx.state;
  const now = new Date();
  const head = pageHead(fmt.weekday(now), fmt.longDate(now));
  root.append(head.el);

  if (!services.length) {
    root.append(
      h(
        'div',
        { class: 'section' },
        emptyState({
          title: 'Connect your first service',
          body: 'Add Sonarr, Radarr, qBittorrent or any of the others. This screen then shows what’s coming and what’s downloading.',
          action: { label: 'Add a service', onClick: () => ctx.navigate('settings', { add: '1' }) },
        }),
      ),
    );
    return;
  }

  const libraries = services.filter(isLibrary);
  const qbits = byType(services, 'qbittorrent');
  const sabs = byType(services, 'sabnzbd');
  const jellyfins = byType(services, 'jellyfin');

  const statusEl = h('div', { class: 'section' });
  const shelf = libraries.length ? section('Coming up', 'Next 7 days') : null;
  const downloads = section('Downloading', h('a', { href: '#/activity', text: 'See all' }));
  const playing = jellyfins.length ? section('Now playing') : null;
  if (playing) playing.el.hidden = true;

  root.append(statusEl, shelf?.el, downloads.el, playing?.el);

  // ---- service status ----
  async function loadStatus() {
    let status;
    try {
      status = await api('/api/status');
    } catch {
      return;
    }
    const down = services.filter((s) => status[s.id] && !status[s.id].ok);
    if (!down.length) {
      statusEl.replaceChildren(
        h('div', { class: 'status-line' }, light('ok'), services.length === 1 ? `${services[0].name} is online` : `All ${services.length} services are online`),
      );
      return;
    }
    statusEl.replaceChildren(
      h(
        'div',
        { class: 'list' },
        down.map((s) =>
          h(
            'button',
            { type: 'button', class: 'row', onClick: () => ctx.navigate('settings', { edit: s.id }) },
            light('bad'),
            h('span', { class: 'row-main' }, h('span', { class: 'row-title', text: `${s.name} isn’t responding` }), h('span', { class: 'row-sub wrap', text: status[s.id].error })),
            chevron(),
          ),
        ),
      ),
    );
  }

  // ---- coming up ----
  async function loadShelf() {
    if (!shelf) return;
    shelf.set(skeletonShelf());
    const { items, errors } = await upcoming(libraries);
    if (!items.length) {
      shelf.set(h('p', { class: 'quiet', text: errors.length ? `Couldn’t load the calendar: ${errors[0].message}` : 'Nothing scheduled in the next 7 days.' }));
      return;
    }
    shelf.set(
      h(
        'div',
        { class: 'shelf' },
        items.map((it) =>
          h(
            'button',
            { type: 'button', class: 'shelf-item', onClick: () => openDetail(ctx, it.svc, it.itemId) },
            posterImg(it.poster, it.title, { done: it.done }),
            h('span', { class: `ticket${fmt.isToday(it.date) ? ' today' : ''}`, text: fmt.dayLabel(it.date) }),
            h('div', { class: 'shelf-title', text: it.title }),
            h('div', { class: 'shelf-sub', text: it.sub }),
            it.sub2 ? h('div', { class: 'shelf-sub', text: it.sub2 }) : null,
          ),
        ),
      ),
    );
  }

  // ---- downloading ----
  let firstDownloads = true;
  async function loadDownloads() {
    if (firstDownloads) downloads.set(skeletonList(2));
    const [queues, torrents, usenet] = await Promise.all([
      arrQueues(libraries),
      Promise.allSettled(qbits.map(async (s) => (await qbit.torrents(s)).map((t) => ({ ...t, svc: s })))),
      Promise.allSettled(sabs.map(async (s) => ({ svc: s, queue: (await sab.queue(s)).queue }))),
    ]);
    firstDownloads = false;

    const allTorrents = torrents.filter((r) => r.status === 'fulfilled').flatMap((r) => r.value);
    const sabQueues = usenet.filter((r) => r.status === 'fulfilled').map((r) => r.value);
    const byHash = new Map(allTorrents.map((t) => [t.hash.toLowerCase(), t]));

    let speed = allTorrents.reduce((sum, t) => sum + (t.dlspeed || 0), 0);
    speed += sabQueues.reduce((sum, q) => sum + (Number(q.queue?.kbpersec) || 0) * 1024, 0);

    const rows = [];
    const claimed = new Set();
    for (const q of queues.items) {
      const t = byHash.get(q.downloadId);
      if (t) claimed.add(t.hash);
      rows.push({
        key: q.key,
        title: q.title,
        sub: q.state === 'active' ? q.sub : q.stateLabel,
        progress: t ? t.progress : q.progress,
        state: q.state,
        eta: t ? t.eta : q.eta,
        rank: q.state === 'bad' || q.state === 'warn' ? 0 : q.state === 'active' ? 1 : 2,
      });
    }
    for (const t of allTorrents) {
      const st = torrentState(t);
      if (claimed.has(t.hash) || st.group !== 'downloading') continue;
      rows.push({ key: t.hash, title: t.name, sub: st.label, progress: t.progress, state: 'active', eta: t.eta, rank: 1 });
    }
    for (const { queue } of sabQueues) {
      for (const slot of queue?.slots || []) {
        if (rows.some((r) => r.title === slot.filename)) continue;
        rows.push({
          key: slot.nzo_id,
          title: slot.filename,
          sub: slot.status,
          progress: Number(slot.percentage) / 100,
          state: slot.status === 'Paused' ? 'paused' : 'active',
          eta: fmt.timeleft(slot.timeleft),
          rank: 1,
        });
      }
    }
    rows.sort((a, b) => a.rank - b.rank || (b.progress || 0) - (a.progress || 0));

    downloads.setAside(
      h('span', null, speed > 0 ? `${fmt.speed(speed)}  ` : '', h('a', { href: '#/activity', text: 'See all' })),
    );

    if (!rows.length) {
      const failed = queues.errors.length + torrents.filter((r) => r.status === 'rejected').length;
      downloads.set(h('p', { class: 'quiet', text: failed ? 'Some download sources couldn’t be reached.' : 'Nothing downloading right now.' }));
      return;
    }
    downloads.set(
      h(
        'a',
        { class: 'list', href: '#/activity', style: { display: 'block', textDecoration: 'none', color: 'inherit' } },
        rows.slice(0, 5).map((r) =>
          h(
            'div',
            { class: 'row' },
            h('span', { class: 'row-main' }, h('span', { class: 'row-title', text: r.title }), h('span', { class: `row-sub${r.state === 'warn' || r.state === 'bad' ? ` ${r.state}` : ''}`, text: r.sub || '' }), bar(r.progress, r.state === 'active' ? '' : r.state)),
            h('span', { class: 'row-trail' }, h('b', { text: fmt.percent(r.progress) }), fmt.eta(r.eta)),
          ),
        ),
        rows.length > 5 ? h('div', { class: 'row' }, h('span', { class: 'row-sub', text: `${rows.length - 5} more in Activity` })) : null,
      ),
    );
  }

  // ---- now playing ----
  async function loadPlaying() {
    if (!playing) return;
    const results = await Promise.allSettled(jellyfins.map(async (s) => (await jellyfin.sessions(s)).filter((x) => x.NowPlayingItem).map((x) => ({ ...x, svc: s }))));
    const sessions = results.filter((r) => r.status === 'fulfilled').flatMap((r) => r.value);
    playing.el.hidden = !sessions.length;
    if (!sessions.length) return;
    playing.set(
      h(
        'div',
        { class: 'list' },
        sessions.map((x) => {
          const item = x.NowPlayingItem;
          const pos = x.PlayState?.PositionTicks || 0;
          const len = item.RunTimeTicks || 0;
          const title = item.SeriesName || item.Name;
          const sub = item.SeriesName
            ? `S${String(item.ParentIndexNumber ?? 0).padStart(2, '0')}E${String(item.IndexNumber ?? 0).padStart(2, '0')}: ${item.Name}`
            : item.ProductionYear
              ? String(item.ProductionYear)
              : item.Type;
          const lead = h('span', { class: 'lead thumb' }, h('img', { src: jellyfin.image(x.svc, item.SeriesId || item.Id, 160), alt: '', loading: 'lazy' }));
          return h(
            'div',
            { class: 'row has-lead' },
            lead,
            h(
              'span',
              { class: 'row-main' },
              h('span', { class: 'row-title', text: title }),
              h('span', { class: 'row-sub', text: sub }),
              h('span', { class: 'row-sub', text: `${x.UserName || 'Someone'} on ${x.DeviceName || x.Client}${x.PlayState?.IsPaused ? ', paused' : ''}` }),
              len ? bar(pos / len, x.PlayState?.IsPaused ? 'paused' : 'ok') : null,
            ),
          );
        }),
      ),
    );
  }

  loadStatus();
  loadShelf();
  loadDownloads();
  loadPlaying();
  ctx.poll(loadDownloads, 5000);
  ctx.poll(loadStatus, 30000);
  ctx.poll(loadPlaying, 15000);
}
