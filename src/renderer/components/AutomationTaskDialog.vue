<script setup lang="ts">
import AppDialog from './AppDialog.vue'

defineProps<{
  open: boolean
  serverName: string
  form: { name: string; script: string }
  error: string
  isSubmitting: boolean
}>()

const emit = defineEmits<{ close: []; submit: [] }>()
</script>

<template>
  <AppDialog
    v-if="open"
    :title="`新建自动化任务 · ${serverName}`"
    description="脚本会通过独立 SSH 会话执行，不影响当前终端。"
    width="medium"
    @close="emit('close')">
    <form class="automation-task-form" @submit.prevent="emit('submit')">
      <label>
        <span>任务名称</span>
        <input v-model="form.name" type="text" maxlength="100" placeholder="例如：部署服务" />
      </label>
      <label>
        <span>执行脚本</span>
        <textarea
          v-model="form.script"
          rows="9"
          maxlength="20000"
          spellcheck="false"
          placeholder="例如：&#10;docker compose pull&#10;docker compose up -d"></textarea>
      </label>
      <p class="automation-task-hint">每个非空行是一条 Shell 命令，执行前会再次展示内容供确认。</p>
      <p v-if="error" class="form-error">{{ error }}</p>
      <footer class="dialog-actions">
        <button type="button" class="ghost-button" @click="emit('close')">取消</button>
        <button type="submit" class="primary-button" :disabled="isSubmitting">
          {{ isSubmitting ? '保存中…' : '保存任务' }}
        </button>
      </footer>
    </form>
  </AppDialog>
</template>
