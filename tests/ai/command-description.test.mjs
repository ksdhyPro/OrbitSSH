import assert from "node:assert/strict";
import test from "node:test";

import { describeAiCommandForApproval } from "../../dist-electron/main/ai/command-description.js";

const approvalPolicy = {
  decision: "requires_approval",
  reason: "检测到写入重定向或 Docker 服务变更",
};

test("复合危险命令会生成中文用途、主要操作和风险说明", () => {
  const command = [
    "command -v docker-compose",
    "mkdir -p /home/3xui/db /home/3xui/cert",
    "cat > /home/3xui/docker-compose.yml <<'EOF'",
    "services:",
    "  3xui:",
    "    image: ghcr.io/mhsanaei/3x-ui:latest",
    "EOF",
    "docker-compose -f /home/3xui/docker-compose.yml up -d",
    "docker-compose -f /home/3xui/docker-compose.yml ps",
  ].join("\n");

  const description = describeAiCommandForApproval(command, {
    policy: approvalPolicy,
    modelReason: "Planning secure docker-compose setup",
  });

  assert.match(description, /^用途：/);
  assert.match(description, /主要操作：/);
  assert.match(description, /检查 `docker-compose` 是否可用/);
  assert.match(description, /创建目录 `\/home\/3xui\/db`、`\/home\/3xui\/cert`/);
  assert.match(description, /覆盖写入文件 `\/home\/3xui\/docker-compose\.yml`/);
  assert.match(description, /启动或更新 Docker Compose/);
  assert.match(description, /查询 Docker Compose 容器状态/);
  assert.match(description, /风险：/);
  assert.match(description, /本地策略：检测到写入重定向或 Docker 服务变更/);
  assert.doesNotMatch(description, /Planning secure/);
});

test("删除命令会明确提示不可恢复风险", () => {
  const description = describeAiCommandForApproval("rm -rf /srv/legacy", {
    policy: { decision: "requires_approval", reason: "命中高风险命令前缀" },
    modelReason: "清理旧目录",
  });

  assert.match(description, /用途：删除 `\/srv\/legacy`/);
  assert.match(description, /删除操作可能不可恢复/);
  assert.match(description, /AI 说明：清理旧目录/);
});

test("只读命令即使模型返回英文也会显示本地中文说明", () => {
  const description = describeAiCommandForApproval("df -h", {
    policy: { decision: "allow_readonly", reason: "每次询问模式需要批准" },
    modelReason: "Checking disk capacity",
  });

  assert.match(description, /用途：查询服务器文件系统的磁盘使用情况/);
  assert.match(description, /只读查询/);
  assert.doesNotMatch(description, /Checking disk capacity/);
});
