import assert from "node:assert/strict";
import { test } from "node:test";

import plugin from "../dist/index.js";

const DIRECTORY = "/tmp/moa-e2e-project";

test("moa_fusion fans out anonymously, preserves structure, and tolerates partial failure", async () => {
  let active = 0;
  let maxActive = 0;
  let nextSession = 1;
  const created = [];
  const prompts = [];
  const chatParams = [];
  let hooks;

  const client = {
    config: {
      async providers() {
        return {
          data: {
            providers: [
              {
                id: "fake",
                models: { alpha: {}, beta: {}, gamma: {}, broken: {} },
              },
            ],
          },
        };
      },
    },
    session: {
      async create(request) {
        const id = `session-${nextSession++}`;
        created.push({ id, request });
        return { data: { id } };
      },
      async prompt(request) {
        prompts.push(request);
        const params = { options: {} };
        await hooks?.["chat.params"]?.({ sessionID: request.path.id }, params);
        chatParams.push({ sessionID: request.path.id, ...params });
        active += 1;
        maxActive = Math.max(maxActive, active);
        try {
          await new Promise((resolve) => setTimeout(resolve, 40));
          const model = request.body.model.modelID;
          if (model === "broken") {
            return { error: { data: { message: "provider fake/broken failed" } } };
          }
          const focusText = request.body.system.includes("secret lens") ? "focus secret lens" : "no configured focus";
          const finalText = `model fake/${model}; ${focusText}.\n\n### Position\nPrefer the evidence-backed option.\n\n### Evidence\nThe fake worker observed the request.\n\n### Risks\nThe result needs validation.\n\n### Recommendation\nRun the next verification step.\n\n### Confidence\n80/100 because the evidence is limited.`;
          return {
            data: {
              parts: model === "alpha"
                ? [{ type: "text", text: "intermediate worker progress that must not be returned" }, { type: "text", text: finalText }]
                : [{ type: "text", text: finalText }],
            },
          };
        } finally {
          active -= 1;
        }
      },
    },
  };

  hooks = await plugin(
    {
      client,
      project: {},
      directory: DIRECTORY,
      worktree: DIRECTORY,
      experimental_workspace: { register() {} },
      serverUrl: new URL("http://127.0.0.1:4096"),
      $: {},
    },
    {
      workers: [
        { id: "first", model: "fake/alpha", focus: "secret lens", reasoningEffort: "xhigh" },
        { id: "second", model: "fake/beta", variant: "high" },
        { id: "third", model: "fake/broken" },
      ],
      timeoutMs: 2_000,
      debug: true,
    },
  );

  assert.deepEqual(Object.keys(hooks.tool), ["moa_fusion"]);

  const contextMetadata = [];
  const result = await hooks.tool.moa_fusion.execute(
    { prompt: "Evaluate this architecture" },
    {
      sessionID: "parent-session",
      messageID: "message-1",
      agent: "general",
      directory: DIRECTORY,
      worktree: DIRECTORY,
      abort: new AbortController().signal,
      metadata(value) {
        contextMetadata.push(value);
      },
      async ask() {},
    },
  );

  assert.equal(maxActive, 3, "all workers should run concurrently");
  assert.equal(result.metadata.partial, true);
  assert.equal(result.metadata.successfulWorkers, 2);
  assert.doesNotMatch(result.output, /<task_result>|<\/task_result>/);
  assert.match(result.output, /Worker A/);
  assert.match(result.output, /Worker B/);
  assert.match(result.output, /Worker C/);
  assert.match(result.output, /CONCRETE OPINION/);
  assert.match(result.output, /### Position/);
  assert.match(result.output, /### Evidence/);
  assert.match(result.output, /### Risks/);
  assert.match(result.output, /### Recommendation/);
  assert.match(result.output, /### Confidence/);
  assert.doesNotMatch(result.output, /intermediate worker progress|MOA_FUSION_RESULT|<worker_output|---summary---/);
  assert.doesNotMatch(result.output, /fake\/(alpha|beta|broken)/);
  assert.doesNotMatch(result.output, /secret lens/);
  assert.doesNotMatch(result.output, /first|second|third/);

  const publicWorkerMetadata = result.metadata.workers;
  assert.equal(publicWorkerMetadata.length, 3);
  for (const worker of publicWorkerMetadata) {
    assert.ok(worker.alias.startsWith("Worker "));
    assert.equal("model" in worker, false);
    assert.equal("focus" in worker, false);
  }

  assert.equal(created.length, 3);
  assert.equal(prompts.length, 3);
  assert.equal(chatParams.filter((params) => params.options.reasoningEffort === "xhigh").length, 1);
  assert.equal(chatParams.filter((params) => params.options.reasoningEffort === undefined).length, 2);
  assert.equal(prompts.filter((request) => request.body.variant === "high").length, 1);
  assert.equal(prompts.filter((request) => request.body.variant === undefined).length, 2);
  for (const item of created) {
    assert.equal(item.request.query.directory, DIRECTORY);
    assert.match(item.request.body.title, /^moa:Worker [A-Z]+$/);
    assert.doesNotMatch(item.request.body.title, /alpha|beta|broken/);
  }
  for (const request of prompts) {
    assert.equal(request.query.directory, DIRECTORY);
    assert.equal(request.body.tools.bash, true);
    assert.equal(request.body.tools.write, false);
    assert.equal(request.body.tools.edit, false);
    assert.equal(request.body.tools.moa_fusion, false);
    assert.match(request.body.system, /concrete opinion|natural Markdown|Do not use JSON/i);
    assert.match(request.body.parts[0].text, /<user_prompt>/);
  }

  assert.ok(result.metadata.sessions.length >= 2, "successful sessions should remain available for debug");
  assert.equal(contextMetadata[0].metadata.workerCount, 3);
});

test("aborting moa_fusion aborts all in-flight worker sessions", async () => {
  let nextSession = 1;
  let started = 0;
  let resolveAllStarted;
  const allStarted = new Promise((resolve) => {
    resolveAllStarted = resolve;
  });
  const aborted = [];

  const client = {
    config: {
      async providers() {
        return { data: { providers: [{ id: "fake", models: { alpha: {}, beta: {}, gamma: {} } }] } };
      },
    },
    session: {
      async create() {
        return { data: { id: `session-${nextSession++}` } };
      },
      async prompt(request) {
        started += 1;
        if (started === 3) resolveAllStarted();
        await new Promise((resolve, reject) => {
          const onAbort = () => reject(new Error("prompt aborted"));
          if (request.signal.aborted) {
            onAbort();
            return;
          }
          request.signal.addEventListener("abort", onAbort, { once: true });
        });
      },
      async abort(request) {
        aborted.push(request);
        return { data: true };
      },
    },
  };

  const hooks = await plugin(
    {
      client,
      project: {},
      directory: DIRECTORY,
      worktree: DIRECTORY,
      experimental_workspace: { register() {} },
      serverUrl: new URL("http://127.0.0.1:4096"),
      $: {},
    },
    {
      workers: ["fake/alpha", "fake/beta", "fake/gamma"],
      timeoutMs: 10_000,
    },
  );

  const controller = new AbortController();
  const resultPromise = hooks.tool.moa_fusion.execute(
    { prompt: "Evaluate this architecture" },
    {
      sessionID: "parent-session",
      messageID: "message-1",
      agent: "general",
      directory: DIRECTORY,
      worktree: DIRECTORY,
      abort: controller.signal,
      metadata() {},
      async ask() {},
    },
  );

  await allStarted;
  controller.abort();
  const result = await resultPromise;

  assert.equal(aborted.length, 3);
  assert.deepEqual(
    aborted.map((request) => request.path.id).sort(),
    ["session-1", "session-2", "session-3"],
  );
  assert.equal(result.metadata.partial, true);
  assert.equal(result.metadata.successfulWorkers, 0);
});

test("worker timeout debounces while the worker stream is active", async () => {
  let nextSession = 1;
  let hooks;

  const client = {
    config: {
      async providers() {
        return { data: { providers: [{ id: "fake", models: { alpha: {}, beta: {} } }] } };
      },
    },
    session: {
      async create() {
        return { data: { id: `session-${nextSession++}` } };
      },
      async prompt(request) {
        for (let index = 0; index < 3; index += 1) {
          await new Promise((resolve, reject) => {
            const timer = setTimeout(resolve, 70);
            const onAbort = () => {
              clearTimeout(timer);
              reject(new Error("prompt aborted"));
            };
            if (request.signal.aborted) onAbort();
            else request.signal.addEventListener("abort", onAbort, { once: true });
          });
          await hooks.event({
            event: {
              type: "session.next.reasoning.delta",
              properties: { sessionID: request.path.id },
            },
          });
        }
        return {
          data: {
            parts: [{ type: "text", text: "### Position\nThe stream stayed active." }],
          },
        };
      },
      async abort() {
        return { data: true };
      },
    },
  };

  hooks = await plugin(
    {
      client,
      project: {},
      directory: DIRECTORY,
      worktree: DIRECTORY,
      experimental_workspace: { register() {} },
      serverUrl: new URL("http://127.0.0.1:4096"),
      $: {},
    },
    {
      workers: ["fake/alpha", "fake/beta"],
      timeoutMs: 120,
    },
  );

  const result = await hooks.tool.moa_fusion.execute(
    { prompt: "Wait for the active stream" },
    {
      sessionID: "parent-session",
      messageID: "message-1",
      agent: "general",
      directory: DIRECTORY,
      worktree: DIRECTORY,
      abort: new AbortController().signal,
      metadata() {},
      async ask() {},
    },
  );

  assert.equal(result.metadata.partial, false);
  assert.equal(result.metadata.successfulWorkers, 2);
});
