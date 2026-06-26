<script setup lang="ts">
import { computed, onUnmounted, reactive, watch } from "vue";
import fileIcon from "../assets/icons/file.svg";
import folderIcon from "../assets/icons/folder.svg";
import type { ServerConfig } from "../../shared/server";
import type { RemoteFileNode, SftpRemoteTransferSource } from "../../shared/sftp";
import { formatFileSize, formatModifyTime } from "../utils/format";
import { getRemoteParentPath, getRootName } from "../utils/path";
import AppDialog from "./AppDialog.vue";

interface TransferPaneState {
  tabId: string;
  serverId: string;
  currentPath: string;
  nodes: RemoteFileNode[];
  selectedPaths: Set<string>;
  loading: boolean;
  error: string;
}

const props = defineProps<{
  servers: ServerConfig[];
  isMac: boolean;
}>();

const emit = defineEmits<{
  close: [];
}>();

const sourcePane = reactive<TransferPaneState>({
  tabId: `data-transfer-source-${crypto.randomUUID()}`,
  serverId: "",
  currentPath: "",
  nodes: [],
  selectedPaths: new Set<string>(),
  loading: false,
  error: "",
});
const targetPane = reactive<TransferPaneState>({
  tabId: `data-transfer-target-${crypto.randomUUID()}`,
  serverId: "",
  currentPath: "",
  nodes: [],
  selectedPaths: new Set<string>(),
  loading: false,
  error: "",
});

const selectedSourceNodes = computed(() =>
  sourcePane.nodes.filter(node => sourcePane.selectedPaths.has(node.path)),
);
const selectedTargetDirectory = computed(() =>
  targetPane.nodes.find(
    node => node.type === "directory" && targetPane.selectedPaths.has(node.path),
  ),
);
const transferTargetPath = computed(
  () => selectedTargetDirectory.value?.path || targetPane.currentPath,
);
const canTransfer = computed(
  () =>
    Boolean(
      sourcePane.serverId &&
        targetPane.serverId &&
        transferTargetPath.value &&
        selectedSourceNodes.value.length > 0 &&
        !sourcePane.loading &&
        !targetPane.loading,
    ),
);

function createParentNode(currentPath: string): RemoteFileNode | null {
  const normalizedPath = currentPath.replace(/\/+/g, "/").replace(/\/$/, "");

  if (!normalizedPath || normalizedPath === "/") {
    return null;
  }

  return {
    path: getRemoteParentPath(currentPath),
    name: "..",
    type: "directory",
    loaded: true,
  };
}

function getVisibleNodes(pane: TransferPaneState): RemoteFileNode[] {
  const parentNode = createParentNode(pane.currentPath);

  return parentNode ? [parentNode, ...pane.nodes] : pane.nodes;
}

async function closePaneSession(pane: TransferPaneState): Promise<void> {
  if (!window.orbitSSH?.sftp || !pane.tabId) {
    return;
  }

  await window.orbitSSH.sftp.close(pane.tabId).catch(() => undefined);
}

async function loadPaneHome(pane: TransferPaneState): Promise<void> {
  pane.error = "";
  pane.nodes = [];
  pane.currentPath = "";
  pane.selectedPaths = new Set<string>();

  if (!pane.serverId) {
    return;
  }

  pane.loading = true;

  try {
    await closePaneSession(pane);
    const result = await window.orbitSSH.sftp.open(pane.tabId, pane.serverId);
    pane.currentPath = result.homePath;
    pane.nodes = result.nodes;
  } catch (error) {
    pane.error = error instanceof Error ? error.message : "目录加载失败";
  } finally {
    pane.loading = false;
  }
}

async function openPaneDirectory(
  pane: TransferPaneState,
  path: string,
): Promise<void> {
  if (!pane.serverId || pane.loading) {
    return;
  }

  pane.loading = true;
  pane.error = "";
  pane.selectedPaths = new Set<string>();

  try {
    pane.nodes = await window.orbitSSH.sftp.list({
      tabId: pane.tabId,
      path,
    });
    pane.currentPath = path;
  } catch (error) {
    pane.error = error instanceof Error ? error.message : "目录读取失败";
  } finally {
    pane.loading = false;
  }
}

function isMultiSelect(event: MouseEvent): boolean {
  return props.isMac ? event.metaKey : event.ctrlKey;
}

function selectSourceNode(event: MouseEvent, node: RemoteFileNode): void {
  if (node.name === "..") {
    return;
  }

  const nextSelectedPaths = isMultiSelect(event)
    ? new Set(sourcePane.selectedPaths)
    : new Set<string>();

  if (sourcePane.selectedPaths.has(node.path)) {
    nextSelectedPaths.delete(node.path);
  } else {
    nextSelectedPaths.add(node.path);
  }

  sourcePane.selectedPaths = nextSelectedPaths;
}

function selectTargetNode(event: MouseEvent, node: RemoteFileNode): void {
  if (node.name === ".." || node.type !== "directory") {
    targetPane.selectedPaths = new Set<string>();
    return;
  }

  const nextSelectedPaths = isMultiSelect(event)
    ? new Set(targetPane.selectedPaths)
    : new Set<string>();

  if (targetPane.selectedPaths.has(node.path)) {
    nextSelectedPaths.delete(node.path);
  } else {
    nextSelectedPaths.add(node.path);
  }

  targetPane.selectedPaths = nextSelectedPaths;
}

async function openNodeByDoubleClick(
  pane: TransferPaneState,
  node: RemoteFileNode,
): Promise<void> {
  if (node.type !== "directory") {
    return;
  }

  await openPaneDirectory(pane, node.path);
}

