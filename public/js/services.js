// One adapter per service. To support a new *arr, add an entry to ARR.

import { call, proxyUrl } from './api.js';
import { fmt } from './ui.js';

export const ARR = {
  sonarr: {
    v: 'v3',
    item: 'series',
    lookup: 'series/lookup',
    label: 'TV',
    noun: 'series',
    plural: 'series',
    addLabel: 'Add series',
    queueInclude: 'includeSeries=true&includeEpisode=true',
    calInclude: 'includeSeries=true',
  },
  radarr: {
    v: 'v3',
    item: 'movie',
    lookup: 'movie/lookup',
    label: 'Movies',
    noun: 'movie',
    plural: 'movies',
    addLabel: 'Add movie',
    queueInclude: 'includeMovie=true',
    calInclude: '',
  },
  lidarr: {
    v: 'v1',
    item: 'artist',
    lookup: 'artist/lookup',
    label: 'Music',
    noun: 'artist',
    plural: 'artists',
    addLabel: 'Add artist',
    queueInclude: 'includeArtist=true&includeAlbum=true',
    calInclude: 'includeArtist=true',
  },
};

const API_VERSION = { sonarr: 'v3', radarr: 'v3', lidarr: 'v1', prowlarr: 'v1' };

export const isLibrary = (s) => s.type in ARR;
export const byType = (services, ...types) => services.filter((s) => types.includes(s.type));

export const arrGet = (s, path) => call(s.id, `api/${API_VERSION[s.type]}/${path}`);
export const arrSend = (s, method, path, body) => call(s.id, `api/${API_VERSION[s.type]}/${path}`, { method, body });

export const webBase = (s) => (s.webUrl || s.url).replace(/\/+$/, '');

export function itemLink(s, raw) {
  const base = webBase(s);
  if (s.type === 'sonarr' && raw.titleSlug) return `${base}/series/${raw.titleSlug}`;
  if (s.type === 'radarr' && raw.tmdbId) return `${base}/movie/${raw.tmdbId}`;
  if (s.type === 'lidarr' && raw.foreignArtistId) return `${base}/artist/${raw.foreignArtistId}`;
  return base;
}

// ---------- images ----------

function stripBase(s, path) {
  const base = new URL(s.url).pathname.replace(/\/+$/, '');
  return base && path.startsWith(base + '/') ? path.slice(base.length) : path;
}

const smallRemote = (url) => url.replace('image.tmdb.org/t/p/original/', 'image.tmdb.org/t/p/w342/');

/** Ordered list of URLs to try for a poster: small local copy, remote, full local copy. */
export function posterSources(s, images, prefer = ['poster', 'cover']) {
  const list = images || [];
  const img = prefer.map((t) => list.find((i) => i.coverType === t)).find(Boolean);
  if (!img) return [];
  const out = [];
  let local = null;
  if (img.url && !/^https?:/i.test(img.url)) {
    local = stripBase(s, img.url);
    const resized = local.replace(/\/(poster|cover)(\.\w+)/, '/$1-250$2');
    if (resized !== local) out.push(proxyUrl(s.id, resized));
  }
  if (img.remoteUrl) out.push(smallRemote(img.remoteUrl));
  if (img.url && /^https?:/i.test(img.url)) out.push(smallRemote(img.url));
  if (local) out.push(proxyUrl(s.id, local));
  return [...new Set(out)];
}

// ---------- library ----------

const STATUS_LABEL = { continuing: 'Continuing', ended: 'Ended', upcoming: 'Upcoming', deleted: 'Removed upstream' };

