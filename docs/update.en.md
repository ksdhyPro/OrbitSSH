# Changelog

## v1.5.1

1. Upgraded the left sidebar layout: Servers, Custom Commands, and Remote Files can be freely reordered, independently collapsed, and restored from local settings; the bottom panel fills remaining space automatically.
2. Improved panel-height behavior: opening a collapsed panel expands it to the available maximum, and panels contract dynamically with window resizing to prevent overflow.
3. Fixed panel-divider dragging: a middle divider now transfers height between its adjacent expanded panels instead of being incorrectly limited by the bottom panel's remaining space.

## v1.5.0

1. Upgraded custom-command execution: after confirming the command preview, OrbitSSH opens a dedicated terminal tab instead of occupying the terminal currently in use.
2. Added sequential execution for multiple non-empty command lines. The terminal shows progress, the original command, and live output, and sends the next command only after the previous one finishes.
3. Closing a terminal tab created for a custom command immediately prevents any remaining commands from being sent.

## v1.4.0

1. Improved the Codex CLI setup flow. When local detection fails, users can manually enter the Codex CLI executable path and continue configuring the model and reasoning effort.
2. Unified terminal and SFTP context-menu styling, extracted a reusable menu component, and added grouped items, separators, and hover-expanded nested menus.
3. Added server-specific automation tasks: save multi-line Shell scripts, review them before execution, run them in an independent SSH session, stream output in real time, and stop a running task without affecting the current terminal session.

## v1.3.0

1. Added SFTP folder downloads. Selected folders are downloaded recursively with their complete directory structure, and users can choose the local destination before downloading. The picker defaults to Desktop on both Windows and macOS.
2. Upgraded AI collaboration across servers. The AI can target saved SSH connections for diagnostics without exposing connection credentials to the model. Commands that modify data, transfer files, or operate Docker are shown in an approval card and run only after user confirmation.
3. Reworked AI Agent execution orchestration by replacing the fixed 10-command limit with a dynamic budget based on elapsed time, repeated commands, and consecutive no-progress steps, allowing complex diagnostics to complete their required steps.
4. Fixed incomplete recognition of Docker read-only queries, so commands such as container-count checks can run normally. The AI is also prevented from using the current terminal to SSH, SCP, or SFTP into another server; cross-server actions always use saved connections.
5. Improved terminal session tabs. When many servers are open, tabs support horizontal mouse-wheel scrolling with a subtle scrollbar and no longer overflow into the AI panel. The close icon is centered correctly.

## v1.2.3

1. Fixed right-side overflow when narrowing the AI panel by unifying grid and child sizing, calculating drag width from the actual content boundary, and adding layout regression coverage.
2. Refined the AI panel header to match the terminal tab-bar height and display the active connection as a right-aligned tag. Disabling AI now removes the entire panel and divider so the terminal reclaims the space.
3. Improved AI conversation interactions with a new assistant icon and copy actions for both user prompts and AI responses.
4. Improved AI Settings and Codex configuration with consistent custom select controls, direct configuration after successful local Codex detection, and refined Settings visuals.
5. Reworked About OrbitSSH as a native system dialog showing the app version, commit metadata, and runtime versions, with one-click copying.

## v1.2.2

1. Improved native-client interactions by disabling arbitrary UI text selection and native image dragging by default, while preserving required text selection in inputs, About, terminals, and the remote file editor.

## v1.2.1

1. Fixed missing top corners on the first row of grouped Settings sections such as General and AI, which occurred because the section heading preceded the first setting item.

## v1.2.0

1. Reworked the light and dark visual system. The light theme now uses warm white and neutral-gray layers, primary actions use a Codex-inspired warm orange, and terminals use an independent themed work surface.
2. Rebuilt Settings as a full-screen preferences view, and standardized dialog spacing, icon sizing, the custom select control, and context-menu styling for more consistent file operations.
3. Upgraded the AI collaboration panel with clearer message hierarchy, command-process cards, execution feedback, and a refined composer. Full Access now consistently uses a warm-orange warning treatment in buttons, menus, and icons.
4. Standardized UI font sizing by removing inconsistent fractional and odd pixel sizes, and improved terminal-canvas and icon refresh behavior during theme switches.

## v1.1.16

