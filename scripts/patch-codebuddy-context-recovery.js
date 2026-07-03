#!/usr/bin/env node
/*
 * CodeBuddy custom-model context recovery patch.
 *
 * Idempotent, backup-first, fail-closed.
 *
 * Fixes common custom OpenAI-compatible proxy problems:
 * - context-window errors returned as HTTP 502 are treated as input-too-long
 * - CodeBuddy PTL recovery can compact/truncate/continue instead of hard failing
 * - custom URL gzip can be enabled with CODEBUDDY_FORCE_CUSTOM_URL_GZIP=1
 * - PreMessageCompact only uses rough local token estimate when provider usage is missing
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const childProcess = require('child_process');

const PATCH_MARKER = 'CODEBUDDY_CONTEXT_RECOVERY_PATCH_V1';

function resolveCodeBuddyRoot() {
  if (process.env.CODEBUDDY_ROOT) return process.env.CODEBUDDY_ROOT;

  const candidates = [
    '/opt/homebrew/lib/node_modules/@tencent-ai/codebuddy-code',
    '/usr/local/lib/node_modules/@tencent-ai/codebuddy-code',
  ];

  try {
    const npmRoot = childProcess.execFileSync('npm', ['root', '-g'], { encoding: 'utf8' }).trim();
    candidates.unshift(path.join(npmRoot, '@tencent-ai/codebuddy-code'));
  } catch {}

  const found = candidates.find((candidate) => fs.existsSync(path.join(candidate, 'dist/codebuddy.js')));
  if (!found) {
    throw new Error('CodeBuddy install not found. Set CODEBUDDY_ROOT=/path/to/@tencent-ai/codebuddy-code');
  }
  return found;
}

const ROOT = resolveCodeBuddyRoot();
const TARGETS = [
  path.join(ROOT, 'dist/codebuddy.js'),
  path.join(ROOT, 'dist/codebuddy-headless.js'),
];
const STATE_FILE = path.join(process.env.HOME || '.', '.codebuddy/patches/context-recovery-patch-state.json');

function sha256(s) {
  return crypto.createHash('sha256').update(s).digest('hex');
}

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}

function writeJson(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n', 'utf8');
}

function backup(file, content) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const bak = `${file}.bak.${stamp}`;
  fs.writeFileSync(bak, content, 'utf8');
  return bak;
}

function patchByRegex(text, file, label, re, replacer) {
  if (text.includes(`${PATCH_MARKER}:${label}`)) return { text, status: 'already' };
  const matches = [...text.matchAll(re)];
  if (matches.length !== 1) {
    throw new Error(`${path.basename(file)}: patch target '${label}' expected once, found ${matches.length}`);
  }
  return { text: text.replace(re, replacer), status: 'patched' };
}

function patchInputLength(text, file) {
  return patchByRegex(
    text,
    file,
    'input-length',
    /return!!([A-Za-z_$][\w$]*)&&\(\1\.includes\("input length too long"\)\|\|\1\.includes\("prompt is too long"\)\|\|\1\.includes\("maximum context length"\)\|\|\/input\\s\*\(\?:length\|tokens\?\)\[\^0-9\]\*\\d\+\[\^0-9\]\+exceeds\/\.test\(\1\)\)\}\}/g,
    (m, v) => `return!!${v}&&(${v}.includes("input length too long")||${v}.includes("prompt is too long")||${v}.includes("maximum context length")||${v}.includes("context window")||${v}.includes("context length exceeded")||${v}.includes("context_length_exceeded")||${v}.includes("token limit exceeded")||${v}.includes("tokens limit exceeded")||${v}.includes("prompt too large")||${v}.includes("input exceeds the context")||${v}.includes("input exceeds")||/input\\s*(?:length|tokens?)[^0-9]*\\d+[^0-9]+exceeds/.test(${v}))}/*${PATCH_MARKER}:input-length*/}`
  );
}

function patchErrorUtilsInputLength(text, file) {
  return patchByRegex(
    text,
    file,
    'errorutils-input-length',
    /return!!([A-Za-z_$][\w$]*)&&\(\1\.includes\("input length too long"\)\|\|\1\.includes\("prompt is too long"\)\|\|\1\.includes\("maximum context length"\)\|\|\/input\\s\*\(\?:length\|tokens\?\)\[\^0-9\]\*\\d\+\[\^0-9\]\+exceeds\/\.test\(\1\)\)\}/g,
    (m, v) => `return!!${v}&&(${v}.includes("input length too long")||${v}.includes("prompt is too long")||${v}.includes("maximum context length")||${v}.includes("context window")||${v}.includes("context length exceeded")||${v}.includes("context_length_exceeded")||${v}.includes("token limit exceeded")||${v}.includes("tokens limit exceeded")||${v}.includes("prompt too large")||${v}.includes("input exceeds the context")||${v}.includes("input exceeds")||/input\\s*(?:length|tokens?)[^0-9]*\\d+[^0-9]+exceeds/.test(${v}))}/*${PATCH_MARKER}:errorutils-input-length*/`
  );
}

function patch502Priority(text, file) {
  return patchByRegex(
    text,
    file,
    '502-priority',
    /function classifyErrorDetail\(([A-Za-z_$][\w$]*),([A-Za-z_$][\w$]*),([A-Za-z_$][\w$]*)\)([\s\S]{0,1800}?)if\(502===\2\|\|503===\2\|\|504===\2\|\|408===\2\)return\{category:"network",subcategory:"network_server_error"\};/g,
    (m, errVar, statusVar, bizVar, prefix) => `function classifyErrorDetail(${errVar},${statusVar},${bizVar})${prefix}if((502===${statusVar}||503===${statusVar}||504===${statusVar}||408===${statusVar})&&isInputLengthLike(${errVar}))return{category:"model_service",subcategory:"model_input_too_long"};if(502===${statusVar}||503===${statusVar}||504===${statusVar}||408===${statusVar})return{category:"network",subcategory:"network_server_error"};/*${PATCH_MARKER}:502-priority*/`
  );
}

function patchCustomGzip(text, file) {
  return patchByRegex(
    text,
    file,
    'custom-gzip',
    /if\(([A-Za-z_$][\w$]*)&&([A-Za-z_$][\w$]*)\.models\?\.some\(([A-Za-z_$][\w$]*)=>\3\.url&&\3\.id===\1\)\)return void this\.logger\.debug\(`Skipping gzip compression for model with custom URL: \$\{\1\}`\);/g,
    (m, modelVar, configVar, itemVar) => `if(${modelVar}&&${configVar}.models?.some(${itemVar}=>${itemVar}.url&&${itemVar}.id===${modelVar})&&!['1','true','yes'].includes(String(process.env.CODEBUDDY_FORCE_CUSTOM_URL_GZIP||'').toLowerCase()))return void this.logger.debug(\`Skipping gzip compression for model with custom URL: \${${modelVar}}\`);/*${PATCH_MARKER}:custom-gzip*/`
  );
}

