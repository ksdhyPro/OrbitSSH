<script setup lang="ts">
import {
  computed,
  nextTick,
  onMounted,
  onUnmounted,
  onUpdated,
  ref,
  useAttrs,
  watch,
} from "vue";
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
const adjustedX = ref<number | null>(null);
const adjustedY = ref<number | null>(null);
const resolvedMenuId = props.menuId ?? `floating-menu-${crypto.randomUUID()}`;
let unregisterFloatingMenu: (() => void) | null = null;
let placementFrame = 0;

const VIEWPORT_MARGIN = 8;

const placementStyle = computed<CSSProperties>(() => {
  if (typeof props.x !== "number" || typeof props.y !== "number") {
    return {};
  }

  const x = adjustedX.value ?? props.x;
  const y = adjustedY.value ?? props.y;

  return {
    left: `${x}px`,
    top: `${y}px`,
    transformOrigin: `${x}px top`,
  };
});

function setAdjustedPlacement(x: number, y: number): void {
  if (adjustedX.value !== x) {
    adjustedX.value = x;
  }

  if (adjustedY.value !== y) {
    adjustedY.value = y;
  }
}

function updateMeasuredPlacement(): void {
  if (!props.open || typeof props.x !== "number" || typeof props.y !== "number") {
    adjustedX.value = null;
    adjustedY.value = null;
    return;
  }

  const element = rootElement.value;

  if (!element) {
    setAdjustedPlacement(props.x, props.y);
    return;
  }

  const rect = element.getBoundingClientRect();
  let offsetX = 0;
  let offsetY = 0;

  if (rect.right > window.innerWidth - VIEWPORT_MARGIN) {
    offsetX = window.innerWidth - VIEWPORT_MARGIN - rect.right;
  }

  if (rect.left + offsetX < VIEWPORT_MARGIN) {
    offsetX += VIEWPORT_MARGIN - (rect.left + offsetX);
  }

  if (rect.bottom > window.innerHeight - VIEWPORT_MARGIN) {
    offsetY = window.innerHeight - VIEWPORT_MARGIN - rect.bottom;
  }

  if (rect.top + offsetY < VIEWPORT_MARGIN) {
    offsetY += VIEWPORT_MARGIN - (rect.top + offsetY);
  }

  setAdjustedPlacement(
    (adjustedX.value ?? props.x) + offsetX,
    (adjustedY.value ?? props.y) + offsetY,
  );
}

async function scheduleMeasuredPlacement(): Promise<void> {
  if (placementFrame) {
    cancelAnimationFrame(placementFrame);
  }

  await nextTick();

  placementFrame = requestAnimationFrame(() => {
    placementFrame = 0;
    updateMeasuredPlacement();
  });
}

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
  if (placementFrame) {
    cancelAnimationFrame(placementFrame);
    placementFrame = 0;
  }

  unregisterFloatingMenu?.();
  unregisterFloatingMenu = null;
});

onUpdated(() => {
  if (props.open) {
    void scheduleMeasuredPlacement();
  }
});

watch(
  () => [props.open, props.x, props.y] as const,
  () => {
    if (!props.open || typeof props.x !== "number" || typeof props.y !== "number") {
      adjustedX.value = null;
      adjustedY.value = null;
      return;
    }

    setAdjustedPlacement(props.x, props.y);
    void scheduleMeasuredPlacement();
  },
  { flush: "post" },
);
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
