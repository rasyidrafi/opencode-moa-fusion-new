import { SYNTHESIS_HINT } from "./prompts.js";
import type { WorkerCallResult } from "./types.js";

export function formatFusionOutput(results: WorkerCallResult[]): string {
  const blocks = ["MOA_FUSION_RESULT", "", SYNTHESIS_HINT, ""];

  for (const result of results) {
    const status = result.ok ? "ok" : `failed: ${result.error ?? "unknown error"}`;
    blocks.push(`## ${result.alias} · ${result.elapsedMs}ms · ${status}`);

    if (result.ok) {
      blocks.push(
        `<worker_output alias="${result.alias}">`,
        result.output ?? "",
        "</worker_output>",
      );
    } else {
      blocks.push("No opinion was returned by this worker.");
    }
    blocks.push("");
  }

  return blocks.join("\n").trimEnd();
}

export function formatConfigurationError(message: string): string {
  return [
    "MOA_FUSION_RESULT",
    "",
    "The configured worker set could not run.",
    message,
    "No worker model identities are included in this error.",
  ].join("\n");
}
