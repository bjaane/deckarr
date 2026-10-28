import {
  h,
  icon,
  fmt,
  pageHead,
  segmented,
  chips,
  searchField,
  posterImg,
  emptyState,
  notice,
  openSheet,
  actionSheet,
  switchInput,
  toast,
  runAction,
  chevron,
} from '../ui.js';
import {
  ARR,
  isLibrary,
  library,
  lookup,
  addOptions,
  addItem,
  getItem,
  normalizeItem,
  searchCommand,
  runCommand,
  setMonitored,
  setSeasonMonitored,
  removeItem,
  itemLink,
} from '../services.js';

const cache = new Map(); // service id -> items
const PAGE = 90;

const fold = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

function libLabel(s, libs) {
  return libs.filter((x) => x.type === s.type).length > 1 ? s.name : ARR[s.type].label;
}

export function render(root, ctx) {
  const libs = ctx.state.services.filter(isLibrary);

  if (!libs.length) {
    root.append(pageHead('Library').el);
    root.append(
      h(
        'div',
        { class: 'section' },
        emptyState({
          title: 'No library yet',
          body: 'Add Sonarr, Radarr or Lidarr to browse and add TV, movies and music.',
          action: { label: 'Add a service', onClick: () => ctx.navigate('settings', { add: '1' }) },
        }),
      ),
    );
    return;
  }

  const saved = sessionStorage.getItem('deckarr:lib');
  let svc = libs.find((s) => s.id === saved) || libs[0];
  let filter = 'all';
  let query = '';
  let items = cache.get(svc.id) || null;

  const addBtn = h('button', { type: 'button', class: 'icon-btn accent', 'aria-label': ARR[svc.type].addLabel }, icon('plus', 20));
  addBtn.addEventListener('click', () => openAdd(ctx, svc, { onAdded: () => load(true) }));
  root.append(pageHead('Library', null, addBtn).el);

  const seg = libs.length > 1
    ? segmented(libs.map((s) => ({ value: s.id, label: libLabel(s, libs) })), svc.id, (id) => {
        svc = libs.find((s) => s.id === id);
        sessionStorage.setItem('deckarr:lib', id);
        addBtn.setAttribute('aria-label', ARR[svc.type].addLabel);
        items = cache.get(svc.id) || null;
        filter = 'all';
        search.input.value = '';
        query = '';
        search.input.placeholder = `Search ${ARR[svc.type].plural}`;
        draw();
        load();
      })
    : null;

  const search = searchField(`Search ${ARR[svc.type].plural}`, (v) => {
    query = v;
    draw();
  });
  const filterChips = chips([], filter, (v) => {
    filter = v;
    draw();
  });
  const body = h('div');
  root.append(seg, search.el, filterChips.el, body);

  let observer;
  ctx.onDispose(() => observer?.disconnect());

  function draw() {
    observer?.disconnect();
    if (!items) {
      body.replaceChildren(h('div', { class: 'grid', 'aria-busy': 'true' }, Array.from({ length: 9 }, () => h('div', null, h('div', { class: 'poster skel' })))));
      return;
    }
    const counts = {
      all: items.length,
      missing: items.filter((i) => i.missing).length,
      unmonitored: items.filter((i) => !i.monitored).length,
    };
    filterChips.update([
      { value: 'all', label: 'All', count: counts.all },
      { value: 'missing', label: 'Missing', count: counts.missing },
      { value: 'unmonitored', label: 'Unmonitored', count: counts.unmonitored },
    ]);

    const q = fold(query);
    const visible = items.filter((i) => {
      if (filter === 'missing' && !i.missing) return false;
      if (filter === 'unmonitored' && i.monitored) return false;
      return !q || fold(i.title).includes(q);
    });

    if (!visible.length) {
      body.replaceChildren(
        h(
          'div',
          { class: 'section' },
          query
            ? emptyState({
                title: `No match for “${query}”`,
                body: `Want to add it to ${ARR[svc.type].label}?`,
                action: { label: ARR[svc.type].addLabel, onClick: () => openAdd(ctx, svc, { term: query, onAdded: () => load(true) }) },
              })
            : emptyState({
                title: filter === 'missing' ? 'Nothing missing' : filter === 'unmonitored' ? 'Everything is monitored' : `No ${ARR[svc.type].plural} yet`,
                body: filter === 'all' ? `Add your first ${ARR[svc.type].noun} with the + button.` : null,
              }),
        ),
      );
      return;
    }

    const grid = h('div', { class: 'grid' });
    let shown = 0;
    const more = () => {
      const slice = visible.slice(shown, shown + PAGE);
      shown += slice.length;
      grid.append(...slice.map(tile));
      if (shown >= visible.length) observer?.disconnect();
    };
    const sentinel = h('div', { style: { height: '1px' } });
    body.replaceChildren(grid, sentinel);
    more();
    if (shown < visible.length) {
      observer = new IntersectionObserver((entries) => entries[0].isIntersecting && more(), { rootMargin: '600px' });
      observer.observe(sentinel);
    }
  }

  function tile(item) {
    const wrap = posterImg(item.poster, item.title);
    if (item.missing) wrap.append(h('span', { class: 'tile-flag', title: 'Missing files' }));
    return h(
      'button',
      { type: 'button', class: `tile${item.monitored ? '' : ' dim'}`, onClick: () => openDetail(ctx, svc, item.id, { onChange: () => load(true) }) },
      wrap,
      h('div', { class: 'tile-title', text: item.title }),
      h('div', { class: 'tile-sub', text: item.sub }),
    );
  }

  async function load(force = false) {
    const target = svc;
    if (!items || force) draw();
    try {
      const fresh = await library(target);
      cache.set(target.id, fresh);
      if (target !== svc) return;
      items = fresh;
      draw();
    } catch (err) {
      if (target !== svc) return;
      if (!items) body.replaceChildren(h('div', { class: 'section' }, notice(err.message, { retry: () => load(true) })));
      else toast(err.message, 'bad');
    }
  }

  draw();
  load();
}

