<script setup lang="ts">
import { computed, reactive, ref, watch } from "vue";
import continueIcon from "../assets/icons/continue.svg";
import chevronRightIcon from "../assets/icons/chevron-right.svg";
import plusIcon from "../assets/icons/plus.svg";
import groupAddIcon from "../assets/icons/server-group-add.svg";
import pinIcon from "../assets/icons/pin.svg";
import moreIcon from "../assets/icons/settings.svg";
import type {
  AutomationTaskGroup,
  ServerAutomationTask,
} from "../../shared/server";
import type { TerminalTab } from "../types/terminal";
import { useCoreStore } from "../stores/useCoreStore";
import { useServersStore } from "../stores/useServersStore";
import { useTerminalsStore } from "../stores/useTerminalsStore";
import AutomationRunDialog from "./AutomationRunDialog.vue";
import AutomationTaskDialog from "./AutomationTaskDialog.vue";
import ServerGroupDialog from "./ServerGroupDialog.vue";
import ContextMenu from "./ContextMenu.vue";
import DeleteConfirmDialog from "./DeleteConfirmDialog.vue";
import type { ContextMenuItem, ContextMenuState } from "../types/context-menu";
import { useGroupedDrag } from "../composables/useGroupedDrag";

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
const collapsedGroupIds = ref<string[]>([]);
const isUngroupedCollapsed = ref(false);
const groupDialog = reactive<{
  open: boolean;
  editing: AutomationTaskGroup | null;
  name: string;
}>({ open: false, editing: null, name: "" });
const menu = reactive<ContextMenuState>({ open: false, x: 0, y: 0 });
const menuTarget = ref<AutomationTaskGroup | ServerAutomationTask | null>(null);
const menuTargetType = ref<"group" | "task">("group");
const groupDeleteDialog = reactive<{
  open: boolean;
  group: AutomationTaskGroup | null;
}>({ open: false, group: null });
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
    loadError.value =
      error instanceof Error ? error.message : "加载自定义指令失败";
  } finally {
    if (props.activeTab?.serverId === serverId) isLoading.value = false;
  }
}
const ungroupedTasks = computed(() =>
  tasks.value.filter(task => !task.groupId),
);
const {
  draggedId: draggedTaskId,
  showUngroupedDock,
  startDrag: startTaskDrag,
  enterDropTarget: enterTaskDropTarget,
  leaveDropTarget: leaveTaskDropTarget,
  finishDrag: finishTaskDrag,
  cancelDrag: cancelTaskDrag,
  isDropAvailable: isTaskDropAvailable,
  isDropHovered: isTaskDropHovered,
  isRecentlyDropped: isTaskRecentlyDropped,
} = useGroupedDrag(() => tasks.value, moveTaskToGroup);
function tasksInGroup(groupId: string): ServerAutomationTask[] {
  return tasks.value.filter(task => task.groupId === groupId);
}
function isGroupCollapsed(groupId: string): boolean {
  return collapsedGroupIds.value.includes(groupId);
}
function toggleGroup(groupId: string): void {
  collapsedGroupIds.value = isGroupCollapsed(groupId)
    ? collapsedGroupIds.value.filter(id => id !== groupId)
    : [...collapsedGroupIds.value, groupId];
}
function expandGroup(groupId: string): void {
  if (isGroupCollapsed(groupId))
    collapsedGroupIds.value = collapsedGroupIds.value.filter(
      id => id !== groupId,
    );
}
function openGroupDialog(group?: AutomationTaskGroup): void {
  groupDialog.open = true;
  groupDialog.editing = group ?? null;
  groupDialog.name = group?.name ?? "";
}
function closeGroupDialog(): void {
  groupDialog.open = false;
  groupDialog.editing = null;
  groupDialog.name = "";
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
const menuItems = computed<ContextMenuItem[]>(() =>
  menuTargetType.value === "group"
    ? [
        { key: "rename", label: "重命名" },
        { key: "delete", label: "删除分组", group: "danger", danger: true },
      ]
    : [
        {
          key: "pin",
          label: (menuTarget.value as ServerAutomationTask)?.isPinned
            ? "取消置顶"
            : "置顶",
        },
        { key: "edit", label: "编辑" },
        {
          key: "move",
          label: "移动到分组",
          group: "organize",
          children: [
            ...groups.value.map(group => ({
              key: `move:${group.id}`,
              label: `${(menuTarget.value as ServerAutomationTask)?.groupId === group.id ? "✓ " : ""}${group.name}`,
              group: "groups",
              disabled:
                (menuTarget.value as ServerAutomationTask)?.groupId === group.id,
            })),
            {
              key: "move:ungrouped",
              label: `${!(menuTarget.value as ServerAutomationTask)?.groupId ? "✓ " : ""}未分组`,
              group: "ungrouped",
              disabled: !(menuTarget.value as ServerAutomationTask)?.groupId,
            },
          ],
        },
        { key: "delete", label: "删除指令", group: "danger", danger: true },
      ],
);
function openMenu(
  event: MouseEvent,
  target: AutomationTaskGroup | ServerAutomationTask,
  type: "group" | "task",
): void {
  event.stopPropagation();
  menuTarget.value = target;
  menuTargetType.value = type;
  menu.x = event.clientX;
  menu.y = event.clientY;
  menu.open = true;
}
function closeMenu(): void {
  menu.open = false;
  menuTarget.value = null;
}
function selectMenuItem(item: ContextMenuItem): void {
  const target = menuTarget.value;
  const type = menuTargetType.value;
  closeMenu();
  if (!target) return;
  if (type === "group") {
    if (item.key === "rename") openGroupDialog(target as AutomationTaskGroup);
    else if (item.key === "delete") {
      groupDeleteDialog.group = target as AutomationTaskGroup;
      groupDeleteDialog.open = true;
    }
    return;
  }
  const task = target as ServerAutomationTask;
  if (item.key.startsWith("move:")) {
    const groupId =
      item.key === "move:ungrouped" ? undefined : item.key.slice(5);
    if (task.groupId !== groupId) void moveTaskToGroup(task, groupId);
    return;
  }
  if (item.key === "pin") void togglePinned(task);
  if (item.key === "edit") openTaskDialog(task);
  if (item.key === "delete") void deleteTask(task);
}
function closeGroupDeleteDialog(): void {
  groupDeleteDialog.open = false;
  groupDeleteDialog.group = null;
}
function confirmGroupDelete(): void {
  const group = groupDeleteDialog.group;
  if (group) void deleteGroup(group);
  closeGroupDeleteDialog();
}
async function moveTaskToGroup(
  task: ServerAutomationTask,
  groupId?: string,
): Promise<boolean> {
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
    taskDialog.error =
      error instanceof Error ? error.message : "保存自定义指令失败";
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
    loadError.value =
      error instanceof Error ? error.message : "删除自定义指令失败";
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
  const server = serversStore.servers.find(
    item => item.id === runDialog.task?.serverId,
  );
  if (!server) {
    loadError.value = "目标服务器不存在或已被删除";
    return;
  }
  try {
    await terminalsStore.openTerminalAutomation(
      server,
      runDialog.task.name,
      runDialog.task.script,
    );
    closeRunDialog();
  } catch (error) {
    loadError.value =
      error instanceof Error ? error.message : "自定义指令启动失败";
  }
}
watch(
  () => props.activeTab?.serverId,
  () => void loadTasks(),
  { immediate: true },
);
</script>

<template>
  <section class="panel automation-panel">
    <div class="panel-header" draggable="true">
      <button
        type="button"
        class="panel-toggle"
        :aria-expanded="!collapsed"
        aria-controls="automation-panel-content"
        @click="emit('toggleCollapsed')">
        <img :class="{ expanded: !collapsed }" :src="chevronRightIcon" alt="" />
        <h2>自定义指令</h2>
      </button>
      <div v-if="!collapsed" class="server-header-actions">
        <button
          type="button"
          class="icon-button"
          aria-label="新建指令分组"
          title="新建指令分组"
          :disabled="!activeTab"
          @click.stop="openGroupDialog()">
          <img :src="groupAddIcon" alt="" /></button
        ><button
          type="button"
          class="icon-button"
          aria-label="新建自定义指令"
          title="新建自定义指令"
          :disabled="!activeTab"
          @click.stop="openTaskDialog()">
          <img :src="plusIcon" alt="" />
        </button>
      </div>
    </div>
    <Transition name="panel-slide">
      <div
        v-show="!collapsed"
        id="automation-panel-content"
        class="grouped-sidebar-content"
        :class="{ 'drag-active': draggedTaskId }">
        <div class="automation-sidebar-list">
        <p v-if="!activeTab" class="automation-sidebar-empty">
          连接服务器后显示该服务器的指令
        </p>
        <p v-else-if="isLoading" class="automation-sidebar-empty">
          正在加载指令...
        </p>
        <p v-else-if="loadError" class="automation-sidebar-empty error">
          {{ loadError }}
        </p>
        <p
          v-else-if="tasks.length === 0 && groups.length === 0"
          class="automation-sidebar-empty">
          暂无自定义指令
        </p>
        <section
          v-for="group in groups"
          :key="group.id"
          class="server-group grouped-section"
          :class="{
            'drop-available': isTaskDropAvailable(group.id),
            'drop-hovered': isTaskDropHovered(group.id),
            'drop-complete': isTaskRecentlyDropped(group.id),
          }"
          @dragover.prevent
          @dragenter.prevent="
            enterTaskDropTarget($event, group.id, () => expandGroup(group.id))
          "
          @dragleave="leaveTaskDropTarget($event, group.id)"
          @drop.prevent="finishTaskDrag(group.id)">
          <div class="server-group-header">
            <button
              type="button"
              class="server-group-toggle"
              :aria-expanded="!isGroupCollapsed(group.id)"
              @click="toggleGroup(group.id)">
              <img
                :class="{ expanded: !isGroupCollapsed(group.id) }"
                :src="chevronRightIcon"
                alt="" /><strong>{{ group.name }}</strong
              ><span>{{ tasksInGroup(group.id).length }}</span></button
            ><button
              type="button"
              class="server-menu-trigger"
              aria-label="分组更多操作"
              @click="openMenu($event, group, 'group')">
              <img :src="moreIcon" alt="" />
            </button>
          </div>
          <div v-show="!isGroupCollapsed(group.id)" class="server-group-list">
            <p v-if="!tasksInGroup(group.id).length" class="server-group-empty">
              将指令拖到此处
            </p>
            <article
              v-for="task in tasksInGroup(group.id)"
              :key="task.id"
              :class="[
                'server-item',
                { dragging: task.id === draggedTaskId },
              ]"
              draggable="true"
              @dragstart.stop="startTaskDrag($event, task)"
              @dragend="cancelTaskDrag">
              <div class="server-meta">
                <div class="server-title">
                  <span v-if="task.isPinned" class="server-pinned-badge"
                    ><img :src="pinIcon" alt="" /></span
                  ><strong :title="task.name">{{ task.name }}</strong>
                </div>
              </div>
              <div class="automation-task-actions">
                <button
                  type="button"
                  class="automation-run-button"
                  :aria-label="`执行 ${task.name}`"
                  title="执行"
                  @click="openRunDialog(task)">
                  <img :src="continueIcon" alt="" /></button
                ><button
                  type="button"
                  class="server-menu-trigger"
                  aria-label="指令更多操作"
                  @click.stop="openMenu($event, task, 'task')">
                  <img :src="moreIcon" alt="" />
                </button>
              </div>
            </article>
          </div>
        </section>
        <section
          v-if="ungroupedTasks.length || groups.length"
          class="server-ungrouped grouped-section"
          :class="{
            'drop-available': isTaskDropAvailable(),
            'drop-hovered': isTaskDropHovered(),
            'drop-complete': isTaskRecentlyDropped(),
          }"
          @dragover.prevent
          @dragenter.prevent="enterTaskDropTarget($event)"
          @dragleave="leaveTaskDropTarget($event)"
          @drop.prevent="finishTaskDrag()">
          <div class="server-group-header">
            <button
              type="button"
              class="server-group-toggle"
              :aria-expanded="!isUngroupedCollapsed"
              @click="isUngroupedCollapsed = !isUngroupedCollapsed">
              <img
                :class="{ expanded: !isUngroupedCollapsed }"
                :src="chevronRightIcon"
                alt="" /><strong>未分组</strong
              ><span>{{ ungroupedTasks.length }}</span>
            </button>
          </div>
          <div v-show="!isUngroupedCollapsed" class="server-group-list">
            <article
              v-for="task in ungroupedTasks"
              :key="task.id"
              :class="[
                'server-item',
                { dragging: task.id === draggedTaskId },
              ]"
              draggable="true"
              @dragstart.stop="startTaskDrag($event, task)"
              @dragend="cancelTaskDrag">
              <div class="server-meta">
                <div class="server-title">
                  <span v-if="task.isPinned" class="server-pinned-badge"
                    ><img :src="pinIcon" alt="" /></span
                  ><strong :title="task.name">{{ task.name }}</strong>
                </div>
              </div>
              <div class="automation-task-actions">
                <button
                  type="button"
                  class="automation-run-button"
                  title="执行"
                  @click="openRunDialog(task)">
                  <img :src="continueIcon" alt="" /></button
                ><button
                  type="button"
                  class="server-menu-trigger"
                  aria-label="指令更多操作"
                  @click.stop="openMenu($event, task, 'task')">
                  <img :src="moreIcon" alt="" />
                </button>
              </div>
            </article>
            <p v-if="!ungroupedTasks.length" class="server-group-empty">
              暂无未分组指令
            </p>
          </div>
        </section>
        </div>
        <div
          v-if="showUngroupedDock"
          class="ungrouped-drop-dock"
          :class="{ hovered: isTaskDropHovered() }"
          @dragover.prevent
          @dragenter.prevent="enterTaskDropTarget($event)"
          @dragleave="leaveTaskDropTarget($event)"
          @drop.stop.prevent="finishTaskDrag()">
          <strong>{{ isTaskDropHovered() ? "松开以移至未分组" : "拖到这里移至未分组" }}</strong>
        </div>
      </div>
    </Transition>
  </section>

  <AutomationTaskDialog
    :open="taskDialog.open"
    :server-name="taskDialog.serverName"
    :form="taskForm"
    :error="taskDialog.error"
    :is-submitting="taskDialog.isSubmitting"
    :editing="Boolean(editingTask)"
    @close="closeTaskDialog"
    @submit="saveTask" />
  <ServerGroupDialog
    :open="groupDialog.open"
    :name="groupDialog.name"
    :editing="Boolean(groupDialog.editing)"
    description="为当前服务器的快捷指令创建分类。"
    @update-name="groupDialog.name = $event"
    @close="closeGroupDialog"
    @submit="submitGroup" />
  <ContextMenu
    :menu="menu"
    :items="menuItems"
    @select="selectMenuItem"
    @close="closeMenu" />
  <DeleteConfirmDialog
    :open="groupDeleteDialog.open"
    title="删除分组"
    message="删除后，分组内的快捷指令将移至未分组。"
    confirm-label="删除分组"
    :danger="true"
    @cancel="closeGroupDeleteDialog"
    @confirm="confirmGroupDelete" />
  <AutomationRunDialog
    :open="runDialog.open"
    :server-name="runDialog.serverName"
    :task="runDialog.task"
    @close="closeRunDialog"
    @start="startRun" />
</template>

<style scoped>
/* 与服务器面板保持相同的标题层级和操作区尺寸。 */
.panel-header {
  flex-basis: 38px;
  height: 38px;
  padding: 0 8px 0 10px;
}

.panel-toggle h2 {
  color: var(--text-primary);
  font-size: 13px;
  font-weight: 600;
  letter-spacing: 0.02em;
}
</style>
