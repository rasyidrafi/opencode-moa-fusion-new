import type { Plugin } from "@opencode-ai/plugin";
import { moaFusionTool } from "./tool.js";

const MoaFusionPlugin: Plugin = async (input, options) => {
  const reasoningEffortBySession = new Map<string, string>();

  return {
    "chat.params": async ({ sessionID }, output) => {
      const reasoningEffort = reasoningEffortBySession.get(sessionID);
      if (reasoningEffort) output.options.reasoningEffort = reasoningEffort;
    },
    tool: {
      moa_fusion: moaFusionTool(input.client, options, {
        onWorkerSessionStart(sessionID, worker) {
          if (worker.reasoningEffort) reasoningEffortBySession.set(sessionID, worker.reasoningEffort);
        },
        onWorkerSessionEnd(sessionID) {
          reasoningEffortBySession.delete(sessionID);
        },
      }),
    },
  };
};

export { moaFusionTool } from "./tool.js";
export { resolveConfig, ConfigError } from "./config.js";
export { READ_ONLY_WORKER_SYSTEM_PROMPT } from "./prompts.js";
export default MoaFusionPlugin;
