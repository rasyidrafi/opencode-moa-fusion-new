import type { Plugin } from "@opencode-ai/plugin";
import { moaFusionTool } from "./tool.js";

const MoaFusionPlugin: Plugin = async (input, options) => {
  const reasoningEffortBySession = new Map<string, string>();
  const workerActivityBySession = new Map<string, () => void>();

  return {
    event: async ({ event }) => {
      const value = event as unknown as {
        type?: unknown;
        properties?: unknown;
      };
      const type = typeof value.type === "string" ? value.type : "";
      if (!STREAM_ACTIVITY_EVENTS.has(type)) return;
      const properties = value.properties;
      if (!properties || typeof properties !== "object") return;
      const sessionID = (properties as { sessionID?: unknown }).sessionID;
      if (typeof sessionID === "string") workerActivityBySession.get(sessionID)?.();
    },
    "chat.params": async ({ sessionID }, output) => {
      const reasoningEffort = reasoningEffortBySession.get(sessionID);
      if (reasoningEffort) output.options.reasoningEffort = reasoningEffort;
    },
    tool: {
      moa_fusion: moaFusionTool(input.client, options, {
        onWorkerSessionStart(sessionID, worker, touchActivity) {
          workerActivityBySession.set(sessionID, touchActivity);
          if (worker.reasoningEffort) reasoningEffortBySession.set(sessionID, worker.reasoningEffort);
        },
        onWorkerSessionEnd(sessionID) {
          workerActivityBySession.delete(sessionID);
          reasoningEffortBySession.delete(sessionID);
        },
      }),
    },
  };
};

const STREAM_ACTIVITY_EVENTS = new Set([
  "message.part.delta",
  "message.part.updated",
  "session.next.compaction.delta",
  "session.next.reasoning.delta",
  "session.next.text.delta",
  "session.next.tool.input.delta",
  "session.next.tool.progress",
  "session.next.tool.called",
  "session.next.tool.success",
  "session.next.tool.failed",
  "session.next.shell.started",
  "session.next.shell.ended",
]);

export { moaFusionTool } from "./tool.js";
export { resolveConfig, ConfigError } from "./config.js";
export { READ_ONLY_WORKER_SYSTEM_PROMPT } from "./prompts.js";
export default MoaFusionPlugin;
