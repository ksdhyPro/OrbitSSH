/* eslint-disable no-console */
// 将 electron-builder 的 win-unpacked 交由自绘安装器封装。
const { createHash } = require("node:crypto");
const {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const projectRoot = path.resolve(__dirname, "..");
const packageJson = require(path.join(projectRoot, "package.json"));
const packagingRoot = path.join(projectRoot, "packaging", "windows");
const outputRoot = path.join(packagingRoot, "output");
// Electron 解压目录由构建阶段赋值，失败重试时会自动切换到新目录。
let unpackedRoot = "";
const releaseRoot = path.join(projectRoot, "release");
const skinRoot = path.join(packagingRoot, "skin");
const skinArchive = path.join(outputRoot, "skin.zip");
const appArchive = path.join(outputRoot, "orbitssh-app.7z");
const nsisExecutable = path.join(
  packagingRoot,
  "runtime",
  "nsis",
  "makensis.exe",
);
const sevenZipExecutable = path.join(packagingRoot, "runtime", "7z.exe");
const electronDistribution = path.join(
  projectRoot,
  "node_modules",
  "electron",
  "dist",
);
const installerScript = path.join(
  packagingRoot,
  "scripts",
  "orbitssh-installer.nsi",
);
const installerSkinAssetScript = path.join(
  projectRoot,
  "scripts",
  "build-installer-skin-assets.cjs",
);
const installerName = `${packageJson.build.productName}-${packageJson.version}-Setup-x64.exe`;
const installerPath = path.join(releaseRoot, installerName);

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: projectRoot,
    stdio: "inherit",
    shell:
      process.platform === "win32" && command.toLowerCase().endsWith(".cmd"),
    ...options,
  });
  if (result.error) throw result.error;
  if (result.status !== 0)
    throw new Error(
      `${path.basename(command)} 执行失败，退出码：${result.status}`,
    );
}

function sha512(filePath) {
  return createHash("sha512").update(readFileSync(filePath)).digest("base64");
}

function prepareDirectories() {
  mkdirSync(outputRoot, { recursive: true });
  mkdirSync(releaseRoot, { recursive: true });
  rmSync(skinArchive, { force: true });
  rmSync(appArchive, { force: true });
}

function buildUnpackedApplication() {
  // 仅生成应用目录，避免 electron-builder 再次输出默认 NSIS 安装器。
  const electronBuilder =
    process.platform === "win32"
      ? path.join(projectRoot, "node_modules", ".bin", "electron-builder.cmd")
      : path.join(projectRoot, "node_modules", ".bin", "electron-builder");
  const maxAttempts = 3;
  let lastError;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    // Windows 安全扫描可能短暂占用 Electron 的 .tmp 目录；每次重试使用全新目录。
    const attemptRoot = path.join(outputRoot, `stage-${Date.now()}-${attempt}`);
    try {
      run(electronBuilder, [
        "--win",
        "--x64",
        "--dir",
        `--config.directories.output=${attemptRoot}`,
        // 复用本地 Electron，避免下载解压临时目录被 Windows 占用。
        `--config.electronDist=${electronDistribution}`,
      ]);
      unpackedRoot = path.join(attemptRoot, "win-unpacked");
      return;
    } catch (error) {
      lastError = error;
      console.warn(`第 ${attempt} 次生成应用目录失败，正在更换临时目录重试。`);
    }
  }

  throw lastError;
}

function buildSkinArchive() {
  // 每次打包前同步 OrbitSSH 首页和高 DPI 图片，避免皮肤资源与应用品牌脱节。
  run(process.execPath, [installerSkinAssetScript]);
  // OrbitSSHSkin 按 skin.zip 加载 XML 与图片资源。
  run(sevenZipExecutable, ["a", "-tzip", "-mx=9", skinArchive, ".\\*"], {
    cwd: skinRoot,
  });
}

function buildApplicationArchive() {
  // 使用极限压缩控制发布体积，安装时仍由 7z 回调按真实解压量驱动进度条。
  run(
    sevenZipExecutable,
    ["a", "-t7z", "-mx=9", "-mmt=on", appArchive, ".\\*"],
    { cwd: unpackedRoot },
  );
}

