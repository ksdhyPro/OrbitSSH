const fs = require("node:fs");
const path = require("node:path");

const rootDir = path.resolve(__dirname, "..");
const updatePath = path.join(rootDir, "docs", "update.md");
const packagePath = path.join(rootDir, "package.json");
const lockPath = path.join(rootDir, "package-lock.json");

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

const updateText = fs.readFileSync(updatePath, "utf8");
const versionMatch = updateText.match(/^##\s+v(\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?)\s*$/m);

if (!versionMatch) {
  throw new Error("未在 docs/update.md 中找到形如 `## v1.0.1` 的版本标题");
}

const nextVersion = versionMatch[1];
const packageJson = readJson(packagePath);
const lockJson = readJson(lockPath);
const previousVersion = packageJson.version;

packageJson.version = nextVersion;
lockJson.version = nextVersion;

if (lockJson.packages?.[""]) {
  lockJson.packages[""].version = nextVersion;
}

writeJson(packagePath, packageJson);
writeJson(lockPath, lockJson);

if (previousVersion === nextVersion) {
  console.log(`版本号已是 ${nextVersion}`);
} else {
  console.log(`版本号已从 ${previousVersion} 同步为 ${nextVersion}`);
}
