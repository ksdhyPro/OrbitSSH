export function formatFileSize(size?: number): string {
  if (typeof size !== "number") {
    return "";
  }

  if (size < 1024) {
    return `${size} B`;
  }

  if (size < 1024 * 1024) {
    return `${(size / 1024).toFixed(1)} KB`;
  }

  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

export function formatTransferSpeed(speed: number): string {
  if (!Number.isFinite(speed) || speed <= 0) {
    return "0 B/s";
  }

  return `${formatFileSize(speed)}/s`;
}

export function formatModifyTime(modifyTime?: number): string {
  if (typeof modifyTime !== "number") {
    return "";
  }

  return new Date(modifyTime).toLocaleDateString();
}

export function getFileExtension(fileName: string): string {
  const dotIndex = fileName.lastIndexOf(".");

  if (dotIndex <= 0) {
    return "";
  }

  return fileName.slice(dotIndex).toLowerCase();
}
