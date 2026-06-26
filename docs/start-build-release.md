# OrbitSSH 启动、打包与更新发布流程

本文档用于说明 OrbitSSH 的本地启动、构建、Windows/macOS 打包，以及自动更新包应该如何放到更新服务器。

## 1. 项目技术栈

OrbitSSH 是 Electron + Vue 3 + Vite 项目，使用 electron-builder 负责桌面端打包。

关键配置位置：

- `package.json`：npm scripts、electron-builder 打包配置、更新服务器地址
- `src/main/update/index.ts`：自动更新逻辑
- `build/`：图标、NSIS 安装脚本等构建资源
- `release/`：打包输出目录

当前默认更新地址在 `package.json` 中：

```json
"publish": {
  "provider": "generic",
  "url": "https://1ms.ink/update/"
}
```

应用启动后会自动检查更新；也可以在应用内手动检查更新。如果用户在设置里配置了自定义更新地址，则会优先使用自定义地址。

## 2. 环境准备

推荐环境：

- Node.js >= 22
- npm >= 9
- macOS 打包建议在 macOS 上执行
- Windows 打包建议在 Windows 上执行

首次拉取项目后安装依赖：

```bash
npm install
```

如果依赖或 Electron 下载失败，通常是网络或镜像问题。可以切换 npm registry 或配置 Electron 镜像后重试。

## 3. 本地开发启动流程

开发模式会同时启动 Vite 开发服务器和 Electron 窗口，支持前端热更新。

```bash
npm run dev:electron
```

该命令内部流程：

1. 编译 Electron 主进程 TypeScript：

   ```bash
   tsc -p tsconfig.electron.json
   ```

2. 拷贝 preload 脚本到 `dist-electron/preload/index.cjs`
3. 启动 Vite 开发服务器：

   ```bash
   vite --host 127.0.0.1
   ```

4. 等待 `127.0.0.1:5173` 可用后启动 Electron
5. Electron 使用 `VITE_DEV_SERVER_URL=http://127.0.0.1:5173` 加载开发页面

单独启动 Vite：

```bash
npm run dev
```

只预览前端构建产物：

```bash
npm run preview
```

## 4. 构建流程

只构建应用，不生成安装包：

```bash
npm run build
```

该命令会执行：

```bash
vue-tsc --noEmit
vite build
tsc -p tsconfig.electron.json
node scripts/copy-preload.cjs
```

构建产物：

- `dist/`：Vue 渲染进程产物
- `dist-electron/`：Electron 主进程和 preload 产物

如果这一步失败，先不要打包。需要先修复 TypeScript、Vite 或 Electron 主进程编译错误。

## 5. Windows 打包流程

当前 `package.json` 已配置 Windows NSIS 安装包：

```json
"win": {
  "target": [
    {
      "target": "nsis",
      "arch": ["x64"]
    }
  ],
  "icon": "build/icon.ico"
}
```

### 5.1 打 Windows 安装包

```bash
npm run dist
```

等价于：

```bash
npm run build
npx electron-builder --win
```

输出目录：

```text
release/
```

常见产物：

```text
release/OrbitSSH-1.0.0-Setup-x64.exe
release/OrbitSSH-1.0.0-Setup-x64.exe.blockmap
release/latest.yml
```

说明：

- `.exe` 是给用户下载安装的 Windows 安装包
- `.blockmap` 用于差分更新
- `latest.yml` 是 Windows 自动更新元数据

### 5.2 只生成 Windows 目录包

如果只是本地检查应用文件结构，不想生成安装器：

```bash
npm run package
```

等价于：

```bash
npm run build
npx electron-builder --win --dir
```

该模式适合调试，不适合作为正式发布包。

## 6. macOS 打包流程

当前 `package.json` 已配置 macOS dmg：

```json
"mac": {
  "target": [
    {
      "target": "dmg",
      "arch": ["arm64", "x64"]
    }
  ]
}
```

### 6.1 打 macOS dmg

```bash
npm run build
npx electron-builder --mac
```

输出目录：

```text
release/
```

当前配置会打出两个 dmg：

```text
release/OrbitSSH-1.0.0-Setup-arm64.dmg
release/OrbitSSH-1.0.0-Setup-arm64.dmg.blockmap
release/OrbitSSH-1.0.0-Setup-x64.dmg
release/OrbitSSH-1.0.0-Setup-x64.dmg.blockmap
release/latest-mac.yml
```

