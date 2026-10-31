# Changelog

Releases are published automatically: bump `version` in `package.json`, add a section for it here, run `node scripts/sync-template.mjs`, and merge into `main`.

## 1.4.0

### New
- **Works on Android, GrapheneOS and other platforms, not just iPhone.** Settings shows how to add Deckarr to the home screen on your device. Chromium-based browsers (Chrome, Vanadium on GrapheneOS, Samsung Internet, Edge, Brave) get an **Install Deckarr** button.
- **Back button closes panels.** On Android, and with the browser's back gesture, Back closes the open panel instead of leaving the page.

### Improved
- The app is no longer locked to portrait, so tablets and foldables can use landscape.
- On Android, the on-screen keyboard no longer covers text fields in panels.
- On Android over plain `http://`, Settings explains that a full-screen app needs `https://` (for example Tailscale Serve).
- The README, Unraid template and app description now cover iPhone, iPad, Android and other browsers.

## 1.3.0

### New
- **Container updates.** The Containers section shows how many updates are available. **Check now** asks Unraid to look for new images right away, and **Update all** updates them one by one with live progress. Containers with an update get an Update badge, and failures are listed without stopping the rest. Updates may take up to 10 minutes per container. On Unraid versions that can report updates but not apply them through the API, Deckarr says so and links to the Docker tab.

### Improved
- **Virtual machines.** The VM section appears only when Unraid has VMs. Each VM opens a sheet with Shut down, Restart, Pause, Resume, Force stop and Hard reset. Stopped VMs have a Start button in the list, and there are buttons to start or shut down several VMs at once. If the API key can't read VMs, Deckarr says how to fix it.

## 1.2.0

### New
- **Backup address per service.** Deckarr switches to a second address (for example a Tailscale name) when the main one can't be reached.
- **qBittorrent API key.** qBittorrent 5.2 and newer can use an API key instead of a username and password.
- **Unraid on the Server tab:**
  - CPU temperature and power, network traffic, swap and UPS.
  - Notifications: view, archive, mark unread, delete.
  - Disks with temperatures and errors, and shares.
  - Parity check: start, pause, cancel, history.
  - System logs.
  - Containers: filters, details, ports, logs, pause and update, one at a time or all at once.
  - VMs: pause, resume, restart, force stop.

### Note
The Unraid API key needs update access to Docker, VMs, Array and Notifications for the new buttons.

## 1.1.0

- First public release.
