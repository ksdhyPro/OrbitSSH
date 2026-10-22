<script lang="ts">
export interface GroupedListItem {
  id: string;
  name: string;
  groupId?: string;
  isPinned?: boolean;
  color?: string;
}

export interface GroupedListGroup {
  id: string;
  name: string;
  color?: string;
}
</script>

<script setup lang="ts" generic="T extends GroupedListItem, G extends GroupedListGroup">
import { computed, ref } from "vue";
import chevronRightIcon from "../assets/icons/chevron-right.svg";
import pinIcon from "../assets/icons/pin.svg";
import moreIcon from "../assets/icons/settings.svg";
import { useGroupedDrag } from "../composables/useGroupedDrag";

/**
 * 侧栏分组列表：服务器与自定义指令共用的分组骨架、折叠状态和拖拽移动。
 * 列表上方的加载 / 错误提示通过 status 插槽传入，条目右侧的额外操作通过 item-actions 插槽传入。
 */
const props = defineProps<{
  items: T[];
  groups: G[];
  /** 条目名词，用于空分组提示，例如“连接”“指令”。 */
  itemNoun: string;
  /** 将条目移动到分组；返回 false 表示移动失败，不播放完成动画。 */
  moveItem: (item: T, groupId?: string) => Promise<boolean | void> | boolean | void;
  activeId?: string;
  /** 条目可点击选中（如打开服务器终端）。 */
  selectable?: boolean;
}>();

const emit = defineEmits<{
  select: [item: T];
  itemMenu: [event: MouseEvent, item: T];
  groupMenu: [event: MouseEvent, group: G];
}>();

defineSlots<{
  status?: () => unknown;
  "item-actions"?: (props: { item: T }) => unknown;
}>();

const collapsedGroupIds = ref<string[]>([]);
const isUngroupedCollapsed = ref(false);
const ungroupedItems = computed(() => props.items.filter(item => !item.groupId));
const {
  draggedId,
  showUngroupedDock,
  startDrag,
  enterDropTarget,
  leaveDropTarget,
  finishDrag,
  cancelDrag,
  isDropAvailable,
  isDropHovered,
  isRecentlyDropped,
} = useGroupedDrag(
  () => props.items,
  (item, groupId) => props.moveItem(item, groupId),
);

function itemsInGroup(groupId: string): T[] {
  return props.items.filter(item => item.groupId === groupId);
}

function isGroupCollapsed(groupId: string): boolean {
  return collapsedGroupIds.value.includes(groupId);
}

function toggleGroup(groupId: string): void {
  collapsedGroupIds.value = isGroupCollapsed(groupId)
    ? collapsedGroupIds.value.filter(id => id !== groupId)
    : [...collapsedGroupIds.value, groupId];
}

/** 拖拽悬停在折叠分组上时自动展开，方便放入指定位置。 */
function expandGroup(groupId: string): void {
  if (isGroupCollapsed(groupId)) {
    collapsedGroupIds.value = collapsedGroupIds.value.filter(id => id !== groupId);
  }
}

function sections(): Array<{ group?: G; items: T[] }> {
  const groupedSections = props.groups.map(group => ({
    group,
    items: itemsInGroup(group.id),
  }));
  return ungroupedItems.value.length || props.groups.length
    ? [...groupedSections, { items: ungroupedItems.value }]
    : groupedSections;
}

function isSectionCollapsed(group?: G): boolean {
  return group ? isGroupCollapsed(group.id) : isUngroupedCollapsed.value;
}

function toggleSection(group?: G): void {
  if (group) {
    toggleGroup(group.id);
  } else {
    isUngroupedCollapsed.value = !isUngroupedCollapsed.value;
  }
}
</script>

<template>
  <div class="grouped-sidebar-content" :class="{ 'drag-active': draggedId }">
    <div class="grouped-list">
      <slot name="status" />
      <section
        v-for="section in sections()"
        :key="section.group?.id ?? '__ungrouped__'"
        :class="[
          'grouped-section',
          {
            'drop-available': isDropAvailable(section.group?.id),
            'drop-hovered': isDropHovered(section.group?.id),
            'drop-complete': isRecentlyDropped(section.group?.id),
          },
        ]"
        :style="section.group?.color ? { backgroundColor: section.group.color } : undefined"
        @dragover.prevent
        @dragenter.prevent="
          enterDropTarget(
            $event,
            section.group?.id,
            section.group ? () => expandGroup(section.group!.id) : undefined,
          )
        "
        @dragleave="leaveDropTarget($event, section.group?.id)"
        @drop.prevent="finishDrag(section.group?.id)"
      >
        <div class="grouped-section-header">
          <button
            type="button"
            class="grouped-section-toggle"
            :aria-expanded="!isSectionCollapsed(section.group)"
            @click="toggleSection(section.group)"
          >
            <img
              :class="{ expanded: !isSectionCollapsed(section.group) }"
              :src="chevronRightIcon"
              alt=""
            /><strong>{{ section.group?.name ?? "未分组" }}</strong
            ><span>{{ section.items.length }}</span>
          </button>
          <button
            v-if="section.group"
            type="button"
            class="icon-btn icon-btn-sm grouped-menu-trigger"
            aria-label="分组更多操作"
            @click="emit('groupMenu', $event, section.group)"
          >
            <img :src="moreIcon" alt="" />
          </button>
        </div>
        <div v-show="!isSectionCollapsed(section.group)" class="grouped-section-list">
          <article
            v-for="item in section.items"
            :key="item.id"
            :class="[
              'grouped-item',
              {
                active: selectable && item.id === activeId,
                dragging: item.id === draggedId,
              },
            ]"
            :style="item.color ? { backgroundColor: item.color } : undefined"
            draggable="true"
            :role="selectable ? 'button' : undefined"
            :tabindex="selectable ? 0 : undefined"
            @dragstart.stop="startDrag($event, item)"
            @dragend="cancelDrag"
            @click="selectable && emit('select', item)"
          >
            <div class="grouped-item-title">
              <span v-if="item.isPinned" class="grouped-item-pin"
                ><img :src="pinIcon" alt="" /></span
              ><strong :title="item.name">{{ item.name }}</strong>
            </div>
            <div class="grouped-item-actions">
              <slot name="item-actions" :item="item" />
              <button
                type="button"
                class="icon-btn icon-btn-sm grouped-menu-trigger"
                :aria-label="`${itemNoun}更多操作`"
                @click.stop="emit('itemMenu', $event, item)"
              >
                <img :src="moreIcon" alt="" />
              </button>
            </div>
          </article>
          <p
            v-if="!section.items.length"
            class="empty-state empty-state-compact grouped-section-empty"
          >
            {{ section.group ? `将${itemNoun}拖到此处` : `暂无未分组${itemNoun}` }}
          </p>
        </div>
      </section>
    </div>
    <div
      v-if="showUngroupedDock"
      :class="['ungrouped-drop-dock', { hovered: isDropHovered() }]"
      @dragover.prevent
      @dragenter.prevent="enterDropTarget($event)"
      @dragleave="leaveDropTarget($event)"
      @drop.stop.prevent="finishDrag()"
    >
      <strong>{{ isDropHovered() ? "松开以移至未分组" : "拖到这里移至未分组" }}</strong>
    </div>
  </div>
</template>
