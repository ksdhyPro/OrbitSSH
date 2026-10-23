# Windows 安装器

此目录集中管理 OrbitSSH 的 Windows 安装器资源与脚本。

- `assets/`：安装器图像与图标资源。
- `skin/`：nsNiuniuSkin 的 XML 页面及其图片资源。
- `runtime/`：NSIS 编译器和安装器插件等第三方运行库。
- `scripts/`：安装、卸载和打包脚本。
- `output/`：本地打包临时产物，不提交到仓库。

应用通用图标继续保留在 `build/`，避免影响 macOS 打包。