function patchUsageFallback(text, file) {
  if (text.includes(`${PATCH_MARKER}:usage-fallback-relaxed`)) return { text, status: 'already' };
  const aggressive = /if\(([A-Za-z_$][\w$]*)\.history&&\1\.history\.length>0\)\{let eCodeBuddyEstimate=this\.estimateHistoryTokens\(\1\.history\);\(0===([A-Za-z_$][\w$]*)\|\|\2<\.3\*eCodeBuddyEstimate\)&&\(this\.logger\.info\(`\[PreMessageCompact\] API usage missing\/small, using local estimate: api=\$\{\2\}, estimate=\$\{eCodeBuddyEstimate\} tokens across \$\{\1\.history\.length\} history items`\),\2=Math\.max\(\2,eCodeBuddyEstimate\),([A-Za-z_$][\w$]*)="local-estimate-max"\)\}if\(0===\2\)return;\/\*CODEBUDDY_CONTEXT_RECOVERY_PATCH_V1:usage-fallback\*\//g;
  const matches = [...text.matchAll(aggressive)];
  if (matches.length === 1) {
    return {
      text: text.replace(aggressive, (m, sessionVar, usageVar, sourceVar) => `if(0===${usageVar}&&${sessionVar}.history&&${sessionVar}.history.length>0){let eCodeBuddyEstimate=this.estimateHistoryTokens(${sessionVar}.history);this.logger.info(\`[PreMessageCompact] No API usage available, fallback to local estimate: \${eCodeBuddyEstimate} tokens across \${${sessionVar}.history.length} history items\`),${usageVar}=eCodeBuddyEstimate,${sourceVar}="local-estimate"}if(0===${usageVar})return;/*${PATCH_MARKER}:usage-fallback-relaxed*/`),
      status: 'patched',
    };
  }
  if (matches.length > 1) throw new Error(`${path.basename(file)}: aggressive usage fallback found ${matches.length} times`);
  return { text, status: 'native' };
}

function patchFile(file) {
  if (!fs.existsSync(file)) throw new Error(`${file} not found`);
  const before = fs.readFileSync(file, 'utf8');
  const beforeHash = sha256(before);
  let text = before;
  const results = [];

  for (const fn of [patchInputLength, patchErrorUtilsInputLength, patch502Priority, patchCustomGzip, patchUsageFallback]) {
    const r = fn(text, file);
    text = r.text;
    results.push({ label: fn.name.replace(/^patch/, ''), status: r.status });
  }

  if (text === before) {
    return { file, changed: false, beforeHash, afterHash: beforeHash, backup: null, results };
  }

  const bak = backup(file, before);
  fs.writeFileSync(file, text, 'utf8');
  return { file, changed: true, beforeHash, afterHash: sha256(text), backup: bak, results };
}

function main() {
  const state = readJson(STATE_FILE, { runs: [] });
  const run = { time: new Date().toISOString(), root: ROOT, targets: [] };

  for (const file of TARGETS) run.targets.push(patchFile(file));

  state.runs = state.runs || [];
  state.runs.push(run);
  fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
  writeJson(STATE_FILE, state);

  for (const t of run.targets) {
    console.log(`${t.changed ? 'patched' : 'already-patched'} ${t.file}`);
    if (t.backup) console.log(`  backup: ${t.backup}`);
    for (const r of t.results) console.log(`  ${r.status}: ${r.label}`);
  }
  console.log(`state: ${STATE_FILE}`);
  console.log('custom gzip opt-in: CODEBUDDY_FORCE_CUSTOM_URL_GZIP=1');
}

try {
  main();
} catch (err) {
  console.error(`Patch failed: ${err && err.message ? err.message : String(err)}`);
  console.error('Fail closed. If CodeBuddy internals changed, open an issue with your version and shortest error line.');
  process.exit(1);
}
