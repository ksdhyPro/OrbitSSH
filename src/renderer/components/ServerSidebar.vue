<script setup lang="ts">
import { computed, reactive } from "vue";
import serverAddIcon from "../assets/icons/server-add.svg";
import groupAddIcon from "../assets/icons/server-group-add.svg";
import ColorPickerDialog from "./ColorPickerDialog.vue";
import ContextMenu from "./ContextMenu.vue";
import DeleteConfirmDialog from "./DeleteConfirmDialog.vue";
import GroupedList from "./GroupedList.vue";
import ServerGroupDialog from "./ServerGroupDialog.vue";
import SidebarPanel from "./ui/SidebarPanel.vue";
import type { ContextMenuItem } from "../types/context-menu";
import type { ServerConfig, ServerGroup } from "../../shared/server";
import {
  buildMoveToGroupMenuItem,
  parseMoveToGroupKey,
  useContextMenuTarget,
  useGroupDeleteDialog,
  useGroupNameDialog,
} from "../composables/useGroupedSidebar";

const props = defineProps<{
  servers: ServerConfig[];
  groups: ServerGroup[];
  runtimeError: string;
  isServerListLoading: boolean;
  listError: string;
  hasServers: boolean;
  activeServerId: string;
  collapsed: boolean;
}>();
const emit = defineEmits<{
  openConnectionDialog: [];
  openServerTerminal: [server: ServerConfig];
  editServer: [server: ServerConfig];
  setServerPinned: [server: ServerConfig];
  setServerColor: [server: ServerConfig, color?: string];
  moveServerToGroup: [server: ServerConfig, groupId?: string];
  createGroup: [name: string];
  updateGroup: [group: ServerGroup, input: Pick<ServerGroup, "name" | "color">];
  deleteGroup: [groupId: string];
  deleteServer: [serverId: string];
  toggleCollapsed: [];
}>();

const { menu, menuTarget, menuTargetType, openMenu, closeMenu } =
  useContextMenuTarget<ServerConfig | ServerGroup, "server" | "group">("server");
const { groupDialog, openGroupDialog, closeGroupDialog } =
  useGroupNameDialog<ServerGroup>();
const { groupDeleteDialog, requestGroupDelete, closeGroupDeleteDialog } =
  useGroupDeleteDialog<ServerGroup>();
const colorDialog = reactive<{
  open: boolean;
  target: ServerConfig | ServerGroup | null;
  type: "server" | "group";
}>({ open: false, target: null, type: "server" });

const menuItems = computed<ContextMenuItem[]>(() => {
  if (menuTargetType.value === "group") {
    return [
      { key: "rename", label: "重命名" },
      { key: "color", label: "修改颜色" },
      { key: "delete", label: "删除分组", group: "danger", danger: true },
    ];
  }

  const server = menuTarget.value as ServerConfig | null;
  return [
    { key: "pin", label: server?.isPinned ? "取消置顶" : "置顶" },
    { key: "edit", label: "编辑连接" },
    { key: "color", label: "修改颜色" },
    buildMoveToGroupMenuItem(props.groups, server?.groupId),
    { key: "delete", label: "删除连接", group: "danger", danger: true },
  ];
});

