<script setup lang="ts">
import { computed } from "vue";
import { PhDownloadSimple, PhFile } from "@phosphor-icons/vue";
import {
  isAiTextAttachment,
  type AiMessageAttachment,
} from "../../shared/ai";
import AppDialog from "./AppDialog.vue";

const props = defineProps<{
  attachment: AiMessageAttachment | null;
}>();

const emit = defineEmits<{
  close: [];
}>();

const MAX_TEXT_PREVIEW_BYTES = 256 * 1024;

const isPdf = computed(
  () => props.attachment?.mimeType.toLowerCase() === "application/pdf",
);
const isAudio = computed(() =>
  props.attachment?.mimeType.toLowerCase().startsWith("audio/"),
);
const isVideo = computed(() =>
  props.attachment?.mimeType.toLowerCase().startsWith("video/"),
);
const isText = computed(() => {
  const attachment = props.attachment;
  return attachment ? isAiTextAttachment(attachment) : false;
});

const textPreview = computed((): { text: string; truncated: boolean } => {
  const attachment = props.attachment;
  if (!attachment?.dataUrl || !isText.value) {
    return { text: "", truncated: false };
  }
  try {
    const separatorIndex = attachment.dataUrl.indexOf(",");
    if (separatorIndex < 0) return { text: "", truncated: false };
    const metadata = attachment.dataUrl.slice(0, separatorIndex);
    const payload = attachment.dataUrl.slice(separatorIndex + 1);
    if (!metadata.includes(";base64")) {
      const encodedPreview = payload
        .slice(0, MAX_TEXT_PREVIEW_BYTES * 3)
        .replace(/%(?:[0-9a-f]?)$/i, "");
      return {
        text: decodeURIComponent(encodedPreview),
        truncated: encodedPreview.length < payload.length,
      };
    }
    const maxPayloadChars = Math.ceil(MAX_TEXT_PREVIEW_BYTES / 3) * 4;
    const previewLength = Math.min(payload.length, maxPayloadChars);
    const alignedLength = previewLength - (previewLength % 4);
    const binary = atob(payload.slice(0, alignedLength));
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return {
      text: new TextDecoder().decode(bytes),
      truncated: bytes.length < attachment.size,
    };
  } catch {
    return { text: "文件内容无法解码。", truncated: false };
  }
});

function formatFileSize(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function downloadAttachment(): void {
  const attachment = props.attachment;
  if (!attachment?.dataUrl) return;
  const anchor = document.createElement("a");
  anchor.href = attachment.dataUrl;
  anchor.download = attachment.name;
  anchor.click();
}
</script>

<template>
  <AppDialog
    v-if="attachment"
    :title="attachment.name"
    :description="`${attachment.mimeType || '未知类型'} · ${formatFileSize(attachment.size)}`"
    width="editor"
    @close="emit('close')">
    <section class="ai-attachment-preview-shell">
      <div v-if="!attachment.dataUrl" class="ai-attachment-preview-empty">
        <PhFile :size="34" aria-hidden="true" />
        <strong>附件内容不可用</strong>
        <span>该附件可能来自旧版本，或本地附件缓存已被清理。</span>
      </div>
      <pre v-else-if="isText" class="ai-attachment-text-preview">{{ textPreview.text }}</pre>
      <iframe
        v-else-if="isPdf"
        class="ai-attachment-document-preview"
        :src="attachment.dataUrl"
        :title="attachment.name"></iframe>
      <div v-else-if="isAudio" class="ai-attachment-media-preview">
        <audio :src="attachment.dataUrl" controls></audio>
      </div>
      <div v-else-if="isVideo" class="ai-attachment-media-preview">
        <video :src="attachment.dataUrl" controls></video>
      </div>
      <div v-else class="ai-attachment-preview-empty">
        <PhFile :size="34" aria-hidden="true" />
        <strong>{{ attachment.name }}</strong>
        <span>该文件类型暂不支持应用内预览，可以下载后使用系统应用打开。</span>
      </div>

      <footer class="file-editor-footer">
        <span>
          {{ formatFileSize(attachment.size) }}
          <template v-if="textPreview.truncated"> · 仅预览前 256 KB</template>
        </span>
        <div class="dialog-actions">
          <button type="button" class="ghost-button" @click="emit('close')">
            关闭
          </button>
          <button
            type="button"
            class="primary-button"
            :disabled="!attachment.dataUrl"
            @click="downloadAttachment">
            <PhDownloadSimple :size="15" aria-hidden="true" />
            下载
          </button>
        </div>
      </footer>
    </section>
  </AppDialog>
</template>
