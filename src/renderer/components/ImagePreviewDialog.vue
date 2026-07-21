<script setup lang="ts">
import {
  computed,
  nextTick,
  onMounted,
  onUnmounted,
  ref,
  watch,
} from "vue";
import {
  PhCornersIn,
  PhFrameCorners,
  PhMagnifyingGlassMinus,
  PhMagnifyingGlassPlus,
} from "@phosphor-icons/vue";
import type { ImagePreviewState } from "../types/sftp";
import AppDialog from "./AppDialog.vue";

const props = defineProps<{
  open: boolean;
  imagePreview: ImagePreviewState;
}>();

const emit = defineEmits<{
  close: [];
  download: [];
}>();

const MIN_ZOOM = 0.1;
const MAX_ZOOM = 8;
const ZOOM_FACTOR = 1.15;
const previewBody = ref<HTMLElement | null>(null);
const naturalWidth = ref(0);
const naturalHeight = ref(0);
const zoom = ref(1);
const fitZoom = ref(1);
const followsFit = ref(true);
const isDragging = ref(false);
let dragPointerId: number | null = null;
let dragStartX = 0;
let dragStartY = 0;
let dragStartScrollLeft = 0;
let dragStartScrollTop = 0;

const zoomPercent = computed(() => Math.round(zoom.value * 100));
const isPannable = computed(
  () =>
    Boolean(naturalWidth.value && naturalHeight.value) &&
    zoom.value > fitZoom.value + 0.001,
);
const imageStyle = computed(() => {
  if (!naturalWidth.value || !naturalHeight.value) return undefined;
  return {
    width: `${Math.max(1, Math.round(naturalWidth.value * zoom.value))}px`,
    height: `${Math.max(1, Math.round(naturalHeight.value * zoom.value))}px`,
  };
});

function clampZoom(value: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, value));
}

function calculateFitZoom(): number {
  const body = previewBody.value;
  if (!body || !naturalWidth.value || !naturalHeight.value) return 1;
  const availableWidth = Math.max(body.clientWidth - 48, 1);
  const availableHeight = Math.max(body.clientHeight - 48, 1);
  return clampZoom(
    Math.min(
      availableWidth / naturalWidth.value,
      availableHeight / naturalHeight.value,
      1,
    ),
  );
}

function updateFitZoom(): void {
  fitZoom.value = calculateFitZoom();
  if (followsFit.value) zoom.value = fitZoom.value;
}

function fitToViewport(): void {
  followsFit.value = true;
  updateFitZoom();
  previewBody.value?.scrollTo({ left: 0, top: 0 });
}

function setZoom(value: number): void {
  followsFit.value = false;
  zoom.value = clampZoom(value);
}

function showActualSize(): void {
  setZoom(1);
}

function handleImageLoad(event: Event): void {
  const image = event.target as HTMLImageElement;
  naturalWidth.value = image.naturalWidth;
  naturalHeight.value = image.naturalHeight;
  fitToViewport();
}

async function zoomAroundPoint(
  nextZoom: number,
  clientX?: number,
  clientY?: number,
): Promise<void> {
  const body = previewBody.value;
  const previousZoom = zoom.value;
  const normalizedZoom = clampZoom(nextZoom);
  if (!body || normalizedZoom === previousZoom) return;

  const rect = body.getBoundingClientRect();
  const pointX = clientX === undefined ? body.clientWidth / 2 : clientX - rect.left;
  const pointY = clientY === undefined ? body.clientHeight / 2 : clientY - rect.top;
  const contentX = body.scrollLeft + pointX;
  const contentY = body.scrollTop + pointY;
  setZoom(normalizedZoom);
  await nextTick();

  const ratio = normalizedZoom / previousZoom;
  body.scrollLeft = contentX * ratio - pointX;
  body.scrollTop = contentY * ratio - pointY;
}

function handleZoomSlider(event: Event): void {
  const percent = Number((event.target as HTMLInputElement).value);
  void zoomAroundPoint(percent / 100);
}

function handlePreviewWheel(event: WheelEvent): void {
  if (!event.ctrlKey && !event.metaKey) return;
  event.preventDefault();
  const factor = event.deltaY < 0 ? ZOOM_FACTOR : 1 / ZOOM_FACTOR;
  void zoomAroundPoint(zoom.value * factor, event.clientX, event.clientY);
}

function handlePreviewPointerDown(event: PointerEvent): void {
  const body = previewBody.value;
  if (!body || event.button !== 0 || !isPannable.value) return;

  event.preventDefault();
  isDragging.value = true;
  dragPointerId = event.pointerId;
  dragStartX = event.clientX;
  dragStartY = event.clientY;
  dragStartScrollLeft = body.scrollLeft;
  dragStartScrollTop = body.scrollTop;
  body.setPointerCapture(event.pointerId);
}

