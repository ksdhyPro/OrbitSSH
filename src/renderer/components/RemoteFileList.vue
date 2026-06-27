<script setup lang="ts">
import { nextTick, onUnmounted, reactive, ref, watch } from "vue";
import fileIcon from "../assets/icons/file.svg";
import folderIcon from "../assets/icons/folder.svg";
import type { RemoteFileNode } from "../../shared/sftp";
import { formatFileSize, formatModifyTime } from "../utils/format";

export interface RemoteFileListNode extends RemoteFileNode {
  isVirtualParent?: boolean;
}

const props = withDefaults(
  defineProps<{
    nodes: RemoteFileListNode[];
    selectedPaths: Set<string>;
    deletingPaths?: Set<string>;
    dropTargetPath?: string;
    renamingPath?: string;
    renamingValue?: string;
    listClass?: string;
    rowClass?: string;
    ariaLabel?: string;
    emptyText?: string;
    nonDraggablePath?: string;
    elementRef?: (element: unknown) => void;
  }>(),
  {
    deletingPaths: () => new Set<string>(),
    dropTargetPath: "",
    renamingPath: "",
    renamingValue: "",
    listClass: "",
    rowClass: "",
    ariaLabel: "远程文件列表",
    emptyText: "当前目录为空",
    nonDraggablePath: "",
  },
);

const emit = defineEmits<{
  selectNode: [event: MouseEvent, node: RemoteFileListNode];
  openContextMenu: [event: MouseEvent, node: RemoteFileListNode];
  openNode: [node: RemoteFileListNode];
  dragStartNode: [event: DragEvent, node: RemoteFileListNode];
  dragOverNode: [event: DragEvent, node: RemoteFileListNode];
  dragLeaveNode: [event: DragEvent, node: RemoteFileListNode];
  dropNode: [event: DragEvent, node: RemoteFileListNode];
  dragEndNode: [];
  selectAll: [];
  clearSelection: [];
  marqueeSelect: [paths: string[]];
  updateRenameValue: [value: string];
  commitRename: [];
  cancelRename: [];
}>();

const renameInputRef = ref<HTMLInputElement | null>(null);
const rootElement = ref<HTMLElement | null>(null);
const marquee = reactive({
  active: false,
  visible: false,
  startClientX: 0,
  startClientY: 0,
  currentClientX: 0,
  currentClientY: 0,
  startScrollLeft: 0,
  startScrollTop: 0,
  left: 0,
  top: 0,
  width: 0,
  height: 0,
});

function setRootElement(element: Element | unknown): void {
  rootElement.value = element instanceof HTMLElement ? element : null;
  props.elementRef?.(rootElement.value);
}

onUnmounted(() => {
  stopMarqueeSelection();
  props.elementRef?.(null);
});

watch(
  () => props.renamingPath,
  async (path) => {
    if (!path) {
      return;
    }
    await nextTick();
    renameInputRef.value?.focus();
    renameInputRef.value?.select();
  },
);

function isDeleting(node: RemoteFileListNode): boolean {
  return props.deletingPaths.has(node.path);
}

function canDrag(node: RemoteFileListNode): boolean {
  return Boolean(
    !node.isVirtualParent &&
      node.path !== props.nonDraggablePath &&
      !isDeleting(node),
  );
}

function stopMarqueeSelection(): void {
  window.removeEventListener("pointermove", handleMarqueePointerMove);
  window.removeEventListener("pointerup", handleMarqueePointerUp);
  window.removeEventListener("pointercancel", handleMarqueePointerUp);
  marquee.active = false;
  marquee.visible = false;
}

function getMarqueeSelectionRect(): DOMRect {
  const left = Math.min(marquee.startClientX, marquee.currentClientX);
  const top = Math.min(marquee.startClientY, marquee.currentClientY);
  const right = Math.max(marquee.startClientX, marquee.currentClientX);
  const bottom = Math.max(marquee.startClientY, marquee.currentClientY);

  return new DOMRect(left, top, right - left, bottom - top);
}

function rectsIntersect(a: DOMRect, b: DOMRect): boolean {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}

function getMarqueeSelectedPaths(): string[] {
  const root = rootElement.value;

  if (!root) {
    return [];
  }

  const selectionRect = getMarqueeSelectionRect();
  const selectableByPath = new Map(
    props.nodes
      .filter((node) => !node.isVirtualParent && !isDeleting(node))
      .map((node) => [node.path, node]),
  );
  const paths: string[] = [];

  root.querySelectorAll<HTMLElement>(".remote-file-row").forEach((element) => {
    const path = element.dataset.path;

    if (!path || !selectableByPath.has(path)) {
      return;
    }

    if (rectsIntersect(selectionRect, element.getBoundingClientRect())) {
      paths.push(path);
    }
  });

  return paths;
}

function updateMarquee(event: PointerEvent): void {
  const root = rootElement.value;

  if (!root) {
    return;
  }

  const rootRect = root.getBoundingClientRect();
  const startX = marquee.startClientX - rootRect.left + marquee.startScrollLeft;
  const startY = marquee.startClientY - rootRect.top + marquee.startScrollTop;
  const currentX = event.clientX - rootRect.left + root.scrollLeft;
  const currentY = event.clientY - rootRect.top + root.scrollTop;

  marquee.currentClientX = event.clientX;
  marquee.currentClientY = event.clientY;
  marquee.left = Math.min(startX, currentX);
  marquee.top = Math.min(startY, currentY);
  marquee.width = Math.abs(currentX - startX);
  marquee.height = Math.abs(currentY - startY);
}

