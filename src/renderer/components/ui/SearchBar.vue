<script setup lang="ts">
import { ref } from "vue";
import arrowDownIcon from "../../assets/icons/arrow-down.svg";
import arrowUpIcon from "../../assets/icons/arrow-up.svg";
import caseSensitiveIcon from "../../assets/icons/case-sensitive.svg";
import closeIcon from "../../assets/icons/close.svg";

export type SearchDirection = "next" | "previous";

const props = withDefaults(
  defineProps<{
    keyword: string;
    caseSensitive: boolean;
    index: number;
    total: number;
    placeholder?: string;
    /** 开启后显示替换输入框与“替换 / 全部”按钮。 */
    replaceable?: boolean;
    replaceText?: string;
  }>(),
  {
    placeholder: "搜索内容",
    replaceable: false,
    replaceText: "",
  },
);

const emit = defineEmits<{
  "update:keyword": [value: string];
  "update:replaceText": [value: string];
  search: [direction?: SearchDirection];
  toggleCaseSensitive: [];
  replaceCurrent: [];
  replaceAll: [];
  close: [];
}>();

const searchInput = ref<HTMLInputElement | null>(null);
const replaceInput = ref<HTMLInputElement | null>(null);

function updateKeyword(event: Event): void {
  emit("update:keyword", (event.target as HTMLInputElement).value);
  emit("search");
}

/** Shift+Tab 在搜索框内表示“上一个”，与 Enter / Shift+Enter 的习惯保持一致。 */
function searchPreviousByBackwardTab(event: KeyboardEvent): void {
  if (!event.shiftKey) {
    return;
  }

  event.preventDefault();
  emit("search", "previous");
}

function focus(): void {
  searchInput.value?.focus();
  searchInput.value?.select();
}

defineExpose({ focus, searchInput, replaceInput });
</script>

<template>
  <div :class="['search-bar', { 'search-bar-replaceable': props.replaceable }]">
    <input
      ref="searchInput"
      :value="keyword"
      type="search"
      :placeholder="placeholder"
      @input="updateKeyword"
      @keydown.enter.prevent="emit('search', $event.shiftKey ? 'previous' : 'next')"
      @keydown.tab="searchPreviousByBackwardTab"
      @keydown.esc.prevent="emit('close')" />
    <input
      v-if="replaceable"
      ref="replaceInput"
      :value="replaceText"
      type="text"
      placeholder="替换为"
      @input="emit('update:replaceText', ($event.target as HTMLInputElement).value)"
      @keydown.enter.prevent="emit('replaceCurrent')"
      @keydown.tab="searchPreviousByBackwardTab"
      @keydown.esc.prevent="emit('close')" />
    <span class="search-bar-count">{{ index }}/{{ total }}</span>
    <button
      type="button"
      :class="['icon-btn', 'icon-btn-md', { active: caseSensitive }]"
      aria-label="区分大小写"
      title="区分大小写"
      :aria-pressed="caseSensitive"
      @click="emit('toggleCaseSensitive')">
      <img :src="caseSensitiveIcon" alt="" />
    </button>
    <button
      type="button"
      class="icon-btn icon-btn-md"
      aria-label="上一个"
      title="上一个"
      @click="emit('search', 'previous')">
      <img :src="arrowUpIcon" alt="" />
    </button>
    <button
      type="button"
      class="icon-btn icon-btn-md"
      aria-label="下一个"
      title="下一个"
      @click="emit('search', 'next')">
      <img :src="arrowDownIcon" alt="" />
    </button>
    <template v-if="replaceable">
      <button
        type="button"
        class="btn btn-secondary btn-sm"
        :disabled="!keyword || total === 0"
        @click="emit('replaceCurrent')">
        替换
      </button>
      <button
        type="button"
        class="btn btn-secondary btn-sm"
        :disabled="!keyword || total === 0"
        @click="emit('replaceAll')">
        全部
      </button>
    </template>
    <button
      type="button"
      class="icon-btn icon-btn-md"
      aria-label="关闭搜索"
      title="关闭搜索"
      @click="emit('close')">
      <img :src="closeIcon" alt="" />
    </button>
  </div>
</template>
