<script setup lang="ts">
import { ref } from 'vue'

import type { ServerAutomationTask } from '../../shared/server'
import copyIcon from '../assets/icons/copy.svg'
import { copyTextByFallback } from '../utils/clipboard'
import AppDialog from './AppDialog.vue'

defineProps<{
  open: boolean
  serverName: string
  task: ServerAutomationTask | null
}>()

const emit = defineEmits<{ close: []; start: [] }>()

const copied = ref(false)
let copiedTimer: ReturnType<typeof setTimeout> | undefined

async function copyTaskScript(task: ServerAutomationTask | null): Promise<void> {
  if (!task?.script) return

  try {
    if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(task.script)
    else if (!copyTextByFallback(task.script)) throw new Error('复制失败')

    copied.value = true
    if (copiedTimer) clearTimeout(copiedTimer)
    copiedTimer = setTimeout(() => {
      copied.value = false
      copiedTimer = undefined
    }, 1500)
  } catch {
    // 剪贴板不可用时保持按钮可继续点击，不影响执行指令。
    copied.value = false
  }
}
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
      <div class="automation-script-preview-wrap">
        <pre class="automation-script-preview">{{ task.script }}</pre>
        <button
          type="button"
          class="automation-script-copy-button"
          :aria-label="copied ? '指令已复制' : '复制自定义指令'"
          :title="copied ? '指令已复制' : '复制自定义指令'"
          @click="copyTaskScript(task)">
          <span v-if="copied">已复制</span>
          <img v-else :src="copyIcon" alt="" />
        </button>
      </div>
      <footer class="dialog-actions">
        <button type="button" class="ghost-button" @click="emit('close')">取消</button>
        <button type="button" class="primary-button" @click="emit('start')">新建终端并执行</button>
      </footer>
    </section>
  </AppDialog>
</template>
