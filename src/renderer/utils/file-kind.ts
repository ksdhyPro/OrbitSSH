import { appConfig } from "../../shared/config";
import type { RemoteFileNode } from "../../shared/sftp";
import { getFileExtension } from "./format";

export const editableTextFileExtensions = new Set<string>(
  appConfig.sftp.textEditor.editableExtensions,
);

export const editableTextFileNames = new Set<string>(
  appConfig.sftp.textEditor.editableFileNames,
);

export const previewImageExtensions = new Set<string>(
  appConfig.sftp.imagePreview.extensions,
);

export function isKnownEditableTextFile(node: RemoteFileNode | null): boolean {
  if (!node || node.type !== "file") {
    return false;
  }

  const fileName = node.name.toLowerCase();

  return (
    editableTextFileNames.has(fileName) ||
    editableTextFileExtensions.has(getFileExtension(fileName))
  );
}

export function isPreviewImageFile(node: RemoteFileNode | null): boolean {
  return Boolean(
    node &&
      node.type === "file" &&
      previewImageExtensions.has(getFileExtension(node.name.toLowerCase())),
  );
}
