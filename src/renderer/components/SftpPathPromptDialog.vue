<script setup lang="ts">
import AppDialog from "./AppDialog.vue";

defineProps<{
  open: boolean;
  title: string;
  message: string;
}>();

const emit = defineEmits<{
  close: [];
}>();
</script>

<template>
  <AppDialog
    v-if="open"
    :title="title"
    :description="message"
    width="medium"
    @close="emit('close')">
    <section class="confirm-dialog-content">
      <footer class="dialog-actions">
        <button type="button" class="btn btn-primary" @click="emit('close')">
          知道了
        </button>
      </footer>
    </section>
  </AppDialog>
</template>
