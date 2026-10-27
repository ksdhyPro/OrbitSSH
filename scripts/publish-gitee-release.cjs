/* eslint-disable no-console */
// 只发布用户已手动打包的本地产物，安装包和校验信息一并上传。
const { createHash } = require("node:crypto");
const { createReadStream, openAsBlob } = require("node:fs");
const fs = require("node:fs/promises");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const output = path.join(root, "release", "gitee");
const api = "https://gitee.com/api/v5/repos/ksdhy/orbit-ssh";

async function digest(file, algorithm = "sha256") {
  const hash = createHash(algorithm);
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest("hex");
}

function git(args) {
  return execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
}

/** 只接收当前版本且与更新元数据一致的安装包，缺包时交回用户手动打包。 */
async function validateInstaller(projectRoot = root) {
  const pkg = JSON.parse(await fs.readFile(path.join(projectRoot, "package.json"), "utf8"));
  const installer = `${pkg.build.productName}-${pkg.version}-Setup-x64.exe`;
  const source = path.join(projectRoot, "release", installer);
  let info;
  let latest;
  try {
    info = await fs.stat(source);
    latest = await fs.readFile(path.join(projectRoot, "release", "latest.yml"), "utf8");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    throw new Error(
      `缺少 v${pkg.version} 的安装包或 latest.yml，请你亲自执行 npm run dist 打包，完成后再继续发布`,
    );
  }
  if (info.size < 1024 * 1024) throw new Error("安装包异常：文件不足 1 MiB，拒绝发布");
  const handle = await fs.open(source, "r");
  try {
    const header = Buffer.alloc(2);
    await handle.read(header, 0, 2, 0);
    if (header.toString("ascii") !== "MZ") throw new Error("安装包不是 Windows 可执行文件");
  } finally {
    await handle.close();
  }
  // 校验现有打包脚本生成的字段，禁止将旧版本更新文件与新安装包混用。
  const value = field => latest.match(new RegExp(`^${field}:\\s*([^\\r\\n]+)`, "m"))?.[1].trim();
  const size = Number(latest.match(/^\s+size:\s*(\d+)\s*$/m)?.[1]);
  const url = latest.match(/^\s+- url:\s*([^\r\n]+)$/m)?.[1].trim();
  const checksum = Buffer.from(await digest(source, "sha512"), "hex").toString("base64");
  if (
    value("version") !== pkg.version ||
    value("path") !== installer ||
    url !== installer ||
    size !== info.size ||
    value("sha512") !== checksum ||
    latest.match(/^\s+sha512:\s*([^\r\n]+)$/m)?.[1].trim() !== checksum
  ) {
    throw new Error(
      `v${pkg.version} 安装包与 latest.yml 不一致，请你亲自执行 npm run dist 重新打包，完成后再继续发布`,
    );
  }
  return { pkg, installer, source, info };
}

