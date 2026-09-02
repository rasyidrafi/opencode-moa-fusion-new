import type { OpencodeClient } from "@opencode-ai/sdk";
import { buildWorkerSystemPrompt, buildWorkerUserPrompt } from "./prompts.js";
import { redactIdentity, sanitizeErrorMessage } from "./sanitize.js";
import type { BoundWorker, WorkerCallResult } from "./types.js";

const READ_ONLY_TOOLS: Record<string, boolean> = {
  read: true,
  glob: true,
  grep: true,
  bash: false,
  write: false,
  edit: false,
  webfetch: false,
  patch: false,
  todowrite: false,
  moa_fusion: false,
};

export type CallWorkerOptions = {
  client: OpencodeClient;
  parentID: string;
  directory: string;
  prompt: string;
  worker: BoundWorker;
  timeoutMs: number;
  abort: AbortSignal;
  onWorkerSessionStart?: (sessionID: string, worker: BoundWorker) => void;
  onWorkerSessionEnd?: (sessionID: string) => void;
};

export async function callWorker(options: CallWorkerOptions): Promise<WorkerCallResult> {
  const startedAt = Date.now();
  const { worker } = options;
  const identity = [worker.model, modelID(worker.model), worker.id, worker.focus];

  if (options.abort.aborted) {
    return failure(worker, "aborted", startedAt);
  }

  let sessionID: string | undefined;
  try {
    const sessionResponse = await options.client.session.create({
      query: { directory: options.directory },
      body: {
        parentID: options.parentID,
        title: `moa:${worker.alias}`,
      },
    });

    sessionID = sessionResponse.data?.id;
    if (!sessionID) {
      return failure(worker, "failed to create worker session", startedAt);
    }
    options.onWorkerSessionStart?.(sessionID, worker);

    const controller = new AbortController();
    let timedOut = false;
    const onOuterAbort = () => controller.abort(new Error("aborted"));
    options.abort.addEventListener("abort", onOuterAbort, { once: true });
    if (options.abort.aborted) onOuterAbort();
    const timeout = setTimeout(() => {
      timedOut = true;
      controller.abort(new Error("timeout"));
    }, options.timeoutMs);

    let promptResponse: Awaited<ReturnType<OpencodeClient["session"]["prompt"]>> | undefined;
    let promptError: unknown;
    try {
      promptResponse = await options.client.session.prompt({
        path: { id: sessionID },
        query: { directory: options.directory },
        body: {
          model: parseModelRef(worker.model),
          agent: "general",
          system: buildWorkerSystemPrompt(worker.focus),
          parts: [{ type: "text", text: buildWorkerUserPrompt(options.prompt) }],
          tools: READ_ONLY_TOOLS,
        },
        signal: controller.signal,
      });
    } catch (error) {
      promptError = error;
    } finally {
      clearTimeout(timeout);
      options.abort.removeEventListener("abort", onOuterAbort);
      options.onWorkerSessionEnd?.(sessionID);
    }

    if (controller.signal.aborted) {
      return failure(worker, timedOut ? "timeout" : "aborted", startedAt, sessionID);
    }
    if (promptError) {
      return failure(worker, sanitizeErrorMessage(promptError, identity), startedAt, sessionID);
    }
    if (promptResponse && "error" in promptResponse && promptResponse.error) {
      return failure(worker, sanitizeErrorMessage(promptResponse.error, identity), startedAt, sessionID);
    }

    const output = partsToText(promptResponse?.data?.parts ?? []);
    if (!output.trim()) {
      return failure(worker, "empty worker response", startedAt, sessionID);
    }

    return {
      alias: worker.alias,
      model: worker.model,
      focus: worker.focus,
      ok: true,
      output: redactIdentity(output, identity),
      sessionID,
      elapsedMs: Date.now() - startedAt,
    };
  } catch (error) {
    return failure(worker, sanitizeErrorMessage(error, identity), startedAt, sessionID);
  }
}

function failure(
  worker: BoundWorker,
  error: string,
  startedAt: number,
  sessionID?: string,
): WorkerCallResult {
  return {
    alias: worker.alias,
    model: worker.model,
    focus: worker.focus,
    ok: false,
    error,
    sessionID,
    elapsedMs: Date.now() - startedAt,
  };
}

function parseModelRef(value: string): { providerID: string; modelID: string } {
  const slash = value.indexOf("/");
  return { providerID: value.slice(0, slash), modelID: value.slice(slash + 1) };
}

function modelID(value: string): string {
  const slash = value.indexOf("/");
  return slash === -1 ? value : value.slice(slash + 1);
}

function partsToText(parts: unknown[]): string {
  return parts
    .filter(
      (part): part is { type: "text"; text: string } =>
        isRecord(part) && part.type === "text" && typeof part.text === "string",
    )
    .map((part) => part.text)
    .join("");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
