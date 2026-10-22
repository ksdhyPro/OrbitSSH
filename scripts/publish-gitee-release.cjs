/* eslint-disable no-console */
// 云端发布只面向 Gitee 发行版，不上传应用的自动更新服务器。
const { createHash } = require("node:crypto");
const { createReadStream, openAsBlob } = require("node:fs");
const fs = require("node:fs/promises");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const output = path.join(root, "release", "ci");
const api = "https://gitee.com/api/v5/repos/ksdhy/orbit-ssh";

async function digest(file) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest("hex");
}

function git(args) {
  return execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
}

async function prepare() {
  const pkg = JSON.parse(await fs.readFile(path.join(root, "package.json"), "utf8"));
  const installer = `${pkg.build.productName}-${pkg.version}-Setup-x64.exe`;
  const source = path.join(root, "release", installer);
  const info = await fs.stat(source);
  if (info.size < 1024 * 1024) throw new Error("安装包异常：文件不足 1 MiB，拒绝发布");
  const handle = await fs.open(source, "r");
  try {
    const header = Buffer.alloc(2);
    await handle.read(header, 0, 2, 0);
    if (header.toString("ascii") !== "MZ") throw new Error("安装包不是 Windows 可执行文件");
  } finally {
    await handle.close();
  }
  const commit = git(["rev-parse", "HEAD"]);
  const subject = git(["log", "-1", "--format=%s"]);
  const checksum = await digest(source);
  await fs.mkdir(output, { recursive: true });
  await fs.copyFile(source, path.join(output, installer));
  await fs.writeFile(path.join(output, "SHA256SUMS.txt"), `${checksum}  ${installer}\n`, "utf8");
  const metadata = {
    version: pkg.version,
    installer,
    size: info.size,
    sha256: checksum,
    commit,
    subject,
  };
  await fs.writeFile(
    path.join(output, "build.json"),
    `${JSON.stringify(metadata, null, 2)}\n`,
    "utf8",
  );
  console.log(`已整理安装包：${installer}（${info.size} 字节）`);
}

function createClient(token, fetcher = fetch) {
  return async function request(endpoint, { method = "GET", body, missingOK = false } = {}) {
    const response = await fetcher(`${api}${endpoint}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      body,
      // 禁止在接口重定向时意外传递发布令牌。
      redirect: "error",
      signal: AbortSignal.timeout(method === "GET" ? 60_000 : 600_000),
    });
    if (missingOK && response.status === 404) return null;
    if (!response.ok) {
      // 不打印响应正文，避免服务端错误意外回显令牌。
      throw new Error(`Gitee ${method} ${endpoint} 失败：HTTP ${response.status}`);
    }
    return response.json();
  };
}

async function publish() {
  const token = process.env.GITEE_RELEASE_TOKEN?.trim();
  if (!token)
    throw new Error(
      "缺少 GitHub Actions Secret：GITEE_RELEASE_TOKEN，请配置具有 projects 权限的 Gitee 令牌",
    );
  const metadata = JSON.parse(await fs.readFile(path.join(output, "build.json"), "utf8"));
  const commit = git(["rev-parse", "HEAD"]);
  if (!/^[a-f0-9]{40}$/.test(metadata.commit) || metadata.commit !== commit) {
    throw new Error("构建产物与当前提交不一致，拒绝发布");
  }
  if (
    path.basename(metadata.installer) !== metadata.installer ||
    !metadata.installer.endsWith(".exe")
  ) {
    throw new Error("安装包文件名无效");
  }
  const installerPath = path.join(output, metadata.installer);
  if (
    (await fs.stat(installerPath)).size !== metadata.size ||
    (await digest(installerPath)) !== metadata.sha256
  ) {
    throw new Error("安装包大小或 SHA256 校验失败");
  }
  const run = process.env.GITHUB_RUN_ID;
  const attempt = process.env.GITHUB_RUN_ATTEMPT;
  if (!/^\d+$/.test(run || "") || !/^\d+$/.test(attempt || "")) {
    throw new Error("缺少有效的 GitHub Actions 运行标识");
  }
  // 每次运行使用独立标签；重跑也不会覆盖已有正式版本和附件。
  const tag = `ci-v${metadata.version}-${commit.slice(0, 12)}-${run}-${attempt}`;
  const runUrl = `https://github.com/ksdhyPro/OrbitSSH/actions/runs/${run}`;
  const request = createClient(token);
  let release = await request(`/releases/tags/${encodeURIComponent(tag)}`, { missingOK: true });
  if (!release) {
    const form = new URLSearchParams({
      tag_name: tag,
      target_commitish: commit,
      name: `OrbitSSH v${metadata.version} · ${commit.slice(0, 12)}`,
      body: [
        "1. Windows x64 自动构建安装包，沿用 OrbitSSH 自绘安装器。",
        `2. 本次提交：${metadata.subject}`,
        `3. 源码提交：https://gitee.com/ksdhy/orbit-ssh/commit/${commit}`,
        `4. 构建记录：${runUrl}`,
        "5. 下载 .exe 安装；SHA256SUMS.txt 用于校验下载完整性。",
      ].join("\n"),
      prerelease: "true",
    });
    release = await request("/releases", { method: "POST", body: form });
  }
  if (!Number.isInteger(release?.id)) throw new Error("Gitee 未返回有效的发行版 ID");
  const endpoint = `/releases/${release.id}/attach_files`;
  const files = [metadata.installer, "SHA256SUMS.txt", "build.json"];
  // 不删除或覆盖远程附件，避免发布脚本误改历史安装包。
  const existing = await request(`${endpoint}?per_page=100`);
  if (!Array.isArray(existing)) throw new Error("Gitee 附件列表格式异常");
  if (existing.length)
    throw new Error("该次构建的发行版已有附件，请从 Actions 重新运行以生成独立发行版");
  for (const name of files) {
    const form = new FormData();
    // 使用文件 Blob 流式上传，避免将整个安装包读入内存。
    form.append("file", await openAsBlob(path.join(output, name)), name);
    await request(endpoint, { method: "POST", body: form });
    console.log(`已上传：${name}`);
  }
  const attachments = await request(`${endpoint}?per_page=100`);
  if (
    !Array.isArray(attachments) ||
    files.some(name => !attachments.some(file => file.name === name))
  ) {
    throw new Error("发行版附件不完整，请检查 Gitee 上传记录");
  }
  const releaseUrl = `https://gitee.com/ksdhy/orbit-ssh/releases/tag/${tag}`;
  console.log(`Gitee 发行版：${releaseUrl}`);
  if (process.env.GITHUB_STEP_SUMMARY) {
    await fs.appendFile(
      process.env.GITHUB_STEP_SUMMARY,
      `1. [Gitee 发行版与安装包](${releaseUrl})\n2. 安装包：${metadata.installer}\n3. SHA256：\`${metadata.sha256}\`\n`,
      "utf8",
    );
  }
}

if (require.main === module) {
  (process.argv.includes("--prepare") ? prepare() : publish()).catch(error => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

module.exports = { createClient, digest };