async function prepare(outputDir = output) {
  const { pkg, installer, source, info } = await validateInstaller();
  const commit = git(["rev-parse", "HEAD"]);
  const subject = git(["log", "-1", "--format=%s"]);
  const checksum = await digest(source);
  await fs.mkdir(outputDir, { recursive: true });
  await fs.copyFile(source, path.join(outputDir, installer));
  await fs.writeFile(path.join(outputDir, "SHA256SUMS.txt"), `${checksum}  ${installer}\n`, "utf8");
  const metadata = {
    version: pkg.version,
    installer,
    size: info.size,
    sha256: checksum,
    commit,
    subject,
  };
  await fs.writeFile(
    path.join(outputDir, "build.json"),
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

function requireToken() {
  const token = process.env.GITEE_RELEASE_TOKEN?.trim();
  if (!token)
    throw new Error("缺少环境变量 GITEE_RELEASE_TOKEN，请配置具有 projects 权限的 Gitee 令牌");
  return token;
}

/** 正式发行说明直接使用中文更新日志。 */
function createReleaseInfo(metadata, { notes = "" } = {}) {
  if (!/^\d+\.\d+\.\d+$/.test(metadata.version)) throw new Error("正式发行版本号无效");
  if (!notes.trim()) throw new Error("当前版本缺少更新说明");
  return {
    tag: `v${metadata.version}`,
    name: `OrbitSSH v${metadata.version}`,
    body: `${notes.trim()}\n\n源码提交：https://gitee.com/ksdhy/orbit-ssh/commit/${metadata.commit}\n\n下载 .exe 安装；SHA256SUMS.txt 用于校验下载完整性。`,
    prerelease: "false",
  };
}

function extractReleaseNotes(text, version) {
  const sections = [...text.matchAll(/^##\s+v([^\r\n]+)\r?\n([\s\S]*?)(?=^##\s|$(?![\s\S]))/gm)];
  const latest = sections[0];
  if (!latest || latest[1].trim() !== version || !latest[2].trim()) {
    throw new Error("软件版本号与最新更新日志不一致或缺少说明，请先同步版本并提交代码");
  }
  return latest[2].trim();
}

async function publish({ outputDir = output, request } = {}) {
  request ??= createClient(requireToken());
  const metadata = JSON.parse(await fs.readFile(path.join(outputDir, "build.json"), "utf8"));
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
  const installerPath = path.join(outputDir, metadata.installer);
  if (
    (await fs.stat(installerPath)).size !== metadata.size ||
    (await digest(installerPath)) !== metadata.sha256
  ) {
    throw new Error("安装包大小或 SHA256 校验失败");
  }
  // 一并检查校验清单，避免旧文件混入当前发行版。
  const sums = await fs.readFile(path.join(outputDir, "SHA256SUMS.txt"), "utf8");
  if (sums.trim() !== `${metadata.sha256}  ${metadata.installer}`) {
    throw new Error("SHA256 校验清单与安装包不一致，拒绝发布");
  }
  const notes = extractReleaseNotes(
    await fs.readFile(path.join(root, "docs", "update.md"), "utf8"),
    metadata.version,
  );
  const { tag, name, body, prerelease } = createReleaseInfo(metadata, { notes });
  let release = await request(`/releases/tags/${encodeURIComponent(tag)}`, { missingOK: true });
  if (release) throw new Error(`发行版 ${tag} 已存在，请检查 Gitee 发行记录；不会覆盖已有版本`);
  if (!release) {
    const form = new URLSearchParams({
      tag_name: tag,
      target_commitish: commit,
      name,
      body,
      prerelease,
    });
    release = await request("/releases", { method: "POST", body: form });
  }
  if (!Number.isInteger(release?.id)) throw new Error("Gitee 未返回有效的发行版 ID");
  const endpoint = `/releases/${release.id}/attach_files`;
  const files = [metadata.installer, "SHA256SUMS.txt", "build.json"];
  // 不删除或覆盖远程附件，避免发布脚本误改历史安装包。
  const existing = await request(`${endpoint}?per_page=100`);
  if (!Array.isArray(existing)) throw new Error("Gitee 附件列表格式异常");
  if (existing.length) throw new Error("该发行版已有附件，请检查远程发行记录；不会覆盖已有文件");
  for (const name of files) {
    const form = new FormData();
    // 使用文件 Blob 流式上传，避免将整个安装包读入内存。
    form.append("file", await openAsBlob(path.join(outputDir, name)), name);
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
  return releaseUrl;
}

async function runLocal({ uploadOnly = false } = {}) {
  // 优先提示缺少当前版本产物，绝不自动执行构建。
  await validateInstaller();
  requireToken();
  if (git(["status", "--porcelain"]).trim()) {
    throw new Error("工作区有未提交的改动，请先提交本次版本后再发布");
  }
  const pkg = JSON.parse(await fs.readFile(path.join(root, "package.json"), "utf8"));
  extractReleaseNotes(await fs.readFile(path.join(root, "docs", "update.md"), "utf8"), pkg.version);
  if (!uploadOnly) {
    await prepare();
  }
  await publish();
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const task = args.includes("--prepare")
    ? prepare()
    : runLocal({ uploadOnly: args.includes("--upload-only") });
  task.catch(error => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

module.exports = {
  createClient,
  digest,
  createReleaseInfo,
  extractReleaseNotes,
  publish,
  validateInstaller,
};