function handlePreviewPointerMove(event: PointerEvent): void {
  const body = previewBody.value;
  if (!body || !isDragging.value || dragPointerId !== event.pointerId) return;

  event.preventDefault();
  body.scrollLeft = dragStartScrollLeft - (event.clientX - dragStartX);
  body.scrollTop = dragStartScrollTop - (event.clientY - dragStartY);
}

function finishPreviewDrag(event: PointerEvent): void {
  const body = previewBody.value;
  if (!isDragging.value || dragPointerId !== event.pointerId) return;

  isDragging.value = false;
  dragPointerId = null;
  if (body?.hasPointerCapture(event.pointerId)) {
    body.releasePointerCapture(event.pointerId);
  }
}

function handlePreviewLostPointerCapture(event: PointerEvent): void {
  if (dragPointerId !== event.pointerId) return;
  isDragging.value = false;
  dragPointerId = null;
}

function handleWindowResize(): void {
  updateFitZoom();
}

watch(
  () => [props.open, props.imagePreview.dataUrl] as const,
  async ([open]) => {
    if (!open) return;
    naturalWidth.value = 0;
    naturalHeight.value = 0;
    zoom.value = 1;
    fitZoom.value = 1;
    followsFit.value = true;
    isDragging.value = false;
    dragPointerId = null;
    await nextTick();
    updateFitZoom();
  },
);

onMounted(() => window.addEventListener("resize", handleWindowResize));
onUnmounted(() => window.removeEventListener("resize", handleWindowResize));
</script>

<template>
  <AppDialog
    v-if="open"
    :title="imagePreview.name || '图片预览'"
    :description="imagePreview.path"
    width="large"
    @close="emit('close')">
    <section class="image-preview-shell">
      <div v-if="imagePreview.loading" class="image-preview-state">
        正在加载图片...
      </div>
      <div v-else-if="imagePreview.error" class="image-preview-state error">
        {{ imagePreview.error }}
      </div>
      <template v-else>
        <nav class="image-preview-toolbar" aria-label="图片缩放">
          <button
            type="button"
            title="缩小"
            aria-label="缩小"
            :disabled="zoom <= MIN_ZOOM"
            @click="zoomAroundPoint(zoom / ZOOM_FACTOR)">
            <PhMagnifyingGlassMinus :size="16" aria-hidden="true" />
          </button>
          <input
            type="range"
            :min="MIN_ZOOM * 100"
            :max="MAX_ZOOM * 100"
            step="5"
            :value="zoomPercent"
            aria-label="缩放比例"
            @input="handleZoomSlider" />
          <output>{{ zoomPercent }}%</output>
          <button
            type="button"
            title="放大"
            aria-label="放大"
            :disabled="zoom >= MAX_ZOOM"
            @click="zoomAroundPoint(zoom * ZOOM_FACTOR)">
            <PhMagnifyingGlassPlus :size="16" aria-hidden="true" />
          </button>
          <span class="image-preview-toolbar-divider" aria-hidden="true"></span>
          <button
            type="button"
            title="适应窗口"
            aria-label="适应窗口"
            :class="{ active: followsFit }"
            @click="fitToViewport">
            <PhCornersIn :size="16" aria-hidden="true" />
          </button>
          <button
            type="button"
            title="实际大小"
            aria-label="实际大小"
            :class="{ active: !followsFit && Math.abs(zoom - 1) < 0.001 }"
            @click="showActualSize">
            <PhFrameCorners :size="16" aria-hidden="true" />
          </button>
        </nav>
        <div
          ref="previewBody"
          :class="[
            'image-preview-body',
            { pannable: isPannable, dragging: isDragging },
          ]"
          @wheel="handlePreviewWheel"
          @pointerdown="handlePreviewPointerDown"
          @pointermove="handlePreviewPointerMove"
          @pointerup="finishPreviewDrag"
          @pointercancel="finishPreviewDrag"
          @lostpointercapture="handlePreviewLostPointerCapture">
          <div class="image-preview-canvas">
            <img
              :src="imagePreview.dataUrl"
              :alt="imagePreview.name"
              :style="imageStyle"
              draggable="false"
              @load="handleImageLoad" />
          </div>
        </div>
      </template>

      <footer class="file-editor-footer">
        <span>{{ imagePreview.mimeType || "图片文件" }}</span>
        <div class="dialog-actions">
          <button type="button" class="ghost-button" @click="emit('close')">
            关闭
          </button>
          <button
            type="button"
            class="primary-button"
            :disabled="imagePreview.loading || !imagePreview.path"
            @click="emit('download')">
            下载
          </button>
        </div>
      </footer>
    </section>
  </AppDialog>
</template>
