<script setup lang="ts">
import arrowDownIcon from "../assets/icons/arrow-down.svg";
import arrowUpIcon from "../assets/icons/arrow-up.svg";
import caseSensitiveIcon from "../assets/icons/case-sensitive.svg";
import closeIcon from "../assets/icons/close.svg";
import AppDialog from "./AppDialog.vue";

defineProps<{
  isOpen: boolean;
  isCloseConfirmOpen: boolean;
  title: string;
  isSearchOpen: boolean;
  isSearchCaseSensitive: boolean;
  searchKeyword: string;
  replaceText: string;
  editor: {
    tabId: string;
    path: string;
    name: string;
    content: string;
    savedContent: string;
    loading: boolean;
    saving: boolean;
    searchIndex: number;
    searchTotal: number;
  };
  error: string;
  isDirty: boolean;
  setEditorContainer: (element: unknown) => void;
  setSearchInput: (element: unknown) => void;
  setReplaceInput: (element: unknown) => void;
}>();

const emit = defineEmits<{
  requestClose: [];
  updateCloseConfirmOpen: [open: boolean];
  updateSearchKeyword: [value: string];
  updateReplaceText: [value: string];
  search: [direction?: "next" | "previous"];
  applySearchQuery: [];
  replaceCurrent: [];
  replaceAll: [];
  toggleCaseSensitive: [];
  closeSearch: [];
  save: [];
  discard: [];
  saveAndClose: [];
}>();

// 搜索工具栏内用 Shift+Tab 跳到上一个结果，同时阻止默认回退焦点。
function searchPreviousByBackwardTab(event: KeyboardEvent): void {
  if (!event.shiftKey) {
    return;
  }

  event.preventDefault();
  emit("search", "previous");
}
</script>

<template>
  <AppDialog
    v-if="isOpen"
    :title="title"
    :description="editor.path"
    width="editor"
    @close="emit('requestClose')">
    <section class="file-editor-shell">
      <div v-if="isSearchOpen" class="file-editor-toolbar">
        <div class="file-editor-search">
          <input
            :ref="setSearchInput"
            :value="searchKeyword"
            type="search"
            placeholder="搜索内容"
            @input="
              emit(
                'updateSearchKeyword',
                ($event.target as HTMLInputElement).value,
              );
              emit('search');
            "
            @keydown.enter.prevent="
              emit('search', $event.shiftKey ? 'previous' : 'next')
            "
            @keydown.tab="searchPreviousByBackwardTab"
            @keydown.esc.prevent="emit('closeSearch')" />
          <input
            :ref="setReplaceInput"
            :value="replaceText"
            type="text"
            placeholder="替换为"
            @input="
              emit('updateReplaceText', ($event.target as HTMLInputElement).value);
              emit('applySearchQuery');
            "
            @keydown.enter.prevent="emit('replaceCurrent')"
            @keydown.tab="searchPreviousByBackwardTab"
            @keydown.esc.prevent="emit('closeSearch')" />
          <span>{{ editor.searchIndex }}/{{ editor.searchTotal }}</span>
          <button
            type="button"
            :class="[
              'file-editor-search-tool',
              { active: isSearchCaseSensitive },
            ]"
            aria-label="区分大小写"
            title="区分大小写"
            @click="emit('toggleCaseSensitive')">
            <img :src="caseSensitiveIcon" alt="" />
          </button>
          <button
            type="button"
            class="file-editor-search-tool"
            aria-label="上一个"
            title="上一个"
            @click="emit('search', 'previous')">
            <img :src="arrowUpIcon" alt="" />
          </button>
          <button
            type="button"
            class="file-editor-search-tool"
            aria-label="下一个"
            title="下一个"
            @click="emit('search', 'next')">
            <img :src="arrowDownIcon" alt="" />
          </button>
          <button
            type="button"
            class="file-editor-replace-button"
            :disabled="!searchKeyword || editor.searchTotal === 0"
            @click="emit('replaceCurrent')">
            替换
          </button>
          <button
            type="button"
            class="file-editor-replace-button"
            :disabled="!searchKeyword || editor.searchTotal === 0"
            @click="emit('replaceAll')">
            全部
          </button>
          <button
            type="button"
            class="file-editor-search-tool"
            aria-label="关闭搜索"
            title="关闭搜索"
            @click="emit('closeSearch')">
            <img :src="closeIcon" alt="" />
          </button>
        </div>
      </div>

      <div v-if="editor.loading" class="file-editor-loading">
        正在读取文件...
      </div>
      <div v-else :ref="setEditorContainer" class="file-editor-body"></div>

      <p v-if="error" class="form-error">{{ error }}</p>

      <footer class="file-editor-footer">
        <span>{{ isDirty ? "有未保存修改" : "已保存" }}</span>
        <div class="dialog-actions">
          <button type="button" class="ghost-button" @click="emit('requestClose')">
            关闭
          </button>
          <button
            type="button"
            class="primary-button"
            :disabled="editor.loading || editor.saving || !isDirty"
            @click="emit('save')">
            {{ editor.saving ? "保存中..." : "保存" }}
          </button>
        </div>
      </footer>
    </section>
  </AppDialog>

  <AppDialog
    v-if="isCloseConfirmOpen"
    title="保存修改？"
    description="当前文件有未保存修改，关闭前请选择如何处理。"
    width="medium"
    @close="emit('updateCloseConfirmOpen', false)">
    <section class="confirm-dialog-content">
      <footer class="dialog-actions">
        <button type="button" class="ghost-button" @click="emit('discard')">
          不保存
        </button>
        <button
          type="button"
          class="ghost-button"
          @click="emit('updateCloseConfirmOpen', false)">
          取消
        </button>
        <button
          type="button"
          class="primary-button"
          :disabled="editor.saving"
          @click="emit('saveAndClose')">
          {{ editor.saving ? "保存中..." : "保存并关闭" }}
        </button>
      </footer>
    </section>
  </AppDialog>
</template>
