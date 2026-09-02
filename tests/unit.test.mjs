import assert from "node:assert/strict";
import { test } from "node:test";

import { READ_ONLY_WORKER_SYSTEM_PROMPT, resolveConfig } from "../dist/index.js";

test("configuration uses workers as the source of worker count", () => {
  const config = resolveConfig({
    workers: [
      { model: "fake/a" },
      { model: "fake/b", focus: "skeptical", variant: "high" },
    ],
  });

  assert.equal(config.workers.length, 2);
  assert.equal(config.timeoutMs, 3_600_000);
  assert.equal(config.workers[1].focus, "skeptical");
  assert.equal(config.workers[1].variant, "high");
});

test("configuration uses the workers array length without a separate worker cap", () => {
  const workers = Array.from({ length: 9 }, (_, index) => ({ model: `fake/model-${index}` }));
  const config = resolveConfig({ workers });

  assert.equal(config.workers.length, workers.length);
});

test("configuration can delegate timeout handling to the worker provider", () => {
  const config = resolveConfig({
    workers: ["fake/a", "fake/b"],
    timeoutMs: false,
  });

  assert.equal(config.timeoutMs, false);
});

test("worker contract is a natural Markdown opinion, not a rigid template", () => {
  assert.match(READ_ONLY_WORKER_SYSTEM_PROMPT, /concrete opinion/i);
  assert.match(READ_ONLY_WORKER_SYSTEM_PROMPT, /natural Markdown/i);
  assert.match(READ_ONLY_WORKER_SYSTEM_PROMPT, /JSON/i);
  assert.doesNotMatch(READ_ONLY_WORKER_SYSTEM_PROMPT, /---summary---/);
});
