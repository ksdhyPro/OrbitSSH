<script setup lang="ts">
import type { ServerAutomationTask } from '../../shared/server'
import AppDialog from './AppDialog.vue'

defineProps<{
  open: boolean
  serverName: string
  task: ServerAutomationTask | null
}>()

const emit = defineEmits<{ close: []; start: [] }>()
</script>

<template>
  <AppDialog
    v-if="open && task"
    :title="`执行任务 · ${task.name}`"
    :description="`目标服务器：${serverName}`"
    width="medium"
    @close="emit('close')">
    <section class="automation-run-dialog">
      <p class="automation-run-notice">确认后将新建独立终端标签执行。每个非空行是一条命令，上一条结束后才会发送下一条；关闭该标签会停止后续命令。</p>
      <pre class="automation-script-preview">{{ task.script }}</pre>
      <footer class="dialog-actions">
        <button type="button" class="ghost-button" @click="emit('close')">取消</button>
        <button type="button" class="primary-button" @click="emit('start')">新建终端并执行</button>
      </footer>
    </section>
  </AppDialog>
</template>
