<script setup lang="ts">
import { computed } from "vue";

import type { AiContextUsage } from "../../shared/ai";
import type { AiModelConfig } from "../../shared/settings";

const props = defineProps<{
  config?: AiModelConfig;
  usage?: AiContextUsage;
}>();

const visible = computed(() =>
  Number.isSafeInteger(props.config?.contextTokenLimitK) &&
  (props.config?.contextTokenLimitK ?? 0) > 0,
);

const percent = computed(() => {
  if (!props.config || props.usage?.configId !== props.config.id) return 0;
  return Math.min(100, Math.max(0, props.usage.percent));
});

const progressStyle = computed(() => ({
  "--ai-context-progress": `${percent.value * 3.6}deg`,
}));

const title = computed(() => {
  if (!props.config || props.usage?.configId !== props.config.id) {
    return "上下文已使用 0%";
  }
  const source = props.usage.source === "provider" ? "接口统计" : "本地估算";
  return `上下文已使用 ${Math.round(percent.value)}%（${source}）`;
});
</script>

<template>
  <div
    v-if="visible"
    class="ai-context-usage"
    :style="progressStyle"
    :title="title"
    role="progressbar"
    aria-label="上下文使用量"
    aria-valuemin="0"
    aria-valuemax="100"
    :aria-valuenow="Math.round(percent)">
    <span>{{ Math.round(percent) }}%</span>
  </div>
</template>
