<p align="center">
  <img src="build/icon.ico" width="96" alt="OrbitSSH Logo" />
</p>

<h1 align="center">OrbitSSH</h1>

<p align="center">
  <strong>现代化 · 高性能 · 跨平台</strong>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-blue" alt="Platform" />
  <img src="https://img.shields.io/badge/license-MIT-green" alt="License" />
  <img src="https://img.shields.io/badge/version-1.1.7-orange" alt="Version" />
  <img src="https://img.shields.io/badge/electron-37.2.0-9feaf9" alt="Electron" />
  <img src="https://img.shields.io/badge/vue-3.5.17-42b883" alt="Vue" />
  <img src="https://img.shields.io/badge/ssh2-1.17.0-red" alt="SSH2" />
  <img src="https://img.shields.io/badge/node-22.17.1-yellow" alt="Node.js" />
</p>

<p align="center">
  简体中文 | <a href="README.en.md">English</a>
</p>

---

## 简介

OrbitSSH 是一款基于 **Electron + Vue 3** 构建的**桌面端 SSH / SFTP 客户端**。它将强大的远程连接能力、多标签页终端管理、可视化文件浏览与传输、AI 服务器诊断助手集成在一个简洁的界面中，面向运维工程师、开发者以及一切需要频繁与远程 Linux 服务器交互的用户。

> 设计目标：在本地获得**接近原生终端的响应速度**，同时拥有现代图形界面的**效率与便利**。

查看版本更新内容：[中文更新日志](docs/update.md) | [English Changelog](docs/update.en.md)

---

## 功能亮点

### 🔌 SSH 终端

