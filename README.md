# Orbit SSH

Orbit SSH 是一个基于 Electron + Vue 3 构建的现代化 SSH/SFTP 客户端应用，提供跨平台的远程服务器连接、终端管理和文件传输功能。

## 功能特性

- **SSH 终端**：支持多标签页终端会话，内置 xterm 终端模拟
- **SFTP 文件管理**：可视化的远程文件浏览、上传下载操作
- **服务器管理**：保存和管理多个服务器连接配置
- **密码加密存储**：本地密码安全加密存储
- **多窗口支持**：现代化的标签页式界面
- **主题定制**：支持自定义主题颜色

## 技术栈

- **前端框架**：Vue 3 + TypeScript
- **桌面框架**：Electron
- **终端模拟**：xterm.js
- **SSH 库**：ssh2
- **构建工具**：Vite
- **样式**：原生 CSS

## 快速开始

### 环境要求

- Node.js 18+
- npm 9+

### 安装依赖

```bash
npm install
```

### 开发模式

```bash
npm run dev
```

### 构建应用

```bash
npm run build
```

## 项目结构

```
orbit-ssh/
├── src/
│   ├── main/              # Electron 主进程
│   │   ├── index.ts      # 入口文件
│   │   ├── ipc/          # IPC 处理器
│   │   ├── ssh/          # SSH 会话管理
│   │   ├── sftp/         # SFTP 文件管理
│   │   ├── storage/      # 本地存储
│   │   └── logger.ts     # 日志模块
│   ├── preload/          # 预加载脚本
│   ├── renderer/         # Vue 渲染进程
│   │   ├── components/  # UI 组件
│   │   ├── assets/      # 静态资源
│   │   ├── styles.css   # 全局样式
│   │   └── App.vue       # 根组件
│   └── shared/           # 共享类型定义
│       ├── server.ts
│       ├── settings.ts
│       ├── sftp.ts
│       └── terminal.ts
├── index.html
├── package.json
├── vite.config.ts
└── tsconfig.json
```

## 使用说明

### 连接服务器

1. 点击侧边栏的添加按钮
2. 填写服务器连接信息（主机、端口、用户名、密码）
3. 点击连接按钮建立 SSH 连接

### 终端操作

- 支持多标签页终端会话
- 可搜索终端输出内容
- 支持复制粘贴

### 文件传输

- 浏览远程服务器文件系统
- 支持拖拽上传下载
- 文件夹同步功能

## 配置说明

应用配置存储在本地，支持以下自定义选项：

- 主题颜色
- 字体大小
- 窗口行为

## 许可证

MIT License