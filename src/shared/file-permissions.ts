const MAX_UNIX_MODE = 0o7777;

export interface UnixPermissionRights {
  user: string;
  group: string;
  other: string;
}

function hasExecuteBit(value: string): boolean {
  return /[xst]/.test(value);
}

export function unixRightsToMode(rights: UnixPermissionRights): number {
  let mode = 0;

  if (rights.user.includes("r")) mode |= 0o400;
  if (rights.user.includes("w")) mode |= 0o200;
  if (hasExecuteBit(rights.user)) mode |= 0o100;
  if (/[sS]/.test(rights.user)) mode |= 0o4000;

  if (rights.group.includes("r")) mode |= 0o040;
  if (rights.group.includes("w")) mode |= 0o020;
  if (hasExecuteBit(rights.group)) mode |= 0o010;
  if (/[sS]/.test(rights.group)) mode |= 0o2000;

  if (rights.other.includes("r")) mode |= 0o004;
  if (rights.other.includes("w")) mode |= 0o002;
  if (hasExecuteBit(rights.other)) mode |= 0o001;
  if (/[tT]/.test(rights.other)) mode |= 0o1000;

  return mode;
}

export function normalizeUnixMode(mode: number): number {
  if (!Number.isInteger(mode) || mode < 0 || mode > MAX_UNIX_MODE) {
    throw new Error("文件权限必须是 0000-7777 之间的八进制值");
  }

  return mode;
}

export function parseUnixMode(value: string): number | null {
  const normalized = value.trim();
  if (!/^[0-7]{3,4}$/.test(normalized)) return null;
  return normalizeUnixMode(Number.parseInt(normalized, 8));
}

export function formatUnixMode(mode: number): string {
  return normalizeUnixMode(mode).toString(8).padStart(4, "0");
}

export function formatUnixPermissions(mode: number): string {
  const normalized = normalizeUnixMode(mode);
  const characters = [
    normalized & 0o400 ? "r" : "-",
    normalized & 0o200 ? "w" : "-",
    normalized & 0o100 ? "x" : "-",
    normalized & 0o040 ? "r" : "-",
    normalized & 0o020 ? "w" : "-",
    normalized & 0o010 ? "x" : "-",
    normalized & 0o004 ? "r" : "-",
    normalized & 0o002 ? "w" : "-",
    normalized & 0o001 ? "x" : "-",
  ];

  if (normalized & 0o4000) characters[2] = normalized & 0o100 ? "s" : "S";
  if (normalized & 0o2000) characters[5] = normalized & 0o010 ? "s" : "S";
  if (normalized & 0o1000) characters[8] = normalized & 0o001 ? "t" : "T";

  return characters.join("");
}