async function submitTransfer(): Promise<void> {
  if (!canTransfer.value) {
    return;
  }

  const sources: SftpRemoteTransferSource[] = selectedSourceNodes.value.map(
    node => ({
      path: node.path,
      name: node.name,
      type: node.type,
      size: node.size,
    }),
  );

  try {
    if (!window.orbitSSH.sftp.remoteTransfer) {
      throw new Error("当前窗口未加载数据传输能力，请重启应用后重试");
    }

    await window.orbitSSH.sftp.remoteTransfer({
      sourceServerId: sourcePane.serverId,
      targetServerId: targetPane.serverId,
      sources,
      targetDirectoryPath: transferTargetPath.value,
    });
    sourcePane.selectedPaths = new Set<string>();
    targetPane.selectedPaths = new Set<string>();
    emit("close");
  } catch (error) {
    targetPane.error = error instanceof Error ? error.message : "传输任务创建失败";
  }
}

function getServerLabel(serverId: string): string {
  const server = props.servers.find(item => item.id === serverId);

  if (!server) {
    return "请选择连接";
  }

  return `${server.name} · ${server.username}@${server.host}`;
}

watch(
  () => props.servers,
  servers => {
    if (!sourcePane.serverId && servers[0]) {
      sourcePane.serverId = servers[0].id;
    }

    if (!targetPane.serverId && servers[1]) {
      targetPane.serverId = servers[1].id;
    }
  },
  { immediate: true },
);

watch(
  () => sourcePane.serverId,
  () => {
    void loadPaneHome(sourcePane);
  },
);

watch(
  () => targetPane.serverId,
  () => {
    void loadPaneHome(targetPane);
  },
);

onUnmounted(() => {
  void closePaneSession(sourcePane);
  void closePaneSession(targetPane);
});
</script>

<template>
  <AppDialog title="数据传输" width="large" @close="emit('close')">
    <div class="data-transfer-dialog">
      <section class="transfer-pane">
        <header class="transfer-pane-header">
          <strong>源</strong>
          <select v-model="sourcePane.serverId" title="源服务器">
            <option value="">请选择连接</option>
            <option
              v-for="server in servers"
              :key="server.id"
              :value="server.id">
              {{ server.name }}
            </option>
          </select>
        </header>
        <p class="transfer-path" :title="sourcePane.currentPath">
          {{ sourcePane.currentPath || getServerLabel(sourcePane.serverId) }}
        </p>
        <div class="transfer-file-list">
          <div v-if="sourcePane.loading" class="transfer-state">加载中...</div>
          <div v-else-if="sourcePane.error" class="transfer-state error">
            {{ sourcePane.error }}
          </div>
          <div
            v-else-if="getVisibleNodes(sourcePane).length === 0"
            class="transfer-state">
            当前目录为空
          </div>
          <template v-else>
            <button
              v-for="node in getVisibleNodes(sourcePane)"
              :key="node.path"
              type="button"
              :class="[
                'transfer-file-row',
                { selected: sourcePane.selectedPaths.has(node.path) },
              ]"
              :title="node.path"
              @click="selectSourceNode($event, node)"
              @dblclick="openNodeByDoubleClick(sourcePane, node)">
              <img :src="node.type === 'directory' ? folderIcon : fileIcon" alt="" />
              <span>{{ node.name }}</span>
              <small v-if="node.type === 'file'">{{ formatFileSize(node.size ?? 0) }}</small>
              <small v-else>文件夹</small>
              <small>{{ node.modifyTime ? formatModifyTime(node.modifyTime) : "" }}</small>
            </button>
          </template>
        </div>
      </section>

      <section class="transfer-pane">
        <header class="transfer-pane-header">
          <strong>目标</strong>
          <select v-model="targetPane.serverId" title="目标服务器">
            <option value="">请选择连接</option>
            <option
              v-for="server in servers"
              :key="server.id"
              :value="server.id">
              {{ server.name }}
            </option>
          </select>
        </header>
        <p class="transfer-path" :title="transferTargetPath">
          {{ transferTargetPath || getServerLabel(targetPane.serverId) }}
        </p>
        <div class="transfer-file-list">
          <div v-if="targetPane.loading" class="transfer-state">加载中...</div>
          <div v-else-if="targetPane.error" class="transfer-state error">
            {{ targetPane.error }}
          </div>
          <div
            v-else-if="getVisibleNodes(targetPane).length === 0"
            class="transfer-state">
            当前目录为空
          </div>
          <template v-else>
            <button
              v-for="node in getVisibleNodes(targetPane)"
              :key="node.path"
              type="button"
              :class="[
                'transfer-file-row',
                {
                  selected: targetPane.selectedPaths.has(node.path),
                  disabled: node.type !== 'directory',
                },
              ]"
              :title="node.path"
              @click="selectTargetNode($event, node)"
              @dblclick="openNodeByDoubleClick(targetPane, node)">
              <img :src="node.type === 'directory' ? folderIcon : fileIcon" alt="" />
              <span>{{ node.name }}</span>
              <small v-if="node.type === 'file'">{{ formatFileSize(node.size ?? 0) }}</small>
              <small v-else>文件夹</small>
              <small>{{ node.modifyTime ? formatModifyTime(node.modifyTime) : "" }}</small>
            </button>
          </template>
        </div>
      </section>
    </div>

    <footer class="data-transfer-footer">
      <span>
        已选 {{ selectedSourceNodes.length }} 项，目标 {{ getRootName(transferTargetPath || "/") }}
      </span>
      <button
        type="button"
        class="primary-button"
        :disabled="!canTransfer"
        @click="submitTransfer">
        传输
      </button>
    </footer>
  </AppDialog>
</template>
