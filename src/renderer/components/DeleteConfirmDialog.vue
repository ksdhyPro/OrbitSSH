<script setup lang="ts">
import AppDialog from "./AppDialog.vue";

defineProps<{
  open: boolean;
  message: string;
  title?: string;
  confirmLabel?: string;
  danger?: boolean;
}>();

const emit = defineEmits<{
  cancel: [];
  confirm: [];
}>();
</script>

<template>
  <AppDialog
    v-if="open"
    :title="title ?? '确认删除'"
    width="small"
    @close="emit('cancel')">
    <section class="confirm-dialog-content delete-confirm-content">
      <p class="delete-confirm-message">{{ message }}</p>
      <footer class="dialog-actions">
        <button type="button" class="ghost-button" @click="emit('cancel')">
          取消
        </button>
        <button
          type="button"
          :class="danger === false ? 'primary-button' : 'danger-button'"
          @click="emit('confirm')">
          {{ confirmLabel ?? "删除" }}
        </button>
      </footer>
    </section>
  </AppDialog>
</template>
