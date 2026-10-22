<script setup lang="ts">
import { ref, watch } from "vue";

import { buildMcpInstallPrompt } from "../../utils/mcp-install-prompt";
import AppDialog from "../AppDialog.vue";

const props = defineProps<{ open: boolean }>();
const emit = defineEmits<{ close: [] }>();

const prompt = ref("");
const message = ref("");
const loading = ref(false);

// 每次打开都从主进程读取当前安装位置，安装路径随打包方式不同而变化。
watch(
  () => props.open,
  async open => {
    if (!open) return;
    loading.value = true;
    message.value = "";
    prompt.value = "";
    try {
      prompt.value = buildMcpInstallPrompt(await window.orbitSSH.getMcpInstallInfo());
    } catch (error) {
      message.value = `生成安装提示词失败：${error instanceof Error ? error.message : String(error)}`;
    } finally {
      loading.value = false;
    }
  },
  { immediate: true },
);

async function copyPrompt(): Promise<void> {
  if (!prompt.value) return;

  try {
    await window.orbitSSH.clipboard.writeText(prompt.value);
    message.value = "安装提示词已复制。";
  } catch (error) {
    message.value = `复制失败：${error instanceof Error ? error.message : String(error)}`;
  }
}
</script>

<template>
  <AppDialog
    v-if="open"
    title="如何安装到 Agent？"
    description="复制下面的提示词并发送给你的 AI 客户端。"
    width="large"
    @close="emit('close')"
  >
    <div class="mcp-install-dialog">
      <p class="mcp-install-tip">
        适用于支持本地 STDIO MCP 的 AI 客户端。安装完成后，通常需要重启客户端或新建会话。
      </p>
      <textarea
        class="mcp-install-prompt"
        :value="prompt"
        readonly
        spellcheck="false"
        aria-label="OrbitSSH Agent 安装提示词"
        :placeholder="loading ? '正在生成安装提示词…' : ''"
      />
      <div class="mcp-install-actions">
        <span :class="{ 'is-error': message.includes('失败') }">
          {{ message }}
        </span>
        <button
          type="button"
          class="btn btn-primary"
          :disabled="loading || !prompt"
          @click="copyPrompt"
        >
          复制提示词
        </button>
      </div>
    </div>
  </AppDialog>
</template>
