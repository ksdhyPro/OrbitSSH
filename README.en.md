<p align="center">
  <img src="build/icon.ico" width="96" alt="OrbitSSH Logo" />
</p>

<h1 align="center">OrbitSSH</h1>

<p align="center">
  <strong>Modern · Performant · Cross-Platform</strong>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-blue" alt="Platform" />
  <img src="https://img.shields.io/badge/license-MIT-green" alt="License" />
  <img src="https://img.shields.io/badge/version-1.6.1-orange" alt="Version" />
  <img src="https://img.shields.io/badge/electron-37.2.0-9feaf9" alt="Electron" />
  <img src="https://img.shields.io/badge/vue-3.5.17-42b883" alt="Vue" />
  <img src="https://img.shields.io/badge/ssh2-1.17.0-red" alt="SSH2" />
  <img src="https://img.shields.io/badge/node-22.17.1-yellow" alt="Node.js" />
</p>

<p align="center">
  <a href="README.md">简体中文</a> | English
</p>

---

## Overview

OrbitSSH is a **desktop SSH / SFTP client** built with **Electron + Vue 3**. It integrates powerful remote connectivity, multi-tab terminal management, visual file browsing & transfer, and an AI-powered server diagnostics assistant into a clean, unified interface — designed for DevOps engineers, developers, and anyone who regularly interacts with remote Linux servers.

> Design goal: deliver **near-native terminal responsiveness** locally, with the **efficiency and convenience** of a modern graphical interface.

See release history: [English Changelog](docs/update.en.md) | [中文更新日志](docs/update.md)

---

## Features

### 🔌 SSH Terminal

