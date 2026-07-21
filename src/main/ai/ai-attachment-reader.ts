import {
  AI_ATTACHMENT_CHUNK_MAX_BYTES,
  type AiAttachment,
  type AiAttachmentReadRequest,
  type AiAttachmentReadResult,
} from "../../shared/ai.js";

function decodeAttachmentDataUrl(attachment: AiAttachment): Buffer {
  const separatorIndex = attachment.dataUrl.indexOf(",");
  if (separatorIndex < 0) throw new Error("附件数据格式无效");
  return Buffer.from(attachment.dataUrl.slice(separatorIndex + 1), "base64");
}

function moveToUtf8Boundary(buffer: Buffer, offset: number): number {
  let nextOffset = Math.min(Math.max(0, offset), buffer.length);
  while (
    nextOffset < buffer.length &&
    (buffer[nextOffset]! & 0xc0) === 0x80
  ) {
    nextOffset += 1;
  }
  return nextOffset;
}

function moveEndToUtf8Boundary(
  buffer: Buffer,
  startOffset: number,
  endOffset: number,
): number {
  let nextOffset = Math.min(Math.max(startOffset, endOffset), buffer.length);
  while (
    nextOffset > startOffset &&
    nextOffset < buffer.length &&
    (buffer[nextOffset]! & 0xc0) === 0x80
  ) {
    nextOffset -= 1;
  }
  // 极小的 maxBytes 可能容不下一个 UTF-8 字符；此时完整返回一个字符，
  // 避免 nextOffset 不前进导致模型陷入重复读取。
  return nextOffset > startOffset
    ? nextOffset
    : moveToUtf8Boundary(buffer, endOffset);
}

export function readAiAttachmentChunk(
  attachments: AiAttachment[],
  request: AiAttachmentReadRequest,
  bufferCache = new Map<string, Buffer>(),
): AiAttachmentReadResult {
  const attachment = attachments.find(item => item.id === request.attachmentId);
  if (!attachment || attachment.delivery !== "chunked") {
    throw new Error("找不到可分段读取的附件");
  }

  let buffer = bufferCache.get(request.attachmentId);
  if (!buffer) {
    buffer = decodeAttachmentDataUrl(attachment);
    bufferCache.set(request.attachmentId, buffer);
  }

  const requestedOffset = Number.isFinite(request.offset)
    ? Math.max(0, Math.floor(request.offset))
    : 0;
  const offset = moveToUtf8Boundary(buffer, requestedOffset);
  const requestedBytes = Number.isFinite(request.maxBytes)
    ? Math.floor(request.maxBytes)
    : AI_ATTACHMENT_CHUNK_MAX_BYTES;
  const maxBytes = Math.min(
    AI_ATTACHMENT_CHUNK_MAX_BYTES,
    Math.max(1, requestedBytes),
  );
  const rawEnd = Math.min(buffer.length, offset + maxBytes);
  const nextOffset =
    rawEnd >= buffer.length
      ? buffer.length
      : moveEndToUtf8Boundary(buffer, offset, rawEnd);

  return {
    attachmentId: request.attachmentId,
    name: attachment.name,
    offset,
    nextOffset,
    totalBytes: buffer.length,
    content: buffer.subarray(offset, nextOffset).toString("utf8"),
    eof: nextOffset >= buffer.length,
  };
}
