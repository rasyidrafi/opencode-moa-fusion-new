import { tool } from "@opencode-ai/plugin";
import type { OpencodeClient } from "@opencode-ai/sdk";
import { bindAliases } from "./aliases.js";
import { ConfigError, resolveConfig } from "./config.js";
import { validateConfiguredModels } from "./models.js";
import { formatConfigurationError, formatFusionOutput } from "./output.js";
import { callWorker } from "./worker.js";
import type { PluginConfig, WorkerCallResult } from "./types.js";

const ArgsSchema = {
  prompt: tool.schema.string().min(1).describe("The request to analyze independently with configured workers."),
};

export const TOOL_DESCRIPTION =
  "Fan out one prompt to configured anonymous, read-only worker models in parallel and return structured opinions. The calling agent must synthesize the result and decide the next step; this tool never judges, writes files, or executes commands.";

export function moaFusionTool(
  client: OpencodeClient,
  rawOptions: Record<string, unknown> = {},
) {
  let config: PluginConfig | undefined;
  let configError: ConfigError | undefined;
  try {
    config = resolveConfig(rawOptions);
  } catch (error) {
    configError = error instanceof ConfigError ? error : new ConfigError("moa_fusion: invalid plugin configuration");
  }

  return tool({
    description: TOOL_DESCRIPTION,
    args: ArgsSchema,
    async execute(args, context) {
      if (configError || !config) {
        const message = configError?.message ?? "moa_fusion: invalid plugin configuration";
        return {
          output: formatConfigurationError(message),
          metadata: { partial: true, anonymous: true, workerCount: 0 },
        };
      }

      const boundWorkers = bindAliases(config.workers);
      context.metadata({
        title: `moa_fusion: ${boundWorkers.length} anonymous workers`,
        metadata: { workerCount: boundWorkers.length, anonymous: true },
      });

      try {
        await validateConfiguredModels(client, boundWorkers);
      } catch (error) {
        const message = error instanceof Error ? error.message : "moa_fusion: worker model validation failed";
        return {
          output: formatConfigurationError(message),
          metadata: {
            partial: true,
            anonymous: true,
            workerCount: boundWorkers.length,
            workers: boundWorkers.map((worker) => ({ alias: worker.alias, status: "unavailable" })),
          },
        };
      }

      const settled = await Promise.allSettled(
        boundWorkers.map((worker) =>
          callWorker({
            client,
            parentID: context.sessionID,
            directory: context.directory,
            prompt: args.prompt,
            worker,
            timeoutMs: config.timeoutMs,
            abort: context.abort,
          }),
        ),
      );

      const results: WorkerCallResult[] = settled.map((entry, index) => {
        if (entry.status === "fulfilled") return entry.value;
        return {
          alias: boundWorkers[index].alias,
          model: boundWorkers[index].model,
          focus: boundWorkers[index].focus,
          ok: false,
          error: "worker failed unexpectedly",
          elapsedMs: 0,
        };
      });
      results.sort((left, right) => left.alias.localeCompare(right.alias));

      const partial = results.some((result) => !result.ok);
      const metadata: Record<string, unknown> = {
        partial,
        anonymous: true,
        workerCount: results.length,
        successfulWorkers: results.filter((result) => result.ok).length,
        workers: results.map((result) => ({
          alias: result.alias,
          status: result.ok ? "ok" : "failed",
          elapsedMs: result.elapsedMs,
          ...(result.error ? { error: result.error } : {}),
        })),
      };
      if (config.debug) {
        metadata.sessions = results
          .filter((result) => result.sessionID)
          .map((result) => ({ alias: result.alias, sessionID: result.sessionID }));
      }

      return {
        title: `moa_fusion: ${results.length} anonymous workers`,
        output: formatFusionOutput(results),
        metadata,
      };
    },
  });
}
