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
  timeoutMs: number | false;
  abort: AbortSignal;
  onWorkerSessionStart?: (sessionID: string, worker: BoundWorker, touchActivity: () => void) => void;
  onWorkerSessionEnd?: (sessionID: string) => void;
};

type PromptBody = NonNullable<Parameters<OpencodeClient["session"]["prompt"]>[0]["body"]> & {
  variant?: string;
};

export type WorkerActivity = {
  touch: () => void;
  stop: () => void;
};

export function createWorkerActivity(timeoutMs: number | false, onTimeout: () => void): WorkerActivity {
  if (timeoutMs === false) {
    return { touch() {}, stop() {} };
  }

  let timer: ReturnType<typeof setTimeout> | undefined;
  let lastActivityAt = performance.now();
  let stopped = false;
  let fired = false;

  const schedule = () => {
    if (stopped || fired) return;
    if (timer) clearTimeout(timer);
    const remaining = timeoutMs - (performance.now() - lastActivityAt);
    timer = setTimeout(() => {
      timer = undefined;
      if (stopped || fired) return;
      if (performance.now() - lastActivityAt >= timeoutMs) {
        fired = true;
        onTimeout();
      } else {
        schedule();
      }
    }, Math.min(Math.max(1, remaining), 2_147_483_647));
    timer.unref?.();
  };

  schedule();
  return {
    touch() {
      if (stopped || fired) return;
      lastActivityAt = performance.now();
      schedule();
    },
    stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
      timer = undefined;
    },
  };
}

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
    const workerSessionID = sessionID;

    const controller = new AbortController();
    let timedOut = false;
    let sessionAbortRequest: Promise<unknown> | undefined;
    const abortWorkerSession = () => {
      if (sessionAbortRequest) return;
      sessionAbortRequest = Promise.resolve()
        .then(() =>
          options.client.session.abort({
            path: { id: workerSessionID },
            query: { directory: options.directory },
          }),
        )
        .catch(() => undefined);
    };
    const abortWorker = (reason: "aborted" | "timeout") => {
      if (reason === "timeout") timedOut = true;
      abortWorkerSession();
      controller.abort(new Error(reason));
    };
    const activity = createWorkerActivity(options.timeoutMs, () => abortWorker("timeout"));
    options.onWorkerSessionStart?.(workerSessionID, worker, activity.touch);
    const onOuterAbort = () => abortWorker("aborted");
    options.abort.addEventListener("abort", onOuterAbort, { once: true });
    if (options.abort.aborted) onOuterAbort();

    let promptResponse: Awaited<ReturnType<OpencodeClient["session"]["prompt"]>> | undefined;
    let promptError: unknown;
    try {
      const body = {
        model: parseModelRef(worker.model),
        agent: "general",
        ...(worker.variant ? { variant: worker.variant } : {}),
        system: buildWorkerSystemPrompt(worker.focus),
        parts: [{ type: "text" as const, text: buildWorkerUserPrompt(options.prompt) }],
        tools: READ_ONLY_TOOLS,
      } as PromptBody;

      promptResponse = await options.client.session.prompt({
        path: { id: workerSessionID },
        query: { directory: options.directory },
        body,
        signal: controller.signal,
      });
    } catch (error) {
      promptError = error;
    } finally {
      activity.stop();
      options.abort.removeEventListener("abort", onOuterAbort);
      await sessionAbortRequest;
      options.onWorkerSessionEnd?.(workerSessionID);
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