- High-performance terminal emulation powered by [xterm.js](https://xtermjs.org/), with 256-color support, cursor styles, and auto-fit resizing
- Multi-tab session management — switch between server contexts instantly
- Built-in terminal content search via [xterm-addon-search](https://github.com/xtermjs/xterm.js/tree/master/addons/addon-search)
- System clipboard integration with select-to-copy and right-click-to-paste
- Fast reconnect after disconnects, with automatic restoration of the main SFTP session after reconnect succeeds

### 📁 SFTP File Manager

- Dual-pane layout for local ⇄ remote file browsing at a glance
- Drag-and-drop upload / download — bulk operations without blocking the terminal
- In-place remote file editing with auto-save back to server
- Inline image preview
- Directory sync with bidirectional diff and selective transfer
- Full file CRUD operations: create, rename, delete

### 🤖 AI Assistant

- Built-in AI assistant panel with conversations isolated per terminal tab, preventing context from different servers from mixing
- Uses the current server, terminal path, SFTP path, and connection status as context; recent terminal output is opt-in and redacted before sharing
- Supports OpenAI-compatible models with streaming responses, real-time Markdown rendering, and command execution process cards
- Provides Ask Every Time and Full Access modes, with a local readonly whitelist, high-risk blacklist, compound-command review, and approval validation
- Supports request and command cancellation, five-minute approvals, context redaction, and bounded prompts to reduce runaway execution and sensitive-data exposure
- Supports multiple model configurations, active model switching, and default mode settings; API keys are stored locally with secure storage and shown masked in the UI

### ⚙️ Server Management

- Persistent connection profiles with create, edit, delete, and group organization
- Pin frequently used servers so they remain at the top of the connection list
- Sensitive credentials (passwords, private keys) stored with system-level secure encryption
- One-click connect and fast reconnect

### 🎨 Themes & Appearance

- Custom accent color — terminal colors and global UI follow the same theme
- Custom window title bar (frameless), with an immersive dark default style
- Adjustable font size, line height, cursor style and other terminal details

### 🔄 Auto Update

- Built-in `electron-updater` for automatic update checks via generic server distribution
- Download progress visible inside the update dialog — one-click install when ready

---

## Screenshots

| Terminal Home | SFTP File Transfer | Settings Panel |
|:---:|:---:|:---:|
| ![Terminal Home](docs/home.png) | ![File Transfer](docs/transfer.png) | ![Settings](docs/setting.png) |

---

## Architecture

```
┌──────────────────────────────────────────────┐
│                  Renderer                     │
│          Vue 3 + Pinia + TypeScript           │
│   ┌──────────┬──────────┬──────────┬──────┐  │
│   │ Terminal │  SFTP    │ Settings │  AI  │  │
│   │  Panel   │  Panel   │  Dialog  │Panel │  │
│   └──────────┴──────────┴──────────┴──────┘  │
├──────────────────────────────────────────────┤
│                 Preload                       │
│        contextBridge (secure isolation)       │
├──────────────────────────────────────────────┤
│               Main Process                    │
│         Electron + Node.js                    │
│   ┌──────┬──────┬──────┬──────┬──────┬─────┐ │
│   │ SSH  │ SFTP │ AI   │Store │Update│Log  │ │
│   │Mgr   │Mgr   │Agent │      │      │     │ │
│   └──────┴──────┴──────┴──────┴──────┴─────┘ │
└──────────────────────────────────────────────┘
```

Key design principles:

- **Process isolation**: `contextIsolation` + `sandbox` enabled — the Renderer has no direct Node.js access; all system capabilities are exposed on-demand via `ipcMain` / `ipcRenderer`
- **Connection reuse**: SSH sessions persist in the Main process and are automatically cleaned up when windows close
- **Security-first**: `nodeIntegration: false` — the preload script is the sole bridge between the Renderer and the system; AI command execution is guarded by policy checks, approval, and session ownership validation

---

## Tech Stack

| Layer | Technology |
|:---|:---|
| Desktop Framework | Electron 37 |
| Frontend Framework | Vue 3 (Composition API) |
| State Management | Pinia |
| Terminal Emulation | xterm.js 5 + Canvas renderer |
| SSH Protocol | ssh2 |
| SFTP Protocol | ssh2-sftp-client |
| Code Editor | CodeMirror 6 |
| Markdown Rendering | markdown-it + DOMPurify |
| Local Persistence | electron-store |
| Auto Update | electron-updater |
| Build Tools | Vite + electron-builder |
| Language | TypeScript (strict) |

---

## Getting Started

### Prerequisites

- **Node.js** ≥ 22
- **npm** ≥ 9
- Windows / macOS / Linux

### Clone the Repository

```bash
git clone https://gitee.com/ksdhy/orbit-ssh
cd orbitssh
```

### Install Dependencies

```bash
npm install
```

### Development

Start the Vite dev server alongside an Electron window (with HMR):

```bash
npm run dev:electron
```

### Build & Package

```bash
# Build outputs to dist / dist-electron
npm run build

# Build and create Windows installer (outputs to release/)
npm run dist
```

The Windows build generates the OrbitSSH dark custom installer and a `latest.yml` file for `electron-updater`.

### Quality Checks

```bash
# Focused tests for AI policy, approvals, context, input validation, and SSE parsing
npm run test:ai

# Vue and Electron TypeScript checks plus the production build
npm run build
```

---

## Project Structure

```
orbitssh/
├── src/
│   ├── main/                         # Electron main process
│   │   ├── bootstrap.ts              # Startup bootstrap and initialization
│   │   ├── index.ts                  # Main window, tray, and app lifecycle
│   │   ├── startup-diagnostics.ts    # Windows startup diagnostics
│   │   ├── ipc/                      # AI, SSH, SFTP, settings, and window IPC
│   │   ├── ai/                       # AI Agent, Codex, approvals, and command policy
│   │   ├── automation/               # Server automation task execution
│   │   ├── local-files/              # Local file browsing
│   │   ├── sftp/                     # SFTP sessions, upload, download, and relay transfer
│   │   ├── ssh/                      # SSH sessions, terminal commands, and system stats
│   │   ├── storage/                  # Server and settings persistence
│   │   ├── update/                   # electron-updater integration
│   │   └── logger.ts                 # Application logger
│   ├── preload/                      # contextBridge secure APIs
│   ├── renderer/                     # Vue renderer process
│   │   ├── components/               # Terminal, file, AI, and settings components
│   │   ├── composables/              # Remote-file and interaction orchestration
│   │   ├── config/                   # Renderer configuration
│   │   ├── stores/                   # Pinia state management
│   │   ├── styles/                   # Theme, terminal, file, and dialog styles
│   │   ├── utils/                    # Renderer utilities
│   │   └── App.vue                   # Root component
│   ├── shared/                       # Shared main ⇄ renderer types
│   └── types/                        # Global Preload type declarations
├── packaging/windows/                # Custom Windows installer
│   ├── assets/                       # Icons and branded installer assets
│   ├── scripts/                      # NSIS install and uninstall logic
│   ├── skin/                         # Dark UI and high-DPI skin assets
│   └── runtime/                      # 7-Zip, NSIS, and OrbitSSHSkin
├── scripts/                          # Build, version-sync, and asset scripts
├── tests/                            # AI, main, SFTP, SSH, and installer tests
├── docs/                             # Documentation, changelog, and screenshots
├── build/                            # App icons and shared build assets
├── vite.config.ts
├── tsconfig.json
├── tsconfig.electron.json
├── package.json
└── README.md
```

---

## Usage Guide

### Managing Connections

1. Click the **+** button in the left sidebar to open the connection dialog
2. Fill in the host address, port, and authentication method (password / private key)
3. Save and click a server entry to establish a connection
4. Use the pin button on a server entry to keep frequent connections on top; right-click for more actions

### Terminal

- Click tabs to switch between sessions — horizontal scrolling supported
- `Ctrl+F` / `Cmd+F` to search terminal output
- Selected text is auto-copied; right-click to paste
- Right-click a tab to close or reconnect

### AI Assistant

1. Enable AI in **Settings → AI**, then add an OpenAI-compatible Base URL, model name, and API Key
2. Choose Ask Every Time or Full Access as the default mode; Ask Every Time is recommended for important servers
3. Open an SSH terminal and ask diagnostic questions in the right-side AI panel
4. For commands that require approval, review the command, risk note, and execution reason before approving
5. To let the model read recent terminal output, explicitly enable terminal-output sharing in Settings; the content is redacted before sending

### File Transfer

- Once connected, open the SFTP panel via **split view** or the **sidebar**
- Drag files / folders to the opposite pane to upload / download
- Double-click a remote text file to start in-place editing
- Click the **sync path** button to initiate directory synchronization

---

## Configuration

Settings are persisted to the local user data directory via `electron-store`:

| Category | Configurable Options |
|:---|:---|
| Theme | Accent color, terminal color scheme, terminal background |
| Terminal | Font size, font family, line height, cursor style |
| Behavior | Window state memory, confirmation dialog preferences |
| AI | Enable state, model configurations, active model, default permission mode, terminal-context sharing |
| Updates | Update server URL, auto-check toggle |

---

## Contributing

Issues and Pull Requests are welcome!

1. Fork this repository
2. Create a feature branch from `master`: `git checkout -b feat/my-feature`
3. Commit your changes with clear commit messages
4. Push the branch and open a Pull Request

> Please ensure type-checking passes before submitting: `npm run build`

---

## License

This project is released under the [MIT License](LICENSE).

---

<p align="center">
  <sub>Made with ❤️ by ksdhy</sub>
</p>
