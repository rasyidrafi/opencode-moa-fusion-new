# opencode-moa-fusion-new

A minimal OpenCode plugin that exposes exactly one tool, `moa_fusion`.

The tool sends one prompt to configured worker models in parallel. Each worker
returns an independent, structured opinion. The tool returns those opinions to
the calling agent. The calling agent remains responsible for synthesis, action,
and the final answer.

This project intentionally does not contain a router, judge model, implementer,
command, LongLoop, or collaboration DAG.

## Install locally

From this directory:

```bash
npm install
npm run build
```

Register the generated plugin entry in the target project's `opencode.json`.
For a local checkout, use the path form supported by your OpenCode version:

```json
{
  "plugin": [
    [
      "/absolute/path/to/opencode-moa-fusion-new/opencode-moa-fusion.js",
      {
        "workers": [
          {
            "id": "one",
            "model": "provider/model-a",
            "reasoningEffort": "high"
          },
          { "id": "two", "model": "provider/model-b" },
          {
            "id": "three",
            "model": "provider/model-c",
            "focus": "Look for hidden assumptions and failure modes."
          }
        ],
        "timeoutMs": 3600000,
        "debug": false
      }
    ]
  ]
}
```

The `workers` array determines the worker count. There is no separate worker
cap. The tool accepts only a `prompt` argument, so models cannot be selected or
changed at runtime.

`timeoutMs` is an inactivity window, not a wall-clock deadline. It resets after
each OpenCode text, reasoning, tool-input, or tool-progress stream event. It
defaults to one hour. Set it to `false` to let the worker provider handle
timeouts instead.

Set `reasoningEffort` on an individual worker when the provider supports it:

```json
{
  "id": "deep-review",
  "model": "halotec/codex/gpt-5.6-luna",
  "reasoningEffort": "xhigh"
}
```

The plugin applies this as a per-worker OpenCode request option. OpenCode maps
it to the provider's request format. The provider or model still decides which
effort values are valid. `reasoningEffort` is separate from the model reference;
do not append `xhigh` to the model string.

Some OpenCode adapters expose reasoning levels as model variants instead. Use
`variant` for those workers:

```json
{
  "id": "antigravity",
  "model": "antigravity-cli/gemini-3.7-flash",
  "variant": "high"
}
```

Use one of `variant` or `reasoningEffort` on a worker, not both. Omit both when
you want the provider's default reasoning behavior.

## Anonymous workers

Worker model identities are never included in normal tool output. Every call
gets a fresh random alias such as `Worker A` or `Worker B`. The internal model
to alias mapping exists only in memory for that invocation.

The plugin also avoids model names in worker prompts, session titles, public
metadata, and sanitized errors. Configured focus is injected into the worker
prompt but is hidden from tool output. Worker models can still know their own
identity through provider/runtime metadata, and a main agent with permission
to read `opencode.json` can inspect the configuration. This is output-level
anonymization, not cryptographic anonymity.

## Worker output contract

Workers return one complete, evidence-grounded opinion in natural Markdown, not
JSON and not a rigid delimiter template. The tool renders the results in the
same shape as `fh-opinion`:

```text
◆ OPINIONS — ALL CONFIGURED AGENTS

## [Worker A] — CONCRETE OPINION
<complete opinion in Markdown>

## [Worker B] — CONCRETE OPINION
<complete opinion in Markdown>
```

The worker response is kept intact and is not parsed, repaired, or retried.
The complete tool result is wrapped programmatically, matching OpenCode's task
tool protocol:

```text
<task_result>
◆ OPINIONS — ALL CONFIGURED AGENTS
...
</task_result>
```

The wrapper is added by the plugin, not requested from the workers. It marks the
current MOA result cleanly without asking them to emit protocol tags. The child
sessions still return only their current response; the wrapper does not replay
their full session histories.

## Safety and failure behavior

- Workers receive `read`, `glob`, and `grep` only.
- `bash`, `write`, `edit`, `webfetch`, `patch`, `todowrite`, and recursive
  `moa_fusion` calls are explicitly disabled.
- Worker model references are checked against OpenCode's configured providers.
- Each worker has an independent inactivity timeout. OpenCode stream events
  reset it, so there is no fixed wall-clock deadline for an active worker.
- Stopping or aborting the main call also aborts every in-flight worker session.
- One failed worker does not discard successful worker outputs.
- Child sessions are not deleted. Set `debug: true` to include anonymous alias
  to session-ID mappings in tool metadata for out-of-band inspection.
- The plugin returns worker errors without provider or model identities.

## Optional main-agent prompt

See [`examples/main-agent-system-prompt.md`](examples/main-agent-system-prompt.md).
It is deliberately not installed automatically. Whether to call `moa_fusion`
should remain a main-agent policy decision.

## Tests

```bash
npm test
npm run test:e2e
```

The end-to-end test exercises the plugin, tool, configuration validation,
parallel worker calls, anonymous output, read-only tool settings, natural
Markdown opinion contract, persistent sessions, and partial worker failure
using a hermetic OpenCode client double. It does not spend provider tokens.
