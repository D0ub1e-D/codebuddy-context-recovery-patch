# Technical Notes

## Built-in GPT-5.5 client-side profile

Observed local product metadata:

```json
{
  "id": "gpt-5.5",
  "name": "GPT-5.5",
  "maxInputTokens": 1000000,
  "maxOutputTokens": 72000,
  "maxAllowedSize": 1000000,
  "supportsToolCall": true,
  "supportsImages": true,
  "supportsReasoning": true,
  "onlyReasoning": true,
  "reasoning": {
    "effort": "high",
    "summary": "auto"
  }
}
```

Built-in product features include:

```json
{
  "RequestBodyGzip": true
}
```

Base token thresholds observed in product metadata:

```json
{
  "inputTokens": {
    "warning": 0.6,
    "critical": 0.7,
    "emergency": 0.92,
    "preMessage": 0.8
  },
  "compact": {
    "emergency": 0.4
  },
  "summary": {
    "emergency": 0.15
  },
  "request": {
    "emergency": 0.9
  }
}
```

## Why custom proxy routes fail differently

Common custom route:

```text
CodeBuddy CLI -> local proxy / router -> upstream model provider
```

A proxy may return:

```text
HTTP 502: Your input exceeds the context window of this model
```

CodeBuddy needs this to be treated as input-too-long. If it is treated as network/server error, PTL recovery does not run.

## Recovery chain

Useful CodeBuddy client-side recovery flow:

```text
PreMessageCompact
-> engineering compaction
-> microcompact tool results
-> optional LLM summary
-> PTL recovery
-> emergency compact
-> truncate old history
-> Context Length Recovery
-> continue
```

This patch improves routing into that existing recovery chain. It does not implement a new compactor.

## Usage handling

Best practice:

1. Trust provider or proxy `usage.prompt_tokens` if present and non-zero.
2. Use local rough estimate only when usage is absent or zero.
3. Do not override non-zero usage with rough estimate unless you intentionally prefer conservative compaction.

Earlier aggressive logic such as:

```text
if apiUsage < localEstimate * 0.3 -> use localEstimate
```

can trigger compact too often because local rough estimates serialize history and tend to be conservative.

## Gzip handling

CodeBuddy skips request gzip for custom model URLs by default. This patch adds:

```bash
CODEBUDDY_FORCE_CUSTOM_URL_GZIP=1
```

Only enable it if your proxy supports gzip request bodies.

## Update safety

The script uses exact-pattern patching and markers:

```text
CODEBUDDY_CONTEXT_RECOVERY_PATCH_V1
```

If a target changes after a CodeBuddy update, patch fails closed. Reinspect relevant internals before updating patterns.
