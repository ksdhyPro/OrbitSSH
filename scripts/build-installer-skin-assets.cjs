/* eslint-disable no-console */
// 生成 OrbitSSH 首页图片与高 DPI 图片资源。
const { existsSync, readdirSync } = require("node:fs");
const path = require("node:path");
const sharp = require("sharp");

const projectRoot = path.resolve(__dirname, "..");
const skinRoot = path.join(projectRoot, "packaging", "windows", "skin");
const heroPath = path.join(skinRoot, "form", "pic.png");
const logoPath = path.join(projectRoot, "build", "logo.png");
const dpiScales = [1.5, 2];
const buttonDefinitions = [
  {
    width: 290,
    height: 40,
    files: {
      normal: "btn_installation_normal.png",
      hovered: "btn_installation_hovered.png",
      pressed: "btn_installation_pressed.png",
      disabled: "btn_installation_disable.png",
    },
  },
  {
    width: 160,
    height: 50,
    files: {
      normal: "btn_finish_normal.png",
      hovered: "btn_finish_hovered.png",
      pressed: "btn_finish_pressed.png",
    },
  },
];
const buttonStates = {
  normal: { top: "#000000", bottom: "#000000", border: "#3a3a3a" },
  hovered: { top: "#000000", bottom: "#000000", border: "#8a8a8a" },
  pressed: { top: "#000000", bottom: "#000000", border: "#606060" },
  disabled: { top: "#000000", bottom: "#000000", border: "#242424" },
};
const directoryButtonFiles = {
  normal: "btn_path_normal.png",
  hovered: "btn_path_hovered.png",
  pressed: "btn_path_pressed.png",
};
const checkboxFiles = {
  unchecked: "check_no.png",
  checked: "check_yes.png",
};

function escapeXml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

async function buildHero(scale, outputPath) {
  const width = Math.round(480 * scale);
  const height = Math.round(250 * scale);
  const logoSize = Math.round(112 * scale);
  const logoLeft = Math.round((width - logoSize) / 2);
  const logoTop = Math.round(80 * scale);
  const title = escapeXml("OrbitSSH 安装");
  const subtitle = escapeXml("安全、专注的 SSH 连接体验");

  // 保持 temp 模板的画布尺寸，首页背景统一使用纯黑色。
  const background = Buffer.from(`
    <svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
      <rect width="${width}" height="${height}" fill="#000000" />
      <text x="${Math.round(16 * scale)}" y="${Math.round(25 * scale)}" fill="#f5f5f7" font-family="Microsoft YaHei UI, Segoe UI, sans-serif" font-size="${Math.round(14 * scale)}" font-weight="600">${title}</text>
      <text x="${Math.round(16 * scale)}" y="${Math.round(45 * scale)}" fill="#a9a9af" font-family="Microsoft YaHei UI, Segoe UI, sans-serif" font-size="${Math.round(10 * scale)}">${subtitle}</text>
    </svg>
  `);

  const logo = await sharp(logoPath)
    .resize(logoSize, logoSize, { fit: "cover" })
    .png()
    .toBuffer();

  await sharp(background)
    .composite([{ input: logo, left: logoLeft, top: logoTop }])
    .png({ compressionLevel: 9 })
    .toFile(outputPath);
}

async function buildButton(width, height, state, scale, outputPath) {
  const targetWidth = Math.round(width * scale);
  const targetHeight = Math.round(height * scale);
  const radius = Math.round(4 * scale);
  const borderWidth = Math.max(1, Math.round(scale));
  const colors = buttonStates[state];
  const image = Buffer.from(`
    <svg width="${targetWidth}" height="${targetHeight}" viewBox="0 0 ${targetWidth} ${targetHeight}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="button" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="${colors.top}" />
          <stop offset="1" stop-color="${colors.bottom}" />
        </linearGradient>
      </defs>
      <rect x="${borderWidth / 2}" y="${borderWidth / 2}" width="${targetWidth - borderWidth}" height="${targetHeight - borderWidth}" rx="${radius}" fill="url(#button)" stroke="${colors.border}" stroke-width="${borderWidth}" />
    </svg>
  `);
  await sharp(image).png({ compressionLevel: 9 }).toFile(outputPath);
}

async function buildDirectoryButton(state, scale, outputPath) {
  const width = Math.round(40 * scale);
  const height = Math.round(32 * scale);
  const borderWidth = Math.max(1, Math.round(scale));
  const border = buttonStates[state].border;
  const image = Buffer.from(`
    <svg width="${width}" height="${height}" viewBox="0 0 40 32" xmlns="http://www.w3.org/2000/svg">
      <rect x="${borderWidth / (2 * scale)}" y="${borderWidth / (2 * scale)}" width="${40 - borderWidth / scale}" height="${32 - borderWidth / scale}" rx="2" fill="#000000" stroke="${border}" stroke-width="${borderWidth / scale}" />
      <path d="M13 11.5h5l1.8 2H27v8.5H13z" fill="none" stroke="#ffffff" stroke-width="1.6" stroke-linejoin="round" />
    </svg>
  `);
  await sharp(image).png({ compressionLevel: 9 }).toFile(outputPath);
}

