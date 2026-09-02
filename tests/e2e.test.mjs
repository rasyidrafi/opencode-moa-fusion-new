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
          return {
            data: {
              parts: [
                {
                  type: "text",
                  text: `model fake/${model}; ${focusText};\n---summary---\nIndependent result.\n\n---position---\nPrefer the evidence-backed option.\n\n---evidence---\nThe fake worker observed the request.\n\n---risks---\nThe result needs validation.\n\n---recommendation---\nRun the next verification step.\n\n---confidence---\n80/100 because the evidence is limited.\n\n---end---`,
                },
              ],
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
        { id: "second", model: "fake/beta" },
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
  assert.match(result.output, /Worker A/);
  assert.match(result.output, /Worker B/);
  assert.match(result.output, /Worker C/);
  assert.match(result.output, /---summary---/);
  assert.match(result.output, /---position---/);
  assert.match(result.output, /---evidence---/);
  assert.match(result.output, /---risks---/);
  assert.match(result.output, /---recommendation---/);
  assert.match(result.output, /---confidence---/);
  assert.match(result.output, /---end---/);
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
  for (const item of created) {
    assert.equal(item.request.query.directory, DIRECTORY);
    assert.match(item.request.body.title, /^moa:Worker [A-Z]+$/);
    assert.doesNotMatch(item.request.body.title, /alpha|beta|broken/);
  }
  for (const request of prompts) {
    assert.equal(request.query.directory, DIRECTORY);
    assert.equal(request.body.tools.bash, false);
    assert.equal(request.body.tools.write, false);
    assert.equal(request.body.tools.edit, false);
    assert.equal(request.body.tools.moa_fusion, false);
    assert.match(request.body.system, /Return text using exactly this format|Do not use JSON/i);
    assert.match(request.body.parts[0].text, /<user_prompt>/);
  }

  assert.ok(result.metadata.sessions.length >= 2, "successful sessions should remain available for debug");
  assert.equal(contextMetadata[0].metadata.workerCount, 3);
});
