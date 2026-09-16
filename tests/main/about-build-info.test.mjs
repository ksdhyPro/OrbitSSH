import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const projectRoot = fileURLToPath(new URL("../../", import.meta.url));
const generatorPath = fileURLToPath(
  new URL("../../scripts/generate-build-info.cjs", import.meta.url),
);
const aboutIpcUrl = new URL("../../src/main/ipc/about-ipc.ts", import.meta.url);
const packageUrl = new URL("../../package.json", import.meta.url);

test("构建阶段生成可供正式包读取的提交元数据", async () => {
  const temporaryDirectory = await mkdtemp(path.join(tmpdir(), "orbitssh-build-info-"));
  const outputPath = path.join(temporaryDirectory, "build-info.json");

  try {
    execFileSync(process.execPath, [generatorPath, outputPath], {
      cwd: projectRoot,
      stdio: "pipe",
    });

    const buildInfo = JSON.parse(await readFile(outputPath, "utf8"));
    const expectedCommit = execFileSync(
      "git",
      ["rev-parse", "--short", "HEAD"],
      { cwd: projectRoot, encoding: "utf8" },
    ).trim();
    const expectedCommitDate = execFileSync(
      "git",
      ["log", "-1", "--format=%cs"],
      { cwd: projectRoot, encoding: "utf8" },
    ).trim();

    assert.equal(buildInfo.commit, expectedCommit);
    assert.equal(buildInfo.commitDate, expectedCommitDate);
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
});

test("关于窗口在正式环境读取内置元数据并保留开发环境 Git 回退", async () => {
  const source = await readFile(aboutIpcUrl, "utf8");

  assert.match(source, /app\.isPackaged/);
  assert.match(source, /build-info\.json/);
  assert.match(source, /readGitValue/);
});

test("正式构建在 Electron 编译后生成提交元数据", async () => {
  const packageJson = JSON.parse(await readFile(packageUrl, "utf8"));

  assert.match(
    packageJson.scripts.build,
    /tsc -p tsconfig\.electron\.json && node scripts\/generate-build-info\.cjs/,
  );
});
