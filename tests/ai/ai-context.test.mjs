import assert from "node:assert/strict";
import test from "node:test";

import {
  buildAiMessages,
  redactSensitiveTerminalText,
} from "../../dist-electron/main/ai/ai-context.js";

const input = {
  tabId: "tab-1",
  mode: "full",
  message: "检查服务",
  context: { tabId: "tab-1", serverName: "demo" },
  history: [],
};

test("终端敏感信息会被脱敏", () => {
  const source = [
    "Authorization: Bearer secret-token",
    "password=hunter2",
    "https://user:pass@example.com/path",
    "-----BEGIN OPENSSH PRIVATE KEY-----\nsecret\n-----END OPENSSH PRIVATE KEY-----",
  ].join("\n");
  const redacted = redactSensitiveTerminalText(source);
  assert.doesNotMatch(redacted, /secret-token|hunter2|user:pass|PRIVATE KEY-----\nsecret/);
  assert.match(redacted, /已脱敏/);
});

test("默认空终端上下文不会生成最近终端输出块", () => {
  const messages = buildAiMessages(input, [], "");
  assert.equal(messages.some(message => message.content.includes("不可信最近终端输出")), false);
});

test("本地策略拦截会以结构化反馈发送给模型", () => {
  const feedback = {
    type: "local_command_policy_rejection",
    retryCount: 1,
    maxRetries: 3,
    command: "nginx -v 2>&1; echo \\",
    decision: "deny",
    reason: "命令以未完成的转义符结尾",
  };
  const messages = buildAiMessages(input, [], "", feedback);
  const systemMessage = messages[0].content;
  const contextMessage = messages.at(-2).content;

  assert.match(systemMessage, /本地策略概要/);
  assert.match(contextMessage, /本地命令策略反馈/);
  assert.match(contextMessage, /"retryCount":1/);
  assert.match(contextMessage, /未完成的转义符/);
});

test("命令结果与终端输出受总量限制", () => {
  const result = { stdout: "x".repeat(10_000), stderr: "", exitCode: 0, timedOut: false, durationMs: 1 };
  const executed = Array.from({ length: 10 }, (_, index) => ({
    command: `check-${index}`,
    reason: "检查",
    risk: "low",
    result,
  }));
  const messages = buildAiMessages(input, executed, "y".repeat(10_000));
  const contextMessage = messages.at(-2).content;
  assert.ok(contextMessage.length < 30_000);
  assert.match(contextMessage, /已截断/);
});

test("图片、视频、音频和普通文件会生成对应的多模态内容段", () => {
  const messages = buildAiMessages({
    ...input,
    attachments: [
      { name: "a.png", mimeType: "image/png", size: 1, dataUrl: "data:image/png;base64,YQ==" },
      { name: "b.mp4", mimeType: "video/mp4", size: 1, dataUrl: "data:video/mp4;base64,Yg==" },
      { name: "c.mp3", mimeType: "audio/mpeg", size: 1, dataUrl: "data:audio/mpeg;base64,Yw==" },
      { name: "d.pdf", mimeType: "application/pdf", size: 1, dataUrl: "data:application/pdf;base64,ZA==" },
    ],
  }, [], "");
  const content = messages.at(-1).content;

  assert.ok(Array.isArray(content));
  assert.deepEqual(content.map(part => part.type), [
    "text",
    "image_url",
    "video_url",
    "input_audio",
    "file",
  ]);
  assert.deepEqual(content[3].input_audio, { data: "Yw==", format: "mp3" });
  assert.equal(content[4].file.filename, "d.pdf");
});

test("大型文本附件只发送清单并通过不可信上下文接收分段内容", () => {
  const attachment = {
    id: "attachment-log",
    name: "server.log",
    mimeType: "text/plain",
    size: 2 * 1024 * 1024,
    dataUrl: "data:text/plain;base64,YWxwaGE=",
    delivery: "chunked",
  };
  const reads = [{
    attachmentId: attachment.id,
    name: attachment.name,
    offset: 0,
    nextOffset: 5,
    totalBytes: attachment.size,
    content: "alpha",
    eof: false,
  }];
  const messages = buildAiMessages(
    { ...input, attachments: [attachment] },
    [],
    "",
    undefined,
    200_000,
    8_192,
    reads,
  );
  const systemMessage = messages[0].content;
  const contextMessage = messages.at(-2).content;
  const userMessage = messages.at(-1).content;

  assert.equal(typeof userMessage, "string");
  assert.match(userMessage, /attachment-log/);
  assert.match(userMessage, /read_attachment_chunk/);
  assert.doesNotMatch(userMessage, /data:text\/plain/);
  assert.match(systemMessage, /大型文本附件不会整份放入上下文/);
  assert.match(contextMessage, /不可信附件读取结果/);
  assert.match(contextMessage, /"content":"alpha"/);
});

test("上下文大小与最大输出共同限制历史消息预算", () => {
  const history = Array.from({ length: 12 }, (_, index) => ({
    id: String(index),
    role: index % 2 === 0 ? "user" : "assistant",
    content: `history-${index}-` + "x".repeat(1_000),
    createdAt: index,
  }));
  const small = buildAiMessages({ ...input, history }, [], "", undefined, 4_096, 2_048);
  const large = buildAiMessages({ ...input, history }, [], "", undefined, 200_000, 8_192);

  assert.ok(small.length >= 3);
  assert.ok(large.length > small.length);
});

test("模型语义摘要会替代已覆盖历史，同时保留增量消息", () => {
  const history = Array.from({ length: 18 }, (_, index) => ({
    id: String(index),
    role: index % 2 === 0 ? "user" : "assistant",
    content: `${index === 0 ? "早期故障现象" : `历史-${index}`}：` + "x".repeat(1_200),
    createdAt: index,
  }));
  const messages = buildAiMessages({
    ...input,
    history,
    compaction: {
      content: "目标与状态：正在排查 nginx 早期故障。",
      coveredThroughMessageId: "7",
      coveredThroughCreatedAt: 7,
      updatedAt: 20,
    },
  }, [], "", undefined, 200_000, 8_192);
  const historyMessages = messages.slice(1, -2);
  const summary = historyMessages.find(
    message => typeof message.content === "string" && message.content.includes("模型语义摘要"),
  );

  assert.ok(summary);
  assert.match(summary.content, /正在排查 nginx/);
  assert.equal(historyMessages.some(message => message.content.includes("早期故障现象")), false);
  assert.equal(historyMessages.some(message => message.content.includes("历史-7")), false);
  assert.match(historyMessages[1].content, /历史-8/);
  assert.match(historyMessages.at(-1).content, /历史-17/);
});
