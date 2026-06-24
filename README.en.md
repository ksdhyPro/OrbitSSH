# Orbit SSH

Orbit SSH is a modern SSH/SFTP client application built with Electron + Vue 3, offering cross-platform remote server connection, terminal management, and file transfer capabilities.

## Features

- **SSH Terminal**: Supports multi-tab terminal sessions with built-in xterm terminal emulation
- **SFTP File Management**: Visual remote file browsing, upload, and download operations
- **Server Management**: Save and manage multiple server connection configurations
- **Password Encryption Storage**: Secure local encryption of passwords
- **Multi-window Support**: Modern tabbed interface
- **Theme Customization**: Supports custom theme colors

## Technology Stack

- **Frontend Framework**: Vue 3 + TypeScript
- **Desktop Framework**: Electron
- **Terminal Emulation**: xterm.js
- **SSH Library**: ssh2
- **Build Tool**: Vite
- **Styling**: Native CSS

## Quick Start

### Prerequisites

- Node.js 18+
- npm 9+

### Install Dependencies

```bash
npm install
```

### Development Mode

```bash
npm run dev
```

### Build the Application

```bash
npm run build
```

## Project Structure

```
orbit-ssh/
├── src/
│   ├── main/              # Electron main process
│   │   ├── index.ts      # Entry file
│   │   ├── ipc/          # IPC handlers
│   │   ├── ssh/          # SSH session management
│   │   ├── sftp/         # SFTP file management
│   │   ├── storage/      # Local storage
│   │   └── logger.ts     # Logging module
│   ├── preload/          # Preload script
│   ├── renderer/         # Vue renderer process
│   │   ├── components/  # UI components
│   │   ├── assets/      # Static assets
│   │   ├── styles.css   # Global styles
│   │   └── App.vue       # Root component
│   └── shared/           # Shared type definitions
│       ├── server.ts
│       ├── settings.ts
│       ├── sftp.ts
│       └── terminal.ts
├── index.html
├── package.json
├── vite.config.ts
└── tsconfig.json
```

## Usage Instructions

### Connecting to a Server

1. Click the Add button in the sidebar
2. Fill in the server connection details (host, port, username, password)
3. Click the Connect button to establish the SSH connection

### Terminal Operations

- Supports multi-tab terminal sessions
- Searchable terminal output
- Copy and paste support

### File Transfer

- Browse remote server filesystem
- Drag-and-drop upload and download support
- Folder synchronization functionality

## Configuration

Application settings are stored locally and support the following customizations:

- Theme color
- Font size
- Window behavior

## License

MIT License