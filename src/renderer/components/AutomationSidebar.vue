<script setup lang="ts">
import { computed, reactive, ref, watch } from "vue";
import continueIcon from "../assets/icons/continue.svg";
import plusIcon from "../assets/icons/plus.svg";
import groupAddIcon from "../assets/icons/server-group-add.svg";
import type { AutomationTaskGroup, ServerAutomationTask } from "../../shared/server";
import type { TerminalTab } from "../types/terminal";
import { useCoreStore } from "../stores/useCoreStore";
import { useServersStore } from "../stores/useServersStore";
import { useTerminalsStore } from "../stores/useTerminalsStore";
import AutomationRunDialog from "./AutomationRunDialog.vue";
import AutomationTaskDialog from "./AutomationTaskDialog.vue";
import ServerGroupDialog from "./ServerGroupDialog.vue";
import ContextMenu from "./ContextMenu.vue";
import DeleteConfirmDialog from "./DeleteConfirmDialog.vue";
import GroupedList from "./GroupedList.vue";
import SidebarPanel from "./ui/SidebarPanel.vue";
import type { ContextMenuItem } from "../types/context-menu";
import {
  buildMoveToGroupMenuItem,
  parseMoveToGroupKey,
  useContextMenuTarget,
  useGroupDeleteDialog,
  useGroupNameDialog,
} from "../composables/useGroupedSidebar";

const props = defineProps<{ activeTab?: TerminalTab; collapsed: boolean }>();
const emit = defineEmits<{ toggleCollapsed: [] }>();
const core = useCoreStore();
const serversStore = useServersStore();
const terminalsStore = useTerminalsStore();
const tasks = ref<ServerAutomationTask[]>([]);
const isLoading = ref(false);
const loadError = ref("");
const taskDialog = reactive({
  open: false,
  serverId: "",
  serverName: "",
  error: "",
  isSubmitting: false,
});
const taskForm = reactive({ name: "", script: "" });
const editingTask = ref<ServerAutomationTask | null>(null);
const groups = ref<AutomationTaskGroup[]>([]);
const { groupDialog, openGroupDialog, closeGroupDialog } =
  useGroupNameDialog<AutomationTaskGroup>();
const { menu, menuTarget, menuTargetType, openMenu, closeMenu } = useContextMenuTarget<
  AutomationTaskGroup | ServerAutomationTask,
  "group" | "task"
>("group");
const { groupDeleteDialog, requestGroupDelete, closeGroupDeleteDialog } =
  useGroupDeleteDialog<AutomationTaskGroup>();
const runDialog = reactive<{
  open: boolean;
  task: ServerAutomationTask | null;
  serverName: string;
}>({ open: false, task: null, serverName: "" });

