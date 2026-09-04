<script setup lang="ts">
import { computed, reactive, ref } from "vue";
import chevronRightIcon from "../assets/icons/chevron-right.svg";
import moreIcon from "../assets/icons/settings.svg";
import pinIcon from "../assets/icons/pin.svg";
import serverAddIcon from "../assets/icons/server-add.svg";
import groupAddIcon from "../assets/icons/server-group-add.svg";
import ColorPickerDialog from "./ColorPickerDialog.vue";
import ContextMenu from "./ContextMenu.vue";
import ServerGroupDialog from "./ServerGroupDialog.vue";
import type { ContextMenuItem, ContextMenuState } from "../types/context-menu";
import type { ServerConfig, ServerGroup } from "../../shared/server";

const props = defineProps<{ servers: ServerConfig[]; groups: ServerGroup[]; runtimeError: string; isServerListLoading: boolean; listError: string; hasServers: boolean; activeServerId: string; collapsed: boolean; }>();
const emit = defineEmits<{ openConnectionDialog: []; openServerTerminal: [server: ServerConfig]; editServer: [server: ServerConfig]; setServerPinned: [server: ServerConfig]; setServerColor: [server: ServerConfig, color?: string]; moveServerToGroup: [server: ServerConfig, groupId?: string]; createGroup: [name: string]; updateGroup: [group: ServerGroup, input: Pick<ServerGroup, "name" | "color">]; deleteGroup: [groupId: string]; deleteServer: [serverId: string]; toggleCollapsed: []; }>();

const collapsedGroupIds = ref<string[]>([]);
const draggedServerId = ref<string | null>(null);
const menu = reactive<ContextMenuState>({ open: false, x: 0, y: 0 });
const menuTarget = ref<ServerConfig | ServerGroup | null>(null);
const menuTargetType = ref<"server" | "group">("server");
const groupDialog = reactive<{ open: boolean; editing: ServerGroup | null; name: string }>({ open: false, editing: null, name: "" });
const colorDialog = reactive<{ open: boolean; target: ServerConfig | ServerGroup | null; type: "server" | "group" }>({ open: false, target: null, type: "server" });
const ungroupedServers = computed(() => props.servers.filter(server => !server.groupId));
const menuItems = computed<ContextMenuItem[]>(() => menuTargetType.value === "group"
  ? [{ key: "rename", label: "重命名" }, { key: "color", label: "修改颜色" }, { key: "delete", label: "删除分组", group: "danger", danger: true }]
  : [{ key: "pin", label: (menuTarget.value as ServerConfig)?.isPinned ? "取消置顶" : "置顶" }, { key: "edit", label: "编辑连接" }, { key: "color", label: "修改颜色" }, { key: "delete", label: "删除连接", group: "danger", danger: true }]);
function serversInGroup(groupId: string): ServerConfig[] { return props.servers.filter(server => server.groupId === groupId); }
function isGroupCollapsed(groupId: string): boolean { return collapsedGroupIds.value.includes(groupId); }
function toggleGroup(groupId: string): void { collapsedGroupIds.value = isGroupCollapsed(groupId) ? collapsedGroupIds.value.filter(id => id !== groupId) : [...collapsedGroupIds.value, groupId]; }
function openGroupDialog(group?: ServerGroup): void { groupDialog.open = true; groupDialog.editing = group ?? null; groupDialog.name = group?.name ?? ""; }
function closeGroupDialog(): void { groupDialog.open = false; groupDialog.editing = null; groupDialog.name = ""; }
function submitGroup(): void { const name = groupDialog.name.trim(); if (!name) return; if (groupDialog.editing) emit("updateGroup", groupDialog.editing, { name, color: groupDialog.editing.color }); else emit("createGroup", name); closeGroupDialog(); }
function openMenu(event: MouseEvent, target: ServerConfig | ServerGroup, type: "server" | "group"): void { event.stopPropagation(); menuTarget.value = target; menuTargetType.value = type; menu.x = event.clientX; menu.y = event.clientY; menu.open = true; }
function closeMenu(): void { menu.open = false; menuTarget.value = null; }
function openColorDialog(target: ServerConfig | ServerGroup, type: "server" | "group"): void { colorDialog.target = target; colorDialog.type = type; colorDialog.open = true; }
function closeColorDialog(): void { colorDialog.open = false; colorDialog.target = null; }
function saveColor(color?: string): void { const target = colorDialog.target; if (!target) return; if (colorDialog.type === "server") emit("setServerColor", target as ServerConfig, color); else { const group = target as ServerGroup; emit("updateGroup", group, { name: group.name, color }); } }
function selectMenuItem(item: ContextMenuItem): void { const target = menuTarget.value; if (!target) return; const type = menuTargetType.value; closeMenu(); if (item.key === "color") return openColorDialog(target, type); if (type === "group") { const group = target as ServerGroup; if (item.key === "rename") openGroupDialog(group); if (item.key === "delete" && window.confirm(`确认删除分组“${group.name}”？其中的连接会保留在未分组列表中。`)) emit("deleteGroup", group.id); return; } const server = target as ServerConfig; if (item.key === "pin") emit("setServerPinned", server); if (item.key === "edit") emit("editServer", server); if (item.key === "delete") emit("deleteServer", server.id); }
function startServerDrag(event: DragEvent, server: ServerConfig): void { draggedServerId.value = server.id; event.dataTransfer?.setData("text/plain", server.id); if (event.dataTransfer) event.dataTransfer.effectAllowed = "move"; }
function finishServerDrag(groupId?: string): void { const server = props.servers.find(item => item.id === draggedServerId.value); if (server && server.groupId !== groupId) emit("moveServerToGroup", server, groupId); draggedServerId.value = null; }
</script>

