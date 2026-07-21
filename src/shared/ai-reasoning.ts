const blockedReasoningPathSegments = new Set([
  "__proto__",
  "prototype",
  "constructor",
]);

const reservedReasoningRootFields = new Set([
  "model",
  "messages",
  "tools",
  "stream",
  "max_tokens",
  "max_output_tokens",
  "input",
  "system",
]);

const disabledReasoningValues = new Set(["none", "off", "disabled", "false"]);

function isDisabledAiReasoningValue(value: string): boolean {
  return disabledReasoningValues.has(value.trim().toLowerCase());
}

export function normalizeAiReasoningParameter(value: unknown): string {
  if (typeof value !== "string") return "";
  const parameter = value.trim();
  const segments = parameter.split(".");
  if (
    !parameter ||
    segments.length > 4 ||
    segments.some(segment =>
      !/^[A-Za-z_][A-Za-z0-9_-]*$/.test(segment) ||
      blockedReasoningPathSegments.has(segment),
    ) ||
    reservedReasoningRootFields.has(segments[0])
  ) {
    return "";
  }
  return segments.join(".");
}

export function normalizeAiReasoningValues(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(
    value
      .filter((item): item is string => typeof item === "string")
      .map(item => item.trim())
      .filter(item => Boolean(item) && !isDisabledAiReasoningValue(item))
      .map(item => item.slice(0, 64)),
  )).slice(0, 24);
}

export function normalizeAiReasoningEffort(
  value: unknown,
  fallback = "medium",
): string {
  if (typeof value !== "string") return fallback;
  const normalized = value.trim().slice(0, 64);
  return normalized && !isDisabledAiReasoningValue(normalized)
    ? normalized
    : fallback;
}

export function setAiReasoningRequestValue(
  target: Record<string, unknown>,
  parameter: string,
  value: string,
): boolean {
  const normalizedParameter = normalizeAiReasoningParameter(parameter);
  const normalizedValue = value.trim();
  if (!normalizedParameter || !normalizedValue) return false;

  const segments = normalizedParameter.split(".");
  let cursor = target;
  for (const segment of segments.slice(0, -1)) {
    const existing = cursor[segment];
    if (existing && typeof existing === "object" && !Array.isArray(existing)) {
      cursor = existing as Record<string, unknown>;
      continue;
    }
    const nested: Record<string, unknown> = {};
    cursor[segment] = nested;
    cursor = nested;
  }
  const leaf = segments.at(-1) as string;
  cursor[leaf] = /(?:^|_)budget_tokens$/.test(leaf) && /^\d+$/.test(normalizedValue)
    ? Number(normalizedValue)
    : normalizedValue;
  return true;
}
