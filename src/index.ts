import type { Plugin } from "@opencode-ai/plugin";
import { moaFusionTool } from "./tool.js";

const MoaFusionPlugin: Plugin = async (input, options) => ({
  tool: {
    moa_fusion: moaFusionTool(input.client, options),
  },
});

export { moaFusionTool } from "./tool.js";
export { resolveConfig, ConfigError } from "./config.js";
export { READ_ONLY_WORKER_SYSTEM_PROMPT } from "./prompts.js";
export default MoaFusionPlugin;
