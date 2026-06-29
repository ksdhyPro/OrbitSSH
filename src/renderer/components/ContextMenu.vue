<script setup lang="ts">
import type { ContextMenuItem, ContextMenuState } from "../types/context-menu";
import type { FloatingMenuCloseReason } from "../utils/floating-menu";
import FloatingMenu from "./FloatingMenu.vue";

defineProps<{
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
      v-for="item in items"
      :key="item.key"
      type="button"
      tabindex="-1"
      role="menuitem"
      :disabled="item.disabled"
      :class="{ disabled: item.disabled, danger: item.danger, 'has-desc': item.desc }"
      @click="selectMenuItem(item)">
      <img v-if="item.icon" :src="item.icon" alt="" />
      <span class="menu-item-text">
        <span class="menu-item-label">{{ item.label }}</span>
        <small v-if="item.desc">{{ item.desc }}</small>
      </span>
    </button>
  </FloatingMenu>
</template>