function handleListPointerDown(event: PointerEvent): void {
  if (event.button !== 0 || event.target !== rootElement.value) {
    return;
  }

  const root = rootElement.value;

  if (!root) {
    return;
  }

  marquee.active = true;
  marquee.visible = false;
  marquee.startClientX = event.clientX;
  marquee.startClientY = event.clientY;
  marquee.currentClientX = event.clientX;
  marquee.currentClientY = event.clientY;
  marquee.startScrollLeft = root.scrollLeft;
  marquee.startScrollTop = root.scrollTop;
  marquee.left = event.clientX - root.getBoundingClientRect().left + root.scrollLeft;
  marquee.top = event.clientY - root.getBoundingClientRect().top + root.scrollTop;
  marquee.width = 0;
  marquee.height = 0;

  window.addEventListener("pointermove", handleMarqueePointerMove);
  window.addEventListener("pointerup", handleMarqueePointerUp);
  window.addEventListener("pointercancel", handleMarqueePointerUp);
}

function handleMarqueePointerMove(event: PointerEvent): void {
  if (!marquee.active) {
    return;
  }

  const moved =
    Math.abs(event.clientX - marquee.startClientX) > 4 ||
    Math.abs(event.clientY - marquee.startClientY) > 4;

  if (!moved) {
    return;
  }

  event.preventDefault();
  marquee.visible = true;
  updateMarquee(event);
  emit("marqueeSelect", getMarqueeSelectedPaths());
}

function handleMarqueePointerUp(event: PointerEvent): void {
  if (!marquee.active) {
    stopMarqueeSelection();
    return;
  }

  if (!marquee.visible) {
    emit("clearSelection");
    stopMarqueeSelection();
    return;
  }

  updateMarquee(event);
  emit("marqueeSelect", getMarqueeSelectedPaths());
  stopMarqueeSelection();
}
</script>

<template>
  <div
    v-if="nodes.length === 0"
    class="remote-file-empty"
    @click="emit('clearSelection')">
    {{ emptyText }}
  </div>
  <ul
    v-else
    :ref="setRootElement"
    :class="['remote-file-list', listClass]"
    tabindex="0"
    :aria-label="ariaLabel"
    @pointerdown="handleListPointerDown"
    @keydown="
      ($event.ctrlKey || $event.metaKey) &&
        $event.key.toLowerCase() === 'a' &&
        ($event.preventDefault(), emit('selectAll'))
    ">
    <li
      v-if="marquee.visible"
      class="remote-file-marquee"
      aria-hidden="true"
      :style="{
        left: `${marquee.left}px`,
        top: `${marquee.top}px`,
        width: `${marquee.width}px`,
        height: `${marquee.height}px`,
      }"></li>
    <li
      v-for="node in nodes"
      :key="node.path"
      :data-path="node.path"
      :class="[
        'remote-file-row',
        rowClass,
        {
          'is-folder': node.type === 'directory',
          'is-deleting': isDeleting(node),
          'is-drop-target': dropTargetPath === node.path,
          selected: selectedPaths.has(node.path),
        },
      ]"
      :draggable="canDrag(node)"
      :title="node.path"
      @click="!isDeleting(node) && emit('selectNode', $event, node)"
      @contextmenu.stop="
        node.isVirtualParent || isDeleting(node)
          ? $event.preventDefault()
          : emit('openContextMenu', $event, node)
      "
      @dblclick="!isDeleting(node) && emit('openNode', node)"
      @dragstart="emit('dragStartNode', $event, node)"
      @dragover="emit('dragOverNode', $event, node)"
      @dragleave="emit('dragLeaveNode', $event, node)"
      @drop="emit('dropNode', $event, node)"
      @dragend="emit('dragEndNode')">
      <img
        class="remote-file-icon"
        :src="node.type === 'directory' ? folderIcon : fileIcon"
        alt="" />
      <input
        v-if="renamingPath === node.path"
        ref="renameInputRef"
        class="remote-file-rename-input"
        type="text"
        spellcheck="false"
        :value="renamingValue"
        aria-label="重命名"
        @click.stop
        @dblclick.stop
        @input="
          emit('updateRenameValue', ($event.target as HTMLInputElement).value)
        "
        @keydown.enter.prevent="emit('commitRename')"
        @keydown.esc.prevent="emit('cancelRename')"
        @blur="emit('commitRename')"
        @contextmenu.prevent.stop />
      <span v-else class="remote-file-name">{{ node.name }}</span>
      <small v-if="isDeleting(node)">删除中...</small>
      <small v-else-if="node.type === 'file'">
        {{ formatFileSize(node.size ?? 0) }}
      </small>
      <small v-else>文件夹</small>
      <small>{{ node.modifyTime ? formatModifyTime(node.modifyTime) : "" }}</small>
    </li>
  </ul>
</template>