1. Added local Codex CLI detection and integration, allowing installed Codex to be added as an AI chat model from Settings.
2. Added Codex model and reasoning-effort configuration. Users can enter any model name or use the local default model, and the AI model menu shows both the selected model and reasoning effort.
3. Improved the Codex request flow with non-interactive CLI turns for diagnosis and command suggestions. Remote commands continue to run through the active OrbitSSH SSH connection with existing approval policies preserved.

## v1.1.15

1. Fixed an error when opening remote text files with Windows CRLF line endings: the initial cursor position used the raw string length and could exceed the CodeMirror document range.

## v1.1.14

1. Fixed internal commands for real-time path synchronization being echoed in SSH terminals, while preserving SFTP sync after directory changes.
2. Improved selected states in the Settings sidebar for both light and dark themes with stronger fills, a left indicator, and clearer text contrast.

## v1.1.13

1. Released a maintenance version.

## v1.1.12

1. Fixed SFTP “Sync to Current Terminal Path” using only the initial SSH directory. Bash, zsh, and fish now report the current path whenever a prompt appears, so the file tree correctly follows directory changes.
2. Added Windows startup diagnostics. Main-process module-load failures, uncaught exceptions, page-load failures, renderer-process exits, and child-process exits are recorded in the user directory to diagnose cases where the app opens with no visible window.

## v1.1.11

1. Added local endpoints to File Transfer. The left side now opens the system user directory by default, while the right side selects the active server and its current SFTP path. Both sides can switch between Local and server endpoints, with local file/folder uploads and remote file downloads to the current local directory.
2. Improved transfer target refresh and endpoint guards. Completed transfers now refresh the actual destination pane, transfers are disabled when both sides are Local, and existing server-to-server transfers remain available.
3. Improved repeated large-file transfers. Uploads and server-to-server transfers larger than 5 MiB now use full SHA-256 fingerprint comparison and skip files only when both source and destination are stable and identical; verification failures safely fall back to normal transfer.
4. Refactored SFTP sessions, uploads, downloads, server-to-server transfers, and the shared transfer queue into focused modules, with additional SFTP and Renderer tests.
5. Fixed file or folder creation and renaming in File Transfer repeatedly selecting the entire name after each typed character, which caused the next character to overwrite the previous one.
6. Fixed `Ctrl+S` not saving in the remote file editor, with `Cmd+S` support on macOS. Newly opened files now place the cursor at the end of the content.

## v1.1.10

1. Added single-instance enforcement so only one OrbitSSH instance can run at a time. Launching the application again now restores, shows, and focuses the existing main window.

## v1.1.9

1. Fixed an issue where the main window could not be reopened after being hidden to the system tray. Clicking the tray icon now restores, shows, and focuses the main window.
2. Fixed an issue that prevented the AI from running the same command again within one turn. Repeated execution is now supported for state checks and change verification, while retaining the 10-command per-turn safety limit.

## v1.1.8

1. Added one-click Markdown copying for AI replies, preserving the original formatted response and showing feedback after a successful copy.
2. Improved AI response diagnostics by logging a truncated raw response structure for empty replies, HTTP errors, invalid tool calls, and response parsing failures.
3. Added one automatic retry for empty or abnormal AI responses; the user is notified only if the retry also fails, while valid tool calls are never executed twice.
4. Aligned the AI reply action hover style with the context-menu hover colors.

## v1.1.7

1. Added server pinning. Frequently used connections can be pinned or unpinned from the server list, with persistent pin state and consistent sorting across the main process, Preload bridge, and UI.
2. Hardened the AI command policy by separating confirmed readonly commands from unknown commands allowed only in Full Access, and by detecting absolute paths, quoted executables, `env`, `command`, `nice`, `nohup`, multiline commands, and compound command risks.
3. Added an AI terminal-context privacy control. Recent terminal output is no longer sent by default; when explicitly enabled, passwords, tokens, Authorization headers, URL credentials, and private keys are redacted before the bounded context is sent to the online model.
4. Fixed AI cancellation and approval lifecycle handling. Regular requests and post-approval commands can both be cancelled, SSH channels are closed on timeout or cancellation, and approvals now expire proactively, are consumed once, and are cleared on new requests or terminal closure.
5. Refactored the AI Agent into focused orchestration, provider, SSE parsing, context, input-validation, and approval-store modules. The per-turn command limit is now 10, with 15 focused tests powered by Node's built-in test runner.
6. Strengthened AI IPC validation with message, history, and command length limits, tab-context and approval ownership checks, `run_shell_command`-only tool handling, and support for SSE responses using `data:` without a following space.
7. Split oversized modules into focused units: Renderer tokens, terminal, dialog, and other styles now live in dedicated files, while remote-file interactions, terminal command execution, and system statistics are isolated in dedicated modules so related code files remain below 1,000 lines.

