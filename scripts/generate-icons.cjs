/**
 * 基于 build/logo.png 生成：
 * 1. 多分辨率 ICO 文件 → build/icon.ico
 * 2. 各分辨率独立 PNG   → build/icons/{size}.png
 * 3. macOS ICNS 文件    → build/icon.icns
 */

const sharp = require("sharp");
const fs = require("fs");
const path = require("path");

const BUILD_DIR = path.join(__dirname, "..", "build");
const SOURCE = path.join(BUILD_DIR, "logo.png");
const ICO_OUT = path.join(BUILD_DIR, "icon.ico");
const ICNS_OUT = path.join(BUILD_DIR, "icon.icns");
const ICONS_DIR = path.join(BUILD_DIR, "icons");

// ICO 需要的尺寸 + 额外输出的小/大尺寸 PNG
const ICO_SIZES = [256, 128, 64, 48, 32, 16];
const EXTRA_PNG_SIZES = [1024, 512]; // 高分辨率，用于各种场合
const ICNS_SIZES = [
  { type: "icp4", size: 16 },
  { type: "icp5", size: 32 },
  { type: "icp6", size: 64 },
  { type: "ic07", size: 128 },
  { type: "ic08", size: 256 },
  { type: "ic09", size: 512 },
  { type: "ic10", size: 1024 },
];

function createRoundedMask(size) {
  const radius = Math.round(size * 0.224);

  return Buffer.from(
    `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" xmlns="http://www.w3.org/2000/svg">
      <rect width="${size}" height="${size}" rx="${radius}" ry="${radius}" fill="#fff"/>
    </svg>`,
  );
}

async function createRoundedPng(size) {
  return sharp(SOURCE)
    .resize(size, size, { fit: "cover" })
    .ensureAlpha()
    .composite([
      {
        input: createRoundedMask(size),
        blend: "dest-in",
      },
    ])
    .png()
    .toBuffer();
}

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

function buildIcns(pngs) {
  const chunks = pngs.map(({ type, data }) => {
    const chunk = Buffer.alloc(8 + data.length);
    chunk.write(type, 0, 4, "ascii");
    chunk.writeUInt32BE(chunk.length, 4);
    data.copy(chunk, 8);
    return chunk;
  });
  const totalLength = 8 + chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const header = Buffer.alloc(8);
  header.write("icns", 0, 4, "ascii");
  header.writeUInt32BE(totalLength, 4);

  return Buffer.concat([header, ...chunks], totalLength);
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
    const buf = await createRoundedPng(size);
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

  // ----- 3. 生成 macOS ICNS -----
  const icnsPngs = [];
  for (const { type, size } of ICNS_SIZES) {
    icnsPngs.push({ type, data: await createRoundedPng(size) });
  }
  const icnsBuf = buildIcns(icnsPngs);
  fs.writeFileSync(ICNS_OUT, icnsBuf);
  console.log(`✓ ${ICNS_OUT}  (${(icnsBuf.length / 1024).toFixed(1)} KB)`);
}

main().catch((e) => {
  console.error("Icon generation failed:", e);
  process.exit(1);
});
