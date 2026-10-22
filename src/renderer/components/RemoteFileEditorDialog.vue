<script setup lang="ts">
import AppDialog from "./AppDialog.vue";
import SearchBar from "./ui/SearchBar.vue";

const props = defineProps<{
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

/** 将搜索栏内部输入框交给文件编辑器 store，用于打开搜索时聚焦。 */
function bindSearchBar(instance: unknown): void {
  const bar = instance as InstanceType<typeof SearchBar> | null;
  props.setSearchInput(bar?.searchInput ?? null);
  props.setReplaceInput(bar?.replaceInput ?? null);
}
</script>

<template>
  <AppDialog
    v-if="isOpen"
    :title="title"
    :description="editor.path"
    width="editor"
    @close="emit('requestClose')"
  >
    <section class="file-editor-shell">
      <div v-if="isSearchOpen" class="file-editor-toolbar">
        <SearchBar
          :ref="bindSearchBar"
          :keyword="searchKeyword"
          :case-sensitive="isSearchCaseSensitive"
          :index="editor.searchIndex"
          :total="editor.searchTotal"
          replaceable
          :replace-text="replaceText"
          @update:keyword="emit('updateSearchKeyword', $event)"
          @update:replace-text="
            emit('updateReplaceText', $event);
            emit('applySearchQuery');
          "
          @search="emit('search', $event)"
          @toggle-case-sensitive="emit('toggleCaseSensitive')"
          @replace-current="emit('replaceCurrent')"
          @replace-all="emit('replaceAll')"
          @close="emit('closeSearch')"
        />
      </div>

      <div v-if="editor.loading" class="file-editor-loading">正在读取文件...</div>
      <div v-else :ref="setEditorContainer" class="file-editor-body"></div>

      <p v-if="error" class="form-error">{{ error }}</p>

      <footer class="file-editor-footer">
        <span :class="{ dirty: isDirty }">
          {{ isDirty ? "有未保存修改" : "已保存" }}
        </span>
        <div class="dialog-actions">
          <button type="button" class="btn btn-ghost" @click="emit('requestClose')">关闭</button>
          <button
            type="button"
            class="btn btn-primary"
            :disabled="editor.loading || editor.saving || !isDirty"
            @click="emit('save')"
          >
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
    @close="emit('updateCloseConfirmOpen', false)"
  >
    <section class="confirm-dialog-content">
      <footer class="dialog-actions">
        <button type="button" class="btn btn-ghost" @click="emit('discard')">不保存</button>
        <button type="button" class="btn btn-ghost" @click="emit('updateCloseConfirmOpen', false)">
          取消
        </button>
        <button
          type="button"
          class="btn btn-primary"
          :disabled="editor.saving"
          @click="emit('saveAndClose')"
        >
          {{ editor.saving ? "保存中..." : "保存并关闭" }}
        </button>
      </footer>
    </section>
  </AppDialog>
</template>
