import type { PluginConfig, WorkerDefinition } from "./types.js";

export const DEFAULT_TIMEOUT_MS = 300_000;
export const DEFAULT_MAX_WORKERS = 8;

const MODEL_REF_RE = /^[^/\s]+\/[^\s]+$/;
const WORKER_ID_RE = /^[A-Za-z0-9_-]{1,32}$/;
const MAX_FOCUS_LENGTH = 2_000;

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

export function resolveConfig(raw: Record<string, unknown>): PluginConfig {
  const rawWorkers = raw.workers;
  if (!Array.isArray(rawWorkers) || rawWorkers.length < 2) {
    throw new ConfigError("moa_fusion: configure at least two workers in plugin options");
  }

  const maxWorkers = positiveInteger(raw.maxWorkers, DEFAULT_MAX_WORKERS, "maxWorkers");
  if (maxWorkers < 2 || maxWorkers > DEFAULT_MAX_WORKERS) {
    throw new ConfigError(`moa_fusion: maxWorkers must be between 2 and ${DEFAULT_MAX_WORKERS}`);
  }
  if (rawWorkers.length > maxWorkers) {
    throw new ConfigError(
      `moa_fusion: configured worker count exceeds the maxWorkers safety limit (${maxWorkers})`,
    );
  }

  const ids = new Set<string>();
  const workers: WorkerDefinition[] = rawWorkers.map((rawWorker, index) => {
    if (typeof rawWorker === "string") {
      return normalizeWorker({ model: rawWorker }, index, ids);
    }
    if (!isRecord(rawWorker)) {
      throw new ConfigError(`moa_fusion: worker ${index + 1} must be an object`);
    }
    return normalizeWorker(rawWorker, index, ids);
  });

  const timeoutMs = positiveInteger(raw.timeoutMs, DEFAULT_TIMEOUT_MS, "timeoutMs");
  if (timeoutMs > 86_400_000) {
    throw new ConfigError("moa_fusion: timeoutMs cannot exceed 24 hours");
  }

  const debug = raw.debug === undefined ? false : raw.debug;
  if (typeof debug !== "boolean") {
    throw new ConfigError("moa_fusion: debug must be a boolean");
  }

  return { workers, timeoutMs, maxWorkers, debug };
}

function normalizeWorker(
  raw: Record<string, unknown>,
  index: number,
  ids: Set<string>,
): WorkerDefinition {
  const id = typeof raw.id === "string" && raw.id.trim() ? raw.id.trim() : `worker-${index + 1}`;
  if (!WORKER_ID_RE.test(id)) {
    throw new ConfigError(`moa_fusion: worker ${index + 1} has an invalid id`);
  }
  if (ids.has(id)) {
    throw new ConfigError("moa_fusion: worker ids must be unique");
  }
  ids.add(id);

  const model = typeof raw.model === "string" ? raw.model.trim() : "";
  if (!MODEL_REF_RE.test(model)) {
    throw new ConfigError(`moa_fusion: worker ${index + 1} model must use provider/model format`);
  }

  let focus: string | undefined;
  if (raw.focus !== undefined) {
    if (typeof raw.focus !== "string") {
      throw new ConfigError(`moa_fusion: worker ${index + 1} focus must be a string`);
    }
    focus = raw.focus.trim();
    if (focus.length > MAX_FOCUS_LENGTH) {
      throw new ConfigError(`moa_fusion: worker ${index + 1} focus is too long`);
    }
    if (!focus) focus = undefined;
  }

  return { id, model, focus };
}

function positiveInteger(value: unknown, fallback: number, name: string): number {
  if (value === undefined) return fallback;
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    throw new ConfigError(`moa_fusion: ${name} must be a positive integer`);
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
