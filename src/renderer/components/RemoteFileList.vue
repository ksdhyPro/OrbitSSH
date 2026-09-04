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
  openBlankContextMenu: [event: MouseEvent];
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
const marqueeAutoScrollEdge = 36;
const marqueeAutoScrollMaxStep = 18;
let renameFocusFrame = 0;
let marqueeAutoScrollFrame = 0;
const marquee = reactive({
  active: false,
  visible: false,
  startClientX: 0,
  startClientY: 0,
  currentClientX: 0,
  currentClientY: 0,
  startContentX: 0,
  startContentY: 0,
  currentContentX: 0,
  currentContentY: 0,
  maxScrollTop: 0,
  viewportLeft: 0,
  viewportTop: 0,
  viewportWidth: 0,
  viewportHeight: 0,
  left: 0,
  top: 0,
  width: 0,
  height: 0,
});

function setRootElement(element: Element | unknown): void {
  rootElement.value = element instanceof HTMLElement ? element : null;
  props.elementRef?.(rootElement.value);
}

function setRenameInputElement(element: Element | unknown): void {
  renameInputRef.value = element instanceof HTMLInputElement ? element : null;
}

// 重命名输入框依赖列表渲染完成后才存在，延后一帧聚焦保证新建后可直接输入。
async function focusRenameInput(): Promise<void> {
  if (!props.renamingPath) {
    return;
  }

  await nextTick();

  if (renameFocusFrame) {
    cancelAnimationFrame(renameFocusFrame);
  }

  renameFocusFrame = requestAnimationFrame(() => {
    renameFocusFrame = 0;
    renameInputRef.value?.focus();
    renameInputRef.value?.select();
  });
}

onUnmounted(() => {
  stopMarqueeSelection();
  if (renameFocusFrame) {
    cancelAnimationFrame(renameFocusFrame);
    renameFocusFrame = 0;
  }
  props.elementRef?.(null);
});

watch(
  () => props.renamingPath,
  (path) => {
    if (path) {
      void focusRenameInput();
    }
  },
  { flush: "post" },
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
  if (marqueeAutoScrollFrame) {
    cancelAnimationFrame(marqueeAutoScrollFrame);
    marqueeAutoScrollFrame = 0;
  }
  marquee.active = false;
  marquee.visible = false;
}

