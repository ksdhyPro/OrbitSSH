<script setup lang="ts">
import chevronRightIcon from "../../assets/icons/chevron-right.svg";

defineProps<{
  title: string;
  collapsed: boolean;
  /** 内容区 id，供标题按钮的 aria-controls 引用。 */
  contentId: string;
}>();

const emit = defineEmits<{
  toggleCollapsed: [];
}>();
</script>

<template>
  <section :class="['panel', 'sidebar-panel', { collapsed }]">
    <!-- 标题行可直接拖拽，用于在左侧栏内调整面板顺序。 -->
    <div class="panel-header" draggable="true">
      <button
        type="button"
        class="panel-toggle"
        :aria-expanded="!collapsed"
        :aria-controls="contentId"
        @click="emit('toggleCollapsed')"
      >
        <img :class="{ expanded: !collapsed }" :src="chevronRightIcon" alt="" />
        <h2>
          {{ title }}
          <slot name="title-extra" />
        </h2>
      </button>
      <div v-if="!collapsed" class="panel-header-actions">
        <slot name="actions" />
      </div>
    </div>
    <Transition name="panel-slide">
      <div v-show="!collapsed" :id="contentId" class="sidebar-panel-content">
        <slot />
      </div>
    </Transition>
  </section>
</template>
