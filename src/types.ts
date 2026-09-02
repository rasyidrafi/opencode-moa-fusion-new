export type WorkerDefinition = {
  id: string;
  model: string;
  focus?: string;
  variant?: string;
  reasoningEffort?: string;
};

export type PluginConfig = {
  workers: WorkerDefinition[];
  timeoutMs: number | false;
  debug: boolean;
};

export type BoundWorker = WorkerDefinition & {
  alias: string;
};

export type WorkerCallResult = {
  alias: string;
  model: string;
  focus?: string;
  ok: boolean;
  output?: string;
  error?: string;
  sessionID?: string;
  elapsedMs: number;
};