export function normalizeItem(s, r) {
  if (s.type === 'sonarr') {
    const st = r.statistics || {};
    const have = st.episodeFileCount || 0;
    const total = st.episodeCount || 0;
    return {
      id: r.id,
      title: r.title,
      sortTitle: r.sortTitle || r.title,
      year: r.year,
      poster: posterSources(s, r.images),
      monitored: r.monitored,
      missing: Boolean(r.monitored && total > have),
      sub: total ? `${have}/${total} episodes` : STATUS_LABEL[r.status] || '',
      meta: [r.year, r.network].filter(Boolean).join(', '),
      status: STATUS_LABEL[r.status] || r.status,
      size: st.sizeOnDisk || 0,
      have,
      total,
      overview: r.overview,
      added: r.added,
      raw: r,
    };
  }
  if (s.type === 'radarr') {
    const notReleased = r.isAvailable === false;
    return {
      id: r.id,
      title: r.title,
      sortTitle: r.sortTitle || r.title,
      year: r.year,
      poster: posterSources(s, r.images),
      monitored: r.monitored,
      missing: Boolean(r.monitored && !r.hasFile && !notReleased),
      sub: r.hasFile ? String(r.year || 'Downloaded') : notReleased ? 'Not released' : 'Missing',
      meta: [r.year, r.studio].filter(Boolean).join(', '),
      status: r.hasFile ? 'Downloaded' : notReleased ? 'Not released yet' : 'Missing',
      size: r.sizeOnDisk || 0,
      hasFile: r.hasFile,
      overview: r.overview,
      added: r.added,
      raw: r,
    };
  }
  // lidarr
  const st = r.statistics || {};
  const have = st.trackFileCount || 0;
  const total = st.trackCount || 0;
  return {
    id: r.id,
    title: r.artistName,
    sortTitle: r.sortName || r.artistName,
    year: null,
    poster: posterSources(s, r.images),
    monitored: r.monitored,
    missing: Boolean(r.monitored && total > have),
    sub: total ? `${have}/${total} tracks` : fmt.count(st.albumCount || 0, 'album'),
    meta: [r.artistType, r.disambiguation].filter(Boolean).join(', '),
    status: STATUS_LABEL[r.status] || r.status,
    size: st.sizeOnDisk || 0,
    have,
    total,
    overview: r.overview,
    added: r.added,
    raw: r,
  };
}

export async function library(s) {
  const list = await arrGet(s, ARR[s.type].item);
  return list
    .map((r) => normalizeItem(s, r))
    .sort((a, b) => a.sortTitle.localeCompare(b.sortTitle, 'en', { sensitivity: 'base' }));
}

export async function lookup(s, term) {
  const list = await arrGet(s, `${ARR[s.type].lookup}?term=${encodeURIComponent(term)}`);
  return list.slice(0, 30).map((r) => ({
    title: r.title || r.artistName,
    year: r.year,
    meta: [r.year, r.network || r.studio || r.artistType].filter(Boolean).join(', '),
    overview: r.overview,
    poster: posterSources(s, r.images),
    inLibrary: Boolean(r.id),
    raw: r,
  }));
}

export async function addOptions(s) {
  const [profiles, folders, metadataProfiles, languageProfiles] = await Promise.all([
    arrGet(s, 'qualityprofile'),
    arrGet(s, 'rootfolder'),
    s.type === 'lidarr' ? arrGet(s, 'metadataprofile') : null,
    s.type === 'sonarr' ? arrGet(s, 'languageprofile').catch(() => null) : null, // Sonarr v3 only
  ]);
  return {
    profiles,
    folders,
    metadataProfiles,
    languageProfiles: Array.isArray(languageProfiles) && languageProfiles.length ? languageProfiles : null,
  };
}

export function addItem(s, raw, o) {
  const body = { ...raw, qualityProfileId: o.qualityProfileId, rootFolderPath: o.rootFolderPath, monitored: true };
  if (s.type === 'sonarr') {
    body.seasonFolder = true;
    body.addOptions = { monitor: o.monitor, searchForMissingEpisodes: o.search, searchForCutoffUnmetEpisodes: false };
    if (o.languageProfileId) body.languageProfileId = o.languageProfileId;
  } else if (s.type === 'radarr') {
    body.minimumAvailability = o.minimumAvailability;
    body.addOptions = { searchForMovie: o.search, monitor: 'movieOnly' };
  } else {
    body.metadataProfileId = o.metadataProfileId;
    body.addOptions = { monitor: o.monitor, searchForMissingAlbums: o.search };
  }
  return arrSend(s, 'POST', ARR[s.type].item, body);
}

export function searchCommand(s, raw, seasonNumber) {
  if (s.type === 'sonarr') {
    return seasonNumber != null
      ? { name: 'SeasonSearch', seriesId: raw.id, seasonNumber }
      : { name: 'SeriesSearch', seriesId: raw.id };
  }
  if (s.type === 'radarr') return { name: 'MoviesSearch', movieIds: [raw.id] };
  return { name: 'ArtistSearch', artistId: raw.id };
}

