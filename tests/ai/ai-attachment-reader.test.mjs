import assert from "node:assert/strict";
import test from "node:test";

import {
  readAiAttachmentChunk,
} from "../../dist-electron/main/ai/ai-attachment-reader.js";

function createAttachment(content, overrides = {}) {
  const buffer = Buffer.from(content, "utf8");
  return {
    id: "attachment-log",
    name: "server.log",
    mimeType: "text/plain",
    size: buffer.length,
    dataUrl: `data:text/plain;base64,${buffer.toString("base64")}`,
    delivery: "chunked",
    ...overrides,
  };
}

test("按字节偏移读取附件并返回下一偏移和 EOF", () => {
  const attachment = createAttachment("alpha\nbeta\ngamma\n");
  const first = readAiAttachmentChunk([attachment], {
    attachmentId: attachment.id,
    offset: 0,
    maxBytes: 6,
  });
  assert.equal(first.content, "alpha\n");
  assert.equal(first.offset, 0);
  assert.equal(first.nextOffset, 6);
  assert.equal(first.eof, false);

  const second = readAiAttachmentChunk([attachment], {
    attachmentId: attachment.id,
    offset: first.nextOffset,
    maxBytes: 32_768,
  });
  assert.equal(second.content, "beta\ngamma\n");
  assert.equal(second.eof, true);
  assert.equal(second.nextOffset, second.totalBytes);
});

test("分段读取不会从 UTF-8 延续字节开始或在字符中间结束", () => {
  const attachment = createAttachment("甲乙丙丁");
  const first = readAiAttachmentChunk([attachment], {
    attachmentId: attachment.id,
    offset: 0,
    maxBytes: 4,
  });
  assert.equal(first.content, "甲");
  assert.equal(first.nextOffset, 3);

  const adjusted = readAiAttachmentChunk([attachment], {
    attachmentId: attachment.id,
    offset: 1,
    maxBytes: 6,
  });
  assert.equal(adjusted.offset, 3);
  assert.equal(adjusted.content, "乙丙");
});

test("单次读取最多返回 32 KB", () => {
  const attachment = createAttachment("x".repeat(40_000));
  const result = readAiAttachmentChunk([attachment], {
    attachmentId: attachment.id,
    offset: 0,
    maxBytes: 100_000,
  });
  assert.equal(Buffer.byteLength(result.content, "utf8"), 32 * 1024);
  assert.equal(result.nextOffset, 32 * 1024);
  assert.equal(result.eof, false);
});

test("拒绝不存在的附件和非分段附件", () => {
  const attachment = createAttachment("text");
  assert.throws(
    () => readAiAttachmentChunk([attachment], {
      attachmentId: "missing",
      offset: 0,
      maxBytes: 10,
    }),
    /找不到可分段读取的附件/,
  );
  assert.throws(
    () => readAiAttachmentChunk([{ ...attachment, delivery: "inline" }], {
      attachmentId: attachment.id,
      offset: 0,
      maxBytes: 10,
    }),
    /找不到可分段读取的附件/,
  );
});
