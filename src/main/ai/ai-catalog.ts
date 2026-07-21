import type {
  AiCatalogModel,
  AiCatalogProvider,
  AiModelCatalog,
  AiCatalogReasoningOption,
} from "../../shared/ai-catalog.js";
import type { AiInputModality } from "../../shared/settings.js";

const catalogUrl = "https://models.dev/api.json";
const catalogCacheTtlMs = 30 * 60 * 1000;
const allowedModalities: AiInputModality[] = [
  "text",
  "image",
  "audio",
  "video",
  "pdf",
  "file",
];

let cachedCatalog: AiModelCatalog | null = null;
let cachedAt = 0;

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function asNumber(value: unknown): number | undefined {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : undefined;
}

function normalizeModalities(value: unknown): AiInputModality[] {
  if (!Array.isArray(value)) return ["text"];
  const modalities = value.filter(
    (item): item is AiInputModality =>
      typeof item === "string" && allowedModalities.includes(item as AiInputModality),
  );
  return modalities.length > 0 ? Array.from(new Set(modalities)) : ["text"];
}

function normalizeReasoningOptions(value: unknown): AiCatalogReasoningOption[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap(item => {
    const record = asRecord(item);
    const type = record?.type;
    if (type !== "toggle" && type !== "effort" && type !== "budget_tokens") return [];
    const rawValues = record?.values;
    const values = Array.isArray(rawValues)
      ? rawValues.filter((value): value is string => typeof value === "string")
      : undefined;
    const min = asNumber(record?.min);
    const max = asNumber(record?.max);
    return [{
      type,
      ...(values?.length ? { values } : {}),
      ...(min ? { min } : {}),
      ...(max ? { max } : {}),
    }];
  });
}

function normalizeModel(value: unknown): AiCatalogModel | null {
  const record = asRecord(value);
  if (!record) return null;
  const id = asString(record.id);
  if (!id) return null;
  const limit = asRecord(record.limit);
  const modalities = asRecord(record.modalities);
  return {
    id,
    name: asString(record.name) || id,
    description: asString(record.description) || undefined,
    attachment: record.attachment === true,
    reasoning: record.reasoning === true,
    reasoningOptions: normalizeReasoningOptions(record.reasoning_options),
    modalities: {
      input: normalizeModalities(modalities?.input),
      output: Array.isArray(modalities?.output)
        ? modalities.output.filter((item): item is string => typeof item === "string")
        : ["text"],
    },
    contextWindow: asNumber(limit?.context),
    maxOutputTokens: asNumber(limit?.output),
  };
}

function normalizeProvider(id: string, value: unknown): AiCatalogProvider | null {
  const record = asRecord(value);
  if (!record) return null;
  const modelsRecord = asRecord(record.models);
  const models = modelsRecord
    ? Object.values(modelsRecord)
        .map(normalizeModel)
        .filter((model): model is AiCatalogModel => model !== null)
    : [];
  if (models.length === 0) return null;
  return {
    id,
    name: asString(record.name) || id,
    api: asString(record.api),
    npm: asString(record.npm) || undefined,
    doc: asString(record.doc) || undefined,
    models: models.sort((left, right) => left.name.localeCompare(right.name)),
  };
}

export function normalizeAiModelCatalog(
  value: unknown,
  fetchedAt = Date.now(),
): AiModelCatalog {
  const record = asRecord(value);
  const providers = record
    ? Object.entries(record)
        .map(([id, provider]) => normalizeProvider(id, provider))
        .filter((provider): provider is AiCatalogProvider => provider !== null)
    : [];
  return {
    source: catalogUrl,
    fetchedAt,
    providers: providers.sort((left, right) => left.name.localeCompare(right.name)),
  };
}

export async function getAiModelCatalog(force = false): Promise<AiModelCatalog> {
  if (!force && cachedCatalog && Date.now() - cachedAt < catalogCacheTtlMs) {
    return cachedCatalog;
  }

  const response = await fetch(catalogUrl, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) {
    throw new Error(`模型目录请求失败（HTTP ${response.status}）`);
  }
  const catalog = normalizeAiModelCatalog(await response.json());
  if (catalog.providers.length === 0) {
    throw new Error("模型目录没有可用模型");
  }
  cachedCatalog = catalog;
  cachedAt = Date.now();
  return catalog;
}
