<script setup lang="ts">
import type { ContextMenuItem, ContextMenuState } from "../types/context-menu";

defineProps<{
  menu: ContextMenuState;
  items: ContextMenuItem[];
}>();

const emit = defineEmits<{
  select: [item: ContextMenuItem];
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
  <div
    v-if="menu.open"
    class="context-menu"
    :style="{
      left: `${menu.x}px`,
      top: `${menu.y}px`,
    }"
    role="menu"
    @click.stop
    @contextmenu.prevent.stop>
    <button
      v-for="item in items"
      :key="item.key"
      type="button"
      role="menuitem"
      :disabled="item.disabled"
      :class="{ disabled: item.disabled, danger: item.danger }"
      @click="selectMenuItem(item)">
      <img v-if="item.icon" :src="item.icon" alt="" />
      <span>{{ item.label }}</span>
    </button>
  </div>
</template>