export const runCommand = (s, body) => arrSend(s, 'POST', 'command', body);

export const getItem = (s, id) => arrGet(s, `${ARR[s.type].item}/${id}`);

export async function setMonitored(s, id, monitored) {
  const fresh = await getItem(s, id);
  fresh.monitored = monitored;
  return arrSend(s, 'PUT', `${ARR[s.type].item}/${id}`, fresh);
}

export async function setSeasonMonitored(s, id, seasonNumber, monitored) {
  const fresh = await getItem(s, id);
  const season = fresh.seasons?.find((x) => x.seasonNumber === seasonNumber);
  if (season) season.monitored = monitored;
  return arrSend(s, 'PUT', `series/${id}`, fresh);
}

export const removeItem = (s, id, deleteFiles) =>
  call(s.id, `api/${API_VERSION[s.type]}/${ARR[s.type].item}/${id}?deleteFiles=${deleteFiles}`, { method: 'DELETE' });

// ---------- calendar ----------

function startOfToday() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

function episodeCode(eps) {
  const pad = (n) => String(n).padStart(2, '0');
  if (eps.length === 1) return `S${pad(eps[0].seasonNumber)}E${pad(eps[0].episodeNumber)}`;
  const seasons = new Set(eps.map((e) => e.seasonNumber));
  if (seasons.size === 1) {
    const nums = eps.map((e) => e.episodeNumber).sort((a, b) => a - b);
    return `S${pad(eps[0].seasonNumber)}E${pad(nums[0])}–E${pad(nums[nums.length - 1])}`;
  }
  return `${eps.length} episodes`;
}

const RADARR_DATES = [
  ['inCinemas', 'In cinemas'],
  ['digitalRelease', 'Digital release'],
  ['physicalRelease', 'Disc release'],
];

function normalizeCalendar(s, data, start, end) {
  const inWindow = (d) => d >= start && d < end;
  if (s.type === 'sonarr') {
    const groups = new Map();
    for (const ep of data) {
      if (!ep.airDateUtc || !ep.series) continue;
      const date = new Date(ep.airDateUtc);
      const key = `${ep.seriesId}:${date.toDateString()}`;
      if (!groups.has(key)) groups.set(key, { date, series: ep.series, eps: [] });
      groups.get(key).eps.push(ep);
    }
    return [...groups.values()].map((g) => ({
      key: `${s.id}:${g.series.id}:${g.date.toDateString()}`,
      date: g.date,
      title: g.series.title,
      sub: episodeCode(g.eps),
      sub2: fmt.time(g.date),
      poster: posterSources(s, g.series.images),
      done: g.eps.every((e) => e.hasFile),
      svc: s,
      itemId: g.series.id,
    }));
  }
  if (s.type === 'radarr') {
    return data
      .map((m) => {
        const hit = RADARR_DATES.map(([field, label]) => ({ date: m[field] ? new Date(m[field]) : null, label }))
          .filter((x) => x.date && inWindow(x.date))
          .sort((a, b) => a.date - b.date)[0];
        if (!hit) return null;
        return {
          key: `${s.id}:${m.id}`,
          date: hit.date,
          title: m.title,
          sub: hit.label,
          sub2: m.year ? String(m.year) : '',
          poster: posterSources(s, m.images),
          done: m.hasFile,
          svc: s,
          itemId: m.id,
        };
      })
      .filter(Boolean);
  }
  return data
    .filter((a) => a.releaseDate)
    .map((a) => ({
      key: `${s.id}:${a.id}`,
      date: new Date(a.releaseDate),
      title: a.title,
      sub: a.artist?.artistName || '',
      sub2: a.albumType || '',
      poster: posterSources(s, a.images, ['cover', 'poster']).concat(posterSources(s, a.artist?.images)),
      done: (a.statistics?.trackFileCount || 0) > 0 && a.statistics?.trackFileCount === a.statistics?.trackCount,
      svc: s,
      itemId: a.artistId,
    }));
}

