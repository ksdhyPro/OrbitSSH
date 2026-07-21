<script setup lang="ts">
import { computed } from "vue";
import copyIcon from "../assets/icons/copy.svg";
import refreshIcon from "../assets/icons/refresh.svg";
import syncPathIcon from "../assets/icons/sync-path.svg";
import type { RemoteFileNode } from "../../shared/sftp";
import type { TerminalTab } from "../types/terminal";
import type {
  BlankContextMenuState,
  FileContextMenuState,
  RenamingState,
  SftpTreeState,
  VisibleRemoteFileNode,
} from "../types/sftp";
import { isPreviewImageFile } from "../utils/file-kind";
import FileContextMenu from "./FileContextMenu.vue";
import BlankContextMenu from "./BlankContextMenu.vue";
import RemoteFileList, { type RemoteFileListNode } from "./RemoteFileList.vue";

const props = defineProps<{
  activeTab: TerminalTab | undefined;
  activeSftpTree: SftpTreeState | undefined;
  visibleFileTree: VisibleRemoteFileNode[];
  fileContextMenu: FileContextMenuState;
  blankContextMenu: BlankContextMenuState;
  renaming: RenamingState | null;
  fileDragTargetPath: string;
  filePathInput: string;
  filePanelHint: string;
  fileTreeElementRef: (element: unknown) => void;
  isEditableTextFile: (node: RemoteFileNode | null) => boolean;
  getFileEditMenuLabel: (node: RemoteFileNode | null) => string;
  canDownloadRemoteFile: (node: RemoteFileNode | null) => boolean;
  canUploadRemoteNode: (node: RemoteFileNode | null) => boolean;
  canDeleteRemoteNode: (node: RemoteFileNode | null) => boolean;
}>();

const emit = defineEmits<{
  "update:filePathInput": [value: string];
  refresh: [];
  submitPath: [];
  copyPath: [];
  syncPath: [];
  openContextMenu: [event: MouseEvent, node: RemoteFileNode];
  openBlankContextMenu: [event: MouseEvent];
  openFileByDoubleClick: [node: RemoteFileNode];
  selectNode: [event: MouseEvent, node: RemoteFileNode];
  selectAll: [];
  clearSelection: [];
  marqueeSelect: [paths: string[]];
  dragStartNode: [
    event: DragEvent,
    node: RemoteFileNode & { isVirtualParent?: boolean },
  ];
  dragOverNode: [
    event: DragEvent,
    node: RemoteFileNode & { isVirtualParent?: boolean },
  ];
  dragLeaveNode: [event: DragEvent, node: RemoteFileNode];
  dropNode: [
    event: DragEvent,
    node: RemoteFileNode & { isVirtualParent?: boolean },
  ];
  dragEndNode: [];
  previewContextFile: [];
  editContextFile: [];
  downloadContextFile: [];
  uploadContextFile: [sourceType: "file" | "directory"];
  uploadToCurrentDirectory: [sourceType: "file" | "directory"];
  deleteContextFile: [];
  renameContextFile: [];
  permissionsContextFile: [];
  closeFileContextMenu: [];
  closeBlankContextMenu: [];
  commitRename: [];
  cancelRename: [];
  createBlankNode: [type: "file" | "directory"];
}>();

function updateRenameValue(value: string): void {
  if (props.renaming) {
    props.renaming.value = value;
  }
}

const isSftpDisconnected = computed(() =>
  Boolean(
    props.activeSftpTree?.disconnected ||
      props.activeTab?.status === "disconnected" ||
      props.activeTab?.status === "error",
  ),
);
</script>

<template>
  <section class="panel file-panel">
    <div class="panel-header">
      <h2>
        远程文件
        <span v-if="isSftpDisconnected" class="sftp-disconnected-badge">
          已断开
        </span>
      </h2>
      <button
        type="button"
        class="icon-button"
        aria-label="刷新目录"
        :disabled="!activeTab || isSftpDisconnected"
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
        :disabled="!activeTab || !activeSftpTree || isSftpDisconnected"
        :placeholder="filePanelHint"
        aria-label="远程路径"
        @input="
          emit('update:filePathInput', ($event.target as HTMLInputElement).value)
        "
        @keydown.enter.prevent="emit('submitPath')" />
      <button
        type="button"
        class="path-action-button"
        :disabled="!activeSftpTree?.homePath || isSftpDisconnected"
        title="复制当前路径"
        aria-label="复制当前路径"
        @click="emit('copyPath')">
        <img :src="copyIcon" alt="" />
      </button>
      <button
        type="button"
        class="path-action-button"
        :disabled="!activeTab?.currentPath || isSftpDisconnected"
        title="同步到当前终端路径"
        aria-label="同步到当前终端路径"
        @click="emit('syncPath')">
        <img :src="syncPathIcon" alt="" />
      </button>
    </div>

    <RemoteFileList
      :element-ref="fileTreeElementRef"
      :nodes="visibleFileTree as RemoteFileListNode[]"
      list-class="file-tree"
      row-class="file-node"
      aria-label="远程文件列表"
      :empty-text="isSftpDisconnected ? 'SFTP 已断开' : '当前目录为空'"
      :selected-paths="activeSftpTree?.selectedPaths ?? new Set<string>()"
      :loading-paths="activeSftpTree?.loadingPaths ?? new Set<string>()"
      :deleting-paths="activeSftpTree?.deletingPaths ?? new Set<string>()"
      :drop-target-path="fileDragTargetPath"
      :renaming-path="renaming?.path"
      :renaming-value="renaming?.value"
      :non-draggable-path="activeSftpTree?.root.path"
      @open-blank-context-menu="emit('openBlankContextMenu', $event)"
      @select-node="(event, node) => emit('selectNode', event, node)"
      @clear-selection="emit('clearSelection')"
      @marquee-select="emit('marqueeSelect', $event)"
      @open-context-menu="
        (event, node) => emit('openContextMenu', event, node)
      "
      @open-node="emit('openFileByDoubleClick', $event)"
      @drag-start-node="(event, node) => emit('dragStartNode', event, node)"
      @drag-over-node="(event, node) => emit('dragOverNode', event, node)"
      @drag-leave-node="(event, node) => emit('dragLeaveNode', event, node)"
      @drop-node="(event, node) => emit('dropNode', event, node)"
      @drag-end-node="emit('dragEndNode')"
      @select-all="emit('selectAll')"
      @update-rename-value="updateRenameValue"
      @commit-rename="emit('commitRename')"
      @cancel-rename="emit('cancelRename')" />

    <FileContextMenu
      :menu="fileContextMenu"
      :is-preview-image-file="isPreviewImageFile"
      :is-editable-text-file="isEditableTextFile"
      :get-file-edit-menu-label="getFileEditMenuLabel"
      :can-download-remote-file="canDownloadRemoteFile"
      :can-upload-remote-node="canUploadRemoteNode"
      :can-delete-remote-node="canDeleteRemoteNode"
      @preview="emit('previewContextFile')"
      @edit="emit('editContextFile')"
      @download="emit('downloadContextFile')"
      @upload="emit('uploadContextFile', $event)"
      @create="emit('createBlankNode', $event)"
      @rename="emit('renameContextFile')"
      @permissions="emit('permissionsContextFile')"
      @delete="emit('deleteContextFile')"
      @close="emit('closeFileContextMenu')" />

    <BlankContextMenu
      :menu="blankContextMenu"
      @create="emit('createBlankNode', $event)"
      @upload="emit('uploadToCurrentDirectory', $event)"
      @close="emit('closeBlankContextMenu')" />
  </section>
</template>
