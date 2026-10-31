// Every service Deckarr knows how to talk to.
// `auth` decides which credential fields the settings form shows:
//   apikey -> one API key field
//   login  -> username + password (qBittorrent)
// `test` is the cheap request used by "Test connection" and the status lights.

export const SERVICE_TYPES = {
  sonarr: {
    label: 'Sonarr',
    category: 'Library',
    port: 8989,
    auth: 'apikey',
    test: { path: '/api/v3/system/status' },
    help: 'In Sonarr: Settings > General > Security > API Key.',
  },
  radarr: {
    label: 'Radarr',
    category: 'Library',
    port: 7878,
    auth: 'apikey',
    test: { path: '/api/v3/system/status' },
    help: 'In Radarr: Settings > General > Security > API Key.',
  },
  lidarr: {
    label: 'Lidarr',
    category: 'Library',
    port: 8686,
    auth: 'apikey',
    test: { path: '/api/v1/system/status' },
    help: 'In Lidarr: Settings > General > Security > API Key.',
  },
  prowlarr: {
    label: 'Prowlarr',
    category: 'Indexers',
    port: 9696,
    auth: 'apikey',
    test: { path: '/api/v1/system/status' },
    help: 'In Prowlarr: Settings > General > Security > API Key.',
  },
  bazarr: {
    label: 'Bazarr',
    category: 'Subtitles',
    port: 6767,
    auth: 'apikey',
    test: { path: '/api/system/status' },
    help: 'In Bazarr: Settings > General > Security > API Key.',
  },
  qbittorrent: {
    label: 'qBittorrent',
    category: 'Downloads',
    port: 8080,
    auth: 'login',
    apiKeyOption: true,
    test: { path: '/api/v2/app/version' },
    help: 'Your qBittorrent Web UI username and password. Leave both blank if qBittorrent skips login for your network.',
    apiKeyHelp: 'qBittorrent 5.2 or newer: Tools > Options > Web UI > API key.',
  },
  sabnzbd: {
    label: 'SABnzbd',
    category: 'Downloads',
    port: 8080,
    auth: 'apikey',
    test: { path: '/api', query: 'mode=queue&limit=1&output=json' },
    help: 'In SABnzbd: Config > General > Security > API Key (not the NZB key).',
  },
  jellyfin: {
    label: 'Jellyfin',
    category: 'Media server',
    port: 8096,
    auth: 'apikey',
    test: { path: '/System/Info' },
    help: 'In Jellyfin: Dashboard > API Keys > New API key.',
  },
  unraid: {
    label: 'Unraid',
    category: 'Server',
    port: 80,
    auth: 'apikey',
    test: {
      method: 'POST',
      path: '/graphql',
      body: { query: '{ array { state } }' },
    },
    help: 'Unraid 7.2 or newer: Settings > Management Access > API Keys. Give the key the Admin role, or read and update access to Docker, VMs and Array.',
  },
};

export function publicTypes() {
  return Object.fromEntries(
    Object.entries(SERVICE_TYPES).map(([id, t]) => [
      id,
      { label: t.label, category: t.category, port: t.port, auth: t.auth, apiKeyOption: Boolean(t.apiKeyOption), help: t.help, apiKeyHelp: t.apiKeyHelp },
    ]),
  );
}
