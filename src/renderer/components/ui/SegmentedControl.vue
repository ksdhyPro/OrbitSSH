<script lang="ts">
export interface SegmentedOption<T extends string | boolean = string> {
  value: T;
  label: string;
  /** warning：高风险选项（如“完全访问”）持续保留警示色。 */
  tone?: "warning";
}
</script>

<script setup lang="ts" generic="T extends string | boolean">
const props = withDefaults(
  defineProps<{
    options: SegmentedOption<T>[];
    ariaLabel: string;
    /** buttons：独立的并排按钮；tabs：带底槽的分段标签，适合表单内切换。 */
    variant?: "buttons" | "tabs";
  }>(),
  { variant: "buttons" },
);

const model = defineModel<T>({ required: true });
</script>

<template>
  <div
    :class="['segmented', `segmented-${props.variant}`]"
    :style="{ '--segmented-count': options.length }"
    role="radiogroup"
    :aria-label="ariaLabel"
  >
    <button
      v-for="option in options"
      :key="String(option.value)"
      type="button"
      role="radio"
      :aria-checked="model === option.value"
      :class="[
        'segmented-option',
        {
          active: model === option.value,
          'is-warning': option.tone === 'warning',
        },
      ]"
      @click="model = option.value"
    >
      {{ option.label }}
    </button>
  </div>
</template>
