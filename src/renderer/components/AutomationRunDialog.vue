<script setup lang="ts">
import type { ServerAutomationTask } from '../../shared/server'
import type { AutomationTaskRunStatus } from '../../shared/automation'
import AppDialog from './AppDialog.vue'

defineProps<{
  open: boolean
  serverName: string
  task: ServerAutomationTask | null
  status: AutomationTaskRunStatus
  output: string
  error: string
}>()

const emit = defineEmits<{ close: []; start: []; cancel: [] }>()
</script>

<template>
  <AppDialog
    v-if="open && task"
    :title="status === 'confirm' ? `执行任务 · ${task.name}` : `任务输出 · ${task.name}`"
    :description="`目标服务器：${serverName}`"
    width="medium"
    @close="status === 'running' ? emit('cancel') : emit('close')">
    <section class="automation-run-dialog">
      <template v-if="status === 'confirm'">
        <p class="automation-run-notice">将通过独立 SSH 会话执行以下脚本，当前终端不会被占用。</p>
        <pre class="automation-script-preview">{{ task.script }}</pre>
      </template>
      <template v-else>
        <div :class="['automation-run-status', `is-${status}`]">
          {{ status === 'running' ? '正在执行…' : status === 'completed' ? '执行完成' : status === 'cancelled' ? '已取消' : '执行失败' }}
        </div>
        <pre class="automation-run-output">{{ output || '等待服务器输出…' }}</pre>
        <p v-if="error" class="form-error">{{ error }}</p>
      </template>
      <footer class="dialog-actions">
        <button v-if="status === 'confirm'" type="button" class="ghost-button" @click="emit('close')">取消</button>
        <button v-else-if="status === 'running'" type="button" class="ghost-button" @click="emit('cancel')">停止任务</button>
        <button v-else type="button" class="primary-button" @click="emit('close')">关闭</button>
        <button v-if="status === 'confirm'" type="button" class="primary-button" @click="emit('start')">开始执行</button>
      </footer>
    </section>
  </AppDialog>
</template>
