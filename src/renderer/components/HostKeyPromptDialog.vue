<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue";

import type { HostKeyPrompt } from "../../shared/host-key";
import AppDialog from "./AppDialog.vue";

/**
 * 主进程在首次连接或主机密钥变化时请求确认。多个确认排队逐个展示，
 * 关闭弹窗视为拒绝；主进程超时或其他窗口处理后会通知移除对应确认。
 */
const prompts = ref<HostKeyPrompt[]>([]);
const currentPrompt = computed(() => prompts.value[0]);
const isChanged = computed(() => currentPrompt.value?.kind === "changed");
const serverLabel = computed(() => {
  const prompt = currentPrompt.value;
  return prompt ? ` ${prompt.serverName}（${prompt.host}:${prompt.port}）` : "";
});
const isResponding = ref(false);

function enqueue(prompt: HostKeyPrompt): void {
  if (prompts.value.some(item => item.requestId === prompt.requestId)) return;
  prompts.value = [...prompts.value, prompt];
}

function remove(requestId: string): void {
  prompts.value = prompts.value.filter(item => item.requestId !== requestId);
}

async function respond(trust: boolean): Promise<void> {
  const prompt = currentPrompt.value;
  if (!prompt || isResponding.value) return;
  isResponding.value = true;
  try {
    await window.orbitSSH.hostKeys.respond({ requestId: prompt.requestId, trust });
  } finally {
    remove(prompt.requestId);
    isResponding.value = false;
  }
}

let removePromptListener: (() => void) | undefined;
let removeClosedListener: (() => void) | undefined;

onMounted(async () => {
  const hostKeys = window.orbitSSH?.hostKeys;
  if (!hostKeys) return;
  removePromptListener = hostKeys.onPrompt(enqueue);
  removeClosedListener = hostKeys.onPromptClosed(remove);
  (await hostKeys.listPending()).forEach(enqueue);
});

onUnmounted(() => {
  removePromptListener?.();
  removeClosedListener?.();
});
</script>

<template>
  <AppDialog
    v-if="currentPrompt"
    :title="isChanged ? '警告：服务器主机密钥已变更' : '确认服务器主机密钥'"
    width="medium"
    @close="respond(false)"
  >
    <section :class="['host-key-dialog', { changed: isChanged }]">
      <p v-if="isChanged" class="host-key-message">
        {{
          serverLabel
        }}出示的主机密钥与之前信任的不一致。这可能是服务器重装或更换了密钥，也可能有人正在拦截连接（中间人攻击）。确认原因之前不要继续连接。
      </p>
      <p v-else class="host-key-message">
        首次连接{{ serverLabel }}。请确认下面的主机密钥指纹与服务器一致，信任后才会发送登录凭据。
      </p>

      <dl class="host-key-fields">
        <template v-if="isChanged">
          <dt>之前信任</dt>
          <dd>
            <span>{{ currentPrompt.previousKeyType }}</span>
            <code>{{ currentPrompt.previousFingerprint }}</code>
          </dd>
        </template>
        <dt>{{ isChanged ? "当前出示" : "主机密钥" }}</dt>
        <dd>
          <span>{{ currentPrompt.keyType }}</span>
          <code>{{ currentPrompt.fingerprint }}</code>
        </dd>
      </dl>

      <p class="host-key-hint">
        可在服务器上执行 <code>ssh-keygen -lf /etc/ssh/ssh_host_*_key.pub</code> 核对指纹。
      </p>

      <footer class="dialog-actions">
        <template v-if="isChanged">
          <button
            type="button"
            class="btn btn-danger-soft"
            :disabled="isResponding"
            @click="respond(true)"
          >
            仍然信任新密钥
          </button>
          <button
            type="button"
            class="btn btn-primary"
            :disabled="isResponding"
            @click="respond(false)"
          >
            断开连接
          </button>
        </template>
        <template v-else>
          <button
            type="button"
            class="btn btn-ghost"
            :disabled="isResponding"
            @click="respond(false)"
          >
            取消
          </button>
          <button
            type="button"
            class="btn btn-primary"
            :disabled="isResponding"
            @click="respond(true)"
          >
            信任并连接
          </button>
        </template>
      </footer>
    </section>
  </AppDialog>
</template>
