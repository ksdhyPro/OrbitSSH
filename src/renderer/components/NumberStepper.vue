<script setup lang="ts">
import { computed, ref, watch } from "vue";

const props = withDefaults(
  defineProps<{
    modelValue: number;
    min?: number;
    max?: number;
    step?: number;
    placeholder?: string;
  }>(),
  {
    min: -Infinity,
    max: Infinity,
    step: 1,
    placeholder: "",
  },
);

const emit = defineEmits<{
  "update:modelValue": [value: number];
}>();

// input 仍允许临时非数字/空文本（比如清空准备重输），提交时再钳制。
const draft = ref(String(props.modelValue));

// 外部值变化时（如载入已有连接数据）同步显示，避免与实际值脱节。
watch(
  () => props.modelValue,
  (value) => {
    if (String(value) !== draft.value) {
      draft.value = String(value);
    }
  },
);

const atMin = computed(() => props.modelValue <= props.min);
const atMax = computed(() => props.modelValue >= props.max);

function clamp(value: number): number {
  return Math.max(props.min, Math.min(props.max, value));
}

function commit(raw: string): void {
  const parsed = Number.parseInt(raw, 10);

  if (Number.isNaN(parsed)) {
    // 非法输入回退到当前值，并同步显示。
    draft.value = String(props.modelValue);
    return;
  }

  const next = clamp(parsed);
  draft.value = String(next);
  if (next !== props.modelValue) {
    emit("update:modelValue", next);
  }
}

function stepBy(direction: 1 | -1): void {
  const next = clamp(props.modelValue + direction * props.step);
  draft.value = String(next);
  emit("update:modelValue", next);
}

function onInput(event: Event): void {
  const target = event.currentTarget as HTMLInputElement;
  draft.value = target.value;
}

function onBlur(): void {
  commit(draft.value);
}

// 仅允许数字键、导航键与编辑键，避免输入字母。
function onKeydown(event: KeyboardEvent): void {
  if (
    event.ctrlKey ||
    event.metaKey ||
    event.altKey ||
    [
      "Backspace",
      "Delete",
      "Tab",
      "Enter",
      "Escape",
      "ArrowLeft",
      "ArrowRight",
      "ArrowUp",
      "ArrowDown",
      "Home",
      "End",
    ].includes(event.key)
  ) {
    return;
  }

  if (!/^\d$/.test(event.key)) {
    event.preventDefault();
  }
}
</script>

<template>
  <div class="stepper-control number-stepper">
    <button
      type="button"
      :disabled="atMin"
      aria-label="减少"
      @click="stepBy(-1)">
      -
    </button>
    <input
      v-model="draft"
      type="text"
      inputmode="numeric"
      :placeholder="placeholder"
      class="stepper-input"
      @input="onInput"
      @blur="onBlur"
      @keydown="onKeydown" />
    <button
      type="button"
      :disabled="atMax"
      aria-label="增加"
      @click="stepBy(1)">
      +
    </button>
  </div>
</template>

<style scoped>
/* 端口等数值输入：沿用全局 stepper 骨架，中间替换为可键入的输入框。 */
.number-stepper {
  grid-template-columns: 34px minmax(0, 1fr) 34px;
  justify-content: start;
}

.number-stepper .stepper-input {
  width: 100%;
  height: 34px;
  min-width: 0;
  border: 1px solid var(--border-input);
  border-radius: 7px;
  padding: 0 10px;
  outline: none;
  background: var(--bg-input);
  color: var(--text-primary);
  font: inherit;
  font-variant-numeric: tabular-nums;
  text-align: center;
}

.number-stepper .stepper-input:focus {
  border-color: var(--accent);
  box-shadow: 0 0 0 2px rgba(75, 143, 216, 0.18);
}
</style>
