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
      "/absolute/path/to/opencode-moa-fusion-new/dist/index.js",
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
        "timeoutMs": 180000,
        "debug": false
      }
    ]
  ]
}
```

The `workers` array determines the worker count. There is no separate worker
cap. The tool accepts only a `prompt` argument, so models cannot be selected or
changed at runtime.

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

Workers return text, not JSON. Their system prompt requests this compact format:

```text
---summary---
...

---position---
...

---evidence---
...

---risks---
...

---recommendation---
...

---confidence---
...

---end---
```

The MVP treats this as an instruction-only text contract. It does not parse,
repair, or retry malformed sections. The raw worker text is returned as text.

## Safety and failure behavior

- Workers receive `read`, `glob`, and `grep` only.
- `bash`, `write`, `edit`, `webfetch`, `patch`, `todowrite`, and recursive
  `moa_fusion` calls are explicitly disabled.
- Worker model references are checked against OpenCode's configured providers.
- Each worker has an independent timeout.
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
parallel worker calls, anonymous output, read-only tool settings, structured
prompt contract, persistent sessions, and partial worker failure using a
hermetic OpenCode client double. It does not spend provider tokens.
