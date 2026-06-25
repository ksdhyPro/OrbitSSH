export function getRootName(homePath: string): string {
  const parts = homePath.split("/").filter(Boolean);

  return parts.at(-1) ?? homePath;
}

export function getRemoteParentPath(path: string): string {
  const normalizedPath = path.replace(/\/+/g, "/").replace(/\/$/, "");

  if (!normalizedPath || normalizedPath === "/") {
    return "/";
  }

  const separatorIndex = normalizedPath.lastIndexOf("/");

  if (separatorIndex <= 0) {
    return "/";
  }

  return normalizedPath.slice(0, separatorIndex);
}

export function parseOsc7Path(data: string): string {
  const match = data.match(/^file:\/\/[^/]*(\/.*)$/);

  if (!match?.[1]) {
    return "";
  }

  try {
    return decodeURIComponent(match[1]);
  } catch {
    return match[1];
  }
}
