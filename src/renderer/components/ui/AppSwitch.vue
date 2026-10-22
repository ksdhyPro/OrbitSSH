<script setup lang="ts">
defineProps<{
  ariaLabel: string;
  disabled?: boolean;
}>();

const model = defineModel<boolean>({ required: true });
</script>

<template>
  <label :class="['app-switch', { disabled }]">
    <input
      type="checkbox"
      role="switch"
      :checked="model"
      :disabled="disabled"
      :aria-label="ariaLabel"
      @change="model = ($event.target as HTMLInputElement).checked"
    />
    <slot />
  </label>
</template>