芯片兼容关系：

- `arm64.dmg`：Apple Silicon Mac 使用，例如 M1/M2/M3/M4
- `x64.dmg`：Intel Mac 使用
- `x64.dmg` 通常也可以在 Apple Silicon 上通过 Rosetta 运行，但推荐 Apple Silicon 用户使用 `arm64.dmg`

### 6.2 只打某一个 macOS 架构

只打 Apple Silicon：

```bash
npx electron-builder --mac --arm64
```

只打 Intel：

```bash
npx electron-builder --mac --x64
```

### 6.3 打通用包

如果希望只发布一个同时兼容 Intel 和 Apple Silicon 的 dmg，可以打 universal 包：

```bash
npx electron-builder --mac --universal
```

也可以把 mac 配置改成：

```json
"mac": {
  "target": [
    {
      "target": "dmg",
      "arch": ["universal"]
    }
  ]
}
```

通用包优点是用户不用区分芯片；缺点是体积更大，打包耗时也可能更长。

### 6.4 macOS 签名与公证

未签名的 dmg 可以用于本机测试，但分发给其他用户时，macOS 可能提示无法验证开发者或阻止打开。

正式发布建议准备：

- Apple Developer 账号
- Developer ID Application 证书
- notarize 公证配置

如果只是内部测试，可以先发未签名包，但需要明确告知测试用户这是未签名版本。

## 7. 版本发布流程

每次发版建议按以下顺序执行。

### 7.1 修改版本号

在 `package.json` 中修改版本号：

```json
"version": "1.0.1"
```

版本号必须比线上版本高，否则 electron-updater 不会认为有新版本。

建议遵循语义化版本：

- 修 bug：`1.0.0` -> `1.0.1`
- 小功能：`1.0.0` -> `1.1.0`
- 大版本：`1.0.0` -> `2.0.0`

### 7.2 清理旧构建产物

可手动清理 `release/` 中旧产物，避免上传时混淆。

注意不要误删需要保留的历史发布包。

### 7.3 构建并打包

Windows：

```bash
npm run dist
```

macOS：

```bash
npm run build
npx electron-builder --mac
```

如果 Windows 和 macOS 都要发布，建议分别在对应系统执行打包，或者使用 CI 分平台构建。

### 7.4 本地检查产物

检查 `release/` 中是否有对应平台的安装包和更新元数据。

Windows 必须有：

```text
latest.yml
*.exe
*.exe.blockmap
```

macOS 必须有：

```text
latest-mac.yml
*.dmg
*.dmg.blockmap
```

如果缺少 `latest.yml` 或 `latest-mac.yml`，自动更新无法识别新版本。

## 8. 更新包怎么放

本项目使用 electron-updater 的 generic provider。也就是说，更新服务器本质上只需要提供静态文件访问。

当前默认更新根地址：

```text
https://1ms.ink/update/
```

发布时，把对应平台的安装包、blockmap 和 yml 元数据放到这个目录下，并保证文件可以直接通过 URL 访问。

### 8.1 Windows 更新文件

上传到更新根目录：

```text
https://1ms.ink/update/latest.yml
https://1ms.ink/update/OrbitSSH-1.0.1-Setup-x64.exe
https://1ms.ink/update/OrbitSSH-1.0.1-Setup-x64.exe.blockmap
```

`latest.yml` 内部会记录安装包文件名、sha512 和 size。不要手写 sha512，应该使用 electron-builder 生成的文件。

### 8.2 macOS 更新文件

上传到更新根目录：

```text
https://1ms.ink/update/latest-mac.yml
https://1ms.ink/update/OrbitSSH-1.0.1-Setup-arm64.dmg
https://1ms.ink/update/OrbitSSH-1.0.1-Setup-arm64.dmg.blockmap
https://1ms.ink/update/OrbitSSH-1.0.1-Setup-x64.dmg
https://1ms.ink/update/OrbitSSH-1.0.1-Setup-x64.dmg.blockmap
```

如果只发布单架构包，只上传对应架构的 dmg、blockmap 和 `latest-mac.yml` 即可。

如果发布 universal 包，通常上传：

```text
https://1ms.ink/update/latest-mac.yml
https://1ms.ink/update/OrbitSSH-1.0.1-Setup-universal.dmg
https://1ms.ink/update/OrbitSSH-1.0.1-Setup-universal.dmg.blockmap
```

