<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, useAttrs } from "vue";
import type { CSSProperties } from "vue";
import {
  registerFloatingMenu,
  type FloatingMenuCloseReason,
} from "../utils/floating-menu";

defineOptions({
  inheritAttrs: false,
});

const props = withDefaults(
  defineProps<{
    open: boolean;
    x?: number;
    y?: number;
    menuId?: string;
    preventContextMenu?: boolean;
  }>(),
  {
    preventContextMenu: false,
  },
);

const emit = defineEmits<{
  close: [reason: FloatingMenuCloseReason];
}>();

const attrs = useAttrs();
const rootElement = ref<HTMLElement | null>(null);
const resolvedMenuId = props.menuId ?? `floating-menu-${crypto.randomUUID()}`;
let unregisterFloatingMenu: (() => void) | null = null;

const placementStyle = computed<CSSProperties>(() => {
  if (typeof props.x !== "number" || typeof props.y !== "number") {
    return {};
  }

  return {
    left: `${props.x}px`,
    top: `${props.y}px`,
    transformOrigin: `${props.x}px top`,
  };
});

// 统一响应全局关闭请求，组件未打开时忽略，避免重复派发关闭事件。
function requestClose(reason: FloatingMenuCloseReason): void {
  if (!props.open) {
    return;
  }

  emit("close", reason);
}

function handleContextMenu(event: MouseEvent): void {
  if (props.preventContextMenu) {
    event.preventDefault();
  }

  event.stopPropagation();
}

onMounted(() => {
  unregisterFloatingMenu = registerFloatingMenu({
    id: resolvedMenuId,
    close: requestClose,
    getElement: () => rootElement.value,
    isOpen: () => props.open,
  });
});

onUnmounted(() => {
  unregisterFloatingMenu?.();
  unregisterFloatingMenu = null;
});
</script>

<template>
  <Transition name="context-menu">
    <div
      v-if="open"
      ref="rootElement"
      v-bind="attrs"
      :style="[placementStyle, attrs.style]"
      @click.stop
      @contextmenu="handleContextMenu"
      @wheel.stop>
      <slot />
    </div>
  </Transition>
</template>
