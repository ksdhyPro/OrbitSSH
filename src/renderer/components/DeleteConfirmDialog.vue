<script setup lang="ts">
import AppDialog from "./AppDialog.vue";

defineProps<{
  open: boolean;
  message: string;
}>();

const emit = defineEmits<{
  cancel: [];
  confirm: [];
}>();
</script>

<template>
  <AppDialog
    v-if="open"
    title="确认删除"
    description="删除后无法通过应用恢复，请确认后继续。"
    width="medium"
    @close="emit('cancel')">
    <section class="confirm-dialog-content">
      <p class="delete-confirm-message">{{ message }}</p>
      <footer class="dialog-actions">
        <button type="button" class="ghost-button" @click="emit('cancel')">
          取消
        </button>
        <button type="button" class="danger-button" @click="emit('confirm')">
          删除
        </button>
      </footer>
    </section>
  </AppDialog>
</template>