// 当前标签变化时只加载该服务器保存的自定义指令，避免跨服务器误执行。
async function loadTasks(): Promise<void> {
  const serverId = props.activeTab?.serverId;
  if (!serverId || !core.orbitSSHApi?.servers.listAutomationTasks) {
    tasks.value = [];
    groups.value = [];
    loadError.value = "";
    return;
  }

  isLoading.value = true;
  loadError.value = "";
  try {
    const [loadedTasks, loadedGroups] = await Promise.all([
      core.orbitSSHApi.servers.listAutomationTasks(serverId),
      core.orbitSSHApi.servers.listAutomationTaskGroups(serverId),
    ]);
    if (props.activeTab?.serverId === serverId) {
      tasks.value = loadedTasks;
      groups.value = loadedGroups;
    }
  } catch (error) {
    tasks.value = [];
    loadError.value = error instanceof Error ? error.message : "加载自定义指令失败";
  } finally {
    if (props.activeTab?.serverId === serverId) isLoading.value = false;
  }
}
async function submitGroup(): Promise<void> {
  const serverId = props.activeTab?.serverId;
  const name = groupDialog.name.trim();
  if (!serverId || !name) return;
  try {
    if (groupDialog.editing)
      await core.orbitSSHApi?.servers.updateAutomationTaskGroup({
        id: groupDialog.editing.id,
        serverId,
        name,
      });
    else
      await core.orbitSSHApi?.servers.createAutomationTaskGroup({
        serverId,
        name,
      });
    await loadTasks();
    closeGroupDialog();
  } catch (error) {
    loadError.value = error instanceof Error ? error.message : "保存分组失败";
  }
}
async function deleteGroup(group: AutomationTaskGroup): Promise<void> {
  const serverId = props.activeTab?.serverId;
  if (!serverId) return;
  await core.orbitSSHApi?.servers.deleteAutomationTaskGroup(serverId, group.id);
  await loadTasks();
}
const menuItems = computed<ContextMenuItem[]>(() => {
  if (menuTargetType.value === "group") {
    return [
      { key: "rename", label: "重命名" },
      { key: "delete", label: "删除分组", group: "danger", danger: true },
    ];
  }

  const task = menuTarget.value as ServerAutomationTask | null;
  return [
    { key: "pin", label: task?.isPinned ? "取消置顶" : "置顶" },
    { key: "edit", label: "编辑" },
    buildMoveToGroupMenuItem(groups.value, task?.groupId),
    { key: "delete", label: "删除指令", group: "danger", danger: true },
  ];
});
function selectMenuItem(item: ContextMenuItem): void {
  const target = menuTarget.value;
  const type = menuTargetType.value;
  closeMenu();
  if (!target) return;
  if (type === "group") {
    if (item.key === "rename") openGroupDialog(target as AutomationTaskGroup);
    else if (item.key === "delete") requestGroupDelete(target as AutomationTaskGroup);
    return;
  }
  const task = target as ServerAutomationTask;
  const move = parseMoveToGroupKey(item.key);
  if (move) {
    if (task.groupId !== move.groupId) void moveTaskToGroup(task, move.groupId);
    return;
  }
  if (item.key === "pin") void togglePinned(task);
  if (item.key === "edit") openTaskDialog(task);
  if (item.key === "delete") void deleteTask(task);
}
function confirmGroupDelete(): void {
  const group = groupDeleteDialog.group;
  if (group) void deleteGroup(group);
  closeGroupDeleteDialog();
}
async function moveTaskToGroup(task: ServerAutomationTask, groupId?: string): Promise<boolean> {
  const serverId = props.activeTab?.serverId;
  if (!task || !serverId || task.groupId === groupId) return false;
  try {
    await core.orbitSSHApi?.servers.organizeAutomationTask({
      id: task.id,
      serverId,
      groupId,
    });
    await loadTasks();
    return true;
  } catch (error) {
    loadError.value = error instanceof Error ? error.message : "移动指令失败";
    return false;
  }
}
async function togglePinned(task: ServerAutomationTask): Promise<void> {
  const serverId = props.activeTab?.serverId;
  if (!serverId) return;
  await core.orbitSSHApi?.servers.organizeAutomationTask({
    id: task.id,
    serverId,
    groupId: task.groupId,
    isPinned: !task.isPinned,
  });
  await loadTasks();
}

function openTaskDialog(task?: ServerAutomationTask): void {
  if (!props.activeTab) return;
  editingTask.value = task ?? null;
  taskForm.name = task?.name ?? "";
  taskForm.script = task?.script ?? "";
  taskDialog.serverId = props.activeTab.serverId;
  taskDialog.serverName = props.activeTab.title;
  taskDialog.error = "";
  taskDialog.open = true;
}

function closeTaskDialog(): void {
  if (taskDialog.isSubmitting) return;
  taskDialog.open = false;
  editingTask.value = null;
  taskDialog.error = "";
}

async function saveTask(): Promise<void> {
  const name = taskForm.name.trim();
  const script = taskForm.script.trim();
  if (!name || !script) {
    taskDialog.error = "请填写指令名称和脚本内容";
    return;
  }
  if (!core.orbitSSHApi?.servers.createAutomationTask) {
    taskDialog.error = "自定义指令保存服务不可用，请重启应用后重试";
    return;
  }
  taskDialog.isSubmitting = true;
  try {
    if (editingTask.value)
      await core.orbitSSHApi.servers.updateAutomationTask({
        id: editingTask.value.id,
        serverId: taskDialog.serverId,
        name,
        script,
        groupId: editingTask.value.groupId,
      });
    else
      await core.orbitSSHApi.servers.createAutomationTask({
        serverId: taskDialog.serverId,
        name,
        script,
      });
    taskDialog.open = false;
    await loadTasks();
  } catch (error) {
    taskDialog.error = error instanceof Error ? error.message : "保存自定义指令失败";
  } finally {
    taskDialog.isSubmitting = false;
  }
}
async function deleteTask(task: ServerAutomationTask): Promise<void> {
  const serverId = props.activeTab?.serverId;
  if (!serverId) return;
  try {
    await core.orbitSSHApi?.servers.deleteAutomationTask(serverId, task.id);
    await loadTasks();
  } catch (error) {
    loadError.value = error instanceof Error ? error.message : "删除自定义指令失败";
  }
}

