# Changelog

## v1.0.1

- Added an SSH/SFTP keepalive interval setting. The default is 10 seconds, it can be changed in Settings, and it can be set to 0 to disable keepalive.
- Added an idle disconnect setting. The default is 5 minutes; terminal and main SFTP sessions are automatically disconnected after a long period without activity, and it can be set to 0 to disable automatic disconnect.
- Improved SFTP connection stability. Main SFTP sessions, uploads, downloads, and remote transfers now all apply the keepalive configuration.
- Added the `dist-mac` script for building macOS packages.

## v1.0.0

- Initial release.
