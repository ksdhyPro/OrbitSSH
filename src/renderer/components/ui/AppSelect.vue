<script setup lang="ts">
import arrowDownIcon from "../../assets/icons/arrow-down.svg";

export interface AppSelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

defineProps<{
  options: AppSelectOption[];
  placeholder?: string;
  title?: string;
  ariaLabel: string;
  disabled?: boolean;
}>();

const model = defineModel<string>({ required: true });
</script>

<template>
  <label class="app-select">
    <select
      v-model="model"
      :title="title"
      :aria-label="ariaLabel"
      :disabled="disabled">
      <option v-if="placeholder" value="">{{ placeholder }}</option>
      <option
        v-for="option in options"
        :key="option.value"
        :value="option.value"
        :disabled="option.disabled">
        {{ option.label }}
      </option>
    </select>
    <img :src="arrowDownIcon" alt="" />
  </label>
</template>