<template>
  <section :class="['panel', 'server-panel', { collapsed }]">
    <div class="panel-header" draggable="true"><button type="button" class="panel-toggle" :aria-expanded="!collapsed" aria-controls="server-panel-content" @click="emit('toggleCollapsed')"><img :class="{ expanded: !collapsed }" :src="chevronRightIcon" alt="" /><h2>服务器</h2></button><div v-if="!collapsed" class="server-header-actions"><button type="button" class="icon-button" aria-label="新增分组" title="新增分组" @click.stop="openGroupDialog()"><img :src="groupAddIcon" alt="" /></button><button type="button" class="icon-button" aria-label="新增连接" title="新增连接" @click.stop="emit('openConnectionDialog')"><img :src="serverAddIcon" alt="" /></button></div></div>
    <Transition name="panel-slide"><div v-show="!collapsed" id="server-panel-content" class="server-list"><div v-if="runtimeError" class="server-empty error">{{ runtimeError }}</div><div v-else-if="isServerListLoading" class="server-empty">正在加载服务器...</div><div v-else-if="listError" class="server-empty error">{{ listError }}</div><div v-else-if="!hasServers && !groups.length" class="server-empty">暂无服务器，点击右上角新增连接</div>
      <section v-for="group in groups" :key="group.id" class="server-group" :class="{ 'drop-target': draggedServerId }" :style="group.color ? { backgroundColor: group.color } : undefined" @dragover.prevent @drop.prevent="finishServerDrag(group.id)"><div class="server-group-header"><button type="button" class="server-group-toggle" :aria-expanded="!isGroupCollapsed(group.id)" @click="toggleGroup(group.id)"><img :class="{ expanded: !isGroupCollapsed(group.id) }" :src="chevronRightIcon" alt="" /><strong>{{ group.name }}</strong><span>{{ serversInGroup(group.id).length }}</span></button><button type="button" class="server-menu-trigger" aria-label="分组更多操作" @click="openMenu($event, group, 'group')"><img :src="moreIcon" alt="" /></button></div><div v-show="!isGroupCollapsed(group.id)" class="server-group-list"><p v-if="!serversInGroup(group.id).length" class="server-group-empty">将连接拖到此处</p><article v-for="server in serversInGroup(group.id)" :key="server.id" :class="['server-item', { active: server.id === activeServerId }]" :style="server.color ? { backgroundColor: server.color } : undefined" draggable="true" role="button" tabindex="0" @dragstart.stop="startServerDrag($event, server)" @dragend="draggedServerId = null" @click="emit('openServerTerminal', server)"><div class="server-meta"><div class="server-title"><span v-if="server.isPinned" class="server-pinned-badge"><img :src="pinIcon" alt="" /></span><strong>{{ server.name }}</strong></div><span>{{ server.username }}@{{ server.host }}:{{ server.port }}</span></div><button type="button" class="server-menu-trigger" aria-label="连接更多操作" @click.stop="openMenu($event, server, 'server')"><img :src="moreIcon" alt="" /></button></article></div></section>
      <section v-if="ungroupedServers.length || groups.length" class="server-ungrouped" :class="{ 'drop-target': draggedServerId }" @dragover.prevent @drop.prevent="finishServerDrag()"><p v-if="groups.length" class="server-ungrouped-title">未分组</p><article v-for="server in ungroupedServers" :key="server.id" :class="['server-item', { active: server.id === activeServerId }]" :style="server.color ? { backgroundColor: server.color } : undefined" draggable="true" role="button" tabindex="0" @dragstart.stop="startServerDrag($event, server)" @dragend="draggedServerId = null" @click="emit('openServerTerminal', server)"><div class="server-meta"><div class="server-title"><span v-if="server.isPinned" class="server-pinned-badge"><img :src="pinIcon" alt="" /></span><strong>{{ server.name }}</strong></div><span>{{ server.username }}@{{ server.host }}:{{ server.port }}</span></div><button type="button" class="server-menu-trigger" aria-label="连接更多操作" @click.stop="openMenu($event, server, 'server')"><img :src="moreIcon" alt="" /></button></article><p v-if="!ungroupedServers.length" class="server-group-empty">将连接拖到此处以取消分组</p></section>
    </div></Transition>
    <ContextMenu :menu="menu" :items="menuItems" @select="selectMenuItem" @close="closeMenu" />
    <ServerGroupDialog :open="groupDialog.open" :name="groupDialog.name" :editing="Boolean(groupDialog.editing)" @update-name="groupDialog.name = $event" @submit="submitGroup" @close="closeGroupDialog" />
    <ColorPickerDialog :open="colorDialog.open" :title="colorDialog.type === 'group' ? '分组颜色' : '连接颜色'" :color="colorDialog.target?.color" @select="saveColor" @clear="saveColor(undefined); closeColorDialog()" @close="closeColorDialog" />
  </section>
</template>