export async function upcoming(services, days = 7) {
  const start = startOfToday();
  const end = new Date(start.getTime() + days * 86400000);
  const qs = `start=${start.toISOString()}&end=${end.toISOString()}&unmonitored=false`;
  const results = await Promise.allSettled(
    services.filter(isLibrary).map(async (s) => {
      const extra = ARR[s.type].calInclude;
      const data = await arrGet(s, `calendar?${qs}${extra ? `&${extra}` : ''}`);
      return normalizeCalendar(s, data, start, end);
    }),
  );
  const items = results.filter((r) => r.status === 'fulfilled').flatMap((r) => r.value);
  const errors = results.filter((r) => r.status === 'rejected').map((r) => r.reason);
  items.sort((a, b) => a.date - b.date);
  return { items, errors };
}

// ---------- queue ----------

function queueState(r) {
  const state = r.trackedDownloadState;
  if (r.trackedDownloadStatus === 'error' || r.status === 'failed' || state === 'failed' || state === 'failedPending') return ['bad', 'Failed'];
  if (state === 'importBlocked') return ['warn', 'Import blocked'];
  if (state === 'importPending') return ['warn', 'Waiting to import'];
  if (r.trackedDownloadStatus === 'warning' || r.status === 'warning') return ['warn', 'Needs attention'];
  if (state === 'importing') return ['ok', 'Importing'];
  if (r.status === 'completed') return ['ok', 'Downloaded'];
  if (r.status === 'paused') return ['paused', 'Paused'];
  if (r.status === 'delay') return ['queued', 'Delayed'];
  if (r.status === 'queued') return ['queued', 'Queued'];
  return ['active', 'Downloading'];
}

function queueTitle(s, r) {
  const pad = (n) => String(n).padStart(2, '0');
  if (s.type === 'sonarr' && r.series) {
    const ep = r.episode;
    return { title: r.series.title, sub: ep ? `S${pad(ep.seasonNumber)}E${pad(ep.episodeNumber)}${ep.title ? `: ${ep.title}` : ''}` : r.title };
  }
  if (s.type === 'radarr' && r.movie) return { title: r.movie.title, sub: r.movie.year ? String(r.movie.year) : r.title };
  if (s.type === 'lidarr' && r.artist) return { title: r.artist.artistName, sub: r.album?.title || r.title };
  return { title: r.title, sub: '' };
}

export async function arrQueues(services) {
  const results = await Promise.allSettled(
    services.filter(isLibrary).map(async (s) => {
      const data = await arrGet(s, `queue?page=1&pageSize=200&${ARR[s.type].queueInclude}`);
      return (data.records || []).map((r) => {
        const [state, stateLabel] = queueState(r);
        const { title, sub } = queueTitle(s, r);
        const size = r.size || 0;
        const left = r.sizeleft || 0;
        const etaSeconds = fmt.timeleft(r.timeleft) ?? (r.estimatedCompletionTime ? (new Date(r.estimatedCompletionTime) - Date.now()) / 1000 : null);
        return {
          key: `${s.id}:${r.id}`,
          svc: s,
          queueId: r.id,
          title,
          sub,
          state,
          stateLabel,
          progress: size ? 1 - left / size : 0,
          size,
          eta: etaSeconds,
          release: r.title,
          client: r.downloadClient,
          protocol: r.protocol,
          indexer: r.indexer,
          quality: r.quality?.quality?.name,
          downloadId: (r.downloadId || '').toLowerCase(),
          messages: [r.errorMessage, ...(r.statusMessages || []).flatMap((m) => m.messages || [])].filter(Boolean),
        };
      });
    }),
  );
  return {
    items: results.filter((r) => r.status === 'fulfilled').flatMap((r) => r.value),
    errors: results.filter((r) => r.status === 'rejected').map((r) => r.reason),
  };
}

export const removeFromQueue = (s, queueId, blocklist) =>
  call(s.id, `api/${API_VERSION[s.type]}/queue/${queueId}?removeFromClient=true&blocklist=${blocklist}`, { method: 'DELETE' });

// ---------- health ----------

export async function healthIssues(services) {
  const tasks = services.map(async (s) => {
    if (API_VERSION[s.type]) {
      const list = await arrGet(s, 'health');
      return list
        .filter((i) => i.type === 'warning' || i.type === 'error')
        .map((i) => ({ svc: s, level: i.type === 'error' ? 'bad' : 'warn', message: i.message, url: i.wikiUrl }));
    }
    if (s.type === 'bazarr') {
      const res = await call(s.id, 'api/system/health');
      return (res?.data || []).map((i) => ({ svc: s, level: 'warn', message: `${i.object}: ${i.issue}` }));
    }
    return [];
  });
  const results = await Promise.allSettled(tasks);
  return results.filter((r) => r.status === 'fulfilled').flatMap((r) => r.value);
}

