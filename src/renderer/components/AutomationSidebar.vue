<script setup lang="ts">
import { reactive, ref, watch } from "vue";
import continueIcon from "../assets/icons/continue.svg";
import chevronRightIcon from "../assets/icons/chevron-right.svg";
import plusIcon from "../assets/icons/plus.svg";
import type { ServerAutomationTask } from "../../shared/server";
import type { TerminalTab } from "../types/terminal";
import { useCoreStore } from "../stores/useCoreStore";
import { useServersStore } from "../stores/useServersStore";
import { useTerminalsStore } from "../stores/useTerminalsStore";
import AutomationRunDialog from "./AutomationRunDialog.vue";
import AutomationTaskDialog from "./AutomationTaskDialog.vue";

const props = defineProps<{ activeTab?: TerminalTab; collapsed: boolean }>();
const emit = defineEmits<{ toggleCollapsed: [] }>();
const core = useCoreStore();
const serversStore = useServersStore();
const terminalsStore = useTerminalsStore();
const tasks = ref<ServerAutomationTask[]>([]);
const isLoading = ref(false);
const loadError = ref("");
const taskDialog = reactive({ open: false, serverId: "", serverName: "", error: "", isSubmitting: false });
const taskForm = reactive({ name: "", script: "" });
const runDialog = reactive<{ open: boolean; task: ServerAutomationTask | null; serverName: string }>({ open: false, task: null, serverName: "" });

// 当前标签变化时只加载该服务器保存的自定义指令，避免跨服务器误执行。
async function loadTasks(): Promise<void> {
  const serverId = props.activeTab?.serverId;
  if (!serverId || !core.orbitSSHApi?.servers.listAutomationTasks) {
    tasks.value = [];
    loadError.value = "";
    return;
  }

  isLoading.value = true;
  loadError.value = "";
  try {
    const loadedTasks = await core.orbitSSHApi.servers.listAutomationTasks(serverId);
    if (props.activeTab?.serverId === serverId) tasks.value = loadedTasks;
  } catch (error) {
    tasks.value = [];
    loadError.value = error instanceof Error ? error.message : "加载自定义指令失败";
  } finally {
    if (props.activeTab?.serverId === serverId) isLoading.value = false;
  }
}

function openTaskDialog(): void {
  if (!props.activeTab) return;
  taskForm.name = "";
  taskForm.script = "";
  taskDialog.serverId = props.activeTab.serverId;
  taskDialog.serverName = props.activeTab.title;
  taskDialog.error = "";
  taskDialog.open = true;
}

function closeTaskDialog(): void {
  if (taskDialog.isSubmitting) return;
  taskDialog.open = false;
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
    await core.orbitSSHApi.servers.createAutomationTask({ serverId: taskDialog.serverId, name, script });
    taskDialog.open = false;
    await loadTasks();
  } catch (error) {
    taskDialog.error = error instanceof Error ? error.message : "保存自定义指令失败";
  } finally {
    taskDialog.isSubmitting = false;
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
watch(() => props.activeTab?.serverId, () => void loadTasks(), { immediate: true });
</script>

<template>
  <section class="panel automation-panel">
    <div class="panel-header" draggable="true">
      <button type="button" class="panel-toggle" :aria-expanded="!collapsed" aria-controls="automation-panel-content" @click="emit('toggleCollapsed')">
        <img :class="{ expanded: !collapsed }" :src="chevronRightIcon" alt="" />
        <h2>自定义指令</h2>
      </button>
      <button v-if="!collapsed" type="button" class="icon-button" aria-label="新建自定义指令" title="新建自定义指令" :disabled="!activeTab" @click.stop="openTaskDialog">
        <img :src="plusIcon" alt="" />
      </button>
    </div>
    <Transition name="panel-slide">
    <div v-show="!collapsed" id="automation-panel-content" class="automation-sidebar-list">
      <p v-if="!activeTab" class="automation-sidebar-empty">连接服务器后显示该服务器的指令</p>
      <p v-else-if="isLoading" class="automation-sidebar-empty">正在加载指令...</p>
      <p v-else-if="loadError" class="automation-sidebar-empty error">{{ loadError }}</p>
      <p v-else-if="tasks.length === 0" class="automation-sidebar-empty">暂无自定义指令</p>
      <article v-for="task in tasks" :key="task.id" class="automation-sidebar-item">
        <strong :title="task.name">{{ task.name }}</strong>
        <button type="button" class="automation-run-button" :aria-label="`执行 ${task.name}`" title="执行" @click="openRunDialog(task)">
          <img :src="continueIcon" alt="" />
        </button>
      </article>
    </div>
    </Transition>
  </section>

  <AutomationTaskDialog :open="taskDialog.open" :server-name="taskDialog.serverName" :form="taskForm" :error="taskDialog.error" :is-submitting="taskDialog.isSubmitting" @close="closeTaskDialog" @submit="saveTask" />
  <AutomationRunDialog :open="runDialog.open" :server-name="runDialog.serverName" :task="runDialog.task" @close="closeRunDialog" @start="startRun" />
</template>
