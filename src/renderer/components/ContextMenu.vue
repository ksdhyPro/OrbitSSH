<script setup lang="ts">
import { onUnmounted, reactive } from "vue";
import chevronRightIcon from "../assets/icons/chevron-right.svg";
import type { ContextMenuItem, ContextMenuState } from "../types/context-menu";
import type { FloatingMenuCloseReason } from "../utils/floating-menu";
import { CONTEXT_MENU_SIZE, resolveMenuPlacement } from "../utils/menu-position";
import FloatingMenu from "./FloatingMenu.vue";

const props = defineProps<{
  menu: ContextMenuState;
  items: ContextMenuItem[];
}>();

const emit = defineEmits<{
  select: [item: ContextMenuItem];
  close: [reason: FloatingMenuCloseReason];
  menuEnter: [];
  menuLeave: [];
}>();

const subMenu = reactive<ContextMenuState>({ open: false, x: 0, y: 0 });
let activeSubmenuKey = "";
let closeSubmenuTimer = 0;

// 统一处理菜单项点击；带子项的父项仅负责展开，不向外派发操作。
function selectMenuItem(item: ContextMenuItem): void {
  if (item.disabled || item.children?.length) {
    return;
  }

  emit("select", item);
}

// 子菜单以父项左右边界为基准定位，避免复用右键定位时向左翻转后发生重叠。
function openSubmenu(item: ContextMenuItem, event: MouseEvent): void {
  clearSubmenuCloseTimer();

  if (item.disabled || !item.children?.length) {
    closeSubmenu();
    return;
  }

  const trigger = event.currentTarget;
  if (!(trigger instanceof HTMLElement)) {
    return;
  }

  const rect = trigger.getBoundingClientRect();
  const gap = 4;
  const viewportMargin = 8;
  const fitsOnRight =
    rect.right + gap + CONTEXT_MENU_SIZE.width <= window.innerWidth - viewportMargin;
  const x = fitsOnRight
    ? rect.right + gap
    : Math.max(viewportMargin, rect.left - CONTEXT_MENU_SIZE.width - gap);
  const { y } = resolveMenuPlacement(
    { x: viewportMargin, y: rect.top - 4 },
    item.children.length,
  );

  activeSubmenuKey = item.key;
  subMenu.open = true;
  subMenu.x = x;
  subMenu.y = y;
}

function clearSubmenuCloseTimer(): void {
  if (closeSubmenuTimer) {
    window.clearTimeout(closeSubmenuTimer);
    closeSubmenuTimer = 0;
  }
}

function closeSubmenu(): void {
  clearSubmenuCloseTimer();
  activeSubmenuKey = "";
  subMenu.open = false;
}

// 给鼠标从父项移动到右侧子菜单预留极短时间，避免菜单闪退。
function scheduleSubmenuClose(): void {
  clearSubmenuCloseTimer();
  closeSubmenuTimer = window.setTimeout(closeSubmenu, 120);
}

function handleClose(reason: FloatingMenuCloseReason): void {
  closeSubmenu();
  emit("close", reason);
}

// 相邻操作属于不同语义组时自动绘制分隔线，调用方无需维护额外占位项。
function shouldSeparateItem(index: number): boolean {
  if (index <= 0) {
    return false;
  }

  const currentGroup = props.items[index]?.group;
  const previousGroup = props.items[index - 1]?.group;
  return Boolean(currentGroup && previousGroup && currentGroup !== previousGroup);
}

onUnmounted(clearSubmenuCloseTimer);
</script>

<template>
  <FloatingMenu
    :open="menu.open"
    :x="menu.x"
    :y="menu.y"
    class="context-menu"
    role="menu"
    prevent-context-menu
    @mouseenter="emit('menuEnter')"
    @mouseleave="emit('menuLeave')"
    @close="handleClose">
    <button
      v-for="(item, index) in items"
      :key="item.key"
      type="button"
      tabindex="-1"
      role="menuitem"
      :disabled="item.disabled"
      :class="{
        disabled: item.disabled,
        danger: item.danger,
        warning: item.warning,
        'has-children': item.children?.length,
        'has-desc': item.desc,
        'separator-before': shouldSeparateItem(index),
      }"
      @mouseenter="openSubmenu(item, $event)"
      @mouseleave="scheduleSubmenuClose"
      @click="selectMenuItem(item)">
      <span v-if="item.icon" class="menu-item-icon" aria-hidden="true">
        <img :src="item.icon" alt="" />
      </span>
      <span class="menu-item-text">
        <span class="menu-item-label">{{ item.label }}</span>
        <small v-if="item.desc">{{ item.desc }}</small>
      </span>
      <span
        v-if="item.children?.length"
        class="menu-item-submenu-indicator"
        aria-hidden="true">
        <img :src="chevronRightIcon" alt="" />
      </span>
    </button>
  </FloatingMenu>

  <Teleport to="body">
    <ContextMenu
      v-if="subMenu.open"
      class="context-submenu"
      :menu="subMenu"
      :items="items.find(item => item.key === activeSubmenuKey)?.children ?? []"
      @select="emit('select', $event)"
      @close="handleClose"
      @menu-enter="clearSubmenuCloseTimer"
      @menu-leave="scheduleSubmenuClose" />
  </Teleport>
</template>
