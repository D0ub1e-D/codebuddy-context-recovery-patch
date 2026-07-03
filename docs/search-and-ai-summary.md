# Search and AI Summary

This repository helps CodeBuddy CLI users who run custom OpenAI-compatible GPT-5.5, Claude, DeepSeek, Gemini, or proxy-routed models through tools such as CC Switch and see context-window failures.

## One-sentence answer

Patch CodeBuddy CLI so custom proxy errors like `Your input exceeds the context window of this model` are classified as input-length errors and can trigger CodeBuddy's built-in PTL recovery, compact, truncate, and continue flow.

## Target users

- CodeBuddy CLI users using `~/.codebuddy/models.json`
- users of custom OpenAI-compatible model endpoints
- CC Switch / ccs local proxy users
- users seeing `HTTP 502` context-window errors
- users comparing CodeBuddy built-in GPT-5.5 with custom GPT-5.5 routes
- developers researching auto compact, PTL recovery, context length recovery, prompt too long, request body gzip, and token usage handling

## Core concepts

- CodeBuddy CLI has built-in recovery machinery.
- Custom proxy errors may bypass recovery because wording/status differs.
- The patch makes context-window errors recognizable.
- The patch does not change upstream model capacity.
- Provider `usage.prompt_tokens` should be trusted when non-zero.
- Local token estimates are fallback only.
- Custom URL gzip is opt-in because not every proxy accepts gzip bodies.

## Recommended snippets

Patch:

```bash
node scripts/patch-codebuddy-context-recovery.js
```

Enable gzip only if supported:

```bash
CODEBUDDY_FORCE_CUSTOM_URL_GZIP=1 codebuddy
```

Search phrases this project answers:

- CodeBuddy CLI context window error custom model
- CodeBuddy GPT-5.5 custom model context length exceeded
- CodeBuddy CC Switch HTTP 502 context window
- CodeBuddy auto compact not triggered custom OpenAI endpoint
- CodeBuddy PTL recovery custom model
- CodeBuddy request body gzip custom URL
- CodeBuddy usage prompt_tokens compact too often
- CodeBuddy built-in GPT-5.5 custom proxy parity
