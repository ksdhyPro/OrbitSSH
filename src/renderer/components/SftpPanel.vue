<script setup lang="ts">
import chevronRightIcon from "../assets/icons/chevron-right.svg";
import copyIcon from "../assets/icons/copy.svg";
import fileIcon from "../assets/icons/file.svg";
import folderIcon from "../assets/icons/folder.svg";
import refreshIcon from "../assets/icons/refresh.svg";
import syncPathIcon from "../assets/icons/sync-path.svg";
import type { RemoteFileNode } from "../../shared/sftp";
import type { TerminalTab } from "../types/terminal";
import type {
  FileContextMenuState,
  SftpTreeState,
  VisibleRemoteFileNode,
} from "../types/sftp";
import { formatFileSize, formatModifyTime } from "../utils/format";
import { isPreviewImageFile } from "../utils/file-kind";
import FileContextMenu from "./FileContextMenu.vue";

defineProps<{
  activeTab: TerminalTab | undefined;
  activeSftpTree: SftpTreeState | undefined;
  visibleFileTree: VisibleRemoteFileNode[];
  fileContextMenu: FileContextMenuState;
  filePathInput: string;
  filePanelHint: string;
  fileTreeElementRef: (element: unknown) => void;
  isEditableTextFile: (node: RemoteFileNode | null) => boolean;
  getFileEditMenuLabel: (node: RemoteFileNode | null) => string;
  canDownloadRemoteFile: (node: RemoteFileNode | null) => boolean;
  canDeleteRemoteNode: (node: RemoteFileNode | null) => boolean;
}>();

const emit = defineEmits<{
  "update:filePathInput": [value: string];
  refresh: [];
  submitPath: [];
  copyPath: [];
  syncPath: [];
  openContextMenu: [event: MouseEvent, node: RemoteFileNode];
  toggleDirectory: [node: RemoteFileNode];
  openFileByDoubleClick: [node: RemoteFileNode];
  previewContextFile: [];
  editContextFile: [];
  downloadContextFile: [];
  deleteContextFile: [];
}>();
</script>

<template>
  <section class="panel file-panel">
    <div class="panel-header">
      <h2>远程文件</h2>
      <button
        type="button"
        class="icon-button"
        aria-label="刷新目录"
        :disabled="!activeTab"
        @click="emit('refresh')">
        <img :src="refreshIcon" alt="" />
      </button>
    </div>

    <div class="file-path-row">
      <input
        :value="filePathInput"
        class="file-path-input"
        type="text"
        spellcheck="false"
        :disabled="!activeTab || !activeSftpTree"
        :placeholder="filePanelHint"
        aria-label="远程路径"
        @input="
          emit('update:filePathInput', ($event.target as HTMLInputElement).value)
        "
        @keydown.enter.prevent="emit('submitPath')" />
      <button
        type="button"
        class="path-action-button"
        :disabled="!activeSftpTree?.homePath"
        title="复制当前路径"
        aria-label="复制当前路径"
        @click="emit('copyPath')">
        <img :src="copyIcon" alt="" />
      </button>
      <button
        type="button"
        class="path-action-button"
        :disabled="!activeTab?.currentPath"
        title="同步到当前终端路径"
        aria-label="同步到当前终端路径"
        @click="emit('syncPath')">
        <img :src="syncPathIcon" alt="" />
      </button>
    </div>

    <ul
      :ref="fileTreeElementRef"
      class="file-tree"
      aria-label="远程文件树预览">
      <li
        v-for="node in visibleFileTree"
        :key="node.path"
        :class="[
          'file-node',
          {
            'is-folder': node.type === 'directory',
            'is-loading': activeSftpTree?.loadingPaths.has(node.path),
          },
        ]"
        :style="{ paddingLeft: `${12 + node.level * 18}px` }"
        @contextmenu="emit('openContextMenu', $event, node)"
        @click="emit('toggleDirectory', node)"
        @dblclick="emit('openFileByDoubleClick', node)">
        <img
          v-if="node.type === 'directory'"
          :class="[
            'chevron-icon',
            { open: activeSftpTree?.expandedPaths.has(node.path) },
          ]"
          :src="chevronRightIcon"
          alt="" />
        <span v-else class="chevron-placeholder"></span>
        <img
          class="file-icon"
          :src="node.type === 'directory' ? folderIcon : fileIcon"
          alt="" />
        <span class="file-name">{{ node.name }}</span>
        <span class="file-meta">
          {{ node.type === "directory" ? "目录" : formatFileSize(node.size) }}
          {{ formatModifyTime(node.modifyTime) }}
        </span>
      </li>
    </ul>

    <FileContextMenu
      :menu="fileContextMenu"
      :is-preview-image-file="isPreviewImageFile"
      :is-editable-text-file="isEditableTextFile"
      :get-file-edit-menu-label="getFileEditMenuLabel"
      :can-download-remote-file="canDownloadRemoteFile"
      :can-delete-remote-node="canDeleteRemoteNode"
      @preview="emit('previewContextFile')"
      @edit="emit('editContextFile')"
      @download="emit('downloadContextFile')"
      @delete="emit('deleteContextFile')" />
  </section>
</template>