function writeAppUpdateConfig() {
  const publishConfigs = Array.isArray(packageJson.build.publish)
    ? packageJson.build.publish
    : [packageJson.build.publish];
  const publishConfig = publishConfigs.find(
    (config) => config && typeof config === "object" && config.provider === "generic",
  );
  if (!publishConfig || typeof publishConfig.url !== "string" || !publishConfig.url.trim()) {
    throw new Error("缺少有效的 build.publish generic 更新地址");
  }

  const resourcesRoot = path.join(unpackedRoot, "resources");
  const appUpdatePath = path.join(resourcesRoot, "app-update.yml");
  const updaterCacheDirName = `${packageJson.name.toLowerCase()}-updater`;
  const appUpdateYml = [
    "provider: generic",
    `url: ${JSON.stringify(publishConfig.url.trim())}`,
    `updaterCacheDirName: ${updaterCacheDirName}`,
    "",
  ].join("\n");

  // --dir 不会生成更新配置，自绘安装器需要在压缩前主动补齐。
  mkdirSync(resourcesRoot, { recursive: true });
  writeFileSync(appUpdatePath, appUpdateYml, "utf8");
  if (!existsSync(appUpdatePath)) {
    throw new Error(`更新配置生成失败：${appUpdatePath}`);
  }
}

function verifyApplicationArchive() {
  // 构建完成后必须确认主程序和更新配置均已进入压缩包。
  const result = spawnSync(sevenZipExecutable, ["l", "-slt", appArchive], {
    cwd: projectRoot,
    encoding: "utf8",
    windowsHide: true,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`应用压缩包校验失败，退出码：${result.status}`);
  }

  const requiredEntries = [
    `Path = ${packageJson.build.productName}.exe`,
    "Path = resources\\app-update.yml",
  ];
  const missingEntry = requiredEntries.find((entry) => !result.stdout.includes(entry));
  if (missingEntry) {
    throw new Error(`应用压缩包缺少必要文件：${missingEntry.slice(7)}`);
  }
}

function buildInstaller() {
  run(nsisExecutable, [
    "/V3",
    `/DAPP_ARCHIVE=${appArchive}`,
    `/DSKIN_ARCHIVE=${skinArchive}`,
    `/DLICENSE_FILE=${path.join(projectRoot, "LICENSE")}`,
    `/DPRODUCT_NAME=${packageJson.build.productName}`,
    `/DPRODUCT_VERSION=${packageJson.version}`,
    `/DEXE_NAME=${packageJson.build.productName}.exe`,
    `/DINSTALLER_ICON=${path.join(packagingRoot, "assets", "orbitssh.ico")}`,
    `/DOUTPUT_FILE=${installerPath}`,
    installerScript,
  ]);
}

function writeLatestYml() {
  const size = readFileSync(installerPath).length;
  const checksum = sha512(installerPath);
  const releaseDate = new Date().toISOString();
  const latestYml = [
    `version: ${packageJson.version}`,
    "files:",
    `  - url: ${installerName}`,
    `    sha512: ${checksum}`,
    `    size: ${size}`,
    `path: ${installerName}`,
    `sha512: ${checksum}`,
    `releaseDate: '${releaseDate}'`,
    "",
  ].join("\n");
  writeFileSync(path.join(releaseRoot, "latest.yml"), latestYml, "utf8");
}

function main() {
  // 允许在安装包已生成后单独刷新更新元数据，避免重复构建应用目录。
  if (process.argv.includes("--write-latest-yml")) {
    if (!existsSync(installerPath))
      throw new Error(`缺少安装包：${installerPath}`);
    mkdirSync(releaseRoot, { recursive: true });
    writeLatestYml();
    console.log(`已刷新更新元数据：${path.join(releaseRoot, "latest.yml")}`);
    return;
  }

  for (const requiredPath of [
    nsisExecutable,
    sevenZipExecutable,
    electronDistribution,
    installerScript,
    installerSkinAssetScript,
    skinRoot,
  ]) {
    if (!existsSync(requiredPath))
      throw new Error(`缺少 Windows 安装器资源：${requiredPath}`);
  }
  prepareDirectories();
  buildUnpackedApplication();
  if (!existsSync(unpackedRoot))
    throw new Error(`应用目录生成失败：${unpackedRoot}`);
  writeAppUpdateConfig();
  buildApplicationArchive();
  verifyApplicationArchive();
  buildSkinArchive();
  buildInstaller();
  writeLatestYml();
  console.log(`已生成自绘安装器：${installerPath}`);
}

main();
