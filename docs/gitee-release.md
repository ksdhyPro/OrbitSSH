# 版本发布流程

1. 用户提出发布版本时，先确认版本级别；用户已明确大、中、小版本时直接使用。更新 `docs/update.md`、`docs/update.en.md`，执行 `npm run version:sync`，提交并推送源码到 Gitee `origin/master`。
2. Agent 检查 `release/` 中是否有当前版本的 Windows x64 安装包和 `latest.yml`，核对版本、文件名、大小与 SHA512。缺少安装包或校验不一致时，提示用户亲自执行以下命令，等待用户回复打包完成后再继续；Agent 不执行打包命令，也不使用旧包替代。

   ```powershell
   npm run dist
   ```

3. 配置本机环境变量 `GITEE_RELEASE_TOKEN`，令牌需要 Gitee 仓库的 `projects` 权限。不要将令牌提交到代码或发送到聊天中，可在当前 PowerShell 会话中安全输入：

   ```powershell
   $giteeReleaseSecret = Read-Host '请输入 Gitee 发布令牌' -AsSecureString
   $env:GITEE_RELEASE_TOKEN = [Net.NetworkCredential]::new('', $giteeReleaseSecret).Password
   ```

4. 执行以下命令发布 Gitee 正式发行版。命令只校验、整理并上传已存在的安装包，不会打包：

   ```powershell
   npm run release:gitee
   ```

   - 产物整理到 `release/gitee/`，生成 `SHA256SUMS.txt` 和 `build.json`。
   - 使用当前版本 `v<版本号>` 标签、中文更新日志及当前提交创建正式 Release，上传 `.exe`、校验清单与构建信息，核对远程附件齐全。
   - `npm run release:gitee:upload` 仅上传已整理的 `release/gitee/` 产物，提交号或校验不匹配时停止。
   - 同版本发行版已存在或上传中断时先检查远程发行状态，不自动删除或覆盖已有发行版及附件。
5. Gitee Release 完成后，Agent 使用 OrbitSSH MCP 连接 `aliyun`，先检查 SSH、SFTP MCP 开关与连接列表，并确认更新目录 `/update/`。上传顺序如下：
   - 上传当前版本安装包，核对远端文件大小与 SHA256 和本地相同。
   - 备份服务器原 `latest.yml`，命名为 `latest.v<旧版本>.before-v<新版本>.yml`，已有备份不覆盖。
   - 上传当前版本 `latest.yml`，不得先于安装包完成；不删除历史安装包，不改动 nginx 配置。
   - 核对 `https://1ms.ink/update/` 下安装包返回 200、文件大小正确，且公网 `latest.yml` 与本地一致并指向新版本。
6. 报告版本号、源码提交、Gitee Release 和更新站下载链接；失败时保留完成状态，从失败步骤继续，不重复升版本。仓库已移除全部 GitHub Actions 与 Gitee 流水线配置，后续发版不依赖云端自动构建。
7. 发布完成后，可清理当前会话令牌：

   ```powershell
   Remove-Item Env:\GITEE_RELEASE_TOKEN
   Remove-Variable giteeReleaseSecret
   ```
