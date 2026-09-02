import type { OpencodeClient } from "@opencode-ai/sdk";
import { ConfigError } from "./config.js";
import type { BoundWorker } from "./types.js";

export async function validateConfiguredModels(
  client: OpencodeClient,
  workers: BoundWorker[],
): Promise<void> {
  let providers: Array<{ id: string; models?: Record<string, unknown> }>;
  try {
    const response = await client.config.providers();
    providers = (response.data?.providers ?? []) as Array<{
      id: string;
      models?: Record<string, unknown>;
    }>;
  } catch {
    throw new ConfigError("moa_fusion: unable to inspect configured worker models");
  }

  const knownModels = new Set<string>();
  for (const provider of providers) {
    for (const model of Object.keys(provider.models ?? {})) {
      knownModels.add(`${provider.id}/${model}`);
    }
  }

  const unavailable = workers.filter((worker) => !knownModels.has(worker.model));
  if (unavailable.length > 0) {
    // Deliberately expose aliases, never provider or model names.
    throw new ConfigError(
      `moa_fusion: ${unavailable.map((worker) => worker.alias).join(", ")} unavailable in the current OpenCode configuration`,
    );
  }
}
