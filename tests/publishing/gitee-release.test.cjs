const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  createClient,
  createReleaseInfo,
  extractReleaseNotes,
  publish,
  digest,
  validateInstaller,
} = require("../../scripts/publish-gitee-release.cjs");
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const { execFileSync } = require("node:child_process");

test("仅将发布令牌放入请求头并拒绝接口重定向", async () => {
  const request = createClient("test-secret", async (url, options) => {
    assert.equal(url, "https://gitee.com/api/v5/repos/ksdhy/orbit-ssh/releases");
    assert.equal(options.headers.Authorization, "Bearer test-secret");
    assert.equal(options.redirect, "error");
    assert.ok(options.signal instanceof AbortSignal);
    return new Response(JSON.stringify({ id: 123 }), { status: 200 });
  });
  assert.deepEqual(await request("/releases"), { id: 123 });
});

test("首次发布允许发行版不存在，但权限错误必须终止", async () => {
  const missing = createClient("test-secret", async () => new Response(null, { status: 404 }));
  assert.equal(await missing("/releases/tags/v1.10.16", { missingOK: true }), null);
  const forbidden = createClient(
    "test-secret",
    async () => new Response("test-secret", { status: 403 }),
  );
  await assert.rejects(forbidden("/releases", { missingOK: true }), error => {
    assert.match(error.message, /HTTP 403/);
    assert.doesNotMatch(error.message, /test-secret/);
    return true;
  });
});

test("上传超限和服务异常不能被当作发布成功", async () => {
  for (const status of [413, 429, 500]) {
    const request = createClient("test-secret", async () => new Response(null, { status }));
    await assert.rejects(
      request("/releases/123/attach_files", { method: "POST", body: new FormData() }),
      new RegExp(`HTTP ${status}`),
    );
  }
});

test("服务端非 JSON 响应不能被当作发布成功", async () => {
  const request = createClient(
    "test-secret",
    async () => new Response("<html>error</html>", { status: 200 }),
  );
  await assert.rejects(request("/releases"), SyntaxError);
});

test("正式发行只使用版本标签和更新说明", () => {
  const metadata = { version: "1.10.16", commit: "a".repeat(40), subject: "修复 DeepSeek" };
  const local = createReleaseInfo(metadata, { notes: "1. 修复对话。" });
  assert.equal(local.tag, "v1.10.16");
  assert.equal(local.prerelease, "false");
  assert.match(local.body, /修复对话/);
  assert.doesNotMatch(local.body, /github.com/);
  assert.throws(() => createReleaseInfo(metadata), /缺少更新说明/);
});

test("只提取最新版本的更新说明，拒绝版本不一致及空说明", () => {
  const text =
    "# 更新日志\r\n\r\n## v1.10.16\r\n\r\n1. 修复对话。\r\n\r\n## v1.10.15\r\n\r\n1. 旧说明。\r\n";
  assert.equal(extractReleaseNotes(text, "1.10.16"), "1. 修复对话。");
  assert.equal(extractReleaseNotes("## v1.10.16\n\n1. 修复。", "1.10.16"), "1. 修复。");
  assert.throws(() => extractReleaseNotes(text, "1.10.15"), /不一致/);
  assert.throws(() => extractReleaseNotes("## v1.10.16\n\n", "1.10.16"), /缺少说明/);
});

test("缺少当前版本安装包时明确提示用户亲自打包", async t => {
  const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), "orbitssh-missing-installer-"));
  t.after(() => fs.rm(projectRoot, { recursive: true, force: true }));
  await fs.writeFile(
    path.join(projectRoot, "package.json"),
    JSON.stringify({ version: "1.10.17", build: { productName: "OrbitSSH" } }),
  );
  await assert.rejects(validateInstaller(projectRoot), /缺少 v1.10.17.*亲自执行 npm run dist/);
});

