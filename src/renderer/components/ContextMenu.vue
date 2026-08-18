<script setup lang="ts">
import type { ContextMenuItem, ContextMenuState } from "../types/context-menu";
import type { FloatingMenuCloseReason } from "../utils/floating-menu";
import FloatingMenu from "./FloatingMenu.vue";

const props = defineProps<{
  menu: ContextMenuState;
  items: ContextMenuItem[];
}>();

const emit = defineEmits<{
  select: [item: ContextMenuItem];
  close: [reason: FloatingMenuCloseReason];
}>();

// 统一处理菜单项点击，禁用项不向外派发事件。
function selectMenuItem(item: ContextMenuItem): void {
  if (item.disabled) {
    return;
  }

  emit("select", item);
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
</script>

<template>
  <FloatingMenu
    :open="menu.open"
    :x="menu.x"
    :y="menu.y"
    class="context-menu"
    role="menu"
    prevent-context-menu
    @close="emit('close', $event)">
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
        'has-desc': item.desc,
        'separator-before': shouldSeparateItem(index),
      }"
      @click="selectMenuItem(item)">
      <span v-if="item.icon" class="menu-item-icon" aria-hidden="true">
        <img :src="item.icon" alt="" />
      </span>
      <span class="menu-item-text">
        <span class="menu-item-label">{{ item.label }}</span>
        <small v-if="item.desc">{{ item.desc }}</small>
      </span>
    </button>
  </FloatingMenu>
</template>
