import assert from "node:assert/strict";
import { test } from "node:test";

import { READ_ONLY_WORKER_SYSTEM_PROMPT, resolveConfig } from "../dist/index.js";

test("configuration uses workers as the source of worker count", () => {
  const config = resolveConfig({
    workers: [
      { model: "fake/a" },
      { model: "fake/b", focus: "skeptical", reasoningEffort: "xhigh" },
    ],
  });

  assert.equal(config.workers.length, 2);
  assert.equal(config.timeoutMs, 300_000);
  assert.equal(config.workers[1].focus, "skeptical");
  assert.equal(config.workers[1].reasoningEffort, "xhigh");
});

test("configuration uses the workers array length without a separate worker cap", () => {
  const workers = Array.from({ length: 9 }, (_, index) => ({ model: `fake/model-${index}` }));
  const config = resolveConfig({ workers });

  assert.equal(config.workers.length, workers.length);
});

test("worker contract is text markers, not JSON", () => {
  assert.match(READ_ONLY_WORKER_SYSTEM_PROMPT, /---summary---/);
  assert.match(READ_ONLY_WORKER_SYSTEM_PROMPT, /---confidence---/);
  assert.match(READ_ONLY_WORKER_SYSTEM_PROMPT, /Return text|Do not use JSON/i);
});
