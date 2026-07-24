export const systemDiskLinePrefix = "__ORBITSSH_DISK__";

export interface SystemDiskStats {
  name: string;
  mountPoint: string;
  free: number;
  total: number;
}

const ignoredPosixFileSystems = new Set([
  "devtmpfs",
  "none",
  "proc",
  "shm",
  "sysfs",
  "tmpfs",
  "udev",
]);

function toNonNegativeNumber(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }

  return Math.max(0, value);
}

function deduplicateDisks(disks: SystemDiskStats[]): SystemDiskStats[] {
  const seen = new Set<string>();

  return disks.filter(disk => {
    const key = `${disk.name}\u0000${disk.mountPoint}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function normalizeSystemDiskStats(value: unknown): SystemDiskStats[] {
  const candidates = Array.isArray(value) ? value : value ? [value] : [];
  const disks: SystemDiskStats[] = [];

  for (const candidate of candidates) {
    if (!candidate || typeof candidate !== "object") continue;
    const record = candidate as Record<string, unknown>;
    const total = toNonNegativeNumber(record.total);
    const free = toNonNegativeNumber(record.free);
    if (total === null || free === null || total <= 0) continue;

    const name = typeof record.name === "string" ? record.name.trim() : "";
    const mountPoint =
      typeof record.mount_point === "string"
        ? record.mount_point.trim()
        : typeof record.mountPoint === "string"
          ? record.mountPoint.trim()
          : "";
    if (!name && !mountPoint) continue;

    disks.push({
      name: name || mountPoint,
      mountPoint: mountPoint || name,
      free: Math.min(free, total),
      total,
    });
  }

  return deduplicateDisks(disks);
}

export function parseTaggedSystemDiskStats(raw: string): SystemDiskStats[] {
  const disks = raw.split(/\r?\n/).flatMap(line => {
    if (!line.startsWith(`${systemDiskLinePrefix}\t`)) return [];
    const [, name = "", mountPoint = "", freeRaw = "", totalRaw = ""] =
      line.split("\t");
    const free = Number(freeRaw);
    const total = Number(totalRaw);

    return normalizeSystemDiskStats([
      { name, mount_point: mountPoint, free, total },
    ]);
  });

  return deduplicateDisks(disks);
}

export function parsePosixDfSystemDiskStats(raw: string): SystemDiskStats[] {
  const seenNames = new Set<string>();
  const disks: SystemDiskStats[] = [];

  for (const line of raw.split(/\r?\n/)) {
    const parts = line.trim().split(/\s+/);
    if (parts.length < 6) continue;

    const [name, totalBlocksRaw, , freeBlocksRaw] = parts;
    if (!name || ignoredPosixFileSystems.has(name.toLowerCase())) continue;
    if (seenNames.has(name)) continue;

    const totalBlocks = Number(totalBlocksRaw);
    const freeBlocks = Number(freeBlocksRaw);
    if (!Number.isFinite(totalBlocks) || !Number.isFinite(freeBlocks)) continue;

    const [disk] = normalizeSystemDiskStats([
      {
        name,
        mount_point: parts.slice(5).join(" "),
        free: freeBlocks * 1024,
        total: totalBlocks * 1024,
      },
    ]);
    if (!disk) continue;

    seenNames.add(name);
    disks.push(disk);
  }

  return disks;
}

export function summarizeSystemDisks(disks: SystemDiskStats[]): {
  diskFree: number;
  diskTotal: number;
} {
  return disks.reduce(
    (summary, disk) => ({
      diskFree: summary.diskFree + disk.free,
      diskTotal: summary.diskTotal + disk.total,
    }),
    { diskFree: 0, diskTotal: 0 },
  );
}
