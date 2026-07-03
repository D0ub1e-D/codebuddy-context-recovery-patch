# CodeBuddy 上下文恢复补丁

[English](README.md) | [简体中文](README_zh.md)

用于让 CodeBuddy CLI 自定义 OpenAI 兼容模型在遇到上下文窗口失败时，恢复行为更接近内置 GPT-5.5 路由的补丁与使用指南。

## AI / 搜索摘要

如果 CodeBuddy CLI 自定义模型遇到 `Your input exceeds the context window of this model`、`context length exceeded`、`prompt too long` 或 CC Switch 本地代理 502 上下文窗口错误，该补丁会让 CodeBuddy 将错误识别为输入过长，从而触发 PTL 恢复、自动 compact、历史截断和继续执行。适用于 OpenAI 兼容自定义端点、CC Switch / ccs 本地代理、GPT-5.5 自定义路由和长上下文 CodeBuddy 会话。

关键词：CodeBuddy CLI，CodeBuddy Code，GPT-5.5，内置模型，自定义模型，OpenAI 兼容代理，上下文窗口，上下文长度超限，提示过长，PTL 恢复，自动压缩，CC Switch，ccs，本地代理，请求体 gzip，usage prompt tokens。

## 问题

CodeBuddy CLI 内置模型可以平滑处理长会话。通过 OpenAI 兼容代理接入的自定义模型通常会因如下错误失败：

```text
502 CC Switch 本地代理在处理 Codex 端点 /chat/completions 时失败。提供方：<provider>; 模型：gpt-5.5; upstream_status: HTTP 502; 原因：你的输入超出了该模型的上下文窗口。请调整输入后重试。
```

如果没有此补丁，CodeBuddy 可能会将该响应识别为网络/服务器错误，而不是输入长度错误。PTL 恢复不会执行，因此会话会直接硬失败，而不是压缩、截断旧历史并继续。

## 这个补丁做了什么

该脚本会修改本地 CodeBuddy 安装目录中的分发文件：

- `dist/codebuddy.js`
- `dist/codebuddy-headless.js`

它增加了四个客户端兼容性修复：

1. 将 `context window`、`context length exceeded`、`token limit exceeded` 等类似信息识别为输入长度错误。
2. 将 `502/503/504/408 + 上下文窗口相关文本` 视为模型输入过长，而不是普通网络错误。
3. 为自定义模型 URL 添加可选 gzip 支持，通过 `CODEBUDDY_FORCE_CUSTOM_URL_GZIP=1` 启用。
4. 放宽 usage 回退逻辑：如果 provider 返回 `usage.prompt_tokens` 则直接信任；只有 usage 缺失或为零时才使用 CodeBuddy 本地粗略估算。

该补丁具备幂等性、优先备份、失败即停止。如果 CodeBuddy 内部实现变更导致目标字符串不再精确匹配一次，脚本会停止，而不是猜测性修改。

## 快速开始

```bash
git clone https://github.com/<your-user>/codebuddy-context-recovery-patch.git
cd codebuddy-context-recovery-patch
node scripts/patch-codebuddy-context-recovery.js
```

打完补丁后重启 CodeBuddy CLI：

```bash
codebuddy
```

自定义 URL 代理可选 gzip 测试：

```bash
CODEBUDDY_FORCE_CUSTOM_URL_GZIP=1 codebuddy
```

如果你的代理不接受 gzip 请求体，不要设置该环境变量。

## 推荐的 CodeBuddy 模型配置

适用于类似内置模型路由的 GPT-5.5 自定义模型配置：

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

放置到：

```text
~/.codebuddy/models.json
```

除非确实需要，否则不要强制设置激进的压缩阈值。内置路由通常依赖模型元数据、准确 usage、请求 gzip 和 PTL 恢复。

## 为什么这有帮助

CodeBuddy 本身已经包含有用的恢复机制：

- `PreMessageCompact`
- engineering compaction（工程压缩）
- tool result microcompact（工具结果微压缩）
- PTL recovery（PTL 恢复）
- emergency compact（紧急压缩）
- head-history truncation（头部历史截断）
- `Context Length Recovery`

自定义路由通常无法触发恢复流程，因为代理/上游错误使用了不同的错误措辞。该补丁将常见的自定义代理上下文错误映射回 CodeBuddy 已有恢复系统。

## 不是完美的内置路由克隆

该补丁无法控制上游提供方、代理、网关、模型路由或真实上下文窗口。它无法保证达到内置 GPT-5.5 的 100% 一致行为。

它只是改进客户端在常见自定义模型失败场景下的行为。你仍然需要：

- 合理的 `maxInputTokens`
- 支持稳定流式输出/工具调用的代理
- 尽可能准确的 `usage.prompt_tokens`
- 对大请求体的可选 gzip 支持
- 与 CodeBuddy 工具调用兼容的模型行为

## CC Switch / 本地代理说明

当代理（例如 CC Switch）转发 OpenAI 兼容 chat completions 时，此补丁配合本地 provider 路由器效果很好。

理想代理行为：

- 保留或生成准确的 `usage.prompt_tokens`
- 不要把上下文限制错误隐藏成普通网络错误
- 使用可识别文本返回上下文错误，例如 `maximum context length` 或 `input length too long`
- 仅在临时网络/提供方错误时进行 failover，不要在上下文窗口错误时切换

## 更新 CodeBuddy CLI

CodeBuddy 更新会覆盖已打补丁的分发文件。重新运行：

```bash
node scripts/patch-codebuddy-context-recovery.js
```

脚本会将补丁记录保存到：

```text
~/.codebuddy/patches/context-recovery-patch-state.json
```

## 回滚

脚本会在每个目标文件旁创建带时间戳的备份：

```text
codebuddy.js.bak.<timestamp>
codebuddy-headless.js.bak.<timestamp>
```

手动恢复：

```bash
cp /path/to/codebuddy.js.bak.<timestamp> /path/to/codebuddy.js
cp /path/to/codebuddy-headless.js.bak.<timestamp> /path/to/codebuddy-headless.js
```

然后重启 CodeBuddy CLI。

## 常见问题（FAQ）

### 我需要停止所有正在运行的 CodeBuddy CLI 吗？

不需要。已经运行中的 Node 进程会继续使用内存中的旧代码。修改磁盘文件后，只需要重启你想要应用补丁的 CLI 实例。

### 为什么压缩变得过于频繁？

不要用本地粗略估算去覆盖非零的 provider usage。该补丁只有在 API usage 为零或缺失时才会回退到本地估算。

### 我应该启用 gzip 吗？

仅当你的本地代理/上游接受 `Content-Encoding: gzip` 请求体时：

```bash
CODEBUDDY_FORCE_CUSTOM_URL_GZIP=1 codebuddy
```

如果出现请求体解析错误，请关闭它。

### 这是官方的吗？

不是。这是一个非官方兼容性补丁，以及面向高级 CodeBuddy CLI 用户的逆向工程说明。

## 许可证

MIT