// ---------- detail sheet ----------

export async function openDetail(ctx, s, id, { onChange } = {}) {
  const sheet = openSheet({ title: '', tall: true });
  sheet.set(h('div', { class: 'detail-head' }, h('div', { class: 'poster-wrap' }, h('div', { class: 'poster skel' }))));

  let raw;
  try {
    raw = await getItem(s, id);
  } catch (err) {
    sheet.set(notice(err.message));
    return;
  }

  const draw = () => {
    const it = normalizeItem(s, raw);
    const conf = ARR[s.type];
    const overview = it.overview ? h('p', { class: 'overview', text: it.overview }) : null;
    overview?.addEventListener('click', () => overview.classList.toggle('open'));

    const tags = [];
    if (it.status) tags.push(h('span', { class: `tag${it.missing ? ' warn' : it.hasFile || (it.total && it.have >= it.total) ? ' ok' : ''}`, text: it.status }));
    if (!it.monitored) tags.push(h('span', { class: 'tag', text: 'Unmonitored' }));

    const monitorSwitch = switchInput(it.monitored, async (checked, input) => {
      input.disabled = true;
      try {
        raw = await setMonitored(s, raw.id, checked);
        toast(checked ? 'Monitoring on' : 'Monitoring off');
        onChange?.();
        draw();
      } catch (err) {
        input.checked = !checked;
        toast(err.message, 'bad');
      } finally {
        input.disabled = false;
      }
    }, 'Monitored');

    const facts = [];
    if (s.type === 'sonarr') facts.push(['Episodes', it.total ? `${it.have} of ${it.total}` : 'None aired yet']);
    if (s.type === 'lidarr') facts.push(['Tracks', it.total ? `${it.have} of ${it.total}` : 'None yet']);
    if (it.size) facts.push(['On disk', fmt.bytes(it.size)]);
    if (raw.path) facts.push(['Folder', raw.path]);

    const searchBtn = h('button', { type: 'button', class: 'btn btn-primary' }, icon('search', 18), 'Search now');
    searchBtn.addEventListener('click', () =>
      runAction(searchBtn, () => runCommand(s, searchCommand(s, raw)), { success: `Searching for ${it.title}` }),
    );
    const openBtn = h('a', { class: 'btn', href: itemLink(s, raw), target: '_blank', rel: 'noopener' }, icon('external', 18), h('span', { text: s.name }));

    const seasons = s.type === 'sonarr' && raw.seasons?.length
      ? h(
          'div',
          null,
          h('p', { class: 'group-label', text: 'Seasons' }),
          h(
            'div',
            { class: 'list' },
            [...raw.seasons]
              .sort((a, b) => (a.seasonNumber === 0) - (b.seasonNumber === 0) || b.seasonNumber - a.seasonNumber)
              .map((season) => seasonRow(season)),
          ),
        )
      : null;

    function seasonRow(season) {
      const st = season.statistics || {};
      const label = season.seasonNumber === 0 ? 'Specials' : `Season ${season.seasonNumber}`;
      const sw = switchInput(season.monitored, async (checked, input) => {
        input.disabled = true;
        try {
          raw = await setSeasonMonitored(s, raw.id, season.seasonNumber, checked);
          onChange?.();
        } catch (err) {
          input.checked = !checked;
          toast(err.message, 'bad');
        } finally {
          input.disabled = false;
        }
      }, `Monitor ${label}`);
      const find = h('button', { type: 'button', class: 'icon-btn plain', 'aria-label': `Search ${label}` }, icon('search', 19));
      find.addEventListener('click', () => runAction(find, () => runCommand(s, searchCommand(s, raw, season.seasonNumber)), { success: `Searching for ${label}` }));
      return h(
        'div',
        { class: 'row' },
        h('span', { class: 'row-main' }, h('span', { class: 'row-title', text: label }), h('span', { class: 'row-sub', text: st.episodeCount ? `${st.episodeFileCount || 0} of ${st.episodeCount} episodes` : `${st.totalEpisodeCount || 0} episodes` })),
        find,
        sw,
      );
    }

    const removeBtn = h('button', { type: 'button', class: 'btn btn-danger btn-block' }, `Remove from ${conf.label}`);
    removeBtn.addEventListener('click', async () => {
      const choice = await actionSheet({
        title: `Remove ${it.title}?`,
        message: `${s.name} stops tracking it. Choose whether to keep the files on disk.`,
        actions: [
          { label: 'Remove, keep files', value: 'keep', destructive: true },
          { label: 'Remove and delete files', value: 'delete', destructive: true },
        ],
      });
      if (!choice) return;
      const done = await runAction(removeBtn, () => removeItem(s, raw.id, choice === 'delete'), { success: `Removed ${it.title}` });
      if (done !== undefined) {
        sheet.close();
        onChange?.();
      }
    });

    sheet.set(
      h(
        'div',
        { class: 'detail-head' },
        posterImg(it.poster, it.title, { done: it.hasFile }),
        h('div', null, h('h3', { class: 'detail-title', text: it.title }), it.meta ? h('div', { class: 'detail-meta', text: it.meta }) : null, h('div', { class: 'detail-tags' }, tags)),
      ),
      overview,
      h('div', { class: 'btn-row' }, searchBtn, openBtn),
      h('p', { class: 'group-label', text: 'Details' }),
      h(
        'div',
        { class: 'list' },
        h('div', { class: 'row' }, h('span', { class: 'row-main' }, h('span', { class: 'row-title', text: 'Monitored' }), h('span', { class: 'row-sub', text: 'Grab new releases automatically' })), monitorSwitch),
        facts.map(([k, v]) => h('div', { class: 'row' }, h('span', { class: 'row-main row-title', text: k }), h('span', { class: 'row-trail', text: v, style: { maxWidth: '60%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }))),
      ),
      seasons,
      h('div', { class: 'stack' }, removeBtn),
    );
  };

  draw();
}

// ---------- add flow ----------

const MONITOR_SONARR = [
  ['all', 'All episodes'],
  ['future', 'Future episodes'],
  ['missing', 'Missing episodes'],
  ['existing', 'Existing episodes'],
  ['firstSeason', 'First season'],
  ['latestSeason', 'Latest season'],
  ['pilot', 'Pilot episode'],
  ['none', 'None'],
];
const MONITOR_LIDARR = [
  ['all', 'All albums'],
  ['future', 'Future albums'],
  ['missing', 'Missing albums'],
  ['existing', 'Existing albums'],
  ['first', 'First album'],
  ['latest', 'Latest album'],
  ['none', 'None'],
];
const AVAILABILITY = [
  ['announced', 'Announced'],
  ['inCinemas', 'In cinemas'],
  ['released', 'Released'],
];

function select(label, options, value) {
  const el = h('select', { 'aria-label': label }, options.map(([v, text]) => h('option', { value: String(v), text, selected: String(v) === String(value) })));
  return { field: h('label', { class: 'field' }, h('span', { text: label }), el), el };
}

export function openAdd(ctx, s, { term = '', onAdded } = {}) {
  const conf = ARR[s.type];
  const sheet = openSheet({ title: conf.addLabel, tall: true });
  let lastResults = [];
  let lastTerm = term;
  let options = null;
  let seq = 0;

  const search = searchField(`Find a ${conf.noun} to add`, (v) => find(v), { value: term, autofocus: true });
  const results = h('div', { style: { marginTop: '14px' } });

  function showSearch() {
    sheet.setTitle(conf.addLabel);
    sheet.set(search.el, results);
    if (!lastResults.length && !lastTerm) results.replaceChildren(h('p', { class: 'quiet', text: `Search by name. Results come from ${s.name}.` }));
  }

  async function find(v) {
    lastTerm = v;
    const mine = ++seq;
    if (v.length < 2) {
      lastResults = [];
      results.replaceChildren(h('p', { class: 'quiet', text: `Search by name. Results come from ${s.name}.` }));
      return;
    }
    results.replaceChildren(h('p', { class: 'quiet', text: 'Searching…' }));
    try {
      const found = await lookup(s, v);
      if (mine !== seq) return;
      lastResults = found;
      if (!found.length) {
        results.replaceChildren(h('p', { class: 'quiet', text: `No ${conf.plural} found for “${v}”.` }));
        return;
      }
      results.replaceChildren(
        h(
          'div',
          { class: 'list' },
          found.map((r) =>
            h(
              'button',
              { type: 'button', class: 'row', onClick: () => (r.inLibrary ? (sheet.close(), openDetail(ctx, s, r.raw.id)) : choose(r)) },
              h('span', { class: 'result-thumb' }, posterImg(r.poster, r.title)),
              h('span', { class: 'row-main' }, h('span', { class: 'row-title', text: r.title }), h('span', { class: 'row-sub', text: r.meta }), r.overview ? h('span', { class: 'row-sub', text: r.overview }) : null),
              r.inLibrary ? h('span', { class: 'tag ok', text: 'In library' }) : chevron(),
            ),
          ),
        ),
      );
    } catch (err) {
      if (mine === seq) results.replaceChildren(notice(err.message, { retry: () => find(v) }));
    }
  }

  async function choose(result) {
    sheet.setTitle(result.title);
    sheet.set(h('p', { class: 'quiet', text: 'Loading options…' }));
    try {
      options = options || (await addOptions(s));
    } catch (err) {
      sheet.set(notice(err.message, { retry: () => choose(result) }));
      return;
    }
    if (!options.profiles.length || !options.folders.length) {
      sheet.set(notice(`${s.name} needs at least one quality profile and one root folder before you can add anything. Set them up in ${s.name} first.`));
      return;
    }

    const prefsKey = `deckarr:add:${s.id}`;
    const prefs = JSON.parse(localStorage.getItem(prefsKey) || '{}');
    const has = (list, key, v) => list?.some((x) => String(x[key]) === String(v));

    const quality = select('Quality profile', options.profiles.map((p) => [p.id, p.name]), has(options.profiles, 'id', prefs.qualityProfileId) ? prefs.qualityProfileId : options.profiles[0].id);
    const folder = select('Root folder', options.folders.map((f) => [f.path, f.freeSpace != null ? `${f.path} (${fmt.bytes(f.freeSpace)} free)` : f.path]), has(options.folders, 'path', prefs.rootFolderPath) ? prefs.rootFolderPath : options.folders[0].path);
    const monitor = s.type === 'radarr' ? null : select('Monitor', s.type === 'sonarr' ? MONITOR_SONARR : MONITOR_LIDARR, prefs.monitor || 'all');
    const availability = s.type === 'radarr' ? select('Available when', AVAILABILITY, prefs.minimumAvailability || 'released') : null;
    const metadata = options.metadataProfiles ? select('Metadata profile', options.metadataProfiles.map((p) => [p.id, p.name]), has(options.metadataProfiles, 'id', prefs.metadataProfileId) ? prefs.metadataProfileId : options.metadataProfiles[0]?.id) : null;
    const language = options.languageProfiles ? select('Language profile', options.languageProfiles.map((p) => [p.id, p.name]), prefs.languageProfileId || options.languageProfiles[0].id) : null;
    const startSearch = switchInput(prefs.search !== false, () => {}, 'Start searching now');

    const addBtn = h('button', { type: 'button', class: 'btn btn-primary btn-block' }, conf.addLabel);
    const back = h('button', { type: 'button', class: 'btn btn-block', onClick: showSearch }, icon('back', 18), 'Back to results');

    addBtn.addEventListener('click', async () => {
      const o = {
        qualityProfileId: Number(quality.el.value),
        rootFolderPath: folder.el.value,
        monitor: monitor?.el.value,
        minimumAvailability: availability?.el.value,
        metadataProfileId: metadata ? Number(metadata.el.value) : undefined,
        languageProfileId: language ? Number(language.el.value) : undefined,
        search: startSearch.checked,
      };
      localStorage.setItem(prefsKey, JSON.stringify(o));
      const added = await runAction(addBtn, () => addItem(s, result.raw, o), { success: `Added ${result.title}` });
      if (added) {
        sheet.close();
        onAdded?.();
      }
    });

    sheet.set(
      h('div', { class: 'detail-head' }, posterImg(result.poster, result.title), h('div', null, h('h3', { class: 'detail-title', text: result.title }), result.meta ? h('div', { class: 'detail-meta', text: result.meta }) : null)),
      result.overview ? h('p', { class: 'overview', text: result.overview }) : null,
      h('p', { class: 'group-label', text: 'Options' }),
      h(
        'div',
        { class: 'list' },
        quality.field,
        folder.field,
        monitor?.field,
        availability?.field,
        metadata?.field,
        language?.field,
        h('div', { class: 'row' }, h('span', { class: 'row-main' }, h('span', { class: 'row-title', text: 'Start searching now' }), h('span', { class: 'row-sub wrap', text: `${s.name} looks for a release right away` })), startSearch),
      ),
      h('div', { class: 'stack' }, addBtn, back),
    );
  }

  showSearch();
  if (term) find(term);
}