### 8.3 文件必须同目录

`latest.yml` 和 `latest-mac.yml` 中的 `url` 通常是相对路径，例如：

```yaml
files:
  - url: OrbitSSH-1.0.1-Setup-x64.dmg
```

因此 yml 文件和安装包需要放在同一个更新目录下。否则应用能读到 yml，但下载不到安装包。

### 8.4 上传后检查 URL

上传完成后，在浏览器或命令行检查这些地址是否能访问：

```bash
curl -I https://1ms.ink/update/latest.yml
curl -I https://1ms.ink/update/latest-mac.yml
```

正常情况下应返回 `200`。

也建议检查安装包地址：

```bash
curl -I https://1ms.ink/update/OrbitSSH-1.0.1-Setup-x64.exe
curl -I https://1ms.ink/update/OrbitSSH-1.0.1-Setup-arm64.dmg
```

如果服务器返回 `403`、`404` 或跳转到登录页，自动更新会失败。

## 9. releaseNotes 和更新地址迁移

`src/main/update/index.ts` 支持从更新元数据中读取自定义字段。

### 9.1 添加 releaseNotes

可以在 `latest.yml` 或 `latest-mac.yml` 中追加：

```yaml
releaseNotes: |
  - 修复连接断开后重连异常
  - 优化 SFTP 文件列表刷新速度
```

应用内更新弹窗会读取并展示 releaseNotes，当前最多展示前 500 个字符。

### 9.2 迁移更新地址

如果未来更新服务器地址变化，可以在本次发布的 yml 中追加：

```yaml
newFeedUrl: https://new-domain.example.com/update/
```

应用发现新版本后会把 `newFeedUrl` 保存到本地设置中。后续检查更新会优先使用这个新地址。

注意：这只能影响已经成功读取到本次 yml 的用户。如果旧地址已经完全不可访问，用户就无法收到迁移信息。

## 10. 常见问题

### 10.1 打包出来的 macOS 包是通用包吗？

当前配置不是通用包，而是分别打 `arm64` 和 `x64` 两个 dmg。

```text
arm64：Apple Silicon
x64：Intel Mac
```

要打通用包，使用：

```bash
npx electron-builder --mac --universal
```

### 10.2 为什么更新检测不到新版本？

优先检查：

1. `package.json` 里的 `version` 是否真的升高了
2. 更新服务器上的 `latest.yml` 或 `latest-mac.yml` 是否已经替换成新版本
3. yml 中的安装包文件名是否和服务器上的文件名一致
4. 安装包和 blockmap 是否能通过 URL 直接访问
5. 应用是否使用了自定义更新地址
6. 当前运行的应用是否为打包版本，开发模式通常不适合作为自动更新验证环境

### 10.3 可以只上传安装包，不上传 yml 吗？

不可以。自动更新依赖 `latest.yml` 或 `latest-mac.yml` 判断版本、校验文件和下载地址。

### 10.4 可以手动修改 yml 里的 sha512 吗？

不建议。sha512 应由 electron-builder 自动生成。手动修改容易导致校验失败，应用会拒绝安装更新。

### 10.5 需要保留旧版本更新包吗？

普通更新只需要当前最新版本的 yml 和安装包即可。是否保留历史包取决于服务器空间和回滚策略。

建议至少本地或对象存储中归档每次正式发布产物，方便回滚和排查问题。

## 11. 推荐发布检查清单

发布前：

- [ ] 已更新 `package.json` 的 `version`
- [ ] 已执行 `npm install`
- [ ] `npm run build` 通过
- [ ] Windows 包已生成 `.exe`、`.exe.blockmap`、`latest.yml`
- [ ] macOS 包已生成 `.dmg`、`.dmg.blockmap`、`latest-mac.yml`
- [ ] 安装包文件名和 yml 中的 `url` 一致
- [ ] 更新服务器中的旧 yml 已替换为新 yml
- [ ] 所有更新文件都能通过 HTTPS 直接访问
- [ ] Windows 安装包已本地安装测试
- [ ] macOS dmg 已本地安装测试
- [ ] 应用内手动检查更新流程已验证

发布后：

- [ ] 下载链接可访问
- [ ] 自动更新能识别新版本
- [ ] 下载进度正常
- [ ] 更新安装后版本号正确
- [ ] 服务器保留本次发布产物备份