- 基于 [xterm.js](https://xtermjs.org/) 的高性能终端仿真，支持 256 色、光标样式、窗口自适应
- 多标签页会话管理，一键切换不同服务器上下文
- 终端内容搜索（内置 [xterm-addon-search](https://github.com/xtermjs/xterm.js/tree/master/addons/addon-search)）
- 系统剪贴板集成，支持选中复制与右键粘贴
- 支持断线后快速重连，并在重连成功后恢复主 SFTP 会话

### 📁 SFTP 文件管理

- 双栏布局，本地 ⇄ 远程文件浏览一目了然
- 拖拽上传 / 下载，批量操作不阻塞终端
- 远程文件原位编辑，保存自动回传
- 图片在线预览
- 目录间文件同步（双向对比 + 选择性传输）
- 完整的文件 CRUD 操作：新建、重命名、删除

### 🤖 AI 助手

- 内置 AI 助手面板，按终端标签页隔离对话，避免不同服务器上下文混杂
- 自动结合当前服务器、终端路径、SFTP 路径和连接状态进行问答；近期终端输出默认不发送，可显式开启脱敏共享
- 支持 OpenAI 兼容模型，提供流式回复、Markdown 实时渲染和命令执行过程卡片
- 支持“每次询问 / 完全访问”两种权限模式，命令执行经过本地只读白名单、高风险黑名单、复合命令审查和审批校验
- 支持请求与命令终止、5 分钟审批有效期、上下文脱敏和长度预算，减少失控执行与敏感信息泄露风险
- 支持多模型配置、当前模型切换和默认模式设置，API Key 使用本地安全存储并在界面中脱敏展示

### ⚙️ 服务器管理

- 连接配置本地持久化，支持增删改查与分组整理
- 支持常用服务器置顶，置顶连接自动排列在列表前方
- 密码 / 私钥等敏感信息使用系统级安全存储加密保存
- 一键连接、快速重连

### 🎨 主题与外观

- 自定义主题色，终端配色与全局 UI 统一可控
- 自定义窗口标题栏（无原生框架），沉浸式深色默认风格
- 字体大小、行高、光标样式等终端细节可调

### 🔄 版本更新

- 内置 `electron-updater` 自动检查更新，支持 generic 服务器分发
- 更新提示弹窗内下载进度可见，安装一键完成

---

## 界面预览

| 终端主页 | SFTP 文件传输 | 设置面板 |
|:---:|:---:|:---:|
| ![终端主页](docs/home.png) | ![文件传输](docs/transfer.png) | ![设置](docs/setting.png) |

---

## 技术架构

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
│        contextBridge (安全隔离)               │
├──────────────────────────────────────────────┤
│               Main Process                    │
│         Electron + Node.js                    │
│   ┌──────┬──────┬──────┬──────┬──────┬─────┐ │
│   │ SSH  │ SFTP │ AI   │Store │Update│Log  │ │
│   │Mgr   │Mgr   │Agent │      │      │     │ │
│   └──────┴──────┴──────┴──────┴──────┴─────┘ │
└──────────────────────────────────────────────┘
```

关键设计原则：

- **进程隔离**：启用 `contextIsolation` + `sandbox`，Renderer 无权直接访问 Node.js —— 所有系统能力通过 `ipcMain` / `ipcRenderer` 按需暴露
- **连接复用**：SSH 会话在 Main 进程内持久化，窗口关闭时自动清理
- **安全优先**：`nodeIntegration: false`，preload 脚本是 Renderer 与系统之间的唯一桥梁；AI 命令执行经过策略校验、审批和会话归属校验

---

## 技术栈

| 层级 | 技术 |
|:---|:---|
| 桌面框架 | Electron 37 |
| 前端框架 | Vue 3 (Composition API) |
| 状态管理 | Pinia |
| 终端模拟 | xterm.js 5 + Canvas 渲染 |
| SSH 协议 | ssh2 |
| SFTP 协议 | ssh2-sftp-client |
| 代码编辑器 | CodeMirror 6 |
| Markdown 渲染 | markdown-it + DOMPurify |
| 本地持久化 | electron-store |
| 自动更新 | electron-updater |
| 构建工具 | Vite + electron-builder |
| 语言 | TypeScript (strict) |

---

## 快速开始

### 环境要求

- **Node.js** ≥ 22
- **npm** ≥ 9
- Windows / macOS / Linux

### 克隆项目

```bash
git clone https://gitee.com/ksdhy/orbit-ssh
cd orbitssh
```

### 安装依赖

```bash
npm install
```

### 开发模式

启动 Vite 开发服务器 + Electron 窗口（支持 HMR）：

```bash
npm run dev:electron
```

### 构建与打包

```bash
# 仅构建输出到 dist / dist-electron
npm run build

# 构建并打 Windows 安装包（输出到 release/）
npm run dist
```

### 质量检查

```bash
# AI 命令策略、审批、上下文、输入校验和 SSE 解析专项测试
npm run test:ai

# Vue、Electron TypeScript 检查与生产构建
npm run build
```

---

## 项目结构

```
orbitssh/
├── src/
│   ├── main/                    # Electron 主进程
│   │   ├── index.ts            # 应用入口，窗口创建 & IPC 注册
│   │   ├── ipc/                # IPC 处理器
│   │   │   ├── ai-ipc.ts       # AI 助手 IPC
│   │   │   ├── server-ipc.ts   # 服务器连接配置管理
│   │   │   ├── terminal-ipc.ts # 终端会话 IPC
│   │   │   ├── sftp-ipc.ts     # 文件传输 IPC
│   │   │   ├── settings-ipc.ts # 应用设置读写
│   │   │   ├── clipboard-ipc.ts# 剪贴板读写
│   │   │   ├── dialog-ipc.ts   # 原生对话框
│   │   │   ├── window-ipc.ts   # 窗口控制（最小化/最大化/关闭）
│   │   │   ├── system-ipc.ts   # 系统信息
│   │   │   ├── update-ipc.ts   # 应用更新
│   │   │   └── logger-ipc.ts   # 日志通道
│   │   ├── ssh/                # SSH 会话管理
│   │   │   ├── session-manager.ts
│   │   │   ├── terminal-command.ts      # 可取消的命令执行
│   │   │   ├── terminal-system-stats.ts # 本地与远端资源统计
│   │   │   └── auth-options.ts
│   │   ├── sftp/               # SFTP 会话管理
│   │   │   └── sftp-manager.ts
│   │   ├── ai/                 # AI Agent、命令策略、上下文与响应解析
│   │   │   ├── ai-agent.ts     # Agent 循环与命令执行编排
│   │   │   ├── command-policy.ts
│   │   │   ├── ai-provider.ts  # OpenAI 兼容模型适配
│   │   │   └── ai-context.ts   # 上下文脱敏与预算
│   │   ├── storage/            # 本地持久化存储
│   │   │   ├── server-store.ts
│   │   │   └── settings-store.ts
│   │   ├── update/             # 自动更新模块
│   │   │   └── index.ts
│   │   └── logger.ts           # 应用日志
│   ├── preload/                # 预加载脚本（contextBridge 安全暴露 API）
│   │   ├── index.ts
│   │   └── index.cjs
│   ├── renderer/               # Vue 渲染进程
│   │   ├── components/         # UI 组件
│   │   ├── composables/        # 跨组件交互编排
│   │   ├── assets/             # 图标 & 静态资源
│   │   ├── styles.css          # 模块化样式入口
│   │   ├── styles/             # 主题、终端、文件、弹窗与 AI 样式模块
│   │   └── App.vue             # 根组件
│   └── shared/                 # 主进程 ⇄ 渲染进程共享类型定义
│       ├── server.ts
│       ├── ai.ts
│       ├── settings.ts
│       ├── sftp.ts
│       └── terminal.ts
├── docs/                       # 文档 & 截图
├── build/                      # 构建资源（图标、NSIS 脚本）
├── scripts/                    # 辅助脚本
├── vite.config.ts
├── tsconfig.json
├── tsconfig.electron.json
├── package.json
└── README.md
```

---

## 使用说明

### 连接管理

1. 点击左侧栏 **+** 按钮打开连接对话框
2. 填写主机地址、端口、认证方式（密码 / 私钥）
3. 保存后点击服务器条目即可建立连接
4. 使用服务器条目右侧的图钉按钮置顶常用连接，右键可查看更多操作

### 终端操作

- 点击标签页切换不同会话，支持横向滚动
- `Ctrl+F` / `Cmd+F` 搜索终端输出
- 选中文本自动复制，右键粘贴
- 标签页右键可关闭或重新连接

### AI 助手

1. 在 **设置 → AI** 中启用 AI，并添加 OpenAI 兼容模型的 Base URL、模型名和 API Key
2. 选择默认权限模式：每次询问或完全访问；重要服务器建议使用“每次询问”
3. 打开 SSH 终端后，在右侧 AI 面板输入诊断问题
4. 对需要审批的命令，确认命令内容、风险说明和执行原因后再批准
5. 如需让模型读取最近终端输出，在设置中显式开启“发送最近终端输出”；发送前会自动脱敏

### 文件传输

- 连接成功后可通过**分屏视图**或**侧边栏**打开 SFTP 面板
- 拖拽文件/文件夹到对侧面板完成上传/下载
- 双击远程文本文件触发原位编辑
- 点击**同步路径**按钮启动目录同步

---

## 配置

应用配置通过 `electron-store` 持久化到本地用户数据目录，支持：

| 分类 | 可配置项 |
|:---|:---|
| 主题 | 主题色、终端配色、终端背景色 |
| 终端 | 字体大小、字体族、行高、光标样式 |
| 行为 | 窗口状态记忆、确认对话框偏好 |
| AI | 启用状态、模型配置、当前模型、默认权限模式、终端上下文共享 |
| 更新 | 更新服务器地址、自动检查开关 |

---

## 贡献指南

欢迎提交 Issue 和 Pull Request！

1. Fork 本仓库
2. 基于 `master` 创建功能分支：`git checkout -b feat/my-feature`
3. 提交更改并附上清晰的 commit message
4. 推送分支并发起 Pull Request

> 提交前请确保通过类型检查：`npm run build`

---

## 许可证

本项目基于 [MIT License](LICENSE) 发布。

---

<p align="center">
  <sub>Made with ❤️ by ksdhy</sub>
</p>