// ---------- qBittorrent ----------

const QBIT_STATES = {
  downloading: ['downloading', 'Downloading'],
  forcedDL: ['downloading', 'Downloading (forced)'],
  metaDL: ['downloading', 'Fetching metadata'],
  forcedMetaDL: ['downloading', 'Fetching metadata'],
  stalledDL: ['downloading', 'Stalled'],
  queuedDL: ['queued', 'Queued'],
  allocating: ['downloading', 'Allocating'],
  checkingDL: ['checking', 'Checking'],
  uploading: ['seeding', 'Seeding'],
  forcedUP: ['seeding', 'Seeding (forced)'],
  stalledUP: ['seeding', 'Seeding'],
  queuedUP: ['seeding', 'Queued to seed'],
  checkingUP: ['checking', 'Checking'],
  checkingResumeData: ['checking', 'Checking'],
  pausedDL: ['stopped', 'Paused'],
  pausedUP: ['stopped', 'Completed'],
  stoppedDL: ['stopped', 'Stopped'],
  stoppedUP: ['stopped', 'Completed'],
  moving: ['checking', 'Moving'],
  error: ['error', 'Error'],
  missingFiles: ['error', 'Files missing'],
};

export const torrentState = (t) => {
  const [group, label] = QBIT_STATES[t.state] || ['other', t.state];
  return { group, label };
};

async function qbitPost(s, action, form) {
  return call(s.id, `api/v2/torrents/${action}`, { method: 'POST', form });
}

export const qbit = {
  torrents: (s) => call(s.id, 'api/v2/torrents/info?sort=added_on&reverse=true'),
  transfer: (s) => call(s.id, 'api/v2/transfer/info'),
  // qBittorrent 5 renamed pause/resume to stop/start; fall back for 4.x.
  async pause(s, hashes) {
    try {
      await qbitPost(s, 'stop', { hashes });
    } catch (err) {
      if (err.status === 404) await qbitPost(s, 'pause', { hashes });
      else throw err;
    }
  },
  async resume(s, hashes) {
    try {
      await qbitPost(s, 'start', { hashes });
    } catch (err) {
      if (err.status === 404) await qbitPost(s, 'resume', { hashes });
      else throw err;
    }
  },
  remove: (s, hashes, deleteFiles) => qbitPost(s, 'delete', { hashes, deleteFiles: String(deleteFiles) }),
};

// ---------- SABnzbd ----------

export const sab = {
  queue: (s) => call(s.id, 'api?mode=queue&output=json'),
  cmd: (s, params) => call(s.id, `api?${new URLSearchParams({ ...params, output: 'json' })}`),
  pauseAll: (s) => sab.cmd(s, { mode: 'pause' }),
  resumeAll: (s) => sab.cmd(s, { mode: 'resume' }),
  pauseItem: (s, id) => sab.cmd(s, { mode: 'queue', name: 'pause', value: id }),
  resumeItem: (s, id) => sab.cmd(s, { mode: 'queue', name: 'resume', value: id }),
  removeItem: (s, id) => sab.cmd(s, { mode: 'queue', name: 'delete', value: id }),
};

// ---------- Jellyfin ----------

export const jellyfin = {
  info: (s) => call(s.id, 'System/Info'),
  counts: (s) => call(s.id, 'Items/Counts'),
  sessions: (s) => call(s.id, 'Sessions?activeWithinSeconds=960'),
  scan: (s) => call(s.id, 'Library/Refresh', { method: 'POST' }),
  image: (s, itemId, height = 240) => proxyUrl(s.id, `Items/${itemId}/Images/Primary?fillHeight=${height}&quality=85`),
};

// ---------- Prowlarr ----------

export const prowlarr = {
  indexers: (s) => call(s.id, 'api/v1/indexer'),
  status: (s) => call(s.id, 'api/v1/indexerstatus'),
  testAll: (s) => call(s.id, 'api/v1/indexer/testall', { method: 'POST' }),
};

// ---------- Unraid (GraphQL API, Unraid 7.2+) ----------

