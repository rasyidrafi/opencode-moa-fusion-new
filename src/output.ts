import { SYNTHESIS_HINT } from "./prompts.js";
import type { WorkerCallResult } from "./types.js";

export function formatFusionOutput(results: WorkerCallResult[]): string {
  const blocks = ["◆ OPINIONS — ALL CONFIGURED AGENTS", "", SYNTHESIS_HINT, ""];

  for (const result of results) {
    if (result.ok) {
      blocks.push(`## [${result.alias}] — CONCRETE OPINION`, result.output ?? "");
    } else {
      blocks.push(`## [${result.alias}] — OPINION UNAVAILABLE`, "No opinion was returned by this worker.");
    }
    blocks.push("");
  }

  return wrapTaskResult(blocks.join("\n").trimEnd());
}

export function formatConfigurationError(message: string): string {
  return wrapTaskResult([
    "◆ OPINIONS — UNAVAILABLE",
    "",
    "The configured worker set could not run.",
    message,
    "No worker model identities are included in this error.",
  ].join("\n"));
}

function wrapTaskResult(output: string): string {
  const safeOutput = output.replace(/<\/?task_result>/gi, (tag) => tag.replace("<", "&lt;").replace(">", "&gt;"));
  return `<task_result>\n${safeOutput}\n</task_result>`;
}
