/* eslint-disable no-console */
const { execFileSync } = require("node:child_process");
const { mkdirSync, writeFileSync } = require("node:fs");
const path = require("node:path");

const projectRoot = path.resolve(__dirname, "..");
const outputPath = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.join(projectRoot, "dist-electron", "build-info.json");

function readGitValue(args, label) {
  try {
    const value = execFileSync("git", args, {
      cwd: projectRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();

    if (!value) {
      throw new Error(`${label}为空`);
    }

    return value;
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`读取${label}失败：${reason}`);
  }
}

function main() {
  // 构建时固化 Git 元数据，正式包无需依赖用户电脑安装 Git 或携带 .git 目录。
  const buildInfo = {
    commit: readGitValue(["rev-parse", "--short", "HEAD"], "提交版本"),
    commitDate: readGitValue(["log", "-1", "--format=%cs"], "提交日期"),
  };

  mkdirSync(path.dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, `${JSON.stringify(buildInfo, null, 2)}\n`, "utf8");
  console.log(`已生成构建元数据：${outputPath}`);
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