async function gql(s, query, variables, { timeout } = {}) {
  const res = await call(s.id, 'graphql', { method: 'POST', body: { query, variables }, timeout });
  if (res?.errors?.length) {
    const err = new Error(res.errors[0].message);
    err.partial = res.data;
    throw err;
  }
  return res.data;
}

const ok = (p) => p.then((v) => v, () => null);

// Runs the first query the server understands. Older Unraid releases lack some fields.
async function gqlFirst(s, queries, variables) {
  for (let i = 0; i < queries.length; i += 1) {
    try {
      return await gql(s, queries[i], variables);
    } catch (err) {
      if (i === queries.length - 1 || !/Cannot query field|Unknown argument|Unknown type/i.test(err.message)) throw err;
    }
  }
  return null;
}

const DISK_FIELDS = 'id idx name device size status temp numErrors fsSize fsUsed fsFree fsType type isSpinning rotational warning critical';
const CONTAINER_BASE = 'id names image state status autoStart';

export const DOCKER_ACTIONS = ['start', 'stop', 'restart', 'pause', 'unpause', 'updateContainer'];
const UPDATE_TIMEOUT = 10 * 60 * 1000;
const CHECK_TIMEOUT = 5 * 60 * 1000;

// Unraid's web server gives up on long requests (HTTP 504) while the work carries on, and
// Deckarr's own proxy can time out the same way. Such an update or check is still running.
const gaveUpWaiting = (err) => [502, 503, 504].includes(err?.status) || /took too long|closed the connection/i.test(String(err?.message || ''));

function stillRunning() {
  const err = new Error('Unraid is still working on it.');
  err.stillRunning = true;
  return err;
}

/** Explains a failed update or update check, including Unraid versions that can't do it. */
export function dockerUpdateError(err) {
  const msg = String(err?.message || err || '');
  if (/Cannot query field "updateContainer"|Cannot query field "updateContainers"/i.test(msg)) {
    return 'This Unraid version can check for updates but not apply them through its API (needs Unraid API 4.29 or newer). Update Unraid, or apply the update from the Docker tab in Unraid.';
  }
  if (/Cannot query field "refreshDockerDigests"/i.test(msg)) {
    return 'This Unraid version can’t check for container updates through its API (needs Unraid API 4.21 or newer). Use Check for Updates on the Docker tab in Unraid.';
  }
  if (/forbidden|permission|unauthori[sz]ed/i.test(msg)) {
    return 'The Unraid API key can’t update containers. Give it update access to Docker (or the Admin role) in Settings > Management Access > API Keys.';
  }
  if (/took too long/i.test(msg)) return 'Unraid is still working on it. Check the container again in a minute.';
  return msg;
}

export const VM_ACTIONS = ['start', 'stop', 'pause', 'resume', 'reboot', 'forceStop', 'reset'];

/** Turns a failed VM query into something a person can act on. */
export function vmErrorMessage(err) {
  const msg = String(err?.message || err || '');
  if (/forbidden|permission|not authori[sz]ed|unauthori[sz]ed|access denied/i.test(msg)) {
    return 'The Unraid API key can’t manage VMs. In Unraid, go to Settings > Management Access > API Keys and give the key read and update access to VMs (or the Admin role).';
  }
  if (/libvirt|hypervisor|not (running|enabled|started|available)|disabled|unavailable|connect/i.test(msg)) {
    return 'The VM service isn’t running. Turn it on in Unraid under Settings > VM Manager.';
  }
  if (/Cannot query field/i.test(msg)) return 'This Unraid version doesn’t offer VM control in its API. Update to Unraid 7.2 or newer.';
  return msg;
}

