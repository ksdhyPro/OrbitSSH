# Changelog

## v1.1.1

- Improved the AI follow-up experience by automatically focusing the bottom input box after an AI response finishes.
- Fixed an issue on macOS where pressing Enter while composing or selecting Chinese IME candidates could accidentally send the AI message; Enter now confirms the candidate first.

## v1.1.0

- Added an AI assistant panel with per-terminal-tab conversations, using the current server, terminal path, SFTP path, connection status, and recent terminal output as context.
- Added the AI Agent diagnostic workflow with OpenAI-compatible streaming responses, real-time Markdown rendering, command process cards, and multi-turn follow-up based on command results.
- Added AI permission modes: Ask Every Time, Auto Approval, and Full Access; includes a readonly command whitelist, mandatory approval for high-risk commands, and a 5-minute approval validity window.
- Added an AI settings page for enabling AI, managing multiple model configurations, switching the active model, setting the default mode, and displaying API keys in masked form locally.
- Improved AI failure and unconfigured states: when AI is disabled or model configuration is incomplete, OrbitSSH provides basic local suggestions; network and API errors now return clearer messages.
- Improved terminal and SFTP disconnect/reconnect handling. When SSH disconnects, stale SFTP file lists are cleared and a disconnected state is shown; after terminal reconnect succeeds, the main SFTP session is restored automatically.
- Added terminal reconnect support and fixed stale connection events affecting newly created sessions, reducing state confusion after reconnects.
- Improved core file interactions by unifying selection, select-all, range selection, and marquee selection behavior between the main SFTP panel and file transfer dialog.
- Strengthened parameter validation and session ownership checks for terminal, SFTP, and system status operations, reducing invalid input and cross-window call errors.
- Improved log security by automatically redacting sensitive fields such as password, API Key, token, secret, and private key.
- Added AI Agent execution documentation covering the conversation flow, command policy, approval process, and safety boundaries.

## v1.0.2

- Improved file selection interactions in the SFTP panel and file transfer dialog with Windows-like marquee selection, click-blank-area deselection, and drag-to-`..` moves into the parent directory.
- Fixed incorrect right-click menu and floating menu placement near window edges, preventing menus from overflowing or appearing in the wrong position.
- The file transfer dialog now allows both sides to use the same connection; transfers within the same connection are handled as copies and leave the source files unchanged.
- Improved the file transfer experience so creating a transfer task no longer automatically closes the file transfer dialog.
- The target-side file list now refreshes automatically after a file transfer task completes.
- Added drag-and-drop move operations in the SFTP panel and file transfer dialog, supporting single or multi-selected files and folders moved into another folder in the same directory with a confirmation prompt before moving.
- Extracted a shared remote file list component so the SFTP panel and file transfer dialog reuse the same file row rendering, rename behavior, and drag-and-drop interactions.
- Removed the SFTP tree view mode and its related setting, leaving only the current-directory file list view.
- Transfer tasks now automatically open the task list, and the task list layer has been raised so it appears above other floating panels.
- Renamed "Data Transfer" entries and prompts to "File Transfer" for consistency.

## v1.0.1

- Added an SSH/SFTP keepalive interval setting. The default is 10 seconds, it can be changed in Settings, and it can be set to 0 to disable keepalive.
- Added an idle disconnect setting. The default is 5 minutes; terminal and main SFTP sessions are automatically disconnected after a long period without activity, and it can be set to 0 to disable automatic disconnect.
- Improved SFTP connection stability. Main SFTP sessions, uploads, downloads, and remote transfers now all apply the keepalive configuration.
- Added the `dist-mac` script for building macOS packages.
- Improved the macOS window experience with left-side red/yellow/green window controls and integration with the native macOS menu bar.
- Added Settings, About, File Transfer, Edit, and fullscreen actions to the native macOS menu.
- Improved undo and redo behavior in the file editor so the native macOS Edit menu can act on the current editor.
- Improved the SFTP upload experience by supporting right-click upload of files or folders from blank areas in the file list to the current directory.
- Added an SFTP transfer queue. By default, at most 1 upload, download, or remote transfer task runs at the same time.
- Added an About dialog showing the current version and the project Gitee URL.
- Improved the app icon generation flow by generating unified rounded icons for Windows, macOS, and the app header.
- Temporarily hid the Check for Updates entry on macOS to avoid triggering an invalid update flow before signing is fully configured.

## v1.0.0

- Initial release.