function openRunDialog(task: ServerAutomationTask): void {
  runDialog.open = true;
  runDialog.task = task;
  runDialog.serverName = props.activeTab?.title ?? "";
}

function closeRunDialog(): void {
  runDialog.open = false;
  runDialog.task = null;
  runDialog.serverName = "";
}

async function startRun(): Promise<void> {
  if (!runDialog.task) return;
  const server = serversStore.servers.find(item => item.id === runDialog.task?.serverId);
  if (!server) {
    loadError.value = "目标服务器不存在或已被删除";
    return;
  }
  try {
    await terminalsStore.openTerminalAutomation(server, runDialog.task.name, runDialog.task.script);
    closeRunDialog();
  } catch (error) {
    loadError.value = error instanceof Error ? error.message : "自定义指令启动失败";
  }
}
watch(
  () => props.activeTab?.serverId,
  () => void loadTasks(),
  { immediate: true },
);
</script>

<template>
  <SidebarPanel
    title="自定义指令"
    content-id="automation-panel-content"
    :collapsed="collapsed"
    @toggle-collapsed="emit('toggleCollapsed')"
  >
    <template #actions>
      <button
        type="button"
        class="icon-btn"
        aria-label="新建指令分组"
        title="新建指令分组"
        :disabled="!activeTab"
        @click.stop="openGroupDialog()"
      >
        <img :src="groupAddIcon" alt="" />
      </button>
      <button
        type="button"
        class="icon-btn"
        aria-label="新建自定义指令"
        title="新建自定义指令"
        :disabled="!activeTab"
        @click.stop="openTaskDialog()"
      >
        <img :src="plusIcon" alt="" />
      </button>
    </template>
    <GroupedList
      :items="tasks"
      :groups="groups"
      item-noun="指令"
      :move-item="moveTaskToGroup"
      @item-menu="(event, task) => openMenu(event, task, 'task')"
      @group-menu="(event, group) => openMenu(event, group, 'group')"
    >
      <template #status>
        <p v-if="!activeTab" class="empty-state empty-state-card">连接服务器后显示该服务器的指令</p>
        <p v-else-if="isLoading" class="empty-state empty-state-card">正在加载指令...</p>
        <p v-else-if="loadError" class="empty-state empty-state-card is-error">
          {{ loadError }}
        </p>
        <p
          v-else-if="tasks.length === 0 && groups.length === 0"
          class="empty-state empty-state-card"
        >
          暂无自定义指令
        </p>
      </template>
      <template #item-actions="{ item }">
        <button
          type="button"
          class="icon-btn icon-btn-sm"
          :aria-label="`执行 ${item.name}`"
          title="执行"
          @click.stop="openRunDialog(item)"
        >
          <img :src="continueIcon" alt="" />
        </button>
      </template>
    </GroupedList>
  </SidebarPanel>

  <AutomationTaskDialog
    :open="taskDialog.open"
    :server-name="taskDialog.serverName"
    :form="taskForm"
    :error="taskDialog.error"
    :is-submitting="taskDialog.isSubmitting"
    :editing="Boolean(editingTask)"
    @close="closeTaskDialog"
    @submit="saveTask"
  />
  <ServerGroupDialog
    :open="groupDialog.open"
    :name="groupDialog.name"
    :editing="Boolean(groupDialog.editing)"
    description="为当前服务器的快捷指令创建分类。"
    @update-name="groupDialog.name = $event"
    @close="closeGroupDialog"
    @submit="submitGroup"
  />
  <ContextMenu :menu="menu" :items="menuItems" @select="selectMenuItem" @close="closeMenu" />
  <DeleteConfirmDialog
    :open="groupDeleteDialog.open"
    title="删除分组"
    message="删除后，分组内的快捷指令将移至未分组。"
    confirm-label="删除分组"
    :danger="true"
    @cancel="closeGroupDeleteDialog"
    @confirm="confirmGroupDelete"
  />
  <AutomationRunDialog
    :open="runDialog.open"
    :server-name="runDialog.serverName"
    :task="runDialog.task"
    @close="closeRunDialog"
    @start="startRun"
  />
</template>
