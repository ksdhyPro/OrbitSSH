<script setup lang="ts">
import type { UpdateStatus } from "../../shared/settings";
import AppDialog from "./AppDialog.vue";

defineProps<{
  open: boolean;
  status: UpdateStatus;
  currentVersion: string;
  newVersion?: string;
  releaseDate?: string;
  releaseNotes?: string;
  downloadProgress: number;
  error?: string;
}>();

const emit = defineEmits<{
  close: [];
  check: [];
  download: [];
  install: [];
}>();
</script>

<template>
  <AppDialog
    v-if="open"
    title="检查更新"
    description="查看是否有新版本可用。"
    width="medium"
    @close="emit('close')">
    <div class="update-dialog-content">
      <!-- 当前版本 -->
      <div class="settings-field">
        <div>
          <h3>当前版本</h3>
          <p>已安装的 OrbitSSH 版本号。</p>
        </div>
        <span class="update-version-label">{{ currentVersion || '—' }}</span>
      </div>

      <!-- 状态与操作 -->
      <div class="settings-field">
        <div>
          <h3>更新状态</h3>
          <p>
            <template v-if="status === 'idle'">
              点击下方按钮检查是否有新版本。
            </template>
            <template v-else-if="status === 'checking'">
              正在检查更新…
            </template>
            <template v-else-if="status === 'update-available'">
              <span class="update-available-text">
                发现新版本 {{ newVersion }}
                <template v-if="releaseDate">（{{ releaseDate }}）</template>
              </span>
              <template v-if="releaseNotes">
                <br />更新内容：{{ releaseNotes }}
              </template>
            </template>
            <template v-else-if="status === 'update-not-available'">
              已是最新版本。
            </template>
            <template v-else-if="status === 'downloading'">
              正在下载更新… {{ downloadProgress }}%
            </template>
            <template v-else-if="status === 'downloaded'">
              更新已下载，点击"安装并重启"完成更新。
            </template>
            <template v-else-if="status === 'error'">
              <span class="update-error-text">错误：{{ error }}</span>
            </template>
          </p>
        </div>
        <div class="update-actions">
          <button
            v-if="status !== 'downloading'"
            type="button"
            :disabled="status === 'checking'"
            @click="emit('check')">
            检查更新
          </button>
          <button
            v-if="status === 'update-available'"
            type="button"
            @click="emit('download')">
            下载更新
          </button>
          <button
            v-if="status === 'downloaded'"
            type="button"
            class="update-install-btn"
            @click="emit('install')">
            安装并重启
          </button>
        </div>
      </div>

      <!-- 下载进度条 -->
      <div v-if="status === 'downloading'" class="settings-field">
        <div class="update-progress-bar-track">
          <div
            class="update-progress-bar-fill"
            :style="{ width: downloadProgress + '%' }"></div>
        </div>
      </div>
    </div>
  </AppDialog>
</template>