## v1.1.6

1. Improved the AI auto-execution policy by simplifying modes to "Ask Every Time" and "Full Access". In Full Access, commands are split for risk checks first, then the original AI command is executed once, avoiding duplicated sub-command cards in the conversation.
2. Improved AI command approval UX: pending approvals now appear as a floating card above the input box, disappear after approval or rejection, and are folded into the process details above.
3. Improved AI conversation display by hiding intermediate self-summaries and command execution cards. The conversation now shows user questions and final conclusions by default, with execution details available in the collapsible process row.
4. Improved AI process duration reporting. The process row now shows the full wall-clock time from the user question to the final AI conclusion, including AI requests, command execution, and approval waiting time.
5. Improved AI command safety detection for common readonly operations, including readonly fallback chains, `/dev/null` output discard, `command -v`, `docker-compose --version`, `kubectl version --client`, and `pm2 status`, while still requiring approval for installs, deletes, restarts, and file-writing redirects.
6. Improved repeated-command handling by recognizing equivalent command paths and clarifying successful no-output results, reducing repeated diagnostic queries.
7. Added resizing support for the right AI panel, with terminal layout refitting after width changes.
8. Improved window dragging behavior so only the top titlebar drag zone can move the window; content areas and controls are no longer draggable by default.

## v1.1.5

1. Improved SFTP upload entry behavior: the context menu now always shows "Upload File" and "Upload Folder" regardless of the current selection, and uploads always target the current directory.
2. Improved folder uploads by scanning child entries first, preserving relative paths, and then processing directory creation and file uploads as one queued upload group.
3. Fixed an issue where resuming a paused upload group could stay stuck in the queued state; paused uploads now wait for the current task to release the transfer slot before resuming.
4. Improved task center behavior so it opens automatically only when a transfer task is first created, instead of reopening for every progress event.
5. Improved upload and download temporary-file handling: uploads write to remote `.download` files and downloads write to local `.download` files before renaming them to the final filename after completion.
6. Improved upload group display in the task center with completed item count, total item count, and the current child item being processed.

## v1.1.4

- Added terminal copy and paste shortcuts `Ctrl+Shift+C` / `Ctrl+Shift+V` (`Cmd+Shift+C` / `Cmd+Shift+V` on macOS) to copy the current selection and paste clipboard text into the terminal.
- Added corresponding entries for terminal copy and paste to the shortcut list in the Settings dialog.
- Add system tray

## v1.1.3

1. Fixed the SFTP context menu staying open after creating a remote file or folder.
2. Fixed `Ctrl+A` while editing a newly created or renamed SFTP item so it selects the input text instead of selecting all files.
3. Improved macOS remote system stats collection by handling BSD `df`, `vm_stat`, and macOS shell output differences more reliably.
4. Improved SSH terminal Chinese input and output with streaming UTF-8 decoding and UTF-8 locale requests through SSH environment variables.
5. Improved macOS SSH terminal initialization by removing interactive long commands that could pollute shell history; initial path sync now uses a non-interactive command.
6. Improved macOS terminal directory color support by requesting `CLICOLOR` through SSH environment variables when the server accepts environment forwarding.

## v1.1.2

- Added a default local terminal. OrbitSSH now opens a "Local" tab on startup, entering `C:\` on Windows and the user home directory on Linux and macOS.
- Added local terminal interaction support, including input, terminal resize sync, close, reconnect, system status display, and AI command execution.

## v1.1.1

- Improved the AI follow-up experience by automatically focusing the bottom input box after an AI response finishes.
- Fixed an issue on macOS where pressing Enter while composing or selecting Chinese IME candidates could accidentally send the AI message; Enter now confirms the candidate first.
- Fixed reconnect failures after an SSH disconnect by allowing reconnect to restore the session from the original server information after the old session is cleaned up.
- Fixed missing focus after creating a remote file or folder; the inline name input now focuses automatically and selects the placeholder name for immediate renaming.

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
