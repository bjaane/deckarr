# Changelog

Releases are published automatically: bump `version` in `package.json`, add a section for it here, run `node scripts/sync-template.mjs`, and merge into `main`.

## 1.5.1

### New
- **Push notifications for Proxmox VE.** Server alerts now cover Proxmox too: failed tasks such as backups or VM starts, nodes going offline and coming back, storage over 90% full, and disks failing their SMART check. Nothing to set up in Proxmox, since Deckarr uses the same API token. Tapping a notification opens the matching list (tasks, storage or disks), and with several servers each notification starts with the server's name.

## 1.5.0

### New
- **Several servers side by side.** With more than one Unraid or Proxmox server, the Server tab has a row of server buttons and shows one server at a time, titled with its name. Deckarr remembers your choice, and a push notification opens the right server.
- **Install on Proxmox with one command.** scripts/proxmox-install.sh creates a small Debian LXC container with Deckarr on a Proxmox host, no Docker needed, and deckarr-update updates it later.
- **Proxmox VE support.** Add Proxmox under Settings with an API token. The Server tab shows each node (CPU, memory, load, root disk, uptime) and all VMs and LXC containers with Start, Shut down, Restart, Pause, Resume, Stop and Reset. Manage has storage, disk health (SMART), package updates, recent tasks with their logs, and the system log. Proxmox VE 7 or newer.
- **Push notifications for Unraid alerts.** Turn them on per device in Settings > Notifications and choose Alerts, Warnings or Everything. The Deckarr server checks Unraid every minute and sends new notifications straight to your phone's push service, even when Deckarr is closed. Tapping one opens Unraid's notification list. Works on iPhone and iPad (iOS 16.4+, added to the Home Screen), Android and desktop browsers. Needs Deckarr to be opened over https://, for example through Tailscale Serve.

## 1.4.1

### Fixed
- **Container updates no longer report "Request failed (HTTP 504)".** Pulling a new image can take more than a minute, and Unraid's web server stops waiting while the update keeps running. Deckarr now treats this as "still updating", keeps checking until the container runs the new image (up to 10 minutes), and then reports it as updated. Check now handles a slow update check the same way.
- The README and the Apps tab use real screenshots of every tab.

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
