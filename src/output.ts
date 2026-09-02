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

  return blocks.join("\n").trimEnd();
}

export function formatConfigurationError(message: string): string {
  return [
    "◆ OPINIONS — UNAVAILABLE",
    "",
    "The configured worker set could not run.",
    message,
    "No worker model identities are included in this error.",
  ].join("\n");
}