async function buildCheckbox(checked, scale, outputPath) {
  const size = Math.round(16 * scale);
  const image = Buffer.from(`
    <svg width="${size}" height="${size}" viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg">
      <rect x="0.75" y="0.75" width="14.5" height="14.5" rx="1.5" fill="${checked ? "#000000" : "#ffffff"}" stroke="#000000" stroke-width="1.5" />
      ${checked ? '<path d="M4 8.2 6.7 11 12.2 5.2" fill="none" stroke="#ffffff" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" />' : ""}
    </svg>
  `);
  await sharp(image).png({ compressionLevel: 9 }).toFile(outputPath);
}

async function buildButtons() {
  const directDpiSources = new Set();
  for (const definition of buttonDefinitions) {
    for (const [state, fileName] of Object.entries(definition.files)) {
      const sourcePath = path.join(skinRoot, "form", fileName);
      directDpiSources.add(sourcePath);
      await buildButton(
        definition.width,
        definition.height,
        state,
        1,
        sourcePath,
      );
      for (const scale of dpiScales) {
        await buildButton(
          definition.width,
          definition.height,
          state,
          scale,
          dpiOutputPath(sourcePath, scale),
        );
      }
    }
  }

  for (const [state, fileName] of Object.entries(directoryButtonFiles)) {
    const sourcePath = path.join(skinRoot, "form", fileName);
    directDpiSources.add(sourcePath);
    await buildDirectoryButton(state, 1, sourcePath);
    for (const scale of dpiScales) {
      await buildDirectoryButton(
        state,
        scale,
        dpiOutputPath(sourcePath, scale),
      );
    }
  }

  for (const [state, fileName] of Object.entries(checkboxFiles)) {
    const sourcePath = path.join(skinRoot, "public", "checkbox", fileName);
    const checked = state === "checked";
    directDpiSources.add(sourcePath);
    await buildCheckbox(checked, 1, sourcePath);
    for (const scale of dpiScales) {
      await buildCheckbox(checked, scale, dpiOutputPath(sourcePath, scale));
    }
  }
  return directDpiSources;
}

function collectBasePngFiles(directory) {
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectBasePngFiles(absolutePath));
      continue;
    }
    if (
      entry.isFile() &&
      entry.name.toLowerCase().endsWith(".png") &&
      !/@(?:1\.5|2)x\.png$/i.test(entry.name)
    ) {
      files.push(absolutePath);
    }
  }
  return files;
}

function dpiOutputPath(sourcePath, scale) {
  const extension = path.extname(sourcePath);
  return `${sourcePath.slice(0, -extension.length)}@${scale}x${extension}`;
}

async function buildDpiVariants(sourcePath) {
  const metadata = await sharp(sourcePath).metadata();
  if (!metadata.width || !metadata.height) {
    throw new Error(`无法读取安装器图片尺寸：${sourcePath}`);
  }

  for (const scale of dpiScales) {
    const targetPath = dpiOutputPath(sourcePath, scale);
    // 使用高质量插值生成插件约定的 DPI 资源，避免交由系统二次模糊缩放。
    await sharp(sourcePath)
      .resize(
        Math.round(metadata.width * scale),
        Math.round(metadata.height * scale),
        {
          kernel: sharp.kernel.lanczos3,
        },
      )
      .png({ compressionLevel: 9 })
      .toFile(targetPath);
  }
}

async function main() {
  for (const requiredPath of [skinRoot, logoPath]) {
    if (!existsSync(requiredPath))
      throw new Error(`缺少安装器资源：${requiredPath}`);
  }

  await buildHero(1, heroPath);
  for (const scale of dpiScales) {
    await buildHero(scale, dpiOutputPath(heroPath, scale));
  }
  const directDpiSources = await buildButtons();
  directDpiSources.add(heroPath);
  const basePngFiles = collectBasePngFiles(skinRoot);
  for (const sourcePath of basePngFiles) {
    // 首页和按钮直接按目标 DPI 绘制，避免先缩小再放大。
    if (directDpiSources.has(sourcePath)) continue;
    await buildDpiVariants(sourcePath);
  }
  console.log(
    `已生成安装器首页及 ${basePngFiles.length * dpiScales.length} 个高 DPI 图片资源。`,
  );
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
