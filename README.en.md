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

OrbitSSH is a **desktop SSH / SFTP client** built with **Electron + Vue 3**. It integrates powerful remote connectivity, multi-tab terminal management, and visual file browsing & transfer into a clean, unified interface — designed for DevOps engineers, developers, and anyone who regularly interacts with remote Linux servers.

> Design goal: deliver **near-native terminal responsiveness** locally, with the **efficiency and convenience** of a modern graphical interface.

See release history: [English Changelog](docs/update.en.md) | [中文更新日志](docs/update.md)

---

## Features

### 🔌 SSH Terminal

- High-performance terminal emulation powered by [xterm.js](https://xtermjs.org/), with 256-color support, cursor styles, and auto-fit resizing
- Multi-tab session management — switch between server contexts instantly
- Built-in terminal content search via [xterm-addon-search](https://github.com/xtermjs/xterm.js/tree/master/addons/addon-search)
- System clipboard integration with select-to-copy and right-click-to-paste

### 📁 SFTP File Manager

- Dual-pane layout for local ⇄ remote file browsing at a glance
- Drag-and-drop upload / download — bulk operations without blocking the terminal
- In-place remote file editing with auto-save back to server
- Inline image preview
- Directory sync with bidirectional diff and selective transfer
- Full file CRUD operations: create, rename, delete

### ⚙️ Server Management

- Persistent connection profiles with create, edit, delete, and group organization
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
│   ┌──────────┬──────────┬──────────┐         │
│   │ Terminal │  SFTP    │ Settings │         │
│   │  Panel   │  Panel   │  Dialog  │         │
│   └──────────┴──────────┴──────────┘         │
├──────────────────────────────────────────────┤
│                 Preload                       │
│        contextBridge (secure isolation)       │
├──────────────────────────────────────────────┤
│               Main Process                    │
│         Electron + Node.js                    │
│   ┌──────┬──────┬──────┬──────┬──────┐       │
│   │ SSH  │ SFTP │Store │Update│Logger│       │
│   │Mgr   │Mgr   │      │      │      │       │
│   └──────┴──────┴──────┴──────┴──────┘       │
└──────────────────────────────────────────────┘
```

Key design principles:

- **Process isolation**: `contextIsolation` + `sandbox` enabled — the Renderer has no direct Node.js access; all system capabilities are exposed on-demand via `ipcMain` / `ipcRenderer`
- **Connection reuse**: SSH sessions persist in the Main process and are automatically cleaned up when windows close
- **Security-first**: `nodeIntegration: false` — the preload script is the sole bridge between the Renderer and the system

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

---

## Project Structure

```
orbitssh/
├── src/
│   ├── main/                    # Electron main process
│   │   ├── index.ts            # App entry — window creation & IPC registration
│   │   ├── ipc/                # IPC handlers
│   │   │   ├── server-ipc.ts   # Server connection profile management
│   │   │   ├── terminal-ipc.ts # Terminal session IPC
│   │   │   ├── sftp-ipc.ts     # File transfer IPC
│   │   │   ├── settings-ipc.ts # Application settings read/write
│   │   │   ├── clipboard-ipc.ts# Clipboard read/write
│   │   │   ├── dialog-ipc.ts   # Native dialog prompts
│   │   │   ├── window-ipc.ts   # Window controls (minimize/maximize/close)
│   │   │   ├── system-ipc.ts   # System info
│   │   │   ├── update-ipc.ts   # Application updates
│   │   │   └── logger-ipc.ts   # Logging channel
│   │   ├── ssh/                # SSH session management
│   │   │   ├── session-manager.ts
│   │   │   └── auth-options.ts
│   │   ├── sftp/               # SFTP session management
│   │   │   └── sftp-manager.ts
│   │   ├── storage/            # Local persistent storage
│   │   │   ├── server-store.ts
│   │   │   └── settings-store.ts
│   │   ├── update/             # Auto-update module
│   │   │   └── index.ts
│   │   └── logger.ts           # Application logger
│   ├── preload/                # Preload scripts (contextBridge secure API exposure)
│   │   ├── index.ts
│   │   └── index.cjs
│   ├── renderer/               # Vue renderer process
│   │   ├── components/         # UI components
│   │   ├── assets/             # Icons & static assets
│   │   ├── styles.css          # Global styles
│   │   └── App.vue             # Root component
│   └── shared/                 # Shared type definitions (main ⇄ renderer)
│       ├── server.ts
│       ├── settings.ts
│       ├── sftp.ts
│       └── terminal.ts
├── docs/                       # Documentation & screenshots
├── build/                      # Build assets (icons, NSIS scripts)
├── scripts/                    # Helper scripts
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
4. Right-click a server entry for additional actions

### Terminal

- Click tabs to switch between sessions — horizontal scrolling supported
- `Ctrl+F` / `Cmd+F` to search terminal output
- Selected text is auto-copied; right-click to paste
- Right-click a tab to close or reconnect

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
