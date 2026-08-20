<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import chevronRightIcon from "../assets/icons/chevron-right.svg";

export interface AppSelectOption {
  value: string;
  label: string;
  detail?: string;
}

const props = defineProps<{
  modelValue: string;
  options: AppSelectOption[];
  ariaLabel: string;
}>();

const emit = defineEmits<{
  "update:modelValue": [value: string];
}>();

const rootElement = ref<HTMLElement | null>(null);
const isOpen = ref(false);
const selectedOption = computed(() =>
  props.options.find(option => option.value === props.modelValue),
);

/** 点击组件外部时关闭菜单，避免弹窗内遗留展开状态。 */
function handleDocumentPointerDown(event: PointerEvent): void {
  if (!rootElement.value?.contains(event.target as Node)) {
    isOpen.value = false;
  }
}

function selectOption(value: string): void {
  emit("update:modelValue", value);
  isOpen.value = false;
}

onMounted(() => {
  document.addEventListener("pointerdown", handleDocumentPointerDown);
});

onBeforeUnmount(() => {
  document.removeEventListener("pointerdown", handleDocumentPointerDown);
});
</script>

<template>
  <div ref="rootElement" class="app-select" @keydown.escape="isOpen = false">
    <button
      type="button"
      class="app-select-trigger"
      :aria-expanded="isOpen"
      aria-haspopup="listbox"
      @click="isOpen = !isOpen">
      <span class="app-select-value">{{ selectedOption?.label }}</span>
      <small v-if="selectedOption?.detail">{{ selectedOption.detail }}</small>
      <img :class="{ open: isOpen }" :src="chevronRightIcon" alt="" />
    </button>

    <div v-if="isOpen" class="app-select-options" role="listbox" :aria-label="ariaLabel">
      <button
        v-for="option in options"
        :key="option.value"
        type="button"
        role="option"
        :aria-selected="option.value === modelValue"
        :class="{ selected: option.value === modelValue }"
        @click="selectOption(option.value)">
        <span>{{ option.label }}</span>
        <small v-if="option.detail">{{ option.detail }}</small>
        <strong v-if="option.value === modelValue">✓</strong>
      </button>
    </div>
  </div>
</template>

<style scoped>
.app-select {
  position: relative;
}

.app-select-trigger {
  display: flex;
  align-items: center;
  width: 100%;
  min-height: 42px;
  padding: 0 12px;
  border: 1px solid var(--border-input);
  border-radius: 9px;
  background: var(--bg-input);
  color: var(--text-primary);
  text-align: left;
}

.app-select-value,
.app-select-options span {
  font-weight: 600;
}

.app-select-trigger small,
.app-select-options small {
  margin-left: 8px;
  color: var(--text-tertiary);
  font-size: 12px;
}

.app-select-trigger img {
  flex: 0 0 auto;
  width: 16px;
  height: 16px;
  margin-left: auto;
  opacity: 0.78;
  transform: rotate(90deg);
  transition: transform 120ms ease;
}

.app-select-trigger img.open {
  transform: rotate(-90deg);
}

.app-select-trigger:focus-visible {
  outline: none;
  border-color: var(--warning);
  box-shadow: 0 0 0 2px var(--warning-fill);
}

.app-select-options {
  position: absolute;
  z-index: 2;
  right: 0;
  left: 0;
  display: grid;
  gap: 2px;
  margin-top: 5px;
  padding: 5px;
  border: 1px solid var(--border-input);
  border-radius: 9px;
  background: var(--surface-floating-strong);
  box-shadow: var(--shadow-popover);
}

.app-select-options button {
  display: flex;
  align-items: center;
  min-height: 34px;
  padding: 0 8px;
  border-radius: 6px;
  background: transparent;
  color: var(--text-secondary);
  text-align: left;
}

.app-select-options button strong {
  margin-left: auto;
  color: var(--warning);
  font-size: 13px;
}

.app-select-options button:hover,
.app-select-options button.selected {
  background: var(--warning-fill);
  color: var(--text-primary);
}
</style>
