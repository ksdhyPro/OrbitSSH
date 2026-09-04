<script setup lang="ts">
import AppDialog from "./AppDialog.vue";

defineProps<{ open: boolean; color?: string; title: string }>();
const emit = defineEmits<{ close: []; select: [color: string]; clear: [] }>();
</script>

<template>
  <AppDialog v-if="open" :title="title" description="选择条目的背景色。" width="small" @close="emit('close')">
    <section class="color-picker-dialog"><input :value="color ?? '#ffffff'" type="color" aria-label="背景色" @input="emit('select', ($event.target as HTMLInputElement).value)" /><footer class="dialog-actions"><button type="button" class="ghost-button" @click="emit('clear')">清除颜色</button><button type="button" class="primary-button" @click="emit('close')">完成</button></footer></section>
  </AppDialog>
</template>
