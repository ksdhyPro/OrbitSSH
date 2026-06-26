/**
 * 基于 build/logo.png 生成：
 * 1. 多分辨率 ICO 文件 → build/icon.ico
 * 2. 各分辨率独立 PNG   → build/icons/{size}.png
 */

const sharp = require("sharp");
const fs = require("fs");
const path = require("path");

const BUILD_DIR = path.join(__dirname, "..", "build");
const SOURCE = path.join(BUILD_DIR, "logo.png");
const ICO_OUT = path.join(BUILD_DIR, "icon.ico");
const ICONS_DIR = path.join(BUILD_DIR, "icons");

// ICO 需要的尺寸 + 额外输出的小/大尺寸 PNG
const ICO_SIZES = [256, 128, 64, 48, 32, 16];
const EXTRA_PNG_SIZES = [1024, 512]; // 高分辨率，用于各种场合

// ---------- 组装 ICO ----------

/**
 * PNG-in-ICO 格式结构：
 * - 6 byte 头部（reserved + type + count）
 * - 16 byte × count 目录项
 * - 各 PNG 数据块
 */
function buildIco(pngs) {
  const count = pngs.length;
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(count, 4);

  const dirEntries = [];
  let dataOffset = 6 + 16 * count;

  for (const { size, data } of pngs) {
    const entry = Buffer.alloc(16);
    const w = size >= 256 ? 0 : size;
    entry.writeUInt8(w, 0);
    entry.writeUInt8(w, 1);
    entry.writeUInt8(0, 2);
    entry.writeUInt8(0, 3);
    entry.writeUInt16LE(1, 4);
    entry.writeUInt16LE(32, 6);
    entry.writeUInt32LE(data.length, 8);
    entry.writeUInt32LE(dataOffset, 12);
    dirEntries.push(entry);
    dataOffset += data.length;
  }

  return Buffer.concat([header, ...dirEntries, ...pngs.map((p) => p.data)]);
}

// ---------- 主流程 ----------

async function main() {
  if (!fs.existsSync(SOURCE)) {
    console.error(`❌ 源文件不存在: ${SOURCE}`);
    process.exit(1);
  }

  fs.mkdirSync(ICONS_DIR, { recursive: true });

  const allSizes = [...new Set([...EXTRA_PNG_SIZES, ...ICO_SIZES])].sort(
    (a, b) => b - a,
  );

  // ----- 1. 生成各分辨率 PNG（直接输出到 icons/）-----
  const icoPngs = [];
  console.log("Generating PNGs from logo.png:\n");

  for (const size of allSizes) {
    const buf = await sharp(SOURCE).resize(size, size).png().toBuffer();
    const pngPath = path.join(ICONS_DIR, `${size}x${size}.png`);
    fs.writeFileSync(pngPath, buf);
    console.log(`  ${size}x${size}.png  (${(buf.length / 1024).toFixed(1)} KB)`);

    // 记录 ICO 需要的尺寸
    if (ICO_SIZES.includes(size)) {
      icoPngs.push({ size, data: buf });
    }
  }

  // ----- 2. 生成 ICO -----
  const icoBuf = buildIco(icoPngs);
  fs.writeFileSync(ICO_OUT, icoBuf);
  console.log(
    `\n✓ ${ICO_OUT}  (${(icoBuf.length / 1024).toFixed(1)} KB, ${ICO_SIZES.length} sizes)`,
  );
  console.log(
    `✓ ${ICONS_DIR}/  (${allSizes.length} individual PNGs)`,
  );
}

main().catch((e) => {
  console.error("Icon generation failed:", e);
  process.exit(1);
});
