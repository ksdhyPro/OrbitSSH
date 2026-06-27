<script setup lang="ts">
import { nextTick, ref, watch } from "vue";
import chevronRightIcon from "../assets/icons/chevron-right.svg";
import copyIcon from "../assets/icons/copy.svg";
import fileIcon from "../assets/icons/file.svg";
import folderIcon from "../assets/icons/folder.svg";
import refreshIcon from "../assets/icons/refresh.svg";
import syncPathIcon from "../assets/icons/sync-path.svg";
import type { RemoteFileNode } from "../../shared/sftp";
import type { SftpFileTreeViewMode } from "../../shared/settings";
import type { TerminalTab } from "../types/terminal";
import type {
  BlankContextMenuState,
  FileContextMenuState,
  RenamingState,
  SftpTreeState,
  VisibleRemoteFileNode,
} from "../types/sftp";
import { formatFileSize, formatModifyTime } from "../utils/format";
import { isPreviewImageFile } from "../utils/file-kind";
import FileContextMenu from "./FileContextMenu.vue";
import BlankContextMenu from "./BlankContextMenu.vue";

const props = defineProps<{
  activeTab: TerminalTab | undefined;
  activeSftpTree: SftpTreeState | undefined;
  fileTreeViewMode: SftpFileTreeViewMode;
  visibleFileTree: VisibleRemoteFileNode[];
  fileContextMenu: FileContextMenuState;
  blankContextMenu: BlankContextMenuState;
  renaming: RenamingState | null;
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
  toggleDirectory: [node: RemoteFileNode];
  openFileByDoubleClick: [node: RemoteFileNode];
  selectNode: [event: MouseEvent, node: RemoteFileNode];
  selectAll: [];
  previewContextFile: [];
  editContextFile: [];
  downloadContextFile: [];
  uploadContextFile: [sourceType: "file" | "directory"];
  uploadToCurrentDirectory: [sourceType: "file" | "directory"];
  deleteContextFile: [];
  renameContextFile: [];
  closeFileContextMenu: [];
  closeBlankContextMenu: [];
  commitRename: [];
  cancelRename: [];
  createBlankNode: [type: "file" | "directory"];
}>();

// 重命名输入框 DOM 引用：进入编辑态时自动聚焦并全选名称（Windows 新建/重命名行为）。
const renameInputRef = ref<HTMLInputElement | null>(null);

// 函数式 ref 回调：v-for 内字符串 ref 会被聚合成数组，故改用函数式 ref，
// 仅在目标节点上把 DOM 写入响应式引用。
function setRenameInput(
  element: Element | unknown,
  nodePath: string,
): void {
  if (props.renaming?.path === nodePath) {
    renameInputRef.value =
      element instanceof HTMLInputElement ? element : null;
  }
}

watch(
  () => props.renaming,
  async (state) => {
    if (!state) {
      return;
    }
    await nextTick();
    renameInputRef.value?.focus();
    renameInputRef.value?.select();
  },
);
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
      tabindex="0"
      :aria-label="
        fileTreeViewMode === 'tree' ? '远程文件树预览' : '远程文件列表'
      "
      @contextmenu="emit('openBlankContextMenu', $event)"
      @keydown="
        ($event.ctrlKey || $event.metaKey) &&
          $event.key.toLowerCase() === 'a' &&
          ($event.preventDefault(), emit('selectAll'))
      ">
      <li
        v-for="node in visibleFileTree"
        :key="node.path"
        :class="[
          'file-node',
          {
            'is-folder': node.type === 'directory',
            'is-loading': activeSftpTree?.loadingPaths.has(node.path),
            'is-deleting': activeSftpTree?.deletingPaths.has(node.path),
            selected: activeSftpTree?.selectedPaths.has(node.path),
          },
        ]"
        :style="{
          paddingLeft:
            fileTreeViewMode === 'tree' ? `${12 + node.level * 18}px` : '12px',
        }"
        @contextmenu.stop="
          node.isVirtualParent || activeSftpTree?.deletingPaths.has(node.path)
            ? $event.preventDefault()
            : emit('openContextMenu', $event, node)
        "
        @click="
          !activeSftpTree?.deletingPaths.has(node.path) &&
            emit('selectNode', $event, node)
        "
        @dblclick="
          !activeSftpTree?.deletingPaths.has(node.path) &&
            emit('openFileByDoubleClick', node)
        ">
        <img
          v-if="fileTreeViewMode === 'tree' && node.type === 'directory'"
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
        <input
          v-if="renaming?.path === node.path"
          :ref="(element) => setRenameInput(element, node.path)"
          class="rename-inline-input"
          type="text"
          spellcheck="false"
          :value="renaming.value"
          aria-label="重命名"
          @click.stop
          @input="
            renaming && (renaming.value = ($event.target as HTMLInputElement).value)
          "
          @keydown.enter.prevent="emit('commitRename')"
          @keydown.esc.prevent="emit('cancelRename')"
          @blur="emit('commitRename')"
          @contextmenu.prevent.stop />
        <span v-else class="file-name">{{ node.name }}</span>
        <span class="file-meta">
          {{ node.type === "directory" ? "目录" : formatFileSize(node.size) }}
          {{ formatModifyTime(node.modifyTime) }}
        </span>
        <span
          v-if="activeSftpTree?.deletingPaths.has(node.path)"
          class="file-node-spinner"
          aria-label="删除中"></span>
      </li>
    </ul>

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
      @delete="emit('deleteContextFile')"
      @close="emit('closeFileContextMenu')" />

    <BlankContextMenu
      :menu="blankContextMenu"
      @create="emit('createBlankNode', $event)"
      @upload="emit('uploadToCurrentDirectory', $event)"
      @close="emit('closeBlankContextMenu')" />
  </section>
</template>
