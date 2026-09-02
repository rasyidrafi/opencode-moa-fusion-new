import { randomInt } from "node:crypto";
import type { BoundWorker, WorkerDefinition } from "./types.js";

/**
 * Assign anonymous aliases per invocation. The random permutation prevents a
 * stable Worker A → model association across calls. The mapping is kept only
 * in memory and is never rendered in the tool result.
 */
export function bindAliases(workers: WorkerDefinition[]): BoundWorker[] {
  const shuffled = [...workers];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = randomInt(index + 1);
    [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
  }

  return shuffled.map((worker, index) => ({
    ...worker,
    alias: `Worker ${aliasLetter(index)}`,
  }));
}

function aliasLetter(index: number): string {
  let value = index;
  let result = "";
  do {
    result = String.fromCharCode(65 + (value % 26)) + result;
    value = Math.floor(value / 26) - 1;
  } while (value >= 0);
  return result;
}