function getMarqueeSelectionRect(): DOMRect {
  const root = rootElement.value;

  if (!root) {
    return new DOMRect();
  }

  const rootRect = root.getBoundingClientRect();
  // 选区起点随列表滚动回推到当前视口，保证滚出视口的文件仍属于选区。
  const startClientX =
    rootRect.left + marquee.startContentX - root.scrollLeft;
  const startClientY = rootRect.top + marquee.startContentY - root.scrollTop;
  const left = Math.min(startClientX, marquee.currentClientX);
  const top = Math.min(startClientY, marquee.currentClientY);
  const right = Math.max(startClientX, marquee.currentClientX);
  const bottom = Math.max(startClientY, marquee.currentClientY);

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

function updateMarquee(clientX: number, clientY: number): void {
  const root = rootElement.value;

  if (!root) {
    return;
  }

  const rootRect = root.getBoundingClientRect();
  marquee.currentClientX = clientX;
  marquee.currentClientY = clientY;
  marquee.currentContentX = clientX - rootRect.left + root.scrollLeft;
  marquee.currentContentY = clientY - rootRect.top + root.scrollTop;
  marquee.viewportLeft = rootRect.left;
  marquee.viewportTop = rootRect.top;
  marquee.viewportWidth = rootRect.width;
  marquee.viewportHeight = rootRect.height;
  // 选框相对独立遮罩层定位：既不撑高列表，又能被列表边界裁剪。
  marquee.left = Math.min(
    marquee.startContentX - root.scrollLeft,
    marquee.currentContentX - root.scrollLeft,
  );
  marquee.top = Math.min(
    marquee.startContentY - root.scrollTop,
    marquee.currentContentY - root.scrollTop,
  );
  marquee.width = Math.abs(marquee.currentContentX - marquee.startContentX);
  marquee.height = Math.abs(marquee.currentContentY - marquee.startContentY);
}

// 框选停在列表上下边缘时，按距离边缘的远近持续滚动，保持 Windows 文件管理器的交互习惯。
function getMarqueeAutoScrollDelta(): number {
  const root = rootElement.value;

  if (!root) {
    return 0;
  }

  const rect = root.getBoundingClientRect();
  const topDistance = marquee.currentClientY - rect.top;
  const bottomDistance = rect.bottom - marquee.currentClientY;

  if (topDistance < marqueeAutoScrollEdge) {
    const ratio = 1 - Math.max(topDistance, 0) / marqueeAutoScrollEdge;
    return -Math.max(1, Math.ceil(ratio * marqueeAutoScrollMaxStep));
  }

  if (bottomDistance < marqueeAutoScrollEdge) {
    const ratio = 1 - Math.max(bottomDistance, 0) / marqueeAutoScrollEdge;
    return Math.max(1, Math.ceil(ratio * marqueeAutoScrollMaxStep));
  }

  return 0;
}

function continueMarqueeAutoScroll(): void {
  marqueeAutoScrollFrame = 0;

  const root = rootElement.value;
  const delta = getMarqueeAutoScrollDelta();

  if (!marquee.active || !marquee.visible || !root || !delta) {
    return;
  }

  const previousScrollTop = root.scrollTop;
  // 框选矩形可能超出内容边界，不能让它增加可滚动范围。
  root.scrollTop = Math.min(
    marquee.maxScrollTop,
    Math.max(0, previousScrollTop + delta),
  );

  if (root.scrollTop === previousScrollTop) {
    return;
  }

  updateMarquee(marquee.currentClientX, marquee.currentClientY);
  emit("marqueeSelect", getMarqueeSelectedPaths());
  marqueeAutoScrollFrame = requestAnimationFrame(continueMarqueeAutoScroll);
}

function scheduleMarqueeAutoScroll(): void {
  if (!marqueeAutoScrollFrame) {
    marqueeAutoScrollFrame = requestAnimationFrame(continueMarqueeAutoScroll);
  }
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
  const rootRect = root.getBoundingClientRect();
  marquee.startContentX = event.clientX - rootRect.left + root.scrollLeft;
  marquee.startContentY = event.clientY - rootRect.top + root.scrollTop;
  marquee.currentContentX = marquee.startContentX;
  marquee.currentContentY = marquee.startContentY;
  marquee.viewportLeft = rootRect.left;
  marquee.viewportTop = rootRect.top;
  marquee.viewportWidth = rootRect.width;
  marquee.viewportHeight = rootRect.height;
  // 在框选矩形显示前记录真实文件内容的底部，防止矩形撑高滚动区域。
  marquee.maxScrollTop = Math.max(0, root.scrollHeight - root.clientHeight);
  marquee.left = marquee.startContentX - root.scrollLeft;
  marquee.top = marquee.startContentY - root.scrollTop;
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
  updateMarquee(event.clientX, event.clientY);
  emit("marqueeSelect", getMarqueeSelectedPaths());
  scheduleMarqueeAutoScroll();
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

  updateMarquee(event.clientX, event.clientY);
  emit("marqueeSelect", getMarqueeSelectedPaths());
  stopMarqueeSelection();
}

// 输入框内的全选快捷键只作用于文件名文本，避免冒泡触发文件列表全选。
function handleRenameInputKeydown(event: KeyboardEvent): void {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "a") {
    event.stopPropagation();
  }
}
</script>

<template>
  <div
    v-if="nodes.length === 0"
    class="remote-file-empty"
    @click="emit('clearSelection')"
    @contextmenu="emit('openBlankContextMenu', $event)">
    {{ emptyText }}
  </div>
  <ul
    v-else
    :ref="setRootElement"
    :class="['remote-file-list', listClass]"
    tabindex="0"
    :aria-label="ariaLabel"
    @contextmenu.self="emit('openBlankContextMenu', $event)"
    @pointerdown="handleListPointerDown"
    @keydown="
      ($event.ctrlKey || $event.metaKey) &&
        $event.key.toLowerCase() === 'a' &&
        ($event.preventDefault(), emit('selectAll'))
    ">
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
        :ref="setRenameInputElement"
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
        @keydown="handleRenameInputKeydown"
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
  <Teleport to="body">
    <div
      v-if="marquee.visible"
      class="remote-file-marquee-viewport"
      aria-hidden="true"
      :style="{
        left: `${marquee.viewportLeft}px`,
        top: `${marquee.viewportTop}px`,
        width: `${marquee.viewportWidth}px`,
        height: `${marquee.viewportHeight}px`,
      }">
      <div
        class="remote-file-marquee"
        :style="{
          left: `${marquee.left}px`,
          top: `${marquee.top}px`,
          width: `${marquee.width}px`,
          height: `${marquee.height}px`,
        }"></div>
    </div>
  </Teleport>
</template>
