# Changelog

Releases are published automatically: bump `version` in `package.json`, add a section for it here, and merge into `main`.

## Unreleased

### Improved
- **Virtual machines.** The VM list is always shown for Unraid and explains why when VMs can't be read (missing API key permission, VM Manager turned off). Each VM opens a sheet with Shut down, Restart, Pause, Resume, Force stop and Hard reset. Stopped VMs have a Start button in the list, and there are buttons to start or shut down several VMs at once.

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