function moveServer(server: ServerConfig, groupId?: string): void {
  emit("moveServerToGroup", server, groupId);
}
function submitGroup(): void {
  const name = groupDialog.name.trim();
  if (!name) return;
  if (groupDialog.editing)
    emit("updateGroup", groupDialog.editing, {
      name,
      color: groupDialog.editing.color,
    });
  else emit("createGroup", name);
  closeGroupDialog();
}
function openColorDialog(
  target: ServerConfig | ServerGroup,
  type: "server" | "group",
): void {
  colorDialog.target = target;
  colorDialog.type = type;
  colorDialog.open = true;
}
function closeColorDialog(): void {
  colorDialog.open = false;
  colorDialog.target = null;
}
function saveColor(color?: string): void {
  const target = colorDialog.target;
  if (!target) return;
  if (colorDialog.type === "server")
    emit("setServerColor", target as ServerConfig, color);
  else {
    const group = target as ServerGroup;
    emit("updateGroup", group, { name: group.name, color });
  }
}
function selectMenuItem(item: ContextMenuItem): void {
  const target = menuTarget.value;
  if (!target) return;
  const type = menuTargetType.value;
  closeMenu();
  if (item.key === "color") return openColorDialog(target, type);
  if (type === "group") {
    const group = target as ServerGroup;
    if (item.key === "rename") openGroupDialog(group);
    if (item.key === "delete") requestGroupDelete(group);
    return;
  }
  const server = target as ServerConfig;
  const move = parseMoveToGroupKey(item.key);
  if (move) {
    if (server.groupId !== move.groupId) moveServer(server, move.groupId);
    return;
  }
  if (item.key === "pin") emit("setServerPinned", server);
  if (item.key === "edit") emit("editServer", server);
  if (item.key === "delete") emit("deleteServer", server.id);
}
function confirmGroupDelete(): void {
  const group = groupDeleteDialog.group;
  if (!group) return;
  emit("deleteGroup", group.id);
  closeGroupDeleteDialog();
}
</script>

<template>
  <SidebarPanel
    title="服务器"
    content-id="server-panel-content"
    :collapsed="collapsed"
    @toggle-collapsed="emit('toggleCollapsed')">
    <template #actions>
      <button
        type="button"
        class="icon-btn"
        aria-label="新增分组"
        title="新增分组"
        @click.stop="openGroupDialog()">
        <img :src="groupAddIcon" alt="" />
      </button>
      <button
        type="button"
        class="icon-btn"
        aria-label="新增连接"
        title="新增连接"
        @click.stop="emit('openConnectionDialog')">
        <img :src="serverAddIcon" alt="" />
      </button>
    </template>
    <GroupedList
      :items="servers"
      :groups="groups"
      item-noun="连接"
      :move-item="moveServer"
      :active-id="activeServerId"
      selectable
      @select="emit('openServerTerminal', $event)"
      @item-menu="(event, server) => openMenu(event, server, 'server')"
      @group-menu="(event, group) => openMenu(event, group, 'group')">
      <template #status>
        <div v-if="runtimeError" class="empty-state empty-state-card is-error">
          {{ runtimeError }}
        </div>
        <div v-else-if="isServerListLoading" class="empty-state empty-state-card">
          正在加载服务器...
        </div>
        <div v-else-if="listError" class="empty-state empty-state-card is-error">
          {{ listError }}
        </div>
        <div v-else-if="!hasServers && !groups.length" class="empty-state empty-state-card">
          暂无服务器，点击右上角新增连接
        </div>
      </template>
    </GroupedList>
  </SidebarPanel>
  <ContextMenu
    :menu="menu"
    :items="menuItems"
    @select="selectMenuItem"
    @close="closeMenu" />
  <ServerGroupDialog
    :open="groupDialog.open"
    :name="groupDialog.name"
    :editing="Boolean(groupDialog.editing)"
    @update-name="groupDialog.name = $event"
    @submit="submitGroup"
    @close="closeGroupDialog" />
  <ColorPickerDialog
    :open="colorDialog.open"
    :title="colorDialog.type === 'group' ? '分组颜色' : '连接颜色'"
    :color="colorDialog.target?.color"
    @select="saveColor"
    @clear="
      saveColor(undefined);
      closeColorDialog();
    "
    @close="closeColorDialog" />
  <DeleteConfirmDialog
    :open="groupDeleteDialog.open"
    title="删除分组"
    :message="`确认删除分组“${groupDeleteDialog.group?.name ?? ''}”？其中的连接会保留在未分组列表中。`"
    confirm-label="删除"
    :danger="true"
    @cancel="closeGroupDeleteDialog"
    @confirm="confirmGroupDelete" />
</template>
