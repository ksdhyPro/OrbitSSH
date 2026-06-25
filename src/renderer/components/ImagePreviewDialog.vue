<script setup lang="ts">
import type { ImagePreviewState } from "../types/sftp";
import AppDialog from "./AppDialog.vue";

defineProps<{
  open: boolean;
  imagePreview: ImagePreviewState;
}>();

const emit = defineEmits<{
  close: [];
  download: [];
}>();
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
      <div v-else class="image-preview-body">
        <img :src="imagePreview.dataUrl" :alt="imagePreview.name" />
      </div>

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
