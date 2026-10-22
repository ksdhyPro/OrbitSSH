# Gitee 提交与 Windows 云端发行

1. 提交到 Gitee `ksdhy/orbit-ssh` 的 `master` 分支，由已有 Push 镜像自动同步到 GitHub `ksdhyPro/OrbitSSH`。
2. GitHub Actions 执行 `.github/workflows/windows-gitee-release.yml`，使用 Windows 2022、Node.js 22、锁定依赖和项目现有自绘安装器打包。
3. 构建完成后，安装包、SHA256 校验文件和构建信息保存在 Actions Artifacts，保留 14 天；发布任务将这三个文件上传到 Gitee 发行版。
4. 每次运行创建 `ci-v<软件版本>-<提交号>-<运行ID>-<重跑次数>` 独立预发行版，不修改软件版本号，不覆盖已有正式发行版。点击 Gitee 仓库的发行版可下载安装包，源码归档由发行版标签提供。
5. GitHub 仓库需要配置 `GITEE_RELEASE_TOKEN`：进入 Settings → Secrets and variables → Actions → New repository secret，值为具备 `projects` 权限、能够向 `ksdhy/orbit-ssh` 发布的 Gitee 私人令牌。令牌不要提交到代码或写入普通变量。
6. 本流程只回传 Gitee 发行版，不上传 `https://1ms.ink/update/`。提交同步失败时先检查 Gitee 管理 → 仓库镜像管理；打包失败时查看 GitHub Actions 构建日志；缺少令牌或上传失败时安装包仍保留在成功构建的 Artifacts 中。
7. 可在 GitHub Actions 页面选择“Windows 打包并发布到 Gitee”→ Run workflow，手动重跑当前 `master`。发布任务会核对产物的提交号、文件大小、SHA256 和远程附件是否齐全；失败时不会把整条流水线标记成功。
