# CodeBuddy Context Recovery Patch

Patch and field guide for making CodeBuddy CLI custom OpenAI-compatible models recover from context-window failures more like the built-in GPT-5.5 route.

Keywords: CodeBuddy CLI, CodeBuddy Code, GPT-5.5, built-in model, custom model, OpenAI-compatible proxy, context window, context length exceeded, prompt too long, PTL recovery, auto compact, CC Switch, ccs, local proxy, request body gzip, usage prompt tokens.

## Problem

CodeBuddy CLI built-in models handle long sessions smoothly. Custom models behind an OpenAI-compatible proxy often fail with errors like:

```text
502 CC Switch local proxy failed while handling Codex endpoint /chat/completions. Provider: <provider>; model: gpt-5.5; upstream_status: HTTP 502; cause: Your input exceeds the context window of this model. Please adjust your input and try again.
```

Without this patch, CodeBuddy may classify that response as a network/server error instead of an input-length error. PTL recovery does not run, so the session hard-fails instead of compacting, truncating old history, and continuing.

## What this patch does

The script patches local CodeBuddy distribution files:

- `dist/codebuddy.js`
- `dist/codebuddy-headless.js`

It adds four client-side compatibility fixes:

1. Recognize `context window`, `context length exceeded`, `token limit exceeded`, and similar messages as input-length errors.
2. Treat `502/503/504/408 + context-window text` as model input too long, not generic network failure.
3. Add opt-in gzip for custom model URLs with `CODEBUDDY_FORCE_CUSTOM_URL_GZIP=1`.
4. Relax usage fallback: trust provider `usage.prompt_tokens` when present; use CodeBuddy rough local estimate only when usage is missing/zero.

The patch is idempotent, backup-first, and fail-closed. If CodeBuddy internals change and a target string no longer matches exactly once, the script stops instead of guessing.

## Quick start

```bash
git clone https://github.com/<your-user>/codebuddy-context-recovery-patch.git
cd codebuddy-context-recovery-patch
node scripts/patch-codebuddy-context-recovery.js
```

Restart CodeBuddy CLI after patching:

```bash
codebuddy
```

Optional gzip test for custom URL proxies:

```bash
CODEBUDDY_FORCE_CUSTOM_URL_GZIP=1 codebuddy
```

If your proxy rejects gzip request bodies, omit that environment variable.

## Recommended CodeBuddy model config

For a built-in-model-like GPT-5.5 custom model profile:

```json
{
  "id": "gpt-5.5",
  "name": "gpt-5.5-self",
  "vendor": "chatgpt",
  "apiKey": "${CODEBUDDY_CUSTOM_MODEL_API_KEY}",
  "url": "http://127.0.0.1:<proxy-port>/v1/chat/completions",
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

Put it in:

```text
~/.codebuddy/models.json
```

Do not force aggressive compact thresholds unless needed. The built-in route normally relies on model metadata, accurate usage, request gzip, and PTL recovery.

## Why this helps

CodeBuddy already has useful recovery machinery:

- `PreMessageCompact`
- engineering compaction
- microcompact for tool results
- PTL recovery
- emergency compact
- head-history truncation
- `Context Length Recovery`

The custom route often misses the recovery path because proxy/upstream errors use different wording. This patch maps common custom-proxy context errors back into CodeBuddy's existing recovery system.

## Not a perfect built-in route clone

This patch does not control the upstream provider, proxy, gateway, model route, or true context window. It cannot guarantee 100% parity with built-in GPT-5.5.

It improves client behavior for common custom-model failures. You still need:

- realistic `maxInputTokens`
- proxy support for stable streaming/tool calls
- accurate `usage.prompt_tokens` when possible
- optional gzip support for large request bodies
- compatible model behavior for CodeBuddy tool calling

## CC Switch / local proxy notes

This patch works well with a local provider router such as CC Switch when the proxy forwards OpenAI-compatible chat completions.

Best proxy behavior:

- preserve or synthesize accurate `usage.prompt_tokens`
- do not hide context-limit errors as generic network errors
- return context errors with recognizable text such as `maximum context length` or `input length too long`
- only fail over on transient network/provider errors, not on context-window errors

## Updating CodeBuddy CLI

CodeBuddy updates overwrite patched distribution files. Re-run:

```bash
node scripts/patch-codebuddy-context-recovery.js
```

The script records patch runs at:

```text
~/.codebuddy/patches/context-recovery-patch-state.json
```

## Rollback

The script creates timestamped backups next to each target file:

```text
codebuddy.js.bak.<timestamp>
codebuddy-headless.js.bak.<timestamp>
```

Restore manually:

```bash
cp /path/to/codebuddy.js.bak.<timestamp> /path/to/codebuddy.js
cp /path/to/codebuddy-headless.js.bak.<timestamp> /path/to/codebuddy-headless.js
```

Then restart CodeBuddy CLI.

## FAQ

### Do I need to stop every running CodeBuddy CLI?

No. Already-running Node processes keep old code in memory. Patch disk files, then restart only the CLI instance you want patched.

### Why did compact become too frequent?

Do not override non-zero provider usage with rough local estimates. This patch only falls back to local estimate when API usage is zero or missing.

### Should I enable gzip?

Only if your local proxy/upstream accepts `Content-Encoding: gzip` request bodies:

```bash
CODEBUDDY_FORCE_CUSTOM_URL_GZIP=1 codebuddy
```

If you see body parse errors, disable it.

### Is this official?

No. This is an unofficial compatibility patch and reverse-engineering note for advanced CodeBuddy CLI users.

## License

MIT