export const unraid = {
  async overview(s) {
    const [array, info, metrics, parity, extra, power, notes, ups] = await Promise.all([
      gql(s, '{ array { state capacity { kilobytes { free used total } } } }'),
      ok(gql(s, '{ info { os { hostname uptime } } }')),
      ok(gqlFirst(s, [
        '{ metrics { cpu { percentTotal } memory { total used available percentTotal swapTotal swapUsed } } }',
        '{ metrics { cpu { percentTotal } memory { total used available percentTotal } } }',
      ])),
      ok(gql(s, '{ array { parityCheckStatus { status progress running paused correcting errors } } }')),
      ok(gql(s, '{ metrics { network { name rxSec txSec } temperature { summary { hottest { name current { value } } } sensors { name type current { value } } } } }')),
      ok(gql(s, '{ info { cpu { packages { totalPower temp } } } }')),
      ok(gql(s, '{ notifications { overview { unread { info warning alert total } } } }')),
      ok(gql(s, '{ upsDevices { id name model status battery { chargeLevel estimatedRuntime } power { loadPercentage currentPower } } }')),
    ]);
    return {
      array: array?.array,
      hostname: info?.info?.os?.hostname,
      uptime: info?.info?.os?.uptime,
      cpu: metrics?.metrics?.cpu,
      memory: metrics?.metrics?.memory,
      parity: parity?.array?.parityCheckStatus,
      network: extra?.metrics?.network || [],
      temperature: extra?.metrics?.temperature || null,
      packages: power?.info?.cpu?.packages || null,
      unread: notes?.notifications?.overview?.unread || null,
      ups: ups?.upsDevices || [],
    };
  },

  // ----- Docker -----
  async containers(s) {
    const d = await gqlFirst(s, [
      `{ docker { containers { ${CONTAINER_BASE} webUiUrl iconUrl isUpdateAvailable ports { privatePort publicPort type } } } }`,
      `{ docker { containers { ${CONTAINER_BASE} webUiUrl iconUrl ports { privatePort publicPort type } } } }`,
      `{ docker { containers { ${CONTAINER_BASE} webUiUrl iconUrl } } }`,
      `{ docker { containers { ${CONTAINER_BASE} } } }`,
    ]);
    return d.docker?.containers || [];
  },
  dockerAction(s, action, id) {
    if (!DOCKER_ACTIONS.includes(action)) throw new Error('Unknown action');
    if (action === 'updateContainer') return unraid.updateContainer(s, id);
    return gql(s, `mutation ($id: PrefixedID!) { docker { ${action}(id: $id) { id state status } } }`, { id });
  },
  // Pulling a new image can take minutes.
  async updateContainer(s, id) {
    try {
      return await gql(s, 'mutation ($id: PrefixedID!) { docker { updateContainer(id: $id) { id state status } } }', { id }, { timeout: UPDATE_TIMEOUT });
    } catch (err) {
      if (gaveUpWaiting(err)) throw stillRunning();
      throw new Error(dockerUpdateError(err));
    }
  },
  // Asks Unraid to look up the newest image digests, then the containers list shows what's outdated.
  async checkUpdates(s) {
    try {
      return await gql(s, 'mutation { refreshDockerDigests }', undefined, { timeout: CHECK_TIMEOUT });
    } catch (err) {
      if (gaveUpWaiting(err)) throw stillRunning();
      throw new Error(dockerUpdateError(err));
    }
  },
  async containerLogs(s, id, tail = 200) {
    const d = await gql(s, 'query ($id: PrefixedID!, $tail: Int) { docker { logs(id: $id, tail: $tail) { lines { timestamp message } } } }', { id, tail });
    return d.docker?.logs?.lines || [];
  },

  // ----- VMs -----
  async vms(s) {
    const d = await gql(s, '{ vms { domains { id name state } } }');
    return (d.vms?.domains || []).filter((vm) => vm?.id);
  },
  vmAction(s, action, id) {
    if (!VM_ACTIONS.includes(action)) throw new Error('Unknown action');
    return gql(s, `mutation ($id: PrefixedID!) { vm { ${action}(id: $id) } }`, { id });
  },

  // ----- storage -----
  async disks(s) {
    const d = await gqlFirst(s, [
      `{ array { parities { ${DISK_FIELDS} } disks { ${DISK_FIELDS} } caches { ${DISK_FIELDS} } } }`,
      '{ array { parities { id name device size status temp numErrors type } disks { id name device size status temp numErrors fsSize fsUsed fsFree type } caches { id name device size status temp numErrors fsSize fsUsed fsFree type } } }',
    ]);
    return d.array;
  },
  async shares(s) {
    const d = await gqlFirst(s, ['{ shares { id name comment free used size cache } }', '{ shares { id name free used size } }']);
    return d.shares || [];
  },

  // ----- parity -----
  async parity(s) {
    const [status, history] = await Promise.all([
      gql(s, '{ array { parityCheckStatus { status progress running paused correcting errors speed duration date } } }'),
      ok(gql(s, '{ parityHistory { date duration speed status errors } }')),
    ]);
    return { status: status.array?.parityCheckStatus, history: history?.parityHistory || null };
  },
  parityAction(s, action, correct = false) {
    if (action === 'start') return gql(s, 'mutation ($correct: Boolean!) { parityCheck { start(correct: $correct) } }', { correct });
    if (!['pause', 'resume', 'cancel'].includes(action)) throw new Error('Unknown action');
    return gql(s, `mutation { parityCheck { ${action} } }`);
  },

  // ----- notifications -----
  async notifications(s, type = 'UNREAD', limit = 100) {
    const d = await gql(
      s,
      'query ($filter: NotificationFilter!) { notifications { overview { unread { total } archive { total } } list(filter: $filter) { id title subject description importance link type timestamp } } }',
      { filter: { type, offset: 0, limit } },
    );
    return d.notifications;
  },
  archiveNotification: (s, id) => gql(s, 'mutation ($id: PrefixedID!) { archiveNotification(id: $id) { id } }', { id }),
  unreadNotification: (s, id) => gql(s, 'mutation ($id: PrefixedID!) { unreadNotification(id: $id) { id } }', { id }),
  deleteNotification: (s, id, type) => gql(s, 'mutation ($id: PrefixedID!, $type: NotificationType!) { deleteNotification(id: $id, type: $type) { unread { total } } }', { id, type }),
  archiveAll: (s) => gql(s, 'mutation { archiveAll { unread { total } } }'),
  deleteArchived: (s) => gql(s, 'mutation { deleteArchivedNotifications { archive { total } } }'),

  // ----- logs -----
  async logFiles(s) {
    const d = await gql(s, '{ logFiles { name path size modifiedAt } }');
    return d.logFiles || [];
  },
  async logFile(s, path, lines = 300) {
    const d = await gql(s, 'query ($path: String!, $lines: Int) { logFile(path: $path, lines: $lines) { content totalLines } }', { path, lines });
    return d.logFile;
  },
};

