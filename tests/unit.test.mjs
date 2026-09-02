import assert from "node:assert/strict";
import { test } from "node:test";

import { ConfigError, READ_ONLY_WORKER_SYSTEM_PROMPT, resolveConfig } from "../dist/index.js";

test("configuration uses workers as the source of worker count", () => {
  const config = resolveConfig({
    workers: [
      { model: "fake/a" },
      { model: "fake/b", focus: "skeptical" },
    ],
  });

  assert.equal(config.workers.length, 2);
  assert.equal(config.timeoutMs, 300_000);
  assert.equal(config.maxWorkers, 8);
  assert.equal(config.workers[1].focus, "skeptical");
});

test("configuration rejects a worker set above the safety cap", () => {
  const workers = Array.from({ length: 3 }, (_, index) => ({ model: `fake/model-${index}` }));
  assert.throws(() => resolveConfig({ workers, maxWorkers: 2 }), ConfigError);
});

test("worker contract is text markers, not JSON", () => {
  assert.match(READ_ONLY_WORKER_SYSTEM_PROMPT, /---summary---/);
  assert.match(READ_ONLY_WORKER_SYSTEM_PROMPT, /---confidence---/);
  assert.match(READ_ONLY_WORKER_SYSTEM_PROMPT, /request for JSON|text contract/i);
});