test("现有安装包必须与当前版本及 latest.yml 的哈希和大小一致", async t => {
  const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), "orbitssh-installer-check-"));
  t.after(() => fs.rm(projectRoot, { recursive: true, force: true }));
  await fs.writeFile(
    path.join(projectRoot, "package.json"),
    JSON.stringify({ version: "1.10.17", build: { productName: "OrbitSSH" } }),
  );
  await fs.mkdir(path.join(projectRoot, "release"));
  const installer = "OrbitSSH-1.10.17-Setup-x64.exe";
  const source = path.join(projectRoot, "release", installer);
  const content = Buffer.alloc(1024 * 1024);
  content.write("MZ");
  await fs.writeFile(source, content);
  const checksum = Buffer.from(await digest(source, "sha512"), "hex").toString("base64");
  const latest = `version: 1.10.17\nfiles:\n  - url: ${installer}\n    sha512: ${checksum}\n    size: ${content.length}\npath: ${installer}\nsha512: ${checksum}\n`;
  const latestPath = path.join(projectRoot, "release", "latest.yml");
  await fs.writeFile(latestPath, latest);
  assert.equal((await validateInstaller(projectRoot)).installer, installer);
  for (const invalid of [
    latest.replace("version: 1.10.17", "version: 1.10.16"),
    latest.replace(`size: ${content.length}`, "size: 1"),
    latest.replaceAll(checksum, "invalid"),
  ]) {
    await fs.writeFile(latestPath, invalid);
    await assert.rejects(validateInstaller(projectRoot), /亲自执行 npm run dist 重新打包/);
  }
});

async function createFixture(t) {
  const outputDir = await fs.mkdtemp(path.join(os.tmpdir(), "orbitssh-release-"));
  t.after(() => fs.rm(outputDir, { recursive: true, force: true }));
  const version = require("../../package.json").version;
  const installer = `OrbitSSH-${version}-Setup-x64.exe`;
  const installerPath = path.join(outputDir, installer);
  await fs.writeFile(installerPath, "MZfixture");
  const metadata = {
    version,
    installer,
    size: 9,
    sha256: await digest(installerPath),
    commit: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
    subject: "发布测试",
  };
  await fs.writeFile(path.join(outputDir, "build.json"), JSON.stringify(metadata));
  await fs.writeFile(path.join(outputDir, "SHA256SUMS.txt"), `${metadata.sha256}  ${installer}\n`);
  return { outputDir, metadata };
}

test("本地发布创建正式发行并上传三个附件，核对完成后返回链接", async t => {
  const { outputDir, metadata } = await createFixture(t);
  const attachments = [];
  let created = false;
  const url = await publish({
    outputDir,
    request: async (endpoint, options = {}) => {
      if (endpoint.startsWith("/releases/tags/")) return null;
      if (endpoint === "/releases") {
        created = true;
        assert.equal(options.body.get("tag_name"), `v${metadata.version}`);
        assert.equal(options.body.get("target_commitish"), metadata.commit);
        assert.equal(options.body.get("prerelease"), "false");
        return { id: 123 };
      }
      assert.equal(created, true);
      if (options.method === "POST") {
        attachments.push({ name: options.body.get("file").name });
        return {};
      }
      return [...attachments];
    },
  });
  assert.equal(url, `https://gitee.com/ksdhy/orbit-ssh/releases/tag/v${metadata.version}`);
  assert.deepEqual(
    attachments.map(file => file.name),
    [metadata.installer, "SHA256SUMS.txt", "build.json"],
  );
});

test("已有正式发行停止发布，不覆盖附件", async t => {
  const { outputDir } = await createFixture(t);
  let requests = 0;
  await assert.rejects(
    publish({
      outputDir,
      request: async () => {
        requests++;
        return { id: 123 };
      },
    }),
    /已存在/,
  );
  assert.equal(requests, 1);
});

test("安装包被修改或校验清单过期时在远程写入前终止", async t => {
  const { outputDir, metadata } = await createFixture(t);
  const request = async () => assert.fail("不应发送远程请求");
  await fs.writeFile(path.join(outputDir, "SHA256SUMS.txt"), "stale");
  await assert.rejects(publish({ outputDir, request }), /校验清单/);
  await fs.writeFile(path.join(outputDir, metadata.installer), "MZchanged");
  await assert.rejects(publish({ outputDir, request }), /SHA256 校验失败/);
});

test("上传中断和远程附件缺失不会报告发布成功", async t => {
  const { outputDir } = await createFixture(t);
  for (const failUpload of [true, false]) {
    await assert.rejects(
      publish({
        outputDir,
        request: async (endpoint, options = {}) => {
          if (endpoint.startsWith("/releases/tags/")) return null;
          if (endpoint === "/releases") return { id: 123 };
          if (failUpload && options.method === "POST") throw new Error("模拟上传中断");
          return [];
        },
      }),
      failUpload ? /上传中断/ : /附件不完整/,
    );
  }
});