// ---------- Proxmox VE (REST API, API token) ----------

const pveGet = (s, path) => call(s.id, `api2/json/${path}`).then((r) => r?.data);
const pvePost = (s, path, form = {}) => call(s.id, `api2/json/${path}`, { method: 'POST', form }).then((r) => r?.data);
const enc = encodeURIComponent;

export const PVE_ACTIONS = {
  qemu: ['start', 'shutdown', 'reboot', 'suspend', 'resume', 'stop', 'reset'],
  lxc: ['start', 'shutdown', 'reboot', 'resume', 'stop'],
};

export const proxmox = {
  nodes: (s) => pveGet(s, 'nodes'),
  nodeStatus: (s, node) => pveGet(s, `nodes/${enc(node)}/status`),
  // VMs and LXC containers on every node, without templates.
  async guests(s) {
    const list = (await pveGet(s, 'cluster/resources?type=vm')) || [];
    return list.filter((g) => !g.template && (g.type === 'qemu' || g.type === 'lxc'));
  },
  guestAction(s, g, action) {
    if (!PVE_ACTIONS[g.type]?.includes(action)) throw new Error('Unknown action');
    return pvePost(s, `nodes/${enc(g.node)}/${g.type}/${g.vmid}/status/${action}`);
  },
  storage: (s, node) => pveGet(s, `nodes/${enc(node)}/storage`),
  disks: (s, node) => pveGet(s, `nodes/${enc(node)}/disks/list`),
  // Needs Sys.Modify on the node: a 403 means the token can't see package updates.
  updates: (s, node) => pveGet(s, `nodes/${enc(node)}/apt/update`),
  refreshUpdates: (s, node) => pvePost(s, `nodes/${enc(node)}/apt/update`),
  tasks: (s, node, limit = 50) => pveGet(s, `nodes/${enc(node)}/tasks?limit=${limit}`),
  taskLog: (s, node, upid, limit = 500) => pveGet(s, `nodes/${enc(node)}/tasks/${enc(upid)}/log?limit=${limit}`),
  syslog: (s, node, limit = 500) => pveGet(s, `nodes/${enc(node)}/syslog?limit=${limit}`),
};
proxmox.guestStatus = (s, g) => pveGet(s, `nodes/${enc(g.node)}/${g.type}/${g.vmid}/status/current`);
