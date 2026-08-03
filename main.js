'use strict';
(function() {
const __nativeRequire = typeof require === 'function' ? require : null;
const __modules = {
"main.js": function(require, module, exports) {
const {
  ItemView,
  Modal,
  Notice,
  Plugin,
  PluginSettingTab,
  requestUrl,
  Setting,
  TFile,
  TFolder
} = require("obsidian");

const {
  DEFAULT_SETTINGS,
  buildTaskFromFile,
  detectSourceType,
  isProcessableSource,
  migrateSettings,
  normalizeConfiguredPath,
  normalizeVaultPath,
  optionalVaultRelativePath,
  rollbackPath,
  sourceHash,
  statusCounts,
  TASK_STATUSES,
  PROCESSING_STATUSES,
  tasksPath,
  validateConfiguredPathSet,
  vaultRelativePath
} = require("src/core/task.js");
const { extractTextFromBuffer, sanitizeAttachmentFileName } = require("src/core/extractors.js");
const { upgradeParsePackage } = require("src/core/document-parser.js");
const { probeLocalOcr } = require("src/core/local-ocr.js");
const { createFolderIndexMarkdown, folderIndexPath } = require("src/core/moc.js");
const { parseTagLibrary, suggestMapIndex, validateCard } = require("src/core/tags.js");
const { detectEcosystemPlugins } = require("src/core/ecosystem.js");
const {
  BUILTIN_INFRASTRUCTURE_SCHEMA_PATHS,
  ComponentError,
  builtInInfrastructureSchema,
  normalizeComponentRelativePath,
  normalizeFolderMapConfig,
  resolveComponentFilePath,
  validateRuntimeContracts
} = require("src/core/component-loader.js");
const { cardOutputPath, resolveFixedRoute, resolveOutputRoute } = require("src/core/routing.js");
const { migrateTaskLedgerV3 } = require("src/core/migration.js");
const { createTaskRecord } = require("src/core/pipeline.js");
// v2.9.2: requestMiniMaxStream 之前漏了导入，SSE 开启时 line ~906 引用直接抛 ReferenceError
const { requestMiniMaxJson, requestMiniMaxStream } = require("src/core/ai-pipeline.js");
const { runKnowledgeWorkflow } = require("src/core/workflow.js");
const { buildCardRecord, cardFileName, renderKnowledgeCard, renderStructuredSummary } = require("src/core/markdown-renderer.js");
const { groupReviewItems, applyBatchAction, isApprovalEligible, safeApprovalPlan, nextReviewIndex } = require("src/core/review-service.js");
const {
  consumeSelectedRegeneration,
  createSelectedRegenerationPlan,
  mergeSelectedRegenerationResult,
  markManualPending,
  archiveRejected
} = require("src/core/selected-regeneration.js");
const { explainIssue, pipelineProgress, queuePosition } = require("src/core/production-ux.js");
const {
  completionUiSnapshot,
  pendingReviewCount,
  shouldAcceptIncrementalProgress
} = require("src/core/completion-ui.js");
const {
  createStageMetric,
  loadCredentialFile,
  saveCredentialFile,
  sanitizeForLog,
  sanitizeSettingsForPersistence,
  toAppError
} = require("src/core/reliability.js");
const {
  buildDiagnosticReport,
  renderDiagnosticMarkdown,
  boundedDiagnosticJson
} = require("src/core/diagnostic-report.js");
const {
  SHADOW_SCHEMA_VERSION,
  aggregateShadowRuns,
  boundedShadowStore,
  buildShadowDocumentMetric,
  compareShadowAggregates,
  migrateShadowStore,
  renderShadowMarkdown,
  selectShadowCohort,
  shadowPseudonym
} = require("src/core/shadow-evaluation.js");
const {
  formatBusinessDate,
  formatOperationalLocalDateTime,
  preciseIsoInstant,
  resolveRuntimeTimeZone
} = require("src/core/time-policy.js");
const {
  AliyunBailianQwen37EmbeddingProvider,
  SemanticPostProcessor,
  semanticSettingsSnapshot
} = require("src/core/semantic-embedding.js");
const { runUniversalPipelineMultilingual } = require("src/universal-knowledge-pipeline.js");
const {
  KnowledgeWritePort,
  applyVerifiedFacts,
  deriveVerifiedFacts,
  normalizeTaskForPersistence,
  auditTaskInvariants
} = require("src/knowledge-write-port.js");
const {
  buildPlan: buildStructuredPlan,
  commitPlan: commitStructuredPlan,
  rollbackTransaction: rollbackStructuredTransaction,
  hash: structuredContentHash,
  emptyIndex: emptyStructuredIndex,
  normalizeSettings: normalizeStructuredSettings,
  validateIndex: validateStructuredIndex
} = require("src/structured-writer.js");

// v1.1.9 / v1.1.10: 把诊断共享状态挂到 globalThis，让 src/core/ai-pipeline.js 等独立闭包模块也能调用 diag()
// 历史背景：v1.1.6 起在 src/core/ai-pipeline.js（line 3928-4609）里加了 3 个 diag() 调用
//          （minimax.timeout / minimax.transport / minimax.http），但 ai-pipeline.js 是独立 bundle 模块闭包，
//          main.js 里 function diag 对它词法不可见，运行到失败路径时直接报 "diag is not defined"。
// v1.1.9 只 init state，function diag 仍留在 main.js 本地闭包；ai-pipeline wrapper 静默不调用（不抛错），
//          但 ReferenceError 仍可能在 main.js 模块求值之前被触发的边角路径上触发。
// v1.1.10 真正修复：下面把 function diag / keyFingerprint / flushDiagLog / forceFlushDiag 全部 attach 到
//          globalThis.__eksDiag（同时声明一个 no-op fallback 防止 main.js 还没 attach 时 ai-pipeline
//          触发 ReferenceError）。wrapper 走 globalThis 委托，单一来源。
if (!globalThis.__eksDiag) globalThis.__eksDiag = { state: { logPath: null, buffer: [], flushTimer: null } };
// 兜底：如果 main.js 的 function diag 还没装载（极端缓存/重启顺序），ai-pipeline 触发也不抛 ReferenceError，
//   而是 console.log 一行即可。等下方 attach 完成后再调用就会触发真正的实现。
function diagFallback(scope, payload) { try { console.log('[EKS diag] ' + scope + ' ' + JSON.stringify(payload || { value: payload })); } catch (_) {} }
function fpFallback() { return 'fp:<unavailable>'; }
globalThis.__eksDiag.diag = globalThis.__eksDiag.diag || diagFallback;
globalThis.__eksDiag.keyFingerprint = globalThis.__eksDiag.keyFingerprint || fpFallback;
globalThis.__eksDiag.flushDiagLog = globalThis.__eksDiag.flushDiagLog || function () {};
globalThis.__eksDiag.forceFlushDiag = globalThis.__eksDiag.forceFlushDiag || function () {};

// v1.1.3 + v1.1.5: 字符串规范化工具，做 NFC + 控制字符剥离 + 全角→半角空格。
// 必须放在 main.js 模块的"主代码区"（plugin class 闭包能直接看到的位置）。
// 之前误放在 src/core/task.js 模块内，那是独立作用域，main.js 模块内的 plugin class 方法看不到。
// v1.1.5 把它抬到 main.js bundle 模块的 closure 内，使 plugin class 的所有方法都能解析到。
// migration.js 模块内的同款副本保留一份独立副本，避免跨模块引用崩。
// v1.4: 新增 normalizePathForCompare 作为路径比较的唯一入口。
//       顺序固定为 normalizeVaultPath → normalizeUnicodeForm，调用方不再各自拼。
function normalizePathForCompare(value) {
  return normalizeUnicodeForm(normalizeVaultPath(value));
}

function isSafeCardOutputPath(settings, value) {
  const candidate = normalizePathForCompare(value);
  return [settings.bidOutputPath, settings.businessOutputPath]
    .map(normalizePathForCompare)
    .some((root) => root && candidate !== root && candidate.startsWith(`${root}/`));
}
function normalizeUnicodeForm(value) {
  let str = String(value || '');
  if (!str) return str;
  if (typeof str.normalize === 'function') {
    try { str = str.normalize('NFC'); } catch { /* 不可用则忽略 */ }
  }
  str = str.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F﻿]/g, '');
  str = str.replace(/[  ]/g, ' ');
  return str;
}

function errorCausalChain(error) {
  const chain = [];
  const seen = new Set();
  let current = error;
  while (current && !seen.has(current) && chain.length < 6) {
    seen.add(current);
    const rawCode = String(current.code || '').toUpperCase();
    chain.push({
      code: /^[A-Z][A-Z0-9_]+$/.test(rawCode) ? rawCode : (chain.length ? 'CAUSE_UNCLASSIFIED' : 'INTERNAL_UNEXPECTED'),
      category: String(current.category || 'internal'),
      retryable: current.retryable === true,
      type: String(current.name || current.constructor?.name || 'Error'),
      message: String(current.message || current)
    });
    current = current.cause;
  }
  return sanitizeForLog(chain);
}

// v1.1.6: 统一诊断日志入口。所有诊断输出都带 `[EKS diag]` 前缀，
// 用户在 Obsidian DevTools Console 里 grep 一行就能定位。
// v1.1.7: 同时写到 .obsidian/plugins/engineering-knowledge-slicer/diag.log 文件，
//        让没法开 DevTools 的用户也能拿到日志（用 Obsidian 自身打开该 Markdown 文件即可查看）。
// v1.1.9: 共享状态 (__diagLogPath / __diagBuffer / __diagFlushTimer) 全部搬上 globalThis.__eksDiag.state，
//        这样 src/core/ai-pipeline.js 等独立 bundle 模块（line 3928-4609）也能写入同一个 diag.log。
function diag(scope, payload) {
  try {
    const data = payload && typeof payload === 'object' ? payload : { value: payload };
    const serialized = JSON.stringify(data, (_k, v) => {
      // v1.4: 改为"内容指纹"模式，不再依赖键名匹配。
      //       任何看起来像凭证的字面量都自动转指纹，与键名无关（防止调用方改个 key 名就漏出来）。
      //       同时也覆盖 JWT (eyJ...)、GitHub PAT (ghp_/gho_/ghs_/ghu_)、MinerU / PaddleOCR / MiniMax (sk-/key-) 各种前缀。
      if (typeof v === 'string') return redactCredential(v);
      return v;
    });
    const line = `[EKS diag] ${scope} ${serialized}`;
    console.log(line);
    // 写入文件：先入缓冲区，1 秒后批量 flush，避免每条诊断都同步 IO 卡 UI
    const state = globalThis.__eksDiag && globalThis.__eksDiag.state;
    if (state) {
      if (!Array.isArray(state.events)) state.events = [];
      state.events.push({ at: new Date().toISOString(), scope: String(scope || 'unknown'), data: JSON.parse(serialized) });
      if (state.events.length > 300) state.events.splice(0, state.events.length - 300);
    }
    if (state && state.logPath) {
      state.buffer.push(new Date().toISOString() + ' ' + line);
      if (!state.flushTimer) {
        state.flushTimer = setTimeout(flushDiagLog, 1000);
      }
    }
  } catch (e) { /* 诊断日志自身不能炸 */ }
}

// v1.4: 内容指纹脱敏。基于凭证特征（不是键名）判定一个字符串是否需要指纹化。
//       已识别的模式：
//         - JWT: 以 "eyJ" 开头的 base64url（典型长度 100+，形如 eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9....）
//         - GitHub PAT: ghp_/gho_/ghs_/ghu_/ghr_ 前缀的 36+ 字符字母数字
//         - OpenAI/Anthropic 风格: sk- 前缀，32+ 字符
//         - MinerU/PaddleOCR/MiniMax 风格: key- / paddle- / sk_ 前缀，32+ 字符
//         - 高熵长 base64/hex 串: 长度 ≥ 40 且几乎全是字母数字+/=- → 高概率是 secret
//       不会误伤：
//         - 短字符串（< 24 字符）
//         - 含空格 / 标点的自然语言片段
//         - 路径、URL、文件名前缀
function redactCredential(value) {
  const str = String(value || '');
  if (str.length < 24) return str;
  // JWT
  if (/^eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/.test(str)) return keyFingerprint(str);
  // GitHub PAT / API Token (ghp_/gho_/ghs_/ghu_/ghr_/gho_/ghx_)
  if (/^gh[pousxr]_[A-Za-z0-9]{30,}/.test(str)) return keyFingerprint(str);
  // sk- / sk_ / key- / paddle- 前缀的 token
  if (/^(sk-|sk_|key-|paddle-)[A-Za-z0-9]{16,}/.test(str)) return keyFingerprint(str);
  // 高熵长 base64/hex 串（≥ 40 字符，几乎全是 [A-Za-z0-9+/=_-]）
  if (str.length >= 40 && /^[A-Za-z0-9+/=_-]+$/.test(str)) {
    const charClasses = new Set(str.split('').map((c) => {
      if (/[A-Z]/.test(c)) return 'U';
      if (/[a-z]/.test(c)) return 'L';
      if (/[0-9]/.test(c)) return 'D';
      if (c === '+' || c === '/' || c === '=') return 'B';
      return c; // _ -
    }));
    if (charClasses.size >= 3) return keyFingerprint(str);
  }
  return str;
}

// v2.8.1: 按行剥离文件开头已有的日志头部说明块（第一行为标题，随后是空行或以 > 开头的说明行）。
//   旧实现用 indexOf('\n\n\n\n') 找头部边界，但该序列在文件里从不出现（头部结尾只有 \n\n），
//   导致旧头部永远剥不掉，每次 flush 都在文件最前面再摞一份头部（用户日志里累积了 27 份）。
//   循环剥离可自愈历史重复头部文件：升级后第一次 flush 即清理干净。
function stripDiagHeaders(text) {
  let lines = String(text || '').split('\n');
  while (lines.length && lines[0] === '# 工程知识切片 诊断日志') {
    let i = 1;
    while (i < lines.length && (lines[i] === '' || lines[i].startsWith('>'))) i += 1;
    lines = lines.slice(i);
  }
  return lines.join('\n');
}

function flushDiagLog() {
  const state = globalThis.__eksDiag && globalThis.__eksDiag.state;
  if (!state) return;
  state.flushTimer = null;
  if (!state.logPath || !state.buffer.length) return;
  try {
    const fs = require('fs');
    const path = require('path');
    // 每次 flush 前预留头部，方便用户打开文件第一眼就看到说明
    const header = [
      '# 工程知识切片 诊断日志',
      '',
      '> 这份文件由插件自动写入，记录所有 `[EKS diag]` 诊断事件。',
      '> 复制本文件全部内容（除了这一段说明）发给开发者即可定位问题。',
      '> 文件位置：`' + state.logPath + '`',
      '> 日志会自动 trim 到最近约 2000 行，避免文件无限增长。',
      '',
      ''
    ].join('\n');
    const lines = state.buffer.join('\n') + '\n';
    state.buffer = [];
    // 读旧内容、追加、trim
    let existing = '';
    try { existing = fs.readFileSync(state.logPath, 'utf-8'); } catch (_) { /* 不存在则忽略 */ }
    // v2.8.1: 去掉旧 header（含历史累积的多份）再合并，保证文件里有且仅有一份头部
    const oldBody = stripDiagHeaders(existing);
    const merged = header + oldBody + lines;
    // trim 到最近 2000 行
    const allLines = merged.split('\n');
    const MAX_LINES = 2000;
    const trimmed = allLines.length > MAX_LINES ? allLines.slice(allLines.length - MAX_LINES).join('\n') : merged;
    fs.mkdirSync(path.dirname(state.logPath), { recursive: true });
    fs.writeFileSync(state.logPath, trimmed, 'utf-8');
  } catch (e) {
    // 写日志失败不能炸插件
    try { console.warn('[EKS diag] flush failed', String(e && e.message || e)); } catch (_) {}
  }
}

// 强制立即 flush（用于进程退出前的最后一批日志）
function forceFlushDiag() {
  const state = globalThis.__eksDiag && globalThis.__eksDiag.state;
  if (state && state.flushTimer) { clearTimeout(state.flushTimer); state.flushTimer = null; }
  flushDiagLog();
}

// v1.1.8: 实时进度条 + 心跳
// 1 秒一次刷新 elapsedMs / at，不写盘、不重渲染整个 dashboard，只更新进度条 DOM
function startProgressHeartbeat(plugin, task, startedAt) {
  return setInterval(() => {
    try {
      if (!task || !plugin) return;
      if (!shouldAcceptIncrementalProgress(task, plugin._terminalTaskIds)) return;
      task.progress = task.progress || {};
      task.progress.elapsedMs = Date.now() - startedAt;
      task.progress.at = new Date().toISOString();
      plugin.refreshProgressOnly?.(task);
    } catch (_) { /* 心跳失败不能炸 */ }
  }, 1000);
}

// v1.1.8: 根据已用时 + 已完成批次数估算剩余时间
function computeEtaText(progress) {
  if (!progress || !progress.batchTotal || !progress.batchIndex || !progress.elapsedMs) return '';
  const avgPerBatch = progress.elapsedMs / progress.batchIndex;
  const remaining = progress.batchTotal - progress.batchIndex;
  if (remaining <= 0) return '';
  const etaMs = Math.round(avgPerBatch * remaining);
  return `预计剩余 ${formatDuration(etaMs)}`;
}

// 计算密钥指纹（sha256 前 8 字符），绝不暴露原值。
// 即使指纹出现在日志中也不会泄露密钥本身。
function keyFingerprint(value) {
  try {
    const crypto = require('crypto');
    return 'fp:' + crypto.createHash('sha256').update(String(value || '')).digest('hex').slice(0, 8);
  } catch (_) {
    return 'fp:<unavailable>';
  }
}

// v1.1.10: 把上面定义的真正实现 attach 到 globalThis.__eksDiag，替换占位的 fallback。
// ai-pipeline.js 的本地 diag wrapper 委托到 globalThis.__eksDiag.diag，现在能找到真函数。
if (typeof globalThis.__eksDiag === 'object') {
  globalThis.__eksDiag.diag = diag;
  globalThis.__eksDiag.keyFingerprint = keyFingerprint;
  globalThis.__eksDiag.flushDiagLog = flushDiagLog;
  globalThis.__eksDiag.forceFlushDiag = forceFlushDiag;
}

function loadSecretsFile() {
  try {
    const fs = require('fs');
    const path = require('path');
    const os = require('os');
    const secretsPath = path.join(os.homedir(), '.eks-secrets.json');
    if (fs.existsSync(secretsPath)) {
      const raw = fs.readFileSync(secretsPath, 'utf-8');
      const parsed = loadCredentialFile(secretsPath, { fs });
      diag('secrets.loaded', {
        path: secretsPath,
        sizeBytes: raw.length,
        keys: Object.keys(parsed || {}).reduce((acc, k) => {
          acc[k] = k === 'embeddingApiKey' ? '<configured>' : (parsed[k] ? keyFingerprint(parsed[k]) : '<empty>');
          return acc;
        }, {})
      });
      return parsed;
    }
    diag('secrets.missing', { path: secretsPath, hint: '请创建该文件并写入 minimaxApiKey/pdfMineruApiKey/pdfPaddleOcrApiKey 三个字段' });
  } catch (e) {
    diag('secrets.error', { message: String(e && e.message || e) });
    console.warn('工程知识切片: 密钥文件加载失败', e);
  }
  return {};
}

function saveSecretsFile(secrets = {}) {
  const fs = require('fs');
  const path = require('path');
  const os = require('os');
  const secretsPath = path.join(os.homedir(), '.eks-secrets.json');
  const allowed = ['minimaxApiKey', 'pdfMineruApiKey', 'pdfPaddleOcrApiKey', 'embeddingApiKey'];
  const previous = loadSecretsFile();
  const output = Object.assign({}, previous);
  for (const key of allowed) {
    const value = String(secrets[key] || '').trim();
    if (value) output[key] = value;
  }
  saveCredentialFile(secretsPath, output, { fs, pid: process.pid });
}

function saveSecretField(key, value) {
  const fs = require('fs');
  const path = require('path');
  const os = require('os');
  const secretsPath = path.join(os.homedir(), '.eks-secrets.json');
  const output = loadCredentialFile(secretsPath, { fs });
  const normalized = String(value || '').trim();
  if (normalized) output[key] = normalized;
  else delete output[key];
  saveCredentialFile(secretsPath, output, { fs, pid: process.pid });
}

// v1.7 (M-01): 重写 RateLimiter。
//       旧实现是"两段互斥"——并发上限 + 最小间隔，但 100ms 忙等轮询会无谓唤醒；
//       失败 / 超时没有 backoff，会立刻重试打到上游。
//       新实现：
//         - 滑动窗口（保留过去 N 次请求时间戳），窗口内请求数 ≤ maxConcurrent 才放行
//         - 最小间隔仍是 intervalMs，但用事件驱动（resolve 链）取代 100ms 轮询
//         - 失败时指数退避：连续失败次数 × intervalMs 上限 backoffMs
//         - run() 接受 fn，自动 acquire/release + onError 触发 backoff
class RateLimiter {
  constructor({ intervalMs = 1000, maxConcurrent = 2, backoffMaxMs = 30_000, windowSize = 10, queueTimeoutMs = 300_000 } = {}) {
    this.intervalMs = intervalMs;
    this.maxConcurrent = maxConcurrent;
    this.backoffMaxMs = backoffMaxMs;
    this.windowSize = windowSize;
    this.queueTimeoutMs = queueTimeoutMs;
    this.timestamps = []; // 滑动窗口内最近 N 次请求的 timestamp
    this.failures = 0;
    this.lastFailureAt = 0;
    this.waiters = []; // FIFO 等待队列，每项是 { resolve, startedAt }
  }

  _cleanupExpired(now) {
    const cutoff = now - this.intervalMs * this.windowSize;
    while (this.timestamps.length && this.timestamps[0] < cutoff) this.timestamps.shift();
  }

  _activeInWindow(now) {
    const cutoff = now - this.intervalMs;
    let count = 0;
    for (const t of this.timestamps) if (t >= cutoff) count += 1;
    return count;
  }

  _scheduleNextWaiter() {
    // 滑动窗口按请求开始时间限流，不能在请求结束时直接放行下一个 waiter。
    // waiter 自己的定时器会在窗口腾出额度后放行并从队列移除。
  }

  acquire(signal) {
    return new Promise((resolve, reject) => {
      if (signal?.aborted) return reject(abortError());
      const now = Date.now();
      this._cleanupExpired(now);
      const active = this._activeInWindow(now);
      if (active < this.maxConcurrent) {
        // 有空位，立即放行
        this.timestamps.push(now);
        resolve();
        return;
      }
      // 排队：等下一个"窗口滑过"或最早的请求出窗口
      const earliest = this.timestamps[0] || now;
      const waitMs = Math.max(100, (earliest + this.intervalMs) - now);
      const waiter = { resolve, reject, startedAt: now, done: false };
      const cleanup = () => {
        if (waiter.timer) clearTimeout(waiter.timer);
        if (waiter.timeoutTimer) clearTimeout(waiter.timeoutTimer);
        if (signal) signal.removeEventListener('abort', onAbort);
        const index = this.waiters.indexOf(waiter);
        if (index >= 0) this.waiters.splice(index, 1);
      };
      const onAbort = () => {
        if (waiter.done) return;
        waiter.done = true;
        cleanup();
        reject(abortError());
      };
      const tryFire = () => {
        if (waiter.done) return; // 已被 _scheduleNextWaiter 处理
        const t = Date.now();
        this._cleanupExpired(t);
        if (this._activeInWindow(t) < this.maxConcurrent) {
          this.timestamps.push(t);
          waiter.done = true;
          cleanup();
          resolve();
          return;
        }
        // 仍未空：再排一次队（重设 timer），不修改 waiters 数组以免重复入队
        const earliest2 = this.timestamps[0] || t;
        const waitMs2 = Math.max(100, (earliest2 + this.intervalMs) - t);
        waiter.timer = setTimeout(tryFire, waitMs2);
      };
      waiter.timer = setTimeout(tryFire, waitMs);
      if (this.queueTimeoutMs > 0) {
        waiter.timeoutTimer = setTimeout(() => {
          if (waiter.done) return;
          waiter.done = true;
          cleanup();
          const error = new Error('请求在限流队列中等待超时');
          error.code = 'RATE_LIMIT_QUEUE_TIMEOUT';
          reject(error);
        }, this.queueTimeoutMs);
      }
      if (signal) signal.addEventListener('abort', onAbort, { once: true });
      this.waiters.push(waiter);
    });
  }

  release() {
    // 滑动窗口按时间自动释放额度；不能因单个请求提前结束而绕过 intervalMs。
  }

  // 记录一次失败；后续 acquire 会自动指数退避
  recordFailure() {
    this.failures += 1;
    this.lastFailureAt = Date.now();
  }
  recordSuccess() {
    this.failures = 0;
    this.lastFailureAt = 0;
  }
  backoffMs() {
    if (this.failures === 0) return 0;
    // 1, 2, 4, 8 ... 指数退避到 backoffMaxMs
    const duration = Math.min(this.backoffMaxMs, this.intervalMs * Math.pow(2, Math.min(this.failures - 1, 10)));
    const remaining = Math.max(0, duration - Math.max(0, Date.now() - this.lastFailureAt));
    if (!remaining) this.recordSuccess();
    return remaining;
  }

  async run(fn, options = {}) {
    const signal = options.signal;
    if (signal?.aborted) throw abortError();
    const backoff = this.backoffMs();
    if (backoff > 0) {
      try { diag('ratelimit.backoff', { failures: this.failures, backoffMs: backoff, outboundRequest: true }); } catch (_) {}
      await sleepWithSignal(backoff, signal);
    }
    await this.acquire(signal);
    try {
      const result = await fn();
      this.recordSuccess();
      return result;
    } catch (e) {
      if (e?.name !== 'AbortError' && e?.code !== 'TASK_CANCELLED' && options.countFailure !== false) {
        this.recordFailure();
      }
      throw e;
    } finally {
      this.release();
    }
  }
}

function abortError() {
  const error = new Error('任务已取消');
  error.name = 'AbortError';
  error.code = 'TASK_CANCELLED';
  return error;
}

function sleepWithSignal(ms, signal) {
  if (!ms) return Promise.resolve();
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(abortError());
    const timer = setTimeout(() => {
      if (signal) signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(abortError());
    };
    if (signal) signal.addEventListener('abort', onAbort, { once: true });
  });
}

const VIEW_TYPE_SLICER = 'engineering-knowledge-slicer-dashboard';
module.exports = class EngineeringKnowledgeSlicerPlugin extends Plugin {
  async onload() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, migrateSettings(await this.loadData()));
    const _secrets = loadSecretsFile();
    if (this.settings.useEnvKeys !== false) {
      if (_secrets.minimaxApiKey) this.settings.minimaxApiKey = _secrets.minimaxApiKey;
      if (_secrets.pdfMineruApiKey) this.settings.pdfMineruApiKey = _secrets.pdfMineruApiKey;
      if (_secrets.pdfPaddleOcrApiKey) this.settings.pdfPaddleOcrApiKey = _secrets.pdfPaddleOcrApiKey;
      if (_secrets.embeddingApiKey) this.settings.embeddingApiKey = _secrets.embeddingApiKey;
    }
    // v1.1.6: 报告 effective 密钥指纹（绝不是原值），便于诊断"密钥填了但被插件忽略"类问题
    // v1.1.7: 同时初始化 diag.log 文件路径，让没法开 DevTools 的用户也能拿到日志
    // v1.3:   默认写到 vault 之外（~/.eks/logs/diag.log），
    //         避免被 iCloud / OneDrive / Git 等同步工具重复上传/同步。
    //         设置页可切回 vault 内（diagLogInVault: true）。
    try {
      const adapter = this.app.vault && this.app.vault.adapter;
      const path = require('path');
      const fs = require('fs');
      const os = require('os');
      let logPath = null;
      if (this.settings.diagLogInVault && adapter && typeof adapter.getBasePath === 'function') {
        logPath = path.join(adapter.getBasePath(), '.obsidian', 'plugins', 'engineering-knowledge-slicer', 'diag.log');
      } else {
        // vault 之外：~/.eks/logs/diag.log
        const logDir = path.join(os.homedir(), '.eks', 'logs');
        try { fs.mkdirSync(logDir, { recursive: true }); } catch (_) { /* 已存在或不可写就退化到 console */ }
        logPath = path.join(logDir, 'diag.log');
      }
      // v1.1.9: logPath 现在是 globalThis.__eksDiag.state 上的共享变量
      globalThis.__eksDiag.state.logPath = logPath;
      diag('onload.diagLogPath', { path: logPath, inVault: !!this.settings.diagLogInVault });
    } catch (e) { /* 取不到路径就退化到 console only */ try { diag('onload.diagLogPath.error', { message: String(e && e.message || e) }); } catch (_) {} }
    diag('onload.keys.effective', {
      useEnvKeys: this.settings.useEnvKeys,
      minimaxApiKey: this.settings.minimaxApiKey ? keyFingerprint(this.settings.minimaxApiKey) : '<empty>',
      pdfMineruApiKey: this.settings.pdfMineruApiKey ? keyFingerprint(this.settings.pdfMineruApiKey) : '<empty>',
      pdfPaddleOcrApiKey: this.settings.pdfPaddleOcrApiKey ? keyFingerprint(this.settings.pdfPaddleOcrApiKey) : '<empty>',
      minimaxEndpoint: this.settings.minimaxEndpoint,
      pdfMineruApiEndpoint: this.settings.pdfMineruApiEndpoint,
      pdfPaddleOcrApiEndpoint: this.settings.pdfPaddleOcrApiEndpoint
    });
    // v1.3: 注册上传确认桥接，供闭包模块（external-pdf.js）弹上传确认弹窗
    setEksUploadConfirm(this);
    // 密钥注入后再写盘，确保 data.json 不会因为顺序问题而清掉 secrets
    await this.saveSafeSettings();
    this.rateLimiter = new RateLimiter({
      intervalMs: this.settings.rateLimitMs || 1000,
      maxConcurrent: this.settings.rateLimitMaxConcurrent || 2,
      backoffMaxMs: Number(this.settings.rateLimitBackoffMaxMs || 30000),
      windowSize: Number(this.settings.rateLimitWindowSize || 10)
    });
    // Provider queues are intentionally independent: slow OCR polling must never
    // consume MiniMax capacity, and cancellation is handled by each queue.
    this.providerLimiters = {
      minimax: this.rateLimiter,
      mineru: new RateLimiter({ intervalMs: Number(this.settings.mineruRateLimitMs || 1000), maxConcurrent: Number(this.settings.mineruMaxConcurrent || 2) }),
      paddleocr: new RateLimiter({ intervalMs: Number(this.settings.paddleOcrRateLimitMs || 1000), maxConcurrent: Number(this.settings.paddleOcrMaxConcurrent || 2) })
    };
    this.autoProcessing = false;
    this.pauseRequested = false;
    this.cancelRequestedTaskId = '';
    this.taskControllers = new Map();
    this.activeTaskRuns = new Map();
    this.taskLeaseOwner = `session-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    this._tasksFlushTail = Promise.resolve();
    this.structuredWriterLock = {
      tail: Promise.resolve(),
      acquire: async () => {
        let release;
        const next = new Promise((resolve) => { release = resolve; });
        const previous = this.structuredWriterLock.tail;
        this.structuredWriterLock.tail = previous.then(() => next);
        await previous;
        return release;
      }
    };
    this._terminalTaskIds = new Set();
    this.componentCache = new Map();
    this.operationCounters = { apiRequests: 0, aiRetries: 0, summaryReduceRequests: 0, promptCharacters: 0, outputCharacters: 0, bytesRead: 0, bytesWritten: 0, ledgerWrites: 0, artifactWrites: 0, uiFullRenders: 0, uiIncrementalRefreshes: 0, ocrPages: 0, ocrCacheHits: 0, ocrCacheMisses: 0, ocrLowConfidenceBlocks: 0 };
    this.sessionStats = { scanned: 0, processed: 0, written: 0, review: 0, failed: 0, skipped: 0, current: '', lastMessage: '等待开始处理' };
    this.semanticProcessor = new SemanticPostProcessor({
      settings: this.settings,
      fetch: typeof fetch === 'function' ? fetch.bind(globalThis) : null,
      readState: (name) => this.readSemanticState(name),
      writeState: (name, value) => this.writeSemanticState(name, value),
      diagnostics: (stage, event) => {
        this.operationCounters.semanticFailures = Number(this.operationCounters.semanticFailures || 0) + (event?.ok === false ? 1 : 0);
        diag(`semantic.${stage}`, event);
      },
      env: typeof process === 'object' && process?.env ? process.env : {}
    });
    await this.semanticProcessor.load().catch((error) => diag('semantic.load', { ok: false, code: error?.code || 'SEM_STATE_READ' }));
    this.registerView(VIEW_TYPE_SLICER, (leaf) => new SlicerDashboardView(leaf, this));

    this.addRibbonIcon('layers', '工程知识切片', () => this.activateView());
    this.addCommand({ id: 'open-slicer-dashboard', name: '打开工程知识切片控制台', callback: () => this.activateView() });
    this.addCommand({ id: 'scan-source-files', name: '扫描源文件', callback: () => this.scanSourceFiles(true) });
    this.addCommand({ id: 'process-next-source-file', name: '处理下一个队列文件', callback: () => this.processNextQueuedTask() });
    this.addCommand({ id: 'auto-process-source-files', name: '自动处理可信卡片', callback: () => this.autoProcessQueue(true) });
    this.addCommand({ id: 'retry-failed-source-files', name: '重试失败任务并自动处理', callback: () => this.retryFailedAndAutoProcess(true) });
    this.addCommand({ id: 'rollback-last-batch', name: '回滚最近一批卡片', callback: () => this.rollbackLastBatch() });
    this.addCommand({ id: 'open-ai-settings', name: '打开工程知识切片密钥设置', callback: () => this.openPluginSettings() });
    this.addCommand({ id: 'run-shadow-evaluation', name: '运行本地影子评估', callback: () => this.runShadowEvaluation() });
    this.addCommand({ id: 'export-shadow-evaluation', name: '导出影子评估诊断报告', callback: () => this.exportShadowReport() });
    this.addCommand({ id: 'run-semantic-shadow', name: '运行语义影子处理', callback: () => this.runSemanticIndex() });
    this.addCommand({ id: 'rebuild-semantic-index', name: '重建语义向量索引', callback: () => this.rebuildSemanticIndex() });
    this.addCommand({ id: 'revalidate-latest-task-local', name: '本地重新归并、校验并路由最近任务（零模型调用）', callback: () => this.revalidateLatestTaskLocal() });

    this.registerEvent(this.app.workspace.on('file-menu', (menu, file) => {
      if (!(file instanceof TFile)) return;
      menu.addItem((item) => item
        .setTitle('用工程知识切片处理')
        .setIcon('layers')
        .onClick(() => this.processSingleFile(file)));
      menu.addItem((item) => item
        .setTitle('查看切片处理历史')
        .setIcon('history')
        .onClick(() => this.showHistoryForFile(file)));
    }));

    // v2.9.0: 会话级失败缓存清理 + 中断任务续传询问。
    //   注册在 autoScan 之前：失败记录先清掉，续传询问先弹出；
    //   用户选择「继续」后 autoProcessQueue 与自动扫描由 autoProcessing 锁串行，不会打架。
    this.app.workspace.onLayoutReady(() => {
      this.sessionStartupCleanup().catch((error) => {
        try { diag('startup.cleanup.error', { message: String(error && error.message || error) }); } catch (_) {}
      });
    });

    // v2.8: 自动扫描改为设置项，默认关闭。
    //   只有 autoScanOnStartup === true 时才在工作区布局就绪后自动扫描源文件目录
    //   （扫描完按既有逻辑进入自动处理）；默认关闭状态下插件启动不读源文件、
    //   不触发云端解析与 MiniMax 调用，用户需手动点「扫描并自动处理」或用命令。
    if (this.settings.autoScanOnStartup === true) {
      this.app.workspace.onLayoutReady(() => {
        diag('autoScan.start', { reason: 'autoScanOnStartup=true' });
        this.scanSourceFiles(true).catch((error) => {
          try { diag('autoScan.error', { message: String(error && error.message || error) }); } catch (_) {}
        });
      });
    }

    this.addSettingTab(new SlicerSettingTab(this.app, this));
    // v1.1.7: 通知用户诊断日志文件位置（首次加载时显示一次，之后静默）
    // v1.1.9: 通知版本也跟进，避免旧用户重复弹窗同时提醒现在 diag 对所有路径都能写入
    try {
      const prev = await this.loadData();
      const notified = prev && prev.__diagLogNotifiedVersion === '1.1.9';
      const logPath = globalThis.__eksDiag && globalThis.__eksDiag.state && globalThis.__eksDiag.state.logPath;
      if (!notified && logPath) {
        new Notice(`工程知识切片 诊断日志已启用：${logPath}\n遇到问题时把该文件内容发给我即可定位。`);
        this.settings.__diagLogNotifiedVersion = '1.1.9';
        await this.saveSafeSettings();
      }
    } catch (_) { /* 通知失败不能影响插件加载 */ }
  }

  async runRealObsidianGateProbe() {
    const port = new KnowledgeWritePort(this.app.vault);
    const gateRoot = 'EKS Release Gate';
    const settings = normalizeStructuredSettings(this.settings);
    const base = `${settings.businessRoot}/EKS 发布门/多语言 空格`;
    const runId = `run-real-host-${Date.now()}`;
    const fixtures = [
      ['bi-gate-zh', 'business_item', `${base}/中文/安全检查.md`, '安全检查'],
      ['ck-gate-ja', 'company_knowledge', `${base}/日本語/品質 基準.md`, '品質基準'],
      ['ck-gate-en', 'company_knowledge', `${base}/English Space/Field Note.md`, 'Field Note']
    ];
    const actions = fixtures.map(([record_id, record_kind, path, title]) => {
      const content = `---\nrecord_id: "${record_id}"\nrecord_kind: "${record_kind}"\nsource_document_ids: ["src-real-gate"]\n---\n\n# ${title}\n\n- 归属来源：src-real-gate\n`;
      return { record_id, record_kind, path, content, content_hash: structuredContentHash(content), owner_source_id: 'src-real-gate' };
    });
    const existed = await Promise.all(actions.map(async (action) => ({ path: action.path, content: await port.readIfExists(action.path) })));
    try {
      for (const action of actions) {
        action.prior_content = await port.readIfExists(action.path);
        action.prior_hash = action.prior_content === null ? null : structuredContentHash(action.prior_content);
        action.action = action.prior_hash === action.content_hash ? 'noop' : action.prior_content === null ? 'create' : 'update';
      }
      const plan = { mode: 'structured-write', blocked: false, plan_id: `plan-real-host-${runId}`,
        source_document_id: 'src-real-gate', source_hash: 'real-gate', source_version: this.manifest.version, actions };
      const committed = await commitStructuredPlan(plan, {
        vault: port, lock: this.structuredWriterLock, stateRoot: this.settings.artifactsPath,
        index: emptyStructuredIndex(), logicalTime: new Date().toISOString(), runId, taskId: 'task-real-host',
        targetRoots: { active_tender: settings.activeRoot, business: settings.businessRoot }, saveIndex: async () => {}
      });
      const task = { task_id: 'task-real-host', run_id: runId, semantic_path: 'universal', status: 'writing', result_counts: {} };
      applyVerifiedFacts(task, committed.verified.knowledge_records);
      task.status = task.result_counts.verified === actions.length ? 'written' : 'failed';
      task.terminal_outcome = task.status === 'written' ? 'completed_with_output' : 'failed_no_output';
      const ui = completionUiSnapshot([task], task.task_id);
      const openedPaths = [];
      for (const action of actions) {
        const file = this.app.vault.getAbstractFileByPath(action.path);
        if (!file || file.path !== action.path) throw new Error(`Obsidian 文件对象不可打开：${action.path}`);
        const leaf = this.app.workspace.getLeaf('tab');
        await leaf.openFile(file);
        if (leaf.view?.file?.path !== action.path) throw new Error(`Obsidian 叶片未打开目标文件：${action.path}`);
        openedPaths.push(action.path);
      }
      const second = await Promise.all(actions.map((action) => port.verify(action, committed.transactionId,
        new Date().toISOString(), { runId, targetRoots: { active_tender: settings.activeRoot, business: settings.businessRoot } })));
      const deletedFile = this.app.vault.getAbstractFileByPath(actions[1].path);
      await this.app.vault.delete(deletedFile, true);
      let deletionInvalidated = false;
      try { await port.verify(actions[1], committed.transactionId, new Date().toISOString(),
        { runId, targetRoots: { active_tender: settings.activeRoot, business: settings.businessRoot } }); } catch (_) { deletionInvalidated = true; }
      await port.write(actions[1].path, actions[1].content);
      const rollbackPaths = [`${base}/rollback/partial-a.md`, `${base}/rollback/partial-b.md`];
      const partialCommitted = [];
      let injectedFailureObserved = false;
      try {
        for (const rollbackPath of rollbackPaths) {
          await port.write(rollbackPath, actions[0].content);
          partialCommitted.push(rollbackPath);
        }
        throw new Error('EKS_REAL_GATE_INJECTED_PARTIAL_FAILURE');
      } catch (error) {
        injectedFailureObserved = String(error?.message || error) === 'EKS_REAL_GATE_INJECTED_PARTIAL_FAILURE';
        for (const rollbackPath of partialCommitted.reverse()) {
          const rollbackFile = this.app.vault.getAbstractFileByPath(rollbackPath);
          if (rollbackFile) await this.app.vault.delete(rollbackFile, true);
        }
      }
      const rollbackClean = rollbackPaths.every((path) => !this.app.vault.getAbstractFileByPath(path));
      await port.write(`${gateRoot}/result.json`, JSON.stringify({
        ok: committed.verified.knowledge_records.length === 3 && task.result_counts.verified === 3
          && ui?.counts?.written === 3 && openedPaths.length === 3 && second.length === 3
          && deletionInvalidated && injectedFailureObserved && rollbackClean,
        real_host: true, host_api: 'Obsidian Vault', plugin_version: this.manifest.version,
        production_completion_chain: ['write_plan', 'commit', 'authoritative_manifest', 'task_completion', 'ui_statistics', 'open_each_final_path'],
        visible_openable: committed.verified.knowledge_records.map((item) => item.final_path), opened_paths: openedPaths,
        authoritative_manifest: committed.verified.knowledge_records, path_sets: committed.manifest.path_sets,
        task_status: task.status, terminal_outcome: task.terminal_outcome, ui_written: ui?.counts?.written,
        idempotent_rerun_count: second.length,
        deletion_invalidated: deletionInvalidated, injected_partial_failure_observed: injectedFailureObserved,
        partial_failure_rollback_clean: rollbackClean, rollback_paths: rollbackPaths,
        transaction_id: committed.transactionId, run_id: runId
      }, null, 2));
    } catch (error) {
      for (const prior of existed.reverse()) {
        try {
          const file = this.app.vault.getAbstractFileByPath(prior.path);
          if (prior.content === null && file) await this.app.vault.delete(file, true);
          else if (prior.content !== null) await port.write(prior.path, prior.content);
        } catch (_) {}
      }
      throw error;
    }
  }

  onunload() {
    this.semanticProcessor?.abort();
    for (const controller of this.taskControllers?.values() || []) controller.abort();
    this.taskControllers?.clear();
    // v1.1.7: 卸载前最后 flush 一次，确保所有诊断日志落盘
    try { forceFlushDiag(); } catch (_) {}
    // v1.6 (M-04): 卸载前 flush pending tasks，避免防抖窗口内的写丢失
    try { this.flushSaveTasksImmediate(); } catch (_) {}
    this.app.workspace.detachLeavesOfType(VIEW_TYPE_SLICER);
  }

  async saveSettings() {
    await this.saveSafeSettings();
    this.semanticProcessor?.configure(this.settings);
  }

  semanticStatePath(name) {
    return normalizeVaultPath(`${this.settings.artifactsPath}/semantic/${name}`);
  }

  async readSemanticState(name) {
    const path = this.semanticStatePath(name);
    if (!(await this.app.vault.adapter.exists(path))) return null;
    return JSON.parse(await this.app.vault.adapter.read(path));
  }

  async writeSemanticState(name, value) {
    const folder = normalizeVaultPath(`${this.settings.artifactsPath}/semantic`);
    if (!(await this.app.vault.adapter.exists(folder))) await this.app.vault.adapter.mkdir(folder);
    await this.app.vault.adapter.write(this.semanticStatePath(name), JSON.stringify(value));
  }

  enqueueSemanticCard(card, path) {
    if (!this.semanticProcessor) return;
    this.semanticProcessor.enqueue(Object.assign({}, card, { persisted_path: path })).catch(() => {});
  }

  async runSemanticIndex() {
    const cards = await this.loadExistingCards('');
    const result = await this.semanticProcessor.run(cards);
    new Notice(`语义影子处理完成：${result.processed}，缓存命中 ${result.cacheHits}，失败 ${result.failed}`);
    await this.refreshViews();
    return result;
  }

  async rebuildSemanticIndex() {
    const cards = await this.loadExistingCards('');
    const result = await this.semanticProcessor.rebuild(cards);
    new Notice(`语义索引已重建：${result.processed} 张卡片`);
    await this.refreshViews();
    return result;
  }

  async clearSemanticIndex() {
    await this.semanticProcessor.clear();
    new Notice('语义缓存、索引与影子建议已清空。');
    await this.refreshViews();
  }

  async testSemanticConnection() {
    if (this.settings.semanticConsent !== true) {
      new Notice('请先开启“外部嵌入明确同意”；测试会产生一次外部配额/可能计费请求。');
      return false;
    }
    try {
      const provider = new AliyunBailianQwen37EmbeddingProvider({
        fetch: typeof fetch === 'function' ? fetch.bind(globalThis) : null,
        env: typeof process !== 'undefined' ? process.env : {}
      });
      const vectors = await provider.embed(['Engineering knowledge connection probe.'], this.settings, undefined, { textType: 'document' });
      if (vectors.length !== 1 || vectors[0].length !== 1024 || vectors[0].some((value) => !Number.isFinite(value))) {
        throw Object.assign(new Error('probe validation failed'), { code: 'SEM_DIMENSION' });
      }
      await this.recordServiceTest('semantic', { ok: true, status: 200, code: 'OK' });
      new Notice('阿里云百炼嵌入连接可用（1024 维）。');
      return true;
    } catch (error) {
      const code = String(error?.code || 'SEM_PROVIDER');
      await this.recordServiceTest('semantic', { ok: false, status: 0, code });
      new Notice(`阿里云百炼嵌入连接失败：${code}`);
      return false;
    }
  }

  async testServiceConnection(service) {
    const config = serviceConnectionConfig(service, this.settings);
    diag('testConnection.start', { service, url: config.url, apiKey: config.apiKey ? keyFingerprint(config.apiKey) : '<empty>' });
    if (!config.apiKey) {
      diag('testConnection.noKey', { service, hint: '请确认 ~/.eks-secrets.json 中字段名拼写正确：minimaxApiKey / pdfMineruApiKey / pdfPaddleOcrApiKey' });
      new Notice(`${config.label} 密钥未配置。`);
      return false;
    }
    if (typeof fetch !== 'function') {
      diag('testConnection.noFetch', { service });
      new Notice('当前 Obsidian 环境不支持网络请求。');
      return false;
    }
    try {
      const response = await obsidianRequest(config.url, config.request);
      diag('testConnection.response', {
        service,
        status: response.status,
        ok: response.ok,
        url: config.url
      });
      if (response.status === 401 || response.status === 403) {
        let body = '';
        try { body = String(await response.text() || '').slice(0, 300); } catch (_) { /* 忽略 */ }
        diag('testConnection.auth', {
          service,
          status: response.status,
          serverResponse: body
        });
        throw new Error(`鉴权失败（HTTP ${response.status}）。${body ? '服务端响应：' + body.slice(0, 200) : ''}`);
      }
      if (service === 'minimax' && !response.ok) throw new Error(`HTTP ${response.status}`);
      await this.recordServiceTest(service, { ok: true, status: response.status, code: 'OK' });
      new Notice(`${config.label} 连接可用。`);
      return true;
    } catch (error) {
      diag('testConnection.error', {
        service,
        errorClass: error && error.constructor ? error.constructor.name : typeof error,
        errorMessage: String(error && error.message || error),
        errorStack: String(error && error.stack || '').split('\n').slice(0, 6).join(' | ')
      });
      await this.recordServiceTest(service, { ok: false, status: Number(error?.status || 0), code: classifyServiceTestError(error), message: sanitizeSecret(error.message) });
      new Notice(`${config.label} 连接失败：${sanitizeSecret(error.message)}`);
      return false;
    }
  }

  async recordServiceTest(service, result) {
    this.settings.serviceTestResults = Object.assign({}, this.settings.serviceTestResults || {}, {
      [service]: Object.assign({ testedAt: preciseIsoInstant() }, result)
    });
    await this.saveSafeSettings();
  }

  async activateView() {
    const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_SLICER);
    const leaf = leaves[0] || this.app.workspace.getRightLeaf(false);
    await leaf.setViewState({ type: VIEW_TYPE_SLICER, active: true });
    this.app.workspace.revealLeaf(leaf);
  }

  openPluginSettings() {
    this.app.setting?.open?.();
    this.app.setting?.openTabById?.(this.manifest.id);
  }

  async saveSafeSettings() {
    saveSecretsFile(this.settings);
    await this.saveData(sanitizeSettingsForPersistence(this.settings));
  }

  async refreshViews() {
    this.operationCounters.uiFullRenders += 1;
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_SLICER)) {
      if (leaf.view && leaf.view.render) {
        try {
          await leaf.view.render();
        } catch (error) {
          console.error('工程知识切片界面刷新失败', error);
          new Notice(`工程知识切片界面刷新失败：${error.message}`);
        }
      }
    }
  }

  // v1.1.8: 轻量级进度刷新，只更新进度条 DOM 属性 + 已用时文本
  // 不写盘、不重渲染整个 dashboard，给 1 秒一次心跳用
  // v1.1.9: 加 try/catch 兜底 + null-safe 迭代，避免心跳触发 "object is not iterable" 把插件炸掉
  refreshProgressOnly(task) {
    this.operationCounters.uiIncrementalRefreshes += 1;
    try {
      if (!shouldAcceptIncrementalProgress(task, this._terminalTaskIds)) return;
      if (!this.app || !this.app.workspace || typeof this.app.workspace.getLeavesOfType !== 'function') return;
      const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_SLICER) || [];
      for (const leaf of leaves) {
        if (leaf && leaf.view && typeof leaf.view.refreshProgress === 'function') {
          try { leaf.view.refreshProgress(task); } catch (_) { /* 单个视图失败不影响其他 */ }
        }
      }
    } catch (_) { /* 心跳失败不能炸插件 */ }
  }

  openSettings() {
    const setting = this.app.setting;
    if (!setting) {
      new Notice('当前 Obsidian 没有暴露设置面板接口。请从设置 > 第三方插件 > 工程知识切片进入。');
      return;
    }
    if (typeof setting.open === 'function') setting.open();
    if (typeof setting.openTabById === 'function') setting.openTabById(this.manifest.id);
  }

  async ensureFolders() {
    const pathErrors = validateConfiguredPathSet(this.settings);
    if (pathErrors.length) {
      const error = new Error(`受管目录设置无效（${pathErrors.map((item) => item.key).join('、')}），请在插件设置中修正空路径、根目录或重叠目录。`);
      error.code = 'SETTINGS_PATH_INVALID';
      throw error;
    }
    for (const path of [
      this.settings.bidIntakePath,
      this.settings.businessIntakePath,
      this.settings.bidOutputPath,
      this.settings.businessOutputPath,
      this.settings.artifactsPath,
      this.settings.draftPath,
      this.settings.logPath
    ]) {
      await ensureFolder(this.app, path);
    }
  }

  async scanSourceFiles(showNotice = false) {
    await this.ensureFolders();
    const tasks = await this.loadTasks();
    const files = this.app.vault.getFiles().filter((file) => this.isInIntake(file.path) && !this.isInternalSlicerFile(file.path));
    let added = 0;
    for (const file of files) {
      const buffer = Buffer.from(await this.app.vault.readBinary(file));
      const hash = sourceHash(buffer);
      const existing = tasks.find((task) => task.source_hash === hash && task.library === libraryForPath(file.path, this.settings));
      if (existing) {
        if (existing.source_path !== file.path && !existing.source_aliases.includes(file.path)) existing.source_aliases.push(file.path);
        continue;
      }
      const task = createTaskRecord({
        sourcePath: file.path,
        sourceHash: hash,
        sourceType: detectSourceType(file.path),
        library: libraryForPath(file.path, this.settings),
        versions: runtimeVersions(this.settings)
      });
      if (!isProcessableSource(file.path)) task.status = detectSourceType(file.path) === 'unknown' ? 'skipped' : 'unsupported';
      tasks.push(task);
      added += 1;
    }
    this.sessionStats.scanned += files.length;
    await this.saveTasks(tasks);
    if (showNotice) new Notice(`工程知识切片已扫描 ${files.length} 个文件，新增 ${added} 个任务。开始自动处理。`);
    await this.refreshViews();
    await this.autoProcessQueue(false);
    return { scanned: files.length, added };
  }

  isInIntake(path) {
    // v1.4: 统一用 normalizePathForCompare 入口
    const normalized = normalizePathForCompare(path);
    return [this.settings.bidIntakePath, this.settings.businessIntakePath]
      .some((root) => normalized.startsWith(`${normalizePathForCompare(root)}/`));
  }

  isInternalSlicerFile(path) {
    // v1.4: 统一用 normalizePathForCompare 入口；修复原代码对 draftPath/logPath 不 normalize 的 bug
    const normalized = normalizePathForCompare(path);
    return normalized.startsWith(`${normalizePathForCompare(this.settings.artifactsPath)}/`)
      || normalized.startsWith(`${normalizePathForCompare(this.settings.draftPath)}/`)
      || normalized.startsWith(`${normalizePathForCompare(this.settings.logPath)}/`);
  }

  async processSingleFile(file) {
    await this.ensureFolders();
    const buffer = Buffer.from(await this.app.vault.readBinary(file));
    const tasks = await this.loadTasks();
    const hash = sourceHash(buffer);
    const library = libraryForPath(file.path, this.settings);
    const existing = tasks.find((item) => item.source_hash === hash && item.library === library);
    if (existing) {
      if (!['queued', 'failed'].includes(existing.status)) {
        new Notice(`该文件已有处理记录：${existing.status}。如需重做，请在审核台使用“重新生成”或先清空插件缓存。`);
        await this.activateView();
        return;
      }
      existing.status = 'queued';
      existing.updated_at = new Date().toISOString();
      existing.errors = [];
    } else {
      const task = createTaskRecord({ sourcePath: file.path, sourceHash: hash, sourceType: detectSourceType(file.path), library, versions: runtimeVersions(this.settings) });
      tasks.push(task);
    }
    await this.saveTasks(tasks);
    await this.processTask(existing || tasks.at(-1));
  }

  async processNextQueuedTask() {
    const tasks = await this.loadTasks();
    const task = tasks.find((item) => item.status === 'queued');
    if (!task) {
      new Notice('没有待处理的工程知识切片任务。');
      return;
    }
    await this.processTask(task);
  }

  async autoProcessQueue(showNotice = false) {
    if (this.autoProcessing) {
      if (showNotice) new Notice('自动处理正在运行，请查看处理概览中的实时进度。');
      return { processed: 0, alreadyRunning: true };
    }
    this.autoProcessing = true;
    this.pauseRequested = false;
    let processed = 0;
    try {
      const resumable = await this.loadTasks();
      let resumed = false;
      for (const task of resumable) {
        if (task.status !== 'paused') continue;
        task.status = 'queued';
        task.updated_at = new Date().toISOString();
        resumed = true;
      }
      if (resumed) await this.saveTasks(resumable);
      // A queue run is a stable file-level cohort. Its denominator never shrinks as
      // files finish; retry/resume retains the original ordinal whenever possible.
      const queued = resumable.filter((task) => task.status === 'queued');
      const continuingRun = queued.find((task) => task.queue_run_id && Number(task.queue_total) > 0);
      const queueRunId = continuingRun?.queue_run_id || `queue-${Date.now().toString(36)}`;
      const existingTotal = Number(continuingRun?.queue_total) || 0;
      const existingMaxOrder = Math.max(0, ...queued
        .filter((task) => task.queue_run_id === queueRunId)
        .map((task) => Number(task.queue_order) || 0));
      let nextOrder = existingMaxOrder + 1;
      const newCount = queued.filter((task) => task.queue_run_id !== queueRunId).length;
      const total = Math.max(existingTotal, existingMaxOrder + newCount);
      for (const task of queued) {
        if (task.queue_run_id === queueRunId && Number(task.queue_order) > 0) continue;
        task.queue_run_id = queueRunId;
        task.queue_order = nextOrder++;
        task.queue_total = total;
      }
      if (queued.length) {
        await this.saveTasks(resumable);
        await this.flushSaveTasksImmediate();
      }
      this.sessionStats.lastMessage = '正在自动处理队列';
      while (!this.pauseRequested) {
        const tasks = await this.recoverStaleProcessingTasks(await this.loadTasks());
        const task = tasks.find((item) => item.status === 'queued');
        if (!task) break;
        await this.processTask(task);
        processed += 1;
        if (this.settings.rateLimitMs && !this.pauseRequested) {
          await new Promise(resolve => setTimeout(resolve, this.settings.rateLimitMs));
        }
        if (processed >= 500) {
          this.sessionStats.lastMessage = `已达到本轮 500 个任务上限，剩余任务将在下次运行时继续处理。`;
          if (showNotice) new Notice(`已处理 500 个任务，达到本轮上限。仍有未处理任务，请再次运行「自动处理」继续。`);
          break;
        }
      }
      this.sessionStats.lastMessage = `自动处理完成，本轮处理 ${processed} 个任务`;
      if (showNotice) new Notice(`自动处理完成，本轮处理 ${processed} 个任务。可信卡片已入库，疑问项进入审核台。`);
      return { processed, alreadyRunning: false };
    } finally {
      this.autoProcessing = false;
      this.sessionStats.current = '';
      await this.refreshViews();
    }
  }

  async retryFailedAndAutoProcess(showNotice = false) {
    const tasks = await this.loadTasks();
    let reset = 0;
    for (const task of tasks) {
      if (task.status !== 'failed') continue;
      task.status = 'queued';
      task.updated_at = new Date().toISOString();
      task.errors = [];
      task.review_atom_ids = [];
      reset += 1;
    }
    await this.saveTasks(tasks);
    // saveTasks 是防抖写盘；autoProcessQueue 会立即从磁盘重读账本。
    // 重试入口必须先 flush，否则可能仍读到 failed 状态而跳过刚重新入队的任务。
    await this.flushSaveTasksImmediate();
    this.sessionStats.lastMessage = `已重新入队 ${reset} 个失败任务`;
    if (showNotice) new Notice(`已重新入队 ${reset} 个失败任务，开始自动处理。`);
    await this.refreshViews();
    await this.autoProcessQueue(false);
  }

  async processSelectedTasks(taskIds) {
    for (const taskId of taskIds) {
      const tasks = await this.loadTasks();
      const task = tasks.find((item) => item.task_id === taskId);
      if (task) await this.processTask(task);
    }
  }

  pauseProcessing() {
    this.pauseRequested = true;
    this.sessionStats.lastMessage = '将在当前 API 阶段完成后暂停';
    new Notice('已请求暂停：当前 API 请求完成后保存进度并暂停。');
    this.refreshViews();
  }

  cancelCurrentTask(taskId) {
    this.cancelRequestedTaskId = taskId;
    this.taskControllers?.get(taskId)?.abort();
    this.sessionStats.lastMessage = '正在取消当前任务和等待中的外部请求';
    new Notice('已请求取消：排队、轮询和当前 AI 请求将立即停止。');
    this.refreshViews();
  }

  async rollbackLastBatch() {
    const tasks = await this.loadTasks();
    const candidates = tasks.filter((t) => t.status !== 'rolled_back'
      && (t.structured_transaction_id || ['written', 'archived'].includes(t.status))
      && (t.structured_transaction_id || (t.writtenFiles && t.writtenFiles.length)
        || (t.written_card_ids && t.written_card_ids.length)));
    if (!candidates.length) {
      new Notice('没有可回滚的已入库卡片批次。');
      return;
    }
    const lastBatch = candidates[candidates.length - 1];
    if (lastBatch.status === 'rolled_back') {
      new Notice('最近批次已经回滚；未改动任何文件。');
      return;
    }
    if (lastBatch.structured_transaction_id) {
      const vault = new KnowledgeWritePort(this.app.vault);
      const reference = await this.loadArtifact(lastBatch, 'structured-transaction');
      const manifestPath = normalizeVaultPath(reference?.manifest_path || '');
      const manifestContent = manifestPath ? await vault.readIfExists(manifestPath) : null;
      if (!manifestContent) {
        throw new Error('找不到结构化事务清单，未改动任何文件。');
      }
      const manifest = JSON.parse(manifestContent);
      const indexPath = normalizeVaultPath(`${this.settings.artifactsPath}/structured-writer/id-path-index.v1.json`);
      await rollbackStructuredTransaction(manifest, {
        vault, lock: this.structuredWriterLock, stateRoot: this.settings.artifactsPath,
        saveIndex: (index) => vault.write(indexPath, JSON.stringify(index, null, 2))
      });
      manifest.status = 'rolled_back';
      manifest.rolled_back_at = new Date().toISOString();
      await vault.write(manifestPath, JSON.stringify(manifest, null, 2));
      lastBatch.status = 'rolled_back';
      lastBatch.updated_at = manifest.rolled_back_at;
      lastBatch.terminal_outcome = 'rolled_back';
      lastBatch.result_counts = Object.assign({}, lastBatch.result_counts || {}, {
        written: 0, created: 0, updated: 0, unchanged: 0, knowledge_records: 0, rolled_back: 1
      });
      lastBatch.output_paths = [];
      if (lastBatch.artifacts) delete lastBatch.artifacts.knowledge_records;
      lastBatch.structured_transaction_id = null;
      await this.saveTasks(tasks);
      await this.flushSaveTasksImmediate();
      new Notice('最近结构化文档事务已回滚；原始资料和其他文件未改动。');
      await this.refreshViews();
      return;
    }
    throw Object.assign(new Error('旧版回滚写入旁路已移除；任务必须先迁移到统一结构化事务。'), { code: 'LEGACY_KNOWLEDGE_WRITE_REMOVED' });
    /* istanbul ignore next -- unreachable legacy rollback journal decoder */
    const journal = await this.loadRollbackJournal();
    let entries = journal.filter((row) => row && row.task_id === lastBatch.task_id && row.written_path);
    if (!entries.length) {
      const legacyPaths = new Set((lastBatch.writtenFiles || []).map(normalizeVaultPath).filter(Boolean));
      if (legacyPaths.size) entries = [...legacyPaths].map((written_path) => ({ written_path, previous_content: null, legacy: true }));
      else if ((lastBatch.written_card_ids || []).length) {
        const legacyIds = new Set(lastBatch.written_card_ids);
        entries = (await this.loadExistingCards(''))
          .filter((card) => legacyIds.has(card.card_id))
          .filter((card) => !lastBatch.source_hash || readFrontmatterValue(card.text, 'source_hash') === lastBatch.source_hash)
          .map((card) => ({ written_path: card.path, previous_content: null, legacy_card_id: card.card_id }));
      }
    }
    let restored = 0;
    let deleted = 0;
    for (const entry of entries.slice().reverse()) {
      const filePath = normalizeVaultPath(entry.written_path);
      if (!isSafeCardOutputPath(this.settings, filePath)) continue;
      const file = this.app.vault.getAbstractFileByPath(filePath);
      if (entry.previous_content !== null && entry.previous_content !== undefined) {
        if (file instanceof TFile && await this.app.vault.read(file) === entry.previous_content) continue;
        await writeFile(this.app, filePath, String(entry.previous_content));
        restored += 1;
      } else if (file instanceof TFile) {
        await this.app.vault.trash(file);
        deleted += 1;
      }
    }
    lastBatch.status = 'rolled_back';
    lastBatch.updated_at = new Date().toISOString();
    await this.saveTasks(upsertTask(tasks, lastBatch));
    await this.flushSaveTasksImmediate();
    await this.rebuildKnowledgeIndexes();
    this.sessionStats.lastMessage = `已回滚：恢复 ${restored}，删除新建 ${deleted}`;
    new Notice(`已回滚最近批次：恢复 ${restored} 个覆盖文件，删除 ${deleted} 个新建文件。`);
    await this.refreshViews();
  }

  assertTaskCanContinue(task) {
    if (this.cancelRequestedTaskId === task.task_id) {
      const error = new Error('任务已由使用者取消');
      error.code = 'TASK_CANCELLED';
      throw error;
    }
    if (this.pauseRequested) {
      const error = new Error('任务已由使用者暂停');
      error.code = 'TASK_PAUSED';
      throw error;
    }
  }

  async processTask(task) {
    const taskId = String(task?.task_id || '');
    if (!taskId) throw Object.assign(new Error('任务缺少 task_id，无法执行。'), { code: 'TASK_ID_MISSING' });
    if (!this.activeTaskRuns) this.activeTaskRuns = new Map();
    if (!this.taskLeaseOwner) this.taskLeaseOwner = `session-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    const existingRun = this.activeTaskRuns.get(taskId);
    if (existingRun) {
      this.sessionStats.lastMessage = `任务已在处理中：${task.source_path || taskId}`;
      new Notice('该任务已在处理中，本次重复执行已忽略。');
      return { processed: false, alreadyProcessing: true, taskId, runId: existingRun.runId };
    }
    const run = {
      runId: `run-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`,
      startedAt: new Date().toISOString()
    };
    this.activeTaskRuns.set(taskId, run);
    try {
      return await this._processTaskOwned(task, run);
    } finally {
      if (this.activeTaskRuns.get(taskId) === run) this.activeTaskRuns.delete(taskId);
    }
  }

  async _processTaskOwned(task, executionRun) {
    const tasks = await this.loadTasks();
    const current = tasks.find((item) => item.task_id === task.task_id) || task;
    current.lease = {
      owner: this.taskLeaseOwner,
      run_id: executionRun.runId,
      acquired_at: executionRun.startedAt,
      heartbeat_at: executionRun.startedAt
    };
    current.run_id = current.run_id || executionRun.runId;
    await this.saveTasks(upsertTask(tasks, current));
    await this.flushSaveTasksImmediate();
    this._terminalTaskIds.delete(current.task_id);
    const startedAt = Date.now();
    const counterBaseline = Object.assign({}, this.operationCounters);
    current.diagnostic_started_at = new Date(startedAt).toISOString();
    const taskController = new AbortController();
    this.taskControllers.set(current.task_id, taskController);
    try {
      // v1.1.2: 旧任务 / 第三方写入可能留下 source_path 为空的情况，统一兜底成空字符串
      // 防止后续 readBinary / Notice 拼接时出现 'undefined'/'null' 字面。
      // v1.4: 用 normalizePathForCompare 统一 normalize 顺序
      current.source_path = optionalVaultRelativePath(current.source_path);
      this.sessionStats.current = current.source_path;
      current.errors = [];
      current.review_atom_ids = current.review_atom_ids || [];
      current.written_card_ids = current.written_card_ids || [];
      await this.setTaskProgress(current, '准备处理源文件', { stage: 'start', startedAt: new Date(startedAt).toISOString() });
      let parsePackage = await this.loadArtifact(current, 'parsed');
      if (!current.source_path && parsePackage) {
        current.source_path = optionalVaultRelativePath(parsePackage.source_path);
      }
      if (!current.source_path && !parsePackage) {
        const missingSource = new Error('源文件路径为空，且没有可复用的解析产物。');
        missingSource.code = 'SOURCE_PATH_MISSING';
        throw missingSource;
      }
      if (current.source_path && !isProcessableSource(current.source_path)) {
        current.status = 'unsupported';
        current.updated_at = new Date().toISOString();
        await this.saveTasks(upsertTask(tasks, current));
        this.sessionStats.skipped += 1;
        this.sessionStats.lastMessage = `已跳过暂不支持的文件：${current.source_path}`;
        return;
      }

      if (!parsePackage) {
        current.status = 'parsing';
        await this.setTaskProgress(current, '正在调用文档解析 API', { stage: 'parsing', elapsedMs: Date.now() - startedAt });
        const file = this.app.vault.getAbstractFileByPath(current.source_path);
        if (!(file instanceof TFile)) throw new Error(`未找到源文件：${current.source_path}`);
        const buffer = Buffer.from(await this.app.vault.readBinary(file));
        const extracted = await extractTextFromBuffer(current.source_path, buffer, {
          localTextBlockAdapter: this.settings.localTextBlockAdapterEnabled !== false,
          pdfExtractor: await this.getPdfExtractorConfig(current),
          localMsgAdapter: this.settings.localMsgAdapterEnabled !== false,
          localOoxml: {
            docxEnabled: this.settings.localDocxAdapterEnabled !== false,
            xlsxEnabled: this.settings.localXlsxAdapterEnabled !== false,
            pptxEnabled: this.settings.localPptxAdapterEnabled !== false,
            limits: {
              maxEntries: this.settings.ooxmlMaxEntries,
              maxUncompressedBytes: this.settings.ooxmlMaxUncompressedBytes,
              maxXmlBytes: this.settings.ooxmlMaxXmlBytes,
              maxTextChars: this.settings.ooxmlMaxTextChars
            }
          },
          localPdfInventory: this.settings.localPdfInventoryEnabled !== false,
          blockPacking: this.settings.blockV0PackingEnabled === false ? false : { hardBudget: Math.max(128, Math.floor(Number(this.settings.aiChunkSize || 8000) / 4)) },
          localOcr: {
            enabled: this.settings.localOcrEnabled === true,
            provider: this.settings.localOcrProvider,
            executable: this.settings.localOcrExecutable,
            languages: this.settings.localOcrLanguages,
            concurrency: this.settings.localOcrConcurrency,
            timeoutMs: this.settings.localOcrTimeoutMs,
            qualityThreshold: this.settings.localOcrQualityThreshold
          },
          signal: taskController.signal,
          loadOcrCheckpoint: (key) => this.loadArtifact(current, key),
          saveOcrCheckpoint: (key, value) => this.persistArtifact(current, key, value)
        });
        if (taskController.signal.aborted) throw abortError();
        if (extracted.status === 'ocr_required') {
          current.status = 'needs_review';
          current.errors = [...(current.errors || []), {
            stage: 'parsing', code: extracted.actionable?.code || 'PDF_OCR_PROVIDER_REQUIRED',
            message: extracted.message, retryable: true,
            suggestedAction: '配置本地 OCR provider，或在确认文件合规后明确允许现有远程 PDF 解析。',
            at: new Date().toISOString()
          }];
          await this.persistArtifact(current, 'pdf-inventory', {
            status: 'ocr_required', blocks: extracted.blocks || [], pages: extracted.pageInventory || [],
            actionable: extracted.actionable || {}
          });
          await this.saveTasks(upsertTask(await this.loadTasks(), current));
          this.sessionStats.review += 1;
          this.sessionStats.lastMessage = `扫描件需要 OCR：${current.source_path}`;
          return;
        }
        if (extracted.status === 'review_required' && extracted.parsePackage) {
          parsePackage = upgradeParsePackage(extracted.parsePackage, { sourceHash: current.source_hash });
          current.status = 'needs_review';
          current.review_outcome = {
            kind: 'review_required',
            stage: 'parsing',
            code: String(extracted.code || 'PARSER_REVIEW_REQUIRED'),
            message: String(extracted.message || '解析结果需要人工审核。'),
            retryable: false,
            at: new Date().toISOString()
          };
          current.errors = [];
          await this.persistArtifact(current, 'parsed', parsePackage);
          await this.persistArtifact(current, 'review', {
            version: '1.2', task_id: current.task_id, outcome: current.review_outcome, items: []
          });
          await this.saveTasks(upsertTask(await this.loadTasks(), current));
          this.sessionStats.review += 1;
          this.sessionStats.lastMessage = `解析结果需要审核：${current.source_path}`;
          diag('parser.reviewRequired', {
            taskId: current.task_id, code: current.review_outcome.code,
            parser: parsePackage.parser, blockCount: Array.isArray(parsePackage.blocks) ? parsePackage.blocks.length : 0
          });
          return;
        }
        if (extracted.status !== 'ok' || !extracted.parsePackage) throw new Error(extracted.message || '文档解析 API 未返回可用 Markdown');
        parsePackage = upgradeParsePackage(extracted.parsePackage, { sourceHash: current.source_hash });
        const localOcrMetrics = parsePackage.metadata?.local_ocr?.metrics;
        if (localOcrMetrics) {
          this.operationCounters.ocrPages += Number(localOcrMetrics.pages_completed) || 0;
          this.operationCounters.ocrCacheHits += Number(localOcrMetrics.cache_hits) || 0;
          this.operationCounters.ocrCacheMisses += Number(localOcrMetrics.cache_misses) || 0;
          this.operationCounters.ocrLowConfidenceBlocks += Number(localOcrMetrics.low_confidence_blocks) || 0;
          diag('localOcr.completed', {
            taskId: current.task_id, provider: parsePackage.metadata.local_ocr.provider,
            pages: Number(localOcrMetrics.pages_completed) || 0,
            skippedNative: Number(localOcrMetrics.pages_skipped_native) || 0,
            skippedBlank: Number(localOcrMetrics.pages_skipped_blank) || 0,
            cacheHits: Number(localOcrMetrics.cache_hits) || 0,
            cacheMisses: Number(localOcrMetrics.cache_misses) || 0,
            lowConfidenceBlocks: Number(localOcrMetrics.low_confidence_blocks) || 0
          });
        }
        // v2.9.0: 邮件附件落盘 + 入队切片。只在首次解析执行；
        //   续传时 parsed artifact 已含 emailAttachments（保存路径），跳过本块。
        if (Array.isArray(extracted.attachments) && extracted.attachments.length) {
          const savedAttachments = await this.saveEmailAttachments(current, extracted.attachments);
          if (savedAttachments.length) {
            parsePackage.metadata = Object.assign({}, parsePackage.metadata, {
              emailAttachments: savedAttachments.map((item) => ({ filename: item.filename, path: item.path, size: item.size }))
            });
          }
        }
        current.status = 'parsed';
        await this.persistArtifact(current, 'parsed', parsePackage);
      }

      this.assertTaskCanContinue(current);

      // The legacy card writer is retained only as an isolated test fixture. Every
      // production ingestion uses the canonical writer and verified-record authority.
      const universalProduction = true;
      current.status = 'slicing';
      await this.setTaskProgress(current, universalProduction
        ? '正在生成或恢复统一知识产物'
        : '正在加载运行时组件与路由配置', {
        stage: universalProduction ? 'universal-writer' : 'component-contracts',
        elapsedMs: Date.now() - startedAt
      });
      const contracts = universalProduction ? null : await this.loadRuntimeContracts();
      if (contracts) current.component_contract_hash = contracts.contractHash;
      const tagLibrary = universalProduction ? null : parseTagLibrary(await this.loadTagLibraryText());
      // Legacy mode alone loads card state and executes the card workflow. Universal
      // production starts from the canonical document and has no legacy semantic input.
      const existingCards = universalProduction ? [] : await this.loadExistingCards(
        current.regeneration_mode ? '' : current.source_hash
      );
      // v1.1.8: 启动心跳，1 秒一次更新已用时 / 进度条，避免 18 分钟黑屏
      const heartbeat = startProgressHeartbeat(this, current, startedAt);
      diag('heartbeat.start', { sourcePath: current.source_path, intervalMs: 1000 });
      let workflow = null;
      try {
        if (!universalProduction) workflow = await runKnowledgeWorkflow({
        parsePackage,
        folderMap: contracts.folderMap,
        schemas: contracts.schemas,
        prompts: contracts.prompts,
        classification: await this.loadArtifact(current, 'classification'),
        summary: await this.loadArtifact(current, 'summary'),
        atomResult: await this.loadArtifact(current, 'atoms'),
        loadTypePrompt: (route) => this.loadComponentText(route.prompt),
        sourceHash: current.source_hash,
        maxChunkChars: this.settings.aiChunkSize,
        maxPointsPerRequest: this.settings.maxPointsPerRequest,
        summaryConcurrency: this.settings.summaryConcurrency,
        atomizationConcurrency: this.settings.atomizationConcurrency,
        shortDocumentMaxCards: this.settings.shortDocumentMaxCards,
        autoApproveConfidenceThreshold: this.settings.autoApproveConfidenceThreshold,
        chunkOverlapRatio: this.settings.chunkOverlapRatio,
        coalesceTinyChunks: this.settings.coalesceTinyChunks,
        loadSummaryMapChunk: (chunk) => this.loadArtifact(current, `summary-map-${chunk.stableChunkId || chunk.chunk_id}`),
        saveSummaryMapChunk: (chunk, value) => this.persistArtifact(current, `summary-map-${chunk.stableChunkId || chunk.chunk_id}`, value),
        loadSummaryReduceChunk: (checkpoint) => this.loadArtifact(current, `summary-reduce-${checkpoint.stableReduceId}`),
        saveSummaryReduceChunk: (checkpoint, value) => this.persistArtifact(current, `summary-reduce-${checkpoint.stableReduceId}`, value),
        loadAtomBatch: (batch) => this.loadArtifact(current, `atom-batch-${batch.stableBatchId}`),
        saveAtomBatch: (batch, value) => this.persistArtifact(current, `atom-batch-${batch.stableBatchId}`, value),
        versions: runtimeVersions(this.settings),
        businessTimeZone: resolveRuntimeTimeZone(this.settings.businessTimeZone),
        existingCards,
        existingFingerprints: existingCards.map((card) => card.atom_fingerprint).filter(Boolean),
        validateLabels: (atom) => validateAtomLabels(tagLibrary, atom),
        signal: taskController.signal,
        requestJson: (prompt, context) => this.requestMiniMaxProduction(
          prompt, context, { signal: context?.signal || taskController.signal }
        ),
        requestStream: this.settings.useStreamingAi
          ? (prompt, context, hooks) => this.rateLimiter.run(
            async () => {
              this.operationCounters.apiRequests += 1;
              if (Number(context?.attempt) > 1) this.operationCounters.aiRetries += 1;
              if (context?.stage === 'summary-reduce') this.operationCounters.summaryReduceRequests += 1;
              this.operationCounters.promptCharacters += String(prompt || '').length;
              const result = await requestMiniMaxStream({ settings: this.settings, prompt, context, signal: context?.signal || taskController.signal, onDelta: hooks && hooks.onDelta, onProgressText: hooks && hooks.onProgressText });
              this.operationCounters.outputCharacters += typeof result === 'string' ? result.length : JSON.stringify(result || {}).length;
              return result;
            },
            { signal: context?.signal || taskController.signal }
          )
          : null,

        onProgress: async (progress) => {
          this.assertTaskCanContinue(current);
          current.status = workflowStatus(progress.stage);
          // v1.1.8: 关键节点（batchComplete 或阶段变化）才走 setTaskProgress（写盘 + 全重渲染），
          // 其他进度回调走轻量级 refreshProgressOnly（只刷进度条 DOM + 已用时文本）
          const isKeyPoint = progress.batchComplete || progress.stage !== current.progress?.stage;
          const merged = Object.assign({}, progress, { elapsedMs: Date.now() - startedAt });
          merged.completedWork = pipelineProgress(current, merged).completedWork;
          current.progress = merged;
          if (isKeyPoint) {
            await this.setTaskProgress(current, progress.message, merged);
          } else {
            this.refreshProgressOnly(current);
          }
        },
        onArtifact: (name, value) => this.persistArtifact(current, name, value)
      });
      } finally {
        clearInterval(heartbeat);
        diag('heartbeat.stop', { sourcePath: current.source_path, totalElapsedMs: Date.now() - startedAt });
      }

      const summaryLink = !universalProduction && current.artifacts.summary_markdown
        ? `[[${current.artifacts.summary_markdown.replace(/\.md$/i, '')}]]`
        : !universalProduction ? `[[${workflow.summary.document_title}]]` : '';
      for (const card of workflow?.accepted || []) card.parent_summary = summaryLink;
      for (const item of workflow?.review || []) {
        item.atom.source.parent_summary = summaryLink;
        item.proposed_card.parent_summary = summaryLink;
      }

      // v2.9.0: 邮件 ↔ 附件双向链接注入（writeAcceptedCard 负责落笔）。
      //   邮件任务：卡片带「关联附件」链接列表；附件任务：卡片带「来源邮件」回链。
      const emailAttachments = parsePackage.metadata && Array.isArray(parsePackage.metadata.emailAttachments)
        ? parsePackage.metadata.emailAttachments : [];
      const attachmentLinks = emailAttachments
        .map((item) => (item && item.filename ? `[[${item.filename}]]` : ''))
        .filter(Boolean);
      const parentSourceLink = current.parent_source_path
        ? `[[${normalizeVaultPath(current.parent_source_path).split('/').pop().replace(/\.[^.]+$/, '')}]]`
        : '';
      if (attachmentLinks.length || parentSourceLink) {
        for (const card of workflow?.accepted || []) {
          if (attachmentLinks.length) card.attachment_links = attachmentLinks;
          if (parentSourceLink) card.parent_source_link = parentSourceLink;
        }
        for (const item of workflow?.review || []) {
          if (attachmentLinks.length) item.proposed_card.attachment_links = attachmentLinks;
          if (parentSourceLink) item.proposed_card.parent_source_link = parentSourceLink;
        }
      }

      const structured = universalProduction
        ? await this.runStructuredWriterPhase(current, parsePackage)
        : { mode: 'legacy', plan: null };
      const structuredWriteMode = structured.mode === 'structured-write';
      const legacyAccepted = workflow?.accepted || [];
      const legacyReview = workflow?.review || [];
      const legacyRejected = workflow?.hardRejected || [];
      current.status = 'writing';
      await this.setTaskProgress(current, structuredWriteMode
        ? `正在提交结构化计划（${structured.plan?.actions?.length || 0} 项）`
        : universalProduction
          ? `正在生成统一结构化计划（${structured.plan?.actions?.length || 0} 项）`
          : `正在写入 ${legacyAccepted.length} 张可信知识卡片`, {
        stage: 'writing', cardCount: universalProduction ? structured.plan?.actions?.length || 0 : legacyAccepted.length,
        reviewCount: universalProduction ? structured.plan?.phase3_handling_groups?.length || 0 : legacyReview.length,
        elapsedMs: Date.now() - startedAt
      });
      if (!structuredWriteMode) {
        for (const card of legacyAccepted) {
          await this.writeAcceptedCard(current, card, workflow.route);
          current.written_card_ids.push(card.card_id);
        }
      }
      const structuredHandlingGroups = [
        ...(structured.plan?.phase3_handling_groups || []).map((item) => Object.assign({ __kind: 'phase3' }, item)),
        ...(structured.plan?.review_groups || []).map((item) => Object.assign({ __kind: 'review' }, item)),
        ...(structured.plan?.conflicts || []).map((item) => Object.assign({ __kind: 'conflict', blocking: true }, item))
      ];
      if (universalProduction || (!universalProduction && (legacyReview.length || legacyRejected.length
        || workflow.documentWarnings.length || workflow.metrics?.hardRejected))
        || structuredHandlingGroups.length) {
        await this.persistArtifact(current, 'review', {
          version: '2.1', semantic_path: universalProduction ? 'universal' : 'legacy',
          task_id: current.task_id, metrics: universalProduction ? structured.universalResult?.telemetry : workflow.metrics,
          documentWarnings: universalProduction ? [] : workflow.documentWarnings,
          items: universalProduction ? [] : legacyReview,
          rejected: universalProduction ? [] : legacyRejected,
          structured_summary: structured.plan?.summary || '',
          structured_handling_groups: structuredHandlingGroups
        });
        current.review_atom_ids = universalProduction
          ? structuredHandlingGroups.map((item, index) => item.decision_id || item.conflict_id || `universal-${index}`)
          : legacyReview.map((item) => item.atom_id);
      }
      if (legacyAccepted.length && !structuredWriteMode) await this.rebuildKnowledgeIndexes();
      const verifiedStructured = structured.transaction?.verified || null;
      const structuredWrites = Number(verifiedStructured?.counts?.knowledge_created || 0)
        + Number(verifiedStructured?.counts?.knowledge_updated || 0);
      const structuredExisting = Number(verifiedStructured?.counts?.knowledge_unchanged || 0);
      const structuredVisible = Number(verifiedStructured?.counts?.knowledge_records || 0);
      const persistedCount = universalProduction ? structuredVisible : current.written_card_ids.length;
      const generatedCount = universalProduction
        ? Number(structured.universalResult?.knowledge_units?.length || 0)
        : Number(workflow.metrics?.generated ?? workflow.atomResult?.atoms?.length ?? 0);
      const hardRejectedCount = universalProduction ? 0
        : Number(workflow.metrics?.hardRejected ?? legacyRejected.length ?? 0);
      current.terminal_outcome = persistedCount > 0
        ? 'completed_with_output'
        : (legacyReview.length || structuredHandlingGroups.length ? 'needs_attention' : 'completed_no_output');
      current.status = persistedCount > 0
        ? (legacyReview.length || structuredHandlingGroups.length ? 'needs_review' : 'written')
        : (legacyReview.length || structuredHandlingGroups.length ? 'needs_review' : 'completed_no_output');
      current.result_counts = {
        generated: generatedCount,
        planned: universalProduction ? (structured.plan?.actions || []).filter((item) => ['business_item', 'company_knowledge'].includes(item.record_kind)).length : generatedCount,
        attempted: universalProduction ? (structured.plan?.actions || []).filter((item) => item.action !== 'noop' && ['business_item', 'company_knowledge'].includes(item.record_kind)).length : legacyAccepted.length,
        committed: structuredVisible,
        verified: structuredVisible,
        written: persistedCount,
        created: Number(verifiedStructured?.counts?.knowledge_created || 0),
        updated: Number(verifiedStructured?.counts?.knowledge_updated || 0),
        unchanged: structuredExisting,
        source_records: Number(verifiedStructured?.counts?.source_records || 0),
        project_records: Number(verifiedStructured?.counts?.project_records || 0),
        knowledge_records: structuredVisible,
        review: universalProduction ? structuredHandlingGroups.length : legacyReview.length,
        hard_rejected: hardRejectedCount,
        structured_commits: structuredWrites
      };
      if (universalProduction) {
        current.semantic_path = 'universal';
        applyVerifiedFacts(current, verifiedStructured?.knowledge_records || []);
      }
      delete current.regeneration_mode;
      current.updated_at = new Date().toISOString();
      current.progress = {
        stage: 'complete',
        message: persistedCount === 0
          ? `处理完成但未写入：生成 ${generatedCount}，写入 0，硬拒绝 ${hardRejectedCount}。请查看按根因分组的诊断并修复来源解析/证据定位后重试。`
          : (structured.plan?.summary
            ? `结构化处理完成：已验证写入 ${structuredVisible} 张知识卡片（新建 ${current.result_counts.created}，更新 ${current.result_counts.updated}，已存在 ${structuredExisting}）。目录：${current.output_paths?.[0]?.split('/').slice(0, -1).join('/') || '-'}；首个文件：${current.output_paths?.[0] || '-'}。`
            : `处理完成：写入 ${persistedCount} 张，异常 ${legacyReview.length} 项`),
        elapsedMs: Date.now() - startedAt,
        at: current.updated_at
      };
      // v1.4 (M-07): 记录 AI 截断标志，dashboard 顶部 banner 与 Notice 会消费
      if (workflow?.truncated) {
        current.truncated = true;
        current.truncated_completed = workflow.truncatedCompleted || 0;
        new Notice(`⚠️ AI 输出超过 8192 token 上限被截断。已成功 ${current.truncated_completed} 个原子。dashboard 顶部有警告。`);
        diag('workflow.truncated', { sourcePath: current.source_path, completed: current.truncated_completed });
      }
      await this.writeTaskLog(current);
      await this.saveTasks(upsertTask(await this.loadTasks(), current));
      // Terminal state is a commit boundary: the review artifact is already durable,
      // and the ledger must become durable before any view reads it.
      this._terminalTaskIds.add(current.task_id);
      await this.flushSaveTasksImmediate();
      await this.transitionCompletionUi(current.task_id);
      diag('performance.task', createStageMetric({
        taskId: current.task_id,
        runId: current.run_id,
        sourceHash: current.source_hash,
        stage: 'workflow',
        stageStartedAt: startedAt,
        stageCompletedAt: Date.now(),
        provider: 'minimax',
        inputCharacters: parsePackage?.markdown?.length || 0,
        outputCharacters: universalProduction ? JSON.stringify(structured.universalResult || {}).length
          : JSON.stringify(workflow.summary || {}).length,
        cardsGenerated: universalProduction ? generatedCount : workflow.metrics?.candidateCards || legacyAccepted.length + legacyReview.length,
        cardsRejected: universalProduction ? 0 : workflow.metrics?.hardRejected || 0,
        candidateCards: universalProduction ? generatedCount : workflow.metrics?.candidateCards,
        autoApproved: universalProduction ? generatedCount - structuredHandlingGroups.length : workflow.metrics?.autoApproved,
        reviewPending: universalProduction ? structuredHandlingGroups.length : workflow.metrics?.reviewPending,
        cardsMerged: universalProduction ? 0 : workflow.metrics?.merged,
        cardsWritten: universalProduction ? structuredVisible : current.written_card_ids.length,
        bytesWritten: universalProduction ? Number(verifiedStructured?.bytes_written || 0) : 0
      }));
      if (!universalProduction) diag('review.routing', {
        before: { generated: (workflow.metrics?.candidateCards || 0) + (workflow.metrics?.merged || 0) },
        after: workflow.metrics,
        reasonHistogram: (workflow.review || []).reduce((histogram, item) => {
          for (const failure of item.validationReport?.hardGateFailures || ['SOFT_CONFIDENCE']) {
            const key = String(failure).replace(/[^A-Z0-9_]/gi, '_').slice(0, 64);
            histogram[key] = (histogram[key] || 0) + 1;
          }
          return histogram;
        }, {}),
        diagnosis: {
          slicingOrEvidence: workflow.review.filter((item) => !item.validationReport?.evidenceFound).length,
          reviewRouting: workflow.review.filter((item) => item.validationReport?.evidenceFound).length
        }
      });
      diag('performance.counters', Object.assign({ taskId: current.task_id, runId: current.run_id }, this.operationCounters));
      this.sessionStats.processed += 1;
      this.sessionStats.review += universalProduction ? structuredHandlingGroups.length : legacyReview.length;
      this.sessionStats.written += universalProduction ? structuredVisible : legacyAccepted.length;
      this.sessionStats.lastMessage = current.progress.message;
      new Notice(current.progress.message);
    } catch (error) {
      if (error.code === 'TASK_PAUSED' || error.code === 'TASK_CANCELLED') {
        current.status = error.code === 'TASK_PAUSED' ? 'paused' : 'cancelled';
        current.updated_at = new Date().toISOString();
        current.progress = { stage: current.status, message: error.message, at: current.updated_at, elapsedMs: Date.now() - startedAt };
        await this.saveTasks(upsertTask(await this.loadTasks(), current));
        this.cancelRequestedTaskId = '';
        return;
      }
      current.status = 'failed';
      current.updated_at = new Date().toISOString();
      if (error?.code === 'STRUCTURED_WRITE_NOT_PERSISTED') {
        current.terminal_outcome = 'failed_no_output';
        current.structured_transaction_id = null;
        current.output_paths = [];
        current.written_card_ids = [];
        current.result_counts = Object.assign({}, current.result_counts || {}, {
          planned: Number(error.details?.planned) || 0,
          attempted: Number(error.details?.attempted) || 0,
          committed: 0,
          verified: 0, written: 0, created: 0, updated: 0, unchanged: 0, knowledge_records: 0
        });
        if (current.artifacts) {
          delete current.artifacts.knowledge_records;
          delete current.artifacts['structured-transaction'];
        }
      }
      const appError = toAppError(error, {
        stage: current.progress?.stage || 'process',
        taskId: current.task_id,
        runId: current.run_id,
        sourcePath: current.source_path,
        version: runtimeVersions(this.settings),
        details: {
          requestCount: Math.max(0, this.operationCounters.apiRequests - Number(counterBaseline.apiRequests || 0)),
          retryCount: Math.max(0, this.operationCounters.aiRetries - Number(counterBaseline.aiRetries || 0)),
          inputCharacters: Math.max(0, this.operationCounters.promptCharacters - Number(counterBaseline.promptCharacters || 0)),
          estimatedInputTokens: Math.ceil(Math.max(0, this.operationCounters.promptCharacters - Number(counterBaseline.promptCharacters || 0)) / 3),
          outputCharacters: Math.max(0, this.operationCounters.outputCharacters - Number(counterBaseline.outputCharacters || 0)),
          estimatedOutputTokens: Math.ceil(Math.max(0, this.operationCounters.outputCharacters - Number(counterBaseline.outputCharacters || 0)) / 3),
          causalChain: errorCausalChain(error),
          progress: current.progress ? {
            stage: current.progress.stage,
            batchIndex: current.progress.batchIndex,
            batchTotal: current.progress.batchTotal,
            chunkIndex: current.progress.chunkIndex,
            chunkTotal: current.progress.chunkTotal,
            at: current.progress.at,
            elapsedMs: current.progress.elapsedMs
          } : null
        },
        diagnosticMode: this.settings.diagnosticMode === true
      });
      current.errors = [...(current.errors || []), appError.toJSON()];
      current.diagnostic_counters = Object.fromEntries(Object.entries(this.operationCounters).map(([key, value]) => [
        key, Math.max(0, Number(value) - Number(counterBaseline[key] || 0))
      ]));
      current.diagnostic_terminal = {
        ledgerPersisted: false,
        errorArtifactPersisted: false,
        uiTransition: 'pending'
      };
      diag('performance.task', createStageMetric({
        taskId: current.task_id,
        runId: current.run_id,
        sourceHash: current.source_hash,
        stage: appError.stage,
        stageStartedAt: startedAt,
        stageCompletedAt: Date.now(),
        provider: appError.provider,
        errorCode: appError.code
      }));
      const failedStage = appError.stage;
      current.progress = null;
      await this.writeTaskLog(current);
      await this.persistArtifact(current, 'error', appError.toJSON());
      current.diagnostic_terminal.errorArtifactPersisted = true;
      await this.saveTasks(upsertTask(await this.loadTasks(), current));
      // Failure is terminal only after both the error artifact and ledger are durable.
      // From this point stale heartbeats/progress callbacks must be ignored.
      this._terminalTaskIds.add(current.task_id);
      await this.flushSaveTasksImmediate();
      current.diagnostic_terminal.ledgerPersisted = true;
      try {
        const transitioned = await this.transitionFailureUi(current.task_id);
        current.diagnostic_terminal.uiTransition = transitioned ? 'errors-visible' : 'no-dashboard';
      } catch (_) {
        current.diagnostic_terminal.uiTransition = 'failed';
      }
      diag('processTask.failed', {
        taskId: current.task_id,
        runId: current.run_id,
        sourceHash: String(current.source_hash || '').slice(0, 24),
        stage: failedStage,
        errorClass: error && error.constructor ? error.constructor.name : typeof error,
        error: sanitizeForLog(appError.toJSON())
      });
      try {
        await this.persistDiagnosticReport(current);
      } catch (diagnosticError) {
        try { diag('diagnostic.report.failed', { taskId: current.task_id, message: String(diagnosticError?.message || diagnosticError) }); } catch (_) {}
      }
      this.sessionStats.failed += 1;
      this.sessionStats.lastMessage = `处理失败：${current.source_path}`;
      // v1.1.6: 更明确的 Notice（带阶段名），避免错误被截图渲染误导
      new Notice(`${appError.message} · ${appError.suggestedAction}`);
    } finally {
      current.lease = null;
      try {
        await this.saveTasks(upsertTask(await this.loadTasks(), current));
        await this.flushSaveTasksImmediate();
      } catch (leaseError) {
        try { diag('task.lease.release.failed', { taskId: current.task_id, message: String(leaseError?.message || leaseError) }); } catch (_) {}
      }
      if (this.taskControllers.get(current.task_id) === taskController) this.taskControllers.delete(current.task_id);
      await this.refreshViews();
    }
  }

  async requestMiniMaxProduction(prompt, context = {}, options = {}) {
    const signal = options.signal || context.signal;
    return this.providerLimiters.minimax.run(async () => {
      this.operationCounters.apiRequests += 1;
      if (Number(context.attempt) > 1) this.operationCounters.aiRetries += 1;
      if (context.stage === 'summary-reduce') this.operationCounters.summaryReduceRequests += 1;
      this.operationCounters.promptCharacters += String(prompt || '').length;
      try {
        const result = await requestMiniMaxJson({
          settings: this.settings, prompt, context, fetchImpl: obsidianRequest, signal
        });
        this.operationCounters.outputCharacters += typeof result === 'string'
          ? result.length : JSON.stringify(result || {}).length;
        return result;
      } catch (error) {
        error.provider = error.provider || 'minimax';
        error.stage = error.stage || context.stage || 'ai-provider';
        error.details = Object.assign({}, error.details || {}, {
          provider: 'minimax', operation: context.operation || context.stage || 'request'
        });
        throw error;
      }
    }, { signal });
  }

  shadowStorePath() {
    return normalizeVaultPath(`${this.settings.logPath}/${this.settings.shadowStoreFileName || 'shadow-evaluation.json'}`);
  }

  async loadShadowStore() {
    const file = this.app.vault.getAbstractFileByPath(this.shadowStorePath());
    if (!(file instanceof TFile)) return migrateShadowStore({});
    try { return migrateShadowStore(JSON.parse(await this.app.vault.read(file))); } catch (_) { return migrateShadowStore({}); }
  }

  async saveShadowStore(store) {
    const bounded = boundedShadowStore(store, {
      retentionDays: this.settings.shadowRetentionDays,
      maxDocuments: this.settings.shadowSampleLimit
    });
    await writeFile(this.app, this.shadowStorePath(), JSON.stringify(bounded, null, 2));
    return bounded;
  }

  async runShadowEvaluation(taskIds = null) {
    if (this.settings.shadowEvaluationEnabled !== true) {
      new Notice('影子评估默认关闭。请先在设置中明确启用。');
      return null;
    }
    if (this._shadowRunning) {
      new Notice('影子评估已在运行。');
      return null;
    }
    const tasks = await this.loadTasks();
    for (const task of tasks) {
      const parsed = await this.loadArtifact(task, 'parsed');
      const file = this.app.vault.getAbstractFileByPath(task.source_path);
      task.shadow_metadata = {
        parser: parsed?.parser || 'not-parsed',
        size_bytes: Number(file?.stat?.size) || 0,
        language: parsed?.metadata?.language || detectMetricLanguage(parsed?.markdown)
      };
    }
    const requested = Array.isArray(taskIds) && taskIds.length
      ? tasks.filter((task) => taskIds.includes(task.task_id))
      : selectShadowCohort(tasks, { limit: this.settings.shadowCohortLimit, seed: this.settings.shadowCohortSeed });
    if (!requested.length) {
      new Notice('没有可评估的任务。请先扫描源文件。');
      return null;
    }
    this._shadowRunning = true;
    this._shadowController = new AbortController();
    const store = await this.loadShadowStore();
    const runId = `shadow-${Date.now().toString(36)}`;
    let remainingBudget = Math.max(0, Number(this.settings.shadowProviderBudget) || 0);
    try {
      for (const task of requested) {
        if (this._shadowController.signal.aborted) break;
        const metric = await this.evaluateShadowTask(task, {
          runId,
          signal: this._shadowController.signal,
          getRemainingBudget: () => remainingBudget,
          consumeBudget: () => { remainingBudget -= 1; }
        });
        store.runs.push(metric);
        await this.saveShadowStore(store);
      }
      await this.refreshViews();
      const report = await this.shadowReport();
      new Notice(`影子评估完成：${report.aggregate.documents} 条保留样本，本次剩余 provider 预算 ${remainingBudget}。`);
      return report;
    } finally {
      this._shadowRunning = false;
      this._shadowController = null;
    }
  }

  cancelShadowEvaluation() {
    this._shadowController?.abort();
  }

  async evaluateShadowTask(task, options) {
    const started = Date.now();
    const timings = {};
    const cache = {};
    const reasons = [];
    let parsePackage = null;
    let workflow = null;
    let sizeBytes = 0;
    let outcome = 'completed';
    const shadowTask = Object.assign({}, task, { artifacts: Object.assign({}, task.artifacts || {}) });
    const loadCheckpoint = async (name) => {
      const normal = await this.loadArtifact(task, name);
      if (normal) { cache.checkpointHits = (cache.checkpointHits || 0) + 1; return normal; }
      const shadow = await this.loadArtifact(shadowTask, `shadow-${name}`);
      if (shadow) cache.checkpointHits = (cache.checkpointHits || 0) + 1;
      return shadow;
    };
    const saveCheckpoint = (name, value) => this.persistShadowArtifact(shadowTask, `shadow-${name}`, value);
    const counterBaseline = Object.assign({}, this.operationCounters);
    try {
      parsePackage = await this.loadArtifact(task, 'parsed');
      cache.parseHit = Boolean(parsePackage);
      if (!parsePackage) {
        const parseStarted = Date.now();
        const file = this.app.vault.getAbstractFileByPath(task.source_path);
        if (!(file instanceof TFile)) { reasons.push('SOURCE_MISSING'); outcome = 'review'; }
        else {
          const buffer = Buffer.from(await this.app.vault.readBinary(file));
          sizeBytes = buffer.length;
          const extracted = await extractTextFromBuffer(task.source_path, buffer, {
            localTextBlockAdapter: this.settings.localTextBlockAdapterEnabled !== false,
            pdfExtractor: { enabled: false, allowExternalUpload: false, confirmUploads: true },
            localMsgAdapter: this.settings.localMsgAdapterEnabled !== false,
            localOoxml: {
              docxEnabled: this.settings.localDocxAdapterEnabled !== false,
              xlsxEnabled: this.settings.localXlsxAdapterEnabled !== false,
              pptxEnabled: this.settings.localPptxAdapterEnabled !== false,
              limits: {
                maxEntries: this.settings.ooxmlMaxEntries, maxUncompressedBytes: this.settings.ooxmlMaxUncompressedBytes,
                maxXmlBytes: this.settings.ooxmlMaxXmlBytes, maxTextChars: this.settings.ooxmlMaxTextChars
              }
            },
            localPdfInventory: this.settings.localPdfInventoryEnabled !== false,
            blockPacking: this.settings.blockV0PackingEnabled === false ? false : { hardBudget: Math.max(128, Math.floor(Number(this.settings.aiChunkSize || 8000) / 4)) },
            localOcr: {
              enabled: this.settings.localOcrEnabled === true, provider: this.settings.localOcrProvider,
              executable: this.settings.localOcrExecutable, languages: this.settings.localOcrLanguages,
              concurrency: this.settings.localOcrConcurrency, timeoutMs: this.settings.localOcrTimeoutMs,
              qualityThreshold: this.settings.localOcrQualityThreshold
            },
            signal: options.signal,
            loadOcrCheckpoint: (key) => loadCheckpoint(key),
            saveOcrCheckpoint: (key, value) => saveCheckpoint(key, value)
          });
          if (extracted.status === 'ok' && extracted.parsePackage) {
            parsePackage = upgradeParsePackage(extracted.parsePackage, { sourceHash: task.source_hash });
            await saveCheckpoint('parsed', parsePackage);
          } else {
            reasons.push(extracted.status === 'ocr_required' ? 'OCR_REQUIRED' : 'PARSER_REVIEW_REQUIRED');
            outcome = 'review';
          }
        }
        timings.parsing = Date.now() - parseStarted;
      } else {
        const file = this.app.vault.getAbstractFileByPath(task.source_path);
        sizeBytes = Number(file?.stat?.size) || 0;
      }
      if (parsePackage && outcome === 'completed') {
        const classification = await loadCheckpoint('classification');
        const summary = await loadCheckpoint('summary');
        const atomResult = await loadCheckpoint('atoms');
        cache.classificationHit = Boolean(classification);
        cache.summaryHit = Boolean(summary);
        cache.atomsHit = Boolean(atomResult);
        const workflowStarted = Date.now();
        const contracts = await this.loadRuntimeContracts();
        const tagLibrary = parseTagLibrary(await this.loadTagLibraryText());
        const requestJson = async (prompt, context) => {
          if (options.getRemainingBudget() <= 0) {
            const error = new Error('Shadow provider budget exhausted');
            error.code = 'PROVIDER_BUDGET_EXHAUSTED';
            throw error;
          }
          options.consumeBudget();
          this.operationCounters.apiRequests += 1;
          this.operationCounters.promptCharacters += String(prompt || '').length;
          const result = await requestMiniMaxJson({ settings: this.settings, prompt, context, fetchImpl: obsidianRequest, signal: options.signal });
          this.operationCounters.outputCharacters += JSON.stringify(result || {}).length;
          return result;
        };
        workflow = await runKnowledgeWorkflow({
          parsePackage, folderMap: contracts.folderMap, schemas: contracts.schemas, prompts: contracts.prompts,
          classification, summary, atomResult, loadTypePrompt: (route) => this.loadComponentText(route.prompt),
          sourceHash: task.source_hash, maxChunkChars: this.settings.aiChunkSize,
          maxPointsPerRequest: this.settings.maxPointsPerRequest, summaryConcurrency: this.settings.summaryConcurrency,
          atomizationConcurrency: this.settings.atomizationConcurrency, shortDocumentMaxCards: this.settings.shortDocumentMaxCards,
          autoApproveConfidenceThreshold: this.settings.autoApproveConfidenceThreshold,
          chunkOverlapRatio: this.settings.chunkOverlapRatio, coalesceTinyChunks: this.settings.coalesceTinyChunks,
          loadSummaryMapChunk: (chunk) => loadCheckpoint(`summary-map-${chunk.stableChunkId || chunk.chunk_id}`),
          saveSummaryMapChunk: (chunk, value) => saveCheckpoint(`summary-map-${chunk.stableChunkId || chunk.chunk_id}`, value),
          loadSummaryReduceChunk: (checkpoint) => loadCheckpoint(`summary-reduce-${checkpoint.stableReduceId}`),
          saveSummaryReduceChunk: (checkpoint, value) => saveCheckpoint(`summary-reduce-${checkpoint.stableReduceId}`, value),
          loadAtomBatch: (batch) => loadCheckpoint(`atom-batch-${batch.stableBatchId}`),
          saveAtomBatch: (batch, value) => saveCheckpoint(`atom-batch-${batch.stableBatchId}`, value),
          versions: runtimeVersions(this.settings), businessTimeZone: resolveRuntimeTimeZone(this.settings.businessTimeZone),
          existingCards: [], existingFingerprints: [], validateLabels: (atom) => validateAtomLabels(tagLibrary, atom),
          signal: options.signal, requestJson, requestStream: null,
          onArtifact: (name, value) => saveCheckpoint(name, value)
        });
        timings.workflow = Date.now() - workflowStarted;
      }
    } catch (error) {
      if (error?.name === 'AbortError' || options.signal.aborted) { reasons.push('CANCELLED'); outcome = 'cancelled'; }
      else if (error?.code === 'PROVIDER_BUDGET_EXHAUSTED') { reasons.push('PROVIDER_BUDGET_EXHAUSTED'); outcome = 'review'; }
      else { reasons.push('INTERNAL'); outcome = 'failed'; }
    }
    timings.total = Date.now() - started;
    const counters = Object.fromEntries(Object.entries(this.operationCounters).map(([key, value]) => [key, Math.max(0, Number(value) - Number(counterBaseline[key] || 0))]));
    return buildShadowDocumentMetric({
      runId: options.runId, sourceHash: task.source_hash, sourceType: task.source_type,
      salt: this.manifest.id, sizeBytes, parsePackage, workflow, cache, timings, counters,
      providerBudget: this.settings.shadowProviderBudget, reasons, outcome,
      language: detectMetricLanguage(parsePackage?.markdown), resumable: true
    });
  }

  async shadowReport() {
    const store = await this.loadShadowStore();
    const aggregate = aggregateShadowRuns(store.runs);
    const baseline = store.baselines.at(-1);
    return {
      schema_version: SHADOW_SCHEMA_VERSION,
      generated_at: new Date().toISOString(),
      aggregate,
      comparison: baseline ? compareShadowAggregates(aggregate, baseline.aggregate) : null,
      documents: store.runs
    };
  }

  async saveShadowBaseline() {
    const store = await this.loadShadowStore();
    const aggregate = aggregateShadowRuns(store.runs);
    store.baselines.push({
      baseline_id: `baseline-${Date.now().toString(36)}`,
      created_at: new Date().toISOString(),
      plugin_version: this.manifest.version,
      pipeline_version: this.settings.pipelineVersion,
      aggregate
    });
    await this.saveShadowStore(store);
    new Notice('当前影子评估聚合结果已保存为基线。');
  }

  async exportShadowReport() {
    const report = await this.shadowReport();
    const { dialog } = require('electron');
    const choice = await dialog.showSaveDialog({
      title: '导出影子评估诊断报告',
      defaultPath: `eks-shadow-evaluation-${new Date().toISOString().slice(0, 10)}.json`,
      filters: [{ name: 'JSON', extensions: ['json'] }, { name: 'Markdown', extensions: ['md'] }]
    });
    if (choice.canceled || !choice.filePath) return;
    const fs = require('fs');
    const content = /\.md$/i.test(choice.filePath) ? renderShadowMarkdown(report) : JSON.stringify(report, null, 2);
    fs.writeFileSync(choice.filePath, content, { encoding: 'utf8', mode: 0o600 });
    new Notice('影子评估报告已在本地导出。');
  }

  async transitionCompletionUi(taskId) {
    const tasks = await this.loadTasks();
    const snapshot = completionUiSnapshot(tasks, taskId);
    let outcome = 'no-dashboard';
    const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_SLICER) || [];
    for (const leaf of leaves) {
      const view = leaf?.view;
      if (!view || typeof view.render !== 'function') continue;
      if (snapshot.reviewCount > 0) view.activeSection = 'review';
      await view.render();
      outcome = snapshot.reviewCount > 0 ? 'review-visible' : (snapshot.activeTask ? 'queue-continuing' : 'completed');
    }
    diag('completion.ui.transition', {
      taskId,
      runId: snapshot.runId,
      taskCount: snapshot.taskCount,
      queuedCount: snapshot.queuedCount,
      activeCount: snapshot.activeCount,
      reviewCount: snapshot.reviewCount,
      persistedReviewItemCount: snapshot.persistedReviewItemCount,
      reviewInvariant: snapshot.reviewCount === snapshot.persistedReviewItemCount,
      overallPercent: snapshot.overallPercent,
      outcome
    });
    if (snapshot.reviewCount > 0) {
      new Notice(`处理完成：${snapshot.reviewCount} 项待审核，已在插件控制台的审核区显示。`);
    }
    return snapshot;
  }

  async transitionFailureUi(taskId) {
    const tasks = await this.loadTasks();
    const failed = tasks.find((task) => task.task_id === taskId && task.status === 'failed');
    if (!failed) return null;
    const transitionKey = `${taskId}:${failed.updated_at || ''}`;
    const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_SLICER) || [];
    let transitioned = 0;
    for (const leaf of leaves) {
      const view = leaf?.view;
      if (!view || typeof view.render !== 'function') continue;
      if (view._terminalTransitionKey === transitionKey) continue;
      view._terminalTransitionKey = transitionKey;
      view.activeSection = 'errors';
      view.expandedErrorTaskId = taskId;
      await view.render();
      transitioned += 1;
    }
    diag('failure.ui.transition', { taskId, runId: failed.run_id || '', transitioned });
    return failed;
  }

  async diagnosticArtifactInventory(task) {
    const inventory = [];
    for (const [name, artifactPath] of Object.entries(task?.artifacts || {})) {
      const item = { name, pathHash: sourceHash(String(artifactPath || '')).slice(0, 16), exists: false, validation: 'missing' };
      try {
        const file = this.app.vault.getAbstractFileByPath(artifactPath);
        item.exists = file instanceof TFile;
        if (item.exists && /\.json$/i.test(artifactPath)) {
          const parsed = JSON.parse(await this.app.vault.read(file));
          item.validation = isCurrentArtifactEnvelope(parsed)
            ? (parsed.validationState === 'valid' ? 'valid' : 'invalid-envelope')
            : 'legacy-readable';
        } else if (item.exists) {
          item.validation = 'present';
        }
      } catch (_) {
        item.validation = 'unreadable';
      }
      inventory.push(item);
    }
    return inventory.sort((left, right) => left.name.localeCompare(right.name));
  }

  async createDiagnosticReport(task) {
    const events = globalThis.__eksDiag?.state?.events || [];
    return buildDiagnosticReport({
      task,
      error: task?.errors?.at(-1),
      manifest: this.manifest || {},
      settings: this.settings || {},
      platform: {
        os: typeof process !== 'undefined' ? process.platform : 'unknown',
        arch: typeof process !== 'undefined' ? process.arch : 'unknown',
        node: typeof process !== 'undefined' ? process.versions?.node : '',
        electron: typeof process !== 'undefined' ? process.versions?.electron : '',
        obsidian: this.app?.version || ''
      },
      counters: task?.diagnostic_counters || this.operationCounters,
      events,
      artifacts: await this.diagnosticArtifactInventory(task),
      generatedAt: new Date().toISOString()
    });
  }

  async persistDiagnosticReport(task) {
    const report = await this.createDiagnosticReport(task);
    const path = normalizeVaultPath(`${this.settings.artifactsPath}/${task.run_id}/diagnostic-report.json`);
    await writeFile(this.app, path, boundedDiagnosticJson(report));
    task.artifacts = Object.assign({}, task.artifacts || {}, { diagnostic_report: path });
    await this.saveTasks(upsertTask(await this.loadTasks(), task));
    await this.flushSaveTasksImmediate();
    return report;
  }

  async copyDiagnosticReport(task) {
    try {
      const report = await this.createDiagnosticReport(task);
      const markdown = renderDiagnosticMarkdown(report);
      if (!globalThis.navigator?.clipboard?.writeText) throw new Error('当前环境不支持剪贴板');
      await globalThis.navigator.clipboard.writeText(markdown);
      new Notice('已复制脱敏诊断报告。请把完整内容发送给支持人员；无需发送源文件或 API Key。');
    } catch (error) {
      try { diag('diagnostic.copy.failed', { taskId: task?.task_id, message: String(error?.message || error) }); } catch (_) {}
      new Notice(`复制诊断报告失败：${String(error?.message || error)}`);
    }
  }

  async processTaskLegacy(task) {
    throw Object.assign(new Error('旧版知识写入路径已移除；请将任务重新入队，由统一写入端口处理。'), { code: 'LEGACY_KNOWLEDGE_WRITE_REMOVED' });
    /* istanbul ignore next -- retained only for historical ledger fixture decoding */
    if (typeof process !== 'object' || process?.env?.EKS_ENABLE_NONPRODUCTION_LEGACY !== '1') {
      throw new Error('LEGACY_PIPELINE_DISABLED: production tasks must use processTask');
    }
    const tasks = await this.loadTasks();
    const current = tasks.find((item) => item.taskId === task.taskId) || task;
    try {
      this.sessionStats.current = current.sourcePath;
      current.errors = [];
      current.draftFiles = [];
      current.writtenFiles = [];
      await this.setTaskProgress(current, '准备处理源文件', { stage: 'start' });
      if (!isProcessableSource(current.sourcePath)) {
        current.status = detectSourceType(current.sourcePath) === 'pdf' ? 'needs_ocr' : 'unsupported_media';
        current.updatedAt = new Date().toISOString();
        await this.saveTasks(upsertTask(tasks, current));
        this.sessionStats.skipped += 1;
        this.sessionStats.lastMessage = `已跳过暂不支持文件：${current.sourcePath}`;
        await this.refreshViews();
        return;
      }

      current.status = 'extracting';
      await this.setTaskProgress(current, '正在抽取文本', { stage: 'extracting' });

      const file = this.app.vault.getAbstractFileByPath(current.sourcePath);
      if (!(file instanceof TFile)) throw new Error(`Source file not found: ${current.sourcePath}`);
      const buffer = Buffer.from(await this.app.vault.readBinary(file));
      const extracted = await extractTextFromBuffer(current.sourcePath, buffer, {
        pdfExtractor: await this.getPdfExtractorConfig(current),
        localTextBlockAdapter: this.settings.localTextBlockAdapterEnabled !== false,
        blockPacking: this.settings.blockV0PackingEnabled === false ? false : {
          hardBudget: Math.max(128, Math.floor(Number(this.settings.aiChunkSize || 8000) / 4))
        }
      });
      if (extracted.status !== 'ok') {
        current.status = extracted.status;
        current.errors = [{ stage: 'extract', message: extracted.message || extracted.status, at: new Date().toISOString() }];
        await this.writeTaskLog(current);
        await this.saveTasks(upsertTask(await this.loadTasks(), current));
        if (extracted.status === 'failed') this.sessionStats.failed += 1;
        else this.sessionStats.review += 1;
        this.sessionStats.lastMessage = `抽取失败或需要人工处理：${current.sourcePath}`;
        await this.refreshViews();
        return;
      }

      current.status = 'slicing';
      await this.setTaskProgress(current, '正在准备 AI 切片提示词', { stage: 'slicing' });
      const tagLibraryText = await this.loadTagLibraryText();
      const library = parseTagLibrary(tagLibraryText);
      let cards = null;
      try {
        cards = await draftCardsWithProvider({
          settings: this.settings,
          task: current,
          extracted,
          library,
          tagLibraryText,
          onProgress: (progress) => this.setTaskProgress(current, progress.message, progress)
        });
      } catch (providerError) {
        current.errors = [...(current.errors || []), {
          stage: 'ai-provider',
          message: sanitizeSecret(providerError.message),
          settings: sanitizeSettingsForLog(this.settings),
          at: new Date().toISOString()
        }];
      }
      if (!cards || !cards.length) {
        current.status = 'failed';
        current.errors = [...(current.errors || []), {
          stage: 'ai-slicing',
          message: 'AI 未生成任何知识卡片。请检查 AI Key、模型、提示词或源文件可读性；插件不会再使用本地规则生成单张粗略卡片。',
          at: new Date().toISOString()
        }];
        current.updatedAt = new Date().toISOString();
        await this.writeTaskLog(current);
        await this.saveTasks(upsertTask(await this.loadTasks(), current));
        this.sessionStats.failed += 1;
        this.sessionStats.lastMessage = `AI 未生成卡片：${current.sourcePath}`;
        new Notice('AI 未生成知识卡片，已停止本文件处理。');
        await this.refreshViews();
        return;
      }
      const draftFiles = [];
      const writtenFiles = [];
      await this.setTaskProgress(current, `正在写入 ${cards.length} 张知识卡片`, { stage: 'writing', cardCount: cards.length });
      for (const card of cards) {
        if (!card.Map_Index || card.Map_Index === '[[MOC_待分类]]') {
          card.Map_Index = suggestMapIndex(library, card.Category, card.TagL1, card.TagL2);
        }
        const validation = validateCard(library, card);
        if (!validation.valid) {
          card.Status = '#status/needs_fix';
          card.Validation_Errors = validation.errors;
        }
        const markdown = renderKnowledgeCard(card, { timeZone: this.settings.businessTimeZone });
        const question = this.isQuestionableCard(card, validation);
        if (question) {
          const draftPath = `${this.settings.draftPath}/${safeCardFileName(card.Title, current.sourceHash)}`;
          await writeUnique(this.app, draftPath, markdown);
          draftFiles.push(draftPath);
        } else {
          const approved = approveMarkdownStatus(markdown, approvedStatus(library));
          const folderMap = normalizeFolderMapConfig(await this.loadComponentJson('folder-map.json'));
          const outputPath = await writeUnique(this.app, cardOutputPath(this.settings, folderMap, card, safeCardFileName(card.Title, current.sourceHash)), approved);
          await this.appendRollback({
            task_id: current.task_id, card_id: String(card.card_id || ''),
            written_path: outputPath, previous_content: null, written_at: new Date().toISOString()
          });
          writtenFiles.push(outputPath);
          await this.ensureMocForDraft(approved);
          this.enqueueSemanticCard(card, outputPath);
        }
      }

      current.status = draftFiles.length ? 'needs_review' : 'written';
      current.draftFiles = draftFiles;
      current.writtenFiles = writtenFiles;
      current.updatedAt = new Date().toISOString();
      delete current.progress;
      await this.writeTaskLog(current);
      await this.saveTasks(upsertTask(await this.loadTasks(), current));
      this.sessionStats.processed += 1;
      this.sessionStats.review += draftFiles.length;
      this.sessionStats.written += writtenFiles.length;
      this.sessionStats.lastMessage = `已入库 ${writtenFiles.length} 张，待审核 ${draftFiles.length} 张：${current.sourcePath}`;
      new Notice(`可信卡片已入库 ${writtenFiles.length} 张；疑问项 ${draftFiles.length} 张进入审核台。`);
    } catch (error) {
      current.status = 'failed';
      current.updatedAt = new Date().toISOString();
      current.errors = [{ stage: 'process', message: sanitizeSecret(error.message), at: new Date().toISOString() }];
      await this.writeTaskLog(current);
      await this.saveTasks(upsertTask(await this.loadTasks(), current));
      this.sessionStats.failed += 1;
      this.sessionStats.lastMessage = `处理失败：${current.sourcePath}`;
      new Notice(`工程知识切片处理失败：${error.message}`);
    } finally {
      await this.refreshViews();
    }
  }

  async loadComponentText(relativePath) {
    let normalizedRelative;
    try {
      normalizedRelative = normalizeComponentRelativePath(relativePath);
    } catch (error) {
      diag('component.pathInvalid', {
        code: error.code || 'COMPONENT_PATH_INVALID',
        reason: error.details?.reason || 'invalid_relative_path',
        extension: error.details?.extension || ''
      });
      throw error;
    }
    const path = resolveComponentFilePath(this.settings.componentPackPath, normalizedRelative);
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) {
      const builtIn = !(file instanceof TFolder) && builtInInfrastructureSchema(normalizedRelative);
      if (builtIn) {
        diag('component.builtinFallback', {
          relativePath: builtIn.relativePath,
          builtInVersion: builtIn.version,
          hash: builtIn.hash,
          reason: 'missing'
        });
        return builtIn.text;
      }
      diag('component.cacheMiss', {
        relativePath: normalizedRelative, reason: file instanceof TFolder ? 'directory' : 'not_found'
      });
      throw new ComponentError('COMPONENT_NOT_FOUND', `组件文件不存在：${normalizedRelative}`, {
        reason: file instanceof TFolder ? 'path_is_directory' : 'not_found',
        relativePath: normalizedRelative,
        builtInFallbackAvailable: BUILTIN_INFRASTRUCTURE_SCHEMA_PATHS.includes(normalizedRelative)
      });
    }
    const fingerprint = `${file.stat?.mtime || 0}:${file.stat?.size || 0}`;
    const cached = this.componentCache.get(path);
    if (cached?.fingerprint === fingerprint) {
      diag('component.cacheHit', { relativePath: normalizedRelative });
      return cached.text;
    }
    const text = await this.app.vault.read(file);
    this.componentCache.set(path, { fingerprint, text });
    diag('component.cacheMiss', { relativePath: normalizedRelative, reason: 'read' });
    const builtIn = builtInInfrastructureSchema(normalizedRelative);
    if (builtIn) {
      const installedHash = require('crypto').createHash('sha256').update(text).digest('hex');
      diag('component.schemaDifference', {
        relativePath: normalizedRelative,
        effectiveSource: 'installed-component-pack',
        effectiveHash: installedHash,
        builtInVersion: builtIn.version,
        builtInHash: builtIn.hash,
        differs: installedHash !== builtIn.hash,
        replacementApplied: false
      });
    }
    return text;
  }

  async loadComponentJson(relativePath) {
    const text = await this.loadComponentText(relativePath);
    try { return JSON.parse(text); } catch (error) {
      throw new ComponentError('COMPONENT_CONFIG_INVALID', `组件 JSON 配置无效：${relativePath}`, {
        reason: 'invalid_json',
        relativePath: normalizeComponentRelativePath(relativePath),
        builtInFallbackAvailable: BUILTIN_INFRASTRUCTURE_SCHEMA_PATHS.includes(normalizeComponentRelativePath(relativePath)),
        builtInFallbackApplied: false,
        parseError: String(error.message || '').slice(0, 160)
      });
    }
  }

  async loadRuntimeContracts() {
    const folderMap = normalizeFolderMapConfig(await this.loadComponentJson('folder-map.json'));
    const contracts = {
      folderMap,
      schemas: {
        classification: await this.loadComponentJson('schemas/classification.schema.json'),
        summary: await this.loadComponentJson('schemas/structured-summary.schema.json'),
        atoms: await this.loadComponentJson('schemas/knowledge-atoms.schema.json'),
        blockV0: await this.loadComponentJson('schemas/block-v0.schema.json'),
        parsePackage: await this.loadComponentJson('schemas/parse-package.schema.json')
      },
      prompts: {
        classifier: await this.loadComponentText('提示词/00-类型判定.md'),
        summaryBase: await this.loadComponentText('提示词/01-结构化总结-基础.md'),
        atoms: await this.loadComponentText('提示词/99-知识原子生成.md'),
        typeMapping: await this.loadComponentText('模板/Type Mapping.md'),
        tagLibrary: await this.loadComponentText('Tag_Library.md')
      }
    };
    validateRuntimeContracts(contracts);
    contracts.contractHash = require('crypto').createHash('sha256').update(JSON.stringify({
      folderMap: contracts.folderMap, schemas: contracts.schemas, prompts: contracts.prompts
    })).digest('hex');
    return contracts;
  }

  async loadArtifact(task, name) {
    const path = task.artifacts && task.artifacts[name];
    if (!path) return null;
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) return null;
    try {
      const parsed = JSON.parse(await this.app.vault.read(file));
      // v2.10: 旧产物仍按原格式读取；新产物带输入指纹，只有来源与运行时契约
      // 完全一致才复用，避免 prompt/schema/pipeline 升级后误用旧 AI 结果。
      if (!isCurrentArtifactEnvelope(parsed)) {
        const legacy = normalizeLegacyArtifact(name, parsed);
        if (name === 'parsed' && legacy) {
          // Parsed text may be reused after conservative normalization because it
          // prevents repeated OCR.  Persist a current, fingerprinted envelope now;
          // all AI-derived legacy stages are invalidated and rebuilt downstream.
          const upgraded = upgradeParsePackage(legacy, { sourceHash: task.source_hash });
          await this.persistArtifact(task, 'parsed', upgraded);
          diag('artifact.migrated', {
            taskId: task.task_id, stage: name, from: 'legacy-raw',
            blockCount: upgraded.blocks.length, contractFingerprint: upgraded.parse_contract?.fingerprint
          });
          return upgraded;
        }
        if (name === 'review' && legacy) return migrateReviewArtifact(legacy);
        if (!legacy) {
          diag('artifact.cacheMiss', { taskId: task.task_id, stage: name, reason: 'legacy_unverifiable' });
        } else {
          diag('artifact.cacheMiss', { taskId: task.task_id, stage: name, reason: 'legacy_downstream_invalidated' });
        }
        return null;
      }
      if ((parsed.stage && parsed.stage !== name) || (parsed.validationState && parsed.validationState !== 'valid')) return null;
      if (parsed.inputFingerprint !== this.artifactInputFingerprint(task, name)) {
        diag('artifact.cacheMiss', { taskId: task.task_id, stage: name, reason: 'fingerprint_changed' });
        return null;
      }
      if (name === 'parsed') {
        const upgraded = upgradeParsePackage(parsed.payload, { sourceHash: task.source_hash });
        if (JSON.stringify(upgraded) !== JSON.stringify(parsed.payload)) {
          await this.persistArtifact(task, 'parsed', upgraded);
          diag('artifact.migrated', {
            taskId: task.task_id, stage: name, from: 'current-envelope',
            blockCount: upgraded.blocks.length, contractFingerprint: upgraded.parse_contract?.fingerprint
          });
        } else {
          diag('artifact.cacheHit', { taskId: task.task_id, stage: name });
        }
        return upgraded;
      }
      diag('artifact.cacheHit', { taskId: task.task_id, stage: name });
      return name === 'review' ? migrateReviewArtifact(parsed.payload) : parsed.payload;
    } catch { return null; }
  }

  async loadArtifactPayloadUnchecked(task, name) {
    const path = task.artifacts && task.artifacts[name];
    const file = path && this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) return null;
    const parsed = JSON.parse(await this.app.vault.read(file));
    let payload = parsed && Object.hasOwn(parsed, 'payload') ? parsed.payload : normalizeLegacyArtifact(name, parsed);
    if (name === 'parsed' && payload) {
      const upgraded = upgradeParsePackage(payload, { sourceHash: task.source_hash });
      if (JSON.stringify(upgraded) !== JSON.stringify(payload)) await this.persistArtifact(task, 'parsed', upgraded);
      payload = upgraded;
    }
    return name === 'review' ? migrateReviewArtifact(payload) : payload;
  }

  async revalidateLatestTaskLocal() {
    throw Object.assign(new Error('旧版本地重校验写回已移除；请重新入队以复用检查点并通过统一写入端口。'), { code: 'LEGACY_KNOWLEDGE_WRITE_REMOVED' });
    /* istanbul ignore next -- legacy fixture implementation */
    const beforeRequests = Number(this.operationCounters.apiRequests) || 0;
    const tasks = await this.loadTasks();
    const task = [...tasks].reverse().find((item) => item.artifacts?.parsed && item.artifacts?.summary && item.artifacts?.atoms);
    if (!task) throw new Error('没有同时保留解析、总结和知识原子产物的任务');
    const [parsePackage, classification, summary, atomResult] = await Promise.all([
      this.loadArtifactPayloadUnchecked(task, 'parsed'),
      this.loadArtifactPayloadUnchecked(task, 'classification'),
      this.loadArtifactPayloadUnchecked(task, 'summary'),
      this.loadArtifactPayloadUnchecked(task, 'atoms')
    ]);
    if (!parsePackage || !classification || !summary || !atomResult) throw new Error('现有任务产物不完整，无法零调用重新校验');
    const contracts = await this.loadRuntimeContracts();
    const tagLibrary = parseTagLibrary(await this.loadTagLibraryText());
    const existingCards = await this.loadExistingCards('');
    const forbidProvider = async () => { throw new Error('LOCAL_REVALIDATION_PROVIDER_CALL_FORBIDDEN'); };
    const result = await runKnowledgeWorkflow({
      parsePackage, classification, summary, atomResult,
      folderMap: contracts.folderMap, schemas: contracts.schemas, prompts: contracts.prompts,
      sourceHash: task.source_hash, versions: runtimeVersions(this.settings),
      businessTimeZone: resolveRuntimeTimeZone(this.settings.businessTimeZone),
      shortDocumentMaxCards: this.settings.shortDocumentMaxCards,
      autoApproveConfidenceThreshold: this.settings.autoApproveConfidenceThreshold,
      existingCards, existingFingerprints: existingCards.map((card) => card.atom_fingerprint).filter(Boolean),
      persistedCardIds: task.written_card_ids || [],
      validateLabels: (atom) => validateAtomLabels(tagLibrary, atom),
      requestJson: forbidProvider, requestStream: forbidProvider
    });
    if ((Number(this.operationCounters.apiRequests) || 0) !== beforeRequests) throw new Error('本地重新校验意外触发了模型调用');
    const existingIds = new Set(existingCards.map((item) => item.card_id));
    for (const card of result.accepted) {
      if (!existingIds.has(card.card_id)) {
        await this.writeAcceptedCard(task, card, result.route);
        if (!task.written_card_ids.includes(card.card_id)) task.written_card_ids.push(card.card_id);
        existingIds.add(card.card_id);
      }
    }
    task.component_contract_hash = contracts.contractHash;
    await this.persistArtifact(task, 'atoms', result.atomResult);
    await this.persistArtifact(task, 'review', {
      version: '2.0', task_id: task.task_id, metrics: result.metrics, documentWarnings: result.documentWarnings,
      items: result.review, rejected: result.hardRejected, revalidated_locally_at: new Date().toISOString(), provider_requests: 0
    });
    task.review_atom_ids = result.review.map((item) => item.atom_id);
    task.status = result.review.length ? 'needs_review' : 'written';
    task.updated_at = new Date().toISOString();
    await this.saveTasks(upsertTask(tasks, task));
    new Notice(`本地重新校验完成：新增入库 ${result.accepted.length}，已存在 ${result.alreadyPersisted.length}，待确认 ${result.review.length}，拒绝 ${result.hardRejected.length}；模型调用 0`);
    await this.refreshViews();
    return result;
  }

  async persistArtifact(task, name, value) {
    const path = normalizeVaultPath(`${this.settings.artifactsPath}/${task.run_id}/${name}.json`);
    const envelope = {
      artifactVersion: 3,
      stage: name,
      inputFingerprint: this.artifactInputFingerprint(task, name),
      completedAt: new Date().toISOString(),
      validationState: 'valid',
      payload: value
    };
    const serialized = JSON.stringify(envelope, null, 2);
    await writeFile(this.app, path, serialized);
    this.operationCounters.artifactWrites += 1;
    this.operationCounters.bytesWritten += Buffer.byteLength(serialized);
    task.artifacts = Object.assign({}, task.artifacts || {}, { [name]: path });
    if (name === 'summary') {
      const markdownPath = normalizeVaultPath(`${this.settings.artifactsPath}/${task.run_id}/summary.md`);
      await writeFile(this.app, markdownPath, renderStructuredSummary(value, `[[${task.source_path}]]`));
      task.artifacts.summary_markdown = markdownPath;
    }
    task.updated_at = new Date().toISOString();
    await this.saveTasks(upsertTask(await this.loadTasks(), task));
    return path;
  }

  async persistShadowArtifact(task, name, value) {
    const stableRun = `shadow-${String(task.source_hash || task.task_id || 'unknown').slice(0, 24)}`;
    const path = normalizeVaultPath(`${this.settings.artifactsPath}/_shadow/${stableRun}/${name}.json`);
    const envelope = {
      artifactVersion: 3, stage: name,
      inputFingerprint: this.artifactInputFingerprint(task, name.replace(/^shadow-/, '')),
      completedAt: new Date().toISOString(), validationState: 'valid', payload: value
    };
    await writeFile(this.app, path, JSON.stringify(envelope, null, 2));
    task.artifacts = Object.assign({}, task.artifacts || {}, { [name]: path });
    return path;
  }

  artifactInputFingerprint(task, name) {
    const crypto = require('crypto');
    const fingerprintName = String(name || '').replace(/^shadow-/, '');
    const versions = runtimeVersions(this.settings);
    const parsedScope = {
      fingerprintVersion: 'parsed-input-v2',
      blockContractVersion: 'block_v0',
      parserContractVersion: 'document-parser-v3',
      adapterContractVersions: {
        text: 'local-text-block-v2', ooxml: 'ooxml-block-v2',
        email: 'email-mime-block-v2', pdf: 'pdf-evidence-v2', ocr: 'ocr-provenance-v1'
      },
      pdfExtractionOrder: String(this.settings.pdfExtractionOrder || DEFAULT_SETTINGS.pdfExtractionOrder),
      pdfProviders: {
        mineru: {
          endpoint: String(this.settings.pdfMineruApiEndpoint || 'https://mineru.net/api/v4'),
          model: String(this.settings.pdfMineruApiModel || 'vlm'),
          language: String(this.settings.pdfMineruApiLanguage || 'ch_server'),
          contract: 'mineru-api-v4'
        },
        paddleocr: {
          endpoint: String(this.settings.pdfPaddleOcrApiEndpoint || 'https://paddleocr.aistudio-app.com/api/v2/ocr/jobs'),
          model: String(this.settings.pdfPaddleOcrApiModel || 'PaddleOCR-VL-1.6'),
          language: String(this.settings.pdfPaddleOcrApiLanguage || this.settings.targetLanguage || 'zh'),
          contract: 'paddleocr-jobs-v2'
        }
      },
      localMsgAdapterEnabled: this.settings.localMsgAdapterEnabled !== false,
      localTextBlockAdapterEnabled: this.settings.localTextBlockAdapterEnabled !== false,
      localDocxAdapterEnabled: this.settings.localDocxAdapterEnabled !== false,
      localXlsxAdapterEnabled: this.settings.localXlsxAdapterEnabled !== false,
      localPptxAdapterEnabled: this.settings.localPptxAdapterEnabled !== false,
      localPdfInventoryEnabled: this.settings.localPdfInventoryEnabled !== false,
      blockV0PackingEnabled: this.settings.blockV0PackingEnabled !== false,
      blockPackHardBudget: Math.max(128, Math.floor(Number(this.settings.aiChunkSize || 8000) / 4)),
      ooxmlLimits: [
        this.settings.ooxmlMaxEntries, this.settings.ooxmlMaxUncompressedBytes,
        this.settings.ooxmlMaxXmlBytes, this.settings.ooxmlMaxTextChars
      ],
      localOcr: {
        enabled: this.settings.localOcrEnabled === true,
        provider: this.settings.localOcrProvider,
        executable: this.settings.localOcrExecutable,
        languages: this.settings.localOcrLanguages,
        qualityThreshold: this.settings.localOcrQualityThreshold
      }
    };
    const isPageOcrCheckpoint = fingerprintName.startsWith('ocr-page-');
    const workflowSettings = {
      minimaxModel: this.settings.minimaxModel,
      targetLanguage: this.settings.targetLanguage,
      aiChunkSize: this.settings.aiChunkSize,
      aiMaxChunks: this.settings.aiMaxChunks,
      maxPointsPerRequest: this.settings.maxPointsPerRequest,
      shortDocumentMaxCards: this.settings.shortDocumentMaxCards,
      chunkOverlapRatio: this.settings.chunkOverlapRatio,
      coalesceTinyChunks: this.settings.coalesceTinyChunks,
      maxExcerptLength: this.settings.maxExcerptLength
    };
    const versionScope = fingerprintName === 'parsed' ? parsedScope : isPageOcrCheckpoint
      ? { checkpointContract: 'local-ocr-v1' }
      : Object.assign({}, versions, workflowSettings, { componentContractHash: task.component_contract_hash || '' });
    return crypto.createHash('sha256').update(JSON.stringify({
      sourceHash: task.source_hash || '',
      stage: fingerprintName,
      versions: versionScope,
      parsedInputFingerprint: fingerprintName === 'parsed' || isPageOcrCheckpoint ? '' :
        crypto.createHash('sha256').update(JSON.stringify({ sourceHash: task.source_hash || '', parsedScope })).digest('hex')
    })).digest('hex');
  }

  // v2.9.0: 写入二进制附件。writeUnique 只服务 .md（冲突时加 -N.md 后缀），
  //   附件需要按原扩展名避让冲突，且走 createBinary 保证字节完整。
  async writeUniqueBinary(targetPath, buffer) {
    const normalized = normalizeVaultPath(targetPath);
    const folder = normalized.split('/').slice(0, -1).join('/');
    const fileName = normalized.split('/').pop();
    const dot = fileName.lastIndexOf('.');
    const stem = dot > 0 ? fileName.slice(0, dot) : fileName;
    const ext = dot > 0 ? fileName.slice(dot) : '';
    await ensureFolder(this.app, folder);
    let candidate = normalized;
    let index = 1;
    while (this.app.vault.getAbstractFileByPath(candidate)) {
      candidate = `${folder}/${stem}-${index}${ext}`;
      index += 1;
    }
    const arrayBuffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
    if (typeof this.app.vault.createBinary !== 'function') {
      throw new Error('当前 Obsidian 版本不支持写入二进制附件（缺少 vault.createBinary）。');
    }
    await this.app.vault.createBinary(candidate, arrayBuffer);
    return candidate;
  }

  // v2.9.0: 邮件附件保存 + 入队切片。
  //   保存位置：<邮件所在目录>/_attachments/<邮件名>/ 下，仍在 intake 根内，
  //   重新扫描时按 source_hash 天然去重；可处理类型的附件立即建任务入队，
  //   autoProcessQueue 同轮循环即接管，任务记录携带父邮件链接供双向链接使用。
  async saveEmailAttachments(task, attachments) {
    const sourcePath = normalizeVaultPath(task.source_path || '');
    const dir = sourcePath.includes('/') ? sourcePath.slice(0, sourcePath.lastIndexOf('/')) : '';
    const mailBaseName = (sourcePath.split('/').pop() || 'email').replace(/\.[^.]+$/, '');
    const tasks = await this.loadTasks();
    const saved = [];
    let enqueued = 0;
    for (const attachment of attachments || []) {
      if (!attachment || !attachment.data || !attachment.data.length) continue;
      const fileName = sanitizeAttachmentFileName(attachment.filename || `attachment-${saved.length + 1}`);
      const targetPath = `${dir ? dir + '/' : ''}_attachments/${mailBaseName}/${fileName}`;
      const writtenPath = await this.writeUniqueBinary(targetPath, attachment.data);
      saved.push({
        filename: writtenPath.split('/').pop(),
        path: writtenPath,
        size: attachment.data.length,
        contentType: attachment.contentType || ''
      });
      if (!isProcessableSource(writtenPath)) continue;
      const hash = sourceHash(attachment.data);
      const library = libraryForPath(writtenPath, this.settings);
      const existing = tasks.find((item) => item.source_hash === hash && item.library === library);
      if (existing) continue;
      const attachmentTask = createTaskRecord({
        sourcePath: writtenPath,
        sourceHash: hash,
        sourceType: detectSourceType(writtenPath),
        library,
        versions: runtimeVersions(this.settings)
      });
      attachmentTask.parent_task_id = task.task_id;
      attachmentTask.parent_source_path = task.source_path;
      tasks.push(attachmentTask);
      enqueued += 1;
    }
    if (enqueued) await this.saveTasks(tasks);
    diag('email.attachments', {
      sourcePath: task.source_path,
      count: (attachments || []).length,
      saved: saved.length,
      enqueued,
      files: saved.map((item) => item.path).slice(0, 10)
    });
    return saved;
  }

  async loadExistingFingerprints(excludeSourceHash = '') {
    const roots = [this.settings.bidOutputPath, this.settings.businessOutputPath].map(normalizeVaultPath);
    const fingerprints = [];
    for (const file of this.app.vault.getMarkdownFiles()) {
      if (!roots.some((root) => file.path.startsWith(`${root}/`))) continue;
      const markdown = await this.app.vault.cachedRead(file);
      if (excludeSourceHash && readFrontmatterValue(markdown, 'source_hash') === excludeSourceHash) continue;
      const value = readFrontmatterValue(markdown, 'atom_fingerprint');
      if (value) fingerprints.push(value);
    }
    return fingerprints;
  }

  async loadExistingCards(excludeSourceHash = '') {
    const roots = [this.settings.bidOutputPath, this.settings.businessOutputPath].map(normalizeVaultPath);
    const cards = [];
    for (const file of this.app.vault.getMarkdownFiles()) {
      if (!roots.some((root) => file.path.startsWith(`${root}/`)) || file.basename === '_索引') continue;
      const markdown = await this.app.vault.cachedRead(file);
      const source = readFrontmatterValue(markdown, 'source_hash');
      if (excludeSourceHash && source === excludeSourceHash) continue;
      const cardId = readFrontmatterValue(markdown, 'card_id');
      if (!cardId) continue;
      cards.push({
        card_id: cardId,
        atom_fingerprint: readFrontmatterValue(markdown, 'atom_fingerprint'),
        title: readFrontmatterValue(markdown, 'title') || getMarkdownTitle(markdown),
        Category: readFrontmatterValue(markdown, 'Category'),
        TagL1: readFrontmatterValue(markdown, 'TagL1'),
        TagL2: readFrontmatterValue(markdown, 'TagL2'),
        library: readFrontmatterValue(markdown, 'library') || (file.path.startsWith(this.settings.businessOutputPath) ? 'business' : 'bid'),
        project: readFrontmatterValue(markdown, 'project') || readFrontmatterValue(markdown, 'project_name') || readFrontmatterValue(markdown, 'Project'),
        entities: parseFrontmatterArray(readFrontmatterValue(markdown, 'entities')),
        relations: parseFrontmatterArray(readFrontmatterValue(markdown, 'related_candidates')),
        path: file.path,
        text: markdown.slice(0, 3000)
      });
    }
    return cards;
  }

  async runStructuredWriterPhase(task, parsePackage) {
    // Universal production accepts only canonical source state. Legacy Phase 2/3
    // remains available through its explicit legacy workflow, never as writer input.
    const mode = (typeof process === 'object' && process?.env?.EKS_ENABLE_NONPRODUCTION_PILOT === '1'
      && this.settings.structuredWriterMode === 'structured-pilot') ? 'structured-pilot' : 'structured-write';
    const stateFolder = normalizeVaultPath(`${this.settings.artifactsPath}/structured-writer`);
    const indexPath = normalizeVaultPath(`${stateFolder}/id-path-index.v1.json`);
    const registryPath = normalizeVaultPath(`${stateFolder}/project-registry.v1.json`);
    const readJson = async (rawPath, fallback, kind) => {
      const path = vaultRelativePath(rawPath, 'structured state read');
      if (!(await this.app.vault.adapter.exists(path))) return fallback;
      try { return JSON.parse(await this.app.vault.adapter.read(path)); } catch (error) {
        const stateError = new Error(`结构化${kind === 'index' ? '索引' : '项目登记表'}损坏：${path}。原文件未被修改。`);
        stateError.code = kind === 'index' ? 'STRUCTURED_INDEX_CORRUPT' : 'PROJECT_REGISTRY_CORRUPT';
        stateError.category = 'structured_state';
        stateError.stage = kind === 'index' ? 'structured-state-index-read' : 'structured-state-registry-read';
        stateError.artifactPath = path;
        stateError.details = { phase: 'read', stateKind: kind, parseError: String(error?.message || error) };
        throw stateError;
      }
    };
    const rawIndex = await readJson(indexPath, emptyStructuredIndex(), 'index');
    const { index, discarded: discardedIndexEntries = [] } = validateStructuredIndex(rawIndex);
    if (discardedIndexEntries.length) {
      diag('structuredWriter.indexEntriesDiscarded', {
        count: discardedIndexEntries.length,
        reasons: [...new Set(discardedIndexEntries.map((item) => item.cause))]
      });
    }
    const projectRegistry = await readJson(registryPath, [], 'registry');
    if (!Array.isArray(projectRegistry)) {
      const registryError = new Error('项目登记表格式无效：顶层必须是数组。原文件未被修改。');
      registryError.code = 'PROJECT_REGISTRY_INVALID';
      registryError.category = 'structured_state';
      registryError.stage = 'structured-state-registry-validate';
      registryError.artifactPath = registryPath;
      throw registryError;
    }
    const blocks = Array.isArray(parsePackage?.blocks) ? parsePackage.blocks
      : Array.isArray(parsePackage?.normalized_blocks) ? parsePackage.normalized_blocks : [];
    const metadata = Object.assign({}, parsePackage?.metadata || {});
    if (!metadata.document_role) metadata.document_role = 'source_record';
    const document = {
      source_identity: task.source_identity || task.task_id,
      source_document_id: task.task_id,
      source_path: task.source_path,
      source_hash: task.source_hash,
      source_version: task.source_version || task.parser_fingerprint || '',
      filename: task.source_path?.split('/').pop() || '',
      title: parsePackage?.title || task.source_path?.split('/').pop() || '来源文档',
      source_type: task.source_type,
      media_type: task.source_type,
      ingested_at: task.created_at || task.discovered_at || '1970-01-01T00:00:00.000Z',
      metadata,
      blocks
    };
    const priorUniversal = await this.loadArtifact(task, 'universal-canonical');
    const translationCheckpoint = await this.loadArtifact(task, 'universal-translation-checkpoint');
    let universal = priorUniversal?.document?.source_hash === document.source_hash
      && Array.isArray(priorUniversal?.knowledge_units) ? priorUniversal : null;
    try {
      if (!universal) {
      universal = await runUniversalPipelineMultilingual({
        document,
        existing_tags: [],
        translation_cache: translationCheckpoint?.cache || priorUniversal?.translation_cache || {},
        translation_prompt_version: 'universal-zh-v1',
        model_version: this.settings.minimaxModel || 'configured-provider',
        translate_batch: async (regions, contract) => {
          const prompt = [
            '把以下知识区域准确翻译为简体中文。不得翻译或改变 preserve_exactly 中的身份标识。',
            '精确保留 must/shall/应/必须、should/宜、may/可以、must not/不得 的强度，以及条件和例外。',
            '只返回 schema 指定的 JSON，不得遗漏或添加 region_id。',
            JSON.stringify(contract),
            JSON.stringify({ regions })
          ].join('\n');
          return this.requestMiniMaxProduction(prompt, {
            stage: 'translation',
            operation: 'universal-translation',
            schema: {
              type: 'object', additionalProperties: false, required: ['translations'],
              properties: {
                translations: {
                  type: 'array',
                  items: {
                    type: 'object', additionalProperties: false,
                    required: ['region_id', 'translated_text'],
                    properties: { region_id: { type: 'string' }, translated_text: { type: 'string' } }
                  }
                }
              }
            }
          }, { signal: this.taskControllers?.get(task.task_id)?.signal });
        }
      });
      }
    } catch (error) {
      if (error?.checkpoint) {
        await this.persistArtifact(task, 'universal-translation-checkpoint', {
          schema_version: 'translation-checkpoint/1.0', status: 'retryable_failure',
          output_language: 'zh-CN', ...error.checkpoint
        });
      }
      throw error;
    }
    await this.persistArtifact(task, 'universal-canonical', {
      schema_version: universal.schema_version,
      pipeline_version: universal.pipeline_version,
      document: universal.document,
      profile: universal.profile,
      regions: universal.regions,
      knowledge_units: universal.knowledge_units,
      coverage: universal.coverage,
      review_decisions: universal.review_decisions,
      telemetry: universal.telemetry,
      translation_cache: universal.translation_cache,
      translation_checkpoint: universal.translation_checkpoint,
      cache_key: universal.cache_key
    });
    const priorUniversalReview = await this.loadArtifact(task, 'review');
    const priorDecisions = priorUniversalReview?.semantic_path === 'universal'
      ? (priorUniversalReview.decisions || []) : [];
    for (const decision of priorDecisions.filter((item) => item.action === 'apply_correction')) {
      const targetId = decision.original?.unit_id || decision.original?.knowledge_unit_id || '';
      for (const unit of universal.knowledge_units || []) {
        if (targetId && unit.unit_id !== targetId) continue;
        const correction = decision.correction || {};
        unit.route = Object.assign({}, unit.route || {}, {
          library: correction.library || unit.route?.library,
          category: correction.category || correction.directory_category || unit.route?.category
        });
        if (correction.record_kind) unit.record_kind = correction.record_kind;
      }
    }
    const settings = Object.assign({}, this.settings, {
      controlledWriterEnabled: true,
      structuredWriterMode: mode
    });
    const existingFiles = {};
    const structuredRoots = [
      normalizeVaultPath(this.settings.structuredActiveRoot),
      normalizeVaultPath(this.settings.structuredBusinessRoot)
    ];
    const generatedFiles = this.app.vault.getMarkdownFiles()
      .filter((file) => structuredRoots.some((root) => file.path.startsWith(`${root}/`)))
      .slice(0, Number(this.settings.structuredMaxActions || 300) * 2);
    for (const file of generatedFiles) existingFiles[file.path] = await this.app.vault.read(file);
    let plan = buildStructuredPlan({
      settings, document, projectRegistry, universalResult: universal,
      index, existingFiles, logicalTime: task.created_at || '1970-01-01T00:00:00.000Z'
    });
    for (const action of plan.actions || []) {
      for (const rawPath of [action.path, action.from_path].filter(Boolean)) {
        const path = vaultRelativePath(rawPath, 'structured plan read');
        if (Object.hasOwn(existingFiles, path)) continue;
        existingFiles[path] = await this.app.vault.adapter.exists(path)
          ? await this.app.vault.adapter.read(path) : undefined;
      }
    }
    for (const entry of Object.values(index.records || {})) {
      if (entry?.path && !Object.hasOwn(existingFiles, entry.path)) {
        const path = vaultRelativePath(entry.path, 'structured index record');
        existingFiles[path] = await this.app.vault.adapter.exists(path)
          ? await this.app.vault.adapter.read(path) : undefined;
      }
    }
    plan = buildStructuredPlan({
      settings, document, projectRegistry, universalResult: universal,
      index, existingFiles, logicalTime: task.created_at || '1970-01-01T00:00:00.000Z'
    });
    if (priorDecisions.length) {
      const resolved = priorDecisions.filter((item) => item.action !== 'manual_group');
      const matches = (item, decision) => {
        const original = decision.original || {};
        for (const key of ['decision_id', 'conflict_id', 'group_id', 'record_id', 'unit_id']) {
          if (item?.[key] && original?.[key] && String(item[key]) === String(original[key])) return true;
        }
        return item?.cause && original?.cause && item.cause === original.cause
          && String(item.path || '') === String(original.path || '');
      };
      plan.phase3_handling_groups = (plan.phase3_handling_groups || []).filter((item) => !resolved.some((decision) => matches(item, decision)));
      plan.review_groups = (plan.review_groups || []).filter((item) => !resolved.some((decision) => matches(item, decision)));
      plan.conflicts = (plan.conflicts || []).filter((item) => !resolved.some((decision) => matches(item, decision)));
      const discardedRecordIds = new Set(priorDecisions.filter((item) => item.action === 'discard_group')
        .map((item) => item.original?.record_id).filter(Boolean));
      if (discardedRecordIds.size) plan.actions = (plan.actions || []).filter((item) => !discardedRecordIds.has(item.record_id));
      plan.blocked = plan.phase3_handling_groups.length > 0 || plan.review_groups.length > 0 || plan.conflicts.length > 0;
    }
    await this.persistArtifact(task, 'structured-write-plan', Object.assign({}, plan, {
      actions: plan.actions.map(({ prior_content, content, ...action }) => action)
    }));
    if (mode === 'structured-pilot') return { mode, plan, universalResult: universal };
    if (plan.blocked) return { mode, plan, blocked: true, universalResult: universal };
    const knowledgeActions = (plan.actions || []).filter((action) =>
      ['business_item', 'company_knowledge'].includes(action.record_kind));
    if ((universal.knowledge_units || []).length > 0 && knowledgeActions.length === 0) {
      const error = new Error('已生成知识单元，但结构化计划没有可写入的知识记录；请检查计划冲突、审核组和路由设置。');
      error.code = 'STRUCTURED_NO_KNOWLEDGE_ACTIONS';
      error.stage = 'structured-plan';
      error.details = {
        conflicts: plan.conflicts || [], review_groups: plan.review_groups || [],
        phase3_handling_groups: plan.phase3_handling_groups || [], plan_summary: plan.summary || ''
      };
      throw error;
    }
    const obsidianVault = this.app.vault;
    const vault = new KnowledgeWritePort(obsidianVault);
    const committed = await commitStructuredPlan(plan, {
      vault, lock: this.structuredWriterLock, stateRoot: this.settings.artifactsPath,
      index, logicalTime: new Date().toISOString(), runId: task.run_id, taskId: task.task_id,
      targetRoots: { active_tender: normalizeStructuredSettings(settings).activeRoot,
        business: normalizeStructuredSettings(settings).businessRoot },
      saveIndex: async (next) => vault.write(indexPath, JSON.stringify(next, null, 2))
    });
    await this.persistArtifact(task, 'structured-transaction', {
      transaction_id: committed.transactionId, manifest_path: committed.manifestPath,
      index_revision: committed.index.revision,
      verified_counts: committed.verified.counts,
      knowledge_paths: committed.verified.knowledge_paths
    });
    task.structured_transaction_id = committed.transactionId;
    return { mode, plan, transaction: committed, universalResult: universal };
  }

  async writeAcceptedCard(task, card, route) {
    throw Object.assign(new Error('旧版卡片写入旁路已移除；生产写入必须经过 KnowledgeWritePort。'), { code: 'LEGACY_KNOWLEDGE_WRITE_REMOVED' });
    /* istanbul ignore next -- legacy fixture implementation */
    const path = normalizeVaultPath(`${route.output_folder}/${cardFileName(card)}`);
    const existing = this.app.vault.getAbstractFileByPath(path);
    const previous = existing instanceof TFile ? await this.app.vault.read(existing) : null;
    let markdown = renderKnowledgeCard(card, { timeZone: this.settings.businessTimeZone });
    // v2.9.0: 邮件 ↔ 附件双向链接正文节（frontmatter 结构保持不变）。
    //   附件卡 → 来源邮件；邮件卡 → 关联附件清单。附件文件→卡片方向由
    //   Obsidian 反向链接面板天然提供（二进制文件无法内嵌链接）。
    const attachmentLinks = Array.isArray(card.attachment_links) ? card.attachment_links.filter(Boolean) : [];
    if (attachmentLinks.length) {
      markdown += `\n## 关联附件\n\n${attachmentLinks.map((link) => `- ${link}`).join('\n')}\n`;
    }
    if (card.parent_source_link) {
      markdown += `\n> 来源邮件：${card.parent_source_link}\n`;
    }
    await writeFile(this.app, path, markdown);
    await this.appendRollback({
      task_id: task.task_id,
      card_id: card.card_id,
      written_path: path,
      previous_content: previous,
      written_at: new Date().toISOString()
    });
    await this.ensureFolderIndex(route);
    this.enqueueSemanticCard(card, path);
    return path;
  }

  async ensureFolderIndex(route) {
    const path = folderIndexPath(route);
    if (this.app.vault.getAbstractFileByPath(path)) return path;
    return writeFile(this.app, path, createFolderIndexMarkdown(route));
  }

  async rebuildKnowledgeIndexes() {
    const vault = new KnowledgeWritePort(this.app.vault);
    const cards = await this.loadExistingCards('');
    const { buildKnowledgeIndex, renderProjectAggregation } = __require('src/core/link-service.js');
    const index = buildKnowledgeIndex(cards);
    const indexPath = normalizeVaultPath(`${this.settings.artifactsPath}/knowledge-index.v1.json`);
    await vault.write(indexPath, JSON.stringify(index, null, 2));
    for (const project of index.projects) {
      const root = project.library === 'business' ? this.settings.businessOutputPath : this.settings.bidOutputPath;
      const pagePath = normalizeVaultPath(`${root}/_项目/${sanitizeAttachmentFileName(project.name)}.md`);
      await vault.write(pagePath, renderProjectAggregation(project));
    }
    return index;
  }

  async applyReviewGroup(taskId, groupId, action, correction = {}) {
    const tasks = await this.loadTasks();
    const task = tasks.find((item) => item.task_id === taskId);
    if (!task) throw new Error('未找到审核任务');
    const artifact = await this.loadArtifact(task, 'review');
    if (!artifact) throw new Error('未找到审核产物');
    if (artifact.semantic_path === 'universal') {
      return this.applyUniversalReviewAction(task, artifact, groupId, action, correction);
    }
    const group = groupReviewItems(artifact.items).find((item) => item.group_id === groupId);
    if (!group) throw new Error('未找到审核分组');

    if (action === 'regenerate_group') {
      delete task.artifacts.atoms;
      delete task.artifacts.review;
      for (const name of Object.keys(task.artifacts || {})) {
        if (name.startsWith('atom-batch-')) delete task.artifacts[name];
      }
      task.review_atom_ids = [];
      task.regeneration_mode = 'whole_file_atoms';
      task.status = 'queued';
      task.updated_at = new Date().toISOString();
      await this.saveTasks(upsertTask(tasks, task));
      await this.processTask(task);
      return;
    }

    const selectedIds = new Set(group.items.map((item) => item.atom_id));
    // v1.4 (M-05): apply_correction 必须先过白名单校验
    let safeCorrection = correction;
    if (action === 'apply_correction') {
      safeCorrection = validateCorrection(correction);
    }
    const changed = applyBatchAction(group.items, action, safeCorrection);
    const tagLibrary = await this.loadTagLibrary();
    const folderMap = (await this.loadRuntimeContracts()).folderMap;
    const unresolved = [];
    for (const item of changed) {
      if (item.status === 'discarded') continue;
      if (item.status === 'corrected') {
        item.status = 'pending';
        if (!validateAtomLabels(tagLibrary, item.atom)) {
          item.reasons = ['批量修正后仍未通过标签字典校验'];
        }
        unresolved.push(item);
        continue;
      }
      if (!isApprovalEligible(item)) {
        item.status = 'pending';
        unresolved.push(item);
        continue;
      }
      const route = resolveOutputRoute(this.settings, folderMap, item.atom);
      const card = Object.assign({}, item.proposed_card, {
        Category: item.atom.Category,
        TagL1: item.atom.TagL1,
        TagL2: item.atom.TagL2,
        Info_Type: item.atom.Info_Type,
        Event_Type: item.atom.Event_Type,
        output_folder: route.output_folder,
        status: 'confirmed'
      });
      await this.writeAcceptedCard(task, card, route);
      if (!task.written_card_ids.includes(card.card_id)) task.written_card_ids.push(card.card_id);
    }

    const untouched = artifact.items.filter((item) => !selectedIds.has(item.atom_id));
    artifact.items = [...untouched, ...unresolved];
    await this.persistArtifact(task, 'review', artifact);
    task.review_atom_ids = artifact.items.map((item) => item.atom_id);
    task.status = artifact.items.length ? 'needs_review' : 'written';
    task.updated_at = new Date().toISOString();
    await this.saveTasks(upsertTask(await this.loadTasks(), task));
    new Notice(`批量审核完成：处理 ${group.items.length} 项，剩余 ${artifact.items.length} 项`);
    await this.refreshViews();
  }

  async applyReviewSelection(taskId, groupId, atomIds, action, reviewerReason = '') {
    const tasks = await this.loadTasks();
    const task = tasks.find((item) => item.task_id === taskId);
    if (!task) throw new Error('未找到审核任务');
    const artifact = await this.loadArtifact(task, 'review');
    if (!artifact) throw new Error('未找到审核产物');
    if (artifact.semantic_path === 'universal') {
      throw new Error('UNIVERSAL_REVIEW_SELECTION_MISMATCH: 统一审核不得调用旧卡片逐项处理函数');
    }
    const group = groupReviewItems(artifact.items).find((item) => item.group_id === groupId);
    if (!group) throw new Error('未找到审核分组');
    const selected = new Set(atomIds || []);
    const chosen = group.items.filter((item) => selected.has(item.atom_id));
    if (!chosen.length) throw new Error('请先选择至少一项');
    if (action === 'regenerate_selected') {
      return this.regenerateSelectedReview(task, artifact, chosen);
    }
    if (action === 'approve_selected') {
      const blocked = chosen.filter((item) => !isApprovalEligible(item));
      if (blocked.length) throw new Error(`所选内容中有 ${blocked.length} 项未通过必要检查，不能批准`);
      const folderMap = (await this.loadRuntimeContracts()).folderMap;
      const existingIds = new Set((await this.loadExistingCards('')).map((card) => card.card_id));
      for (const item of chosen) {
        const route = resolveOutputRoute(this.settings, folderMap, item.atom);
        const card = Object.assign({}, item.proposed_card, {
          Category: item.atom?.Category,
          TagL1: item.atom?.TagL1,
          TagL2: item.atom?.TagL2,
          Info_Type: item.atom?.Info_Type,
          Event_Type: item.atom?.Event_Type,
          output_folder: route.output_folder,
          status: 'confirmed'
        });
        if (!existingIds.has(card.card_id)) await this.writeAcceptedCard(task, card, route);
        task.written_card_ids = task.written_card_ids || [];
        if (!task.written_card_ids.includes(card.card_id)) task.written_card_ids.push(card.card_id);
      }
    } else if (!['regenerate_selected', 'reject_selected', 'manual_selected'].includes(action)) {
      throw new Error(`不支持的审核操作：${action}`);
    }
    const now = new Date().toISOString();
    if (action === 'manual_selected') {
      Object.assign(artifact, markManualPending(artifact, chosen.map((item) => item.atom_id), now));
    } else if (action === 'reject_selected') {
      Object.assign(artifact, archiveRejected(artifact, chosen.map((item) => item.atom_id), now));
    } else {
      const handled = new Set(chosen.map((item) => item.atom_id));
      artifact.handled = [...(artifact.handled || []), ...chosen.map((item) => Object.assign({}, item, {
        review_action: action,
        review_action_at: now,
        reviewer_reason: action === 'approve_selected'
          ? String(reviewerReason || '自动检查无未解决阻断差异，用户一键批准').slice(0, 500) : '',
        original_failed_soft_gates: action === 'approve_selected'
          ? (item.validationReport?.hardGateFailures || []).filter((failure) =>
            !(item.validationReport?.nonOverridableFailures || []).includes(failure))
          : []
      }))];
      artifact.items = artifact.items.filter((item) => !handled.has(item.atom_id));
    }
    await this.persistArtifact(task, 'review', artifact);
    task.review_atom_ids = artifact.items.map((item) => item.atom_id);
    task.status = artifact.items.length ? 'needs_review' : 'written';
    task.updated_at = new Date().toISOString();
    await this.saveTasks(upsertTask(await this.loadTasks(), task));
    new Notice(action === 'approve_selected'
      ? `部分批准完成：已入库 ${chosen.length} 项，仍待处理 ${artifact.items.length} 项`
      : action === 'manual_selected'
        ? `已将 ${chosen.length} 项标记为等待人工处理；它们仍保留在待处理列表`
        : `已拒绝并归档 ${chosen.length} 项，仍待处理 ${artifact.items.length} 项`);
    await this.refreshViews();
    return {
      handled: action === 'manual_selected' ? 0 : chosen.length,
      pending: action === 'manual_selected' ? chosen.length : 0,
      remaining: artifact.items.length,
      remainingItems: artifact.items
    };
  }

  async applyUniversalReviewAction(task, artifact, groupId, action, correction = {}) {
    const groups = Array.isArray(artifact.structured_handling_groups) ? artifact.structured_handling_groups : [];
    const index = groups.findIndex((item, position) =>
      String(item.decision_id || item.conflict_id || item.group_id || `universal-${position}`) === String(groupId));
    if (index < 0) throw new Error('未找到统一审核项');
    const group = groups[index];
    const kind = group.__kind || (group.conflict_id || group.cause?.includes('conflict') ? 'conflict' : 'review');
    const hard = kind === 'conflict' || group.hard === true || group.blocking === true;
    const accepted = ['approve_group', 'accept_suggestion'].includes(action);
    if (accepted && hard) throw new Error('硬冲突不能强制批准；请修正规则/路由、重新规划或转人工。');
    if (!['approve_group', 'accept_suggestion', 'discard_group', 'apply_correction', 'regenerate_group', 'manual_group'].includes(action)) {
      throw new Error(`不支持的统一审核操作：${action}`);
    }
    const now = new Date().toISOString();
    if (action === 'regenerate_group') {
      for (const name of ['universal-canonical', 'structured-write-plan', 'review']) delete task.artifacts?.[name];
      task.review_atom_ids = [];
      task.status = 'queued';
      task.updated_at = now;
      await this.saveTasks(upsertTask(await this.loadTasks(), task));
      return this.processTask(task);
    }
    if (action === 'manual_group') {
      group.manual = { status: 'pending_human', at: now, next_step: '由知识管理员修正规则或路由后点击重新规划' };
      await this.persistArtifact(task, 'review', artifact);
      await this.saveTasks(upsertTask(await this.loadTasks(), task));
      await this.refreshViews();
      return { handled: 0, remaining: groups.length };
    }
    const decision = {
      group_id: groupId, action, at: now,
      correction: action === 'apply_correction' ? this.validateUniversalCorrection(correction) : undefined,
      original: group
    };
    artifact.decisions = [...(artifact.decisions || []), decision];
    artifact.structured_handling_groups = groups.filter((_, position) => position !== index);
    await this.persistArtifact(task, 'review', artifact);
    task.review_atom_ids = artifact.structured_handling_groups.map((item, position) =>
      item.decision_id || item.conflict_id || item.group_id || `universal-${position}`);
    task.updated_at = now;
    if (task.review_atom_ids.length) {
      task.status = 'needs_review';
      await this.saveTasks(upsertTask(await this.loadTasks(), task));
      await this.refreshViews();
      return { handled: 1, remaining: task.review_atom_ids.length };
    }
    task.status = action === 'discard_group' ? 'completed_no_output' : 'queued';
    task.terminal_outcome = action === 'discard_group' ? 'completed_no_output' : undefined;
    await this.saveTasks(upsertTask(await this.loadTasks(), task));
    if (task.status === 'queued') return this.processTask(task);
    await this.refreshViews();
    return { handled: 1, remaining: 0 };
  }

  validateUniversalCorrection(correction) {
    if (!correction || typeof correction !== 'object' || Array.isArray(correction)) throw new Error('修正规则必须是 JSON 对象');
    const allowed = new Set(['library', 'category', 'directory_category', 'record_kind', 'route']);
    const clean = {};
    for (const [key, value] of Object.entries(correction)) {
      if (!allowed.has(key) || typeof value !== 'string' || !value.trim() || value.length > 200) throw new Error(`无效的统一路由修正字段：${key}`);
      clean[key] = value.trim();
    }
    if (!Object.keys(clean).length) throw new Error('没有可应用的路由修正');
    return clean;
  }

  async regenerateSelectedReview(task, artifact, chosen) {
    const summary = await this.loadArtifact(task, 'summary');
    const atomResult = await this.loadArtifact(task, 'atoms');
    const classification = await this.loadArtifact(task, 'classification');
    const parsePackage = await this.loadArtifact(task, 'parsed');
    if (!summary || !atomResult || !classification || !parsePackage) {
      throw new Error('缺少原始总结、知识原子或分类检查点，无法安全地只重新生成所选内容。请使用“仅重做知识原子”重做整个文件。');
    }
    const plan = createSelectedRegenerationPlan({
      taskId: task.task_id,
      reviewItems: artifact.items,
      allAtoms: atomResult.atoms,
      selectedAtomIds: chosen.map((item) => item.atom_id),
      summary
    });
    const checkpointName = `selected-regeneration-${plan.request_id}`;
    const now = new Date().toISOString();
    artifact.regeneration_requests = [
      ...(artifact.regeneration_requests || []).filter((item) => item.request_id !== plan.request_id),
      {
        request_id: plan.request_id,
        action: 'regenerate_selected',
        atom_ids: plan.atom_ids,
        point_ids: plan.point_ids,
        status: 'running',
        requested_at: now
      }
    ];
    await this.persistArtifact(task, 'review', artifact);

    const consumed = await consumeSelectedRegeneration({
      loadCheckpoint: () => this.loadArtifact(task, checkpointName),
      saveCheckpoint: (value) => this.persistArtifact(task, checkpointName, value),
      loadExistingCardIds: async () => (await this.loadExistingCards('')).map((card) => card.card_id),
      writeCard: (card, route) => this.writeAcceptedCard(task, card, route),
      generate: async () => {
        const contracts = await this.loadRuntimeContracts();
        const tagLibrary = parseTagLibrary(await this.loadTagLibraryText());
        const existingCards = await this.loadExistingCards('');
        const selectedIds = new Set(plan.atom_ids);
        const untouchedReviewFingerprints = (artifact.items || [])
          .filter((item) => !selectedIds.has(item.atom_id))
          .map((item) => item.proposed_card?.atom_fingerprint)
          .filter(Boolean);
        return runKnowledgeWorkflow({
          parsePackage,
          folderMap: contracts.folderMap,
          schemas: contracts.schemas,
          prompts: contracts.prompts,
          classification,
          summary: plan.selected_summary,
          loadTypePrompt: (route) => this.loadComponentText(route.prompt),
          sourceHash: task.source_hash,
          maxPointsPerRequest: this.settings.maxPointsPerRequest,
          atomizationConcurrency: this.settings.atomizationConcurrency,
          shortDocumentMaxCards: this.settings.shortDocumentMaxCards,
          loadAtomBatch: (batch) => this.loadArtifact(task, `${checkpointName}-batch-${batch.stableBatchId}`),
          saveAtomBatch: (batch, value) => this.persistArtifact(task, `${checkpointName}-batch-${batch.stableBatchId}`, value),
          versions: runtimeVersions(this.settings),
          businessTimeZone: resolveRuntimeTimeZone(this.settings.businessTimeZone),
          existingCards,
          existingFingerprints: [
            ...existingCards.map((card) => card.atom_fingerprint).filter(Boolean),
            ...untouchedReviewFingerprints
          ],
          validateLabels: (atom) => validateAtomLabels(tagLibrary, atom),
          requestJson: (prompt, context) => this.rateLimiter.run(
            () => requestMiniMaxJson({ settings: this.settings, prompt, context, fetchImpl: obsidianRequest }),
            {}
          )
        });
      }
    });
    const result = consumed.result;
    const replaced = new Set(plan.atom_ids);
    const mergedAtomResult = Object.assign({}, atomResult, {
      atoms: [
        ...(atomResult.atoms || []).filter((atom) => !replaced.has(atom.atom_id)),
        ...(result.atomResult?.atoms || [])
      ]
    });
    await this.persistArtifact(task, 'atoms', mergedAtomResult);
    for (const card of result.accepted || []) {
      task.written_card_ids = task.written_card_ids || [];
      if (!task.written_card_ids.includes(card.card_id)) task.written_card_ids.push(card.card_id);
    }
    const merged = mergeSelectedRegenerationResult(artifact, plan, result, new Date().toISOString());
    await this.persistArtifact(task, 'review', merged);
    task.review_atom_ids = merged.items.map((item) => item.atom_id);
    task.status = merged.items.length ? 'needs_review' : 'written';
    task.updated_at = new Date().toISOString();
    await this.saveTasks(upsertTask(await this.loadTasks(), task));
    if (consumed.written.length) await this.rebuildKnowledgeIndexes();
    new Notice(`所选内容已重新生成：新入库 ${consumed.written.length} 项，仍待处理 ${merged.items.length} 项`);
    await this.refreshViews();
    return { handled: chosen.length, remaining: merged.items.length, remainingItems: merged.items, requestId: plan.request_id };
  }

  async approveDraft(taskId, draftPath) {
    throw Object.assign(new Error('旧版草稿直接入库已移除；请重新入队并通过统一审核/写入事务。'), { code: 'LEGACY_KNOWLEDGE_WRITE_REMOVED' });
    /* istanbul ignore next -- legacy fixture implementation */
    const file = this.app.vault.getAbstractFileByPath(draftPath);
    if (!(file instanceof TFile)) throw new Error(`未找到草稿：${draftPath}`);
    const draft = await this.app.vault.read(file);
    const library = await this.loadTagLibrary();
    const finalStatus = approvedStatus(library);
    const finalCard = cardFromMarkdown(draft);
    finalCard.Status = finalStatus;
    const validation = validateCard(library, finalCard);
    if (!validation.valid) {
      new Notice(`草稿标签或字段未通过校验，不能入库：${validation.errors.join('；')}`);
      await this.app.workspace.openLinkText(draftPath, '', false);
      return;
    }
    const approved = approveMarkdownStatus(draft, finalStatus);
    const title = getMarkdownTitle(draft) || file.basename;
    const routeCard = {
      Category: readFrontmatterValue(approved, 'Category'),
      TagL1: readFrontmatterValue(approved, 'TagL1'),
      TagL2: readFrontmatterValue(approved, 'TagL2')
    };
    const folderMap = normalizeFolderMapConfig(await this.loadComponentJson('folder-map.json'));
    const outputPath = await writeUnique(this.app, cardOutputPath(this.settings, folderMap, routeCard, safeCardFileName(title, Date.now().toString(16))), approved);
    await this.appendRollback({
      task_id: taskId, card_id: String(routeCard.card_id || ''),
      written_path: outputPath, previous_content: null, written_at: new Date().toISOString()
    });

    const tasks = await this.loadTasks();
    const task = tasks.find((item) => item.task_id === taskId);
    if (task) {
      task.draftFiles = (task.draftFiles || []).filter((item) => item !== draftPath);
      task.status = task.draftFiles.length ? 'needs_review' : 'written';
      task.updatedAt = new Date().toISOString();
      task.writtenFiles = [...(task.writtenFiles || []), outputPath];
    }
    await this.saveTasks(tasks);
    await this.appendRollback({ taskId, draftPath, writtenPath: outputPath, approvedAt: new Date().toISOString() });
    await this.ensureMocForDraft(approved);
    this.enqueueSemanticCard(finalCard, outputPath);
    new Notice(`已批准入库：${outputPath}`);
    await this.refreshViews();
  }

  isQuestionableCard(card, validation) {
    if (!validation.valid) return true;
    if (card.Status === '#status/needs_fix' || card.Status === '#status/uncategorized') return true;
    if (!card.Map_Index || card.Map_Index === '[[MOC_待分类]]') return true;
    const threshold = Number(this.settings.autoApproveConfidenceThreshold || DEFAULT_SETTINGS.autoApproveConfidenceThreshold || 0.82);
    if (typeof card.Confidence !== 'number' || card.Confidence < threshold) return true;
    if (!card.Source_Excerpt || card.Source_Excerpt.length < 20) return true;
    return false;
  }

  async ensureMocForDraft(markdown) {
    const mapIndex = readFrontmatterValue(markdown, 'Map_Index');
    const category = readFrontmatterValue(markdown, 'Category');
    const tagL1 = readFrontmatterValue(markdown, 'TagL1');
    const tagL2 = readFrontmatterValue(markdown, 'TagL2');
    if (!mapIndex || !category || !tagL1 || !tagL2) return;
    const path = mapIndexToPath(mapIndex, this.settings.outputPath);
    if (this.app.vault.getAbstractFileByPath(path)) return;
    const title = path.split('/').pop().replace(/\.md$/, '');
    await writeUnique(this.app, path, createMocMarkdown({ title, category, tagL1, tagL2, outputPath: this.settings.outputPath }));
  }

  async retryTask(taskId) {
    const tasks = await this.loadTasks();
    const task = tasks.find((item) => item.task_id === taskId);
    if (!task) return;
    task.status = 'queued';
    task.errors = [];
    task.updated_at = new Date().toISOString();
    await this.saveTasks(tasks);
    // processTask 开头会重读账本，确保 queued 状态已对该读取可见。
    await this.flushSaveTasksImmediate();
    await this.processTask(task);
  }

  async skipTask(taskId) {
    const tasks = await this.loadTasks();
    const task = tasks.find((item) => item.task_id === taskId);
    if (!task) return;
    task.status = 'skipped';
    task.updated_at = new Date().toISOString();
    await this.saveTasks(tasks);
    await this.refreshViews();
  }

  // v2.9.0: 审核台失败区块「移除」按钮——从账本删除该记录（源文件不受影响，
  //   下次扫描可重新发现）。失败记录本来也会在重启时被 sessionStartupCleanup 清除。
  async dismissTask(taskId) {
    const tasks = await this.loadTasks();
    const next = tasks.filter((item) => item.task_id !== taskId);
    if (next.length === tasks.length) return;
    await this.saveTasks(next);
    await this.refreshViews();
  }

  async loadTagLibrary() {
    return parseTagLibrary(await this.loadTagLibraryText());
  }

  async loadTagLibraryText() {
    const primaryCandidates = [
      `${this.settings.componentPackPath}/Tag_Library.md`,
      `${this.settings.componentPackPath}/模板/Type Mapping.md`
    ];
    const sections = [];
    for (const candidate of primaryCandidates) {
      const file = this.app.vault.getAbstractFileByPath(candidate);
      if (file instanceof TFile) sections.push(await this.app.vault.read(file));
    }
    if (sections.length) return sections.join('\n\n');
    const fallback = this.app.vault.getAbstractFileByPath('docs/tag-library-full-lifecycle-draft.md');
    return fallback instanceof TFile ? this.app.vault.read(fallback) : '';
  }

  async loadTasks() {
    if (this._pendingSaveDirty && Array.isArray(this._pendingSaveTasks)) {
      return migrateTaskLedgerV3(structuredClone(this._pendingSaveTasks), runtimeVersions(this.settings));
    }
    const path = tasksPath(this.settings);
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) return [];
    try {
      const parsed = JSON.parse(await this.app.vault.read(file));
      if (!Array.isArray(parsed)) throw new Error('账本顶层必须是数组');
      return migrateTaskLedgerV3(parsed, runtimeVersions(this.settings));
    } catch (cause) {
      const error = new Error(`任务账本无法读取：${path}。原文件未被修改，请修复 JSON 或从备份恢复。`);
      error.code = 'TASK_LEDGER_CORRUPT';
      error.category = 'task_ledger';
      error.stage = 'task-ledger-read';
      error.artifactPath = path;
      error.details = { phase: 'read', parseError: String(cause?.message || cause) };
      throw error;
    }
  }

  // v1.6 (M-04): 写盘防抖。setTaskProgress / upsertTask 高频调用 saveTasks，
  //              一次 12 批次原子化可能触发 30+ 次磁盘 IO。改为 500ms 防抖，
  //              关键节点（status 转换 / 错误落库 / onunload）走 flushSaveTasksImmediate 立即落。
  async saveTasks(tasks) {
    const normalized = structuredClone(tasks).map(normalizeTaskForPersistence);
    const invariant = auditTaskInvariants(normalized);
    if (!invariant.ok) {
      const error = new Error(`任务成功事实不变量失败：${JSON.stringify(invariant.results.filter((item) => !item.ok))}`);
      error.code = 'KNOWLEDGE_SUCCESS_INVARIANT_FAILED';
      throw error;
    }
    this._pendingSaveTasks = normalized;
    this._pendingSaveDirty = true;
    if (this._saveTasksTimer) clearTimeout(this._saveTasksTimer);
    this._saveTasksTimer = setTimeout(() => {
      // 异步落盘；调用方 await 的话可以走 flushSaveTasksImmediate
      this._flushSaveTasks().catch((e) => {
        try { diag('tasks.save.flush.error', { message: String(e && e.message || e) }); } catch (_) {}
      });
    }, 500);
    return { scheduled: true, durable: false };
  }

  // v1.6 (M-04): 立即落盘（绕过防抖）。用在 status 转换 / 错误落库 / onunload 等关键节点。
  async flushSaveTasksImmediate() {
    if (this._saveTasksTimer) { clearTimeout(this._saveTasksTimer); this._saveTasksTimer = null; }
    await this._flushSaveTasks();
  }

  async _flushSaveTasks() {
    if (!this._tasksFlushTail) this._tasksFlushTail = Promise.resolve();
    const flush = async () => {
      while (this._pendingSaveDirty) {
        const tasks = this._pendingSaveTasks;
        this._pendingSaveTasks = null;
        this._pendingSaveDirty = false;
        await this.ensureFolders();
        const target = tasksPath(this.settings);
    // v1.4 (M-11): 写盘前备份上一版 tasks.json，便于迁移出错时回退。
    // v2.9.3: 改为单一滚动备份。高频进度落盘若每次创建时间戳文件，
    //         会在 vault / 同步盘持续制造目录项与同步 IO，而恢复只需要上一版。
        if (this.settings.backupTasksOnSave !== false) {
          try {
            const existing = this.app.vault.getAbstractFileByPath(target);
            if (existing instanceof TFile) {
              const backupPath = target.replace(/\.json$/i, '.bak.json');
              const content = await this.app.vault.read(existing);
              await writeFile(this.app, backupPath, content);
            }
          } catch (e) {
            try { diag('tasks.backup.error', { message: String(e && e.message || e) }); } catch (_) {}
          }
        }
        const serialized = JSON.stringify(tasks, null, 2);
        await writeFile(this.app, target, serialized);
        this.operationCounters.ledgerWrites += 1;
        this.operationCounters.bytesWritten += Buffer.byteLength(serialized);
      }
    };
    const result = this._tasksFlushTail.then(flush, flush);
    this._tasksFlushTail = result.catch(() => {});
    return result;
  }

  // v1.4 (M-11): 手动把所有 paused 任务重新入队（dashboard 按钮触发）
  async restorePausedTasks() {
    const tasks = await this.loadTasks();
    let restored = 0;
    for (const task of tasks) {
      if (task.status !== 'paused') continue;
      task.status = 'queued';
      task.errors = (task.errors || []).filter((e) => e?.stage !== 'stale-processing');
      task.updated_at = new Date().toISOString();
      restored += 1;
    }
    if (restored > 0) await this.saveTasks(tasks);
    await this.refreshViews();
    return restored;
  }

  // v2.9.0: 会话级失败缓存 + 启动续传。每次启动执行一次：
  //   1) 失败任务只在上一次会话内展示（审核工作台），重启后从账本清除——
  //      因此 dashboard 的「失败」统计与审核台失败块天然只反映本次会话；
  //   2) 上次关闭时处于解析/总结/原子化/写入/排队中的任务，弹窗询问
  //      继续（重新入队，artifact 缓存自动断点续传）或放弃（移除记录）。
  async sessionStartupCleanup() {
    const tasks = await this.recoverCommittedStructuredTasks(await this.loadTasks());
    const failedTasks = tasks.filter((task) => task.status === 'failed');
    if (failedTasks.length) {
      for (const task of failedTasks) this._terminalTaskIds.add(task.task_id);
      diag('startup.failedRestored', {
        count: failedTasks.length,
        files: failedTasks.slice(0, 10).map((task) => task.source_path)
      });
      await this.transitionFailureUi(failedTasks.at(-1).task_id);
    }
    const interrupted = tasks.filter((task) => PROCESSING_STATUSES.has(task.status)
      || task.status === 'parsed' || task.status === 'queued');
    if (!interrupted.length) return;
    diag('startup.interruptedFound', {
      count: interrupted.length,
      statuses: interrupted.map((task) => task.status).slice(0, 20)
    });
    const interruptedIds = new Set(interrupted.map((task) => task.task_id));
    new InterruptedTasksModal(this.app, interrupted, {
      onResume: async () => {
        const latest = await this.loadTasks();
        for (const task of latest) {
          if (!interruptedIds.has(task.task_id)) continue;
          task.status = 'queued';
          task.updated_at = new Date().toISOString();
        }
        await this.saveTasks(latest);
        await this.refreshViews();
        await this.autoProcessQueue(false);
      },
      onDiscard: async () => {
        const latest = await this.loadTasks();
        const retained = [];
        for (const task of latest) {
          if (!interruptedIds.has(task.task_id)) { retained.push(task); continue; }
          if (task.structured_transaction_id) {
            task.status = 'paused';
            task.updated_at = new Date().toISOString();
            task.progress = { stage: 'recovery-required', message: '检测到已提交事务；任务已保留，请先安全回滚后再放弃。', at: task.updated_at };
            retained.push(task);
          }
        }
        await this.saveTasks(retained);
        await this.refreshViews();
        diag('startup.interruptedDiscarded', { count: interrupted.length, retainedCommitted: retained.filter((task) => interruptedIds.has(task.task_id)).length });
      }
    }).open();
  }

  async recoverCommittedStructuredTasks(tasks) {
    const adapter = this.app.vault.adapter;
    const directory = normalizeVaultPath(`${this.settings.artifactsPath}/structured-writer/transactions`);
    const listing = typeof adapter.list === 'function' && await adapter.exists(directory)
      ? await adapter.list(directory) : { files: [] };
    const files = Array.isArray(listing?.files) ? listing.files.filter((path) => path.endsWith('.json')) : [];
    const manifests = [];
    for (const manifestPath of files) {
      try { manifests.push({ manifestPath, manifest: JSON.parse(await adapter.read(manifestPath)) }); } catch (_) {}
    }
    const readVisibleFile = async (path) => {
      const relative = vaultRelativePath(path, 'structured recovery verification');
      if (typeof this.app.vault.getAbstractFileByPath === 'function' && typeof this.app.vault.read === 'function') {
        const file = this.app.vault.getAbstractFileByPath(relative);
        if (!file || file.path !== relative) return null;
        return this.app.vault.read(file);
      }
      return await adapter.exists(relative) ? adapter.read(relative) : null;
    };
    let changed = false;
    for (const task of tasks) {
      if (task.status === 'rolled_back') continue;
      const isLegacySuccess = !Array.isArray(task.verified_records)
        && (['written', 'success', 'archived'].includes(task.status)
          || Number(task.result_counts?.written || 0) > 0 || task.written_card_ids?.length || task.writtenFiles?.length);
      if (isLegacySuccess) {
        task.status = 'verification_required';
        const paths = [...new Set([...(task.output_paths || []), ...(task.writtenFiles || [])]
          .map(normalizeVaultPath).filter(Boolean))];
        const migrated = [];
        for (const path of paths.slice(0, 300)) {
          const content = await readVisibleFile(path);
          const recordId = readFrontmatterValue(content, 'record_id');
          const recordKind = readFrontmatterValue(content, 'record_kind');
          if (!String(content || '').trim() || !recordId
            || !['business_item', 'company_knowledge'].includes(recordKind)) continue;
          migrated.push({ record_id: recordId, record_kind: recordKind, path,
            content_hash: structuredContentHash(content), verified_at: new Date().toISOString(),
            transaction_id: `migration-${task.task_id}`, state: 'visible_verified' });
        }
        // Legacy files may still exist, but an old run is never evidence for this
        // run. Preserve expensive checkpoints and force the normal writer to
        // re-verify/rewrite them into a current-run authoritative manifest.
        applyVerifiedFacts(task, []);
        task.status = 'queued'; task.terminal_outcome = null;
        task.progress = { stage: 'queued', message: '旧版结果不属于当前运行的最终权威清单；已保留解析/AI 检查点并等待重新验证或重写。', at: new Date().toISOString() };
        changed = true;
      }
      const plan = await this.loadArtifact(task, 'structured-write-plan');
      if (!plan?.plan_id) {
        if (task.semantic_path === 'universal' && (task.structured_transaction_id || task.status === 'written')) {
          task.status = 'queued'; task.terminal_outcome = null; task.structured_transaction_id = null;
          task.output_paths = []; task.written_card_ids = [];
          task.result_counts = Object.assign({}, task.result_counts || {}, { written: 0, created: 0, updated: 0, unchanged: 0, knowledge_records: 0, verified: 0 });
          if (task.artifacts) { delete task.artifacts.knowledge_records; delete task.artifacts['structured-transaction']; }
          task.updated_at = new Date().toISOString();
          task.progress = { stage: 'queued', message: '旧版入库结果缺少可复核计划，已失效并等待安全重写。', at: task.updated_at };
          changed = true;
        }
        continue;
      }
      const candidates = manifests.filter(({ manifest }) => manifest.status === 'committed'
        && manifest.transaction_id === task.structured_transaction_id
        && manifest.run_id === task.run_id && manifest.task_id === task.task_id);
      let recovered = false;
      for (const { manifestPath, manifest } of candidates) {
        if (manifest.status !== 'committed' || manifest.plan_id !== plan.plan_id
          || manifest.run_id !== task.run_id || manifest.task_id !== task.task_id) continue;
        const knowledge = [];
        let valid = true;
        const plannedKnowledge = ((plan.actions || []).length ? plan.actions : manifest.steps || [])
          .filter((step) => ['business_item', 'company_knowledge'].includes(step.record_kind));
        for (const step of plannedKnowledge) {
          const content = await readVisibleFile(step.path);
          const expectedId = new RegExp(`^record_id:\\s*["']?${String(step.record_id).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}["']?\\s*$`, 'm');
          const expectedKind = new RegExp(`^record_kind:\\s*["']?${String(step.record_kind).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}["']?\\s*$`, 'm');
          if (!String(content || '').trim() || !expectedId.test(content) || !expectedKind.test(content)) { valid = false; break; }
          const roots = { active_tender: normalizeVaultPath(this.settings.structuredActiveRoot || '在办投标库'),
            business: normalizeVaultPath(this.settings.structuredBusinessRoot || '长期业务库') };
          const targetLibrary = Object.entries(roots).find(([, root]) => step.path.startsWith(`${root}/`))?.[0];
          if (!step.path.toLowerCase().endsWith('.md') || !targetLibrary
            || structuredContentHash(content) !== step.content_hash) { valid = false; break; }
          knowledge.push({ ...step, verified_content_hash: structuredContentHash(content), target_library: targetLibrary });
        }
        if (!valid) {
          break;
        }
        task.semantic_path = 'universal';
        task.structured_transaction_id = manifest.transaction_id;
        applyVerifiedFacts(task, knowledge.map((step) => ({
          record_id: step.record_id, record_kind: step.record_kind, path: step.path,
          final_path: step.path, run_id: task.run_id, vault_file_type: 'markdown', target_library: step.target_library,
          content_hash: step.verified_content_hash, verified_at: new Date().toISOString(),
          transaction_id: manifest.transaction_id, source_association: step.owner_source_id || '',
          state: 'visible_verified'
        })));
        task.result_counts = Object.assign({}, task.result_counts || {}, {
          planned: knowledge.length, attempted: knowledge.filter((step) => step.action !== 'noop').length,
          committed: knowledge.length, verified: knowledge.length,
          written: knowledge.length, knowledge_records: knowledge.length,
          created: knowledge.filter((step) => step.action === 'create').length,
          updated: knowledge.filter((step) => String(step.action).includes('update')).length,
          unchanged: Number(plan.counts?.noop || 0), review: 0
        });
        task.status = knowledge.length ? 'written' : 'completed_no_output';
        task.terminal_outcome = knowledge.length ? 'completed_with_output' : 'completed_no_output';
        task.updated_at = new Date().toISOString();
        task.artifacts = Object.assign({}, task.artifacts || {}, {
          'structured-transaction': manifestPath, knowledge_records: task.output_paths
        });
        changed = true;
        recovered = true;
        diag('startup.structuredCommitRecovered', { taskId: task.task_id, transactionId: manifest.transaction_id, knowledgeRecords: knowledge.length });
        break;
      }
      if (!recovered && (task.structured_transaction_id || ['written', 'completed_no_output'].includes(task.status))) {
        task.status = 'queued';
        task.terminal_outcome = null;
        task.structured_transaction_id = null;
        task.output_paths = [];
        task.written_card_ids = [];
        task.result_counts = Object.assign({}, task.result_counts || {}, {
          written: 0, created: 0, updated: 0, unchanged: 0, knowledge_records: 0, committed: 0, verified: 0
        });
        if (task.artifacts) {
          delete task.artifacts.knowledge_records;
          delete task.artifacts['structured-transaction'];
        }
        task.updated_at = new Date().toISOString();
        task.progress = { stage: 'queued', message: '旧版入库结果未通过 Obsidian 文件复核，已失效并等待安全重写。', at: task.updated_at };
        changed = true;
        diag('startup.structuredCommitInvalidated', { taskId: task.task_id, reason: 'visible_files_missing_or_invalid' });
      }
    }
    if (changed) {
      await this.saveTasks(tasks);
      await this.flushSaveTasksImmediate();
    }
    return tasks;
  }

  async setTaskProgress(task, message, details = {}) {
    const now = new Date().toISOString();
    task.updated_at = now;
    const nextProgress = Object.assign({}, details, {
      message,
      at: now
    });
    nextProgress.completedWork = pipelineProgress(task, nextProgress).completedWork;
    task.progress = nextProgress;
    this.sessionStats.current = task.source_path;
    this.sessionStats.lastMessage = message;
    await this.saveTasks(upsertTask(await this.loadTasks(), task));
    await this.refreshViews();
  }

  async recoverStaleProcessingTasks(tasks) {
    const minutes = Number(this.settings.staleProcessingMinutes || DEFAULT_SETTINGS.staleProcessingMinutes || 20);
    const staleMs = Math.max(5, minutes) * 60 * 1000;
    const now = Date.now();
    let changed = false;
    for (const task of tasks) {
      if (!PROCESSING_STATUSES.has(task.status)) continue;
      const updatedAt = Date.parse(task.updated_at || task.progress?.at || '');
      if (!updatedAt || now - updatedAt < staleMs) continue;
      // v1.4 (M-11): 改 'failed' 为 'paused'，避免被一刀切失败。
      //               用户可在 dashboard 点"恢复暂停任务"批量重排队。
      task.status = 'paused';
      task.updated_at = new Date().toISOString();
      task.errors = [...(task.errors || []), {
        stage: 'stale-processing',
        message: `任务在 ${minutes} 分钟内没有进度更新，已判定为中断并暂停。可在 dashboard 点"恢复暂停任务"重排队。`,
        at: task.updated_at
      }];
      task.progress = {
        stage: 'stale-processing',
        message: '任务长时间没有进度更新，已暂停等待恢复',
        at: task.updated_at
      };
      changed = true;
    }
    if (changed) await this.saveTasks(tasks);
    return tasks;
  }

  async clearPluginCache() {
    await this.ensureFolders();
    await deleteFolderContents(this.app, this.settings.artifactsPath);
    this.sessionStats = { scanned: 0, processed: 0, written: 0, review: 0, failed: 0, skipped: 0, current: '', lastMessage: '缓存已清空，等待重新扫描' };
    await this.ensureFolders();
    await this.refreshViews();
    new Notice('工程知识切片缓存已清空。源文件和已入库 wiki 卡片未删除。');
  }

  async writeTaskLog(task) {
    await this.ensureFolders();
    await writeFile(this.app, `${this.settings.logPath}/${task.task_id}.json`, JSON.stringify(task, null, 2));
  }

  async getPdfExtractorConfig(task = null) {
    return {
      enabled: true,
      order: String(this.settings.pdfExtractionOrder || DEFAULT_SETTINGS.pdfExtractionOrder),
      // v2.8.1: 设置开关常开，或本次会话在确认弹窗点过"确认上传"，都视为已授权
      allowExternalUpload: this.settings.pdfAllowExternalUpload === true || eksSessionUploadApproved(),
      // v1.3: 上传前是否弹窗二次确认（默认开启）
      confirmUploads: this.settings.confirmUploads !== false,
      timeoutMs: Number(this.settings.pdfExternalTimeoutMs || 300000),
      pollIntervalMs: Number(this.settings.pdfApiPollIntervalMs || 5000),
      signal: task ? this.taskControllers?.get(task.task_id)?.signal : undefined,
      mineruApiKey: this.settings.pdfMineruApiKey || '',
      mineruApiEndpoint: this.settings.pdfMineruApiEndpoint || 'https://mineru.net/api/v4',
      mineruApiModel: this.settings.pdfMineruApiModel || 'vlm',
      mineruApiLanguage: this.settings.pdfMineruApiLanguage || 'ch_server',
      paddleOcrApiKey: this.settings.pdfPaddleOcrApiKey || '',
      paddleOcrApiEndpoint: this.settings.pdfPaddleOcrApiEndpoint || 'https://paddleocr.aistudio-app.com/api/v2/ocr/jobs',
      paddleOcrApiModel: this.settings.pdfPaddleOcrApiModel || 'PaddleOCR-VL-1.6',
      requestImpl: (url, init) => {
        const provider = String(url).includes('paddleocr') ? 'paddleocr' : 'mineru';
        this.operationCounters.apiRequests += 1;
        return this.providerLimiters[provider].run(() => obsidianRequest(url, init), { signal: task ? this.taskControllers?.get(task.task_id)?.signal : undefined });
      },
      fileName: task?.source_path?.split('/').pop() || 'source.pdf',
      onProgress: task ? (progress) => this.setTaskProgress(task, progress.message, progress) : undefined
    };
  }

  async getPluginFilePath(relativePath) {
    const pluginRelativePath = normalizeVaultPath(`${this.manifest.dir || `.obsidian/plugins/${this.manifest.id}`}/${relativePath}`);
    const adapter = this.app.vault.adapter;
    if (adapter && typeof adapter.getFullPath === 'function') {
      return adapter.getFullPath(pluginRelativePath);
    }
    return pluginRelativePath;
  }

  async appendRollback(entry) {
    const path = rollbackPath(this.settings);
    let rows = [];
    const file = this.app.vault.getAbstractFileByPath(path);
    if (file instanceof TFile) {
      try { rows = JSON.parse(await this.app.vault.read(file)); } catch { rows = []; }
    }
    rows.push(entry);
    await writeFile(this.app, path, JSON.stringify(rows, null, 2));
  }

  async loadRollbackJournal() {
    const path = rollbackPath(this.settings);
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) return [];
    try {
      const rows = JSON.parse(await this.app.vault.read(file));
      return Array.isArray(rows) ? rows : [];
    } catch {
      return [];
    }
  }

  async showHistoryForFile(file) {
    const tasks = await this.loadTasks();
    const related = tasks.filter((task) => task.source_path === file.path || (task.source_aliases || []).includes(file.path));
    new Notice(related.length ? related.map((task) => `${task.task_id}: ${task.status}`).join('\n') : '该文件没有切片处理历史。');
    await this.activateView();
  }
};

// 审核弹窗：每页只处理一个问题；业务信息与技术诊断严格分层。
class ReviewExceptionModal extends Modal {
  constructor(app, group, sourcePath, handlers = {}) {
    super(app);
    this.group = group;
    this.sourcePath = sourcePath;
    this.handlers = handlers;
    this.index = 0;
    this.items = [...(group.items || [])];
    this.keyHandler = (event) => this.onKeyDown(event);
  }
  onOpen() {
    const { contentEl } = this;
    if (!this.items.length) { this.close(); return; }
    this.index = nextReviewIndex(this.index, this.items.length);
    contentEl.empty();
    contentEl.addClass('eks-review-exception-modal');
    contentEl.setAttr('tabindex', '-1');
    contentEl.removeEventListener('keydown', this.keyHandler);
    contentEl.addEventListener('keydown', this.keyHandler);
    const item = this.items[this.index];
    const context = item.review_context || {};
    const explanation = explainIssue(item);
    const header = contentEl.createDiv('eks-review-modal-header');
    header.createEl('h2', { text: `第 ${this.index + 1} / ${this.items.length} 项` });
    header.createDiv({ cls: 'eks-review-plain-reason', text: (context.plain_reasons || [explanation.happened])[0] });
    header.createDiv({ cls: 'eks-task-meta', text: `源文档：${this.sourcePath || '未知文档'}` });
    const plan = safeApprovalPlan(this.items);
    const approveSafe = header.createEl('button', {
      text: `批准全部可安全批准项（${plan.eligible}）`,
      attr: { 'aria-label': `批准全部 ${plan.eligible} 个可安全批准项` }
    });
    approveSafe.disabled = plan.eligible === 0;
    approveSafe.addEventListener('click', () => this.runAction(plan.eligibleIds, 'approve_selected', true));
    const body = contentEl.createDiv('eks-review-modal-body');
    body.createEl('h3', { text: plainCardTitle(item) });
    const difference = context.material_differences || {};
    const comparison = body.createDiv('eks-evidence-comparison');
    const generated = comparison.createDiv('eks-review-pane');
    generated.createEl('h4', { text: '生成内容' });
    renderDifferenceText(generated.createDiv({ cls: 'eks-review-pane-scroll' }),
      context.statement || plainClaim(item), differenceSpans(context.material_differences, 'generated'));
    const source = comparison.createDiv('eks-review-pane');
    source.createEl('h4', { text: '原文依据' });
    renderDifferenceText(source.createDiv({ cls: 'eks-review-pane-scroll' }),
      context.evidence_quote || '未找到可核验的原文依据', differenceSpans(context.material_differences, 'source'));
    source.createDiv({ cls: 'eks-task-meta', text: `位置：${formatReviewLocator(context)}` });
    body.createDiv({
      cls: difference.status === 'matched' || difference.status === 'not_applicable' ? 'eks-automatic-pass' : 'eks-approval-blocked',
      text: plainDifferenceSummary(difference)
    });
    for (const detail of plainDifferenceDetails(difference)) {
      body.createDiv({ cls: 'eks-review-difference-detail', text: detail });
    }
    if (!isApprovalEligible(item)) {
      body.createDiv({ cls: 'eks-approval-blocked', text: '此项存在未解决的实质差异，不能批准。请重新生成、拒绝或转交专家。' });
    }
    const pager = contentEl.createDiv({ cls: 'eks-exception-pager' });
    const previous = pager.createEl('button', { text: '上一项', attr: { 'aria-label': '上一项' } }); previous.disabled = this.index === 0;
    previous.addEventListener('click', () => this.navigate(-1));
    pager.createSpan({ text: `${this.index + 1} / ${this.items.length}` });
    const next = pager.createEl('button', { text: '下一项', attr: { 'aria-label': '下一项' } }); next.disabled = this.index >= this.items.length - 1;
    next.addEventListener('click', () => this.navigate(1));
    const actions = contentEl.createDiv({ cls: 'eks-review-exception-actions' });
    const approve = actions.createEl('button', { text: '批准', cls: 'mod-cta', attr: { 'aria-label': '批准此项（快捷键 A）' } });
    approve.disabled = !isApprovalEligible(item);
    approve.addEventListener('click', () => this.runAction([item.atom_id], 'approve_selected'));
    actions.createEl('button', { text: '重新生成', attr: { 'aria-label': '重新生成此项（快捷键 R）' } })
      .addEventListener('click', () => this.runAction([item.atom_id], 'regenerate_selected'));
    const more = actions.createEl('details', { cls: 'eks-more-actions' });
    more.createEl('summary', { text: '更多操作' });
    const menu = more.createDiv('eks-more-actions-menu');
    menu.createEl('button', { text: '拒绝此项' }).addEventListener('click', () => this.runAction([item.atom_id], 'reject_selected'));
    menu.createEl('button', { text: '转交专家' }).addEventListener('click', () => this.runAction([item.atom_id], 'manual_selected'));
    menu.createEl('button', { text: '打开原文' }).addEventListener('click', () => this.openSource());
    menu.createEl('button', { text: '重做整份文档知识卡' }).addEventListener('click', async () => {
      if (!window.confirm('这会重新生成整个文件的知识原子；已有已批准卡片不会重复写入。确认继续？')) return;
      try { await this.handlers.onWholeRegenerate?.(); this.close(); }
      catch (error) { new Notice(`整文件知识原子重生成失败：${error.message}`); }
    });
    actions.createEl('button', { text: '关闭' }).addEventListener('click', () => this.close());
    contentEl.focus();
  }
  navigate(delta) {
    this.index = nextReviewIndex(this.index + delta, this.items.length);
    this.onOpen();
  }
  async runAction(ids, action, safeAll = false) {
    if (!ids.length) return;
    if (safeAll && ids.length > 1 && !window.confirm(`将批准 ${ids.length} 项；有实质差异的项目会保留。确认继续？`)) return;
    try {
      diag('review.uiAction', { action, count: ids.length, safeAll, sourceIncluded: false });
      const result = await this.handlers.onAction?.(ids, action, '');
      const removed = new Set(action === 'manual_selected' ? ids : ids);
      const remainingIds = new Set((result?.remainingItems || []).map((entry) => entry.atom_id));
      this.items = this.items.filter((entry) => !removed.has(entry.atom_id) && (!result?.remainingItems || remainingIds.has(entry.atom_id)));
      this.index = nextReviewIndex(this.index, this.items.length);
      if (!this.items.length) this.close(); else this.onOpen();
    } catch (error) { new Notice(`操作失败：${error.message}`); }
  }
  async openSource() {
    if (!this.sourcePath) { new Notice('源文档路径未知'); return; }
    const file = this.app.vault.getAbstractFileByPath(this.sourcePath);
    if (file instanceof TFile) await this.app.workspace.openLinkText(this.sourcePath, '', false);
    else new Notice(`源文档不在 vault 中：${this.sourcePath}`);
  }
  onKeyDown(event) {
    if (event.target?.matches?.('button, summary, input, textarea, select')) return;
    if (event.key === 'ArrowLeft') { event.preventDefault(); this.navigate(-1); }
    else if (event.key === 'ArrowRight') { event.preventDefault(); this.navigate(1); }
    else if (event.key.toLowerCase() === 'a' && isApprovalEligible(this.items[this.index])) {
      event.preventDefault(); this.runAction([this.items[this.index].atom_id], 'approve_selected');
    } else if (event.key.toLowerCase() === 'r') {
      event.preventDefault(); this.runAction([this.items[this.index].atom_id], 'regenerate_selected');
    } else if (event.key === 'Escape') { event.preventDefault(); this.close(); }
  }
  onClose() {
    this.contentEl.removeEventListener('keydown', this.keyHandler);
    this.contentEl.empty();
  }
}

function plainCardTitle(item) {
  return String(item?.atom?.title || item?.proposed_card?.title || '待确认的知识卡').replace(/\s+/g, ' ').slice(0, 100);
}
function plainClaim(item) {
  const value = item?.atom?.content;
  if (typeof value === 'string') return value;
  return Object.values(value || {}).flatMap((entry) => Array.isArray(entry) ? entry : [entry])
    .filter((entry) => ['string', 'number'].includes(typeof entry)).join('；').slice(0, 2000) || plainCardTitle(item);
}
function formatReviewLocator(context) {
  const source = context.source_context || {};
  const parts = [];
  if (context.page) parts.push(`第 ${context.page} 页`);
  if (source.table?.sheet) parts.push(`工作表 ${source.table.sheet}`);
  if (source.table?.row !== '' && source.table?.row != null) parts.push(`第 ${source.table.row} 行`);
  if (source.message?.subject) parts.push(`邮件“${source.message.subject}”`);
  if (context.section) parts.push(`章节“${context.section}”`);
  return parts.join(' · ') || context.locator || '原文中的已核验位置';
}
function plainDifferenceSummary(difference) {
  const labels = {
    matched: '自动检查通过：数字、日期、单位、义务强度和适用条件与原文一致。',
    not_applicable: '自动检查通过：此项没有需要核对的数字、日期或单位，义务与条件无实质差异。',
    conflict: '数字或日期与原文冲突。',
    unsupported_addition: '生成内容增加了原文没有的数字或日期。',
    missing_in_evidence: '原文依据缺少核验该数值所需的单位。',
    ambiguous_conversion: '单位换算关系不明确。'
  };
  return labels[difference.status] || '检测到需要处理的实质差异。';
}
function differenceSpans(difference, side) {
  const rows = difference?.factComparison?.differences || difference?.differences || [];
  return [...new Set(rows.flatMap((row) => side === 'generated'
    ? [row.claim || row.generated || '']
    : (Array.isArray(row.evidence) ? row.evidence : [row.source || row.evidence || ''])).filter(Boolean))];
}
function renderDifferenceText(container, value, spans) {
  const source = String(value || '');
  const matches = (spans || []).flatMap((span) => {
    const start = source.indexOf(String(span));
    return start < 0 ? [] : [{ start, end: start + String(span).length }];
  }).sort((a, b) => a.start - b.start);
  let cursor = 0;
  for (const match of matches) {
    if (match.start < cursor) continue;
    if (match.start > cursor) container.appendText(source.slice(cursor, match.start));
    container.createEl('mark', { cls: 'eks-review-difference-mark', text: source.slice(match.start, match.end) });
    cursor = match.end;
  }
  if (cursor < source.length) container.appendText(source.slice(cursor));
}
function plainDifferenceDetails(difference) {
  const labels = {
    conflict: '数值、日期或单位冲突', unsupported_addition: '原文不支持这项新增事实',
    missing_in_evidence: '原文缺少对应单位', ambiguous_conversion: '单位换算无法确认',
    material_conflict: '材料、产品或型号冲突', unsupported_material: '原文不支持这项材料、产品或型号',
    strengthened_obligation: '义务被加强', weakened_obligation: '义务被弱化',
    changed_obligation: '义务强度改变', invented_condition: '新增了适用条件',
    removed_condition_or_exception: '删除了条件或例外'
  };
  const rows = difference?.factComparison?.differences || difference?.differences || [];
  const details = rows.map((row) => {
    const source = (Array.isArray(row.evidence) ? row.evidence.join('、') : row.source || row.evidence) || '原文无对应值';
    return `差异：${labels[row.status] || '事实不一致'}；生成值：${row.claim || row.generated || '未标明'}；原文值：${source}；影响：可能改变检索、选材或验收判断。`;
  });
  for (const item of [difference?.modality, difference?.conditions]) {
    if (item?.status && item.status !== 'matched') {
      details.push(`差异：${labels[item.status] || item.status}；生成值：${item.statement || '无'}；原文值：${item.evidence || '无'}；影响：可能改变责任或适用范围。`);
    }
  }
  return details;
}

// v1.3: 上传源文件到外部解析器（MinerU / PaddleOCR）前的二次确认弹窗。
//       通过 globalThis.__eksUploadConfirm 暴露给闭包模块（external-pdf.js）调用。
class UploadConfirmModal extends Modal {
  constructor(app, payload) {
    super(app);
    this.payload = payload || {};
    this.resolved = false;
    this.confirmed = false;
  }
  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass('eks-upload-confirm-modal');
    contentEl.createEl('h2', { text: '确认上传源文件到外部解析器' });
    const bytes = Number(this.payload.sizeBytes || 0);
    const sizeText = bytes > 0
      ? `${(bytes / 1024 / 1024).toFixed(2)} MB`
      : '未知大小';
    const engineText = String(this.payload.engine || 'MinerU / PaddleOCR');
    contentEl.createDiv({
      cls: 'eks-task-meta',
      text: `源文件：${this.payload.fileName || '(未知文件名)'}（${sizeText}）`
    });
    contentEl.createDiv({
      cls: 'eks-task-meta',
      text: `目标解析器：${engineText}`
    });
    contentEl.createDiv({
      cls: 'eks-task-meta',
      text: '请确认该源文件可以合法上传到云端解析服务，并已通过公司保密审批。'
    });
    const remember = contentEl.createEl('label', { cls: 'eks-upload-confirm-remember' });
    const cb = remember.createEl('input', { attr: { type: 'checkbox' } });
    remember.createSpan({ text: '本次会话不再重复询问（仍可在设置里取消）' });
    const actions = contentEl.createDiv({ cls: 'eks-upload-confirm-actions' });
    const cancelBtn = actions.createEl('button', { text: '取消上传' });
    const confirmBtn = actions.createEl('button', { text: '确认上传', cls: 'mod-cta' });
    const finish = (ok) => {
      if (this.resolved) return;
      this.resolved = true;
      this.confirmed = !!ok;
      this.remember = !!cb.checked;
      this.close();
    };
    cancelBtn.addEventListener('click', () => finish(false));
    confirmBtn.addEventListener('click', () => finish(true));
  }
  onClose() {
    this.contentEl.empty();
    if (!this.resolved) {
      // 用户点了右上角 X → 当作取消
      this.resolved = true;
      this.confirmed = false;
    }
  }
}

// v1.3: globalThis 桥接：闭包模块（external-pdf.js 等）通过该入口弹上传确认弹窗。
//       每个会话内 confirmAll=true 后不再询问；同时尊重 settings.confirmUploads。
globalThis.__eksUploadConfirm = globalThis.__eksUploadConfirm || null;
// v2.8.1: 用户在确认弹窗里点了"确认上传" → 本次会话视为已授权上传。
//   修复旧行为：弹窗确认与 runEngine 的 allowExternalUpload 门是两套独立逻辑，
//   用户点确认后 9ms 仍被"未确认允许上传源文件到外部解析 API"拒绝，只能再去设置里手动开开关。
function eksSessionUploadApproved() {
  const state = typeof globalThis.__eksDiag === 'object' && globalThis.__eksDiag && globalThis.__eksDiag.state;
  return !!(state && state.uploadApprovedThisSession);
}
function setEksUploadConfirm(plugin) {
  if (plugin && plugin.app && typeof plugin.settings === 'object') {
    globalThis.__eksUploadConfirm = async function askUploadConfirm(payload) {
      if (plugin.settings.confirmUploads === false) return true; // 设置关闭 → 跳过
      const session = (typeof globalThis.__eksDiag === 'object' && globalThis.__eksDiag.state)
        ? globalThis.__eksDiag.state
        : {};
      if (session.uploadConfirmedAll) return true; // 用户本会话已选择"不再询问"
      const modal = new UploadConfirmModal(plugin.app, payload || {});
      modal.open();
      await new Promise((resolve) => {
        // Modal 关闭后给一点事件循环时间，确保 onClose 已执行
        const prevOnClose = modal.onClose.bind(modal);
        modal.onClose = function() {
          prevOnClose();
          resolve();
        };
        // 兜底：若 onClose 路径上没 resolve，5 秒后强制 resolve
        setTimeout(resolve, 5000);
      });
      if (modal.remember) session.uploadConfirmedAll = true;
      // v2.8.1: 弹窗确认 = 本次会话授权上传（runEngine 的 allowExternalUpload 门会认这个标记）；
      //   勾选"不再询问"时持久化为 settings.pdfAllowExternalUpload = true。
      if (modal.confirmed) {
        session.uploadApprovedThisSession = true;
        if (modal.remember && plugin.settings.pdfAllowExternalUpload !== true) {
          plugin.settings.pdfAllowExternalUpload = true;
          try { await plugin.saveSafeSettings(); } catch (_) { /* 持久化失败不影响本次上传 */ }
        }
      }
      try {
        const diag = (typeof globalThis.__eksDiag === 'object' && globalThis.__eksDiag.diag) || (() => {});
        diag('upload.confirm', {
          fileName: payload?.fileName,
          sizeBytes: payload?.sizeBytes,
          engine: payload?.engine,
          confirmed: !!modal.confirmed,
          rememberAll: !!modal.remember,
          sessionApproved: !!session.uploadApprovedThisSession
        });
      } catch (_) {}
      return !!modal.confirmed;
    };
  }
}

// v2.9.0: 启动续传询问弹窗。上次关闭时有正在处理的任务 → 询问继续/放弃。
//   继续：任务重新入队，processTask 经 artifacts 缓存自动从断点阶段往下跑；
//   放弃：从任务账本移除这些记录，保持处理概览干净（源文件仍在，可重新扫描）。
class InterruptedTasksModal extends Modal {
  constructor(app, tasks, handlers) {
    super(app);
    this.tasks = Array.isArray(tasks) ? tasks : [];
    this.handlers = handlers || {};
  }
  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass('eks-interrupted-modal');
    contentEl.createEl('h2', { text: '检测到上次未完成的处理' });
    contentEl.createDiv({
      cls: 'eks-task-meta',
      text: `上次关闭软件时有 ${this.tasks.length} 个文件正在处理。「继续处理」将从上次缓存到的步骤接着往下；「放弃」则清空这些记录，保持处理概览干净。`
    });
    const list = contentEl.createEl('ul', { cls: 'eks-interrupted-list' });
    for (const task of this.tasks.slice(0, 10)) {
      list.createEl('li', { text: `${task.source_path || '(未知文件)'}（${stageLabel(task.status)}）` });
    }
    if (this.tasks.length > 10) {
      contentEl.createDiv({ cls: 'eks-task-meta', text: `… 还有 ${this.tasks.length - 10} 个` });
    }
    const actions = contentEl.createDiv({ cls: 'eks-actions' });
    actions.createEl('button', { text: '继续处理', cls: 'mod-cta' }).addEventListener('click', async () => {
      this.close();
      try { await this.handlers.onResume(); } catch (error) { new Notice(`恢复处理失败：${error.message}`); }
    });
    actions.createEl('button', { text: '放弃，保持概览干净' }).addEventListener('click', async () => {
      this.close();
      try { await this.handlers.onDiscard(); } catch (error) { new Notice(`清理中断任务失败：${error.message}`); }
    });
  }
}

class SlicerDashboardView extends ItemView {
  constructor(leaf, plugin) {
    super(leaf);
    this.plugin = plugin;
    this.selectedTaskIds = new Set();
    this.taskFilter = 'all';
    this.taskSearch = '';
    this.taskPage = 0;
    this.taskPageSize = 50;
    this.activeSection = 'tasks';
  }

  getViewType() { return VIEW_TYPE_SLICER; }
  getDisplayText() { return '工程知识切片'; }
  getIcon() { return 'layers'; }

  async onOpen() {
    await this.render();
  }

  async render() {
    const renderVersion = (this._renderVersion || 0) + 1;
    this._renderVersion = renderVersion;
    const container = this.containerEl.children[1];
    container.empty();
    container.addClass('eks-view');
    try {
      await this.renderContent(container, renderVersion);
    } catch (error) {
      if (renderVersion !== this._renderVersion) return;
      console.error('工程知识切片界面渲染失败', error);
      container.createEl('h2', { text: '工程知识切片' });
      container.createDiv({ cls: 'eks-empty', text: `界面渲染失败：${error.message}` });
      const fallback = container.createDiv('eks-actions');
      button(fallback, '重新渲染', () => this.render());
      button(fallback, '打开 Obsidian 设置', () => this.plugin.openSettings());
    }
  }

  // v1.1.8: 轻量级进度更新，1 秒一次心跳用，不重建整个 dashboard DOM
  refreshProgress(task) {
    if (!task || !task.progress || !shouldAcceptIncrementalProgress(task, this.plugin._terminalTaskIds)) return;
    const root = this.containerEl;
    // 更新进度条
    const bar = root.querySelector('.eks-overall-progress');
    if (bar) {
      const position = queuePosition(task);
      const work = pipelineProgress(task, task.progress).completedWork;
      bar.max = '100';
      bar.value = String(position.total > 0 ? ((position.ordinal - 1) + work / 100) / position.total * 100 : work);
    }
    // 更新已用时文本
    const elapsedEl = root.querySelector('.eks-task-meta.elapsed');
    if (elapsedEl && task.progress.elapsedMs !== undefined) {
      elapsedEl.textContent = `已用时：${formatDuration(task.progress.elapsedMs)} · 最后更新：${formatLocalTime(task.progress.at)}`;
    }
    // 更新进度消息文本
    const textEl = root.querySelector('.eks-progress-text');
    if (textEl && task.progress.message) {
      textEl.textContent = task.progress.message;
    }
    // 更新 ETA
    const etaEl = root.querySelector('.eks-task-meta.eta');
    if (etaEl) {
      etaEl.textContent = computeEtaText(task.progress);
    }
  }

  async renderContent(container, renderVersion) {
    const tasks = await this.plugin.loadTasks();
    if (renderVersion !== this._renderVersion) return;
    const uiSnapshot = completionUiSnapshot(tasks);
    const counts = uiSnapshot.counts;
    const reviewCount = uiSnapshot.reviewCount;
    if (!this._hasRendered && reviewCount > 0) this.activeSection = 'review';
    if (!this._hasRendered && counts.failed > 0) {
      this.activeSection = 'errors';
      this.expandedErrorTaskId = tasks.filter((task) => task.status === 'failed').at(-1)?.task_id || '';
    }
    this._hasRendered = true;
    const activeTask = tasks.find((task) => PROCESSING_STATUSES.has(task.status));
    const state = activeTask ? 'running'
      : reviewCount ? 'review'
        : counts.failed ? 'error'
          : counts.pending ? 'ready'
            : counts.written ? 'success' : 'empty';
    const status = container.createEl('section', {
      cls: `eks-status eks-status-${state}`,
      attr: { 'aria-labelledby': 'eks-status-title', 'aria-live': 'polite', 'data-state': state }
    });
    const statusLine = status.createDiv('eks-status-line');
    statusLine.createEl('h2', { text: workflowStateTitle(state), attr: { id: 'eks-status-title' } });
    statusLine.createSpan({ cls: 'eks-status-badge', text: workflowStateLabel(state) });
    const activeProgress = activeTask?.progress || {};
    const position = queuePosition(activeTask, tasks);
    const taskProgress = pipelineProgress(activeTask, activeProgress);
    const overallPercent = activeTask && position.total > 0
      ? Math.min(99.9, ((position.ordinal - 1) + taskProgress.completedWork / 100) / position.total * 100)
      : uiSnapshot.overallPercent;
    status.createDiv({ cls: 'eks-queue-position', text: activeTask ? position.label : (overallPercent === 100 ? '处理队列 已完成' : '处理队列 空闲') });
    status.createDiv({
      cls: 'eks-progress-text',
      text: safeDisplayText(activeProgress.message || workflowStateMessage(state, counts))
    });
    status.createEl('progress', {
      cls: 'eks-progress-bar eks-overall-progress',
      attr: { max: '100', value: String(overallPercent), 'aria-label': `整批处理总进度 ${Math.floor(overallPercent)}%` }
    });
    status.createDiv({ cls: 'eks-task-meta', text: `当前阶段：${stageLabel(activeProgress.stage || activeTask?.status || state)}${activeTask ? ` · 总进度 ${Math.floor(overallPercent)}%` : ''}` });
    if (activeTask) {
      status.createDiv({ cls: 'eks-task-title', text: safeDisplayText(activeTask.source_path, '当前文件') });
      status.createDiv({
        cls: 'eks-task-meta elapsed',
        text: `已用时 ${formatDuration(activeProgress.elapsedMs)} · ${formatLastUpdate(activeProgress.at || activeTask.updated_at)}`
      });
    }
    const primary = status.createDiv('eks-primary-action');
    const primaryAction = workflowPrimaryAction(state, this.plugin, activeTask);
    button(primary, primaryAction.label, primaryAction.run).addClass('mod-cta', 'eks-primary-button');
    const more = status.createEl('details', { cls: 'eks-overflow' });
    more.createEl('summary', { text: '更多操作', attr: { 'aria-label': '展开次要操作' } });
    const secondary = more.createDiv('eks-secondary-actions');
    button(secondary, '扫描源文件', () => this.plugin.scanSourceFiles(true));
    button(secondary, '本地重验证最近任务（零模型调用）', () => this.plugin.revalidateLatestTaskLocal())
      .setAttribute('title', '仅使用最近任务已有的解析/总结/原子产物；重新归并、质量校验与路由，不调用 provider，不重写已存在卡片');
    if (activeTask) {
      button(secondary, '完成当前阶段后暂停', () => this.plugin.pauseProcessing());
      button(secondary, '取消当前任务', () => this.plugin.cancelCurrentTask(activeTask.task_id));
    }
    if (tasks.some((task) => task.status === 'paused')) button(secondary, '恢复暂停任务', () => this.plugin.restorePausedTasks());
    button(secondary, '打开设置', () => this.plugin.openSettings());

    const summary = container.createDiv('eks-summary-line');
    summary.createSpan({ text: `待审核 ${reviewCount}` });
    summary.createSpan({ text: `失败 ${counts.failed}` });
    summary.createSpan({ text: `已入库 ${counts.written}` });

    const tabs = container.createDiv({ cls: 'eks-tabs', attr: { role: 'tablist', 'aria-label': '工作区' } });
    const sections = [
      ['tasks', `任务 ${tasks.length}`],
      ['review', `审核 ${reviewCount}`],
      ['errors', `错误 ${counts.failed}`],
      ['semantic', '语义影子'],
      ['shadow', '影子评估']
    ];
    for (const [id, label] of sections) {
      const tab = button(tabs, label, () => { this.activeSection = id; this.render(); });
      tab.setAttribute('role', 'tab');
      tab.setAttribute('id', `eks-tab-${id}`);
      tab.setAttribute('aria-controls', `eks-panel-${id}`);
      tab.setAttribute('aria-selected', String(this.activeSection === id));
      tab.tabIndex = this.activeSection === id ? 0 : -1;
      tab.addEventListener('keydown', (event) => this.handleTabKey(event, sections.map(([key]) => key)));
    }
    const panel = container.createEl('section', {
      cls: 'eks-workspace',
      attr: { id: `eks-panel-${this.activeSection}`, role: 'tabpanel', 'aria-labelledby': `eks-tab-${this.activeSection}`, tabindex: '0' }
    });
    if (this.activeSection === 'tasks') this.renderTaskExplorer(panel, tasks);
    if (this.activeSection === 'review') await this.renderReview(panel, tasks, renderVersion);
    if (this.activeSection === 'errors') this.renderErrorCenter(panel, tasks);
    if (this.activeSection === 'semantic') this.renderSemanticStatus(panel);
    if (this.activeSection === 'shadow') await this.renderShadowEvaluation(panel, tasks);

    const context = container.createEl('details', { cls: 'eks-context' });
    context.createEl('summary', { text: '路径与规则' });
    context.createDiv({ text: `源文件：${safeDisplayText(this.plugin.settings.bidIntakePath)}；${safeDisplayText(this.plugin.settings.businessIntakePath)}` });
    context.createDiv({ text: `输出：${safeDisplayText(this.plugin.settings.bidOutputPath)}；${safeDisplayText(this.plugin.settings.businessOutputPath)}` });
  }

  handleTabKey(event, ids) {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const current = ids.indexOf(this.activeSection);
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? ids.length - 1
      : (current + (event.key === 'ArrowRight' ? 1 : -1) + ids.length) % ids.length;
    this.activeSection = ids[next];
    this.render().then(() => this.containerEl.querySelector(`#eks-tab-${this.activeSection}`)?.focus());
  }

  renderTaskExplorer(parent, tasks) {
    const controls = parent.createDiv('eks-task-controls');
    const search = controls.createEl('input', {
      attr: { type: 'search', placeholder: '搜索文件名', 'aria-label': '搜索任务文件名' }
    });
    search.value = this.taskSearch;
    search.addEventListener('input', () => {
      this.taskSearch = search.value;
      this.taskPage = 0;
      clearTimeout(this.taskSearchTimer);
      this.taskSearchTimer = setTimeout(() => this.render(), 150);
    });
    const filter = controls.createEl('select', { attr: { 'aria-label': '按状态筛选任务' } });
    for (const [value, label] of [
      ['all', '全部状态'], ['queued', '待处理队列'], ['processing', '处理中'],
      ['needs_review', '待审核'], ['needs_ocr', '需要 OCR'], ['unsupported_media', '暂不支持媒体'],
      ['failed', '失败'], ['written', '已完成'], ['rolled_back', '已回滚']
    ]) {
      const option = filter.createEl('option', { text: label, attr: { value } });
      option.selected = this.taskFilter === value;
    }
    filter.addEventListener('change', () => { this.taskFilter = filter.value; this.taskPage = 0; this.render(); });

    const query = this.taskSearch.trim().toLowerCase();
    const allFiltered = tasks.filter((task) => {
      const statusMatches = this.taskFilter === 'all'
        || (this.taskFilter === 'processing' ? PROCESSING_STATUSES.has(task.status) : task.status === this.taskFilter);
      return statusMatches && (!query || String(task.source_path || '').toLowerCase().includes(query));
    });
    const maxPage = Math.max(0, Math.ceil(allFiltered.length / this.taskPageSize) - 1);
    this.taskPage = Math.min(this.taskPage, maxPage);
    const filtered = allFiltered.slice(this.taskPage * this.taskPageSize, (this.taskPage + 1) * this.taskPageSize);
    if (!filtered.length) {
      parent.createDiv({ cls: 'eks-empty', text: '没有符合当前筛选条件的任务。' });
      return;
    }
    const list = parent.createDiv({ cls: 'eks-task-list', attr: { 'aria-live': 'polite' } });
    for (const task of filtered) {
      const details = list.createEl('details', { cls: 'eks-task-detail' });
      const summary = details.createEl('summary');
      const checkbox = summary.createEl('input', { attr: { type: 'checkbox', 'aria-label': `选择任务 ${task.source_path || task.task_id}` } });
      checkbox.checked = this.selectedTaskIds.has(task.task_id);
      checkbox.addEventListener('click', (event) => event.stopPropagation());
      checkbox.addEventListener('change', () => checkbox.checked ? this.selectedTaskIds.add(task.task_id) : this.selectedTaskIds.delete(task.task_id));
      summary.createSpan({ cls: 'eks-status-text', text: stageLabel(task.status) });
      summary.createSpan({ cls: 'eks-task-title', text: task.source_path || '(未知文件)' });
      const meta = details.createDiv('eks-task-detail-grid');
      const error = task.errors?.at(-1);
      for (const [label, value] of [
        ['当前阶段', stageLabel(task.progress?.stage || task.status)],
        ['已用时间', formatDuration(task.progress?.elapsedMs || 0)],
        ['重试次数', String(task.retry_count || task.attempt || 0)],
        ['结果数量', String(task.semantic_path === 'universal'
          ? Number(task.result_counts?.verified) || 0
          : Number(task.result_counts?.written) || task.written_card_ids?.length || 0)],
        ['最后更新', formatLocalTime(task.updated_at || task.progress?.at || '')],
        ['错误代码', error?.code || '-']
      ]) {
        meta.createDiv({ text: label, cls: 'eks-task-meta' });
        meta.createDiv({ text: value || '-', cls: 'eks-detail-value' });
      }
      if (task.status === 'completed_no_output') {
        const counts = task.result_counts || {};
        details.createDiv({
          cls: 'eks-review-reason',
          text: `未生成可入库结果：生成 ${Number(counts.generated) || 0}，写入 ${Number(counts.written) || 0}。${safeDisplayText(task.progress?.message, '未发现可由来源逐字核验的知识；请检查正文解析与证据定位后重试。')}`
        });
      }
      const outputPaths = Array.isArray(task.output_paths)
        ? (task.semantic_path === 'universal' ? task.output_paths.slice(0, Number(task.result_counts?.verified) || 0) : task.output_paths)
        : [];
      if (outputPaths.length) {
        const outputs = details.createEl('details', { cls: 'eks-technical-details' });
        outputs.createEl('summary', { text: `知识记录路径（${outputPaths.length}）` });
        for (const outputPath of outputPaths) {
          const row = outputs.createDiv('eks-row-actions');
          row.createSpan({ text: safeDisplayText(outputPath, '知识记录') });
          button(row, '打开', () => this.plugin.app.workspace.openLinkText(outputPath, '', false));
        }
      }
      const timeline = details.createDiv({ cls: 'eks-timeline', attr: { 'aria-label': '任务阶段时间线' } });
      const order = ['parsing', 'classification', 'summary-map', 'atomization', 'validating', 'writing', 'complete'];
      const currentIndex = Math.max(0, order.indexOf(task.progress?.stage || task.status));
      order.forEach((stage, index) => {
        timeline.createSpan({
          cls: `eks-timeline-step ${index < currentIndex ? 'is-complete' : index === currentIndex ? 'is-current' : ''}`,
          text: `${index < currentIndex ? '✓ ' : index === currentIndex ? '● ' : '○ '}${stageLabel(stage)}`
        });
      });
      const actions = details.createDiv('eks-row-actions');
      if (['failed', 'needs_ocr'].includes(task.status)) button(actions, '重试', () => this.plugin.retryTask(task.task_id));
      if (PROCESSING_STATUSES.has(task.status)) button(actions, '取消', () => this.plugin.cancelCurrentTask(task.task_id));
      button(actions, '打开源文件', () => this.plugin.app.workspace.openLinkText(task.source_path, '', false));
    }
    const batch = parent.createDiv('eks-task-controls');
    button(batch, `选择本页（${filtered.length}）`, () => { for (const task of filtered) this.selectedTaskIds.add(task.task_id); this.render(); });
    button(batch, `重试所选（${this.selectedTaskIds.size}）`, async () => {
      for (const id of [...this.selectedTaskIds]) await this.plugin.retryTask(id);
      this.selectedTaskIds.clear();
    });
    button(batch, '取消所选', () => { for (const id of this.selectedTaskIds) this.plugin.cancelCurrentTask(id); });
    button(batch, '上一页', () => { this.taskPage = Math.max(0, this.taskPage - 1); this.render(); }, this.taskPage === 0);
    button(batch, '下一页', () => { this.taskPage = Math.min(maxPage, this.taskPage + 1); this.render(); }, this.taskPage >= maxPage);
    batch.createSpan({ cls: 'eks-task-meta', text: `第 ${this.taskPage + 1}/${maxPage + 1} 页 · 共 ${allFiltered.length} 项` });
  }

  async renderShadowEvaluation(parent, tasks) {
    const report = await this.plugin.shadowReport();
    parent.createEl('h3', { text: '生产影子评估' });
    parent.createDiv({
      cls: 'eks-task-meta',
      text: this.plugin.settings.shadowEvaluationEnabled
        ? `已启用 · provider 请求预算 ${this.plugin.settings.shadowProviderBudget} · 保留 ${report.aggregate.documents} 条`
        : '默认关闭；启用前不会运行，也不会增加任何 provider 请求。'
    });
    const actions = parent.createDiv('eks-actions');
    button(actions, '运行确定性代表队列', () => this.plugin.runShadowEvaluation());
    if (this.selectedTaskIds.size) {
      button(actions, `运行选中任务（${this.selectedTaskIds.size}）`, () => this.plugin.runShadowEvaluation([...this.selectedTaskIds]));
    }
    if (this.plugin._shadowRunning) button(actions, '取消影子评估', () => this.plugin.cancelShadowEvaluation());
    button(actions, '保存当前基线', () => this.plugin.saveShadowBaseline());
    button(actions, '导出 JSON / Markdown', () => this.plugin.exportShadowReport());
    const aggregate = report.aggregate;
    const grid = parent.createDiv('eks-summary-line');
    grid.createSpan({ text: `文档 ${aggregate.documents}` });
    grid.createSpan({ text: `卡片候选 ${aggregate.counts.cards}` });
    grid.createSpan({ text: `审核 ${aggregate.counts.review}` });
    grid.createSpan({ text: `请求 ${aggregate.provider.requests}` });
    parent.createDiv({ cls: 'eks-task-meta', text: `证据定位核验率 ${formatMetricRate(aggregate.quality.locator_evidence_verification_rate)} · 总结覆盖率 ${formatMetricRate(aggregate.quality.summary_coverage_rate)} · 缓存命中 ${aggregate.cache_hits}` });
    if (report.comparison) {
      parent.createEl('h4', { text: '相对最近基线' });
      parent.createEl('pre', { text: JSON.stringify(report.comparison.deltas, null, 2) });
    }
    if (Object.keys(aggregate.typed_reasons || {}).length) {
      parent.createEl('h4', { text: '类型化失败 / 审核原因' });
      parent.createEl('pre', { text: JSON.stringify(aggregate.typed_reasons, null, 2) });
    }
    parent.createDiv({ cls: 'eks-empty', text: '影子模式不写知识卡片、MOC 或索引，也不改变任务终态。当前版本不支持从影子结果直接提升；需回到正常任务显式处理。' });
  }

  renderSemanticStatus(parent) {
    const snapshot = semanticSettingsSnapshot(this.plugin.settings);
    const metrics = this.plugin.semanticProcessor?.metrics || {};
    parent.createEl('h3', { text: '语义嵌入影子处理' });
    parent.createDiv({ cls: 'eks-task-meta', text: snapshot.enabled
      ? `运行中/可运行 · ${snapshot.model} · ${snapshot.dimensions} 维 · 队列 ${this.plugin.semanticProcessor?.queue?.length || 0}`
      : '默认关闭。需要先在设置中明确同意外部嵌入并启用。' });
    const grid = parent.createDiv('eks-summary-line');
    grid.createSpan({ text: `已处理 ${metrics.processed || 0}` });
    grid.createSpan({ text: `缓存命中 ${metrics.cacheHits || 0}` });
    grid.createSpan({ text: `建议 ${metrics.suggestions || 0}` });
    grid.createSpan({ text: `非阻塞失败 ${metrics.failed || 0}` });
    parent.createDiv({ cls: 'eks-task-meta', text: `相关阈值 ${snapshot.relatedThreshold} · 重复候选阈值 ${snapshot.duplicateThreshold} · 精确比较 ${metrics.comparisons || 0}` });
    const actions = parent.createDiv('eks-actions');
    button(actions, '立即运行', () => this.plugin.runSemanticIndex());
    button(actions, '重建索引', async () => {
      if (typeof window !== 'undefined' && !window.confirm('确认重建独立语义索引？')) return;
      await this.plugin.rebuildSemanticIndex();
    });
    button(actions, '清空语义数据', async () => {
      if (typeof window !== 'undefined' && !window.confirm('确认清空语义缓存、索引、队列和建议？')) return;
      await this.plugin.clearSemanticIndex();
    });
    parent.createDiv({ cls: 'eks-empty', text: '输出仅为脱敏指标与审核建议；不会自动合并、删除、改状态、写关系或修改 Markdown。' });
  }

  renderErrorCenter(parent, tasks) {
    const errors = tasks
      .filter((task) => task.status === 'failed')
      .flatMap((task) => (task.errors || []).slice(-1).map((error) => ({ task, error })));
    if (!errors.length) {
      parent.createDiv({ cls: 'eks-empty', text: '暂无错误。' });
      return;
    }
    const groups = new Map();
    for (const entry of errors) {
      const key = entry.error.code || 'INTERNAL_UNEXPECTED';
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(entry);
    }
    for (const [code, entries] of groups) {
      const details = parent.createEl('details', { cls: 'eks-error-group' });
      if (entries.some((entry) => entry.task.task_id === this.expandedErrorTaskId)) details.open = true;
      const groupText = explainIssue(entries[0]?.error);
      details.createEl('summary', { text: `${groupText.kind} · ${entries.length} 项` });
      for (const { task, error } of entries.slice(0, 20)) {
        const item = details.createDiv('eks-error-item');
        if (task.task_id === this.expandedErrorTaskId) {
          item.addClass('is-terminal-target');
          item.setAttribute('data-task-id', task.task_id);
        }
        const explanation = explainIssue(error);
        item.createEl('strong', { text: explanation.happened });
        item.createDiv({ cls: 'eks-task-meta', text: `${task.source_path || '(未知文件)'} · ${stageLabel(error.stage || task.status)}` });
        item.createDiv({ text: `影响：${explanation.effect}` });
        item.createDiv({ text: `建议：${error.suggestedAction || explanation.action}` });
        const technical = item.createEl('details', { cls: 'eks-technical-details' });
        technical.createEl('summary', { text: '技术详情' });
        technical.createEl('pre', { text: JSON.stringify({ code, task_id: task.task_id, run_id: task.run_id, error }, null, 2) });
        const reportActions = item.createDiv('eks-row-actions');
        button(reportActions, '复制脱敏诊断报告', () => this.plugin.copyDiagnosticReport(task));
        reportActions.createSpan({ cls: 'eks-task-meta', text: '发送复制出的完整报告；不要发送源文件或 API Key。' });
      }
      if (entries.length > 20) details.createDiv({ cls: 'eks-task-meta', text: `当前显示前 20 项，其余 ${entries.length - 20} 项可通过任务筛选查看。` });
    }
  }

  async renderContentLegacy(container) {
    const tasks = await this.plugin.loadTasks();
    const counts = statusCounts(tasks);

    const overview = container.createDiv('eks-panel eks-overview');
    const header = overview.createDiv('eks-header');
    header.createEl('h3', { text: '总览' });
    const actions = header.createDiv('eks-actions');
    button(actions, '扫描并自动处理', () => this.plugin.scanSourceFiles(true));
    button(actions, '自动处理可信卡片', () => this.plugin.autoProcessQueue(true));
    button(actions, '重试失败并处理', () => this.plugin.retryFailedAndAutoProcess(true));
    button(actions, '打开设置', () => this.plugin.openSettings());

    const stats = overview.createDiv('eks-stats');
    stat(stats, '待处理', counts.pending);
    stat(stats, '处理中', counts.processing);
    stat(stats, '待审核', counts.needsReview);
    stat(stats, '失败', counts.failed);
    stat(stats, '已入库', counts.written);
    stat(stats, '已跳过', counts.skipped);

    const queue = container.createDiv('eks-panel eks-queue');
    queue.createEl('h3', { text: '处理概览' });
    this.renderQueue(queue, tasks);

    const review = container.createDiv('eks-panel eks-review');
    review.createEl('h3', { text: '审核工作台' });
    const reviewScroll = review.createDiv('eks-review-scroll');
    await this.renderReview(reviewScroll, tasks);

    const paths = container.createDiv('eks-paths');
    paths.createSpan({ text: `源文件入口：${this.plugin.settings.intakePath}` });
    paths.createSpan({ text: `入库输出：${this.plugin.settings.outputPath}` });
    paths.createSpan({ text: '可信卡片自动写入 wiki；疑问项进入审核台。' });
    paths.createSpan({ text: '默认分类目录：wiki/category/tagL1/tagL2' });
  }

  renderQueue(parent, tasks) {
    const historical = tasks.filter((task) => ['written', 'skipped', 'unsupported'].includes(task.status)).length;
    const reviewCount = tasks.reduce((sum, task) => sum + (task.review_atom_ids || []).length, 0);
    const activeTask = tasks.find((task) => PROCESSING_STATUSES.has(task.status));
    const stats = this.plugin.sessionStats || {};
    const progressData = activeTask?.progress || {};
    const grid = parent.createDiv('eks-compact-stats');
    const progress = grid.createDiv('eks-progress-message');
    progress.createDiv({ cls: 'eks-progress-title', text: `当前进度 · ${stageLabel(activeTask?.status || progressData.stage)}` });
    progress.createDiv({ cls: 'eks-progress-text', text: progressData.message || stats.lastMessage || '等待开始处理' });
    // v1.1.8: HTML5 进度条，按 batch 或 chunk 进度填充
    const progressTotal = Number(progressData.batchTotal) || Number(progressData.chunkTotal) || 0;
    const progressIndex = Number(progressData.batchIndex) || Number(progressData.chunkIndex) || 0;
    if (progressTotal > 0) {
      progress.createEl('progress', {
        cls: 'eks-progress-bar',
        attr: { max: String(progressTotal), value: String(progressIndex) }
      });
      const etaText = computeEtaText(progressData);
      const label = progressData.batchTotal
        ? `原子化：${progressIndex}/${progressTotal}${etaText ? ' · ' + etaText : ''}`
        : `MiniMax 分块：${progressIndex}/${progressTotal}；第 ${progressData.attempt || 1} 次请求`;
      progress.createDiv({ cls: 'eks-task-meta', text: label });
    } else if (progressData.chunkTotal || progressData.chunkIndex) {
      progress.createDiv({ cls: 'eks-task-meta', text: `MiniMax 分块：${progressData.chunkIndex || 0}/${progressData.chunkTotal || '?'}；第 ${progressData.attempt || 1} 次请求` });
    }
    if (progressData.totalPages || progressData.extractedPages) {
      progress.createDiv({ cls: 'eks-task-meta', text: `解析页数：${progressData.extractedPages || 0}/${progressData.totalPages || '?'}` });
    }
    if (progressData.elapsedMs !== undefined) {
      progress.createDiv({
        cls: 'eks-task-meta elapsed',
        text: `已用时：${formatDuration(progressData.elapsedMs)} · 最后更新：${formatLocalTime(progressData.at)}`
      });
    } else if (progressData.at) {
      progress.createDiv({ cls: 'eks-task-meta', text: `最后更新：${formatLocalTime(progressData.at)}` });
    }
    stat(grid, '过往已处理', historical);
    stat(grid, '本次处理文件', stats.processed || 0);
    stat(grid, '本次已入库卡片', stats.written || 0);
    stat(grid, '异常项', reviewCount);
    const currentFile = activeTask?.source_path || stats.current;
    if (currentFile) parent.createDiv({ cls: 'eks-task-meta', text: `当前文件：${currentFile}` });
    const actions = parent.createDiv('eks-actions');
    button(actions, '继续自动处理', () => this.plugin.autoProcessQueue(true));
    if (activeTask) {
      button(actions, '完成当前阶段后暂停', () => this.plugin.pauseProcessing());
      button(actions, '取消当前任务', () => this.plugin.cancelCurrentTask(activeTask.task_id));
    }

    const exceptions = tasks.filter((task) => ['failed', 'skipped', 'unsupported'].includes(task.status));
    if (exceptions.length) {
      // v1.2: 失败/跳过原因不再直接展示在 dashboard 上（用户视角噪声太大）。
      //   改为只收集统计 + 写一条 diag 日志；详情见审核工作台 → "查看异常详情" 按钮。
      const reasons = new Map();
      for (const task of exceptions) {
        const reason = task.errors?.at(-1)?.message || stageLabel(task.status);
        reasons.set(reason, (reasons.get(reason) || 0) + 1);
      }
      const summary = [...reasons].map(([reason, count]) => `${reason} (${count})`).join('；');
      if (typeof globalThis.__eksDiag === 'object' && typeof globalThis.__eksDiag.diag === 'function') {
        globalThis.__eksDiag.diag('dashboard.exceptions.summary', { total: exceptions.length, breakdown: summary });
      }
    }
  }

  renderQueueLegacy(parent, tasks) {
    const historical = tasks.filter((task) => ['written', 'archived', 'skipped'].includes(task.status)).length;
    const pending = tasks.filter((task) => task.status === 'queued').length;
    const review = tasks.filter((task) => task.status === 'needs_review').length;
    const activeTask = tasks.find((task) => PROCESSING_STATUSES.has(task.status));
    const stats = this.plugin.sessionStats || {};
    const activeMessage = activeTask?.progress?.message || stats.lastMessage || '等待开始处理';
    const grid = parent.createDiv('eks-compact-stats');
    const progress = grid.createDiv('eks-progress-message');
    progress.createDiv({ cls: 'eks-progress-title', text: '当前进度' });
    progress.createDiv({ cls: 'eks-progress-text', text: activeMessage });
    if (activeTask?.progress?.chunkTotal) {
      progress.createDiv({
        cls: 'eks-task-meta',
        text: `AI 分段：${activeTask.progress.chunkIndex}/${activeTask.progress.chunkTotal}；累计卡片：${activeTask.progress.cardCount || 0}`
      });
    }
    if (activeTask?.progress?.at) {
      progress.createDiv({ cls: 'eks-task-meta', text: `最后更新：${formatLocalTime(activeTask.progress.at)}` });
    }
    stat(grid, '过往已处理', historical);
    stat(grid, '本次处理', stats.processed || 0);
    stat(grid, '本次已处理', stats.written || 0);
    stat(grid, '疑问项', review);
    stat(grid, '待自动处理', pending);
    const currentFile = activeTask?.sourcePath || stats.current;
    if (currentFile) parent.createDiv({ cls: 'eks-task-meta', text: `当前文件：${currentFile}` });
    const actions = parent.createDiv('eks-actions');
    button(actions, '继续自动处理', () => this.plugin.autoProcessQueue(true));
  }

  async renderReview(parent, tasks, renderVersion = this._renderVersion) {
    // v2.9.0: 会话级「处理失败」区块——失败记录重启后由 sessionStartupCleanup
    //   自动清除，所以这里只会展示本次会话内的失败，满足"关机即删、重开不显示"。
    const failedTasks = tasks.filter((task) => task.status === 'failed');
    if (failedTasks.length) {
      const block = parent.createDiv('eks-review-group eks-failed-group');
      block.createEl('h4', { text: `处理失败的文件（${failedTasks.length} 个 · 重启 Obsidian 后自动清空）` });
      for (const task of failedTasks) {
        const item = block.createDiv('eks-failed-item');
        item.createEl('strong', { text: task.source_path || '(未知文件)' });
        const lastError = Array.isArray(task.errors) && task.errors.length ? task.errors.at(-1) : null;
        const explanation = explainIssue(lastError || {});
        item.createDiv({
          cls: 'eks-task-meta',
          text: `${explanation.happened} ${explanation.effect}`
        });
        item.createDiv({ cls: 'eks-review-reason', text: `建议：${lastError?.suggestedAction || explanation.action}` });
        const technical = item.createEl('details', { cls: 'eks-technical-details' });
        technical.createEl('summary', { text: '技术详情' });
        technical.createEl('pre', { text: JSON.stringify({ task_id: task.task_id, run_id: task.run_id, stage: lastError?.stage || task.progress?.stage, error: lastError }, null, 2) });
        const actions = item.createDiv('eks-actions');
        button(actions, '重试', () => this.plugin.retryTask(task.task_id));
        button(actions, '移除', () => this.plugin.dismissTask(task.task_id));
      }
    }
    const reviewTasks = tasks.filter((task) =>
      ['needs_review', 'completed_no_output'].includes(task.status)
      && Array.isArray(task.review_atom_ids)
      && task.review_atom_ids.length > 0
      && task.artifacts?.review
    );
    if (!reviewTasks.length) {
      if (!failedTasks.length) {
        parent.createDiv({ cls: 'eks-empty', text: '暂无异常项。可信结果会自动入库，不需要逐条审核。' });
      }
      return;
    }
    for (const task of reviewTasks) {
      const artifact = await this.plugin.loadArtifact(task, 'review');
      if (renderVersion !== this._renderVersion) return;
      if (!artifact) continue;
      if (artifact.semantic_path === 'universal') {
        const groups = Array.isArray(artifact.structured_handling_groups) ? artifact.structured_handling_groups : [];
        const summary = parent.createDiv('eks-review-document-summary');
        summary.createEl('h4', { text: `统一结构化审核 · ${safeDisplayText(task.source_path, '源文件')}` });
        summary.createDiv({ text: `${safeDisplayText(artifact.structured_summary, '计划需要确认')} · 待处理 ${groups.length} 项` });
        for (const [position, group] of groups.entries()) {
          const id = String(group.decision_id || group.conflict_id || group.group_id || `universal-${position}`);
          const kind = group.__kind || (group.conflict_id ? 'conflict' : 'review');
          const hard = kind === 'conflict' || group.hard === true || group.blocking === true;
          const block = parent.createDiv('eks-review-group');
          block.createEl('h4', { text: hard ? '需要修正的硬冲突' : '需要确认的处理建议' });
          block.createDiv({ cls: 'eks-review-reason', text: safeDisplayText(group.reason || group.cause || group.summary || group.message, '当前规则无法安全自动决定。') });
          block.createDiv({ cls: 'eks-task-meta', text: safeDisplayText(group.title || group.label || group.record_id || group.unit_id, '未命名知识项') });
          const actions = block.createDiv('eks-actions');
          if (!hard) button(actions, '接受建议', () => this.plugin.applyReviewGroup(task.task_id, id, 'accept_suggestion'));
          button(actions, '丢弃此项', () => this.plugin.applyReviewGroup(task.task_id, id, 'discard_group'));
          button(actions, '修正规则或路由', async () => {
            const raw = window.prompt('输入 JSON，可用字段：library / category / directory_category / record_kind / route', '{"category":""}');
            if (!raw) return;
            try { await this.plugin.applyReviewGroup(task.task_id, id, 'apply_correction', JSON.parse(raw)); }
            catch (error) { new Notice(error.message); }
          });
          button(actions, '重新生成/重新规划', () => this.plugin.applyReviewGroup(task.task_id, id, 'regenerate_group'));
          button(actions, '转人工', () => this.plugin.applyReviewGroup(task.task_id, id, 'manual_group'));
        }
        continue;
      }
      if (artifact.outcome?.kind === 'review_required') {
        const block = parent.createDiv('eks-review-group');
        block.createEl('h4', { text: `源文件需要审核 · ${artifact.outcome.code}` });
        block.createDiv({ cls: 'eks-task-meta', text: task.source_path });
        block.createDiv({ cls: 'eks-review-reason', text: artifact.outcome.message });
        const details = block.createEl('details', { cls: 'eks-technical-details' });
        details.createEl('summary', { text: '技术详情' });
        details.createEl('pre', { text: JSON.stringify(artifact.outcome, null, 2) });
        continue;
      }
      const taskMetrics = artifact.metrics || {
        candidateCards: artifact.items.length,
        autoApproved: Number(task.written_card_ids?.length) || 0,
        reviewPending: artifact.items.length,
        hardRejected: Number(artifact.rejected?.length) || 0,
        merged: 0,
        automaticallyRepaired: artifact.items.filter((item) => item.review_context?.automatic_repair?.repaired).length
      };
      const documentSummary = parent.createDiv('eks-review-document-summary');
      documentSummary.createEl('h4', { text: '文档处理结果' });
      const originalCandidates = Number(taskMetrics.stageCardinalities?.atom_candidates)
        || Number(taskMetrics.candidateCards || 0) + Number(taskMetrics.merged || 0) + Number(taskMetrics.hardRejected || 0);
      documentSummary.createDiv({ text: `原始候选 ${originalCandidates} → 归并后 ${taskMetrics.stageCardinalities?.consolidated ?? taskMetrics.candidateCards} → 自动通过 ${taskMetrics.autoApproved} · 定向审核 ${taskMetrics.reviewPending} · 拒绝 ${taskMetrics.hardRejected || 0} · 合并 ${taskMetrics.merged || 0}` });
      if (Array.isArray(artifact.rejected) && artifact.rejected.length) {
        const grouped = {};
        for (const item of artifact.rejected) {
          const code = String(item?.reason_codes?.[0] || 'UNKNOWN_HARD_REJECT');
          grouped[code] = (grouped[code] || 0) + 1;
        }
        documentSummary.createDiv({
          cls: 'eks-review-reason',
          text: `硬拒绝（无需逐条人工审核）：${Object.entries(grouped).map(([code, count]) => `${code} ${count}`).join('；')}。建议先修复来源解析或证据定位，再从检查点重试。`
        });
      }
      for (const group of groupReviewItems(artifact.items)) {
        const block = parent.createDiv('eks-review-group');
        const header = block.createDiv('eks-review-group-header');
        header.createEl('h4', { text: `待确认内容（${group.items.length} 项）` });
        const scores = group.items.map((item) => Number(item.confidence?.score || 0));
        const average = scores.length ? scores.reduce((sum, value) => sum + value, 0) / scores.length : 0;
        block.createDiv({ cls: 'eks-task-meta', text: `${task.source_path} · 平均可信度 ${average.toFixed(2)}` });
        const groupExplanation = explainIssue({ reasons: group.reasons });
        block.createDiv({ cls: 'eks-review-reason', text: `${groupExplanation.kind}：${groupExplanation.happened}` });
        const samples = group.items.slice(0, 3).map((item) => item.atom?.title).filter(Boolean);
        if (samples.length) block.createDiv({ cls: 'eks-task-meta', text: `示例：${samples.join('；')}${group.items.length > 3 ? '…' : ''}` });
        const actions = block.createDiv('eks-actions');
        const eligibleCount = group.items.filter(isApprovalEligible).length;
        button(actions, `查看并处理（可批准 ${eligibleCount}）`, () => {
          new ReviewExceptionModal(this.app, group, task.source_path, {
            onAction: (ids, action, reason) => this.plugin.applyReviewSelection(task.task_id, group.group_id, ids, action, reason),
            onWholeRegenerate: () => this.plugin.applyReviewGroup(task.task_id, group.group_id, 'regenerate_group')
          }).open();
        });
        button(actions, '批量修正标签', async () => {
          // v1.4 (M-05): prompt 文案明确白名单，避免用户误以为能改任意字段
          const initial = '{"Category":"","TagL1":"","TagL2":""}';
          const hint = '输入 JSON 修正标签；只接受白名单字段：Category / TagL1 / TagL2 / Info_Type / Event_Type / Card_Type / Map_Index；空字符串视为不修改该字段；其他字段或非字符串会被拒绝。';
          const raw = window.prompt(hint, initial);
          if (!raw) return;
          try {
            await this.plugin.applyReviewGroup(task.task_id, group.group_id, 'apply_correction', JSON.parse(raw));
          } catch (error) {
            new Notice(`批量修正失败：${error.message}`);
          }
        });
        button(actions, '仅重做知识原子', () => this.plugin.applyReviewGroup(task.task_id, group.group_id, 'regenerate_group'));
        button(actions, '整组丢弃', () => this.plugin.applyReviewGroup(task.task_id, group.group_id, 'discard_group'));
      }
    }
  }

  async renderReviewLegacy(parent, tasks) {
    if (typeof process !== 'object' || process?.env?.EKS_ENABLE_NONPRODUCTION_LEGACY !== '1') {
      throw new Error('LEGACY_REVIEW_UI_DISABLED: production review must use v2 artifacts');
    }
    const reviewTasks = tasks.filter((task) => task.status === 'needs_review' && task.draftFiles && task.draftFiles.length);
    if (!reviewTasks.length) {
      parent.createDiv({ cls: 'eks-empty', text: '暂无待审核草稿卡片。' });
      return;
    }
    for (const task of reviewTasks) {
      const block = parent.createDiv('eks-draft-block');
      block.createEl('h4', { text: task.sourcePath });
      for (const draftPath of task.draftFiles) {
        const file = this.app.vault.getAbstractFileByPath(draftPath);
        const draft = file instanceof TFile ? await this.app.vault.read(file) : '';
        const item = block.createDiv('eks-draft');
        item.createDiv({ cls: 'eks-task-meta', text: draftPath });
        this.renderDraftSummary(item, draft, task);
        const actions = item.createDiv('eks-actions');
        button(actions, '批准入库', () => this.plugin.approveDraft(task.taskId, draftPath));
        button(actions, '打开草稿', () => this.app.workspace.openLinkText(draftPath, '', false));
        button(actions, '重新生成', () => this.plugin.retryTask(task.taskId));
        button(actions, '退回/跳过', () => this.plugin.skipTask(task.taskId));
      }
    }
  }

  renderDraftSummary(parent, draft, task) {
    parent.createEl('h4', { text: `疑问项 ${task.taskId}` });
    const fields = ['Map_Index', 'Category', 'TagL1', 'TagL2', 'Status', 'Confidence'];
    const table = parent.createEl('table', { cls: 'eks-draft-table' });
    for (const field of fields) {
      const tr = table.createEl('tr');
      tr.createEl('th', { text: field });
      tr.createEl('td', { text: readFrontmatterValue(draft, field) || '-' });
    }
  }
}

class SlicerSettingTab extends PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display() {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl('h2', { text: '工程知识切片设置' });
    containerEl.createEl('p', {
      text: '这里只需填写当前功能需要的密钥。其他参数已采用安全默认值，无需设置。'
    });

    credentialSetting(containerEl, this.plugin, {
      name: 'MiniMax 密钥',
      desc: '用于整理文档并生成知识卡片。密钥只保存在本机。',
      key: 'minimaxApiKey',
      placeholder: '请输入密钥',
      service: 'minimax'
    });

    if (this.plugin.settings.pdfAllowExternalUpload === true) {
      containerEl.createEl('h3', { text: '云端文档识别' });
      containerEl.createEl('p', { text: '你已启用云端文档识别。按实际使用的服务填写密钥即可。' });
      credentialSetting(containerEl, this.plugin, {
        name: 'MinerU 密钥',
        desc: '用于识别扫描件和复杂版式文档。',
        key: 'pdfMineruApiKey',
        placeholder: '请输入密钥',
        service: 'mineru'
      });
      credentialSetting(containerEl, this.plugin, {
        name: 'PaddleOCR 密钥',
        desc: '用于补充识别扫描件。',
        key: 'pdfPaddleOcrApiKey',
        placeholder: '请输入密钥',
        service: 'paddleocr'
      });
    } else {
      new Setting(containerEl)
        .setName('文档识别')
        .setDesc('当前使用本地识别，不需要填写云端识别密钥。');
    }

    if (this.plugin.settings.semanticConsent === true && this.plugin.settings.semanticEnabled === true) {
      containerEl.createEl('h3', { text: '相似内容查找' });
      credentialSetting(containerEl, this.plugin, {
        name: '阿里云百炼密钥',
        desc: '你已启用相似内容查找，此密钥用于该功能。',
        key: 'embeddingApiKey',
        placeholder: '请输入密钥',
        service: 'semantic'
      });
    }

    containerEl.createEl('p', {
      text: '密钥不会写入知识库、诊断报告或日志。'
    });

    new Setting(containerEl)
      .setName('高级设置')
      .setDesc('默认关闭。开启后显示功能开关、解析参数、性能与维护选项；关闭不会清除已保存的配置。')
      .addToggle((toggle) => toggle
        .setValue(this.plugin.settings.advancedSettingsEnabled === true)
        .onChange(async (value) => {
          this.plugin.settings.advancedSettingsEnabled = value === true;
          await this.plugin.saveSafeSettings();
          this.display();
        }));

    if (this.plugin.settings.advancedSettingsEnabled === true) {
      this.renderAdvancedSettings(containerEl);
    }
  }

  renderAdvancedSettings(containerEl) {
    containerEl.createEl('h2', { text: '高级设置' });
    new Setting(containerEl)
      .setName('结构化事务写入')
      .setDesc('生产会话始终启用；写入受冲突审核、限额、验证和安全回滚保护。');
    {
      new Setting(containerEl)
        .setName('两库根目录')
        .setDesc(`在办：${this.plugin.settings.structuredActiveRoot}；长期：${this.plugin.settings.structuredBusinessRoot}。仅允许 vault 内安全相对路径，首次运行前仍会再次校验。`);
    }
    // v1.2: 一键打开诊断日志，方便没 DevTools 环境的用户直接查看文件路径
    // v1.3: 默认日志在 vault 之外（~/.eks/logs/diag.log），避开同步冲突；
    //       勾选"写到 vault 内"则回退到 .obsidian/plugins/engineering-knowledge-slicer/diag.log。
    const diagPathDesc = (typeof globalThis.__eksDiag === 'object' && globalThis.__eksDiag.state && globalThis.__eksDiag.state.logPath)
      ? `所有 [EKS diag] 事件写入 ${globalThis.__eksDiag.state.logPath}。遇到问题时把文件内容发给我即可定位。`
      : '所有 [EKS diag] 事件写入 ~/.eks/logs/diag.log（默认）。遇到问题时把文件内容发给我即可定位。';
    new Setting(containerEl)
      .setName('诊断日志')
      .setDesc(diagPathDesc)
      .addToggle((toggle) => toggle
        .setValue(!!this.plugin.settings.diagLogInVault)
        .setTooltip('默认关闭：日志写到 ~/.eks/logs/diag.log（vault 之外）。打开后回到 vault 内的 .obsidian/plugins/engineering-knowledge-slicer/diag.log（重启后生效）。')
        .onChange(async (value) => {
          this.plugin.settings.diagLogInVault = !!value;
          await this.plugin.saveSafeSettings();
        }))
      .addButton((button) => button
        .setButtonText('打开诊断日志')
        .setCta()
        .onClick(async () => {
          const logPath = (typeof globalThis.__eksDiag === 'object' && globalThis.__eksDiag.state)
            ? globalThis.__eksDiag.state.logPath
            : null;
          if (!logPath) {
            new Notice('诊断日志尚未初始化，请先等待插件加载完成或重载。');
            return;
          }
          // 把 vault 绝对路径转回 vault-相对路径，以便 openLinkText 能在 vault 中定位文件
          let relPath = logPath;
          let inVault = false;
          try {
            const adapter = this.app.vault && this.app.vault.adapter;
            if (adapter && typeof adapter.getBasePath === 'function') {
              const basePath = adapter.getBasePath();
              if (basePath && relPath.startsWith(basePath)) {
                relPath = relPath.substring(basePath.length).replace(/^[\\/]+/, '');
                inVault = true;
              }
            }
          } catch (_) { /* fallback: 直接试绝对路径 */ }
          if (inVault) {
            let file = this.app.vault.getAbstractFileByPath(relPath);
            if (!file && relPath !== logPath) file = this.app.vault.getAbstractFileByPath(logPath);
            if (!file) {
              try { file = await this.app.vault.create(relPath, ''); } catch (_) { /* 文件可能已存在，忽略 */ }
            }
            if (file instanceof TFile) {
              await this.app.workspace.openLinkText(relPath, '', false);
              return;
            }
          }
          // 日志在 vault 之外 / openLinkText 不可用：先确保文件存在，再用系统默认编辑器打开
          try {
            const { shell } = require('electron');
            await shell.openPath(logPath);
            new Notice(`诊断日志：${logPath}`);
          } catch (e) {
            new Notice(`诊断日志路径：${logPath}\n请在系统文件管理器中手动打开。`);
          }
        }));
    containerEl.createEl('h3', { text: '语义嵌入（可选 · 影子模式）' });
    const semantic = semanticSettingsSnapshot(this.plugin.settings);
    new Setting(containerEl)
      .setName('外部嵌入明确同意')
      .setDesc('开启表示同意将脱敏后的标题、分类、标签和规范化主张摘要发送到自配端点；不发送路径、原始证据、秘密、诊断或原文。')
      .addToggle((toggle) => toggle.setValue(semantic.consent).onChange(async (value) => {
        this.plugin.settings.semanticConsent = value === true;
        if (!value) this.plugin.settings.semanticEnabled = false;
        await this.plugin.saveSettings();
        this.display();
      }));
    new Setting(containerEl)
      .setName('启用卡片后处理')
      .setDesc('默认关闭且仅影子模式。只处理已成功入库的最终卡片；失败不会阻塞、降级或回滚卡片摄取。')
      .addToggle((toggle) => toggle.setValue(semantic.enabled).onChange(async (value) => {
        this.plugin.settings.semanticEnabled = value === true && this.plugin.settings.semanticConsent === true;
        await this.plugin.saveSettings();
        this.display();
      }));
    numberSetting(containerEl, this.plugin, '最大候选数', '精确余弦比较的硬上限，索引接口可替换为 ANN。', 'semanticMaxCandidates', 1, 5000);
    numberSetting(containerEl, this.plugin, 'Top K', '每张卡保留的最多审核建议数。', 'semanticTopK', 1, 50);
    new Setting(containerEl)
      .setName('语义影子操作')
      .setDesc(`状态：${semantic.enabled ? '已启用' : '未启用'}；阿里云百炼 ${semantic.model}；${semantic.dimensions} 维；单批最多 20；相关 ${semantic.relatedThreshold}；重复候选 ${semantic.duplicateThreshold}。建议不会自动写回 Markdown、关系、状态或合并。`)
      .addButton((control) => control.setButtonText('立即运行').onClick(() => this.plugin.runSemanticIndex()))
      .addButton((control) => control.setButtonText('重建索引').onClick(async () => {
        if (typeof window !== 'undefined' && !window.confirm('确认重建独立语义向量索引？不会清除解析/OCR/AI 检查点。')) return;
        await this.plugin.rebuildSemanticIndex();
      }))
      .addButton((control) => control.setButtonText('清空语义数据').setWarning().onClick(async () => {
        if (typeof window !== 'undefined' && !window.confirm('确认清空语义缓存、索引、队列和影子建议？知识卡片不会被修改。')) return;
        await this.plugin.clearSemanticIndex();
      }));

    containerEl.createEl('h3', { text: '生产影子评估（本地优先）' });
    new Setting(containerEl)
      .setName('启用影子评估')
      .setDesc('默认关闭。显式运行时复用正常解析/结构/质量逻辑和检查点，但不写卡片、MOC、索引，也不改变任务终态。')
      .addToggle((toggle) => toggle.setValue(this.plugin.settings.shadowEvaluationEnabled === true).onChange(async (value) => {
        this.plugin.settings.shadowEvaluationEnabled = value === true;
        await this.plugin.saveSafeSettings();
      }));
    numberSetting(containerEl, this.plugin, '影子 provider 请求总预算', '每次运行的硬上限；0 表示只用本地解析和已有检查点，绝不发起 provider 请求。', 'shadowProviderBudget', 0, 1000);
    numberSetting(containerEl, this.plugin, '代表队列样本上限', '按类型、解析器、大小、语言确定性分层轮询抽样。', 'shadowCohortLimit', 1, 500);
    numberSetting(containerEl, this.plugin, '脱敏样本保留上限', '超过后按完成时间保留最新记录。', 'shadowSampleLimit', 1, 5000);
    numberSetting(containerEl, this.plugin, '脱敏指标保留天数', '过期记录在下一次保存时清理。', 'shadowRetentionDays', 1, 3650);
    new Setting(containerEl)
      .setName('影子评估操作')
      .setDesc('报告只含稳定来源伪名、计数、比率、耗时、成本计数和类型化原因。')
      .addButton((control) => control.setButtonText('运行代表队列').onClick(() => this.plugin.runShadowEvaluation()))
      .addButton((control) => control.setButtonText('导出报告').onClick(() => this.plugin.exportShadowReport()));
    pathSetting(containerEl, this.plugin, '招投标源文件路径', '固定读取招投标源文件。', 'bidIntakePath');
    pathSetting(containerEl, this.plugin, '业务库源文件路径', '固定读取业务库源文件。', 'businessIntakePath');
    pathSetting(containerEl, this.plugin, '招投标输出路径', '招投标知识卡片固定输出根目录。', 'bidOutputPath');
    pathSetting(containerEl, this.plugin, '业务库输出路径', '业务知识卡片固定输出根目录。', 'businessOutputPath');
    pathSetting(containerEl, this.plugin, '中间产物路径', '解析包、结构化总结、审核项和脱敏日志目录。', 'artifactsPath');
    pathSetting(containerEl, this.plugin, '组件包路径', '标签库、提示词、模板和映射规则所在目录。', 'componentPackPath');

    new Setting(containerEl)
      .setName('自动入库置信度门槛')
      .setDesc('低于该置信度的卡片进入审核台；字段非法、MOC 待分类或证据不足的卡片始终进入审核台。')
      .addText((text) => text
        .setPlaceholder('0.9')
        .setValue(String(this.plugin.settings.autoApproveConfidenceThreshold || 0.9))
        .onChange(async (value) => {
          const threshold = Number(value);
          if (Number.isFinite(threshold)) {
            this.plugin.settings.autoApproveConfidenceThreshold = Math.round(Math.max(0.7, Math.min(1, threshold)) * 1000) / 1000;
            await this.plugin.saveSettings();
          }
        }));

    new Setting(containerEl)
      .setName('并发处理文档数')
      .setDesc('同时处理的源文件上限，建议 2-3，过高容易触发 API 限流。')
      .addText((text) => text
        .setPlaceholder('3')
        .setValue(String(this.plugin.settings.maxConcurrentDocuments || 3))
        .onChange(async (value) => {
          const n = Number(value);
          if (Number.isFinite(n) && n >= 1 && n <= 10) {
            this.plugin.settings.maxConcurrentDocuments = n;
            await this.plugin.saveSettings();
          }
        }));

    // v2.8: 自动扫描设置项，默认关闭
    new Setting(containerEl)
      .setName('启动时自动扫描')
      .setDesc('默认关闭。开启后每次打开 Obsidian 会自动扫描源文件目录（招投标 / 业务库）并开始自动处理。扫描会触发云端解析与 MiniMax 计费，建议保持关闭，需要时手动点控制台「扫描并自动处理」按钮或执行命令「扫描源文件」。')
      .addToggle((toggle) => toggle
        .setValue(this.plugin.settings.autoScanOnStartup === true)
        .onChange(async (value) => {
          this.plugin.settings.autoScanOnStartup = !!value;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName('启用外部密钥文件')
      .setDesc('开启后从 ~/.eks-secrets.json 读取密钥，避免 OneDrive/iCloud 同步目录中的 data.json 泄露密钥。')
      .addToggle((toggle) => toggle
        .setValue(this.plugin.settings.useEnvKeys !== false)
        .onChange(async (value) => {
          this.plugin.settings.useEnvKeys = value;
          await this.plugin.saveSettings();
        }));

    containerEl.createEl('h3', { text: 'MiniMax 结构化处理' });

    textSetting(containerEl, this.plugin, 'MiniMax 模型', '默认使用 MiniMax-M3，可按账户实际可用模型修改。', 'minimaxModel', 'MiniMax-M3');
    textSetting(containerEl, this.plugin, 'MiniMax M3 接口地址', '国内版默认使用 Anthropic 兼容接口，以支持更长的结构化输出。', 'minimaxEndpoint', 'https://api.minimaxi.com/anthropic/v1/messages');
    new Setting(containerEl)
      .setName('启用 SSE 流式输出 (POC)')
      .setDesc('调用 MiniMax 时走 text/event-stream，逐 token 累积 JSON 文本；失败时自动回退到非流式。需 Obsidian 桌面端（Electron 27+）。')
      .addToggle((control) => control
        .setValue(Boolean(this.plugin.settings.useStreamingAi))
        .onChange(async (value) => {
          this.plugin.settings.useStreamingAi = Boolean(value);
          await this.plugin.saveSafeSettings();
        }));
    new Setting(containerEl)
      .setName('知识卡片输出语言')
      .setDesc('源文件可为中文、英文或日文；调用 AI 时，标题、摘要和摘录统一生成中文。')
      .addDropdown((dropdown) => dropdown
        .addOption('zh-CN', '简体中文')
        .setValue(this.plugin.settings.targetLanguage || 'zh-CN')
        .onChange(async (value) => {
          this.plugin.settings.targetLanguage = value;
          await this.plugin.saveSettings();
        }));

    containerEl.createEl('h3', { text: '本地 Office 解析（DOCX / XLSX / PPTX）' });

    new Setting(containerEl)
      .setName('启用本地文本证据块')
      .setDesc('默认开启。为 MD、TXT、EML 生成稳定行定位、证据索引和统一分包；全程本地且不增加 AI 请求。')
      .addToggle((toggle) => toggle.setValue(this.plugin.settings.localTextBlockAdapterEnabled !== false).onChange(async (value) => {
        this.plugin.settings.localTextBlockAdapterEnabled = value === true;
        await this.plugin.saveSafeSettings();
      }));

    new Setting(containerEl)
      .setName('启用本地 DOCX 适配器')
      .setDesc('默认开启。优先在本机解析 OOXML；失败时仍需现有外传授权才会使用云端解析。')
      .addToggle((toggle) => toggle.setValue(this.plugin.settings.localDocxAdapterEnabled !== false).onChange(async (value) => {
        this.plugin.settings.localDocxAdapterEnabled = value === true;
        await this.plugin.saveSafeSettings();
      }));

    new Setting(containerEl)
      .setName('启用本地 XLSX 适配器')
      .setDesc('默认开启。保留单元格坐标、公式与缓存值的分离、合并及隐藏状态。')
      .addToggle((toggle) => toggle.setValue(this.plugin.settings.localXlsxAdapterEnabled !== false).onChange(async (value) => {
        this.plugin.settings.localXlsxAdapterEnabled = value === true;
        await this.plugin.saveSafeSettings();
      }));

    new Setting(containerEl)
      .setName('启用本地 PPTX 适配器')
      .setDesc('默认开启。保留幻灯片顺序、文本框、表格、演讲者备注、图片/图表锚点和链接。')
      .addToggle((toggle) => toggle.setValue(this.plugin.settings.localPptxAdapterEnabled !== false).onChange(async (value) => {
        this.plugin.settings.localPptxAdapterEnabled = value === true;
        await this.plugin.saveSafeSettings();
      }));

    new Setting(containerEl)
      .setName('OOXML 最大 ZIP 条目数')
      .setDesc('防止异常或恶意 Office 包耗尽资源；范围 64–16384，默认 4096。')
      .addText((text) => text.setValue(String(this.plugin.settings.ooxmlMaxEntries || 4096)).onChange(async (value) => {
        const count = Number(value);
        if (Number.isFinite(count) && count >= 64 && count <= 16384) {
          this.plugin.settings.ooxmlMaxEntries = Math.round(count);
          await this.plugin.saveSafeSettings();
        }
      }));

    containerEl.createEl('h3', { text: '本地 OCR（扫描 PDF）' });

    new Setting(containerEl)
      .setName('启用本地 OCR')
      .setDesc('默认关闭。开启后仅处理 PDF 中扫描或混合页；原生文本页和空白页会跳过，源文件不会上传。')
      .addToggle((toggle) => toggle
        .setValue(this.plugin.settings.localOcrEnabled === true)
        .onChange(async (value) => {
          this.plugin.settings.localOcrEnabled = value === true;
          await this.plugin.saveSafeSettings();
        }));

    new Setting(containerEl)
      .setName('本地 OCR provider')
      .setDesc('auto 优先使用已安装的 Tesseract；也可指定实现 JSON 合同的本地可执行程序。')
      .addDropdown((dropdown) => dropdown
        .addOption('auto', '自动探测')
        .addOption('tesseract', 'Tesseract')
        .addOption('executable', '自定义可执行程序')
        .setValue(this.plugin.settings.localOcrProvider || 'auto')
        .onChange(async (value) => {
          this.plugin.settings.localOcrProvider = value;
          await this.plugin.saveSafeSettings();
        }));

    textSetting(containerEl, this.plugin, '本地 OCR 可执行文件', '自定义 provider 的绝对可执行文件路径；不会通过 shell 执行，也不会写入诊断报告。', 'localOcrExecutable', '');
    textSetting(containerEl, this.plugin, 'OCR 语言', 'Tesseract 语言组合，例如 chi_sim+eng。仅允许字母、数字、_、+、.、-。', 'localOcrLanguages', 'chi_sim+eng');

    new Setting(containerEl)
      .setName('OCR 并发页数')
      .setDesc('同时渲染和识别的页数，范围 1–4，默认 2。')
      .addDropdown((dropdown) => dropdown
        .addOption('1', '1').addOption('2', '2（默认）').addOption('3', '3').addOption('4', '4')
        .setValue(String(this.plugin.settings.localOcrConcurrency || 2))
        .onChange(async (value) => {
          this.plugin.settings.localOcrConcurrency = Number(value);
          await this.plugin.saveSafeSettings();
        }));

    new Setting(containerEl)
      .setName('单页 OCR 超时（秒）')
      .setDesc('渲染或识别超过此时间会终止子进程，范围 1–600 秒。')
      .addText((text) => text.setValue(String(Math.round((this.plugin.settings.localOcrTimeoutMs || 120000) / 1000)))
        .onChange(async (value) => {
          const seconds = Number(value);
          if (Number.isFinite(seconds) && seconds >= 1 && seconds <= 600) {
            this.plugin.settings.localOcrTimeoutMs = Math.round(seconds * 1000);
            await this.plugin.saveSafeSettings();
          }
        }));

    new Setting(containerEl)
      .setName('OCR 质量门槛')
      .setDesc('低于门槛的 OCR block 保留溯源但 card_eligible=false，范围 0–1。')
      .addText((text) => text.setValue(String(this.plugin.settings.localOcrQualityThreshold ?? 0.72))
        .onChange(async (value) => {
          const threshold = Number(value);
          if (Number.isFinite(threshold) && threshold >= 0 && threshold <= 1) {
            this.plugin.settings.localOcrQualityThreshold = threshold;
            await this.plugin.saveSafeSettings();
          }
        }))
      .addButton((button) => button.setButtonText('检测本地 OCR').onClick(async () => {
        const result = await probeLocalOcr({
          enabled: this.plugin.settings.localOcrEnabled === true,
          provider: this.plugin.settings.localOcrProvider,
          executable: this.plugin.settings.localOcrExecutable,
          languages: this.plugin.settings.localOcrLanguages,
          timeoutMs: this.plugin.settings.localOcrTimeoutMs,
          qualityThreshold: this.plugin.settings.localOcrQualityThreshold
        });
        diag('localOcr.probe', {
          available: result.available, provider: result.provider,
          version: result.available ? result.version : '', reason: result.reason || ''
        });
        new Notice(result.available ? `本地 OCR 可用：${result.provider} ${result.version}` : `本地 OCR 不可用：${result.reason || '未找到可执行程序'}`);
      }));

    containerEl.createEl('h3', { text: '云端文档解析' });

    new Setting(containerEl)
      .setName('允许上传源文件到外部解析 API')
      .setDesc('开启后受支持的源文件会上传到 MinerU/PaddleOCR。请确认符合公司的保密与数据外发要求。')
      .addToggle((toggle) => toggle
        .setValue(this.plugin.settings.pdfAllowExternalUpload === true)
        .onChange(async (value) => {
          this.plugin.settings.pdfAllowExternalUpload = value;
          await this.plugin.saveSettings();
          this.display();
        }));

    // v1.3: 上传前是否弹窗二次确认。
    new Setting(containerEl)
      .setName('上传前弹窗确认')
      .setDesc('开启后每次解析源文件前都会显示文件名 / 大小 / 目标解析器，并要求点确认。自动流水线场景可关闭。')
      .addToggle((toggle) => toggle
        .setValue(this.plugin.settings.confirmUploads !== false)
        .onChange(async (value) => {
          this.plugin.settings.confirmUploads = value;
          await this.plugin.saveSettings();
        }));

    textSetting(containerEl, this.plugin, 'MinerU API 端点', '国内精准解析 API 基础地址。', 'pdfMineruApiEndpoint', 'https://mineru.net/api/v4');
    textSetting(containerEl, this.plugin, 'MinerU API 模型', '建议使用 vlm；复杂版面、表格和扫描件解析更完整。', 'pdfMineruApiModel', 'vlm');

    new Setting(containerEl)
      .setName('MinerU 文档语言')
      .setDesc('ch_server 同时覆盖中文、英文、繁体和日文；日文为主的资料可改为 japan。')
      .addDropdown((dropdown) => dropdown
        .addOption('ch_server', '中/英/日文混合')
        .addOption('ch', '中文/英文')
        .addOption('japan', '日文为主')
        .addOption('en', '英文为主')
        .setValue(this.plugin.settings.pdfMineruApiLanguage || 'ch_server')
        .onChange(async (value) => {
          this.plugin.settings.pdfMineruApiLanguage = value;
          await this.plugin.saveSettings();
        }));

    textSetting(containerEl, this.plugin, 'PaddleOCR API 端点', '国内 PaddleOCR 异步任务接口。', 'pdfPaddleOcrApiEndpoint', 'https://paddleocr.aistudio-app.com/api/v2/ocr/jobs');
    textSetting(containerEl, this.plugin, 'PaddleOCR API 模型', '用于扫描件和 MinerU 低质量结果补盲。', 'pdfPaddleOcrApiModel', 'PaddleOCR-VL-1.6');

    new Setting(containerEl)
      .setName('云端解析轮询间隔')
      .setDesc('查询远程解析进度的间隔，默认 5 秒。')
      .addText((text) => text
        .setPlaceholder('5')
        .setValue(String(Math.round((this.plugin.settings.pdfApiPollIntervalMs || 5000) / 1000)))
        .onChange(async (value) => {
          const seconds = Number(value);
          if (Number.isFinite(seconds) && seconds >= 1 && seconds <= 60) {
            this.plugin.settings.pdfApiPollIntervalMs = seconds * 1000;
            await this.plugin.saveSettings();
          }
        }));

    new Setting(containerEl)
      .setName('外部 PDF 解析超时')
      .setDesc('MinerU/PaddleOCR 可能较慢，默认 600 秒；超时后会降级到下一解析器。')
      .addText((text) => text
        .setPlaceholder('600')
        .setValue(String(Math.round((this.plugin.settings.pdfExternalTimeoutMs || 600000) / 1000)))
        .onChange(async (value) => {
          const seconds = Number(value);
          if (Number.isFinite(seconds) && seconds > 0) {
            this.plugin.settings.pdfExternalTimeoutMs = Math.round(seconds * 1000);
            await this.plugin.saveSettings();
          }
        }));

    new Setting(containerEl)
      .setName('AI 请求超时')
      .setDesc('单次分段调用超过该时间仍无返回时，任务会失败并显示原因；长文档会分多段逐段调用。')
      .addText((text) => text
        .setPlaceholder('300')
        .setValue(String(Math.round((this.plugin.settings.aiRequestTimeoutMs || 300000) / 1000)))
        .onChange(async (value) => {
          const seconds = Number(value);
          if (Number.isFinite(seconds) && seconds >= 10) {
            this.plugin.settings.aiRequestTimeoutMs = Math.round(seconds * 1000);
            await this.plugin.saveSettings();
          }
        }));

    new Setting(containerEl)
      .setName('AI 单段字符数')
      .setDesc('每次交给 AI 的源文本长度。默认 8000；复杂表格较多时可适当调低。')
      .addText((text) => text
        .setPlaceholder('8000')
        .setValue(String(this.plugin.settings.aiChunkSize || 8000))
        .onChange(async (value) => {
          const chars = Number(value);
          if (Number.isFinite(chars) && chars >= 4000 && chars <= 30000) {
            this.plugin.settings.aiChunkSize = Math.round(chars);
            await this.plugin.saveSettings();
          }
        }));

    new Setting(containerEl)
      .setName('切片重叠比例')
      .setDesc('v2.7（借鉴 WeKnora）：相邻分块之间的重叠比例，避免段落语境在切点处断裂。范围 0–0.5，建议 0.05–0.2；设为 0 关闭重叠。重叠会略增 AI 输入 token。')
      .addText((text) => text
        .setPlaceholder('0.1')
        .setValue(String(this.plugin.settings.chunkOverlapRatio ?? 0.1))
        .onChange(async (value) => {
          const ratio = Number(value);
          if (Number.isFinite(ratio) && ratio >= 0 && ratio <= 0.5) {
            this.plugin.settings.chunkOverlapRatio = ratio;
            await this.plugin.saveSettings();
          }
        }));

    new Setting(containerEl)
      .setName('合并过小切片')
      .setDesc('v2.7（借鉴 WeKnora coalesceTinyChunks）：同一标题语境下过小的相邻切片自动合并，减少 AI 调用次数、提升处理速度。关闭后每个小节独立调用一次 AI。')
      .addToggle((toggle) => toggle
        .setValue(this.plugin.settings.coalesceTinyChunks !== false)
        .onChange(async (value) => {
          this.plugin.settings.coalesceTinyChunks = value;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName('AI 最大分段数')
      .setDesc('限制单个文件的 AI 调用次数，默认 100。超过上限时任务会明确失败，不会静默遗漏后半部分。')
      .addText((text) => text
        .setPlaceholder('100')
        .setValue(String(this.plugin.settings.aiMaxChunks || 100))
        .onChange(async (value) => {
          const chunks = Number(value);
          if (Number.isFinite(chunks) && chunks >= 1 && chunks <= 200) {
            this.plugin.settings.aiMaxChunks = Math.round(chunks);
            await this.plugin.saveSettings();
          }
        }));

    new Setting(containerEl)
      .setName('每批知识点数')
      .setDesc('每次原子化请求处理的知识点数量。默认 3，可显著减少 API 调用；复杂内容可调低到 1-2。')
      .addDropdown((dropdown) => dropdown
        .addOption('1', '1（最细，最慢）').addOption('2', '2（平衡）').addOption('3', '3（推荐）')
        .setValue(String(this.plugin.settings.maxPointsPerRequest || 3))
        .onChange(async (value) => {
          this.plugin.settings.maxPointsPerRequest = Number(value);
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName('总结并发数')
      .setDesc('同时执行的逐段总结请求数。默认 2；与原子化并发独立，降低原子化并发不会拖慢总结。')
      .addDropdown((dropdown) => dropdown
        .addOption('1', '1（保守）').addOption('2', '2（推荐）').addOption('3', '3（较快）')
        .setValue(String(this.plugin.settings.summaryConcurrency || 2))
        .onChange(async (value) => {
          this.plugin.settings.summaryConcurrency = Number(value);
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName('原子化并发数')
      .setDesc('同时执行的原子化批次数。默认 2；出现 429 时建议调为 1。')
      .addDropdown((dropdown) => dropdown
        .addOption('1', '1（保守）').addOption('2', '2（推荐）').addOption('3', '3（较快）')
        .setValue(String(this.plugin.settings.atomizationConcurrency || 2))
        .onChange(async (value) => {
          this.plugin.settings.atomizationConcurrency = Number(value);
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName('短文档卡片异常阈值')
      .setDesc('3 页以内文档超过该数量时仅显示文档级数量警告并抽样，不会阻断通过逐卡质量门禁的内容。默认 20。')
      .addText((text) => text.setPlaceholder('20')
        .setValue(String(this.plugin.settings.shortDocumentMaxCards || 20))
        .onChange(async (value) => {
          const count = Number(value);
          if (Number.isFinite(count) && count >= 5 && count <= 100) {
            this.plugin.settings.shortDocumentMaxCards = Math.round(count);
            await this.plugin.saveSettings();
          }
        }));

    new Setting(containerEl)
      .setName('卡住任务判定时间')
      .setDesc('处理中任务超过该时间没有任何进度更新，会自动转为失败，方便用“重试失败并处理”重新排队。')
      .addText((text) => text
        .setPlaceholder('20')
        .setValue(String(this.plugin.settings.staleProcessingMinutes || 20))
        .onChange(async (value) => {
          const minutes = Number(value);
          if (Number.isFinite(minutes) && minutes >= 5) {
            this.plugin.settings.staleProcessingMinutes = Math.round(minutes);
            await this.plugin.saveSettings();
          }
        }));

    containerEl.createEl('h3', { text: '生态插件检测' });
    for (const item of detectEcosystemPlugins(this.app)) {
      const setting = new Setting(containerEl)
        .setName(item.name)
        .setDesc(item.role);
      setting.addExtraButton((button) => button
        .setIcon(item.enabled ? 'check-circle' : (item.installed ? 'circle-dot' : 'circle'))
        .setTooltip(item.enabled ? '已启用' : (item.installed ? '已安装但未启用' : '可选增强')));
    }

    containerEl.createEl('h3', { text: '维护' });
    new Setting(containerEl)
      .setName('清空当前插件缓存')
      .setDesc('删除任务队列、处理日志和待审核草稿；不会删除源文件，也不会删除已经写入 wiki 的知识卡片。')
      .addButton((button) => button
        .setButtonText('清空缓存')
        .setWarning()
        .onClick(async () => {
          if (typeof window !== 'undefined' && !window.confirm('确认清空工程知识切片的任务队列、日志和草稿？源文件和已入库 wiki 卡片不会删除。')) return;
          await this.plugin.clearPluginCache();
          this.display();
        }));
  }
}

function normalizeLegacyArtifact(stage, value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const name = String(stage || '').replace(/^shadow-/, '');
  const keys = Object.keys(value);
  const allowedOnly = (allowed) => keys.every((key) => allowed.includes(key));
  if (name === 'parsed') {
    return typeof value.markdown === 'string' && typeof value.parser === 'string'
      && Array.isArray(value.blocks)
      && value.blocks.every((block) => block
        && typeof (block.raw?.text ?? block.text) === 'string'
        && typeof block.block_id === 'string'
        && typeof block.block_type === 'string'
        && block.locator && typeof block.locator === 'object')
      && (!value.evidence_index || Object.values(value.evidence_index).every((entry) =>
        entry && typeof entry.block_id === 'string' && typeof entry.raw_text === 'string'
        && entry.locator && typeof entry.locator === 'object')) ? value : null;
  }
  if (name === 'classification') {
    return ['bid', 'business'].includes(value.library) && typeof value.folder_type === 'string'
      && value.folder_type.trim() && allowedOnly(['library', 'folder_type', 'confidence', 'reasoning', 'document_type']) ? value : null;
  }
  if (name === 'summary') {
    return typeof value.title === 'string' && Array.isArray(value.sections)
      && allowedOnly(['title', 'executive_summary', 'sections', 'key_points', 'entities', 'relations', 'source_outline']) ? value : null;
  }
  if (name === 'atoms') {
    return Array.isArray(value.atoms) && value.atoms.every((atom) => atom && typeof (atom.title || atom.Title) === 'string')
      && allowedOnly(['atoms', 'warnings', 'coverage', 'version']) ? value : null;
  }
  if (name === 'review') return Array.isArray(value.items) && allowedOnly(['version', 'task_id', 'outcome', 'metrics', 'documentWarnings', 'items', 'handled', 'rejected', 'manual_requests', 'regeneration_requests', 'revalidated_locally_at', 'provider_requests'])
    ? migrateReviewArtifact(value) : null;
  if (name === 'error') {
    return typeof (value.message || value.code) === 'string'
      && allowedOnly(['stage', 'code', 'message', 'retryable', 'at', 'details']) ? value : null;
  }
  return null;
}

function isCurrentArtifactEnvelope(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value)
    && [2, 3].includes(value.artifactVersion) && Object.hasOwn(value, 'payload');
}

function migrateReviewArtifact(value) {
  const artifact = JSON.parse(JSON.stringify(value || {}));
  const plainStatement = (item) => {
    const atom = item?.atom || {};
    if (typeof atom.content === 'string') return `${atom.title || ''} ${atom.content}`.trim();
    const values = Object.values(atom.content || {}).flatMap((entry) => Array.isArray(entry) ? entry : [entry])
      .filter((entry) => ['string', 'number'].includes(typeof entry));
    return `${atom.title || ''} ${values.join('；')}`.trim();
  };
  artifact.version = '2.0';
  artifact.items = (artifact.items || []).map((item) => {
    const atom = item.atom || {};
    const source = atom.source || {};
    const report = item.validationReport || item.validation_report || {};
    const legacyDifference = item.review_context?.material_differences || {};
    const arraysMatch = Array.isArray(legacyDifference.statement_facts)
      && JSON.stringify(legacyDifference.statement_facts) === JSON.stringify(legacyDifference.evidence_facts || []);
    if (arraysMatch) {
      report.materialDifferenceStatus = 'matched';
      report.materialDifferences = { status: 'matched', modality: { status: 'matched' }, conditions: { status: 'matched' } };
      report.numberConsistency = true;
      report.hardGateFailures = (report.hardGateFailures || []).filter((code) => code !== 'NUMERIC_CONFLICT');
      report.nonOverridableFailures = (report.nonOverridableFailures || []).filter((code) => code !== 'NUMERIC_CONFLICT');
    }
    const context = item.review_context || {
      statement: plainStatement(item),
      evidence_quote: String(source.evidence_quote || item.proposed_card?.evidence_quote || ''),
      locator: String(source.source_locator || item.proposed_card?.source_locator || ''),
      page: source.source_page || source.source_provenance?.page || '',
      block_id: source.source_provenance?.block_id || source.block_id || '',
      automatic_repair: { attempted: false, reason: 'legacy_artifact' },
      gate_checklist: {
        source_evidence: report.evidenceFound !== false,
        numbers: report.numberConsistency !== false,
        schema: report.schemaValid !== false,
        route: report.routeValid !== false,
        tags: report.tagsValid !== false,
        duplicate: !(Number(report.duplicateScore) >= 1)
      },
      plain_reasons: (item.reasons || []).map(String)
    };
    context.statement = String(context.statement || plainStatement(item)).replace(/\s+/g, ' ').slice(0, 2000);
    context.material_differences = report.materialDifferences || context.material_differences || {
      status: report.numberConsistency === false ? 'conflict' : 'not_applicable',
      modality: { status: 'matched' },
      conditions: { status: 'matched' }
    };
    return Object.assign({}, item, {
      status: item.status || 'pending',
      validationReport: report,
      review_context: context
    });
  });
  return artifact;
}

function pathSetting(containerEl, plugin, name, desc, key) {
  const setting = new Setting(containerEl)
    .setName(name)
    .setDesc(`${desc} 必须是 vault 内非空目录；不允许根目录、.. 或危险重叠。`)
    .addText((text) => text
      .setValue(plugin.settings[key])
      .onChange(async (value) => {
        const candidate = Object.assign({}, plugin.settings, { [key]: String(value || '').trim().replace(/\\/g, '/') });
        const error = validateConfiguredPathSet(candidate).find((item) => item.key === key);
        if (error) {
          text.inputEl?.classList?.add('eks-input-invalid');
          text.inputEl?.setAttribute?.('aria-invalid', 'true');
          setting.setDesc(`${desc} 当前值无效：${error.reason === 'overlap' ? '与另一受管目录重叠' : '路径为空、为根目录或含穿越段'}；未保存。`);
          return;
        }
        text.inputEl?.classList?.remove('eks-input-invalid');
        text.inputEl?.removeAttribute?.('aria-invalid');
        plugin.settings[key] = normalizeConfiguredPath(candidate[key], plugin.settings[key]);
        await plugin.saveSettings();
      }));
}

function textSetting(containerEl, plugin, name, desc, key, fallback = '') {
  new Setting(containerEl)
    .setName(name)
    .setDesc(desc)
    .addText((text) => text
      .setValue(plugin.settings[key] || fallback)
      .onChange(async (value) => {
        plugin.settings[key] = value.trim() || fallback;
        await plugin.saveSettings();
      }));
}

function numberSetting(containerEl, plugin, name, desc, key, min, max) {
  new Setting(containerEl).setName(name).setDesc(desc).addText((text) => text
    .setValue(String(plugin.settings[key]))
    .onChange(async (value) => {
      const parsed = Number(value);
      if (!Number.isFinite(parsed)) return;
      plugin.settings[key] = Math.max(min, Math.min(max, Math.round(parsed)));
      await plugin.saveSafeSettings();
    }));
}

function passwordSetting(containerEl, plugin, name, desc, key, placeholder = '') {
  new Setting(containerEl)
    .setName(name)
    .setDesc(desc)
    .addText((text) => {
      text.inputEl.type = 'password';
      text
        .setPlaceholder(placeholder)
        .setValue(plugin.settings[key] || '')
        .onChange(async (value) => {
          plugin.settings[key] = value.trim();
          saveSecretField(key, plugin.settings[key]);
          await plugin.saveSettings();
        });
    });
}

function credentialSetting(containerEl, plugin, options) {
  const last = plugin.settings.serviceTestResults?.[options.service];
  const status = last
    ? `${last.ok ? '上次测试成功' : '上次测试未通过'} · ${formatLocalTime(last.testedAt)}`
    : (plugin.settings[options.key] ? '已填写，尚未测试' : '尚未填写');
  let pendingValue = String(plugin.settings[options.key] || '');
  let inputControl;
  new Setting(containerEl)
    .setName(options.name)
    .setDesc(`${options.desc} ${status}。`)
    .addText((text) => {
      inputControl = text;
      text.inputEl.type = 'password';
      text.inputEl.autocomplete = 'new-password';
      text.setPlaceholder(options.placeholder).setValue(pendingValue).onChange((value) => {
        pendingValue = String(value || '').trim();
      });
    })
    .addButton((button) => button.setButtonText('保存').setCta().onClick(async () => {
      plugin.settings[options.key] = pendingValue;
      saveSecretField(options.key, pendingValue);
      await plugin.saveSafeSettings();
      new Notice(pendingValue ? `${options.name}已保存。` : `${options.name}已清除。`);
    }))
    .addButton((button) => button.setButtonText('测试').onClick(async () => {
      if (pendingValue !== String(plugin.settings[options.key] || '')) {
        plugin.settings[options.key] = pendingValue;
        saveSecretField(options.key, pendingValue);
        await plugin.saveSafeSettings();
      }
      if (options.service === 'semantic') await plugin.testSemanticConnection();
      else await plugin.testServiceConnection(options.service);
    }))
    .addButton((button) => button.setButtonText('清除').setWarning().onClick(async () => {
      pendingValue = '';
      plugin.settings[options.key] = '';
      saveSecretField(options.key, '');
      await plugin.saveSafeSettings();
      inputControl?.setValue('');
      new Notice(`${options.name}已清除。`);
    }));
}

async function obsidianRequest(url, init = {}) {
  let body = init.body;
  if (Buffer.isBuffer(body) || ArrayBuffer.isView(body)) {
    const bytes = Buffer.from(body);
    body = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  }
  const response = await requestUrl({
    url,
    method: init.method || 'GET',
    headers: init.headers || {},
    body,
    throw: false
  });
  const text = String(response.text || '');
  return {
    ok: response.status >= 200 && response.status < 300,
    status: response.status,
    async json() {
      if (response.json !== undefined && response.json !== null) return response.json;
      return JSON.parse(text);
    },
    async text() { return text; },
    async arrayBuffer() {
      if (response.arrayBuffer) return response.arrayBuffer;
      const bytes = Buffer.from(text, 'utf8');
      return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    }
  };
}

function connectionTestSetting(containerEl, plugin, name, service) {
  const last = plugin.settings.serviceTestResults?.[service];
  const description = last
    ? `${last.ok ? '最近成功' : `最近失败（${last.code || 'UNKNOWN'}）`} · ${formatLocalTime(last.testedAt)}`
    : '尚未测试';
  new Setting(containerEl)
    .setName(name)
    .setDesc(`${description}。验证鉴权和服务端是否可访问；不会上传知识库文件。`)
    .addButton((control) => control
      .setButtonText('测试连接')
      .onClick(async () => {
        control.setDisabled(true);
        try { await plugin.testServiceConnection(service); } finally { control.setDisabled(false); }
      }));
}

function classifyServiceTestError(error) {
  const status = Number(error?.status || 0);
  const message = String(error?.message || error || '');
  if (status === 401 || status === 403 || /鉴权|unauthor/i.test(message)) return 'AUTH_PROVIDER_REJECTED';
  if (status === 429 || /限流|rate.?limit/i.test(message)) return 'RATE_LIMIT_PROVIDER_BUSY';
  if (/超时|timeout/i.test(message)) return 'TIMEOUT_STAGE_EXCEEDED';
  if (/network|ENOTFOUND|ECONN/i.test(message)) return 'NETWORK_TRANSIENT_FAILURE';
  return 'PROVIDER_SERVICE_UNAVAILABLE';
}

function serviceConnectionConfig(service, settings) {
  if (service === 'minimax') {
    const endpoint = settings.minimaxEndpoint || 'https://api.minimaxi.com/anthropic/v1/messages';
    if (/\/anthropic\/v1\/messages\/?$/i.test(endpoint)) {
      return {
        label: 'MiniMax',
        apiKey: settings.minimaxApiKey || '',
        url: endpoint,
        request: {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-api-key': settings.minimaxApiKey || '', 'anthropic-version': '2023-06-01' },
          body: JSON.stringify({
            model: settings.minimaxModel || 'MiniMax-M3',
            messages: [{ role: 'user', content: '仅回答 OK' }],
            max_tokens: 32
          })
        }
      };
    }
    return {
      label: 'MiniMax',
      apiKey: settings.minimaxApiKey || '',
      url: endpoint,
      request: {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${settings.minimaxApiKey || ''}` },
        body: JSON.stringify({
          model: settings.minimaxModel || 'MiniMax-M3',
          messages: [{ role: 'user', content: '仅回复 OK' }],
          temperature: 0,
          max_tokens: 4
        })
      }
    };
  }
  if (service === 'mineru') {
    const endpoint = String(settings.pdfMineruApiEndpoint || 'https://mineru.net/api/v4').replace(/\/$/, '');
    return {
      label: 'MinerU',
      apiKey: settings.pdfMineruApiKey || '',
      url: `${endpoint}/extract/task/connection-test`,
      request: { method: 'GET', headers: { Authorization: `Bearer ${settings.pdfMineruApiKey || ''}` } }
    };
  }
  const endpoint = String(settings.pdfPaddleOcrApiEndpoint || 'https://paddleocr.aistudio-app.com/api/v2/ocr/jobs').replace(/\/$/, '');
  return {
    label: 'PaddleOCR',
    apiKey: settings.pdfPaddleOcrApiKey || '',
    url: `${endpoint}/connection-test`,
    request: { method: 'GET', headers: { Authorization: `bearer ${settings.pdfPaddleOcrApiKey || ''}` } }
  };
}

function button(parent, text, onClick, disabled = false) {
  const el = parent.createEl('button', { text, attr: { type: 'button', disabled: disabled ? 'disabled' : null } });
  el.disabled = !!disabled;
  el.onclick = onClick;
  return el;
}

function stat(parent, label, value, onClick) {
  const el = onClick
    ? parent.createEl('button', { cls: 'eks-stat eks-stat-button', attr: { 'aria-label': `${label}：${value}，点击筛选` } })
    : parent.createDiv('eks-stat');
  el.createDiv({ cls: 'eks-stat-value', text: String(value) });
  el.createDiv({ cls: 'eks-stat-label', text: label });
  if (onClick) el.addEventListener('click', onClick);
}

function formatLocalTime(value) {
  return formatOperationalLocalDateTime(value, {
    locale: 'zh-CN',
    timeZone: resolveRuntimeTimeZone()
  });
}

function formatLastUpdate(iso) {
  const value = formatLocalTime(iso);
  return value ? `最后更新 ${value}` : '尚无更新时间';
}

function safeDisplayText(value, fallback = '暂无信息') {
  if (value === undefined || value === null) return fallback;
  const text = String(value).trim();
  return !text || /^(undefined|null)$/i.test(text) ? fallback : text;
}

function workflowStateTitle(state) {
  return ({ running: '正在处理', review: '需要审核', error: '处理遇到问题', ready: '准备处理', success: '处理完成', empty: '尚无任务' })[state];
}

function workflowStateLabel(state) {
  return ({ running: '进行中', review: '待决策', error: '需恢复', ready: '可开始', success: '已完成', empty: '空闲' })[state];
}

function workflowStateMessage(state, counts) {
  return ({
    running: '任务正在运行。',
    review: `${counts.needsReview} 个任务需要人工决策后才能完成。`,
    error: `${counts.failed} 个任务失败；成功批次已保存，可从断点重试。`,
    ready: `${counts.pending} 个任务已排队。`,
    success: `已入库 ${counts.written} 张卡片。`,
    empty: '扫描源文件以创建处理任务。'
  })[state];
}

function workflowPrimaryAction(state, plugin, activeTask) {
  if (state === 'running') return { label: '查看当前任务', run: () => {
    const view = plugin.app.workspace.getLeavesOfType(VIEW_TYPE_SLICER)?.[0]?.view;
    if (view) { view.activeSection = 'tasks'; view.taskFilter = 'processing'; view.render(); }
  } };
  if (state === 'review') return { label: '开始审核', run: () => {
    const view = plugin.app.workspace.getLeavesOfType(VIEW_TYPE_SLICER)?.[0]?.view;
    if (view) { view.activeSection = 'review'; view.render(); }
  } };
  if (state === 'error') return { label: '从断点重试失败任务', run: () => plugin.retryFailedAndAutoProcess(true) };
  if (state === 'ready') return { label: '继续处理队列', run: () => plugin.autoProcessQueue(true) };
  return { label: state === 'success' ? '扫描新文件' : '扫描源文件', run: () => plugin.scanSourceFiles(true) };
}

function formatDuration(milliseconds) {
  const seconds = Math.max(0, Math.floor(Number(milliseconds || 0) / 1000));
  if (seconds < 60) return `${seconds} 秒`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes} 分 ${seconds % 60} 秒`;
}

function stageLabel(stage) {
  const labels = {
    start: '准备', discovered: '已发现', queued: '排队', parsing: '文档解析', parsed: '解析完成', classifying: '类型判定', classified: '类型判定完成', classification: '类型判定',
    summarizing: '结构化总结', 'summary-map': '逐段总结', 'summary-reduce': '合并总结', atomizing: '知识原子化', atomization: '知识原子化',
    summarized: '总结完成', validating: '可信度与契约校验', writing: '写入知识库', written: '已完成', archived: '已归档', complete: '完成', failed: '失败', paused: '已暂停', cancelled: '已取消',
    extracting: '提取内容', slicing: '内容切片', 'universal-writer': '统一知识写入', 'component-contracts': '组件契约', skipped: '已跳过', unsupported: '不支持',
    unsupported_media: '暂不支持的媒体', needs_ocr: '需要 OCR', rolled_back: '已回滚'
  };
  return labels[stage] || String(stage || '等待');
}

async function ensureFolder(app, folderPath) {
  const parts = normalizeVaultPath(folderPath).split('/').filter(Boolean);
  let current = '';
  for (const part of parts) {
    current = current ? `${current}/${part}` : part;
    if (!app.vault.getAbstractFileByPath(current)) {
      try { await app.vault.createFolder(current); } catch {}
    }
  }
}

async function writeFile(app, path, content) {
  const normalized = vaultRelativePath(path, 'vault write');
  await ensureFolder(app, normalized.split('/').slice(0, -1).join('/'));
  const adapter = app.vault.adapter;
  const expected = String(content);
  // Obsidian desktop adapters expose write/rename/remove. Use a verified
  // temp + rollback transaction where available; mobile/custom adapters fall
  // back to the public Vault API with read-back verification and restoration.
  if (adapter && typeof adapter.write === 'function' && typeof adapter.rename === 'function' && typeof adapter.remove === 'function') {
    const nonce = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const temporary = `${normalized}.tmp-${nonce}`;
    const backup = `${normalized}.rollback-${nonce}`;
    const existed = typeof adapter.exists === 'function'
      ? await adapter.exists(normalized)
      : !!app.vault.getAbstractFileByPath(normalized);
    let backupCreated = false;
    try {
      await adapter.write(temporary, expected);
      if (typeof adapter.read === 'function' && await adapter.read(temporary) !== expected) throw new Error('临时文件写入校验失败');
      if (existed) {
        await adapter.rename(normalized, backup);
        backupCreated = true;
      }
      await adapter.rename(temporary, normalized);
      if (typeof adapter.read === 'function' && await adapter.read(normalized) !== expected) throw new Error('目标文件提交校验失败');
      if (backupCreated) await adapter.remove(backup);
      return normalized;
    } catch (error) {
      try { if (typeof adapter.exists !== 'function' || await adapter.exists(temporary)) await adapter.remove(temporary); } catch (_) {}
      if (backupCreated) {
        try {
          if (typeof adapter.exists !== 'function' || await adapter.exists(normalized)) await adapter.remove(normalized);
          await adapter.rename(backup, normalized);
        } catch (rollbackError) {
          error.rollbackError = String(rollbackError?.message || rollbackError);
        }
      }
      throw error;
    }
  }
  const existing = app.vault.getAbstractFileByPath(normalized);
  const previous = existing ? await app.vault.read(existing) : null;
  try {
    if (existing) await app.vault.modify(existing, expected);
    else await app.vault.create(normalized, expected);
    const committed = app.vault.getAbstractFileByPath(normalized);
    if (!committed || await app.vault.read(committed) !== expected) throw new Error('兼容写入校验失败');
  } catch (error) {
    if (existing && previous !== null) {
      try { await app.vault.modify(existing, previous); } catch (rollbackError) { error.rollbackError = String(rollbackError?.message || rollbackError); }
    }
    throw error;
  }
  return normalized;
}

async function writeUnique(app, targetPath, content) {
  const normalized = normalizeVaultPath(targetPath);
  const folder = normalized.split('/').slice(0, -1).join('/');
  const file = normalized.split('/').pop();
  const stem = file.replace(/\.md$/, '');
  let candidate = normalized;
  let index = 1;
  while (app.vault.getAbstractFileByPath(candidate)) {
    candidate = `${folder}/${stem}-${index}.md`;
    index += 1;
  }
  await writeFile(app, candidate, content);
  return candidate;
}

async function deleteFolderContents(app, folderPath) {
  const folder = app.vault.getAbstractFileByPath(normalizeVaultPath(folderPath));
  if (!(folder instanceof TFolder)) return;
  const children = [...folder.children];
  for (const child of children) {
    await app.vault.delete(child, true);
  }
}

function upsertTask(tasks, task) {
  const id = task.task_id || task.taskId;
  const index = tasks.findIndex((item) => (item.task_id || item.taskId) === id);
  if (index >= 0) tasks[index] = task;
  else tasks.push(task);
  return tasks;
}

function runtimeVersions(settings) {
  return {
    pipelineVersion: settings.pipelineVersion || '1.1.0',
    promptBundleVersion: settings.promptBundleVersion || '1.1',
    schemaVersion: settings.schemaVersion || '1.1'
  };
}

function detectMetricLanguage(text) {
  const sample = String(text || '').slice(0, 20000);
  if (!sample) return 'unknown';
  const han = (sample.match(/[\u3400-\u9fff]/g) || []).length;
  const kana = (sample.match(/[\u3040-\u30ff]/g) || []).length;
  const latin = (sample.match(/[A-Za-z]/g) || []).length;
  if (kana > Math.max(10, han * 0.05)) return 'ja';
  if (han > latin * 0.25) return 'zh';
  if (latin > 20) return 'en';
  return 'unknown';
}

function formatMetricRate(value) {
  return Number.isFinite(Number(value)) ? `${(Number(value) * 100).toFixed(1)}%` : 'n/a';
}

function libraryForPath(filePath, settings) {
  const path = normalizeVaultPath(filePath);
  if (path.startsWith(`${normalizeVaultPath(settings.businessIntakePath)}/`)) return 'business';
  return 'bid';
}

function workflowStatus(stage) {
  if (stage === 'classification') return 'classifying';
  if (stage === 'summary-map' || stage === 'summary-reduce') return 'summarizing';
  if (stage === 'atomization') return 'atomizing';
  return 'validating';
}

function validateAtomLabels(library, atom) {
  const required = [
    [library.categories, atom.Category],
    [library.tagL1, atom.TagL1],
    [library.tagL2, atom.TagL2]
  ];
  if (atom.card_kind === 'event') required.push([library.eventTypes, atom.Event_Type]);
  if (atom.card_kind === 'static') required.push([library.infoTypes, atom.Info_Type]);
  return required.every(([allowed, value]) => Boolean(value) && allowed && allowed.has(value));
}

// 统一遮蔽多种 API 密钥形态（OpenAI sk-、Bearer JWT、URL 里的 token= / api_key= / apikey=）
// v1.1.2 之前只匹配 sk-*，会把 MiniMax / PaddleOCR / MinerU 的密钥原样漏进 Notice。
// v1.4: 用户可见错误（Notice / dashboard）的密钥脱敏。
//       优先复用 redactCredential（更严格），再针对 URL query / Bearer 前缀等结构化场景做兜底。
function sanitizeSecret(message) {
  const text = String(message || '');
  // 1) URL query 参数（?token=xxx &api_key=yyy）—— redactCredential 不会触发
  let result = text.replace(/([?&](?:token|access_token|api[_-]?key|apikey|password|secret)=)[^&\s"']+/gi, '$1***');
  // 2) Bearer / Basic 前缀的 token
  result = result.replace(/(bearer\s+|basic\s+)[A-Za-z0-9._\-+/=]{12,}/gi, '$1***');
  // 3) 内容指纹级（覆盖所有凭证模式）—— 在已脱敏的基础上最后一道防线
  result = result.replace(/[A-Za-z0-9+/=_\-]{24,}/g, (match) => {
    // 对剩余长字符串也走一次 redactCredential（只对会触发指纹的子串替换）
    const fingerprinted = redactCredential(match);
    return fingerprinted === match ? match : fingerprinted;
  });
  return result;
}

function getMarkdownTitle(markdown) {
  const match = String(markdown || '').match(/^#\s+(.+)$/m);
  return match ? match[1].trim() : '';
}

// v1.9 (m-01): 读 frontmatter 单字段，支持：
//                - 纯字符串:  Key: value
//                - 双引号包:   Key: "value with spaces"
//                - YAML 列表:  Key: [a, b, c]   → 返回 "a, b, c"
//                - 多行列表:  Key:\n  - a\n  - b  → 返回 "a, b"
function readFrontmatterValue(markdown, key) {
  const text = String(markdown || '');
  const re = new RegExp(`^${key}:\\s*(.*?)(?=^\\w+:|\\Z)`, 'ms');
  const match = text.match(re);
  if (!match) return '';
  let raw = match[1].replace(/\s+$/, '');
  // 单行列表 [a, b, c]
  const inlineList = raw.match(/^\s*\[\s*(.+?)\s*\]\s*$/);
  if (inlineList) {
    return inlineList[1].split(',').map((s) => s.trim().replace(/^["']|["']$/g, '')).filter(Boolean).join(', ');
  }
  // 多行列表：key 后的所有 "- value"
  if (/^\s*$/.test(raw.split('\n')[0])) {
    const items = [];
    for (const line of raw.split('\n')) {
      const itemMatch = line.match(/^\s*-\s+(.+?)\s*$/);
      if (itemMatch) items.push(itemMatch[1].replace(/^["']|["']$/g, ''));
    }
    if (items.length) return items.join(', ');
  }
  // 单行值（去引号）
  raw = raw.replace(/^["']|["']$/g, '').trim();
  // 多行（普通换行 → 空格）
  raw = raw.replace(/\n+/g, ' ').replace(/\s+/g, ' ').trim();
  return raw;
}

function parseFrontmatterArray(value) {
  if (Array.isArray(value)) return value;
  const text = String(value || '').trim();
  if (!text) return [];
  try {
    const parsed = JSON.parse(text);
    return Array.isArray(parsed) ? parsed : [];
  } catch (_) {
    return text.replace(/^\[|\]$/g, '').split(',').map((item) => item.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean);
  }
}

function cardFromMarkdown(markdown) {
  const confidence = Number(readFrontmatterValue(markdown, 'Confidence'));
  return {
    Map_Index: readFrontmatterValue(markdown, 'Map_Index'),
    Card_Type: readFrontmatterValue(markdown, 'Card_Type'),
    Event_Type: readFrontmatterValue(markdown, 'Event_Type'),
    Info_Type: readFrontmatterValue(markdown, 'Info_Type'),
    Category: readFrontmatterValue(markdown, 'Category'),
    TagL1: readFrontmatterValue(markdown, 'TagL1'),
    TagL2: readFrontmatterValue(markdown, 'TagL2'),
    Status: readFrontmatterValue(markdown, 'Status'),
    Source_File: readFrontmatterValue(markdown, 'Source_File'),
    Source_Path: readFrontmatterValue(markdown, 'Source_Path'),
    Source_Hash: readFrontmatterValue(markdown, 'Source_Hash'),
    Confidence: Number.isFinite(confidence) ? confidence : undefined
  };
}

function approveMarkdownStatus(markdown, status = '#status/approved') {
  const text = String(markdown || '');
  if (/^Status:\s*.*$/m.test(text)) {
    return text.replace(/^Status:\s*.*$/m, `Status: ${JSON.stringify(status)}`);
  }
  return text.replace(/^---\n/, `---\nStatus: ${JSON.stringify(status)}\n`);
}

function approvedStatus(library) {
  if (library?.statuses?.has('#status/approved')) return '#status/approved';
  if (library?.statuses?.has('#status/confirmed')) return '#status/confirmed';
  return '#status/approved';
}

},
/**
 * @module src/core/shadow-evaluation
 * Privacy-safe, bounded shadow evaluation records and deterministic cohorts.
 */
"src/core/shadow-evaluation.js": function(require, module, exports) {
const crypto = require("crypto");

const SHADOW_SCHEMA_VERSION = 'eks-shadow-evaluation/1.0';
const STORE_SCHEMA_VERSION = 'eks-shadow-store/1.0';
const SENSITIVE_KEYS = /(?:path|filename|content|markdown|text|quote|excerpt|credential|secret|token|api.?key|prompt|response)/i;
const ALLOWED_REASONS = new Set([
  'PROVIDER_BUDGET_EXHAUSTED', 'LOCAL_PARSER_UNAVAILABLE', 'OCR_REQUIRED',
  'PARSER_REVIEW_REQUIRED', 'SOURCE_MISSING', 'CANCELLED', 'CHECKPOINT_MISSING',
  'CLASSIFICATION_INVALID', 'SUMMARY_INCOMPLETE', 'ATOM_VALIDATION_FAILED',
  'EVIDENCE_UNVERIFIED', 'DUPLICATE', 'REGENERATION', 'INTERNAL'
]);

function finite(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function clampInt(value, min, max, fallback) {
  return Math.max(min, Math.min(max, Math.round(finite(value, fallback))));
}

function shadowPseudonym(sourceHash, salt = '') {
  return `src_${crypto.createHash('sha256').update(`${salt}:${String(sourceHash || '')}`).digest('hex').slice(0, 20)}`;
}

function sizeBucket(bytes) {
  const value = finite(bytes);
  if (value < 100 * 1024) return 'small';
  if (value < 5 * 1024 * 1024) return 'medium';
  return 'large';
}

function safeReason(reason) {
  const normalized = String(reason || 'INTERNAL').toUpperCase().replace(/[^A-Z0-9_]/g, '_');
  return ALLOWED_REASONS.has(normalized) ? normalized : 'INTERNAL';
}

function sanitize(value, key = '', depth = 0) {
  if (depth > 8) return '[bounded]';
  if (SENSITIVE_KEYS.test(key)) return undefined;
  if (typeof value === 'string') {
    if (/^eks-shadow-(?:evaluation|store)\/\d+\.\d+$/.test(value)) return value;
    if (/[\\/]/.test(value) || value.length > 160 || /(?:bearer\s+|sk-|key-|ghp_|eyJ)[A-Za-z0-9_.-]{12,}/i.test(value)) return '[redacted]';
    return value;
  }
  if (value === null || value === undefined || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.slice(0, 200).map((item) => sanitize(item, '', depth + 1)).filter((item) => item !== undefined);
  const output = {};
  for (const [childKey, item] of Object.entries(value)) {
    const cleaned = sanitize(item, childKey, depth + 1);
    if (cleaned !== undefined) output[childKey] = cleaned;
  }
  return output;
}

function typedReasons(items = []) {
  const counts = {};
  for (const item of items) {
    const reason = safeReason(typeof item === 'string' ? item : item?.code || item?.reason);
    counts[reason] = (counts[reason] || 0) + 1;
  }
  return counts;
}

function buildShadowDocumentMetric(input = {}) {
  const parsePackage = input.parsePackage || {};
  const blocks = Array.isArray(parsePackage.blocks) ? parsePackage.blocks : [];
  const eligible = blocks.filter((block) => block?.card_eligible !== false
    && String(block?.raw?.text || block?.raw_text || block?.text || block?.content || '').trim().length >= 2);
  const workflow = input.workflow || {};
  const accepted = Array.isArray(workflow.accepted) ? workflow.accepted : [];
  const review = Array.isArray(workflow.review) ? workflow.review : [];
  const atoms = Array.isArray(workflow.atomResult?.atoms) ? workflow.atomResult.atoms : [];
  const verification = [...accepted.map((card) => card.validation_report), ...review.map((item) => item.validation_report)]
    .filter(Boolean);
  const verified = verification.filter((item) => item.sourceLinkValid !== false && item.evidenceFound !== false).length;
  const summaryPoints = Array.isArray(workflow.summary?.key_points) ? workflow.summary.key_points : [];
  const covered = new Set(atoms.flatMap((atom) => atom.content?.point_ids
    || atom.source_point_ids || (atom.source_point_id ? [atom.source_point_id] : []))).size;
  const reasons = [
    ...(input.reasons || []),
    ...review.flatMap((item) => item.reasons || []),
    ...atoms.filter((atom) => atom.duplicate_of).map(() => 'DUPLICATE'),
    ...atoms.filter((atom) => atom.regeneration_reason).map(() => 'REGENERATION')
  ];
  const counters = input.counters || {};
  return sanitize({
    schema_version: SHADOW_SCHEMA_VERSION,
    run_id: String(input.runId || ''),
    source_pseudonym: shadowPseudonym(input.sourceHash, input.salt),
    source: {
      type: String(input.sourceType || 'unknown'),
      parser: String(parsePackage.parser || input.parser || 'unknown'),
      language: String(input.language || parsePackage.metadata?.language || 'unknown'),
      size_bytes: Math.max(0, finite(input.sizeBytes)),
      size_bucket: sizeBucket(input.sizeBytes)
    },
    counts: {
      parse_blocks: blocks.length,
      eligible_blocks: eligible.length,
      summary_points: summaryPoints.length,
      atoms: atoms.length,
      cards: accepted.length,
      review: review.length
    },
    quality: {
      locator_evidence_verified: verified,
      locator_evidence_total: verification.length,
      locator_evidence_verification_rate: verification.length ? verified / verification.length : null,
      summary_covered_points: covered,
      summary_total_points: summaryPoints.length,
      summary_coverage_rate: summaryPoints.length ? Math.min(1, covered / summaryPoints.length) : null
    },
    classification: workflow.classification ? {
      route: String(workflow.route?.folder_type || workflow.classification.folder_type || 'unknown'),
      confidence: Number.isFinite(Number(workflow.classification.confidence)) ? Number(workflow.classification.confidence) : null
    } : null,
    duplicate_regeneration_reasons: typedReasons(reasons.filter((reason) => /duplicate|regenerat/i.test(String(reason)))),
    cache: {
      parse_hit: input.cache?.parseHit === true,
      classification_hit: input.cache?.classificationHit === true,
      summary_hit: input.cache?.summaryHit === true,
      atoms_hit: input.cache?.atomsHit === true,
      checkpoint_hits: Math.max(0, finite(input.cache?.checkpointHits))
    },
    stage_timings_ms: Object.fromEntries(Object.entries(input.timings || {}).map(([key, value]) => [String(key), Math.max(0, finite(value))])),
    provider: {
      budget: Math.max(0, finite(input.providerBudget)),
      requests: Math.max(0, finite(counters.apiRequests)),
      input_tokens_estimated: Math.max(0, finite(counters.estimatedInputTokens || Math.ceil(finite(counters.promptCharacters) / 3))),
      output_tokens_estimated: Math.max(0, finite(counters.estimatedOutputTokens || Math.ceil(finite(counters.outputCharacters) / 3))),
      cost: Number.isFinite(Number(counters.cost)) ? Math.max(0, Number(counters.cost)) : null
    },
    outcome: String(input.outcome || 'completed'),
    typed_reasons: typedReasons(reasons),
    resumable: input.resumable !== false,
    completed_at: String(input.completedAt || new Date().toISOString())
  });
}

function stableRank(seed, item) {
  return crypto.createHash('sha256').update(`${seed}:${item.source_hash || item.task_id || ''}`).digest('hex');
}

function stratum(task) {
  const metadata = task.shadow_metadata || {};
  return [
    task.source_type || 'unknown',
    metadata.parser || task.parser || 'unknown',
    metadata.size_bucket || sizeBucket(metadata.size_bytes || task.size_bytes),
    metadata.language || task.language || 'unknown'
  ].join('|');
}

function selectShadowCohort(tasks = [], options = {}) {
  const limit = clampInt(options.limit, 1, 500, 20);
  const seed = String(options.seed || 'eks-shadow-v1');
  const eligible = tasks.filter((task) => task && task.source_hash && task.task_id);
  const groups = new Map();
  for (const task of eligible) {
    const key = stratum(task);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(task);
  }
  for (const rows of groups.values()) rows.sort((a, b) => stableRank(seed, a).localeCompare(stableRank(seed, b)));
  const keys = [...groups.keys()].sort((a, b) => stableRank(seed, { source_hash: a }).localeCompare(stableRank(seed, { source_hash: b })));
  const selected = [];
  let round = 0;
  while (selected.length < limit) {
    let added = false;
    for (const key of keys) {
      const row = groups.get(key)?.[round];
      if (!row) continue;
      selected.push(row);
      added = true;
      if (selected.length >= limit) break;
    }
    if (!added) break;
    round += 1;
  }
  return selected;
}

function aggregateShadowRuns(documents = []) {
  const rows = documents.filter((row) => row?.schema_version === SHADOW_SCHEMA_VERSION);
  const sum = (pick) => rows.reduce((total, row) => total + finite(pick(row)), 0);
  const verified = sum((row) => row.quality?.locator_evidence_verified);
  const verificationTotal = sum((row) => row.quality?.locator_evidence_total);
  const covered = sum((row) => row.quality?.summary_covered_points);
  const pointTotal = sum((row) => row.quality?.summary_total_points);
  const timings = {};
  for (const row of rows) for (const [stage, value] of Object.entries(row.stage_timings_ms || {})) {
    if (!timings[stage]) timings[stage] = [];
    timings[stage].push(finite(value));
  }
  return {
    schema_version: SHADOW_SCHEMA_VERSION,
    documents: rows.length,
    by_type: countBy(rows, (row) => row.source?.type),
    by_parser: countBy(rows, (row) => row.source?.parser),
    by_language: countBy(rows, (row) => row.source?.language),
    outcomes: countBy(rows, (row) => row.outcome),
    counts: {
      parse_blocks: sum((row) => row.counts?.parse_blocks),
      eligible_blocks: sum((row) => row.counts?.eligible_blocks),
      atoms: sum((row) => row.counts?.atoms),
      cards: sum((row) => row.counts?.cards),
      review: sum((row) => row.counts?.review)
    },
    quality: {
      locator_evidence_verification_rate: verificationTotal ? verified / verificationTotal : null,
      summary_coverage_rate: pointTotal ? covered / pointTotal : null
    },
    provider: {
      requests: sum((row) => row.provider?.requests),
      input_tokens_estimated: sum((row) => row.provider?.input_tokens_estimated),
      output_tokens_estimated: sum((row) => row.provider?.output_tokens_estimated),
      cost: rows.some((row) => row.provider?.cost !== null) ? sum((row) => row.provider?.cost) : null
    },
    cache_hits: sum((row) => Object.values(row.cache || {}).filter((value) => value === true).length + finite(row.cache?.checkpoint_hits)),
    stage_timings_ms: Object.fromEntries(Object.entries(timings).map(([stage, values]) => [
      stage, { total: values.reduce((a, b) => a + b, 0), mean: values.reduce((a, b) => a + b, 0) / values.length, max: Math.max(...values) }
    ])),
    typed_reasons: mergeCounts(rows.map((row) => row.typed_reasons || {}))
  };
}

function countBy(rows, pick) {
  const result = {};
  for (const row of rows) {
    const key = String(pick(row) || 'unknown');
    result[key] = (result[key] || 0) + 1;
  }
  return result;
}

function mergeCounts(items) {
  const result = {};
  for (const item of items) for (const [key, count] of Object.entries(item || {})) result[key] = (result[key] || 0) + finite(count);
  return result;
}

function migrateShadowStore(raw = {}) {
  if (raw?.schema_version === STORE_SCHEMA_VERSION) {
    return sanitize({ schema_version: STORE_SCHEMA_VERSION, runs: raw.runs || [], baselines: raw.baselines || [] });
  }
  const legacyRows = Array.isArray(raw) ? raw : (raw.documents || raw.runs || []);
  return sanitize({
    schema_version: STORE_SCHEMA_VERSION,
    runs: legacyRows.map((row) => row.schema_version ? row : Object.assign({ schema_version: SHADOW_SCHEMA_VERSION }, row)),
    baselines: Array.isArray(raw.baselines) ? raw.baselines : []
  });
}

function boundedShadowStore(store, options = {}) {
  const migrated = migrateShadowStore(store);
  const maxDocuments = clampInt(options.maxDocuments, 1, 5000, 200);
  const retentionDays = clampInt(options.retentionDays, 1, 3650, 30);
  const cutoff = Date.now() - retentionDays * 86400000;
  const runs = migrated.runs
    .filter((row) => !row.completed_at || Date.parse(row.completed_at) >= cutoff)
    .sort((a, b) => String(b.completed_at || '').localeCompare(String(a.completed_at || '')))
    .slice(0, maxDocuments);
  return { schema_version: STORE_SCHEMA_VERSION, runs, baselines: migrated.baselines.slice(-20) };
}

function compareShadowAggregates(current, baseline) {
  const metric = (path) => path.split('.').reduce((value, key) => value?.[key], current);
  const prior = (path) => path.split('.').reduce((value, key) => value?.[key], baseline);
  const paths = [
    'quality.locator_evidence_verification_rate', 'quality.summary_coverage_rate',
    'provider.requests', 'provider.input_tokens_estimated', 'counts.cards', 'counts.review'
  ];
  return {
    schema_version: SHADOW_SCHEMA_VERSION,
    baseline_id: baseline?.baseline_id || null,
    deltas: Object.fromEntries(paths.map((path) => [path, finite(metric(path)) - finite(prior(path))]))
  };
}

function renderShadowMarkdown(report = {}) {
  const aggregate = report.aggregate || aggregateShadowRuns(report.documents || []);
  const comparison = report.comparison;
  const lines = [
    '# Engineering Knowledge Slicer Shadow Evaluation',
    '',
    `- Schema: ${SHADOW_SCHEMA_VERSION}`,
    `- Documents: ${aggregate.documents || 0}`,
    `- Provider requests: ${aggregate.provider?.requests || 0}`,
    `- Evidence verification: ${formatRate(aggregate.quality?.locator_evidence_verification_rate)}`,
    `- Summary coverage: ${formatRate(aggregate.quality?.summary_coverage_rate)}`,
    `- Cards / review: ${aggregate.counts?.cards || 0} / ${aggregate.counts?.review || 0}`,
    '',
    '## Typed reasons',
    '',
    ...Object.entries(aggregate.typed_reasons || {}).map(([reason, count]) => `- ${reason}: ${count}`)
  ];
  if (comparison) lines.push('', '## Baseline deltas', '', '```json', JSON.stringify(comparison.deltas, null, 2), '```');
  return `${lines.join('\n')}\n`;
}

function formatRate(value) {
  return Number.isFinite(Number(value)) ? `${(Number(value) * 100).toFixed(1)}%` : 'n/a';
}

module.exports = {
  SHADOW_SCHEMA_VERSION,
  aggregateShadowRuns,
  boundedShadowStore,
  buildShadowDocumentMetric,
  compareShadowAggregates,
  migrateShadowStore,
  renderShadowMarkdown,
  selectShadowCohort,
  shadowPseudonym
};

},
/** STRUCTURED_PHASE_MODULES_START */
"src/phase1-foundation.js": function(require, module, exports) {
/**
 * Phase 1 的纯本地并行基础。
 * 本模块不接入生产切片流程、不访问文件系统，也不包含网络或供应商调用。
 */

/** @typedef {Record<string, any>} AnyRecord */

const SCHEMA_VERSION = '1.0';
const RECORD_KINDS = Object.freeze(['project', 'source_document', 'business_item', 'company_knowledge']);
const LIBRARIES = Object.freeze(['active_tender', 'business']);
const PROJECT_STATES = Object.freeze([
  'lead', 'approved', 'bidding', 'submitted', 'evaluating', 'won', 'lost',
  'paused', 'terminated', 'contracted', 'archived'
]);
const ARCHIVE_OUTCOMES = Object.freeze(['won_completed', 'lost', 'terminated', 'paused_by_decision']);

/** @type {Readonly<Record<string, string>>} */
const STATE_LABELS = Object.freeze({
  lead: '线索', approved: '已批准', bidding: '投标准备中', submitted: '已提交',
  evaluating: '评审中', won: '已中标', lost: '未中标', paused: '已暂停',
  terminated: '已终止', contracted: '已签约', archived: '已归档'
});

/** @type {Readonly<Record<string, string[]>>} */
const ALLOWED_TRANSITIONS = Object.freeze({
  lead: ['approved', 'lost', 'paused', 'terminated'],
  approved: ['bidding', 'paused', 'terminated'],
  bidding: ['submitted', 'paused', 'terminated'],
  submitted: ['evaluating', 'won', 'lost', 'paused', 'terminated'],
  evaluating: ['won', 'lost', 'paused', 'terminated'],
  won: ['contracted', 'archived'],
  lost: ['archived'],
  paused: ['approved', 'bidding', 'submitted', 'evaluating', 'terminated', 'archived'],
  terminated: ['archived'],
  contracted: ['archived'],
  archived: []
});

const ACTIVE_TENDER_CATEGORIES = Object.freeze([
  ['project_overview', '项目概览'],
  ['opportunity_customer', '商机与客户'],
  ['tender_documents_interpretation', '招标文件与解读'],
  ['site_survey_original_materials', '现场踏勘与原始资料'],
  ['bid_strategy_responsibilities', '投标策略与职责分工'],
  ['technical_solution', '技术方案'],
  ['design_optimization', '设计与优化'],
  ['construction_organization_schedule', '施工组织与进度计划'],
  ['technical_bid', '技术标'],
  ['commercial_quotation_cost', '商务报价与成本'],
  ['procurement_subcontracting', '采购与分包'],
  ['risk_deviation_compliance', '风险、偏差与合规'],
  ['internal_review_decision', '内部评审与决策'],
  ['qa_addenda', '答疑与补遗'],
  ['bid_document_submission_history', '投标文件与提交历史'],
  ['opening_evaluation_award_tracking', '开标、评标与中标跟踪'],
  ['contract_negotiation_signing', '合同谈判与签约'],
  ['review_knowledge_candidates', '复盘与知识候选'],
  ['project_correspondence', '项目往来函件'],
  ['meeting_minutes_decisions', '会议纪要与决议'],
  ['project_material_index', '项目资料索引']
].map(([key, label]) => Object.freeze({ key, label, storage: 'owned' })));

const ACTIVE_TENDER_REFERENCE_CATEGORIES = Object.freeze([
  Object.freeze({
    key: 'business_common_knowledge_refs',
    label: '引用业务库通用知识',
    storage: 'reference',
    target_library: 'business',
    target_category: 'terminology_general_knowledge'
  }),
  Object.freeze({
    key: 'business_templates_tools_refs',
    label: '引用业务库模板与工具',
    storage: 'reference',
    target_library: 'business',
    target_category: 'templates_tools'
  })
]);

const BUSINESS_CATEGORIES = Object.freeze([
  ['customers', '客户'],
  ['complete_historical_projects', '完整历史项目'],
  ['proposals_cases', '提案与案例'],
  ['quotation_cost', '报价与成本'],
  ['construction_organization_schedules', '施工组织与进度计划'],
  ['risks_issues', '风险与问题'],
  ['failures_terminated_lessons', '失败与终止项目教训'],
  ['talent_experts', '人才与专家'],
  ['suppliers_subcontractors', '供应商与分包商'],
  ['materials_equipment', '材料与设备'],
  ['standards_specifications', '标准与规范'],
  ['contracts_legal', '合同与法务'],
  ['technical_methods_workmanship', '技术方法与工艺'],
  ['quality_acceptance', '质量与验收'],
  ['safety_civilized_construction', '安全与文明施工'],
  ['correspondence_important_decisions', '往来函件与重要决策'],
  ['company_systems_processes', '公司制度与流程'],
  ['market_competition_intelligence', '市场与竞争情报'],
  ['templates_tools', '模板与工具'],
  ['terminology_general_knowledge', '术语与通用知识']
].map(([key, label]) => Object.freeze({ key, label })));

const BUSINESS_ITEM_TYPES = Object.freeze([
  ['requirement', '要求'],
  ['decision', '决策'],
  ['commitment', '承诺'],
  ['risk', '风险'],
  ['issue', '问题'],
  ['change', '变更'],
  ['action', '行动'],
  ['quotation', '报价'],
  ['material', '材料'],
  ['method', '方法'],
  ['acceptance_criterion', '验收标准'],
  ['clarification', '澄清'],
  ['contract_obligation', '合同义务'],
  ['project_lesson', '项目教训']
].map(([key, label]) => Object.freeze({ key, label })));
const CANONICAL_ITEM_TYPES = new Set([
  'fact', 'requirement', 'decision', 'action', 'process', 'method', 'parameter',
  'risk', 'issue', 'experience', 'commercial_term', 'schedule', 'entity_profile',
  'correspondence'
]);

const DIRECTORY_PLAN = Object.freeze({
  version: SCHEMA_VERSION,
  mode: 'definitions_only',
  auto_create_or_move: false,
  libraries: Object.freeze([
    Object.freeze({
      key: 'active_tender',
      label: '在办投标库',
      suggested_path: '在办投标库',
      categories: Object.freeze([...ACTIVE_TENDER_CATEGORIES, ...ACTIVE_TENDER_REFERENCE_CATEGORIES])
    }),
    Object.freeze({
      key: 'business',
      label: '长期业务库',
      suggested_path: '长期业务库',
      categories: BUSINESS_CATEGORIES
    })
  ])
});

const COMMON_FIELDS = new Set([
  'schema_version', 'record_kind', 'record_id', 'title', 'library', 'created_at', 'updated_at',
  'project_ids', 'source_document_ids', 'business_item_ids', 'company_knowledge_ids',
  'supersedes_id', 'replaces_id', 'derived_from_ids', 'related_item_ids', 'extensions'
]);

/** @type {Readonly<Record<string, Set<string>>>} */
const KIND_FIELDS = Object.freeze({
  project: new Set(['state', 'archive_outcome', 'archive_decided_at']),
  source_document: new Set(['source_path', 'source_hash', 'media_type']),
  business_item: new Set(['category', 'item_type', 'summary']),
  company_knowledge: new Set(['category', 'summary', 'reuse_status'])
});

/** @param {unknown} value */
function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** @param {any} value */
function cloneJson(value) {
  if (value === undefined) return undefined;
  return JSON.parse(JSON.stringify(value));
}

/** @param {any} value */
function text(value) {
  return typeof value === 'string' ? value.trim() : '';
}

/** @param {any} value */
function uniqueStrings(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map(text).filter(Boolean))].sort();
}

/** @param {AnyRecord} input @param {Set<string>} known */
function normalizeExtensions(input, known) {
  const extensions = isPlainObject(input.extensions) ? cloneJson(input.extensions) : {};
  for (const key of Object.keys(input).sort()) {
    if (!known.has(key)) extensions[key] = cloneJson(input[key]);
  }
  return extensions;
}

/** @param {AnyRecord} input @returns {AnyRecord} */
function normalizeRecord(input) {
  if (!isPlainObject(input)) throw new TypeError('记录必须是对象');
  const kind = text(input.record_kind);
  if (!RECORD_KINDS.includes(kind)) throw new Error(`不支持的记录类型：${kind || '空'}`);
  const known = new Set([...COMMON_FIELDS, ...KIND_FIELDS[kind]]);
  /** @type {AnyRecord} */
  const output = {
    schema_version: SCHEMA_VERSION,
    record_kind: kind,
    record_id: text(input.record_id),
    title: text(input.title),
    library: text(input.library),
    created_at: text(input.created_at),
    updated_at: text(input.updated_at)
  };
  for (const field of [
    'project_ids', 'source_document_ids', 'business_item_ids', 'company_knowledge_ids',
    'derived_from_ids', 'related_item_ids'
  ]) {
    const values = uniqueStrings(input[field]);
    if (values.length) output[field] = values;
  }
  for (const field of ['supersedes_id', 'replaces_id']) {
    const value = text(input[field]);
    if (value) output[field] = value;
  }
  for (const field of KIND_FIELDS[kind]) {
    if (field === 'state' || field === 'archive_outcome' || field === 'category' || field === 'item_type' || field === 'summary'
      || field === 'reuse_status' || field === 'source_path' || field === 'source_hash'
      || field === 'media_type' || field === 'archive_decided_at') {
      const value = text(input[field]);
      if (value) output[field] = value;
    }
  }
  const extensions = normalizeExtensions(input, known);
  if (Object.keys(extensions).length) output.extensions = extensions;
  return output;
}

/** @param {AnyRecord} input */
function validateRecord(input) {
  let record;
  try {
    record = normalizeRecord(input);
  } catch (error) {
    return { valid: false, errors: [error instanceof Error ? error.message : String(error)] };
  }
  const errors = [];
  if (!record.record_id) errors.push('record_id 不能为空');
  if (!record.title) errors.push('title 不能为空');
  if (!LIBRARIES.includes(record.library)) errors.push('library 必须是在办投标库或长期业务库');
  if (!record.created_at) errors.push('created_at 不能为空');
  if (!record.updated_at) errors.push('updated_at 不能为空');
  if (record.record_kind === 'project') {
    if (!PROJECT_STATES.includes(record.state)) errors.push('state 不是有效项目状态');
    if (record.state === 'archived' && !ARCHIVE_OUTCOMES.includes(record.archive_outcome)) {
      errors.push('归档项目必须说明 archive_outcome');
    }
    if (record.state !== 'archived' && record.archive_outcome) {
      errors.push('未归档项目不能设置 archive_outcome');
    }
  }
  if (record.record_kind === 'source_document' && !record.source_path && !record.source_hash) {
    errors.push('来源文档至少需要 source_path 或 source_hash');
  }
  if (record.record_kind === 'business_item' && record.category) {
    const categories = record.library === 'active_tender'
      ? [...ACTIVE_TENDER_CATEGORIES, ...ACTIVE_TENDER_REFERENCE_CATEGORIES]
      : BUSINESS_CATEGORIES;
    if (!categories.some((item) => item.key === record.category)) {
      errors.push('category 不是所属库的有效目录分类');
    }
  }
  if (record.record_kind === 'business_item' && record.item_type
    && !BUSINESS_ITEM_TYPES.some((item) => item.key === record.item_type)
    && !CANONICAL_ITEM_TYPES.has(record.item_type)) {
    errors.push('item_type 不是有效业务条目类型');
  }
  if (record.record_kind === 'company_knowledge' && record.library !== 'business') {
    errors.push('公司知识只能存放在长期业务库');
  }
  return { valid: errors.length === 0, errors, value: record };
}

/** @param {AnyRecord} input */
function migrateRecord(input) {
  const migrated = normalizeRecord(input);
  const result = validateRecord(migrated);
  if (!result.valid) throw new Error(result.errors.join('；'));
  return result.value;
}

/** @param {string} fromState */
function expectedArchiveOutcome(fromState) {
  if (fromState === 'won' || fromState === 'contracted') return 'won_completed';
  if (fromState === 'lost') return 'lost';
  if (fromState === 'terminated') return 'terminated';
  if (fromState === 'paused') return 'paused_by_decision';
  return '';
}

/**
 * @param {string} fromState
 * @param {string} toState
 * @param {{archive_outcome?: string, explicit_decision?: boolean}} options
 */
function validateProjectTransition(fromState, toState, options = {}) {
  if (!PROJECT_STATES.includes(fromState) || !PROJECT_STATES.includes(toState)) {
    return { allowed: false, reason: '项目状态无效' };
  }
  if (!ALLOWED_TRANSITIONS[fromState].includes(toState)) {
    return { allowed: false, reason: `不允许从“${STATE_LABELS[fromState]}”转为“${STATE_LABELS[toState]}”` };
  }
  if (toState !== 'archived') return { allowed: true };
  const expected = expectedArchiveOutcome(fromState);
  if (!expected || options.archive_outcome !== expected) {
    return { allowed: false, reason: '归档结果与当前项目状态不匹配' };
  }
  if (fromState === 'paused' && options.explicit_decision !== true) {
    return { allowed: false, reason: '暂停项目只能在明确作出归档决定后归档' };
  }
  return { allowed: true, archive_outcome: expected };
}

/** @param {string} prefix @param {any} value @param {number} index */
function legacyId(prefix, value, index) {
  const candidate = text(value).replace(/[^A-Za-z0-9._:-]+/g, '-').replace(/^-+|-+$/g, '');
  return `${prefix}:${candidate || String(index + 1)}`;
}

/**
 * 只读迁移规划：仅消费调用方提供的旧卡片和任务快照，返回计划，不写文件。
 */
/** @param {AnyRecord} legacy */
function planLegacyMigration(legacy = {}) {
  const cards = Array.isArray(legacy.cards) ? legacy.cards : [];
  const tasks = Array.isArray(legacy.tasks) ? legacy.tasks : [];
  /** @type {AnyRecord[]} */
  const actions = [];
  cards.forEach((card, index) => {
    const projectName = text(card.project);
    const cardId = legacyId('legacy-card', card.card_id || card.title, index);
    actions.push({
      action: 'extract_reusable_knowledge',
      source_ref: cardId,
      target_kind: 'company_knowledge',
      project_ref: projectName || undefined,
      preserves_source: true,
      reason: '旧卡片先作为可复用知识候选审阅，不等同于完整项目归档'
    });
  });
  tasks.forEach((task, index) => {
    const taskId = legacyId('legacy-task', task.task_id || task.taskId || task.source_path || task.sourcePath, index);
    actions.push({
      action: 'register_source_once',
      source_ref: taskId,
      target_kind: 'source_document',
      source_path: text(task.source_path || task.sourcePath),
      preserves_source: true
    });
  });
  const projects = Array.isArray(legacy.projects) ? legacy.projects : [];
  projects.forEach((project, index) => {
    const state = text(project.state || project.status);
    const outcome = text(project.archive_outcome);
    const check = validateProjectTransition(state, 'archived', {
      archive_outcome: outcome,
      explicit_decision: project.explicit_archival_decision === true
    });
    actions.push({
      action: 'archive_complete_project',
      source_ref: legacyId('legacy-project', project.record_id || project.project_id || project.title, index),
      target_kind: 'project',
      archive_outcome: outcome || undefined,
      ready: check.allowed,
      reason: check.allowed ? '完整项目资料可整体进入历史项目' : check.reason,
      preserves_source: true
    });
  });
  return {
    plan_version: SCHEMA_VERSION,
    mode: 'dry_run',
    writes_performed: 0,
    deletes_performed: 0,
    provider_calls: 0,
    input_counts: { cards: cards.length, tasks: tasks.length, projects: projects.length },
    actions
  };
}

module.exports = {
  SCHEMA_VERSION,
  RECORD_KINDS,
  LIBRARIES,
  PROJECT_STATES,
  ARCHIVE_OUTCOMES,
  STATE_LABELS,
  ALLOWED_TRANSITIONS,
  ACTIVE_TENDER_CATEGORIES,
  ACTIVE_TENDER_REFERENCE_CATEGORIES,
  BUSINESS_CATEGORIES,
  BUSINESS_ITEM_TYPES,
  DIRECTORY_PLAN,
  normalizeRecord,
  validateRecord,
  migrateRecord,
  validateProjectTransition,
  planLegacyMigration
};
},
"src/phase2-candidate-pipeline.js": function(require, module, exports) {
/**
 * Phase 2 shadow candidate pipeline.
 * Pure computation only: no filesystem, vault, project-state, or release mutations.
 */

const crypto = require('crypto');
const {
  ACTIVE_TENDER_CATEGORIES,
  ACTIVE_TENDER_REFERENCE_CATEGORIES,
  BUSINESS_CATEGORIES,
  BUSINESS_ITEM_TYPES
} = require("src/phase1-foundation.js");

const SCHEMA_VERSION = '2.0';
const LIBRARIES = Object.freeze(['active_tender', 'business']);
const ITEM_TYPES = Object.freeze(BUSINESS_ITEM_TYPES.map(({ key }) => key));
const CATEGORY_BY_LIBRARY = Object.freeze({
  active_tender: Object.freeze(
    [...ACTIVE_TENDER_CATEGORIES, ...ACTIVE_TENDER_REFERENCE_CATEGORIES].map(({ key }) => key)
  ),
  business: Object.freeze(BUSINESS_CATEGORIES.map(({ key }) => key))
});
const DOCUMENT_ROLES = Object.freeze([
  'source_record', 'instruction', 'submission', 'correspondence', 'meeting_record',
  'commercial_record', 'technical_record', 'contract_record', 'reference', 'unknown'
]);
const REVIEW_REASONS = Object.freeze([
  'ambiguous_project', 'ambiguous_category', 'conflicting_facts', 'missing_evidence',
  'unsupported_invented_facts', 'reuse_promotion'
]);
const DEFAULT_LIMITS = Object.freeze({
  max_blocks_per_batch: 12,
  max_extraction_requests: 8,
  max_text_per_block: 6000,
  max_evidence_text: 2000,
  max_items_per_batch: 40,
  max_reasons: 8,
  max_reason_text: 300
});

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function cleanText(value, max = 1000) {
  return typeof value === 'string' ? value.trim().replace(/\s+/g, ' ').slice(0, max) : '';
}

function verbatimText(value, max = 2000) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function normalizeIdentity(value) {
  return cleanText(value, 500).normalize('NFKC').toLocaleLowerCase()
    .replace(/[\s\-_.:/\\()[\]{}]+/g, '');
}

function stableId(prefix, parts) {
  const material = parts.map((part) => typeof part === 'string' ? part : JSON.stringify(part)).join('\u241f');
  return `${prefix}-${crypto.createHash('sha256').update(material).digest('hex').slice(0, 24)}`;
}

function uniqueTexts(value, maxItems, maxText) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((item) => cleanText(item, maxText)).filter(Boolean))].slice(0, maxItems);
}

function locatorKey(locator) {
  if (!isObject(locator)) return '';
  return `${cleanText(locator.scheme, 80)}:${cleanText(locator.value, 500)}`;
}

function normalizeLocator(locator) {
  if (!isObject(locator)) return null;
  const scheme = cleanText(locator.scheme, 80);
  const value = cleanText(locator.value, 500);
  if (!scheme || !value) return null;
  const output = { scheme, value };
  for (const key of ['page', 'sheet', 'range', 'row', 'message_id', 'attachment_id', 'heading_path']) {
    if (typeof locator[key] === 'number' && Number.isFinite(locator[key])) output[key] = locator[key];
    else if (typeof locator[key] === 'string' && locator[key].trim()) output[key] = cleanText(locator[key], 500);
    else if (Array.isArray(locator[key])) output[key] = uniqueTexts(locator[key], 20, 200);
  }
  return output;
}

function blockBoundary(block) {
  const locator = normalizeLocator(block && block.locator);
  const metadata = isObject(block && block.metadata) ? block.metadata : {};
  return {
    locator,
    locator_key: locatorKey(locator),
    table_row_id: cleanText(metadata.table_row_id || metadata.row_id, 200),
    email_message_id: cleanText(metadata.email_message_id || metadata.message_id, 300),
    explicit_same_item_id: cleanText(metadata.same_item_id, 200)
  };
}

function eligibleBlocks(blocks, limits = DEFAULT_LIMITS) {
  if (!Array.isArray(blocks)) return [];
  return blocks.filter((block) => {
    if (!isObject(block) || block.card_eligible !== true) return false;
    if (!isObject(block.parse) || block.parse.status !== 'present') return false;
    if (block.metadata && (block.metadata.noise === true || block.metadata.structural_noise === true)) return false;
    return Boolean(cleanText(block.raw && block.raw.text, limits.max_text_per_block));
  });
}

function normalizeRegistry(registry) {
  if (!Array.isArray(registry)) return [];
  return registry.map((entry) => {
    if (!isObject(entry)) return null;
    const projectId = cleanText(entry.project_id, 200);
    if (!projectId) return null;
    const identities = [
      entry.name,
      ...(Array.isArray(entry.aliases) ? entry.aliases : []),
      ...(Array.isArray(entry.references) ? entry.references : [])
    ].map(normalizeIdentity).filter(Boolean);
    return { project_id: projectId, identities: [...new Set(identities)] };
  }).filter(Boolean);
}

function explicitProjectEvidence(document, blocks) {
  const values = [];
  const metadata = isObject(document.metadata) ? document.metadata : {};
  for (const key of ['project_id', 'project_name', 'project_reference']) {
    if (metadata[key]) values.push({ value: metadata[key], source: `document.metadata.${key}` });
  }
  if (document.filename) {
    const filename = cleanText(document.filename, 500);
    values.push({ value: filename.replace(/\.[^.]+$/, ''), source: 'filename' });
    filename.replace(/\.[^.]+$/, '').split(/[\s\-_.:/\\()[\]{}]+/)
      .filter(Boolean).forEach((value) => values.push({ value, source: 'filename_token' }));
  }
  for (const block of blocks) {
    const meta = isObject(block.metadata) ? block.metadata : {};
    for (const key of ['project_id', 'project_name', 'project_reference']) {
      if (meta[key]) values.push({
        value: meta[key],
        source: `${cleanText(block.block_id, 100) || 'block'}.metadata.${key}`
      });
    }
  }
  return values.map((item) => ({ ...item, normalized: normalizeIdentity(item.value) }))
    .filter((item) => item.normalized);
}

function matchProjects(document, blocks, projectRegistry) {
  const registry = normalizeRegistry(projectRegistry);
  const evidence = explicitProjectEvidence(document, blocks);
  const matches = [];
  for (const project of registry) {
    const hits = evidence.filter(({ normalized }) =>
      project.identities.some((identity) => normalized === identity));
    if (hits.length) matches.push({ project_id: project.project_id, hits });
  }
  return matches;
}

function validCategory(library, category) {
  return LIBRARIES.includes(library) && CATEGORY_BY_LIBRARY[library].includes(category);
}

function localRoute(document, blocks, projectRegistry) {
  const metadata = isObject(document.metadata) ? document.metadata : {};
  const matches = matchProjects(document, blocks, projectRegistry);
  const route = {
    schema_version: SCHEMA_VERSION,
    source_document_id: cleanText(document.source_document_id, 200),
    confidence: 0,
    reasons: [],
    review_reasons: []
  };
  if (matches.length === 1) {
    route.project_id = matches[0].project_id;
    route.confidence = 1;
    route.reasons.push('项目仅由注入登记表中的精确名称、别名或编号证据匹配');
  } else if (matches.length > 1) {
    route.review_reasons.push('ambiguous_project');
    route.reasons.push('显式项目证据同时匹配多个登记项目');
  }
  const library = cleanText(metadata.library, 80);
  const category = cleanText(metadata.directory_category || metadata.category, 120);
  if (LIBRARIES.includes(library)) {
    route.library = library;
    route.confidence = Math.max(route.confidence, 1);
    route.reasons.push('采用来源适配器提供的显式库元数据');
  }
  if (route.library && validCategory(route.library, category)) {
    route.directory_category = category;
    route.reasons.push('采用 Phase 1 定义内的显式目录分类元数据');
  } else if (category) {
    route.review_reasons.push('ambiguous_category');
  }
  const role = cleanText(metadata.document_role, 120);
  if (DOCUMENT_ROLES.includes(role) && role !== 'unknown') {
    route.document_role = role;
    route.reasons.push('采用来源适配器提供的显式文档角色');
  }
  for (const field of ['supersedes_document_id', 'replaces_document_id', 'version_label']) {
    const value = cleanText(metadata[field], 300);
    if (value) route[field] = value;
  }
  route.resolved = Boolean(route.library && route.directory_category && route.document_role)
    && !route.review_reasons.length;
  return route;
}

function routingInput(document, blocks, registry) {
  return {
    source_document_id: cleanText(document.source_document_id, 200),
    filename: cleanText(document.filename || document.source_path, 500),
    source_type: cleanText(document.source_type, 100),
    metadata: isObject(document.metadata) ? document.metadata : {},
    project_registry: normalizeRegistry(registry),
    blocks: blocks.slice(0, 30).map((block) => ({
      block_id: cleanText(block.block_id, 100),
      kind: cleanText(block.kind, 100),
      locator: normalizeLocator(block.locator),
      heading: block.inferred && cleanText(block.inferred.heading, 500),
      metadata: isObject(block.metadata) ? block.metadata : {}
    })),
    allowed: { libraries: LIBRARIES, categories: CATEGORY_BY_LIBRARY, document_roles: DOCUMENT_ROLES }
  };
}

function normalizeRoute(raw, document, local, projectRegistry) {
  const candidate = isObject(raw) ? raw : {};
  const route = {
    schema_version: SCHEMA_VERSION,
    source_document_id: cleanText(document.source_document_id, 200),
    confidence: Math.max(0, Math.min(1, Number(candidate.confidence) || local.confidence || 0)),
    reasons: uniqueTexts([...(local.reasons || []), ...(candidate.reasons || [])],
      DEFAULT_LIMITS.max_reasons, DEFAULT_LIMITS.max_reason_text),
    review_reasons: uniqueTexts(local.review_reasons, 8, 80)
  };
  const registryIds = new Set(normalizeRegistry(projectRegistry).map(({ project_id }) => project_id));
  const proposedProject = cleanText(candidate.project_id || local.project_id, 200);
  const evidencedProjectIds = new Set(
    matchProjects(document, Array.isArray(document.blocks) ? document.blocks : [], projectRegistry)
      .map(({ project_id }) => project_id)
  );
  if (proposedProject && registryIds.has(proposedProject) && evidencedProjectIds.has(proposedProject)) {
    route.project_id = proposedProject;
  }
  else if (proposedProject) route.review_reasons.push('unsupported_invented_facts');
  const library = cleanText(candidate.library || local.library, 80);
  if (LIBRARIES.includes(library)) route.library = library;
  const category = cleanText(candidate.directory_category || local.directory_category, 120);
  if (route.library && validCategory(route.library, category)) route.directory_category = category;
  else if (category) route.review_reasons.push('ambiguous_category');
  const role = cleanText(candidate.document_role || local.document_role, 120);
  route.document_role = DOCUMENT_ROLES.includes(role) ? role : 'unknown';
  for (const field of ['supersedes_document_id', 'replaces_document_id', 'version_label']) {
    const value = cleanText(candidate[field] || local[field], 300);
    if (value) route[field] = value;
  }
  route.review_reasons = [...new Set(route.review_reasons)];
  route.resolved = Boolean(route.library && route.directory_category && route.document_role !== 'unknown')
    && !route.review_reasons.length;
  return route;
}

function extractionInput(document, route, batch, limits) {
  return {
    source_document_id: cleanText(document.source_document_id, 200),
    route: {
      project_id: route.project_id,
      library: route.library,
      directory_category: route.directory_category,
      document_role: route.document_role
    },
    allowed_item_types: ITEM_TYPES,
    blocks: batch.map((block) => ({
      block_id: cleanText(block.block_id, 100),
      kind: cleanText(block.kind, 100),
      locator: normalizeLocator(block.locator),
      provenance: Array.isArray(block.provenance)
        ? block.provenance.map(normalizeLocator).filter(Boolean).slice(0, 20) : [],
      boundary: blockBoundary(block),
      text: cleanText(block.raw && block.raw.text, limits.max_text_per_block),
      fields: isObject(block.raw && block.raw.fields) ? block.raw.fields : {},
      inferred: isObject(block.inferred) ? block.inferred : {},
      metadata: isObject(block.metadata) ? block.metadata : {}
    }))
  };
}

function evidenceWithinBlock(evidence, sourceBlock, limits) {
  const text = verbatimText(evidence && evidence.verbatim, limits.max_evidence_text);
  const sourceText = verbatimText(
    sourceBlock.text || (sourceBlock.raw && sourceBlock.raw.text),
    limits.max_text_per_block
  );
  return Boolean(text && sourceText.includes(text));
}

function normalizeFacts(value) {
  if (!isObject(value)) return undefined;
  const output = {};
  for (const key of ['actors', 'status', 'dates', 'units', 'numbers', 'modality']) {
    const values = uniqueTexts(Array.isArray(value[key]) ? value[key] : [value[key]], 20, 300);
    if (values.length) output[key] = values;
  }
  return Object.keys(output).length ? output : undefined;
}

function validateCandidate(raw, context, index, limits) {
  if (!isObject(raw)) return { error: '候选不是对象' };
  const itemType = cleanText(raw.item_type, 80);
  if (!ITEM_TYPES.includes(itemType)) return { error: '业务条目类型不在 Phase 1 定义中' };
  const blockId = cleanText(raw.block_id || (raw.evidence && raw.evidence.block_id), 100);
  const sourceBlock = context.blocks.find((block) => block.block_id === blockId);
  if (!sourceBlock) return { error: '证据块不在当前批次' };
  if (!normalizeLocator(sourceBlock.locator)) return { error: '证据块缺少有效定位' };
  if (!evidenceWithinBlock(raw.evidence, sourceBlock, limits)) return { error: '逐字证据不在指定块中' };
  const boundary = blockBoundary(sourceBlock);
  const verbatim = verbatimText(raw.evidence.verbatim, limits.max_evidence_text);
  const applicableConditions = uniqueTexts(raw.applicable_conditions, 20, 500);
  const candidate = {
    schema_version: SCHEMA_VERSION,
    candidate_id: stableId('bic', [
      context.source_document_id, blockId, boundary.locator_key, itemType,
      normalizeIdentity(verbatim), applicableConditions
    ]),
    source_document_id: context.source_document_id,
    item_type: itemType,
    summary: cleanText(raw.summary, 1000) || verbatim,
    evidence: {
      block_id: blockId,
      locator: boundary.locator,
      provenance: Array.isArray(sourceBlock.provenance)
        ? sourceBlock.provenance.map(normalizeLocator).filter(Boolean).slice(0, 20) : [],
      verbatim
    },
    applicable_conditions: applicableConditions,
    reusable_knowledge_candidate: raw.reusable_knowledge_candidate === true,
    reuse_reasons: uniqueTexts(raw.reuse_reasons, 5, 300),
    review_reasons: []
  };
  if (context.route.project_id) candidate.project_id = context.route.project_id;
  if (context.route.directory_category) candidate.directory_category = context.route.directory_category;
  const facts = normalizeFacts(raw.facts);
  if (facts) candidate.facts = facts;
  if (candidate.reusable_knowledge_candidate) candidate.review_reasons.push('reuse_promotion');
  if (raw.project_id && raw.project_id !== candidate.project_id) {
    candidate.review_reasons.push('unsupported_invented_facts');
  }
  if (raw.directory_category && raw.directory_category !== candidate.directory_category) {
    candidate.review_reasons.push('unsupported_invented_facts');
  }
  candidate._boundary = boundary;
  candidate._index = index;
  return { candidate };
}

function validateBatch(raw, context, limits) {
  if (!isObject(raw) || !Array.isArray(raw.items) || raw.items.length > limits.max_items_per_batch) {
    return { valid: false, errors: ['批次必须包含有界 items 数组'], candidates: [] };
  }
  const candidates = [];
  const errors = [];
  raw.items.forEach((item, index) => {
    const result = validateCandidate(item, context, index, limits);
    if (result.error) errors.push(`items[${index}]: ${result.error}`);
    else candidates.push(result.candidate);
  });
  return { valid: errors.length === 0, errors, candidates };
}

function sameBoundary(a, b) {
  if (a._boundary.explicit_same_item_id && b._boundary.explicit_same_item_id) {
    return a._boundary.explicit_same_item_id === b._boundary.explicit_same_item_id;
  }
  if (a._boundary.table_row_id || b._boundary.table_row_id) {
    return a._boundary.table_row_id === b._boundary.table_row_id && a._boundary.locator_key === b._boundary.locator_key;
  }
  if (a._boundary.email_message_id || b._boundary.email_message_id) {
    return a._boundary.email_message_id === b._boundary.email_message_id;
  }
  return a.evidence.block_id === b.evidence.block_id;
}

function conflictSignature(candidate) {
  const facts = candidate.facts || {};
  return JSON.stringify({
    numbers: facts.numbers || [], dates: facts.dates || [], units: facts.units || [],
    modality: facts.modality || [], conditions: candidate.applicable_conditions || [],
    item_type: candidate.item_type
  });
}

function consolidateCandidates(candidates) {
  const output = [];
  for (const candidate of candidates) {
    const contentKey = normalizeIdentity(candidate.evidence.verbatim || candidate.summary);
    const existing = output.find((item) =>
      item.source_document_id === candidate.source_document_id
      && item.item_type === candidate.item_type
      && sameBoundary(item, candidate)
      && normalizeIdentity(item.evidence.verbatim || item.summary) === contentKey
      && conflictSignature(item) === conflictSignature(candidate));
    if (!existing) {
      output.push(candidate);
      continue;
    }
    existing.reuse_reasons = [...new Set([...existing.reuse_reasons, ...candidate.reuse_reasons])];
    existing.review_reasons = [...new Set([...existing.review_reasons, ...candidate.review_reasons])];
  }
  const groups = new Map();
  for (const candidate of output) {
    const key = `${candidate.source_document_id}|${candidate.item_type}|${normalizeIdentity(candidate.summary)}`;
    const group = groups.get(key) || [];
    group.push(candidate);
    groups.set(key, group);
  }
  for (const group of groups.values()) {
    if (group.length > 1 && new Set(group.map(conflictSignature)).size > 1) {
      group.forEach((candidate) => candidate.review_reasons.push('conflicting_facts'));
    }
  }
  return output.map((candidate) => {
    const clean = { ...candidate, review_reasons: [...new Set(candidate.review_reasons)] };
    delete clean._boundary;
    delete clean._index;
    return clean;
  });
}

function buildReviewSummary(route, candidates, extraReviewReasons = []) {
  const lines = [];
  const reviewItems = candidates.filter((item) => item.review_reasons.length);
  lines.push(`发现 ${candidates.length} 条可审阅业务候选。`);
  if (route.project_id) lines.push(`文档关联到登记项目“${route.project_id}”。`);
  else lines.push('项目关联尚未确定。');
  if (route.library && route.directory_category) {
    lines.push(`建议目录为 ${route.library} / ${route.directory_category}。`);
  } else {
    lines.push('建议目录尚未确定。');
  }
  for (const item of candidates.slice(0, 8)) {
    const place = item.evidence.locator
      ? `${item.evidence.locator.scheme} ${item.evidence.locator.value}` : `块 ${item.evidence.block_id}`;
    lines.push(`- ${item.summary}（来源：${place}）`);
  }
  const reasons = new Set([
    ...route.review_reasons,
    ...reviewItems.flatMap((item) => item.review_reasons),
    ...extraReviewReasons
  ]);
  if (reasons.size) {
    const labels = {
      ambiguous_project: '项目证据有歧义',
      ambiguous_category: '目录判断有歧义',
      conflicting_facts: '数字、日期、单位、语气或适用条件存在冲突',
      missing_evidence: '缺少可核对的原文证据',
      unsupported_invented_facts: '候选包含来源不支持的补充事实',
      reuse_promotion: '标记为可复用知识仍需人工批准'
    };
    lines.push(`需要复核：${[...reasons].map((reason) => labels[reason]).filter(Boolean).join('；')}。`);
  } else {
    lines.push('当前候选没有触发人工复核条件。');
  }
  lines.push('可选操作：确认候选；修改项目或目录；退回并保留来源不入库。');
  return lines.join('\n');
}

async function callJson(requestJson, request, counters, kind) {
  counters.total_provider_requests += 1;
  counters[`${kind}_requests`] += 1;
  return requestJson(request);
}

async function runPhase2CandidatePipeline(options = {}) {
  const document = isObject(options.document) ? options.document : {};
  const limits = {
    ...DEFAULT_LIMITS,
    ...(isObject(options.limits) ? options.limits : {})
  };
  limits.max_blocks_per_batch = Math.max(1, Math.min(50, Number(limits.max_blocks_per_batch) || 12));
  limits.max_extraction_requests = Math.max(0, Math.min(100, Number(limits.max_extraction_requests) || 0));
  const requestJson = typeof options.requestJson === 'function' ? options.requestJson : null;
  const counters = {
    routing_requests: 0,
    extraction_requests: 0,
    repair_requests: 0,
    total_provider_requests: 0,
    eligible_blocks: 0,
    skipped_blocks: 0,
    planned_batches: 0,
    processed_batches: 0
  };
  const blocks = Array.isArray(document.blocks) ? document.blocks : [];
  const eligible = eligibleBlocks(blocks, limits);
  counters.eligible_blocks = eligible.length;
  counters.skipped_blocks = blocks.length - eligible.length;
  const local = localRoute(document, blocks, options.projectRegistry);
  let route = normalizeRoute({}, document, local, options.projectRegistry);
  if (requestJson && !local.resolved) {
    const rawRoute = await callJson(requestJson, {
      kind: 'phase2_document_route',
      prompt: 'phase2/document-router-v1',
      input: routingInput(document, blocks, options.projectRegistry)
    }, counters, 'routing');
    route = normalizeRoute(rawRoute, document, local, options.projectRegistry);
  }
  const batches = [];
  for (let index = 0; index < eligible.length; index += limits.max_blocks_per_batch) {
    batches.push(eligible.slice(index, index + limits.max_blocks_per_batch));
  }
  counters.planned_batches = batches.length;
  const allCandidates = [];
  const diagnostics = [];
  if (requestJson) {
    const startBatch = Math.max(0, Number(options.resumeFromBatch) || 0);
    const allowedBatches = Math.min(batches.length - startBatch, limits.max_extraction_requests);
    for (let offset = 0; offset < allowedBatches; offset += 1) {
      const batchIndex = startBatch + offset;
      const input = extractionInput(document, route, batches[batchIndex], limits);
      let raw = await callJson(requestJson, {
        kind: 'phase2_business_item_extract',
        prompt: 'phase2/business-item-extractor-v1',
        batch_index: batchIndex,
        input
      }, counters, 'extraction');
      let checked = validateBatch(raw, { ...input, route }, limits);
      if (!checked.valid) {
        diagnostics.push({ batch_index: batchIndex, errors: checked.errors });
        raw = await callJson(requestJson, {
          kind: 'phase2_quality_repair',
          prompt: 'phase2/quality-repair-v1',
          batch_index: batchIndex,
          invalid_output: raw,
          validation_errors: checked.errors,
          input
        }, counters, 'repair');
        checked = validateBatch(raw, { ...input, route }, limits);
      }
      if (checked.valid) allCandidates.push(...checked.candidates);
      else diagnostics.push({ batch_index: batchIndex, errors: checked.errors, repair_failed: true });
      counters.processed_batches += 1;
    }
  }
  const candidates = consolidateCandidates(allCandidates);
  const diagnosticReviewReasons = [];
  for (const diagnostic of diagnostics) {
    const joined = (diagnostic.errors || []).join(' ');
    if (joined.includes('证据')) diagnosticReviewReasons.push('missing_evidence');
    if (joined.includes('类型') || joined.includes('批次')) {
      diagnosticReviewReasons.push('unsupported_invented_facts');
    }
  }
  return {
    schema_version: SCHEMA_VERSION,
    mode: 'shadow_candidate',
    provider_enabled: Boolean(requestJson),
    writes_performed: 0,
    deletes_performed: 0,
    state_transitions_performed: 0,
    route,
    business_item_batch: {
      schema_version: SCHEMA_VERSION,
      batch_id: stableId('bib', [cleanText(document.source_document_id, 200), candidates.map((item) => item.candidate_id)]),
      source_document_id: cleanText(document.source_document_id, 200),
      items: candidates
    },
    review_summary: buildReviewSummary(route, candidates, [...new Set(diagnosticReviewReasons)]),
    counters,
    diagnostics
  };
}

module.exports = {
  SCHEMA_VERSION,
  LIBRARIES,
  ITEM_TYPES,
  CATEGORY_BY_LIBRARY,
  DOCUMENT_ROLES,
  REVIEW_REASONS,
  DEFAULT_LIMITS,
  normalizeIdentity,
  normalizeLocator,
  eligibleBlocks,
  localRoute,
  normalizeRoute,
  validateBatch,
  consolidateCandidates,
  buildReviewSummary,
  runPhase2CandidatePipeline
};
},
"src/phase3-review-gate.js": function(require, module, exports) {
/**
 * Phase 3 shadow review gate.
 * Pure computation: it never writes, deletes, moves files, or changes project state.
 */

const crypto = require('crypto');

const PHASE3_SCHEMA_VERSION = '3.0';
const PHASE3_SETTINGS_DEFAULTS = Object.freeze({
  phase3_shadow_enabled: false,
  phase3_pilot_enabled: false,
  phase3_write_enabled: false
});
const OUTCOMES = Object.freeze({
  PASS: 'automatic_pass',
  NOTICE: 'automatic_pass_with_notice',
  MANUAL: 'mandatory_human_handling'
});
const HARD_RISKS = Object.freeze([
  'project_ownership_conflict',
  'critical_fact_conflict',
  'missing_or_unverifiable_evidence',
  'unsupported_model_fact',
  'company_reuse_promotion'
]);
const NOTICE_REASONS = Object.freeze([
  'category_unresolved',
  'noncritical_difference',
  'route_incomplete'
]);

const text = (value, max = 500) =>
  typeof value === 'string' ? value.trim().replace(/\s+/g, ' ').slice(0, max) : '';
const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const sortedUnique = (values) => [...new Set(values.filter(Boolean))].sort();
const digest = (value) => crypto.createHash('sha256')
  .update(JSON.stringify(value)).digest('hex');
const id = (prefix, value) => `${prefix}-${digest(value).slice(0, 24)}`;

function evidenceIsVerifiable(candidate) {
  if (!object(candidate.evidence)) return false;
  const evidence = candidate.evidence;
  const quote = text(evidence.verbatim, 4000);
  const blockId = text(evidence.block_id || candidate.block_id, 300);
  const locator = object(evidence.locator) &&
    text(evidence.locator.scheme, 80) && text(evidence.locator.value, 500);
  return Boolean(quote && blockId && locator);
}

function conflictSignature(candidate) {
  const facts = object(candidate.facts) ? candidate.facts : {};
  const critical = {};
  for (const field of ['amounts', 'numbers', 'dates', 'units', 'statuses', 'status']) {
    const value = facts[field];
    if (Array.isArray(value) && value.length) critical[field] = sortedUnique(value.map(String));
    else if (value !== undefined && value !== null && text(String(value))) critical[field] = text(String(value));
  }
  const explicit = text(candidate.conflict_id || candidate.conflict_signature, 300);
  return explicit || (Object.keys(critical).length ? digest(critical).slice(0, 20) : '');
}

function classifyCandidate(candidate, route = {}) {
  const reasons = new Set(Array.isArray(candidate.review_reasons) ? candidate.review_reasons : []);
  const hardRisks = [];
  const notices = [];

  if (reasons.has('ambiguous_project') || reasons.has('conflicting_project_ownership')
      || (Array.isArray(route.review_reasons) && route.review_reasons.includes('ambiguous_project'))) {
    hardRisks.push('project_ownership_conflict');
  }
  if (reasons.has('missing_evidence') || !evidenceIsVerifiable(candidate)) {
    hardRisks.push('missing_or_unverifiable_evidence');
  }
  if (reasons.has('unsupported_invented_facts') || reasons.has('unsupported_model_fact')) {
    hardRisks.push('unsupported_model_fact');
  }
  if (candidate.reusable_knowledge_candidate === true || reasons.has('reuse_promotion')) {
    hardRisks.push('company_reuse_promotion');
  }
  const differenceStatus = text(candidate.material_difference_status
    || candidate.material_differences?.status, 80);
  const blockingDifference = ['missing_in_evidence', 'unsupported_addition', 'conflict',
    'ambiguous_conversion', 'strengthened_obligation', 'weakened_obligation',
    'changed_obligation', 'invented_condition', 'removed_condition_or_exception'].includes(differenceStatus);
  if (reasons.has('critical_fact_conflict') || blockingDifference) {
    hardRisks.push('critical_fact_conflict');
  } else if (reasons.has('conflicting_facts')) {
    notices.push('noncritical_difference');
  }
  if (reasons.has('ambiguous_category')) notices.push('category_unresolved');
  if (!route.library || !route.directory_category || !route.document_role
      || route.document_role === 'unknown') notices.push('route_incomplete');

  const hard = sortedUnique(hardRisks);
  const note = sortedUnique(notices);
  return {
    candidate_id: text(candidate.candidate_id, 300),
    source_document_id: text(candidate.source_document_id, 300),
    outcome: hard.length ? OUTCOMES.MANUAL : note.length ? OUTCOMES.NOTICE : OUTCOMES.PASS,
    hard_risks: hard,
    notices: note,
    conflict_signature: hard.includes('critical_fact_conflict') ? conflictSignature(candidate) : ''
  };
}

function actionFor(reason) {
  return {
    project_ownership_conflict: '请选择该资料实际所属的项目；如证据互相冲突，请分别处理。',
    critical_fact_conflict: '请对照原文确认金额、日期、单位或状态，并选择正确事实。',
    missing_or_unverifiable_evidence: '请补充可定位的原文证据，或退回该条目。',
    unsupported_model_fact: '请删除来源没有写明的内容，或提供支持它的原文证据。',
    company_reuse_promotion: '请确认是否把这条项目资料提升为公司可复用知识。'
  }[reason];
}

function groupMandatory(classifications) {
  const groups = new Map();
  for (const item of classifications) {
    for (const reason of item.hard_risks) {
      const conflictPart = reason === 'critical_fact_conflict'
        ? `:${item.conflict_signature || item.candidate_id}` : '';
      const key = `${item.source_document_id}:${reason}${conflictPart}`;
      if (!groups.has(key)) groups.set(key, {
        group_id: id('review', key),
        source_document_id: item.source_document_id,
        root_cause: reason,
        action: actionFor(reason),
        candidate_ids: []
      });
      groups.get(key).candidate_ids.push(item.candidate_id);
    }
  }
  return [...groups.values()].map((group) => ({
    ...group,
    candidate_ids: sortedUnique(group.candidate_ids)
  })).sort((a, b) => a.group_id.localeCompare(b.group_id));
}

function plainSummary(counters, groups) {
  const first = `本次生成 ${counters.generated} 条：自动通过 ${counters.auto_passed} 条，`
    + `通过并提示 ${counters.notices} 条，需要处理 ${counters.needs_handling} 条。`;
  if (!groups.length) return `${first} 无需逐条确认。`;
  return `${first} 请按 ${groups.length} 个问题组处理：确认正确内容、补充证据，或退回有问题的条目。`;
}

function evaluatePhase3(phase2Result) {
  const route = object(phase2Result && phase2Result.route) ? phase2Result.route : {};
  const candidates = phase2Result && phase2Result.business_item_batch
    && Array.isArray(phase2Result.business_item_batch.items)
    ? phase2Result.business_item_batch.items : [];
  const classifications = candidates.map((candidate) => classifyCandidate(candidate, route));
  const groups = groupMandatory(classifications);
  const counters = {
    generated: classifications.length,
    auto_passed: classifications.filter((item) => item.outcome === OUTCOMES.PASS).length,
    notices: classifications.filter((item) => item.outcome === OUTCOMES.NOTICE).length,
    needs_handling: classifications.filter((item) => item.outcome === OUTCOMES.MANUAL).length,
    handling_groups: groups.length
  };
  return {
    schema_version: PHASE3_SCHEMA_VERSION,
    mode: 'shadow_review',
    classifications,
    handling_groups: groups,
    summary: plainSummary(counters, groups),
    counters,
    diagnostics: {
      rules: { hard_risks: HARD_RISKS, notice_reasons: NOTICE_REASONS },
      phase2_schema_version: phase2Result && phase2Result.schema_version
    },
    writes_performed: 0,
    deletes_performed: 0,
    state_transitions_performed: 0
  };
}

function runPhase3Shadow(phase2Result, settings = {}) {
  const effective = { ...PHASE3_SETTINGS_DEFAULTS, ...(object(settings) ? settings : {}) };
  if (effective.phase3_shadow_enabled !== true) {
    return {
      schema_version: PHASE3_SCHEMA_VERSION,
      mode: 'feature_off',
      summary: '第三阶段试运行未开启。',
      classifications: [],
      handling_groups: [],
      counters: { generated: 0, auto_passed: 0, notices: 0, needs_handling: 0, handling_groups: 0 },
      writes_performed: 0, deletes_performed: 0, state_transitions_performed: 0
    };
  }
  return evaluatePhase3(phase2Result);
}

function createDecisionEntry(input, previousEntry = null) {
  const candidateIds = Object.freeze(sortedUnique(
    Array.isArray(input.candidate_ids) ? input.candidate_ids.map(String) : []
  ));
  const payload = {
    schema_version: PHASE3_SCHEMA_VERSION,
    decision_id: text(input.decision_id, 300) || id('decision', input),
    decided_at: text(input.decided_at, 80),
    decided_by: text(input.decided_by, 200),
    source_document_id: text(input.source_document_id, 300),
    group_id: text(input.group_id, 300),
    decision: text(input.decision, 80),
    candidate_ids: candidateIds,
    reason: text(input.reason, 1000),
    previous_entry_hash: previousEntry ? previousEntry.entry_hash : null
  };
  return Object.freeze({ ...payload, entry_hash: digest(payload) });
}

function verifyDecisionLedger(entries) {
  if (!Array.isArray(entries)) return false;
  let previous = null;
  for (const entry of entries) {
    const { entry_hash: entryHash, ...payload } = entry;
    if (payload.previous_entry_hash !== (previous ? previous.entry_hash : null)) return false;
    if (digest(payload) !== entryHash) return false;
    previous = entry;
  }
  return true;
}

function planDocumentWithdrawal(sourceDocumentId, affectedRecordIds = []) {
  const documentId = text(sourceDocumentId, 300);
  if (!documentId) throw new Error('缺少来源文档编号');
  const recordIds = Object.freeze(sortedUnique(affectedRecordIds.map(String)));
  return Object.freeze({
    schema_version: PHASE3_SCHEMA_VERSION,
    plan_id: id('withdraw', [documentId, recordIds]),
    source_document_id: documentId,
    affected_record_ids: recordIds,
    status: 'planned_not_executed',
    steps: Object.freeze([
      '标记该来源文档产生的记录为待撤回',
      '在受控写入阶段反向应用该文档的写入清单',
      '保留原文件、项目状态和完整决策记录'
    ]),
    deletes_user_files: false,
    changes_project_status: false,
    writes_performed: 0
  });
}

module.exports = {
  PHASE3_SCHEMA_VERSION,
  PHASE3_SETTINGS_DEFAULTS,
  OUTCOMES,
  HARD_RISKS,
  NOTICE_REASONS,
  evidenceIsVerifiable,
  conflictSignature,
  classifyCandidate,
  groupMandatory,
  evaluatePhase3,
  runPhase3Shadow,
  createDecisionEntry,
  verifyDecisionLedger,
  planDocumentWithdrawal
};
},
"src/universal-knowledge-pipeline.js": function(require, module, exports) {
/**
 * Format-independent semantic pipeline.
 * Adapters end at canonical blocks. Everything below operates only on their
 * content, order, provenance and structural hints.
 */
const crypto = require('crypto');

const PIPELINE_VERSION = '3.1';
const OUTPUT_LANGUAGE = 'zh-CN';
const TRANSLATION_VERSION = 'universal-zh-v1';
const SEMANTIC_KINDS = Object.freeze([
  'fact', 'requirement', 'decision', 'action', 'process', 'method', 'parameter',
  'risk', 'issue', 'experience', 'commercial_term', 'schedule', 'entity_profile',
  'correspondence'
]);
const REGION_KINDS = Object.freeze([...SEMANTIC_KINDS, 'evidence_only', 'noise']);
const ACTIVE_STATES = new Set(['lead', 'approved', 'bidding', 'submitted', 'evaluating', 'won', 'contracted', 'active']);
const HISTORICAL_STATES = new Set(['lost', 'paused', 'terminated', 'archived', 'completed', 'cancelled', 'suspended']);
const BLOCK_KINDS = new Set([
  'heading', 'paragraph', 'list', 'list_item', 'table', 'table_row', 'key_value',
  'figure', 'caption', 'header', 'footer', 'email_envelope', 'email_body',
  'email_thread', 'sheet', 'page', 'attachment', 'text'
]);
const TAG_SYNONYMS = Object.freeze({
  '质量管理': '质量', '品质': '质量', '安全管理': '安全', '工期': '时间',
  '进度': '时间', '造价': '成本', '报价': '成本', '供应商': '供应链',
  '分包商': '供应链', '施工工艺': '工艺', '技术方法': '工艺',
  '合同条款': '合同', '规范': '标准', '标准规范': '标准',
  quality: '质量', 品質管理: '质量', safety: '安全', 安全管理: '安全',
  schedule: '时间', 工期: '时间', cost: '成本', price: '成本', 見積: '成本',
  supplier: '供应链', サプライヤー: '供应链', subcontractor: '供应链',
  contract: '合同', 契約: '合同', standard: '标准', 規格: '标准',
  requirement: '要求', 要求事項: '要求', risk: '风险', リスク: '风险'
});
const KIND_TAG = Object.freeze({
  fact: '事实', requirement: '要求', decision: '决策', action: '行动',
  process: '流程', method: '方法', parameter: '参数', risk: '风险',
  issue: '问题', experience: '经验', commercial_term: '商务条款',
  schedule: '计划', entity_profile: '实体', correspondence: '往来'
});
const BUSINESS_CATEGORY = Object.freeze({
  requirement: 'standards_specifications', method: 'technical_methods_workmanship',
  process: 'company_systems_processes', risk: 'risks_issues', issue: 'risks_issues',
  experience: 'failures_terminated_lessons', commercial_term: 'contracts_legal',
  schedule: 'construction_organization_schedules', entity_profile: 'customers',
  correspondence: 'correspondence_important_decisions', parameter: 'materials_equipment',
  fact: 'terminology_general_knowledge', decision: 'correspondence_important_decisions',
  action: 'company_systems_processes'
});
const ACTIVE_CATEGORY = Object.freeze({
  requirement: 'tender_documents_interpretation', method: 'technical_solution',
  process: 'bid_strategy_responsibilities', risk: 'risk_deviation_compliance',
  issue: 'risk_deviation_compliance', experience: 'review_knowledge_candidates',
  commercial_term: 'commercial_quotation_cost', schedule: 'construction_organization_schedule',
  entity_profile: 'opportunity_customer', correspondence: 'project_correspondence',
  parameter: 'procurement_subcontracting', fact: 'project_overview',
  decision: 'internal_review_decision', action: 'meeting_minutes_decisions'
});

const clean = (value, max = 8000) => typeof value === 'string'
  ? value.normalize('NFKC').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, max) : '';
const stableJson = (value) => {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort()
    .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
};
const digest = (value) => crypto.createHash('sha256').update(typeof value === 'string' ? value : stableJson(value)).digest('hex');
const uniq = (items) => [...new Set((items || []).filter((item) => item !== undefined && item !== null)
  .map((item) => clean(String(item), 160)).filter(Boolean))];
const score = (text, patterns) => patterns.reduce((total, pattern) => total + (pattern.test(text) ? 1 : 0), 0);

function detectLanguage(text) {
  const value = clean(text, 30000);
  const counts = {
    han: (value.match(/\p{Script=Han}/gu) || []).length,
    hiragana: (value.match(/\p{Script=Hiragana}/gu) || []).length,
    katakana: (value.match(/\p{Script=Katakana}/gu) || []).length,
    latin: (value.match(/[A-Za-z]/g) || []).length
  };
  const meaningful = counts.han + counts.hiragana + counts.katakana + counts.latin;
  const japanese = counts.hiragana + counts.katakana;
  let language = 'unknown';
  if (meaningful) {
    const hasJa = japanese >= 2;
    const hasHan = counts.han >= 2;
    const hasEn = counts.latin >= 4;
    if ((hasJa && hasEn) || (hasEn && hasHan && !hasJa)) language = 'mixed';
    else if (hasJa) language = 'ja';
    else if (hasHan) language = 'zh';
    else if (hasEn) language = 'en';
  }
  const dominant = Math.max(counts.han, japanese, counts.latin);
  return {
    language, confidence: meaningful ? Math.min(0.99, 0.55 + dominant / Math.max(1, meaningful) * 0.44) : 0,
    script_evidence: counts
  };
}

const SIMPLE_RENDERINGS = Object.freeze([
  [/\bshall\b|\bmust\b|\brequired to\b/gi, '必须'],
  [/\bshall not\b|\bmust not\b|\bprohibited\b/gi, '不得'],
  [/\bshould\b/gi, '宜'], [/\bmay\b/gi, '可以'],
  [/しなければならない|すること|必須/g, '必须'], [/してはならない|禁止/g, '不得'],
  [/望ましい|べき/g, '宜'], [/してもよい|可能/g, '可以'],
  [/\brequirement(s)?\b/gi, '要求'], [/\brisk(s)?\b/gi, '风险'],
  [/\bdecision(s)?\b/gi, '决策'], [/\baction item(s)?\b/gi, '行动项'],
  [/\bschedule\b/gi, '计划'], [/\bmethod\b/gi, '方法'], [/\bprocess\b/gi, '流程'],
  [/要求事項/g, '要求'], [/リスク/g, '风险'], [/決定事項/g, '决策'],
  [/対応事項/g, '行动项'], [/工程/g, '流程'], [/方法/g, '方法']
]);

function deterministicChinese(text) {
  let output = clean(text, 30000);
  let changed = false;
  for (const [pattern, replacement] of SIMPLE_RENDERINGS) {
    const next = output.replace(pattern, replacement);
    if (next !== output) changed = true;
    output = next;
  }
  const remaining = detectLanguage(output).language;
  return { text: output, safe: changed && !['ja', 'en', 'mixed'].includes(remaining) };
}

function normalizeLocator(raw, fallback) {
  const locator = raw && typeof raw === 'object' ? raw : {};
  const result = {};
  for (const key of ['scheme', 'value', 'page', 'sheet', 'range', 'row', 'column', 'message_id', 'attachment_id', 'heading_path']) {
    if (locator[key] !== undefined && locator[key] !== null && String(locator[key]).trim()) result[key] = locator[key];
  }
  if (!result.scheme) result.scheme = 'block';
  if (!result.value) result.value = fallback;
  return result;
}

function canonicalizeDocument(input = {}) {
  const source = input.document || input;
  const rawBlocks = Array.isArray(source.blocks) ? source.blocks
    : Array.isArray(source.normalized_blocks) ? source.normalized_blocks
      : clean(source.text || source.markdown) ? [{ kind: 'text', raw: { text: source.text || source.markdown } }] : [];
  const blocks = rawBlocks.map((raw, order) => {
    const rawText = clean(raw?.raw?.text || raw?.text || raw?.content || raw?.markdown, 30000);
    const kind = BLOCK_KINDS.has(clean(raw?.kind, 80)) ? clean(raw.kind, 80) : 'text';
    const metadata = raw?.metadata && typeof raw.metadata === 'object' ? { ...raw.metadata } : {};
    const hierarchy = uniq([
      ...(Array.isArray(raw?.hierarchy) ? raw.hierarchy : []),
      ...(Array.isArray(raw?.inferred?.heading_path) ? raw.inferred.heading_path : []),
      clean(raw?.inferred?.heading, 300)
    ]);
    const blockId = clean(raw?.block_id, 160) || `blk-${digest([source.source_document_id || source.source_hash || 'source', order, rawText]).slice(0, 20)}`;
    return {
      block_id: blockId, order, kind, text: rawText,
      source_language: detectLanguage(rawText),
      hierarchy, locator: normalizeLocator(raw?.locator, blockId),
      parse_status: clean(raw?.parse?.status, 40) || (rawText ? 'present' : 'missing'),
      metadata, provenance: Array.isArray(raw?.provenance) ? raw.provenance : []
    };
  }).filter((block) => block.text || ['figure', 'attachment', 'page', 'sheet'].includes(block.kind));
  const sourceId = clean(source.source_document_id || source.source_identity, 300)
    || `src-${digest([source.source_hash, source.source_path, blocks.map((block) => block.text)]).slice(0, 24)}`;
  return {
    schema_version: 'canonical-document/1.0', pipeline_version: PIPELINE_VERSION,
    source_document_id: sourceId, source_identity: clean(source.source_identity, 300) || sourceId,
    source_hash: clean(source.source_hash, 128), source_path: clean(source.source_path, 1000),
    title: clean(source.title || source.filename, 400) || '未命名资料',
    media_type: clean(source.media_type || source.source_type, 120) || 'unknown',
    source_language: detectLanguage(blocks.map((block) => block.text).join('\n')),
    output_language: OUTPUT_LANGUAGE,
    metadata: source.metadata && typeof source.metadata === 'object' ? { ...source.metadata } : {},
    blocks, fingerprint: digest(blocks.map(({ kind, text, hierarchy }) => ({ kind, text, hierarchy })))
  };
}

function semanticSignals(text) {
  const patterns = {
    requirement: [/必须|应当|不得|须|shall|must|required|しなければならない|すること|必須|禁止|べき/i],
    decision: [/决定|决议|批准|同意|确定|adopted|approved|決定|決議|承認|合意/i],
    action: [/责任人|负责人|待办|完成日期|行动项|follow[- ]?up|action|担当者|対応事項|期限/i],
    process: [/流程|程序|步骤|审批|process|procedure|工程|手順|承認フロー/i],
    method: [/方法|工艺|做法|施工方案|method|technique|工法|施工方法/i],
    parameter: [/\d+(?:\.\d+)?\s*(?:mm|cm|m|kg|t|mpa|%|元|万元|天|日|小时)\b/i, /型号|规格|参数|阈值|允许偏差/i],
    risk: [/风险|隐患|可能导致|应急|risk|hazard|リスク|危険/i],
    issue: [/问题|缺陷|争议|未解决|issue|defect|問題|不具合|未解決/i],
    experience: [/经验|教训|复盘|建议|lesson|retrospective|経験|教訓|振り返り/i],
    commercial_term: [/报价|付款|合同价|税率|保函|索赔|违约|payment|price|contract|見積|支払|契約|違約/i],
    schedule: [/进度|工期|里程碑|开工|完工|计划日期|schedule|milestone|日程|工期|着工|完了/i],
    entity_profile: [/客户|业主|供应商|分包商|公司|联系人|client|supplier|顧客|発注者|会社|担当者/i],
    correspondence: [/发件人|收件人|主题|抄送|函|回复|from:|to:|subject:|差出人|宛先|件名|返信/i]
  };
  return Object.fromEntries(Object.entries(patterns).map(([key, values]) => [key, score(text, values)]));
}

function inferProfile(document) {
  const text = document.blocks.map((block) => block.text).join('\n').slice(0, 100000);
  const signals = semanticSignals(text);
  const purposes = Object.entries(signals).filter(([, value]) => value > 0)
    .sort((a, b) => b[1] - a[1]).slice(0, 6).map(([key]) => key);
  const domains = [];
  for (const [tag, pattern] of [
    ['质量', /质量|验收|quality/i], ['安全', /安全|事故|safety/i],
    ['成本', /报价|成本|造价|price|cost/i], ['时间', /进度|工期|schedule/i],
    ['合同', /合同|索赔|contract/i], ['采购', /采购|供应商|procurement|supplier/i],
    ['技术', /技术|施工|设计|工艺|technical|design/i]
  ]) if (pattern.test(text)) domains.push(tag);
  const metadata = document.metadata || {};
  const lifecycle = clean(metadata.project_state || metadata.lifecycle || metadata.status, 80)
    || (/(已完成|竣工|归档|终止|取消|completed|archived|cancelled)/i.test(text) ? 'completed'
      : /(投标|询价|澄清|报价|施工中|bidding|tender|active)/i.test(text) ? 'active' : 'unknown');
  const authority = /(签发|批准|合同|法定|正式|approved|executed)/i.test(text) ? 'formal'
    : /(会议纪要|确认|confirmed)/i.test(text) ? 'confirmed' : 'informational';
  const confidentiality = /(机密|保密|内部使用|confidential)/i.test(text) ? 'restricted' : 'normal';
  const projectIds = uniq([metadata.project_id, metadata.project_name, metadata.project_reference]);
  return {
    schema_version: 'semantic-profile/1.0', purposes: purposes.length ? purposes : ['fact'],
    business_domains: domains, lifecycle, project_scope: projectIds,
    entity_scope: uniq([metadata.entity_id, metadata.client, metadata.supplier]),
    temporal_validity: clean(metadata.valid_until || metadata.effective_date || metadata.version, 160),
    authority, confidentiality,
    dominant_patterns: purposes.slice(0, 3),
    structural_confidence: document.blocks.some((block) => block.hierarchy.length || block.kind === 'heading' || block.kind === 'table') ? 0.9 : 0.65,
    confidence: { purpose: purposes.length ? 0.82 : 0.55, lifecycle: lifecycle === 'unknown' ? 0.45 : 0.85, authority: 0.75 },
    uncertainty: lifecycle === 'unknown' ? ['项目生命周期未从显式元数据或正文确定'] : []
  };
}

function noiseReason(block, occurrence) {
  if (!block.text) return '空内容';
  if (block.metadata.noise === true || block.metadata.structural_noise === true) return '适配器标记为结构噪声';
  if (/^(第\s*\d+\s*页|page\s+\d+|目录|table of contents)$/i.test(block.text)) return '页码或目录';
  if (block.kind === 'footer' || block.kind === 'header') {
    if (occurrence > 1) return '重复页眉页脚';
  }
  if (/^(签字|签名|signature|免责声明|disclaimer)\s*[:：]?$/i.test(block.text)) return '无义务内容的签名或声明';
  return '';
}

function dominantKind(text) {
  const signals = semanticSignals(text);
  const ranked = Object.entries(signals).sort((a, b) => b[1] - a[1]);
  return ranked[0]?.[1] > 0 ? ranked[0][0] : 'fact';
}

function segmentDocument(document) {
  const occurrences = new Map();
  for (const block of document.blocks) occurrences.set(block.text, (occurrences.get(block.text) || 0) + 1);
  const regions = [];
  let current = null;
  const flush = () => {
    if (!current) return;
    current.text = current.blocks.map((block) => block.text).filter(Boolean).join('\n');
    current.source_language = detectLanguage(current.text);
    current.region_id = `reg-${digest([document.source_document_id, current.blocks.map((block) => block.block_id), current.semantic_kind]).slice(0, 24)}`;
    current.fingerprint = digest([current.semantic_kind, current.subject, current.text]);
    regions.push(current); current = null;
  };
  for (const block of document.blocks) {
    const reason = noiseReason(block, occurrences.get(block.text));
    const kind = reason ? 'noise' : dominantKind(block.text);
    const heading = block.kind === 'heading' || block.hierarchy.length
      ? clean(block.text || block.hierarchy.at(-1), 300) : '';
    const subject = heading || clean(block.hierarchy.at(-1), 300) || clean(block.text.split(/[。；;\n]/)[0], 160);
    const boundary = !current || kind === 'noise' || current.semantic_kind === 'noise'
      || heading || kind !== current.semantic_kind
      || (block.metadata.scope_id && block.metadata.scope_id !== current.scope_id)
      || (block.metadata.temporal_scope && block.metadata.temporal_scope !== current.temporal_scope)
      || current.blocks.length >= 8;
    if (boundary) {
      flush();
      current = {
        semantic_kind: REGION_KINDS.includes(kind) ? kind : 'fact', subject,
        scope_id: clean(block.metadata.scope_id, 160), temporal_scope: clean(block.metadata.temporal_scope, 160),
        parent_region_id: null, child_region_ids: [], cross_references: [],
        blocks: [], dropped_reason: reason || ''
      };
    }
    current.blocks.push(block);
  }
  flush();
  const stack = [];
  for (const region of regions) {
    const level = Math.max(0, region.blocks[0]?.hierarchy?.length || 0);
    while (stack.length > level) stack.pop();
    if (stack.length) {
      region.parent_region_id = stack.at(-1).region_id;
      stack.at(-1).child_region_ids.push(region.region_id);
    }
    stack[level] = region;
    stack.length = level + 1;
  }
  return regions;
}

function extractFacts(text) {
  const numbers = [...text.matchAll(/-?\d+(?:\.\d+)?\s*(?:mm|cm|m|kg|t|mpa|%|元|万元|天|日|小时)?/gi)]
    .map((match) => match[0]).slice(0, 20);
  const dates = [...text.matchAll(/\b(?:20\d{2}[-/.年]\d{1,2}(?:[-/.月]\d{1,2}日?)?|\d{1,2}月\d{1,2}日)\b/g)]
    .map((match) => match[0]).slice(0, 10);
  const models = [...text.matchAll(/\b[A-Z]{1,5}[-_/]?\d{2,}[A-Z0-9-]*\b/g)].map((match) => match[0]).slice(0, 10);
  return { numbers: uniq(numbers), dates: uniq(dates), models: uniq(models) };
}

function protectedTokens(text) {
  return uniq([
    ...extractFacts(text).numbers, ...extractFacts(text).dates, ...extractFacts(text).models,
    ...[...text.matchAll(/\b(?:ISO|IEC|JIS|GB|EN|ASTM|DIN)[ -]?[A-Z0-9./:-]+\b/gi)].map((match) => match[0]),
    ...[...text.matchAll(/\b[A-Z][A-Za-z0-9]*(?:[-_/][A-Za-z0-9]+)+\b/g)].map((match) => match[0])
  ]);
}

function validateTranslationResult(requested, response) {
  const rows = Array.isArray(response) ? response : response?.translations;
  if (!Array.isArray(rows)) throw Object.assign(new Error('翻译提供商未返回 translations 数组'), { code: 'TRANSLATION_SCHEMA_INVALID' });
  const expected = requested.map((item) => item.region_id);
  const actual = rows.map((item) => clean(item?.region_id, 160));
  if (new Set(actual).size !== actual.length || expected.length !== actual.length
    || expected.some((id) => !actual.includes(id)) || actual.some((id) => !expected.includes(id))) {
    throw Object.assign(new Error('翻译区域 ID 不完整或包含额外 ID'), {
      code: 'TRANSLATION_REGION_IDS_INVALID', expected_region_ids: expected, actual_region_ids: actual
    });
  }
  return rows.map((row) => {
    const translated = clean(row.translated_text, 30000);
    const language = detectLanguage(translated);
    if (!translated || language.language === 'ja' || language.language === 'en'
      || language.script_evidence.han < 2) {
      throw Object.assign(new Error(`区域 ${row.region_id} 未生成简体中文`), { code: 'TRANSLATION_NOT_CHINESE' });
    }
    const source = requested.find((item) => item.region_id === row.region_id);
    const missing = protectedTokens(source.text).filter((token) => !translated.includes(token));
    if (missing.length) throw Object.assign(new Error(`区域 ${row.region_id} 丢失受保护标识：${missing.join('、')}`), {
      code: 'TRANSLATION_FIDELITY_INVALID', region_id: row.region_id, missing
    });
    return { region_id: row.region_id, translated_text: translated };
  });
}

function translationCacheKey(region, options = {}) {
  return digest([
    clean(region.text, 30000).normalize('NFKC').replace(/\s+/g, ' '),
    region.source_language?.language || 'unknown', OUTPUT_LANGUAGE,
    options.translation_prompt_version || TRANSLATION_VERSION,
    options.model_version || 'configured-provider'
  ]);
}

async function translateRegions(regions, options = {}) {
  const cache = options.translation_cache && typeof options.translation_cache === 'object'
    ? { ...options.translation_cache } : {};
  const telemetry = {
    regions: [], cache_hits: 0, cache_misses: 0, provider_calls: 0,
    provider_tokens: 0, failures: 0, fallback_count: 0
  };
  const pending = [];
  for (const region of regions) {
    const language = region.source_language || detectLanguage(region.text);
    region.source_language = language;
    if (region.semantic_kind === 'noise') continue;
    if (language.language === 'zh') {
      region.translated_text = region.text;
      region.translation = { status: 'not_required', version: TRANSLATION_VERSION, provenance: 'source-zh' };
      telemetry.regions.push({ region_id: region.region_id, source_language: 'zh', status: 'not_required' });
      continue;
    }
    const key = translationCacheKey(region, options);
    if (cache[key]?.translated_text) {
      region.translated_text = cache[key].translated_text;
      region.translation = { status: 'translated', version: TRANSLATION_VERSION, provenance: 'cache', cache_key: key };
      telemetry.cache_hits += 1;
      telemetry.regions.push({ region_id: region.region_id, source_language: language.language, status: 'cache_hit' });
      continue;
    }
    const local = deterministicChinese(region.text);
    if (local.safe) {
      region.translated_text = local.text;
      region.translation = { status: 'translated', version: TRANSLATION_VERSION, provenance: 'deterministic', cache_key: key };
      cache[key] = { translated_text: local.text, source_language: language.language, version: TRANSLATION_VERSION };
      telemetry.fallback_count += 1;
      telemetry.regions.push({ region_id: region.region_id, source_language: language.language, status: 'deterministic' });
      continue;
    }
    telemetry.cache_misses += 1;
    pending.push({ region, key });
  }
  if (pending.length && typeof options.translate_batch !== 'function') {
    throw Object.assign(new Error('存在非中文知识区域，但未配置可恢复的翻译提供商'), {
      code: 'TRANSLATION_REQUIRED', retryable: true,
      checkpoint: { cache, missing_region_ids: pending.map((item) => item.region.region_id), telemetry }
    });
  }
  const batchSize = Math.max(1, Math.min(20, Number(options.translation_batch_size) || 8));
  for (let offset = 0; offset < pending.length; offset += batchSize) {
    const batch = pending.slice(offset, offset + batchSize);
    const request = batch.map(({ region }) => ({
      region_id: region.region_id, source_language: region.source_language.language,
      text: region.text, preserve_exactly: protectedTokens(region.text)
    }));
    try {
      telemetry.provider_calls += 1;
      const response = await options.translate_batch(request, {
        target_language: OUTPUT_LANGUAGE, prompt_version: options.translation_prompt_version || TRANSLATION_VERSION,
        contract: '只返回 translations；区域 ID 必须完整且无额外项；保留名称、代码、标准、数字、日期、单位、模态、条件和例外。'
      });
      const validated = validateTranslationResult(request, response);
      telemetry.provider_tokens += Number(response?.usage?.total_tokens) || 0;
      for (const row of validated) {
        const item = batch.find(({ region }) => region.region_id === row.region_id);
        item.region.translated_text = row.translated_text;
        item.region.translation = { status: 'translated', version: TRANSLATION_VERSION,
          provenance: 'configured-provider', cache_key: item.key };
        cache[item.key] = { translated_text: row.translated_text,
          source_language: item.region.source_language.language, version: TRANSLATION_VERSION };
        telemetry.regions.push({ region_id: row.region_id,
          source_language: item.region.source_language.language, status: 'provider' });
      }
    } catch (error) {
      telemetry.failures += batch.length;
      throw Object.assign(new Error(`翻译批次失败：${error.message}`), {
        code: error.code || 'TRANSLATION_PROVIDER_FAILED', retryable: true, cause: error,
        checkpoint: { cache, missing_region_ids: pending.slice(offset).map((item) => item.region.region_id), telemetry }
      });
    }
  }
  return { regions, cache, telemetry };
}

function routeUnit(unit, profile, options = {}) {
  const state = clean(profile.lifecycle || unit.status, 80).toLowerCase();
  const projectSpecific = unit.project_ids.length > 0 || unit.scope === 'project';
  const reusable = unit.reusable === true;
  let library = 'business';
  let ambiguous = false;
  if (HISTORICAL_STATES.has(state)) library = 'business';
  else if (projectSpecific && ACTIVE_STATES.has(state)) library = reusable ? 'business' : 'active_tender';
  else if (projectSpecific && state === 'unknown') ambiguous = true;
  else if (projectSpecific) library = 'active_tender';
  if (options.explicit_library === 'active_tender' || options.explicit_library === 'business') {
    library = options.explicit_library; ambiguous = false;
  }
  return {
    library, category: library === 'active_tender' ? ACTIVE_CATEGORY[unit.semantic_kind] : BUSINESS_CATEGORY[unit.semantic_kind],
    confidence: ambiguous ? 0.45 : 0.9, ambiguous,
    reason: ambiguous ? '存在项目范围，但未确定项目是否仍在进行' : library === 'active_tender'
      ? '在办项目事实或行动按知识单元进入在办库' : '可复用知识或历史项目材料进入业务库'
  };
}

function normalizeTags(candidates, existing = [], limit = 10) {
  const existingMap = new Map(existing.map((tag) => [clean(tag, 80).toLocaleLowerCase(), clean(tag, 80)]));
  const output = [];
  for (const raw of candidates.flatMap((value) => String(value || '').split(/[,，/]/))) {
    let tag = clean(raw, 40).replace(/^#+/, '');
    tag = TAG_SYNONYMS[tag] || tag;
    if (!tag || tag.length > 20 || /[\n[\]{}]/.test(tag)) continue;
    tag = existingMap.get(tag.toLocaleLowerCase()) || tag;
    if (!output.includes(tag)) output.push(tag);
    if (output.length >= limit) break;
  }
  return output;
}

function normalizeKnowledgeUnit(raw, context = {}) {
  const evidence = Array.isArray(raw.evidence) ? raw.evidence : raw.evidence ? [raw.evidence] : [];
  const kind = SEMANTIC_KINDS.includes(raw.semantic_kind) ? raw.semantic_kind
    : ({ commitment: 'requirement', quotation: 'commercial_term', material: 'parameter',
      acceptance_criterion: 'requirement', clarification: 'correspondence',
      contract_obligation: 'commercial_term', project_lesson: 'experience' }[raw.item_type] || 'fact');
  const statement = clean(raw.translated_statement || raw.statement || raw.summary || raw.content || raw.title, 8000);
  const originalStatement = clean(raw.original_statement || raw.statement || raw.summary || raw.content || raw.title, 8000);
  const sourceId = clean(raw.source_document_id || context.source_document_id, 300);
  const projectIds = uniq(raw.project_ids || (raw.project_id ? [raw.project_id] : context.project_ids || []));
  const fingerprint = digest({ kind, source_meaning: clean(raw.source_meaning_fingerprint, 128)
      || originalStatement.toLocaleLowerCase().replace(/\s+/g, ''), projectIds,
    evidence: evidence.map((item) => [item.block_id, item.locator]) });
  return {
    schema_version: 'knowledge-unit/1.0', unit_id: clean(raw.unit_id || raw.candidate_id || raw.card_id, 300) || `ku-${fingerprint.slice(0, 24)}`,
    fingerprint, title: clean(raw.translated_title || raw.title, 180) || clean(statement.split(/[。；;\n]/)[0], 120) || '知识单元',
    original_title: clean(raw.original_title || raw.title, 180),
    translated_title: clean(raw.translated_title || raw.title, 180) || clean(statement.split(/[。；;\n]/)[0], 120),
    statement, original_statement: originalStatement, translated_statement: statement,
    source_language: clean(raw.source_language?.language || raw.source_language, 20) || detectLanguage(originalStatement).language,
    output_language: OUTPUT_LANGUAGE,
    translation: raw.translation || { status: detectLanguage(originalStatement).language === 'zh' ? 'not_required' : 'legacy_default',
      version: TRANSLATION_VERSION, provenance: 'deterministic-migration' },
    semantic_kind: kind, subject: clean(raw.subject, 300) || clean(raw.title, 300),
    scope: clean(raw.scope, 120) || (projectIds.length ? 'project' : 'general'),
    applicable_conditions: uniq(raw.applicable_conditions || raw.conditions),
    exceptions: uniq(raw.exceptions), project_ids: projectIds, entity_ids: uniq(raw.entity_ids),
    time: clean(raw.time || raw.effective_date, 160), version: clean(raw.version, 100),
    status: clean(raw.status || context.lifecycle, 80), authority: clean(raw.authority || context.authority, 80),
    responsibilities: uniq(raw.responsibilities), parties: uniq(raw.parties),
    structured_facts: raw.structured_facts || extractFacts(statement), evidence,
    reusable: raw.reusable === true || raw.reusable_knowledge_candidate === true,
    confidence: raw.confidence && typeof raw.confidence === 'object' ? raw.confidence
      : { semantics: Number(raw.confidence) || 0.8, evidence: evidence.length ? 0.95 : 0.3, route: 0.8 },
    uncertainty: uniq(raw.uncertainty), tags: uniq(raw.tags), relations: Array.isArray(raw.relations) ? raw.relations : [],
    source_document_id: sourceId, source_region_ids: uniq(raw.source_region_ids)
  };
}

function planKnowledgeUnits(document, profile, regions, options = {}) {
  const units = [];
  const coverage = {};
  for (const region of regions) {
    if (region.semantic_kind === 'noise') {
      coverage[region.region_id] = { status: 'dropped', reason: region.dropped_reason || '非可复用噪声' };
      continue;
    }
    const evidence = region.blocks.filter((block) => block.text).map((block) => ({
      block_id: block.block_id, locator: block.locator, verbatim: block.text,
      provenance: [block.locator, ...block.provenance]
    }));
    if (!evidence.length) {
      coverage[region.region_id] = { status: 'dropped', reason: '没有可核验原文' };
      continue;
    }
    const projectIds = uniq([
      ...profile.project_scope,
      ...region.blocks.flatMap((block) => [block.metadata.project_id, block.metadata.project_name])
    ]);
    const raw = {
      semantic_kind: region.semantic_kind,
      title: region.translated_text ? clean(region.translated_text.split(/[。；;\n]/)[0], 120) : region.subject,
      original_title: region.subject,
      translated_title: region.translated_text ? clean(region.translated_text.split(/[。；;\n]/)[0], 120) : region.subject,
      subject: region.subject, statement: region.translated_text || region.text,
      original_statement: region.text, translated_statement: region.translated_text || region.text,
      source_language: region.source_language, translation: region.translation,
      source_meaning_fingerprint: region.fingerprint, evidence, project_ids: projectIds,
      source_document_id: document.source_document_id, source_region_ids: [region.region_id],
      scope: projectIds.length ? 'project' : 'general', status: profile.lifecycle,
      authority: profile.authority,
      reusable: ['method', 'process', 'experience', 'requirement'].includes(region.semantic_kind)
        && !/(本项目|本工程|this\s+project)/i.test(region.text)
    };
    const unit = normalizeKnowledgeUnit(raw, profile);
    const previous = units.at(-1);
    if (previous && previous.semantic_kind === unit.semantic_kind && previous.subject === unit.subject
      && previous.scope === unit.scope && previous.status === unit.status
      && previous.statement.length + unit.statement.length < 10000) {
      previous.statement += `\n${unit.statement}`;
      previous.evidence.push(...unit.evidence);
      previous.source_region_ids.push(region.region_id);
      previous.structured_facts = extractFacts(previous.statement);
      previous.fingerprint = digest([previous.semantic_kind, previous.statement, previous.project_ids]);
      coverage[region.region_id] = { status: 'merged', unit_id: previous.unit_id, reason: '相邻且主题、范围、责任和语义类型兼容' };
    } else {
      units.push(unit);
      coverage[region.region_id] = { status: 'covered', unit_id: unit.unit_id };
    }
  }
  const deduped = [];
  for (const unit of units) {
    const duplicate = deduped.find((item) => item.fingerprint === unit.fingerprint);
    if (duplicate) {
      duplicate.evidence.push(...unit.evidence);
      duplicate.source_region_ids.push(...unit.source_region_ids);
      for (const regionId of unit.source_region_ids) coverage[regionId] = { status: 'merged', unit_id: duplicate.unit_id, reason: '确定性指纹重复' };
    } else deduped.push(unit);
  }
  for (const unit of deduped) {
    unit.route = routeUnit(unit, profile, { explicit_library: options.explicit_library });
    unit.tags = normalizeTags([
      KIND_TAG[unit.semantic_kind], ...profile.business_domains, ...unit.project_ids,
      unit.route.library === 'active_tender' ? '在办' : '业务知识',
      ...unit.tags
    ], options.existing_tags || []);
    unit.confidence.route = unit.route.confidence;
  }
  return { units: deduped, coverage };
}

function repairCoverage(document, profile, regions, planned, options = {}) {
  const missing = regions.filter((region) => !planned.coverage[region.region_id]
    || !['covered', 'merged', 'dropped'].includes(planned.coverage[region.region_id].status));
  if (!missing.length) return { ...planned, repaired_region_ids: [] };
  const repair = planKnowledgeUnits(document, profile, missing, options);
  return {
    units: [...planned.units, ...repair.units],
    coverage: { ...planned.coverage, ...repair.coverage },
    repaired_region_ids: missing.map((region) => region.region_id)
  };
}

function relationEvidence(units) {
  const identity = new Map();
  for (const unit of units) {
    for (const id of [...unit.project_ids, ...unit.entity_ids]) {
      if (!identity.has(id)) identity.set(id, []);
      identity.get(id).push(unit);
    }
  }
  const relations = [];
  for (const [sharedIdentity, matches] of identity) {
    for (let i = 0; i < matches.length; i += 1) for (let j = i + 1; j < matches.length; j += 1) {
      if (matches[i].unit_id === matches[j].unit_id) continue;
      relations.push({
        from_unit_id: matches[i].unit_id, to_unit_id: matches[j].unit_id, type: 'related',
        confidence: 1, evidence: { kind: 'shared_explicit_identity', value: sharedIdentity }
      });
    }
  }
  return relations;
}

function groupedReview(units) {
  const byCause = new Map();
  for (const unit of units) {
    const causes = [];
    if (unit.route.ambiguous) causes.push('ambiguous_library_route');
    if (unit.uncertainty.includes('material_conflict')) causes.push('material_conflict');
    for (const cause of causes) {
      if (!byCause.has(cause)) byCause.set(cause, []);
      byCause.get(cause).push(unit.unit_id);
    }
  }
  return [...byCause].map(([cause, unitIds]) => ({
    review_id: `review-${digest([units[0]?.source_document_id, cause]).slice(0, 20)}`,
    cause, unit_ids: unitIds,
    reason: cause === 'ambiguous_library_route' ? '资料涉及项目，但无法确认项目当前是否在办。'
      : '同一关键事项出现实质冲突，需要确认采用哪一项。',
    action: cause === 'ambiguous_library_route' ? '请选择整份资料的在办库或业务库归属。' : '查看原文差异并选择有效内容。'
  }));
}

function runUniversalPipeline(input = {}) {
  const document = canonicalizeDocument(input.document || input);
  const profile = inferProfile(document);
  const regions = segmentDocument(document);
  let planned = planKnowledgeUnits(document, profile, regions, input);
  planned = repairCoverage(document, profile, regions, planned, input);
  const relations = relationEvidence(planned.units);
  for (const relation of relations) {
    const source = planned.units.find((unit) => unit.unit_id === relation.from_unit_id);
    if (source) source.relations.push(relation);
  }
  const meaningful = regions.filter((region) => region.semantic_kind !== 'noise').length;
  const covered = Object.values(planned.coverage).filter((entry) => ['covered', 'merged'].includes(entry.status)).length;
  const telemetry = {
    parse_blocks: document.blocks.length, semantic_regions: regions.length,
    planned_units: planned.units.length, semantic_coverage: meaningful ? covered / meaningful : 1,
    compression_ratio: meaningful ? planned.units.length / meaningful : 0,
    llm_calls: 0, llm_tokens: 0, cache_hits: Number(input.cache_hits) || 0,
    accepted: planned.units.length - groupedReview(planned.units).flatMap((group) => group.unit_ids).length,
    review: groupedReview(planned.units).length, rejected: regions.filter((region) => region.semantic_kind === 'noise').length,
    relations: relations.length, writes: 0
  };
  return {
    schema_version: 'universal-pipeline/1.0', pipeline_version: PIPELINE_VERSION,
    document, profile, regions, knowledge_units: planned.units, coverage: planned.coverage,
    repaired_region_ids: planned.repaired_region_ids, relations,
    review_decisions: groupedReview(planned.units), telemetry,
    cache_key: digest([document.fingerprint, PIPELINE_VERSION, input.prompt_version || 'local-v1', input.model_version || 'none'])
  };
}

async function runUniversalPipelineMultilingual(input = {}) {
  const document = canonicalizeDocument(input.document || input);
  const profile = inferProfile(document);
  const regions = segmentDocument(document);
  const translated = await translateRegions(regions, input);
  let planned = planKnowledgeUnits(document, profile, translated.regions, input);
  planned = repairCoverage(document, profile, translated.regions, planned, input);
  const relations = relationEvidence(planned.units);
  for (const relation of relations) {
    const source = planned.units.find((unit) => unit.unit_id === relation.from_unit_id);
    if (source) source.relations.push(relation);
  }
  const meaningful = regions.filter((region) => region.semantic_kind !== 'noise').length;
  const covered = Object.values(planned.coverage).filter((entry) => ['covered', 'merged'].includes(entry.status)).length;
  const review = groupedReview(planned.units);
  return {
    schema_version: 'universal-pipeline/1.1', pipeline_version: PIPELINE_VERSION,
    output_language: OUTPUT_LANGUAGE, document, profile, regions: translated.regions,
    knowledge_units: planned.units, coverage: planned.coverage,
    repaired_region_ids: planned.repaired_region_ids, relations, review_decisions: review,
    translation_cache: translated.cache, translation_checkpoint: { status: 'complete', missing_region_ids: [] },
    telemetry: {
      parse_blocks: document.blocks.length, semantic_regions: regions.length,
      planned_units: planned.units.length, semantic_coverage: meaningful ? covered / meaningful : 1,
      compression_ratio: meaningful ? planned.units.length / meaningful : 0,
      llm_calls: translated.telemetry.provider_calls, llm_tokens: translated.telemetry.provider_tokens,
      cache_hits: translated.telemetry.cache_hits, translation: translated.telemetry,
      accepted: planned.units.length - review.flatMap((group) => group.unit_ids).length,
      review: review.length, rejected: regions.filter((region) => region.semantic_kind === 'noise').length,
      relations: relations.length, writes: 0
    },
    cache_key: digest([document.fingerprint, PIPELINE_VERSION,
      input.translation_prompt_version || TRANSLATION_VERSION, input.model_version || 'configured-provider'])
  };
}

module.exports = {
  PIPELINE_VERSION, OUTPUT_LANGUAGE, TRANSLATION_VERSION, SEMANTIC_KINDS, REGION_KINDS, TAG_SYNONYMS,
  detectLanguage, deterministicChinese, validateTranslationResult, translationCacheKey, translateRegions,
  canonicalizeDocument, inferProfile, segmentDocument, normalizeKnowledgeUnit,
  normalizeTags, routeUnit, planKnowledgeUnits, repairCoverage, relationEvidence,
  groupedReview, runUniversalPipeline, runUniversalPipelineMultilingual, digest, stableJson
};
},
"src/knowledge-write-port.js": function(require, module, exports) {
const crypto = require('crypto');

const RECORD_STATES = Object.freeze([
  'planned', 'attempted', 'vault_committed', 'visible_verified',
  'failed', 'rollback_required', 'rolled_back'
]);
const VERIFIED_SCHEMA = 'eks/authoritative-visible-manifest/2.0';
const KNOWLEDGE_KINDS = new Set(['business_item', 'company_knowledge']);

const digest = (value) => crypto.createHash('sha256').update(String(value ?? '')).digest('hex');
const normalizePath = (value) => String(value || '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
const frontmatter = (content, key) => {
  const match = String(content || '').match(new RegExp(`^${key}:\\s*["']?([^"'\\n]+)`, 'm'));
  return String(match?.[1] || '').trim();
};
const sourceMatches = (content, sourceId) => !sourceId || String(content).includes(`- 归属来源：${sourceId}`)
  || new RegExp(`^source_document_ids:\\s*\\[[^\\n]*["']?${String(sourceId).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}["']?`, 'm').test(String(content));

function verifiedRecordsOf(task) {
  const rows = Array.isArray(task?.verified_records) ? task.verified_records : [];
  return rows.filter((record) => record && record.state === 'visible_verified'
    && record.record_id && KNOWLEDGE_KINDS.has(record.record_kind) && normalizePath(record.final_path)
    && record.run_id === task.run_id && record.vault_file_type === 'markdown'
    && ['business', 'active_tender'].includes(record.target_library)
    && /^[a-f0-9]{64}$/.test(String(record.content_hash || '')) && record.transaction_id);
}

function deriveVerifiedFacts(task) {
  const records = verifiedRecordsOf(task);
  const unique = new Map(records.map((item) => [normalizePath(item.final_path), item]));
  return { records: [...unique.values()], count: unique.size, paths: [...unique.keys()] };
}

function applyVerifiedFacts(task, records) {
  task.verified_records_schema = VERIFIED_SCHEMA;
  task.verified_records = (records || []).map((record) => ({ ...record,
    final_path: normalizePath(record.final_path || record.path), path: normalizePath(record.final_path || record.path),
    state: 'visible_verified' }));
  // Compatibility-only projections. They are overwritten from the authority on every save.
  const facts = deriveVerifiedFacts(task);
  task.output_paths = facts.paths;
  task.written_card_ids = [];
  task.writtenFiles = [];
  task.result_counts = Object.assign({}, task.result_counts || {}, {
    committed: facts.count, verified: facts.count, written: facts.count, knowledge_records: facts.count
  });
  return facts;
}

function assertTaskInvariant(task) {
  const facts = deriveVerifiedFacts(task);
  const errors = [];
  const claimsSuccess = ['written', 'success', 'archived'].includes(task?.status)
    || task?.terminal_outcome === 'completed_with_output';
  if (claimsSuccess && facts.count === 0) errors.push('success_without_visible_verified_record');
  if (Number(task?.result_counts?.verified || 0) !== facts.count) errors.push('verified_count_drift');
  if (Number(task?.result_counts?.written || 0) !== facts.count) errors.push('written_count_drift');
  if (Number(task?.result_counts?.knowledge_records || 0) !== facts.count) errors.push('knowledge_count_drift');
  if (JSON.stringify(task?.output_paths || []) !== JSON.stringify(facts.paths)) errors.push('output_paths_drift');
  return { ok: errors.length === 0, task_id: task?.task_id || task?.taskId || '', verified: facts.count, errors };
}

function auditTaskInvariants(tasks) {
  const results = (tasks || []).map(assertTaskInvariant);
  return { schema: 'eks/invariant-audit/1.0', ok: results.every((item) => item.ok), results };
}

function normalizeTaskForPersistence(task) {
  const facts = applyVerifiedFacts(task, verifiedRecordsOf(task));
  if (['written', 'success', 'archived'].includes(task.status) && facts.count === 0) {
    task.status = 'verification_required';
    task.terminal_outcome = null;
  }
  return task;
}

class KnowledgeWritePort {
  constructor(obsidianVault) {
    const required = ['getAbstractFileByPath', 'read', 'create', 'modify', 'rename', 'createFolder'];
    const missing = required.filter((name) => typeof obsidianVault?.[name] !== 'function');
    if (missing.length) {
      const error = new Error(`Obsidian Vault 公共 API 不完整：${missing.join(', ')}`);
      error.code = 'OBSIDIAN_PUBLIC_VAULT_API_REQUIRED';
      throw error;
    }
    this.vault = obsidianVault;
  }

  async mkdirp(folder) {
    const parts = normalizePath(folder).split('/').filter(Boolean);
    let current = '';
    for (const part of parts) {
      current = current ? `${current}/${part}` : part;
      if (!this.vault.getAbstractFileByPath(current)) {
        try { await this.vault.createFolder(current); }
        catch (error) {
          // Multiple transactions can discover the same missing ancestor before
          // Obsidian's metadata cache observes either create. The public API is
          // authoritative: tolerate only the proven already-created race.
          let visible = this.vault.getAbstractFileByPath(current);
          if (/already exists/i.test(String(error?.message || error))) {
            for (let attempt = 0; attempt < 20 && !visible; attempt += 1) {
              await new Promise((resolve) => setTimeout(resolve, 25));
              visible = this.vault.getAbstractFileByPath(current);
            }
          }
          if (!visible) throw error;
        }
      }
    }
  }

  async readIfExists(path) {
    const normalized = normalizePath(path);
    const file = this.vault.getAbstractFileByPath(normalized);
    if (!file || file.path !== normalized) return null;
    return this.vault.read(file);
  }

  async write(path, content) {
    const normalized = normalizePath(path);
    await this.mkdirp(normalized.split('/').slice(0, -1).join('/'));
    const existing = this.vault.getAbstractFileByPath(normalized);
    if (existing) await this.vault.modify(existing, String(content));
    else await this.vault.create(normalized, String(content));
    const visible = this.vault.getAbstractFileByPath(normalized);
    if (!visible || visible.path !== normalized || String(await this.vault.read(visible)) !== String(content)) {
      const error = new Error(`Obsidian 无法确认文件可见：${normalized}`);
      error.code = 'VAULT_VISIBLE_VERIFICATION_FAILED';
      throw error;
    }
    return normalized;
  }

  async rename(from, to) {
    const source = normalizePath(from);
    const target = normalizePath(to);
    await this.mkdirp(target.split('/').slice(0, -1).join('/'));
    const file = this.vault.getAbstractFileByPath(source);
    if (!file) throw new Error(`找不到待移动文件：${source}`);
    await this.vault.rename(file, target);
    if (!this.vault.getAbstractFileByPath(target)) throw new Error(`移动后文件不可见：${target}`);
  }

  async verify(action, transactionId, verifiedAt, context = {}) {
    const finalPath = normalizePath(action.final_path || action.path);
    const roots = context.targetRoots || {};
    const targetLibrary = Object.entries(roots).find(([, root]) => finalPath === normalizePath(root)
      || finalPath.startsWith(`${normalizePath(root)}/`))?.[0] || '';
    const file = this.vault.getAbstractFileByPath(finalPath);
    const content = file && file.path === finalPath ? await this.vault.read(file) : null;
    const valid = String(content || '').trim() && frontmatter(content, 'record_id') === action.record_id
      && frontmatter(content, 'record_kind') === action.record_kind
      && digest(content) === action.content_hash
      && finalPath.toLowerCase().endsWith('.md') && (!KNOWLEDGE_KINDS.has(action.record_kind) || targetLibrary)
      && (!KNOWLEDGE_KINDS.has(action.record_kind) || sourceMatches(content, action.owner_source_id));
    if (!valid) {
      const error = new Error(`记录最终可见性/身份/hash/来源/目标根校验失败：${finalPath}`);
      error.code = 'VAULT_RECORD_VERIFICATION_FAILED';
      throw error;
    }
    return {
      record_id: action.record_id, record_kind: action.record_kind, run_id: context.runId || '',
      final_path: finalPath, path: finalPath, vault_file_type: 'markdown', target_library: targetLibrary,
      content_hash: action.content_hash, verified_at: verifiedAt, transaction_id: transactionId,
      source_association: action.owner_source_id || '', state: 'visible_verified'
    };
  }
}

module.exports = {
  RECORD_STATES, VERIFIED_SCHEMA, KNOWLEDGE_KINDS, KnowledgeWritePort, digest,
  verifiedRecordsOf, deriveVerifiedFacts, applyVerifiedFacts, normalizeTaskForPersistence,
  assertTaskInvariant, auditTaskInvariants
};
},
"src/structured-writer.js": function(require, module, exports) {
/**
 * Phase 2/3 controlled structured writer.
 * All planning is deterministic and local. Vault mutation is isolated in
 * commitPlan/rollbackTransaction and guarded by an injected adapter.
 */
const crypto = require('crypto');
const {
  ACTIVE_TENDER_CATEGORIES,
  BUSINESS_CATEGORIES,
  validateRecord,
  validateProjectTransition
} = require("src/phase1-foundation.js");

const WRITER_VERSION = '1.0';
const INDEX_VERSION = '1.0';
const PLAN_LIMITS = Object.freeze({ max_records: 250, max_actions: 600, max_links_per_record: 40 });
const MODES = Object.freeze(['legacy', 'structured-pilot', 'structured-write']);
const KIND_PREFIX = Object.freeze({
  project: 'prj', source_document: 'src', business_item: 'bi', company_knowledge: 'ck'
});
const KIND_FOLDER = Object.freeze({
  project: '项目', source_document: '来源', business_item: '业务事项', company_knowledge: '公司知识'
});
const RELATION_TYPES = Object.freeze({
  derived_from: { from: ['business_item', 'company_knowledge'], to: ['source_document'] },
  belongs_to: { from: ['source_document', 'business_item'], to: ['project'] },
  contains: { from: ['project', 'source_document'], to: ['source_document', 'business_item'] },
  related: { from: ['project', 'source_document', 'business_item', 'company_knowledge'], to: ['project', 'source_document', 'business_item', 'company_knowledge'] },
  supersedes: { from: ['source_document', 'business_item', 'company_knowledge'], to: ['source_document', 'business_item', 'company_knowledge'] },
  replaces: { from: ['source_document', 'business_item', 'company_knowledge'], to: ['source_document', 'business_item', 'company_knowledge'] }
});

const clean = (value, max = 500) => typeof value === 'string'
  ? value.trim().replace(/[\u0000-\u001f\u007f]/g, '').slice(0, max) : '';
const stableJson = (value) => {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort()
    .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
};
const hash = (value) => crypto.createHash('sha256')
  .update(typeof value === 'string' ? value : stableJson(value)).digest('hex');
const stableId = (kind, identity) => `${KIND_PREFIX[kind]}-${hash(identity).slice(0, 24)}`;
const uniq = (values) => [...new Set((values || []).filter(Boolean))].sort();
const safeSegment = (value) => clean(value, 120).normalize('NFC')
  .replace(/[\\/:*?"<>|#[\]^]/g, '-').replace(/\.\./g, '-').replace(/\s+/g, ' ').replace(/^[. ]+|[. ]+$/g, '') || '未命名';
const pathSafe = (value) => {
  const raw = clean(value, 1000).replace(/\\/g, '/');
  if (!raw || raw.startsWith('/') || /^[A-Za-z]:\//.test(raw)) return false;
  const path = raw.replace(/\/+$/g, '');
  return Boolean(path && !path.split('/').some((part) => !part || part === '.' || part === '..')
    && !/[\u0000-\u001f\u007f:*?"<>|]/.test(path));
};
const joinPath = (...parts) => parts.map((part) => String(part || '').replace(/^\/+|\/+$/g, ''))
  .filter(Boolean).join('/');

function normalizeSettings(settings = {}) {
  const mode = MODES.includes(settings.structuredWriterMode) ? settings.structuredWriterMode : 'legacy';
  const enabled = settings.controlledWriterEnabled === true;
  return {
    enabled,
    mode: enabled ? mode : 'legacy',
    activeRoot: clean(settings.structuredActiveRoot || '在办投标库', 400),
    businessRoot: clean(settings.structuredBusinessRoot || '长期业务库', 400),
    stateRoot: clean(settings.artifactsPath || '06-知识库/源文件/_slicer_artifacts', 600),
    limits: {
      max_records: Math.max(1, Math.min(PLAN_LIMITS.max_records, Number(settings.structuredMaxRecords) || 100)),
      max_actions: Math.max(1, Math.min(PLAN_LIMITS.max_actions, Number(settings.structuredMaxActions) || 300)),
      max_links_per_record: Math.max(1, Math.min(PLAN_LIMITS.max_links_per_record, Number(settings.structuredMaxLinkFanout) || 20))
    }
  };
}

function sourceIdentity(document) {
  const explicit = clean(document.source_identity || document.source_document_id, 300);
  if (explicit) return `explicit:${explicit}`;
  const ingestion = clean(document.ingestion_id || document.metadata?.ingestion_id, 300);
  if (ingestion) return `ingestion:${ingestion}`;
  const immutable = clean(document.metadata?.message_id || document.metadata?.file_id, 500);
  if (immutable) return `provider:${immutable}`;
  const initialHash = clean(document.initial_source_hash || document.source_hash, 128);
  if (initialHash) return `initial-hash:${initialHash}`;
  throw new Error('来源缺少稳定身份；不能用可变标题或路径生成 ID');
}

function projectIdentity(entry) {
  const id = clean(entry?.project_id || entry?.registry_id, 300);
  if (!id) throw new Error('项目必须来自精确登记表且包含稳定 project_id');
  return `registry:${id}`;
}

function candidateIdentity(candidate, sourceId) {
  const evidence = candidate?.evidence || {};
  const locator = evidence.locator || {};
  const explicit = clean(candidate?.stable_item_key || candidate?.candidate_id, 300);
  return explicit
    ? `${sourceId}:candidate:${explicit}`
    : `${sourceId}:evidence:${clean(evidence.block_id || candidate?.block_id, 200)}:${stableJson(locator)}:${hash(clean(evidence.verbatim, 4000))}`;
}

function emptyIndex() {
  return { version: INDEX_VERSION, revision: 0, records: {}, source_versions: {}, updated_at: '' };
}

function validateIndex(raw) {
  const candidate = raw && typeof raw === 'object' ? raw : emptyIndex();
  const index = {
    version: candidate.version || INDEX_VERSION,
    revision: Number(candidate.revision || 0),
    records: {},
    source_versions: candidate.source_versions && typeof candidate.source_versions === 'object'
      ? JSON.parse(JSON.stringify(candidate.source_versions)) : {},
    updated_at: clean(candidate.updated_at, 100)
  };
  const conflicts = [];
  const discarded = [];
  const paths = new Map();
  for (const [id, entry] of Object.entries(candidate.records || {})) {
    if (!entry || !pathSafe(entry.path) || entry.record_id !== id) {
      discarded.push({ cause: 'malformed_index', record_id: id });
      continue;
    }
    index.records[id] = JSON.parse(JSON.stringify(entry));
    if (!paths.has(entry.path)) paths.set(entry.path, []);
    paths.get(entry.path).push(id);
  }
  for (const [path, ids] of paths) {
    if (ids.length > 1) conflicts.push({ cause: 'path_indexed_by_multiple_ids', path, record_ids: ids.sort() });
  }
  return { index, conflicts, discarded };
}

function yamlScalar(value) {
  return JSON.stringify(String(value ?? ''), null, 0);
}

function yamlArray(values) {
  return `[${uniq(values).map(yamlScalar).join(', ')}]`;
}

function relationLink(relation) {
  // Generated filenames are globally unique stable IDs. Basename links survive
  // archive moves without rewriting user-facing titles or depending on aliases.
  return `[[${relation.target_id}|${relation.target_title || relation.target_id}]]`;
}

function humanLocator(locator = {}) {
  return [
    locator.page !== undefined ? `第 ${locator.page} 页` : '',
    locator.sheet ? `工作表“${clean(String(locator.sheet), 120)}”` : '',
    locator.range ? `区域 ${clean(String(locator.range), 80)}` : '',
    locator.row !== undefined ? `第 ${locator.row} 行` : '',
    locator.message_id ? `邮件 ${clean(String(locator.message_id), 120)}` : '',
    locator.heading_path ? `章节 ${Array.isArray(locator.heading_path) ? locator.heading_path.join(' / ') : locator.heading_path}` : '',
    !locator.page && !locator.sheet && !locator.range && locator.value ? clean(String(locator.value), 160) : ''
  ].filter(Boolean).join('，') || '来源原文';
}

function serializeRecord(record) {
  const check = validateRecord(record);
  if (!check.valid) throw new Error(`记录 ${record.record_id} 不符合 schema：${check.errors.join('；')}`);
  const relations = (record.relations || []).slice().sort((a, b) =>
    `${a.type}:${a.target_id}`.localeCompare(`${b.type}:${b.target_id}`));
  const frontmatter = [
    '---',
    `schema_version: ${yamlScalar(record.schema_version || '1.0')}`,
    `record_kind: ${yamlScalar(record.record_kind)}`,
    `record_id: ${yamlScalar(record.record_id)}`,
    `title: ${yamlScalar(record.title)}`,
    `aliases: ${yamlArray([record.title])}`,
    `library: ${yamlScalar(record.library)}`,
    `created_at: ${yamlScalar(record.created_at)}`,
    `updated_at: ${yamlScalar(record.updated_at)}`
  ];
  for (const key of ['state', 'archive_outcome', 'source_path', 'source_hash', 'source_version', 'media_type', 'category', 'item_type', 'reuse_status']) {
    if (record[key]) frontmatter.push(`${key}: ${yamlScalar(record[key])}`);
  }
  if (record.semantic_kind) frontmatter.push(`semantic_kind: ${yamlScalar(record.semantic_kind)}`);
  if (record.source_language) frontmatter.push(`source_language: ${yamlScalar(record.source_language)}`);
  frontmatter.push(`output_language: ${yamlScalar(record.output_language || 'zh-CN')}`);
  if (record.tags?.length) frontmatter.push(`tags: ${yamlArray(record.tags)}`);
  for (const key of ['project_ids', 'source_document_ids', 'business_item_ids', 'company_knowledge_ids']) {
    if (record[key]?.length) frontmatter.push(`${key}: ${yamlArray(record[key])}`);
  }
  frontmatter.push('---', '', `# ${record.title}`, '');
  const body = [];
  if (record.summary) body.push('## 内容', '', record.summary, '');
  if (record.evidence?.verbatim) {
    body.push('## 来源证据（原文）', '', `> ${clean(record.evidence.verbatim, 4000).replace(/\n/g, '\n> ')}`, '',
      `定位：${humanLocator(record.evidence.locator || {})}`, '');
    if (record.evidence_translation && record.evidence_translation !== record.evidence.verbatim) {
      body.push('### 证据中文译文', '', `> ${clean(record.evidence_translation, 4000).replace(/\n/g, '\n> ')}`, '');
    }
  }
  if (relations.length) body.push('## 关系', '', ...relations.map((relation) =>
    `- ${relation.type}：${relationLink(relation)}`), '');
  if (record.unresolved_relations?.length) body.push('## 待处理关系', '',
    ...record.unresolved_relations.map((item) =>
      `- ${item.type || 'related'}：${item.source_candidate || '未命名'}（${item.reason}；定位 ${stableJson(item.evidence_locator || {})}）`), '');
  body.push('## 追溯', '', `- 记录编号：${record.record_id}`);
  if (record.owner_source_id) body.push(`- 归属来源：${record.owner_source_id}`);
  if (record.source_hash) body.push(`- 来源哈希：${record.source_hash}`);
  return `${frontmatter.concat(body).join('\n')}\n`;
}

function routeRecord(record, route, registryEntry, settings) {
  const categoryValue = record.category || route.directory_category;
  if (!categoryValue) throw new Error('结构化路由分类未确定，禁止使用默认目录');
  const category = safeSegment(categoryValue);
  if (record.library === 'active_tender') {
    if (!registryEntry) throw new Error('在办库记录缺少唯一项目登记');
    return joinPath(settings.activeRoot, safeSegment(registryEntry.project_id), category,
      KIND_FOLDER[record.record_kind], `${record.record_id}.md`);
  }
  return joinPath(settings.businessRoot, category, KIND_FOLDER[record.record_kind], `${record.record_id}.md`);
}

function resolveRelations(records, index, limits) {
  const byId = new Map(records.map((record) => [record.record_id, record]));
  const pathEntries = Object.values(index.records || {});
  for (const entry of pathEntries) if (!byId.has(entry.record_id)) byId.set(entry.record_id, entry);
  const unresolved = [];
  for (const record of records) {
    const resolved = [];
    const seen = new Set();
    for (const relation of record.requested_relations || []) {
      const type = clean(relation.type, 40);
      const rule = RELATION_TYPES[type];
      const candidates = uniq(relation.target_ids || (relation.target_id ? [relation.target_id] : []));
      const compatible = candidates.map((id) => byId.get(id)).filter((target) =>
        target && rule && rule.from.includes(record.record_kind) && rule.to.includes(target.record_kind));
      let reason = '';
      if (!rule) reason = 'unsupported_relation_type';
      else if (!candidates.length) reason = 'unresolved_target';
      else if (compatible.length !== 1) reason = compatible.length ? 'ambiguous_target' : 'type_mismatch_or_missing';
      if (reason) {
        const issue = {
          source_document_id: record.owner_source_id,
          source_record_id: record.record_id,
          type,
          source_candidate: clean(relation.source_candidate, 300),
          candidate_ids: candidates,
          evidence_locator: relation.evidence_locator || {},
          reason
        };
        record.unresolved_relations = [...(record.unresolved_relations || []), issue];
        unresolved.push(issue);
        continue;
      }
      const target = compatible[0];
      const key = `${type}:${target.record_id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      resolved.push({
        type, target_id: target.record_id, target_title: target.title,
        target_path: target.path || index.records?.[target.record_id]?.path
      });
      if (resolved.length >= limits.max_links_per_record) break;
    }
    record.relations = resolved.filter((relation) => relation.target_path);
  }
  const groups = new Map();
  for (const issue of unresolved) {
    const key = `${issue.source_document_id}:${issue.reason}`;
    if (!groups.has(key)) groups.set(key, { source_document_id: issue.source_document_id, cause: issue.reason, issues: [] });
    groups.get(key).issues.push(issue);
  }
  return [...groups.values()].sort((a, b) => `${a.source_document_id}:${a.cause}`.localeCompare(`${b.source_document_id}:${b.cause}`));
}

function buildRecords(input, settings) {
  if (input.universalResult?.knowledge_units) return buildCanonicalRecords(input, settings);
  const phase2 = input.phase2Result || {};
  const phase3 = input.phase3Result || {};
  const document = input.document || {};
  const route = phase2.route || {};
  const categories = route.library === 'active_tender' ? ACTIVE_TENDER_CATEGORIES
    : route.library === 'business' ? BUSINESS_CATEGORIES : null;
  if (!categories || !categories.some((entry) => entry.key === route.directory_category)) {
    throw Object.assign(new Error('结构化路由缺少明确且类型兼容的两库分类'), { code: 'STRUCTURED_ROUTE_UNRESOLVED' });
  }
  const registryMatches = (input.projectRegistry || []).filter((entry) => entry.project_id === route.project_id);
  if (route.project_id && registryMatches.length !== 1) throw new Error('项目路由不是登记表中的唯一精确匹配');
  const registry = registryMatches[0];
  const now = clean(input.logicalTime || document.ingested_at || '1970-01-01T00:00:00.000Z', 80);
  const sourceId = stableId('source_document', sourceIdentity(document));
  const sourceHash = clean(document.source_hash, 128);
  const source = {
    schema_version: '1.0', record_kind: 'source_document', record_id: sourceId,
    title: clean(document.title || document.filename || '来源文档', 300),
    library: route.library, created_at: now, updated_at: now,
    source_path: clean(document.source_path, 800), source_hash: sourceHash,
    source_version: clean(document.source_version || document.metadata?.version_label, 100),
    media_type: clean(document.media_type || document.source_type, 100),
    owner_source_id: sourceId, summary: '原始资料的结构化来源记录。'
  };
  const records = [];
  let project = null;
  if (registry) {
    const projectId = stableId('project', projectIdentity(registry));
    project = {
      schema_version: '1.0', record_kind: 'project', record_id: projectId,
      title: clean(registry.name || registry.project_id, 300), library: 'active_tender',
      created_at: now, updated_at: now, state: clean(registry.state || 'lead', 40),
      owner_source_id: sourceId, source_document_ids: [sourceId]
    };
    source.project_ids = [projectId];
    source.requested_relations = [{ type: 'belongs_to', target_id: projectId }];
    records.push(project);
  }
  records.push(source);
  const decisions = new Map((phase3.classifications || []).map((item) => [item.candidate_id, item]));
  const seen = new Set();
  for (const candidate of phase2.business_item_batch?.items || []) {
    const decision = decisions.get(candidate.candidate_id);
    if (!decision || decision.outcome === 'mandatory_human_handling') continue;
    const itemId = stableId('business_item', candidateIdentity(candidate, sourceId));
    const fingerprint = hash({
      type: candidate.item_type, summary: clean(candidate.summary, 4000),
      evidence: candidate.evidence
    });
    if (seen.has(fingerprint)) continue;
    seen.add(fingerprint);
    const item = {
      schema_version: '1.0', record_kind: 'business_item', record_id: itemId,
      title: clean(candidate.title || candidate.summary, 120) || '业务事项',
      library: route.library, created_at: now, updated_at: now,
      category: route.directory_category, item_type: candidate.item_type,
      summary: clean(candidate.summary, 8000), evidence: candidate.evidence,
      owner_source_id: sourceId, source_document_ids: [sourceId],
      project_ids: project ? [project.record_id] : [],
      requested_relations: [
        { type: 'derived_from', target_id: sourceId },
        ...(project ? [{ type: 'belongs_to', target_id: project.record_id }] : []),
        ...(candidate.relations || [])
      ]
    };
    records.push(item);
  }
  const approvedPromotions = new Set(input.approvedCompanyKnowledgeCandidateIds || []);
  for (const candidate of phase2.business_item_batch?.items || []) {
    if (!candidate.reusable_knowledge_candidate || !approvedPromotions.has(candidate.candidate_id)) continue;
    const knowledgeId = stableId('company_knowledge', `approved:${candidateIdentity(candidate, sourceId)}`);
    records.push({
      schema_version: '1.0', record_kind: 'company_knowledge', record_id: knowledgeId,
      title: clean(candidate.title || candidate.summary, 120) || '公司知识',
      library: 'business', created_at: now, updated_at: now,
      category: input.companyKnowledgeCategory || route.directory_category,
      summary: clean(candidate.summary, 8000), evidence: candidate.evidence,
      reuse_status: 'approved', owner_source_id: sourceId, source_document_ids: [sourceId],
      requested_relations: [{ type: 'derived_from', target_id: sourceId }]
    });
  }
  if (records.length > settings.limits.max_records) throw new Error('结构化记录数量超过安全上限');
  return { records, registry, route, sourceId };
}

function buildCanonicalRecords(input, settings) {
  const result = input.universalResult;
  const document = result.document || input.document || {};
  const units = (result.knowledge_units || []).filter((unit) =>
    !(result.review_decisions || []).some((review) => review.unit_ids?.includes(unit.unit_id)));
  const now = clean(input.logicalTime || document.ingested_at || '1970-01-01T00:00:00.000Z', 80);
  const sourceId = stableId('source_document', sourceIdentity(document));
  const registryMatches = (input.projectRegistry || []).filter((entry) =>
    units.some((unit) => unit.project_ids?.includes(entry.project_id)));
  if (units.some((unit) => unit.route?.library === 'active_tender') && registryMatches.length !== 1) {
    throw Object.assign(new Error('在办知识单元必须唯一匹配项目登记表'), { code: 'STRUCTURED_ROUTE_UNRESOLVED' });
  }
  const registry = registryMatches[0] || null;
  const sourceLibrary = units.some((unit) => unit.route?.library === 'active_tender') ? 'active_tender' : 'business';
  const source = {
    schema_version: '1.0', record_kind: 'source_document', record_id: sourceId,
    title: clean(document.title || '来源文档', 300), library: sourceLibrary,
    created_at: now, updated_at: now, source_path: clean(document.source_path, 800),
    source_hash: clean(document.source_hash, 128), media_type: clean(document.media_type, 100),
    owner_source_id: sourceId, summary: `统一语义管线来源记录；共形成 ${units.length} 个知识单元。`,
    category: sourceLibrary === 'active_tender' ? 'project_material_index' : 'terminology_general_knowledge'
  };
  const records = [source];
  let project = null;
  if (registry) {
    const projectId = stableId('project', projectIdentity(registry));
    project = {
      schema_version: '1.0', record_kind: 'project', record_id: projectId,
      title: clean(registry.name || registry.project_id, 300), library: 'active_tender',
      created_at: now, updated_at: now, state: clean(registry.state || 'lead', 40),
      owner_source_id: sourceId, source_document_ids: [sourceId], category: 'project_overview'
    };
    source.project_ids = [projectId];
    source.requested_relations = [{ type: 'belongs_to', target_id: projectId }];
    records.unshift(project);
  }
  const unitToRecord = new Map();
  for (const unit of units) {
    const recordKind = unit.route.library === 'business' && unit.reusable === true
      ? 'company_knowledge' : 'business_item';
    const recordId = stableId(recordKind, `${sourceId}:unit:${unit.fingerprint || unit.unit_id}`);
    unitToRecord.set(unit.unit_id, recordId);
    records.push({
      schema_version: '1.0', record_kind: recordKind, record_id: recordId,
      title: clean(unit.title, 160) || '知识单元', library: unit.route.library,
      created_at: now, updated_at: now, category: unit.route.category,
      item_type: recordKind === 'business_item' ? unit.semantic_kind : undefined,
      reuse_status: recordKind === 'company_knowledge' ? 'auto_supported' : undefined,
      summary: clean(unit.statement, 8000), evidence: unit.evidence?.[0],
      evidence_translation: unit.source_language === 'zh' ? '' : clean(unit.translated_statement, 8000),
      evidence_list: unit.evidence, tags: unit.tags, semantic_kind: unit.semantic_kind,
      source_language: unit.source_language, output_language: unit.output_language || 'zh-CN',
      original_statement: unit.original_statement, translated_statement: unit.translated_statement,
      translation: unit.translation,
      conditions: unit.applicable_conditions, exceptions: unit.exceptions,
      structured_facts: unit.structured_facts, confidence: unit.confidence,
      uncertainty: unit.uncertainty, owner_source_id: sourceId,
      source_document_ids: [sourceId], project_ids: project ? [project.record_id] : [],
      requested_relations: [{ type: 'derived_from', target_id: sourceId }]
    });
  }
  for (const relation of result.relations || []) {
    const from = records.find((record) => record.record_id === unitToRecord.get(relation.from_unit_id));
    const toId = unitToRecord.get(relation.to_unit_id);
    if (!from || !toId) continue;
    from.requested_relations.push({ type: relation.type, target_id: toId, evidence_locator: relation.evidence });
    const to = records.find((record) => record.record_id === toId);
    if (to) to.requested_relations.push({ type: relation.type, target_id: from.record_id, evidence_locator: relation.evidence });
  }
  if (records.length > settings.limits.max_records) throw new Error('结构化记录数量超过安全上限');
  return {
    records, registry, sourceId,
    route: { library: sourceLibrary, directory_category: source.category },
    reviewDecisions: result.review_decisions || []
  };
}

function buildPlan(input) {
  const settings = normalizeSettings(input.settings);
  if (!settings.enabled || settings.mode === 'legacy') return {
    version: WRITER_VERSION, mode: 'feature_off', actions: [], conflicts: [], review_groups: [],
    summary: '结构化写入未开启。', writes_performed: 0
  };
  for (const root of [settings.activeRoot, settings.businessRoot, settings.stateRoot]) {
    if (!pathSafe(root)) throw new Error(`未通过 vault 路径安全校验：${root}`);
  }
  const roots = [settings.activeRoot, settings.businessRoot];
  if (roots[0] === roots[1] || roots.some((a) => roots.some((b) => a !== b
    && (a.startsWith(`${b}/`) || b.startsWith(`${a}/`))))) {
    throw new Error('两库根目录不能相同或互相嵌套');
  }
  for (const protectedRoot of [
    settings.stateRoot, clean(input.settings?.intakePath, 600),
    clean(input.settings?.bidIntakePath, 600), clean(input.settings?.businessIntakePath, 600)
  ].filter(Boolean)) {
    if (roots.some((root) => root === protectedRoot || root.startsWith(`${protectedRoot}/`)
      || protectedRoot.startsWith(`${root}/`))) {
      throw new Error('结构化输出根目录不得与来源或插件状态目录重叠');
    }
  }
  const { index, conflicts: indexConflicts } = validateIndex(input.index);
  const { records, registry, route, sourceId, reviewDecisions = [] } = buildRecords(input, settings);
  const conflicts = [...indexConflicts];
  const physicalIds = new Map();
  for (const [path, content] of Object.entries(input.existingFiles || {})) {
    if (typeof content !== 'string') continue;
    const id = clean((content.match(/^record_id:\s*["']?([^"'\n]+)/m) || [])[1], 300);
    if (!id) continue;
    if (!physicalIds.has(id)) physicalIds.set(id, []);
    physicalIds.get(id).push(path);
  }
  for (const [recordId, paths] of physicalIds) {
    if (new Set(paths).size > 1) conflicts.push({
      cause: 'same_id_multiple_paths', record_id: recordId, paths: uniq(paths)
    });
  }
  if (route.library === 'active_tender' && !registry) {
    conflicts.push({ cause: 'active_project_unresolved', source_document_id: sourceId });
    return {
      version: WRITER_VERSION, mode: settings.mode, source_document_id: sourceId,
      generator: 'structured-writer', actions: [], conflicts, review_groups: [],
      phase3_handling_groups: reviewDecisions,
      counts: {}, source_hash: clean(input.document?.source_hash, 128),
      source_version: clean(input.document?.source_version || input.document?.metadata?.version_label, 100),
      index_revision: Number(index.revision || 0), blocked: true, writes_performed: 0,
      plan_id: `plan-${hash([sourceId, 'active_project_unresolved']).slice(0, 24)}`,
      summary: '新建 0，更新 0，不变 0，移动 0，需要处理 1。'
    };
  }
  for (const record of records) {
    record.path = routeRecord(record, { ...route, directory_category: record.category || route.directory_category }, registry, settings);
    const existingIndex = index.records?.[record.record_id];
    if (existingIndex && existingIndex.path !== record.path && input.archiveTransition !== true) {
      record.path = existingIndex.path; // rename/title changes never move identity
    }
  }
  const reviewGroups = resolveRelations(records, index, settings.limits);
  const byPath = input.existingFiles || {};
  const actions = [];
  for (const record of records.sort((a, b) => a.record_id.localeCompare(b.record_id))) {
    const indexed = index.records?.[record.record_id];
    const occupied = byPath[record.path];
    if (indexed && indexed.path !== record.path && byPath[indexed.path] !== undefined) {
      conflicts.push({ cause: 'same_id_multiple_paths', record_id: record.record_id, paths: uniq([indexed.path, record.path]) });
      continue;
    }
    if (occupied !== undefined) {
      const occupiedId = clean((occupied.match(/^record_id:\s*["']?([^"'\n]+)/m) || [])[1], 300);
      if (occupiedId && occupiedId !== record.record_id) {
        conflicts.push({ cause: 'path_occupied_by_different_id', path: record.path, record_id: record.record_id, occupied_id: occupiedId });
        continue;
      }
    }
    const content = serializeRecord(record);
    const contentHash = hash(content);
    const prior = byPath[record.path];
    const priorHash = prior === undefined ? null : hash(prior);
    const indexedHash = indexed?.content_hash || null;
    if (prior !== undefined && indexedHash && priorHash !== indexedHash) {
      conflicts.push({ cause: 'optimistic_hash_mismatch', record_id: record.record_id, path: record.path, expected: indexedHash, actual: priorHash });
      continue;
    }
    const action = priorHash === contentHash ? 'noop' : prior === undefined ? 'create' : 'update';
    actions.push({
      action, record_id: record.record_id, record_kind: record.record_kind, path: record.path,
      content, content_hash: contentHash, prior_hash: priorHash, prior_content: prior,
      owner_source_id: sourceId, source_hash: clean(input.document?.source_hash, 128),
      source_version: clean(input.document?.source_version || input.document?.metadata?.version_label, 100)
    });
  }
  if (input.archiveTransition) {
    const transition = validateProjectTransition(input.archiveTransition.from, 'archived', input.archiveTransition);
    if (!transition.allowed) conflicts.push({ cause: 'archive_transition_blocked', reason: transition.reason });
    else {
      for (const action of actions) {
        if (!action.path.startsWith(`${settings.activeRoot}/`)) continue;
        const to = joinPath(settings.businessRoot, 'complete_historical_projects', action.path.slice(settings.activeRoot.length + 1));
        if (action.prior_hash === null) {
          action.action = 'create';
        } else {
          action.action = action.action === 'noop' ? 'move' : `${action.action}_and_move`;
          action.from_path = action.path;
        }
        action.path = to;
      }
    }
  }
  if (actions.length > settings.limits.max_actions) throw new Error('写入计划超过安全上限');
  const counts = {};
  for (const action of actions) counts[action.action] = (counts[action.action] || 0) + 1;
  const universalMode = Boolean(input.universalResult?.knowledge_units);
  const phase3HandlingGroups = universalMode ? reviewDecisions
    : [...(input.phase3Result?.handling_groups || []), ...reviewDecisions];
  const blocked = conflicts.length > 0 || reviewGroups.length > 0 || phase3HandlingGroups.length > 0;
  const planCore = {
    version: WRITER_VERSION, mode: settings.mode, source_document_id: sourceId,
    generator: 'structured-writer', actions, conflicts, review_groups: reviewGroups,
    phase3_handling_groups: phase3HandlingGroups, counts,
    source_hash: clean(input.document?.source_hash, 128),
    source_version: clean(input.document?.source_version || input.document?.metadata?.version_label, 100),
    index_revision: Number(index.revision || 0), blocked,
    writes_performed: 0
  };
  planCore.plan_id = `plan-${hash({ ...planCore, actions: actions.map(({ prior_content, ...item }) => item) }).slice(0, 24)}`;
  planCore.summary = `新建 ${counts.create || 0}，更新 ${counts.update || 0}，不变 ${counts.noop || 0}，移动 ${counts.move || 0}，需要处理 ${conflicts.length + reviewGroups.length + planCore.phase3_handling_groups.length}。`;
  return planCore;
}

async function ensureParent(vault, path) {
  const parent = path.split('/').slice(0, -1).join('/');
  if (parent) await vault.mkdirp(parent);
}

const KNOWLEDGE_RECORD_KINDS = new Set(['business_item', 'company_knowledge']);

function frontmatterValue(content, key) {
  const match = String(content || '').match(new RegExp(`^${key}:\\s*["']?([^"'\\n]+)`, 'm'));
  return clean(match?.[1], 300);
}

function hasSourceAssociation(content, sourceId) {
  const value = String(content || '');
  return value.includes(`- 归属来源：${sourceId}`)
    || new RegExp(`^source_document_ids:\\s*\\[[^\\n]*["']?${sourceId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}["']?`, 'm').test(value);
}

async function verifyCommittedRecords(plan, vault, context = {}) {
  const records = [];
  const failures = [];
  for (const action of plan.actions) {
    let content = null;
    try { content = await vault.readIfExists(action.path); } catch (error) {
      failures.push({ record_id: action.record_id, record_kind: action.record_kind,
        path: action.path, reason: 'unreadable_file', error: String(error?.message || error) });
      continue;
    }
    const actualId = frontmatterValue(content, 'record_id');
    const actualKind = frontmatterValue(content, 'record_kind');
    if (content === null || !String(content).trim() || !action.path.endsWith('.md') || actualId !== action.record_id
      || actualKind !== action.record_kind
      || (KNOWLEDGE_RECORD_KINDS.has(action.record_kind)
        && !hasSourceAssociation(content, action.owner_source_id))) {
      failures.push({
        record_id: action.record_id, record_kind: action.record_kind, path: action.path,
        reason: content === null ? 'missing_file' : !String(content).trim() ? 'empty_file' : 'identity_or_source_mismatch'
      });
      continue;
    }
    let authoritative = null;
    try {
      authoritative = typeof vault.verify === 'function'
        ? await vault.verify(action, context.transactionId || '', context.verifiedAt || '', context) : null;
    } catch (error) {
      failures.push({ record_id: action.record_id, record_kind: action.record_kind,
        path: action.path, reason: 'public_vault_verification_failed', error: String(error?.message || error) });
      continue;
    }
    records.push({
      record_id: action.record_id, record_kind: action.record_kind, final_path: action.path, path: action.path,
      disposition: action.action === 'noop' ? 'unchanged' : action.action,
      bytes: Buffer.byteLength(content), knowledge_record: KNOWLEDGE_RECORD_KINDS.has(action.record_kind),
      content_hash: action.content_hash, verified_at: context.verifiedAt || '',
      transaction_id: context.transactionId || '', state: 'visible_verified', ...(authoritative || {})
    });
  }
  if (failures.length) {
    const plannedKnowledge = plan.actions.filter((item) => KNOWLEDGE_RECORD_KINDS.has(item.record_kind));
    const verifiedKnowledge = records.filter((item) => item.knowledge_record);
    const error = new Error(`结构化提交未持久化：计划 ${plannedKnowledge.length} 个知识文件，仅验证 ${verifiedKnowledge.length} 个。`);
    error.code = 'STRUCTURED_WRITE_NOT_PERSISTED';
    error.stage = 'structured-post-commit-verification';
    error.details = {
      planned: plannedKnowledge.length, attempted: plannedKnowledge.filter((item) => item.action !== 'noop').length,
      committed: verifiedKnowledge.length, verified: verifiedKnowledge.length, failures
    };
    throw error;
  }
  const knowledgeRecords = records.filter((record) => record.knowledge_record);
  return {
    records,
    knowledge_records: knowledgeRecords,
    knowledge_paths: knowledgeRecords.map((record) => record.path),
    counts: {
      created: records.filter((record) => record.disposition === 'create').length,
      updated: records.filter((record) => record.disposition.includes('update')).length,
      unchanged: records.filter((record) => record.disposition === 'unchanged').length,
      moved: records.filter((record) => record.disposition.includes('move')).length,
      source_records: records.filter((record) => record.record_kind === 'source_document').length,
      project_records: records.filter((record) => record.record_kind === 'project').length,
      knowledge_records: knowledgeRecords.length,
      knowledge_created: knowledgeRecords.filter((record) => record.disposition === 'create').length,
      knowledge_updated: knowledgeRecords.filter((record) => record.disposition.includes('update')).length,
      knowledge_unchanged: knowledgeRecords.filter((record) => record.disposition === 'unchanged').length
    },
    bytes_written: records
      .filter((record) => record.disposition !== 'unchanged')
      .reduce((sum, record) => sum + record.bytes, 0)
  };
}

async function commitPlan(plan, options) {
  if (!plan || plan.mode !== 'structured-write') throw new Error('只有 structured-write 计划可提交');
  if (plan.blocked) throw new Error('计划包含冲突或待处理项，禁止提交');
  const vault = options.vault;
  const release = await options.lock.acquire('structured-writer');
  if (!options.runId) throw Object.assign(new Error('结构化提交缺少当前 run_id'), { code: 'CURRENT_RUN_REQUIRED' });
  const transactionId = `txn-${hash([plan.plan_id, options.runId, options.logicalTime || '']).slice(0, 24)}`;
  const quarantine = joinPath(options.stateRoot, 'structured-writer', 'quarantine', transactionId);
  const manifestPath = joinPath(options.stateRoot, 'structured-writer', 'transactions', `${transactionId}.json`);
  const manifest = {
    version: WRITER_VERSION, transaction_id: transactionId, plan_id: plan.plan_id,
    source_document_id: plan.source_document_id, run_id: options.runId, task_id: options.taskId || '',
    status: 'staging', steps: [], created_at: options.logicalTime || ''
  };
  manifest.previous_index = JSON.parse(JSON.stringify(options.index || emptyIndex()));
  let indexSaved = false;
  try {
    await ensureParent(vault, manifestPath);
    await vault.write(manifestPath, JSON.stringify(manifest, null, 2));
    for (const action of plan.actions.filter((item) => item.action !== 'noop')) {
      const current = await vault.readIfExists(action.from_path || action.path);
      if ((current === null ? null : hash(current)) !== action.prior_hash) throw new Error(`提交前内容已变化：${action.record_id}`);
      const step = { ...action, prior_content: current, status: 'started' };
      manifest.steps.push(step);
      await vault.write(manifestPath, JSON.stringify(manifest, null, 2));
      if (action.from_path && action.from_path !== action.path) {
        await ensureParent(vault, action.path);
        await vault.rename(action.from_path, action.path);
        step.moved = true;
      }
      await ensureParent(vault, action.path);
      await vault.write(action.path, action.content);
      step.status = 'committed';
      await vault.write(manifestPath, JSON.stringify(manifest, null, 2));
    }
    const index = JSON.parse(JSON.stringify(options.index || emptyIndex()));
    index.version = INDEX_VERSION;
    index.revision = Number(index.revision || 0) + 1;
    index.updated_at = options.logicalTime || '';
    for (const action of plan.actions) index.records[action.record_id] = {
      record_id: action.record_id, record_kind: action.record_kind, path: action.path,
      content_hash: action.content_hash, owner_source_id: action.owner_source_id,
      source_hash: action.source_hash, source_version: action.source_version
    };
    index.source_versions[plan.source_document_id] = { source_hash: plan.source_hash, source_version: plan.source_version };
    await options.saveIndex(index);
    indexSaved = true;
    manifest.status = 'files_committed';
    manifest.index_revision = index.revision;
    await vault.write(manifestPath, JSON.stringify(manifest, null, 2));
    const targetRoots = options.targetRoots || { active_tender: '在办投标库', business: '长期业务库' };
    const verified = await verifyCommittedRecords(plan, vault, {
      transactionId, verifiedAt: new Date().toISOString(), runId: options.runId, targetRoots
    });
    const plannedPaths = plan.actions.filter((item) => KNOWLEDGE_RECORD_KINDS.has(item.record_kind)).map((item) => item.path);
    const committedPaths = plan.actions.filter((item) => KNOWLEDGE_RECORD_KINDS.has(item.record_kind)
      && (item.action === 'noop' || manifest.steps.some((step) => step.record_id === item.record_id && step.status === 'committed'))).map((item) => item.path);
    const visiblePaths = verified.knowledge_records.map((item) => item.final_path);
    const sortedUnique = (rows) => [...new Set(rows)].sort();
    const sets = { planned: sortedUnique(plannedPaths), committed: sortedUnique(committedPaths), visible_verified: sortedUnique(visiblePaths) };
    const pathSetHashes = Object.fromEntries(Object.entries(sets).map(([key, rows]) => [key, rows.map((path) => hash(path))]));
    if (JSON.stringify(sets.planned) !== JSON.stringify(sets.committed)
      || JSON.stringify(sets.planned) !== JSON.stringify(sets.visible_verified)) {
      const mismatch = new Error('最终知识文件集合不一致，禁止完成任务');
      mismatch.code = 'AUTHORITATIVE_MANIFEST_SET_MISMATCH'; mismatch.details = { path_set_hashes: pathSetHashes,
        missing_from_committed: sets.planned.filter((path) => !sets.committed.includes(path)).map(hash),
        missing_from_visible: sets.planned.filter((path) => !sets.visible_verified.includes(path)).map(hash) }; throw mismatch;
    }
    manifest.status = 'committed';
    manifest.authoritative_manifest_schema = 'eks/authoritative-visible-manifest/2.0';
    manifest.authoritative_manifest = verified.knowledge_records;
    manifest.path_sets = sets;
    manifest.path_set_hashes = pathSetHashes;
    await vault.write(manifestPath, JSON.stringify(manifest, null, 2));
    return { transactionId, manifestPath, manifest, index, verified };
  } catch (error) {
    manifest.status = 'recovering';
    manifest.error = String(error?.message || error);
    for (const step of manifest.steps.slice().reverse()) {
      try {
        if (step.prior_content === null) {
          const current = await vault.readIfExists(step.path);
          if (current !== null && hash(current) === step.content_hash) {
            await ensureParent(vault, joinPath(quarantine, step.path));
            await vault.rename(step.path, joinPath(quarantine, step.path));
          }
        } else {
          if (step.moved && step.from_path) {
            await ensureParent(vault, step.from_path);
            if (await vault.readIfExists(step.path) !== null) await vault.rename(step.path, step.from_path);
            await vault.write(step.from_path, step.prior_content);
          } else {
            await vault.write(step.path, step.prior_content);
          }
        }
        step.rollback_status = 'restored';
      } catch (rollbackError) {
        step.rollback_status = 'failed';
        step.rollback_error = String(rollbackError?.message || rollbackError);
      }
    }
    if (indexSaved) {
      try { await options.saveIndex(manifest.previous_index); manifest.index_rollback_status = 'restored'; }
      catch (indexError) {
        manifest.index_rollback_status = 'failed';
        manifest.index_rollback_error = String(indexError?.message || indexError);
      }
    }
    manifest.status = manifest.steps.every((step) => step.rollback_status === 'restored') ? 'rolled_back' : 'recovery_required';
    try { await vault.write(manifestPath, JSON.stringify(manifest, null, 2)); } catch (_) {}
    error.transactionManifest = manifest;
    throw error;
  } finally {
    release();
  }
}

async function rollbackTransaction(manifest, options) {
  if (!manifest || manifest.status !== 'committed') throw new Error('只能回滚已提交的结构化事务');
  const release = await options.lock.acquire('structured-writer');
  try {
    for (const step of (manifest.steps || []).slice().reverse()) {
      const current = await options.vault.readIfExists(step.path);
      if (current !== null && hash(current) !== step.content_hash) throw new Error(`文件已被后续修改，停止回滚：${step.path}`);
      if (step.prior_content === null) {
        const target = joinPath(options.stateRoot, 'structured-writer', 'quarantine', `rollback-${manifest.transaction_id}`, step.path);
        await ensureParent(options.vault, target);
        if (current !== null) await options.vault.rename(step.path, target);
      } else if (step.from_path && step.from_path !== step.path) {
        await ensureParent(options.vault, step.from_path);
        if (current !== null) await options.vault.rename(step.path, step.from_path);
        await options.vault.write(step.from_path, step.prior_content);
      } else {
        await options.vault.write(step.path, step.prior_content);
      }
    }
    if (typeof options.saveIndex === 'function' && manifest.previous_index) {
      await options.saveIndex(manifest.previous_index);
    }
    return { status: 'rolled_back', transaction_id: manifest.transaction_id };
  } finally {
    release();
  }
}

module.exports = {
  WRITER_VERSION, INDEX_VERSION, PLAN_LIMITS, MODES, RELATION_TYPES,
  stableJson, hash, stableId, pathSafe, normalizeSettings, sourceIdentity,
  candidateIdentity, emptyIndex, validateIndex, serializeRecord, resolveRelations,
  buildPlan, commitPlan, rollbackTransaction, verifyCommittedRecords
};
},
/* STRUCTURED_PHASE_MODULES_END */
/**
 * @module src/core/task
 * 任务默认配置 / 运行时 schema 版本号常量
 * @exports DEFAULT_SETTINGS
 * @exports runtimeVersions
 */
"src/core/task.js": function(require, module, exports) {
const crypto = require("crypto");
const path = require("path");
const { deriveVerifiedFacts } = require("src/knowledge-write-port.js");
const TASK_STATUSES = new Set([
  'discovered', 'queued', 'extracting', 'parsing', 'parsed', 'slicing',
  'classifying', 'classified', 'summarizing', 'summarized', 'atomizing',
  'validating', 'writing', 'written', 'paused', 'cancelled', 'failed',
  'needs_review', 'needs_ocr', 'skipped', 'unsupported', 'unsupported_media',
  'archived', 'rolled_back', 'completed_no_output'
]);
const PROCESSING_STATUSES = new Set(['extracting', 'parsing', 'slicing', 'classifying', 'summarizing', 'atomizing', 'validating', 'writing']);

const DEFAULT_SETTINGS = {
  advancedSettingsEnabled: false,
  controlledWriterEnabled: true,
  structuredWriterMode: 'structured-write',
  structuredActiveRoot: '在办投标库',
  structuredBusinessRoot: '长期业务库',
  structuredMaxRecords: 100,
  structuredMaxActions: 300,
  structuredMaxLinkFanout: 20,
  structuredPhase2BatchSize: 12,
  settingsVersion: 30,
  intakePath: '06-知识库/源文件',
  outputPath: '06-知识库/wiki',
  bidIntakePath: '06-知识库/源文件/招投标',
  businessIntakePath: '06-知识库/源文件/业务库',
  bidOutputPath: '06-知识库/wiki/招投标',
  businessOutputPath: '06-知识库/wiki/业务库',
  artifactsPath: '06-知识库/源文件/_slicer_artifacts',
  componentPackPath: '06-知识库/组件包',
  draftPath: '06-知识库/源文件/_slicer_artifacts/review',
  logPath: '06-知识库/源文件/_slicer_artifacts/logs',
  tasksFileName: 'tasks.json',
  rollbackFileName: 'rollback.json',
  aiProvider: 'minimax',
  autoApproveConfidenceThreshold: 0.9,
  minimaxApiKey: '',
  minimaxModel: 'MiniMax-M3',
  minimaxEndpoint: 'https://api.minimaxi.com/anthropic/v1/messages',
  pdfExtractionOrder: 'mineru-api,paddleocr-api',
  pdfAllowExternalUpload: false,
  localMsgAdapterEnabled: true,
  localDocxAdapterEnabled: true,
  localXlsxAdapterEnabled: true,
  localPptxAdapterEnabled: true,
  localTextBlockAdapterEnabled: true,
  ooxmlMaxEntries: 4096,
  ooxmlMaxUncompressedBytes: 805306368,
  ooxmlMaxXmlBytes: 67108864,
  ooxmlMaxTextChars: 8388608,
  localPdfInventoryEnabled: true,
  blockV0PackingEnabled: true,
  localOcrEnabled: false,
  localOcrProvider: 'auto',
  localOcrExecutable: '',
  localOcrLanguages: 'chi_sim+eng',
  localOcrConcurrency: 2,
  localOcrTimeoutMs: 120000,
  localOcrQualityThreshold: 0.72,
  pdfMineruApiKey: '',
  pdfMineruApiEndpoint: 'https://mineru.net/api/v4',
  pdfMineruApiModel: 'vlm',
  pdfMineruApiLanguage: 'ch_server',
  pdfPaddleOcrApiKey: '',
  pdfPaddleOcrApiEndpoint: 'https://paddleocr.aistudio-app.com/api/v2/ocr/jobs',
  pdfPaddleOcrApiModel: 'PaddleOCR-VL-1.6',
  pdfApiPollIntervalMs: 5000,
  pdfExternalTimeoutMs: 600000,
  aiChunkSize: 8000,
  aiMaxChunks: 100,
  maxPointsPerRequest: 3,
  summaryConcurrency: 2,
  atomizationConcurrency: 2,
  shortDocumentMaxCards: 20,
  // v2.7（借鉴 WeKnora 切片引擎）：相邻切片重叠比例（0–0.5）。
  //   0.1 ≈ WeKnora 的 chunk_overlap 80 / chunk_size 512 ≈ 15% 思路，
  //   避免段落语境在切点处断裂；会略增 AI 输入 token。
  chunkOverlapRatio: 0.1,
  // v2.7：同一标题语境下过小的相邻切片自动合并（WeKnora coalesceTinyChunks），
  //   显著减少 AI 调用次数、提升整体处理速度。
  coalesceTinyChunks: true,
  aiRequestTimeoutMs: 300000,
  aiRequestMaxAttempts: 3,
  aiRetryBaseMs: 800,
  maxAutomaticRetries: 3,
  maxConcurrentDocuments: 3,
  rateLimitMs: 1000,
  rateLimitMaxConcurrent: 2,
  rateLimitBackoffMaxMs: 30000,
  rateLimitWindowSize: 10,
  useStreamingAi: false,
  useEnvKeys: true,
  staleProcessingMinutes: 20,
  targetLanguage: 'zh-CN',
  // 空值表示跟随 Obsidian / 操作系统运行时本地时区；可配置 IANA 时区以稳定跨设备日期语义。
  businessTimeZone: '',
  maxExcerptLength: 500,
  pipelineVersion: '1.3.0',
  promptBundleVersion: '1.1',
  schemaVersion: '1.1',
  // v1.3: 诊断日志默认写到 vault 之外（~/.eks/logs/diag.log），
  //        避免被 iCloud / OneDrive / Git 等同步工具重复上传/同步触发性能问题与隐私扩散。
  //        设为 true 时回到原行为（vault 内 .obsidian/plugins/.../diag.log）。
  diagLogInVault: false,
  // v1.3: 上传源文件到 MinerU/PaddleOCR 之前是否弹 Notice 二次确认。
  //        合规优先；设为 false 跳过确认（自动化流水线场景）。
  confirmUploads: true,
  // v1.4 (M-11): 写盘前是否自动备份上一版 tasks.json 到 tasks.json.bak.{ts}。
  //               关闭后回到原行为（仅写一份 tasks.json）。备份文件独立占用 vault 空间。
  backupTasksOnSave: true,
  // v2.8: 启动时自动扫描源文件目录，默认关闭。
  //   自动扫描会连带触发云端解析与 MiniMax 调用（计费），属于高成本行为，
  //   必须由用户在设置中明确开启；关闭时只能通过控制台「扫描并自动处理」
  //   按钮或「扫描源文件」命令手动触发。
  autoScanOnStartup: false,
  // v2.13: 生产影子评估默认关闭。providerBudget=0 是完全本地/检查点模式。
  shadowEvaluationEnabled: false,
  shadowProviderBudget: 0,
  shadowCohortLimit: 20,
  shadowRetentionDays: 30,
  shadowSampleLimit: 200,
  shadowCohortSeed: 'eks-shadow-v1',
  shadowStoreFileName: 'shadow-evaluation.json',
  semanticConsent: false,
  semanticEnabled: false,
  semanticMode: 'shadow',
  embeddingProvider: 'aliyun-bailian-qwen37',
  embeddingProtocol: 'dashscope-native-v1',
  embeddingEndpoint: 'https://dashscope.aliyuncs.com/api/v1/services/embeddings/text-embedding/text-embedding',
  embeddingModel: 'qwen3.7-text-embedding',
  embeddingApiKey: '',
  embeddingApiKeyEnv: 'EKS_EMBEDDING_API_KEY',
  embeddingDimensions: 1024,
  embeddingTimeoutMs: 30000,
  embeddingMaxAttempts: 3,
  embeddingRetryBaseMs: 500,
  embeddingRateLimitMs: 250,
  embeddingBatchSize: 20,
  embeddingConcurrency: 2,
  semanticRelatedThreshold: 0.82,
  semanticDuplicateThreshold: 0.92,
  semanticMaxCandidates: 500,
  semanticTopK: 8
};

function migrateSettings(stored = {}) {
  const source = stored && typeof stored === 'object' ? stored : {};
  // Keep every stored field, including advanced/legacy fields no longer shown in
  // the ordinary settings UI. Hidden settings must survive load/save unchanged.
  const migrated = Object.assign({}, DEFAULT_SETTINGS, source);
  // Advanced controls are opt-in. The universal controlled writer is the
  // production integrity boundary and is therefore enabled for every migration.
  migrated.advancedSettingsEnabled = source.advancedSettingsEnabled === true;
  migrated.controlledWriterEnabled = true;
  migrated.structuredWriterMode = (typeof process === 'object'
    && process?.env?.EKS_ENABLE_NONPRODUCTION_PILOT === '1'
    && source.structuredWriterMode === 'structured-pilot') ? 'structured-pilot' : 'structured-write';
  migrated.structuredActiveRoot = normalizeConfiguredPath(source.structuredActiveRoot, DEFAULT_SETTINGS.structuredActiveRoot);
  migrated.structuredBusinessRoot = normalizeConfiguredPath(source.structuredBusinessRoot, DEFAULT_SETTINGS.structuredBusinessRoot);
  migrated.structuredMaxRecords = Math.max(1, Math.min(250, Math.round(Number(source.structuredMaxRecords) || DEFAULT_SETTINGS.structuredMaxRecords)));
  migrated.structuredMaxActions = Math.max(1, Math.min(600, Math.round(Number(source.structuredMaxActions) || DEFAULT_SETTINGS.structuredMaxActions)));
  migrated.structuredMaxLinkFanout = Math.max(1, Math.min(40, Math.round(Number(source.structuredMaxLinkFanout) || DEFAULT_SETTINGS.structuredMaxLinkFanout)));
  migrated.structuredPhase2BatchSize = Math.max(1, Math.min(50, Math.round(Number(source.structuredPhase2BatchSize) || DEFAULT_SETTINGS.structuredPhase2BatchSize)));
  migrated.settingsVersion = 30;
  // Runtime contract boundary changed in 2.14.1. Parsed artifacts use their own
  // parser fingerprint and remain reusable; only classification and later stages
  // receive the new pipeline fingerprint.
  migrated.pipelineVersion = DEFAULT_SETTINGS.pipelineVersion;
  migrated.aiProvider = 'minimax';
  const pathKeys = [
    'bidIntakePath', 'businessIntakePath', 'bidOutputPath', 'businessOutputPath',
    'intakePath', 'outputPath', 'artifactsPath', 'draftPath', 'logPath', 'componentPackPath'
  ];
  for (const key of pathKeys) {
    migrated[key] = normalizeConfiguredPath(source[key], DEFAULT_SETTINGS[key]);
  }
  const pathErrors = validateConfiguredPathSet(migrated);
  for (const error of pathErrors) {
    if (error.reason === 'overlap') continue;
    migrated.pathMigrationDiagnostics = Object.assign({}, migrated.pathMigrationDiagnostics, {
      [error.key]: { code: 'SETTINGS_PATH_INVALID', action: 'user_must_repair' }
    });
  }
  const extractionOrder = String(source.pdfExtractionOrder || '').split(',').map((value) => value.trim()).filter(Boolean);
  migrated.pdfExtractionOrder = extractionOrder.length
    && extractionOrder.every((value) => ['mineru-api', 'paddleocr-api'].includes(value))
    && new Set(extractionOrder).size === extractionOrder.length
    ? extractionOrder.join(',')
    : DEFAULT_SETTINGS.pdfExtractionOrder;
  // v2.12：保留所有合法旧偏好；只迁移非法/缺失值，并与运行时评分使用同一安全范围。
  const storedThreshold = Number(source.autoApproveConfidenceThreshold);
  migrated.autoApproveConfidenceThreshold = Number.isFinite(storedThreshold)
    ? Math.round(Math.max(0.7, Math.min(1, storedThreshold)) * 1000) / 1000
    : DEFAULT_SETTINGS.autoApproveConfidenceThreshold;
  if (!migrated.minimaxEndpoint
    || migrated.minimaxEndpoint === 'https://api.minimax.chat/v1/chat/completions'
    || migrated.minimaxEndpoint === 'https://api.minimaxi.com/v1/chat/completions') {
    migrated.minimaxEndpoint = DEFAULT_SETTINGS.minimaxEndpoint;
  }
  if (!Number(migrated.aiMaxChunks) || Number(migrated.aiMaxChunks) < 1) migrated.aiMaxChunks = DEFAULT_SETTINGS.aiMaxChunks;
  if (!Number(migrated.aiChunkSize) || Number(migrated.aiChunkSize) < 1) migrated.aiChunkSize = DEFAULT_SETTINGS.aiChunkSize;
  if (!Number(migrated.maxPointsPerRequest)) migrated.maxPointsPerRequest = DEFAULT_SETTINGS.maxPointsPerRequest;
  migrated.maxPointsPerRequest = Math.max(1, Math.min(3, Math.round(Number(migrated.maxPointsPerRequest))));
  if (!Number(migrated.summaryConcurrency)) migrated.summaryConcurrency = DEFAULT_SETTINGS.summaryConcurrency;
  migrated.summaryConcurrency = Math.max(1, Math.min(3, Math.round(Number(migrated.summaryConcurrency))));
  if (!Number(migrated.atomizationConcurrency)) migrated.atomizationConcurrency = DEFAULT_SETTINGS.atomizationConcurrency;
  migrated.atomizationConcurrency = Math.max(1, Math.min(3, Math.round(Number(migrated.atomizationConcurrency))));
  if (!Number(migrated.shortDocumentMaxCards)) migrated.shortDocumentMaxCards = DEFAULT_SETTINGS.shortDocumentMaxCards;
  migrated.shortDocumentMaxCards = Math.max(5, Math.min(100, Math.round(Number(migrated.shortDocumentMaxCards))));
  // v2.7: 切片重叠比例与小节合并开关键迁移（非法值回退默认）
  const storedOverlapRatio = Number(migrated.chunkOverlapRatio);
  if (!Number.isFinite(storedOverlapRatio) || storedOverlapRatio < 0 || storedOverlapRatio > 0.5) {
    migrated.chunkOverlapRatio = DEFAULT_SETTINGS.chunkOverlapRatio;
  }
  if (migrated.coalesceTinyChunks === undefined) migrated.coalesceTinyChunks = DEFAULT_SETTINGS.coalesceTinyChunks;
  // v2.8: 自动扫描默认关闭，只有明确存过 true 的才保持开启（布尔强转，杜绝字符串 "false" 之类脏值）
  migrated.autoScanOnStartup = source.autoScanOnStartup === true;
  if (!Number(migrated.pdfExternalTimeoutMs) || Number(migrated.pdfExternalTimeoutMs) < 1) {
    migrated.pdfExternalTimeoutMs = DEFAULT_SETTINGS.pdfExternalTimeoutMs;
  }
  if (!Number(migrated.aiRequestTimeoutMs) || Number(migrated.aiRequestTimeoutMs) < 1) {
    migrated.aiRequestTimeoutMs = DEFAULT_SETTINGS.aiRequestTimeoutMs;
  }
  if (!Number(migrated.maxConcurrentDocuments) || Number(migrated.maxConcurrentDocuments) < 1) {
    migrated.maxConcurrentDocuments = DEFAULT_SETTINGS.maxConcurrentDocuments;
  }
  if (migrated.pdfAllowExternalUpload === undefined) migrated.pdfAllowExternalUpload = false;
  if (migrated.localMsgAdapterEnabled === undefined) migrated.localMsgAdapterEnabled = true;
  if (migrated.localDocxAdapterEnabled === undefined) migrated.localDocxAdapterEnabled = true;
  if (migrated.localXlsxAdapterEnabled === undefined) migrated.localXlsxAdapterEnabled = true;
  if (migrated.localPptxAdapterEnabled === undefined) migrated.localPptxAdapterEnabled = true;
  if (migrated.localTextBlockAdapterEnabled === undefined) migrated.localTextBlockAdapterEnabled = true;
  migrated.ooxmlMaxEntries = Math.max(64, Math.min(16384, Math.round(Number(migrated.ooxmlMaxEntries) || DEFAULT_SETTINGS.ooxmlMaxEntries)));
  migrated.ooxmlMaxUncompressedBytes = Math.max(16 * 1024 * 1024, Math.min(2 * 1024 * 1024 * 1024, Math.round(Number(migrated.ooxmlMaxUncompressedBytes) || DEFAULT_SETTINGS.ooxmlMaxUncompressedBytes)));
  migrated.ooxmlMaxXmlBytes = Math.max(1024 * 1024, Math.min(256 * 1024 * 1024, Math.round(Number(migrated.ooxmlMaxXmlBytes) || DEFAULT_SETTINGS.ooxmlMaxXmlBytes)));
  migrated.ooxmlMaxTextChars = Math.max(100000, Math.min(32 * 1024 * 1024, Math.round(Number(migrated.ooxmlMaxTextChars) || DEFAULT_SETTINGS.ooxmlMaxTextChars)));
  if (migrated.localPdfInventoryEnabled === undefined) migrated.localPdfInventoryEnabled = true;
  if (migrated.blockV0PackingEnabled === undefined) migrated.blockV0PackingEnabled = true;
  migrated.localOcrEnabled = source.localOcrEnabled === true;
  if (!['auto', 'tesseract', 'executable'].includes(migrated.localOcrProvider)) migrated.localOcrProvider = DEFAULT_SETTINGS.localOcrProvider;
  migrated.localOcrExecutable = String(migrated.localOcrExecutable || '').trim();
  migrated.localOcrLanguages = String(migrated.localOcrLanguages || DEFAULT_SETTINGS.localOcrLanguages).replace(/[^A-Za-z0-9_+.-]/g, '') || DEFAULT_SETTINGS.localOcrLanguages;
  migrated.localOcrConcurrency = Math.max(1, Math.min(4, Math.round(Number(migrated.localOcrConcurrency) || DEFAULT_SETTINGS.localOcrConcurrency)));
  migrated.localOcrTimeoutMs = Math.max(1000, Math.min(600000, Math.round(Number(migrated.localOcrTimeoutMs) || DEFAULT_SETTINGS.localOcrTimeoutMs)));
  migrated.localOcrQualityThreshold = Math.max(0, Math.min(1, Number.isFinite(Number(migrated.localOcrQualityThreshold)) ? Number(migrated.localOcrQualityThreshold) : DEFAULT_SETTINGS.localOcrQualityThreshold));
  if (!Number(migrated.rateLimitMs)) migrated.rateLimitMs = DEFAULT_SETTINGS.rateLimitMs;
  if (!Number(migrated.rateLimitMaxConcurrent)) migrated.rateLimitMaxConcurrent = DEFAULT_SETTINGS.rateLimitMaxConcurrent;
  if (migrated.useEnvKeys === undefined) migrated.useEnvKeys = DEFAULT_SETTINGS.useEnvKeys;
  if (!Number(migrated.aiRequestMaxAttempts)) migrated.aiRequestMaxAttempts = DEFAULT_SETTINGS.aiRequestMaxAttempts;
  if (!Number(migrated.aiRetryBaseMs)) migrated.aiRetryBaseMs = DEFAULT_SETTINGS.aiRetryBaseMs;
  if (migrated.useStreamingAi === undefined) migrated.useStreamingAi = DEFAULT_SETTINGS.useStreamingAi;
  if (!Number(migrated.rateLimitBackoffMaxMs)) migrated.rateLimitBackoffMaxMs = DEFAULT_SETTINGS.rateLimitBackoffMaxMs;
  if (!Number(migrated.rateLimitWindowSize)) migrated.rateLimitWindowSize = DEFAULT_SETTINGS.rateLimitWindowSize;
  migrated.businessTimeZone = String(migrated.businessTimeZone || '');
  migrated.shadowEvaluationEnabled = source.shadowEvaluationEnabled === true;
  migrated.shadowProviderBudget = Math.max(0, Math.min(1000, Math.round(Number(migrated.shadowProviderBudget) || 0)));
  migrated.shadowCohortLimit = Math.max(1, Math.min(500, Math.round(Number(migrated.shadowCohortLimit) || DEFAULT_SETTINGS.shadowCohortLimit)));
  migrated.shadowRetentionDays = Math.max(1, Math.min(3650, Math.round(Number(migrated.shadowRetentionDays) || DEFAULT_SETTINGS.shadowRetentionDays)));
  migrated.shadowSampleLimit = Math.max(1, Math.min(5000, Math.round(Number(migrated.shadowSampleLimit) || DEFAULT_SETTINGS.shadowSampleLimit)));
  migrated.shadowCohortSeed = String(migrated.shadowCohortSeed || DEFAULT_SETTINGS.shadowCohortSeed).slice(0, 80);
  migrated.shadowStoreFileName = DEFAULT_SETTINGS.shadowStoreFileName;
  migrated.semanticConsent = source.semanticConsent === true;
  migrated.semanticEnabled = source.semanticEnabled === true && migrated.semanticConsent;
  migrated.semanticMode = 'shadow';
  // Qwen uses a fixed supported contract. Archive any former hidden routing
  // values before applying it so migration/save is lossless and reversible.
  const legacyEmbedding = Object.assign({}, source.hiddenLegacyEmbedding || {});
  for (const key of ['embeddingProvider', 'embeddingProtocol', 'embeddingEndpoint', 'embeddingModel', 'embeddingDimensions']) {
    if (Object.hasOwn(source, key) && source[key] !== DEFAULT_SETTINGS[key]) legacyEmbedding[key] = source[key];
  }
  if (Object.keys(legacyEmbedding).length) migrated.hiddenLegacyEmbedding = legacyEmbedding;
  migrated.embeddingProvider = DEFAULT_SETTINGS.embeddingProvider;
  migrated.embeddingProtocol = DEFAULT_SETTINGS.embeddingProtocol;
  migrated.embeddingEndpoint = DEFAULT_SETTINGS.embeddingEndpoint;
  migrated.embeddingModel = DEFAULT_SETTINGS.embeddingModel;
  migrated.embeddingApiKey = String(migrated.embeddingApiKey || '').trim();
  migrated.embeddingApiKeyEnv = /^[A-Z_][A-Z0-9_]{0,79}$/.test(String(migrated.embeddingApiKeyEnv || ''))
    ? String(migrated.embeddingApiKeyEnv) : DEFAULT_SETTINGS.embeddingApiKeyEnv;
  migrated.embeddingDimensions = DEFAULT_SETTINGS.embeddingDimensions;
  migrated.embeddingTimeoutMs = Math.max(1000, Math.min(300000, Math.round(Number(migrated.embeddingTimeoutMs) || DEFAULT_SETTINGS.embeddingTimeoutMs)));
  migrated.embeddingMaxAttempts = Math.max(1, Math.min(5, Math.round(Number(migrated.embeddingMaxAttempts) || DEFAULT_SETTINGS.embeddingMaxAttempts)));
  migrated.embeddingRetryBaseMs = Math.max(100, Math.min(10000, Math.round(Number(migrated.embeddingRetryBaseMs) || DEFAULT_SETTINGS.embeddingRetryBaseMs)));
  migrated.embeddingRateLimitMs = Math.max(0, Math.min(60000, Math.round(Number(migrated.embeddingRateLimitMs) || DEFAULT_SETTINGS.embeddingRateLimitMs)));
  migrated.embeddingBatchSize = Math.max(1, Math.min(20, Math.round(Number(migrated.embeddingBatchSize) || DEFAULT_SETTINGS.embeddingBatchSize)));
  migrated.embeddingConcurrency = Math.max(1, Math.min(4, Math.round(Number(migrated.embeddingConcurrency) || DEFAULT_SETTINGS.embeddingConcurrency)));
  migrated.semanticRelatedThreshold = Math.max(0.5, Math.min(1, Number(migrated.semanticRelatedThreshold) || DEFAULT_SETTINGS.semanticRelatedThreshold));
  migrated.semanticDuplicateThreshold = Math.max(migrated.semanticRelatedThreshold, Math.min(1, Number(migrated.semanticDuplicateThreshold) || DEFAULT_SETTINGS.semanticDuplicateThreshold));
  migrated.semanticMaxCandidates = Math.max(1, Math.min(5000, Math.round(Number(migrated.semanticMaxCandidates) || DEFAULT_SETTINGS.semanticMaxCandidates)));
  migrated.semanticTopK = Math.max(1, Math.min(50, Math.round(Number(migrated.semanticTopK) || DEFAULT_SETTINGS.semanticTopK)));
  return migrated;
}

const SOURCE_TYPE_BY_EXT = {
  '.md': 'md',
  '.txt': 'txt',
  '.pdf': 'pdf',
  '.doc': 'docx',
  '.docx': 'docx',
  '.ppt': 'pptx',
  '.pptx': 'pptx',
  '.xls': 'xlsx',
  '.xlsx': 'xlsx',
  '.eml': 'email',
  '.msg': 'outlook-msg',
  '.html': 'html',
  '.htm': 'html',
  '.png': 'image',
  '.jpg': 'image',
  '.jpeg': 'image',
  '.webp': 'image',
  '.gif': 'image',
  '.tif': 'image',
  '.tiff': 'image',
  '.mp4': 'video',
  '.mov': 'video',
  '.avi': 'video',
  '.mkv': 'video',
  '.mp3': 'audio',
  '.wav': 'audio',
  '.m4a': 'audio'
};

const PROCESSABLE_TYPES = new Set(['md', 'txt', 'pdf', 'docx', 'pptx', 'xlsx', 'email', 'outlook-msg', 'html', 'image']);

function normalizeVaultPath(filePath) {
  return String(filePath || '').replace(/\\/g, '/').replace(/^[A-Za-z]:\/+/, '').replace(/^\/+/, '').replace(/\/+/g, '/').replace(/\/+$/, '');
}

function vaultRelativePath(value, context = 'vault path') {
  const raw = String(value == null ? '' : value).trim();
  const slashed = raw.replace(/\\/g, '/');
  const hostAbsolute = slashed.startsWith('/')
    || /^[A-Za-z]:(?:\/|$)/.test(slashed)
    || /^(?:\/\/|[\\/]{2})(?:[?.](?:\/|$)|[^/])/.test(raw);
  if (!raw || hostAbsolute) {
    const error = new Error(`${context} 必须是 Obsidian vault 相对路径。`);
    error.code = 'VAULT_PATH_INVALID';
    error.details = { reason: !raw ? 'empty' : 'host_absolute_path', pathContext: context };
    throw error;
  }
  const normalized = slashed.replace(/\/+/g, '/').replace(/\/+$/, '').normalize('NFC');
  if (!normalized || /[\0-\x1f\x7f]/.test(normalized)
    || normalized.split('/').some((part) => !part || part === '.' || part === '..')) {
    const error = new Error(`${context} 含无效路径片段。`);
    error.code = 'VAULT_PATH_INVALID';
    error.details = { reason: 'unsafe_segment', pathContext: context };
    throw error;
  }
  return normalized;
}

function optionalVaultRelativePath(value) {
  if (value == null || String(value).trim() === '') return '';
  return vaultRelativePath(value, 'source path');
}

function normalizeConfiguredPath(value, fallback = '') {
  if (value == null) return vaultRelativePath(fallback, 'default configured path');
  const raw = String(value).trim();
  if (!raw) return '';
  return raw.replace(/\\/g, '/').replace(/\/+/g, '/').replace(/\/+$/, '').normalize('NFC');
}

function validateConfiguredPathSet(settings) {
  const keys = ['bidIntakePath', 'businessIntakePath', 'bidOutputPath', 'businessOutputPath', 'artifactsPath', 'draftPath', 'logPath', 'componentPackPath'];
  const errors = [];
  for (const key of keys) {
    const raw = String(settings[key] == null ? '' : settings[key]).trim();
    let normalized = '';
    try { normalized = vaultRelativePath(raw, `setting ${key}`); } catch (_) {}
    if (!normalized) {
      errors.push({ key, reason: 'invalid' });
    }
  }
  for (let i = 0; i < keys.length; i += 1) {
    for (let j = i + 1; j < keys.length; j += 1) {
      const a = normalizeVaultPath(settings[keys[i]]);
      const b = normalizeVaultPath(settings[keys[j]]);
      if (a && b && (a === b || a.startsWith(`${b}/`) || b.startsWith(`${a}/`))) {
        const allowed = new Set(['artifactsPath:draftPath', 'artifactsPath:logPath']);
        if (!allowed.has(`${keys[i]}:${keys[j]}`)) errors.push({ key: keys[j], otherKey: keys[i], reason: 'overlap' });
      }
    }
  }
  return errors;
}

// v1.1.2: 把 Buffer.from 的副作用收拢到一处。
// 当 input 是 null / undefined / 字符串数字时，行为统一：空缓冲区。
// 同时避免 ArrayBuffer/SharedArrayBuffer/Uint8Array 等非 Buffer 输入在
// multipart / uploadBody 等路径中产生 Buffer.from(... ) 期待 Buffer 的边界 bug。
function safeBufferFrom(input, encoding) {
  if (input == null) return Buffer.alloc(0);
  if (Buffer.isBuffer(input)) return encoding ? input.toString(encoding) : input;
  if (input instanceof ArrayBuffer) return Buffer.from(input);
  if (ArrayBuffer.isView(input)) return Buffer.from(input.buffer, input.byteOffset, input.byteLength);
  if (typeof input === 'string') return encoding ? Buffer.from(input, encoding) : Buffer.from(input, 'utf8');
  try { return Buffer.from(String(input), 'utf8'); } catch { return Buffer.alloc(0); }
}


function detectSourceType(filePath) {
  const ext = path.extname(String(filePath || '')).toLowerCase();
  return SOURCE_TYPE_BY_EXT[ext] || 'unknown';
}

function isProcessableSource(filePath) {
  return PROCESSABLE_TYPES.has(detectSourceType(filePath));
}

function sourceHash(buffer) {
  return crypto.createHash('sha256').update(buffer || Buffer.alloc(0)).digest('hex');
}

function buildTaskFromFile(sourcePath, buffer, now = new Date()) {
  const normalized = normalizeVaultPath(sourcePath);
  const hash = sourceHash(buffer);
  const time = now.toISOString();
  return {
    taskId: `slicer-${hash.slice(0, 12)}`,
    sourcePath: normalized,
    sourceHash: hash,
    sourceType: detectSourceType(normalized),
    status: isProcessableSource(normalized) ? 'queued' : futureMediaStatus(normalized),
    createdAt: time,
    updatedAt: time,
    draftFiles: [],
    errors: []
  };
}

function futureMediaStatus(filePath) {
  const sourceType = detectSourceType(filePath);
  if (sourceType === 'video' || sourceType === 'audio') return 'unsupported_media';
  if (sourceType === 'outlook-msg') return 'queued';
  return 'skipped';
}

function statusCounts(tasks) {
  const counts = {
    total: tasks.length,
    pending: 0,
    processing: 0,
    needsReview: 0,
    failed: 0,
    written: 0,
    skipped: 0,
    rolledBack: 0
  };
  for (const task of tasks) {
    if (task.status === 'queued' || task.status === 'discovered') counts.pending += 1;
    if (PROCESSING_STATUSES.has(task.status)) counts.processing += 1;
    if (task.status === 'needs_review' && task.artifacts?.review) counts.needsReview += Number(task.result_counts?.review)
      || (Array.isArray(task.review_atom_ids) ? task.review_atom_ids.length : 0);
    if (task.status === 'failed') counts.failed += 1;
    if (task.status === 'rolled_back') counts.rolledBack += 1;
    else counts.written += deriveVerifiedFacts(task).count;
    if (task.status === 'skipped' || task.status === 'unsupported' || task.status === 'unsupported_media' || task.status === 'needs_ocr') counts.skipped += 1;
  }
  return counts;
}

function tasksPath(settings = DEFAULT_SETTINGS) {
  return normalizeVaultPath(`${settings.logPath}/${settings.tasksFileName || 'tasks.json'}`);
}

function rollbackPath(settings = DEFAULT_SETTINGS) {
  return normalizeVaultPath(`${settings.logPath}/${settings.rollbackFileName || 'rollback.json'}`);
}

module.exports = {
  DEFAULT_SETTINGS,
  buildTaskFromFile,
  detectSourceType,
  futureMediaStatus,
  isProcessableSource,
  migrateSettings,
  normalizeConfiguredPath,
  normalizeVaultPath,
  optionalVaultRelativePath,
  rollbackPath,
  sourceHash,
  statusCounts,
  TASK_STATUSES,
  PROCESSING_STATUSES,
  validateConfiguredPathSet,
  vaultRelativePath,
  tasksPath
};

},
/**
 * @module src/core/tags
 * 标签库解析 / Map_Index 建议 / 卡片字段校验
 * @exports parseTagLibrary
 * @exports suggestMapIndex
 * @exports validateCard
 */
"src/core/tags.js": function(require, module, exports) {
function emptyLibrary() {
  return {
    all: new Set(),
    categories: new Set(),
    tagL1: new Set(),
    tagL2: new Set(),
    eventTypes: new Set(),
    infoTypes: new Set(),
    statuses: new Set(),
    mapByCategory: new Map(),
    mapByTriplet: new Map()
  };
}

function parseTagLibrary(markdown) {
  const library = emptyLibrary();
  const tagPattern = /`(#[a-zA-Z0-9/_-]+)`/g;
  const mapPattern = /`\[\[([^`\]]+)\]\]`|\[\[([^\]]+)\]\]/;
  for (const line of String(markdown || '').split(/\r?\n/)) {
    const tags = [...line.matchAll(tagPattern)].map((match) => match[1]);
    if (tags.length === 0) continue;
    const mapMatch = line.match(mapPattern);
    const mapIndex = mapMatch ? `[[${mapMatch[1] || mapMatch[2]}]]` : '';
    for (const tag of tags) {
      library.all.add(tag);
      if (tag.startsWith('#cat/') || tag.startsWith('#domain/')) {
        library.categories.add(tag);
        if (mapIndex) library.mapByCategory.set(tag, mapIndex);
      }
      if (tag.startsWith('#l1/')) library.tagL1.add(tag);
      if (tag.startsWith('#l2/')) library.tagL2.add(tag);
      if (tag.startsWith('#event/') || tag.startsWith('#type/')) library.eventTypes.add(tag);
      if (tag.startsWith('#info/')) library.infoTypes.add(tag);
      if (tag.startsWith('#status/')) library.statuses.add(tag);
    }
    if (tags.length >= 3 && mapIndex) {
      library.mapByTriplet.set(tripletKey(tags[0], tags[1], tags[2]), mapIndex);
    }
  }
  seedFallbacks(library);
  return library;
}

function seedFallbacks(library) {
  const defaults = {
    categories: ['#cat/general-knowledge', '#cat/design', '#cat/quality'],
    tagL1: ['#l1/document-control', '#l1/hvac', '#l1/ncr-defect'],
    tagL2: ['#l2/requirement', '#l2/value-engineering', '#l2/corrective-action'],
    eventTypes: ['#event/meeting', '#event/decision', '#event/issue', '#event/nonconformance'],
    infoTypes: ['#info/spec', '#info/requirement', '#info/method'],
    statuses: ['#status/pending_review', '#status/needs_fix', '#status/approved', '#status/uncategorized']
  };
  for (const [field, tags] of Object.entries(defaults)) {
    if (library[field].size) continue;
    for (const tag of tags) {
      library[field].add(tag);
      library.all.add(tag);
    }
  }
  if (!library.mapByCategory.has('#cat/general-knowledge')) {
    library.mapByCategory.set('#cat/general-knowledge', '[[MOC_通用知识库]]');
  }
  if (!library.mapByCategory.has('#cat/design')) {
    library.mapByCategory.set('#cat/design', '[[MOC_设计管理]]');
  }
  if (!library.mapByCategory.has('#cat/quality')) {
    library.mapByCategory.set('#cat/quality', '[[MOC_质量管理]]');
  }
  const domainMaps = {
    '#domain/arch': '[[MOC_建筑工程]]',
    '#domain/struct': '[[MOC_结构工程]]',
    '#domain/process': '[[MOC_工艺生产线]]',
    '#domain/hvac': '[[MOC_暖通空调]]',
    '#domain/elec': '[[MOC_电气工程]]',
    '#domain/plumb': '[[MOC_给排水]]',
    '#domain/cost': '[[MOC_成本与VECD优化]]',
    '#domain/safe': '[[MOC_安全与合规]]'
  };
  for (const [tag, moc] of Object.entries(domainMaps)) {
    if (library.categories.has(tag) && !library.mapByCategory.has(tag)) {
      library.mapByCategory.set(tag, moc);
    }
  }
}

function tripletKey(category, tagL1, tagL2) {
  return `${category}|${tagL1}|${tagL2}`;
}

function suggestMapIndex(library, category, tagL1, tagL2) {
  return library.mapByTriplet.get(tripletKey(category, tagL1, tagL2))
    || library.mapByCategory.get(category)
    || '[[MOC_待分类]]';
}

function validateCard(library, card) {
  const errors = [];
  requireInSet(errors, library.categories, card.Category, 'Category');
  requireInSet(errors, library.tagL1, card.TagL1, 'TagL1');
  requireInSet(errors, library.tagL2, card.TagL2, 'TagL2');
  requireInSet(errors, library.statuses, card.Status, 'Status');

  if (card.Card_Type === 'event') {
    requireInSet(errors, library.eventTypes, card.Event_Type, 'Event_Type');
  } else if (card.Card_Type === 'info') {
    requireInSet(errors, library.infoTypes, card.Info_Type, 'Info_Type');
  } else {
    errors.push(`Card_Type must be event or info: ${card.Card_Type || ''}`);
  }

  for (const field of ['Source_File', 'Source_Path', 'Source_Hash']) {
    if (!card[field]) errors.push(`${field} is required`);
  }
  if (typeof card.Confidence !== 'number') errors.push('Confidence must be a number');

  return { valid: errors.length === 0, errors };
}

function requireInSet(errors, set, value, label) {
  if (!value || !set.has(value)) errors.push(`${label} is not in Tag Library: ${value || ''}`);
}

module.exports = {
  parseTagLibrary,
  suggestMapIndex,
  validateCard
};

},
/**
 * @module src/core/local-ocr.js
 */
"src/core/local-ocr.js": function(require, module, exports) {
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const CONTRACT_VERSION = 'local_ocr_v1';
const DEFAULT_LIMITS = Object.freeze({
  maxPages: 500,
  maxPageBytes: 24 * 1024 * 1024,
  maxAggregateBytes: 256 * 1024 * 1024,
  maxPixelsPerPage: 40 * 1000 * 1000,
  maxAggregatePixels: 400 * 1000 * 1000,
  maxTextCharsPerPage: 250000,
  maxAggregateTextChars: 2 * 1000 * 1000
});

class LocalOcrError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'LocalOcrError';
    this.code = code;
    this.category = 'local_ocr';
    this.retryable = ['OCR_UNAVAILABLE', 'OCR_RENDER_FAILURE', 'OCR_TIMEOUT'].includes(code);
    this.page = Number(details.page) || undefined;
    this.metrics = details.metrics || undefined;
    if (details.cause) this.cause = details.cause;
  }
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function normalizeSettings(input = {}) {
  const limits = Object.assign({}, DEFAULT_LIMITS, input.limits || {});
  return {
    enabled: input.enabled === true,
    provider: ['auto', 'tesseract', 'executable'].includes(input.provider) ? input.provider : 'auto',
    executable: String(input.executable || '').trim(),
    languages: String(input.languages || 'chi_sim+eng').trim().replace(/[^A-Za-z0-9_+.-]/g, ''),
    concurrency: clampInt(input.concurrency, 1, 4, 2),
    timeoutMs: clampInt(input.timeoutMs, 1000, 600000, 120000),
    qualityThreshold: clampNumber(input.qualityThreshold, 0, 1, 0.72),
    dpi: clampInt(input.dpi, 72, 400, 200),
    limits: {
      maxPages: clampInt(limits.maxPages, 1, 5000, DEFAULT_LIMITS.maxPages),
      maxPageBytes: clampInt(limits.maxPageBytes, 1024, 256 * 1024 * 1024, DEFAULT_LIMITS.maxPageBytes),
      maxAggregateBytes: clampInt(limits.maxAggregateBytes, 1024, 1024 * 1024 * 1024, DEFAULT_LIMITS.maxAggregateBytes),
      maxPixelsPerPage: clampInt(limits.maxPixelsPerPage, 10000, 200 * 1000 * 1000, DEFAULT_LIMITS.maxPixelsPerPage),
      maxAggregatePixels: clampInt(limits.maxAggregatePixels, 10000, 1000 * 1000 * 1000, DEFAULT_LIMITS.maxAggregatePixels),
      maxTextCharsPerPage: clampInt(limits.maxTextCharsPerPage, 1, 2 * 1000 * 1000, DEFAULT_LIMITS.maxTextCharsPerPage),
      maxAggregateTextChars: clampInt(limits.maxAggregateTextChars, 1, 10 * 1000 * 1000, DEFAULT_LIMITS.maxAggregateTextChars)
    }
  };
}

function settingsFingerprint(settings) {
  const safe = normalizeSettings(settings);
  return sha256(stableJson({
    contract: CONTRACT_VERSION,
    provider: safe.provider,
    executable: safe.executable ? path.basename(safe.executable) : '',
    languages: safe.languages,
    qualityThreshold: safe.qualityThreshold,
    dpi: safe.dpi,
    limits: safe.limits
  }));
}

async function probeLocalOcr(settings = {}, dependencies = {}) {
  const config = normalizeSettings(settings);
  if (!config.enabled) return unavailable('disabled', config);
  const candidates = config.provider === 'auto' ? ['tesseract', 'executable'] : [config.provider];
  for (const provider of candidates) {
    if (provider === 'tesseract') {
      const executable = await resolveExecutable(dependencies.tesseractExecutable || 'tesseract', dependencies);
      if (executable) {
        const version = await probeVersion(executable, ['--version'], config.timeoutMs, dependencies);
        if (version.available) return available('tesseract', executable, version.version, config);
      }
    }
    if (provider === 'executable' && config.executable) {
      if (!path.isAbsolute(config.executable)) continue;
      const executable = await resolveExecutable(config.executable, dependencies);
      if (executable) {
        const version = await probeVersion(executable, ['--version'], config.timeoutMs, dependencies);
        if (version.available) return available('executable', executable, version.version, config);
      }
    }
  }
  return unavailable(config.executable ? 'probe_failed' : 'not_configured', config);
}

async function runLocalPdfOcr(input = {}, dependencies = {}) {
  const config = normalizeSettings(input.settings);
  const metrics = {
    pages_total: 0, pages_requested: 0, pages_completed: 0, pages_skipped_native: 0,
    pages_skipped_blank: 0, cache_hits: 0, cache_misses: 0, bytes_rendered: 0,
    pixels_rendered: 0, text_characters: 0, low_confidence_pages: 0, low_confidence_blocks: 0
  };
  checkAbort(input.signal, metrics);
  const probe = input.probe || await probeLocalOcr(config, dependencies);
  if (!probe.available) throw new LocalOcrError('OCR_UNAVAILABLE', '本地 OCR 未启用、未配置或不可用。', { metrics });
  const pages = [...(input.pages || [])].sort((a, b) => Number(a.page) - Number(b.page));
  metrics.pages_total = pages.length;
  if (pages.length > config.limits.maxPages) throw limitError('PDF 页数超过本地 OCR 限制。', metrics);
  const targets = [];
  for (const page of pages) {
    if (page.classification === 'native') metrics.pages_skipped_native += 1;
    else if (page.classification === 'blank') metrics.pages_skipped_blank += 1;
    else if (page.classification === 'scanned' || page.classification === 'mixed') targets.push(page);
  }
  metrics.pages_requested = targets.length;
  const providerVersion = String(probe.version || 'unknown').slice(0, 200);
  const fingerprint = settingsFingerprint(config);
  const sourceHash = String(input.sourceHash || '');
  const results = new Array(targets.length);
  let next = 0;
  let stopped = false;
  const tempRoot = await fs.promises.mkdtemp(path.join(dependencies.tempRoot || os.tmpdir(), 'eks-local-ocr-'));
  try {
    async function worker() {
      while (!stopped) {
        checkAbort(input.signal, metrics);
        const index = next++;
        if (index >= targets.length) return;
        const page = targets[index];
        const cacheKey = checkpointKey(sourceHash, page.page, probe.provider, providerVersion, fingerprint);
        let cached = null;
        if (typeof input.loadCheckpoint === 'function') {
          try { cached = await input.loadCheckpoint(cacheKey, page.page); } catch (_) { cached = null; }
        }
        if (validCheckpoint(cached, { cacheKey, sourceHash, page: page.page, providerVersion, fingerprint, limits: config.limits })) {
          metrics.cache_hits += 1;
          results[index] = cached.result;
          addResultMetrics(metrics, cached.result);
          continue;
        }
        metrics.cache_misses += 1;
        const pageResult = await processPage({
          pdfBuffer: input.pdfBuffer, page, probe, config, tempRoot, signal: input.signal, metrics
        }, dependencies);
        results[index] = pageResult;
        addResultMetrics(metrics, pageResult);
        if (typeof input.saveCheckpoint === 'function') {
          await input.saveCheckpoint(cacheKey, {
            contract: CONTRACT_VERSION, cacheKey, sourceHash, page: page.page,
            provider: probe.provider, providerVersion, settingsFingerprint: fingerprint,
            result: pageResult
          }, page.page);
        }
      }
    }
    await Promise.all(Array.from({ length: Math.min(config.concurrency, Math.max(1, targets.length)) }, worker));
  } catch (error) {
    stopped = true;
    if (error instanceof LocalOcrError) throw error;
    throw new LocalOcrError('OCR_MALFORMED_OUTPUT', '本地 OCR 返回无法处理的结果。', { cause: error, metrics });
  } finally {
    await fs.promises.rm(tempRoot, { recursive: true, force: true }).catch(() => {});
  }
  checkAbort(input.signal, metrics);
  return {
    status: 'ok', contract: CONTRACT_VERSION, provider: probe.provider,
    providerVersion, settingsFingerprint: fingerprint, pages: results, metrics
  };
}

async function processPage(context, dependencies) {
  const { page, config, tempRoot, signal, metrics } = context;
  checkAbort(signal, metrics);
  const rendered = typeof dependencies.renderPage === 'function'
    ? await dependencies.renderPage(context)
    : await renderPdfPage(context, dependencies);
  checkAbort(signal, metrics);
  validateRendered(rendered, config.limits, metrics, page.page);
  metrics.bytes_rendered += rendered.bytes;
  metrics.pixels_rendered += rendered.width * rendered.height;
  if (metrics.bytes_rendered > config.limits.maxAggregateBytes || metrics.pixels_rendered > config.limits.maxAggregatePixels) {
    throw limitError('本地 OCR 累计渲染限制已超出。', metrics, page.page);
  }
  let raw;
  if (typeof dependencies.recognizePage === 'function') raw = await dependencies.recognizePage(Object.assign({}, context, { rendered }));
  else raw = await recognizePage(Object.assign({}, context, { rendered }), dependencies);
  checkAbort(signal, metrics);
  const normalized = normalizeOcrResult(raw, page, config);
  if (normalized.text.length > config.limits.maxTextCharsPerPage) throw limitError('单页 OCR 文本超过限制。', metrics, page.page);
  if (metrics.text_characters + normalized.text.length > config.limits.maxAggregateTextChars) throw limitError('OCR 累计文本超过限制。', metrics, page.page);
  return normalized;
}

async function renderPdfPage(context, dependencies) {
  const { pdfBuffer, page, config, tempRoot, signal, metrics } = context;
  if (!Buffer.isBuffer(pdfBuffer)) throw new LocalOcrError('OCR_RENDER_FAILURE', '缺少 PDF 二进制输入。', { page: page.page, metrics });
  const pdfPath = path.join(tempRoot, 'source.pdf');
  try { await fs.promises.access(pdfPath); } catch { await fs.promises.writeFile(pdfPath, pdfBuffer, { mode: 0o600 }); }
  const renderer = await resolveExecutable(dependencies.rendererExecutable || 'pdftoppm', dependencies);
  if (!renderer) throw new LocalOcrError('OCR_RENDER_FAILURE', '未找到本地 PDF 渲染器 pdftoppm。', { page: page.page, metrics });
  const prefix = path.join(tempRoot, `page-${page.page}`);
  await spawnCaptured(renderer, ['-f', String(page.page), '-l', String(page.page), '-singlefile', '-r', String(config.dpi), '-png', pdfPath, prefix], {
    signal, timeoutMs: config.timeoutMs, maxOutputBytes: 64 * 1024, dependencies
  }, 'OCR_RENDER_FAILURE', page.page, metrics);
  const imagePath = `${prefix}.png`;
  const stat = await fs.promises.stat(imagePath).catch(() => null);
  if (!stat || !stat.isFile()) throw new LocalOcrError('OCR_RENDER_FAILURE', 'PDF 渲染器未生成页面图像。', { page: page.page, metrics });
  const dimensions = readPngDimensions(await fs.promises.readFile(imagePath, { encoding: null, flag: 'r' }));
  return { path: imagePath, bytes: stat.size, width: dimensions.width, height: dimensions.height };
}

async function recognizePage(context, dependencies) {
  const { probe, rendered, page, config, signal, metrics } = context;
  if (probe.provider === 'tesseract') {
    const output = await spawnCaptured(probe.executable, [rendered.path, 'stdout', '-l', config.languages, 'tsv'], {
      signal, timeoutMs: config.timeoutMs, maxOutputBytes: config.limits.maxTextCharsPerPage * 8, dependencies
    }, 'OCR_TIMEOUT', page.page, metrics);
    return parseTesseractTsv(output.stdout, config.languages);
  }
  const output = await spawnCaptured(probe.executable, [
    '--input', rendered.path, '--page', String(page.page), '--languages', config.languages, '--format', 'json'
  ], {
    signal, timeoutMs: config.timeoutMs, maxOutputBytes: config.limits.maxTextCharsPerPage * 8, dependencies
  }, 'OCR_TIMEOUT', page.page, metrics);
  try { return JSON.parse(output.stdout); } catch (cause) {
    throw new LocalOcrError('OCR_MALFORMED_OUTPUT', '本地 OCR 可执行程序未返回有效 JSON。', { page: page.page, cause, metrics });
  }
}

function normalizeOcrResult(raw, page, config) {
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.blocks)) {
    throw new LocalOcrError('OCR_MALFORMED_OUTPUT', '本地 OCR 结果缺少 blocks 数组。', { page: page.page });
  }
  const blocks = raw.blocks.map((block, index) => {
    const text = String(block.text || '').trim();
    const confidence = clampNumber(block.confidence, 0, 1, 0);
    const bbox = validBbox(block.bbox) ? block.bbox.map(Number) : null;
    const visualType = normalizeVisualType(block.visual_type || block.kind);
    const eligible = !!text && confidence >= config.qualityThreshold && !visualType;
    return {
      text, confidence, bbox, language: String(block.language || raw.language || config.languages || 'unknown').slice(0, 64),
      locator: {
        scheme: 'pdf-quote', value: `page:${page.page}:ocr:${index + 1}`,
        page: Number(page.page), bbox, rotation: normalizeRotation(page.rotation),
        image_locator: page.image_locators?.[0] || null,
        quote_hash: sha256(text)
      },
      raw_fields: block.raw_fields && typeof block.raw_fields === 'object' ? block.raw_fields : {},
      inferred: block.inferred && typeof block.inferred === 'object' ? block.inferred : {},
      visual_type: visualType,
      card_eligible: eligible,
      exclusion_reason: visualType ? `unverified_${visualType}` : (!text ? 'empty_ocr' : (confidence < config.qualityThreshold ? 'low_confidence_ocr' : null))
    };
  });
  const text = blocks.filter((block) => block.text).map((block) => block.text).join('\n');
  const confidence = blocks.length ? blocks.reduce((sum, block) => sum + block.confidence, 0) / blocks.length : 0;
  return {
    page: Number(page.page), classification: page.classification, rotation: normalizeRotation(page.rotation),
    text, confidence: Number(confidence.toFixed(6)), language: String(raw.language || config.languages || 'unknown').slice(0, 64),
    blocks, image_locators: page.image_locators || [],
    status: text ? (confidence >= config.qualityThreshold ? 'ok' : 'low_confidence') : 'empty'
  };
}

function parseTesseractTsv(tsv, language) {
  const lines = String(tsv || '').split(/\r?\n/);
  if (!/^level\tpage_num\tblock_num/.test(lines[0] || '')) throw new LocalOcrError('OCR_MALFORMED_OUTPUT', 'Tesseract TSV 头无效。');
  const blocks = [];
  for (const line of lines.slice(1)) {
    const cols = line.split('\t');
    if (cols.length < 12 || cols[0] !== '5') continue;
    const text = cols.slice(11).join('\t').trim();
    if (!text) continue;
    const left = Number(cols[6]); const top = Number(cols[7]); const width = Number(cols[8]); const height = Number(cols[9]);
    const rawConfidence = Number(cols[10]);
    blocks.push({ text, confidence: rawConfidence < 0 ? 0 : rawConfidence / 100, bbox: [left, top, left + width, top + height], language });
  }
  return { language, blocks };
}

function validCheckpoint(value, expected) {
  if (!value || value.contract !== CONTRACT_VERSION || value.cacheKey !== expected.cacheKey ||
      value.sourceHash !== expected.sourceHash || Number(value.page) !== Number(expected.page) ||
      value.providerVersion !== expected.providerVersion || value.settingsFingerprint !== expected.fingerprint) return false;
  try {
    const result = value.result;
    if (!result || Number(result.page) !== Number(expected.page) || !Array.isArray(result.blocks) || typeof result.text !== 'string') return false;
    if (result.text.length > expected.limits.maxTextCharsPerPage) return false;
    return result.blocks.every((block) => typeof block.text === 'string' && Number.isFinite(block.confidence) && block.confidence >= 0 && block.confidence <= 1);
  } catch { return false; }
}

function checkpointKey(sourceHash, page, provider, providerVersion, fingerprint) {
  return `ocr-page-${sha256(`${sourceHash}\0${page}\0${provider}\0${providerVersion}\0${fingerprint}`).slice(0, 32)}`;
}

async function spawnCaptured(executable, args, options, failureCode, page, metrics) {
  if (!path.isAbsolute(executable)) throw new LocalOcrError('OCR_UNAVAILABLE', 'OCR 可执行文件必须解析为绝对路径。', { page, metrics });
  const spawnImpl = options.dependencies.spawn || spawn;
  return new Promise((resolve, reject) => {
    let settled = false; let stdout = ''; let stderr = ''; let outputBytes = 0; let timedOut = false;
    const child = spawnImpl(executable, args, { shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    const finish = (error, result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', onAbort);
      if (error) reject(error); else resolve(result);
    };
    const stop = () => { try { child.kill('SIGKILL'); } catch (_) {} };
    const onAbort = () => {
      stop();
      finish(new LocalOcrError('OCR_CANCELLED', '本地 OCR 已取消。', { page, metrics }));
    };
    const timer = setTimeout(() => {
      timedOut = true; stop();
      finish(new LocalOcrError('OCR_TIMEOUT', '本地 OCR 执行超时。', { page, metrics }));
    }, options.timeoutMs);
    options.signal?.addEventListener('abort', onAbort, { once: true });
    for (const [stream, append] of [[child.stdout, (s) => { stdout += s; }], [child.stderr, (s) => { stderr += s; }]]) {
      stream?.on('data', (chunk) => {
        outputBytes += chunk.length;
        if (outputBytes > options.maxOutputBytes) {
          stop();
          finish(limitError('OCR 子进程输出超过限制。', metrics, page));
        } else append(chunk.toString('utf8'));
      });
    }
    child.on('error', (cause) => finish(new LocalOcrError(failureCode, '本地 OCR 子进程启动失败。', { page, cause, metrics })));
    child.on('close', (code) => {
      if (timedOut || settled) return;
      if (code !== 0) finish(new LocalOcrError(failureCode, `本地 OCR 子进程失败（退出码 ${Number(code)}）。`, { page, metrics }));
      else finish(null, { stdout, stderr: stderr.slice(0, 1024), code });
    });
  });
}

async function resolveExecutable(command, dependencies = {}) {
  if (typeof dependencies.resolveExecutable === 'function') return dependencies.resolveExecutable(command);
  const value = String(command || '');
  if (!value || /[\0\r\n]/.test(value)) return null;
  if (path.isAbsolute(value)) return validateExecutable(value);
  if (value.includes('/') || value.includes('\\')) return null;
  for (const directory of String(process.env.PATH || '').split(path.delimiter)) {
    if (!directory) continue;
    const candidate = path.resolve(directory, value);
    if (await validateExecutable(candidate)) return candidate;
  }
  return null;
}

async function validateExecutable(candidate) {
  try {
    const stat = await fs.promises.stat(candidate);
    if (!stat.isFile()) return null;
    await fs.promises.access(candidate, fs.constants.X_OK);
    return await fs.promises.realpath(candidate);
  } catch { return null; }
}

async function probeVersion(executable, args, timeoutMs, dependencies) {
  try {
    const result = await spawnCaptured(executable, args, {
      timeoutMs: Math.min(timeoutMs, 10000), maxOutputBytes: 64 * 1024, dependencies
    }, 'OCR_UNAVAILABLE');
    const version = `${result.stdout}\n${result.stderr}`.trim().split(/\r?\n/)[0] || path.basename(executable);
    return { available: true, version: version.slice(0, 200) };
  } catch { return { available: false, version: '' }; }
}

function readPngDimensions(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 24 || buffer.subarray(1, 4).toString() !== 'PNG') {
    throw new LocalOcrError('OCR_RENDER_FAILURE', '渲染图像不是有效 PNG。');
  }
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

function validateRendered(rendered, limits, metrics, page) {
  if (!rendered || !rendered.path || !Number.isFinite(rendered.bytes) || !Number.isFinite(rendered.width) || !Number.isFinite(rendered.height)) {
    throw new LocalOcrError('OCR_RENDER_FAILURE', '渲染结果字段不完整。', { page, metrics });
  }
  const pixels = rendered.width * rendered.height;
  if (rendered.bytes > limits.maxPageBytes || pixels > limits.maxPixelsPerPage) throw limitError('单页 OCR 渲染限制已超出。', metrics, page);
}

function addResultMetrics(metrics, result) {
  metrics.pages_completed += 1;
  metrics.text_characters += result.text.length;
  if (result.status === 'low_confidence') metrics.low_confidence_pages += 1;
  metrics.low_confidence_blocks += result.blocks.filter((block) => block.exclusion_reason === 'low_confidence_ocr').length;
}

function checkAbort(signal, metrics) {
  if (signal?.aborted) throw new LocalOcrError('OCR_CANCELLED', '本地 OCR 已取消。', { metrics });
}

function limitError(message, metrics, page) {
  return new LocalOcrError('OCR_LIMITS_EXCEEDED', message, { metrics, page });
}

function available(provider, executable, version, settings) {
  return { available: true, contract: CONTRACT_VERSION, provider, executable, version, settingsFingerprint: settingsFingerprint(settings) };
}

function unavailable(reason, settings) {
  return { available: false, contract: CONTRACT_VERSION, provider: settings.provider, reason, settingsFingerprint: settingsFingerprint(settings) };
}

function normalizeVisualType(value) {
  const text = String(value || '').toLowerCase();
  if (/stamp|seal|印章|盖章/.test(text)) return 'stamp';
  if (/signature|签名|签字/.test(text)) return 'signature';
  if (/approval|批准|审批/.test(text)) return 'approval_visual';
  return '';
}

function normalizeRotation(value) {
  const rotation = Number(value) || 0;
  return ((rotation % 360) + 360) % 360;
}

function validBbox(value) {
  return Array.isArray(value) && value.length === 4 && value.every((item) => Number.isFinite(Number(item)));
}

function clampInt(value, min, max, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(min, Math.min(max, Math.round(n))) : fallback;
}

function clampNumber(value, min, max, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fallback;
}

module.exports = {
  CONTRACT_VERSION, DEFAULT_LIMITS, LocalOcrError, checkpointKey, normalizeOcrResult,
  normalizeSettings, parseTesseractTsv, probeLocalOcr, runLocalPdfOcr,
  settingsFingerprint, validCheckpoint
};

},
/**
 * @module src/core/ooxml.js
 */
"src/core/ooxml.js": function(require, module, exports) {
'use strict';

const crypto = require('crypto');
const zlib = require('zlib');
const { createBlock, blocksToMarkdown } = require('src/core/block-v0.js');

const DEFAULT_LIMITS = Object.freeze({
  maxFileBytes: 256 * 1024 * 1024,
  maxEntries: 4096,
  maxCompressedBytes: 256 * 1024 * 1024,
  maxUncompressedBytes: 768 * 1024 * 1024,
  maxEntryBytes: 128 * 1024 * 1024,
  maxCompressionRatio: 200,
  maxXmlBytes: 64 * 1024 * 1024,
  maxXmlDepth: 128,
  maxTextChars: 8 * 1024 * 1024
});

class OoxmlError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'OoxmlError';
    this.code = code;
    this.details = details;
  }
}

function fail(code, message, details) { throw new OoxmlError(code, message, details); }
function checkAbort(signal) {
  if (signal?.aborted) fail('OOXML_ABORTED', 'OOXML parsing was aborted');
}
function limits(input = {}) {
  const out = {};
  for (const [key, fallback] of Object.entries(DEFAULT_LIMITS)) {
    const value = Number(input[key]);
    out[key] = Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
  }
  return out;
}
function safePath(name) {
  const value = String(name || '').replace(/\\/g, '/');
  if (!value || value.startsWith('/') || /^[A-Za-z]:/.test(value) || value.split('/').includes('..') || value.includes('\0')) {
    fail('OOXML_PATH_TRAVERSAL', 'Unsafe ZIP entry path', { entry: value.slice(0, 200) });
  }
  return value.replace(/^\/+/, '');
}

class SafeZip {
  constructor(buffer, options = {}) {
    this.buffer = Buffer.from(buffer || []);
    this.limits = limits(options.limits);
    this.signal = options.signal;
    this.metrics = { entries: 0, compressed_bytes: 0, declared_uncompressed_bytes: 0, inflated_bytes: 0 };
    checkAbort(this.signal);
    if (this.buffer.length > this.limits.maxFileBytes) fail('OOXML_LIMIT_EXCEEDED', 'OOXML file exceeds byte limit');
    if (this.buffer.length < 22 || this.buffer.readUInt32LE(0) !== 0x04034b50) fail('OOXML_INVALID_ZIP', 'Missing ZIP local header');
    this.entries = this.readDirectory();
  }
  readDirectory() {
    const start = Math.max(0, this.buffer.length - 65557);
    let eocd = -1;
    for (let i = this.buffer.length - 22; i >= start; i -= 1) {
      if (this.buffer.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) fail('OOXML_INVALID_ZIP', 'Missing ZIP central directory');
    const disk = this.buffer.readUInt16LE(eocd + 4);
    const cdDisk = this.buffer.readUInt16LE(eocd + 6);
    const count = this.buffer.readUInt16LE(eocd + 10);
    const cdSize = this.buffer.readUInt32LE(eocd + 12);
    const cdOffset = this.buffer.readUInt32LE(eocd + 16);
    if (disk || cdDisk || count === 0xffff || cdOffset === 0xffffffff) fail('OOXML_UNSUPPORTED', 'Multi-disk or ZIP64 OOXML is unsupported');
    if (count > this.limits.maxEntries) fail('OOXML_LIMIT_EXCEEDED', 'ZIP entry count exceeds limit', { count });
    if (cdOffset + cdSize > eocd || cdOffset < 0) fail('OOXML_INVALID_ZIP', 'Central directory is out of bounds');
    const map = new Map();
    let pos = cdOffset;
    let compressedTotal = 0;
    let uncompressedTotal = 0;
    for (let index = 0; index < count; index += 1) {
      checkAbort(this.signal);
      if (pos + 46 > eocd || this.buffer.readUInt32LE(pos) !== 0x02014b50) fail('OOXML_INVALID_ZIP', 'Malformed central directory entry');
      const flags = this.buffer.readUInt16LE(pos + 8);
      const method = this.buffer.readUInt16LE(pos + 10);
      const crc = this.buffer.readUInt32LE(pos + 16);
      const compressed = this.buffer.readUInt32LE(pos + 20);
      const uncompressed = this.buffer.readUInt32LE(pos + 24);
      const nameLen = this.buffer.readUInt16LE(pos + 28);
      const extraLen = this.buffer.readUInt16LE(pos + 30);
      const commentLen = this.buffer.readUInt16LE(pos + 32);
      const localOffset = this.buffer.readUInt32LE(pos + 42);
      if (flags & 1) fail('OOXML_ENCRYPTED', 'Encrypted OOXML packages are unsupported');
      if (![0, 8].includes(method)) fail('OOXML_UNSUPPORTED', `ZIP compression method ${method} is unsupported`);
      if (compressed === 0xffffffff || uncompressed === 0xffffffff || localOffset === 0xffffffff) fail('OOXML_UNSUPPORTED', 'ZIP64 OOXML is unsupported');
      if (pos + 46 + nameLen + extraLen + commentLen > eocd) fail('OOXML_INVALID_ZIP', 'Central directory name is out of bounds');
      const name = safePath(this.buffer.subarray(pos + 46, pos + 46 + nameLen).toString((flags & 0x800) ? 'utf8' : 'latin1'));
      if (map.has(name)) fail('OOXML_INVALID_ZIP', 'Duplicate ZIP entry', { entry: name });
      compressedTotal += compressed; uncompressedTotal += uncompressed;
      if (compressedTotal > this.limits.maxCompressedBytes || uncompressedTotal > this.limits.maxUncompressedBytes ||
          uncompressed > this.limits.maxEntryBytes || (compressed > 0 && uncompressed / compressed > this.limits.maxCompressionRatio) ||
          (compressed === 0 && uncompressed > 0)) {
        fail('OOXML_LIMIT_EXCEEDED', 'ZIP decompression limits exceeded', { entry: name });
      }
      map.set(name, { name, flags, method, crc, compressed, uncompressed, localOffset });
      pos += 46 + nameLen + extraLen + commentLen;
    }
    this.metrics = { entries: count, compressed_bytes: compressedTotal, declared_uncompressed_bytes: uncompressedTotal, inflated_bytes: 0 };
    return map;
  }
  has(name) { return this.entries.has(name); }
  read(name, xml = false) {
    checkAbort(this.signal);
    const entry = this.entries.get(name);
    if (!entry) return null;
    const pos = entry.localOffset;
    if (pos + 30 > this.buffer.length || this.buffer.readUInt32LE(pos) !== 0x04034b50) fail('OOXML_INVALID_ZIP', 'Malformed ZIP local header', { entry: name });
    const nameLen = this.buffer.readUInt16LE(pos + 26);
    const extraLen = this.buffer.readUInt16LE(pos + 28);
    const localFlags = this.buffer.readUInt16LE(pos + 6);
    const localMethod = this.buffer.readUInt16LE(pos + 8);
    const localName = safePath(this.buffer.subarray(pos + 30, pos + 30 + nameLen).toString((localFlags & 0x800) ? 'utf8' : 'latin1'));
    if (localName !== name || localMethod !== entry.method || (localFlags & 1) !== (entry.flags & 1)) {
      fail('OOXML_INVALID_ZIP', 'ZIP local header disagrees with central directory', { entry: name });
    }
    const start = pos + 30 + nameLen + extraLen;
    const end = start + entry.compressed;
    if (end > this.buffer.length) fail('OOXML_INVALID_ZIP', 'ZIP entry data is out of bounds', { entry: name });
    let out;
    try {
      out = entry.method === 0 ? Buffer.from(this.buffer.subarray(start, end)) :
        zlib.inflateRawSync(this.buffer.subarray(start, end), { maxOutputLength: Math.min(entry.uncompressed + 1, this.limits.maxEntryBytes + 1) });
    } catch (error) {
      fail('OOXML_INVALID_ZIP', 'ZIP decompression failed', { entry: name, reason: String(error.message || error).slice(0, 200) });
    }
    if (out.length !== entry.uncompressed || out.length > this.limits.maxEntryBytes) fail('OOXML_INVALID_ZIP', 'ZIP entry size mismatch', { entry: name });
    if (crc32(out) !== entry.crc) fail('OOXML_INVALID_ZIP', 'ZIP entry CRC mismatch', { entry: name });
    this.metrics.inflated_bytes += out.length;
    if (this.metrics.inflated_bytes > this.limits.maxUncompressedBytes) fail('OOXML_LIMIT_EXCEEDED', 'Inflated byte budget exceeded');
    if (xml && out.length > this.limits.maxXmlBytes) fail('OOXML_LIMIT_EXCEEDED', 'XML entry exceeds size limit', { entry: name });
    return out;
  }
  xml(name) {
    const data = this.read(name, true);
    if (!data) return null;
    const text = data.toString('utf8');
    if (/<!DOCTYPE|<!ENTITY/i.test(text)) fail('OOXML_UNSUPPORTED', 'DTD and XML entities are unsupported', { entry: name });
    return text;
  }
}
function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let i = 0; i < 8; i += 1) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function decodeXml(value) {
  return String(value || '').replace(/&(?:#x([0-9a-f]+)|#([0-9]+)|amp|lt|gt|quot|apos);/gi, (m, hex, dec) => {
    if (hex) return String.fromCodePoint(parseInt(hex, 16));
    if (dec) return String.fromCodePoint(parseInt(dec, 10));
    return ({ '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'" })[m.toLowerCase()] || m;
  });
}
function localName(name) { return String(name || '').split(':').pop(); }
function attrs(text) {
  const out = {};
  const re = /([:\w.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  let match;
  while ((match = re.exec(text))) out[match[1]] = decodeXml(match[2] ?? match[3]);
  return out;
}
function xmlEvents(xml, options = {}) {
  const lim = options.limits || DEFAULT_LIMITS;
  const signal = options.signal;
  const events = [];
  const re = /<[^>]*>|[^<]+/g;
  let depth = 0;
  let chars = 0;
  let match;
  while ((match = re.exec(xml))) {
    checkAbort(signal);
    const token = match[0];
    if (token[0] !== '<') {
      const text = decodeXml(token);
      chars += text.length;
      if (chars > lim.maxTextChars) fail('OOXML_LIMIT_EXCEEDED', 'XML text exceeds character limit');
      if (text) events.push({ type: 'text', text, depth });
    } else if (/^<\?/.test(token) || /^<!--/.test(token)) {
      continue;
    } else if (/^<!/.test(token)) {
      fail('OOXML_UNSUPPORTED', 'Unsupported XML declaration');
    } else if (/^<\//.test(token)) {
      depth -= 1;
      if (depth < 0) fail('OOXML_MALFORMED_XML', 'Unbalanced XML closing tag');
      events.push({ type: 'end', name: localName(token.slice(2, -1).trim()), depth });
    } else {
      const self = /\/>$/.test(token);
      const body = token.slice(1, self ? -2 : -1).trim();
      const split = body.search(/\s/);
      const name = localName(split < 0 ? body : body.slice(0, split));
      events.push({ type: 'start', name, attrs: attrs(split < 0 ? '' : body.slice(split)), depth, self });
      if (!self) {
        depth += 1;
        if (depth > lim.maxXmlDepth) fail('OOXML_LIMIT_EXCEEDED', 'XML nesting depth exceeds limit');
      } else events.push({ type: 'end', name, depth });
    }
  }
  if (depth !== 0) fail('OOXML_MALFORMED_XML', 'Unclosed XML element');
  return events;
}
function attr(a, name) {
  return a[name] ?? a[`r:${name}`] ?? a[`w:${name}`] ?? a[`x:${name}`] ?? a[`xml:${name}`];
}
function rels(zip, part, options) {
  const slash = part.lastIndexOf('/');
  const relPath = `${part.slice(0, slash + 1)}_rels/${part.slice(slash + 1)}.rels`;
  const xml = zip.xml(relPath);
  if (!xml) return new Map();
  const map = new Map();
  try {
    for (const event of xmlEvents(xml, options)) if (event.type === 'start' && event.name === 'Relationship') {
      const id = attr(event.attrs, 'Id');
      const target = attr(event.attrs, 'Target');
      if (!id || !target) fail('OOXML_MALFORMED_RELATIONSHIP', 'Relationship is missing Id or Target', { part: relPath });
      map.set(id, { id, type: attr(event.attrs, 'Type') || '', target, external: attr(event.attrs, 'TargetMode') === 'External' });
    }
  } catch (error) {
    if (error.code) throw error;
    fail('OOXML_MALFORMED_RELATIONSHIP', 'Malformed relationship XML', { part: relPath });
  }
  return map;
}
function resolvePart(base, target) {
  if (/^[A-Za-z][A-Za-z0-9+.-]*:/.test(target)) return target;
  const stack = base.split('/'); stack.pop();
  for (const piece of String(target).replace(/\\/g, '/').split('/')) {
    if (!piece || piece === '.') continue;
    if (piece === '..') {
      if (!stack.length) fail('OOXML_PATH_TRAVERSAL', 'Relationship target escapes package');
      stack.pop();
    } else stack.push(piece);
  }
  return safePath(stack.join('/'));
}
function sourceHash(buffer) { return crypto.createHash('sha256').update(buffer).digest('hex'); }
function presence(value, unsupported = false, failed = false) {
  return failed ? 'extraction_failed' : unsupported ? 'unsupported' : value === undefined || value === null || value === '' ? 'missing' : 'present';
}
function makeBlock(ctx, item) {
  return createBlock({
    source_hash: ctx.hash, order: ctx.order++, kind: item.kind || 'paragraph',
    raw_text: item.text || '', raw_fields: item.raw_fields || {}, inferred: item.inferred || {},
    locator: item.locator, provenance: item.provenance || [item.locator],
    parse_method: ctx.parser, parse_quality: item.confidence ?? 1,
    status: item.status || presence(item.text), card_eligible: item.card_eligible !== false,
    exclusion_reason: item.exclusion_reason || '', metadata: item.metadata || {}
  });
}

function parseDocx(buffer, options = {}) {
  const lim = limits(options.limits);
  const zip = new SafeZip(buffer, { limits: lim, signal: options.signal });
  const content = zip.xml('[Content_Types].xml');
  if (!content || !zip.has('word/document.xml')) fail('OOXML_UNSUPPORTED', 'Package is not a supported DOCX');
  const ctx = { hash: sourceHash(buffer), order: 0, parser: 'docx-ooxml-local' };
  const warnings = [];
  if ([...zip.entries.keys()].some(name => /vbaProject\.bin$|\/embeddings\//i.test(name))) {
    warnings.push({ code: 'OOXML_PARTIAL_FEATURE_SUPPORT', feature: 'embedded-object-or-macro', status: 'unsupported' });
  }
  const styles = parseDocxStyles(zip, lim, options.signal);
  const numbering = parseNumbering(zip, lim, options.signal);
  const parts = [{ name: 'document', path: 'word/document.xml' }];
  for (const name of [...zip.entries.keys()].sort()) {
    if (/^word\/header\d*\.xml$/i.test(name)) parts.push({ name: 'header', path: name });
    if (/^word\/footer\d*\.xml$/i.test(name)) parts.push({ name: 'footer', path: name });
  }
  for (const [kind, path] of [['footnote', 'word/footnotes.xml'], ['endnote', 'word/endnotes.xml'], ['comment', 'word/comments.xml']]) {
    if (zip.has(path)) parts.push({ name: kind, path });
  }
  const blocks = [];
  const metadata = { language: styles.language || 'unknown', parts: parts.map(p => p.path), warnings };
  for (const part of parts) blocks.push(...parseDocxPart(zip, part, ctx, styles, numbering, lim, options.signal, warnings));
  const textBlocks = blocks.filter(b => b.card_eligible && b.raw?.text);
  const markdown = blocksToMarkdown(textBlocks);
  return finalize('docx', ctx, zip, blocks, markdown, metadata);
}
function parseDocxStyles(zip, lim, signal) {
  const xml = zip.xml('word/styles.xml');
  const out = { map: new Map(), language: '' };
  if (!xml) return out;
  let style = null;
  for (const e of xmlEvents(xml, { limits: lim, signal })) {
    if (e.type === 'start' && e.name === 'style') style = { id: attr(e.attrs, 'styleId') || '', name: '', outline: null, basedOn: '' };
    else if (style && e.type === 'start' && e.name === 'name') style.name = attr(e.attrs, 'val') || '';
    else if (style && e.type === 'start' && e.name === 'outlineLvl') style.outline = Number(attr(e.attrs, 'val'));
    else if (style && e.type === 'start' && e.name === 'basedOn') style.basedOn = attr(e.attrs, 'val') || '';
    else if (e.type === 'start' && e.name === 'lang' && !out.language) out.language = attr(e.attrs, 'val') || '';
    else if (style && e.type === 'end' && e.name === 'style') { out.map.set(style.id, style); style = null; }
  }
  return out;
}
function parseNumbering(zip, lim, signal) {
  const xml = zip.xml('word/numbering.xml');
  const abstracts = new Map(), nums = new Map();
  if (!xml) return { abstracts, nums };
  let abstract = null, level = null, num = null;
  for (const e of xmlEvents(xml, { limits: lim, signal })) {
    if (e.type === 'start' && e.name === 'abstractNum') abstract = { id: attr(e.attrs, 'abstractNumId'), levels: new Map() };
    else if (abstract && e.type === 'start' && e.name === 'lvl') level = { ilvl: Number(attr(e.attrs, 'ilvl') || 0), format: '', text: '' };
    else if (level && e.type === 'start' && e.name === 'numFmt') level.format = attr(e.attrs, 'val') || '';
    else if (level && e.type === 'start' && e.name === 'lvlText') level.text = attr(e.attrs, 'val') || '';
    else if (level && e.type === 'end' && e.name === 'lvl') { abstract.levels.set(level.ilvl, level); level = null; }
    else if (abstract && e.type === 'end' && e.name === 'abstractNum') { abstracts.set(abstract.id, abstract); abstract = null; }
    else if (e.type === 'start' && e.name === 'num') num = { id: attr(e.attrs, 'numId'), abstractId: '' };
    else if (num && e.type === 'start' && e.name === 'abstractNumId') num.abstractId = attr(e.attrs, 'val') || '';
    else if (num && e.type === 'end' && e.name === 'num') { nums.set(num.id, num); num = null; }
  }
  return { abstracts, nums };
}
function parseDocxPart(zip, part, ctx, styles, numbering, lim, signal, warnings) {
  const xml = zip.xml(part.path);
  if (!xml) return [];
  const rs = rels(zip, part.path, { limits: lim, signal });
  const out = [];
  let paragraph = null, table = null, row = null, cell = null;
  let hyperlink = null, textTarget = null, sectionIndex = 0, paraIndex = 0, tableIndex = 0;
  const stack = [];
  for (const e of xmlEvents(xml, { limits: lim, signal })) {
    if (e.type === 'start') {
      stack.push(e.name);
      if (e.name === 'p') paragraph = { text: '', style: '', outline: null, numId: '', level: 0, refs: [], breaks: [], hyperlinks: [], images: [] };
      else if (paragraph && e.name === 'pStyle') paragraph.style = attr(e.attrs, 'val') || '';
      else if (paragraph && e.name === 'outlineLvl') paragraph.outline = Number(attr(e.attrs, 'val'));
      else if (paragraph && e.name === 'numId') paragraph.numId = attr(e.attrs, 'val') || '';
      else if (paragraph && e.name === 'ilvl') paragraph.level = Number(attr(e.attrs, 'val') || 0);
      else if (paragraph && e.name === 'br') paragraph.breaks.push(attr(e.attrs, 'type') || 'line');
      else if (paragraph && ['footnoteReference', 'endnoteReference', 'commentReference'].includes(e.name)) paragraph.refs.push({ kind: e.name, id: attr(e.attrs, 'id') });
      else if (paragraph && e.name === 'hyperlink') {
        const id = attr(e.attrs, 'id'); const rel = rs.get(id);
        hyperlink = { id, target: rel ? (rel.external ? rel.target : resolvePart(part.path, rel.target)) : '', text: '' };
      } else if (paragraph && ['blip', 'imagedata'].includes(e.name)) {
        const id = attr(e.attrs, 'embed') || attr(e.attrs, 'id'); const rel = rs.get(id);
        paragraph.images.push({ relationship_id: id || '', target: rel ? (rel.external ? rel.target : resolvePart(part.path, rel.target)) : '', anchor: 'paragraph' });
      } else if (e.name === 't' || e.name === 'instrText') textTarget = e.name;
      else if (e.name === 'tbl') table = { index: ++tableIndex, rows: [] };
      else if (table && e.name === 'tr') row = { index: table.rows.length + 1, cells: [] };
      else if (row && e.name === 'tc') cell = { index: row.cells.length + 1, text: '', gridSpan: 1, vMerge: '' };
      else if (cell && e.name === 'gridSpan') cell.gridSpan = Number(attr(e.attrs, 'val') || 1);
      else if (cell && e.name === 'vMerge') cell.vMerge = attr(e.attrs, 'val') || 'continue';
      else if (e.name === 'sectPr') sectionIndex += 1;
    } else if (e.type === 'text' && textTarget) {
      if (cell) cell.text += e.text;
      if (paragraph) paragraph.text += e.text;
      if (hyperlink) hyperlink.text += e.text;
    } else if (e.type === 'end') {
      if (e.name === 't' || e.name === 'instrText') textTarget = null;
      else if (e.name === 'hyperlink' && hyperlink) { paragraph.hyperlinks.push(hyperlink); hyperlink = null; }
      else if (e.name === 'tc' && cell) { row.cells.push(cell); cell = null; }
      else if (e.name === 'tr' && row) {
        table.rows.push(row);
        for (const c of row.cells) out.push(makeBlock(ctx, {
          kind: 'table_cell', text: c.text.trim(),
          locator: { scheme: 'ooxml', value: `${part.path}#table=${table.index}/row=${row.index}/cell=${c.index}` },
          metadata: { part: part.name, table: table.index, row: row.index, cell: c.index,
            merge: { grid_span: c.gridSpan, vertical: c.vMerge || 'none' } }
        }));
        row = null;
      } else if (e.name === 'tbl') table = null;
      else if (e.name === 'p' && paragraph) {
        paraIndex += 1;
        const style = styles.map.get(paragraph.style);
        let heading = paragraph.outline;
        let headingInference = {};
        if (!Number.isFinite(heading) && style && Number.isFinite(style.outline)) heading = style.outline;
        if (!Number.isFinite(heading) && /^(heading|标题)\s*[1-9]/i.test(style?.name || paragraph.style)) {
          const match = String(style?.name || paragraph.style).match(/[1-9]/);
          heading = Number(match?.[0] || 1) - 1;
          headingInference = { heading: { value: true, confidence: 0.88, basis: 'style-name' } };
        }
        const num = numbering.nums.get(paragraph.numId);
        const level = numbering.abstracts.get(num?.abstractId)?.levels.get(paragraph.level);
        const isList = Boolean(paragraph.numId);
        const locator = { scheme: 'ooxml', value: `${part.path}#section=${sectionIndex || 1}/p=${paraIndex}` };
        if (!cell) out.push(makeBlock(ctx, {
          kind: Number.isFinite(heading) ? 'heading' : isList ? 'list_item' : part.name,
          text: paragraph.text.trim(), locator, inferred: headingInference,
          metadata: {
            part: part.name, paragraph: paraIndex, section: sectionIndex || 1,
            style: paragraph.style || '', outline_level: Number.isFinite(heading) ? heading : null,
            list: isList ? { num_id: paragraph.numId, level: paragraph.level, format: level?.format || '', template: level?.text || '' } : null,
            hyperlinks: paragraph.hyperlinks, references: paragraph.refs, images: paragraph.images,
            breaks: paragraph.breaks, language: styles.language || 'unknown',
            raw_vs_inferred: { heading: Object.keys(headingInference).length ? 'inferred' : Number.isFinite(heading) ? 'raw' : 'missing' }
          }
        }));
        paragraph = null;
      }
      if (stack.length) stack.pop();
    }
  }
  return out;
}

function parseXlsx(buffer, options = {}) {
  const lim = limits(options.limits);
  const zip = new SafeZip(buffer, { limits: lim, signal: options.signal });
  if (!zip.has('xl/workbook.xml')) fail('OOXML_UNSUPPORTED', 'Package is not a supported XLSX');
  const ctx = { hash: sourceHash(buffer), order: 0, parser: 'xlsx-ooxml-local' };
  const shared = parseSharedStrings(zip, lim, options.signal);
  const styles = parseXlsxStyles(zip, lim, options.signal);
  const wbRels = rels(zip, 'xl/workbook.xml', { limits: lim, signal: options.signal });
  const workbook = [];
  for (const e of xmlEvents(zip.xml('xl/workbook.xml'), { limits: lim, signal: options.signal })) {
    if (e.type === 'start' && e.name === 'sheet') {
      const rel = wbRels.get(attr(e.attrs, 'id'));
      if (!rel) fail('OOXML_MALFORMED_RELATIONSHIP', 'Worksheet relationship is missing');
      workbook.push({ name: attr(e.attrs, 'name') || '', id: attr(e.attrs, 'sheetId') || '', state: attr(e.attrs, 'state') || 'visible', path: resolvePart('xl/workbook.xml', rel.target) });
    }
  }
  const blocks = [], sheets = [];
  for (let i = 0; i < workbook.length; i += 1) {
    const sheet = workbook[i];
    const parsed = parseSheet(zip, sheet, i + 1, ctx, shared, styles, lim, options.signal);
    blocks.push(...parsed.blocks);
    sheets.push(parsed.metadata);
  }
  const markdown = blocksToMarkdown(blocks.filter(b => b.card_eligible && b.raw?.text));
  return finalize('xlsx', ctx, zip, blocks, markdown, { sheets, shared_strings: shared.length });
}

function parsePptx(buffer, options = {}) {
  const lim = limits(options.limits);
  const zip = new SafeZip(buffer, { limits: lim, signal: options.signal });
  if (!zip.has('ppt/presentation.xml')) fail('OOXML_UNSUPPORTED', 'Package is not a supported PPTX');
  const ctx = { hash: sourceHash(buffer), order: 0, parser: 'pptx-ooxml-local' };
  const presentationRels = rels(zip, 'ppt/presentation.xml', { limits: lim, signal: options.signal });
  const slides = [];
  let size = {};
  for (const e of xmlEvents(zip.xml('ppt/presentation.xml'), { limits: lim, signal: options.signal })) {
    if (e.type === 'start' && e.name === 'sldSz') {
      size = { width_emu: Number(attr(e.attrs, 'cx') || 0), height_emu: Number(attr(e.attrs, 'cy') || 0), type: attr(e.attrs, 'type') || '' };
    } else if (e.type === 'start' && e.name === 'sldId') {
      const relationshipId = e.attrs['r:id'] || e.attrs['relationships:id'] || '';
      const relationship = presentationRels.get(relationshipId);
      if (!relationship) fail('OOXML_MALFORMED_RELATIONSHIP', 'Slide relationship is missing', { relationship_id: relationshipId || '' });
      const path = resolvePart('ppt/presentation.xml', relationship.target);
      if (!/^ppt\/slides\/slide[^/]*\.xml$/i.test(path) || !zip.has(path)) {
        fail('OOXML_MALFORMED_RELATIONSHIP', 'Slide relationship target is invalid', { relationship_id: relationshipId || '', target: path });
      }
      slides.push({ id: attr(e.attrs, 'id') || '', relationship_id: relationshipId || '', path });
    }
  }
  const blocks = [], slideMetadata = [], warnings = [];
  if ([...zip.entries.keys()].some(name => /vbaProject\.bin$|\/embeddings\//i.test(name))) {
    warnings.push({ code: 'OOXML_PARTIAL_FEATURE_SUPPORT', feature: 'embedded-object-or-macro', status: 'unsupported' });
  }
  for (let i = 0; i < slides.length; i += 1) {
    const parsed = parseSlide(zip, slides[i], i + 1, ctx, lim, options.signal);
    blocks.push(...parsed.blocks);
    slideMetadata.push(parsed.metadata);
  }
  const markdown = blocksToMarkdown(blocks.filter(block => block.card_eligible && block.raw?.text));
  return finalize('pptx', ctx, zip, blocks, markdown, { slides: slideMetadata, slide_size: size, warnings });
}

function parseSlide(zip, slide, index, ctx, lim, signal) {
  const xml = zip.xml(slide.path);
  if (!xml) fail('OOXML_MALFORMED_RELATIONSHIP', 'Slide part is missing', { slide: index });
  const rs = rels(zip, slide.path, { limits: lim, signal });
  const blocks = [], images = [], charts = [], hyperlinks = [];
  let shape = null, paragraph = null, table = null, row = null, cell = null, captureText = false;
  let shapeIndex = 0, paragraphIndex = 0, tableIndex = 0, hidden = false, transition = '', hasTiming = false;
  for (const e of xmlEvents(xml, { limits: lim, signal })) {
    if (e.type === 'start' && e.name === 'sld') hidden = attr(e.attrs, 'show') === '0';
    else if (e.type === 'start' && e.name === 'transition') transition = attr(e.attrs, 'spd') || 'present';
    else if (e.type === 'start' && e.name === 'timing') hasTiming = true;
    else if (e.type === 'start' && ['sp', 'pic', 'graphicFrame', 'cxnSp'].includes(e.name) && !shape) {
      shape = { index: ++shapeIndex, kind: e.name, name: '', description: '', placeholder: '', x: null, y: null, cx: null, cy: null };
    } else if (shape && e.type === 'start' && e.name === 'cNvPr') {
      shape.name = attr(e.attrs, 'name') || '';
      shape.description = attr(e.attrs, 'descr') || attr(e.attrs, 'title') || '';
    } else if (shape && e.type === 'start' && e.name === 'ph') shape.placeholder = attr(e.attrs, 'type') || 'body';
    else if (shape && e.type === 'start' && e.name === 'off') {
      shape.x = numberOrNull(attr(e.attrs, 'x')); shape.y = numberOrNull(attr(e.attrs, 'y'));
    } else if (shape && e.type === 'start' && e.name === 'ext') {
      shape.cx = numberOrNull(attr(e.attrs, 'cx')); shape.cy = numberOrNull(attr(e.attrs, 'cy'));
    } else if (shape && e.type === 'start' && e.name === 'p') {
      paragraph = { text: '', level: Number(attr(e.attrs, 'lvl') || 0), bullets: false, hyperlinks: [] };
    } else if (paragraph && e.type === 'start' && e.name === 'pPr') {
      paragraph.level = Number(attr(e.attrs, 'lvl') || paragraph.level || 0);
    } else if (paragraph && e.type === 'start' && ['buChar', 'buAutoNum'].includes(e.name)) paragraph.bullets = true;
    else if (paragraph && e.type === 'start' && e.name === 'hlinkClick') {
      const id = attr(e.attrs, 'id'); const relationship = rs.get(id);
      const link = { relationship_id: id || '', target: relationship ? (relationship.external ? relationship.target : resolvePart(slide.path, relationship.target)) : '', external: relationship?.external === true };
      paragraph.hyperlinks.push(link); hyperlinks.push(link);
    } else if (e.type === 'start' && e.name === 'tbl') table = { index: ++tableIndex, rows: 0 };
    else if (table && e.type === 'start' && e.name === 'tr') row = { index: ++table.rows, cells: [] };
    else if (row && e.type === 'start' && e.name === 'tc') cell = {
      index: row.cells.length + 1, text: '', row_span: Number(attr(e.attrs, 'rowSpan') || 1),
      grid_span: Number(attr(e.attrs, 'gridSpan') || 1), h_merge: attr(e.attrs, 'hMerge') === '1', v_merge: attr(e.attrs, 'vMerge') === '1'
    };
    else if (cell && e.type === 'start' && e.name === 'tcPr') {
      if (attr(e.attrs, 'rowSpan') !== undefined) cell.row_span = Number(attr(e.attrs, 'rowSpan') || 1);
      if (attr(e.attrs, 'gridSpan') !== undefined) cell.grid_span = Number(attr(e.attrs, 'gridSpan') || 1);
      if (attr(e.attrs, 'hMerge') !== undefined) cell.h_merge = attr(e.attrs, 'hMerge') === '1';
      if (attr(e.attrs, 'vMerge') !== undefined) cell.v_merge = attr(e.attrs, 'vMerge') === '1';
    } else if (e.type === 'start' && ['t', 'fld'].includes(e.name)) captureText = true;
    else if (shape && e.type === 'start' && ['blip', 'imagedata'].includes(e.name)) {
      const id = attr(e.attrs, 'embed') || attr(e.attrs, 'id'); const relationship = rs.get(id);
      images.push({ relationship_id: id || '', target: relationship ? (relationship.external ? relationship.target : resolvePart(slide.path, relationship.target)) : '', external: relationship?.external === true, shape: shape.index, name: shape.name, description: shape.description });
    } else if (shape && e.type === 'start' && e.name === 'chart') {
      const id = attr(e.attrs, 'id'); const relationship = rs.get(id);
      charts.push({ relationship_id: id || '', target: relationship ? resolvePart(slide.path, relationship.target) : '', shape: shape.index, name: shape.name });
    } else if (e.type === 'text' && captureText) {
      if (cell) cell.text += e.text;
      if (paragraph) paragraph.text += e.text;
    } else if (e.type === 'end' && ['t', 'fld'].includes(e.name)) captureText = false;
    else if (e.type === 'end' && e.name === 'tc' && cell) {
      row.cells.push(cell); cell = null;
    } else if (e.type === 'end' && e.name === 'tr' && row) {
      for (const current of row.cells) blocks.push(makeBlock(ctx, {
        kind: 'table_cell', text: current.text.trim(),
        locator: { scheme: 'ooxml', value: `${slide.path}#slide=${index}/table=${table.index}/row=${row.index}/cell=${current.index}` },
        metadata: { slide: index, slide_id: slide.id, table: table.index, row: row.index, column: current.index,
          merge: { row_span: current.row_span, grid_span: current.grid_span, horizontal_continuation: current.h_merge, vertical_continuation: current.v_merge },
          shape: shapeMetadata(shape), hidden }
      }));
      row = null;
    } else if (e.type === 'end' && e.name === 'p' && paragraph && shape) {
      paragraphIndex += 1;
      const text = paragraph.text.trim();
      if (text && !table) blocks.push(makeBlock(ctx, {
        kind: isTitleShape(shape) ? 'heading' : paragraph.bullets ? 'list_item' : 'paragraph', text,
        locator: { scheme: 'ooxml', value: `${slide.path}#slide=${index}/shape=${shape.index}/p=${paragraphIndex}` },
        inferred: isTitleShape(shape) ? { outline_level: 0 } : {},
        metadata: { slide: index, slide_id: slide.id, paragraph: paragraphIndex, level: paragraph.level,
          list: paragraph.bullets ? { level: paragraph.level, format: 'presentation-bullet' } : null,
          hyperlinks: paragraph.hyperlinks, shape: shapeMetadata(shape), hidden,
          raw_vs_inferred: { heading: isTitleShape(shape) ? 'inferred-from-placeholder' : 'not_applicable' } }
      }));
      paragraph = null;
    } else if (e.type === 'end' && e.name === 'tbl') table = null;
    else if (shape && e.type === 'end' && e.name === shape.kind) shape = null;
  }
  const note = parseSlideNotes(zip, slide, index, ctx, lim, signal);
  blocks.push(...note.blocks);
  for (const image of images) blocks.push(makeBlock(ctx, {
    kind: 'image_metadata', text: image.description || '', card_eligible: false, exclusion_reason: 'non-card metadata',
    locator: { scheme: 'ooxml', value: `${slide.path}#slide=${index}/image=${image.shape}` }, metadata: Object.assign({ slide: index }, image)
  }));
  for (const chart of charts) blocks.push(makeBlock(ctx, {
    kind: 'chart_metadata', text: '', card_eligible: false, exclusion_reason: 'non-card metadata',
    locator: { scheme: 'ooxml', value: `${slide.path}#slide=${index}/chart=${chart.shape}` }, metadata: Object.assign({ slide: index }, chart)
  }));
  return { blocks, metadata: { index, id: slide.id, path: slide.path, hidden, transition, has_timing: hasTiming,
    images, charts, hyperlinks, notes_part: note.part, notes_blocks: note.blocks.length } };
}

function parseSlideNotes(zip, slide, index, ctx, lim, signal) {
  const relationship = [...rels(zip, slide.path, { limits: lim, signal }).values()]
    .find(item => /\/notesSlide$/i.test(item.type) || /notesSlides\/notesSlide[^/]*\.xml$/i.test(item.target));
  if (!relationship) return { blocks: [], part: '' };
  const part = resolvePart(slide.path, relationship.target);
  const xml = zip.xml(part);
  if (!xml) return { blocks: [], part };
  const blocks = []; let paragraph = '', captureText = false, paragraphIndex = 0, placeholder = '', inShape = false;
  for (const e of xmlEvents(xml, { limits: lim, signal })) {
    if (e.type === 'start' && e.name === 'sp') { inShape = true; placeholder = ''; }
    else if (inShape && e.type === 'start' && e.name === 'ph') placeholder = attr(e.attrs, 'type') || '';
    else if (e.type === 'start' && e.name === 'p') paragraph = '';
    else if (e.type === 'start' && ['t', 'fld'].includes(e.name)) captureText = true;
    else if (e.type === 'text' && captureText) paragraph += e.text;
    else if (e.type === 'end' && ['t', 'fld'].includes(e.name)) captureText = false;
    else if (e.type === 'end' && e.name === 'p') {
      paragraphIndex += 1;
      const text = paragraph.trim();
      if (text && !['sldNum', 'hdr', 'ftr', 'dt'].includes(placeholder)) blocks.push(makeBlock(ctx, {
        kind: 'speaker_note', text,
        locator: { scheme: 'ooxml', value: `${part}#slide=${index}/p=${paragraphIndex}` },
        metadata: { slide: index, notes_part: part, placeholder }
      }));
      paragraph = '';
    } else if (e.type === 'end' && e.name === 'sp') { inShape = false; placeholder = ''; }
  }
  return { blocks, part };
}
function isTitleShape(shape) { return ['title', 'ctrTitle'].includes(shape?.placeholder); }
function numberOrNull(value) { const number = Number(value); return Number.isFinite(number) ? number : null; }
function shapeMetadata(shape) {
  return { index: shape?.index || 0, kind: shape?.kind || '', name: shape?.name || '', description: shape?.description || '',
    placeholder: shape?.placeholder || '', bounds_emu: { x: shape?.x, y: shape?.y, width: shape?.cx, height: shape?.cy } };
}
function parseSharedStrings(zip, lim, signal) {
  const xml = zip.xml('xl/sharedStrings.xml');
  if (!xml) return [];
  const out = []; let current = null, inText = false;
  for (const e of xmlEvents(xml, { limits: lim, signal })) {
    if (e.type === 'start' && e.name === 'si') current = '';
    else if (current !== null && e.type === 'start' && e.name === 't') inText = true;
    else if (current !== null && e.type === 'text' && inText) current += e.text;
    else if (e.type === 'end' && e.name === 't') inText = false;
    else if (e.type === 'end' && e.name === 'si') { out.push(current); current = null; }
  }
  return out;
}
function parseXlsxStyles(zip, lim, signal) {
  const xml = zip.xml('xl/styles.xml');
  const numFmts = new Map(), xfs = []; let inXfs = false;
  if (!xml) return { numFmts, xfs };
  for (const e of xmlEvents(xml, { limits: lim, signal })) {
    if (e.type === 'start' && e.name === 'numFmt') numFmts.set(Number(attr(e.attrs, 'numFmtId')), attr(e.attrs, 'formatCode') || '');
    else if (e.type === 'start' && e.name === 'cellXfs') inXfs = true;
    else if (inXfs && e.type === 'start' && e.name === 'xf') xfs.push({ numFmtId: Number(attr(e.attrs, 'numFmtId') || 0) });
    else if (e.type === 'end' && e.name === 'cellXfs') inXfs = false;
  }
  return { numFmts, xfs };
}
function parseSheet(zip, sheet, index, ctx, shared, styles, lim, signal) {
  const xml = zip.xml(sheet.path);
  if (!xml) fail('OOXML_MALFORMED_RELATIONSHIP', 'Worksheet part is missing', { sheet: sheet.name });
  const rs = rels(zip, sheet.path, { limits: lim, signal });
  const blocks = [], cells = new Map(), merges = [], hiddenRows = [], hiddenCols = [], drawings = [], filters = [], tables = [];
  let row = 0, rowHidden = false, cell = null, capture = '', dimension = '';
  for (const e of xmlEvents(xml, { limits: lim, signal })) {
    if (e.type === 'start' && e.name === 'dimension') dimension = attr(e.attrs, 'ref') || '';
    else if (e.type === 'start' && e.name === 'row') { row = Number(attr(e.attrs, 'r') || row + 1); rowHidden = attr(e.attrs, 'hidden') === '1'; if (rowHidden) hiddenRows.push(row); }
    else if (e.type === 'start' && e.name === 'col' && attr(e.attrs, 'hidden') === '1') hiddenCols.push({ min: Number(attr(e.attrs, 'min')), max: Number(attr(e.attrs, 'max')) });
    else if (e.type === 'start' && e.name === 'c') cell = { ref: attr(e.attrs, 'r') || '', type: attr(e.attrs, 't') || 'n', style: Number(attr(e.attrs, 's') || 0), value: '', formula: '', inline: '', rowHidden };
    else if (cell && e.type === 'start' && ['v', 'f', 't'].includes(e.name)) capture = e.name;
    else if (cell && e.type === 'text' && capture) cell[capture === 'f' ? 'formula' : capture === 't' ? 'inline' : 'value'] += e.text;
    else if (e.type === 'end' && ['v', 'f', 't'].includes(e.name)) capture = '';
    else if (e.type === 'end' && e.name === 'c' && cell) {
      const typed = cellValue(cell, shared, styles);
      const locator = { scheme: 'ooxml', value: `${sheet.path}#sheet=${index}/cell=${cell.ref}` };
      const block = makeBlock(ctx, {
        kind: 'spreadsheet_cell', text: typed.text, locator,
        status: presence(typed.text), metadata: {
          sheet: sheet.name, sheet_index: index, sheet_visibility: sheet.state, coordinate: cell.ref,
          row: coordinate(cell.ref).row, column: coordinate(cell.ref).column, row_hidden: cell.rowHidden,
          column_hidden: hiddenCols.some(item => coordinate(cell.ref).column &&
            columnNumber(coordinate(cell.ref).column) >= item.min && columnNumber(coordinate(cell.ref).column) <= item.max),
          cell_type: typed.type, raw_value: cell.value, formula: cell.formula || '', cached_value: cell.value || '',
          cached_value_status: cell.formula ? presence(cell.value) : 'not_applicable',
          number_format: typed.format, date_serial: typed.dateSerial, merge: null
        }
      });
      blocks.push(block); cells.set(cell.ref, block); cell = null;
    } else if (e.type === 'start' && e.name === 'mergeCell') merges.push(attr(e.attrs, 'ref') || '');
    else if (e.type === 'start' && e.name === 'autoFilter') filters.push(attr(e.attrs, 'ref') || '');
    else if (e.type === 'start' && e.name === 'tablePart') {
      const rel = rs.get(attr(e.attrs, 'id')); if (rel) tables.push(resolvePart(sheet.path, rel.target));
    } else if (e.type === 'start' && e.name === 'drawing') {
      const rel = rs.get(attr(e.attrs, 'id')); if (rel) drawings.push(...parseDrawing(zip, resolvePart(sheet.path, rel.target), sheet, signal, lim));
    }
  }
  for (const range of merges) applyMerge(range, cells, blocks, sheet, index, ctx);
  inferRowIdentities(blocks);
  for (const image of drawings) blocks.push(makeBlock(ctx, {
    kind: 'image_metadata', text: '', card_eligible: false, exclusion_reason: 'non-card metadata',
    locator: { scheme: 'ooxml', value: `${image.part}#anchor=${image.anchor}` }, metadata: image
  }));
  return { blocks, metadata: { name: sheet.name, index, visibility: sheet.state, used_range: dimension, merges, hidden_rows: hiddenRows, hidden_columns: hiddenCols, autofilters: filters, tables, drawings } };
}
function cellValue(cell, shared, styles) {
  const raw = cell.type === 'inlineStr' ? cell.inline : cell.value;
  const style = styles.xfs[cell.style];
  const format = styles.numFmts.get(style?.numFmtId) || builtinFormat(style?.numFmtId);
  if (cell.type === 's') {
    const index = Number(raw);
    if (!Number.isInteger(index) || index < 0 || index >= shared.length) fail('OOXML_MALFORMED_XML', 'Shared string index is invalid', { cell: cell.ref });
    return { text: shared[index], type: 'shared_string', format };
  }
  if (cell.type === 'inlineStr' || cell.type === 'str') return { text: raw, type: cell.type === 'str' ? 'formula_string_cache' : 'inline_string', format };
  if (cell.type === 'b') return { text: raw === '1' ? 'TRUE' : 'FALSE', type: 'boolean', format };
  if (cell.type === 'e') return { text: raw, type: 'error', format };
  const date = isDateFormat(format);
  return { text: raw, type: date ? 'date_serial' : 'number', format, dateSerial: date && raw !== '' ? Number(raw) : undefined };
}
function builtinFormat(id) {
  if ([14, 15, 16, 17, 22].includes(id)) return 'builtin-date';
  return '';
}
function isDateFormat(format) { return format === 'builtin-date' || /(^|[^\\])[ymdhis]/i.test(String(format || '').replace(/"[^"]*"/g, '')); }
function coordinate(ref) {
  const m = /^([A-Z]+)(\d+)$/i.exec(ref) || [];
  return { column: (m[1] || '').toUpperCase(), row: Number(m[2] || 0) };
}
function columnNumber(value) { return [...String(value || '').toUpperCase()].reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0); }
function inferRowIdentities(blocks) {
  const rows = new Map();
  for (const block of blocks) {
    if (block.kind !== 'spreadsheet_cell') continue;
    const row = Number(block.metadata?.row || 0);
    if (!rows.has(row)) rows.set(row, []);
    rows.get(row).push(block);
  }
  const candidates = [];
  for (const [row, rowBlocks] of rows) {
    const first = rowBlocks.filter(b => b.raw?.text && !b.metadata?.row_hidden)
      .sort((a, b) => columnNumber(a.metadata.column) - columnNumber(b.metadata.column))[0];
    if (first && first.metadata.cell_type !== 'number' && !first.metadata.formula) candidates.push({ row, first, value: first.raw.text.trim() });
  }
  const counts = new Map();
  for (const item of candidates) counts.set(item.value, (counts.get(item.value) || 0) + 1);
  for (const item of candidates) {
    if (!item.value || counts.get(item.value) !== 1) continue;
    for (const block of rows.get(item.row)) block.metadata.row_identity = {
      value: item.value, source_coordinate: item.first.metadata.coordinate,
      raw_or_inferred: 'inferred', confidence: 0.82, basis: 'unique-leftmost-nonempty-text'
    };
  }
}
function expandRange(range) {
  const [a, b = a] = String(range).split(':'); const ca = coordinate(a), cb = coordinate(b);
  const colNum = s => [...s].reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0);
  const colName = n => { let s = ''; while (n) { n -= 1; s = String.fromCharCode(65 + n % 26) + s; n = Math.floor(n / 26); } return s; };
  const out = [];
  for (let r = ca.row; r <= cb.row; r += 1) for (let c = colNum(ca.column); c <= colNum(cb.column); c += 1) out.push(`${colName(c)}${r}`);
  return out;
}
function applyMerge(range, cells, blocks, sheet, index, ctx) {
  const refs = expandRange(range); const anchorRef = refs[0]; const anchor = cells.get(anchorRef);
  for (const ref of refs) {
    let block = cells.get(ref);
    if (!block) {
      block = makeBlock(ctx, {
        kind: 'spreadsheet_cell', text: '', status: 'missing',
        locator: { scheme: 'ooxml', value: `${sheet.path}#sheet=${index}/cell=${ref}` },
        metadata: { sheet: sheet.name, sheet_index: index, coordinate: ref, row: coordinate(ref).row, column: coordinate(ref).column }
      });
      blocks.push(block); cells.set(ref, block);
    }
    block.metadata.merge = { range, anchor: anchorRef, role: ref === anchorRef ? 'anchor' : 'inherited' };
    block.metadata.inherited_header = ref === anchorRef ? '' : (anchor?.raw?.text || '');
  }
}
function parseDrawing(zip, part, sheet, signal, lim) {
  const xml = zip.xml(part); if (!xml) return [];
  const rs = rels(zip, part, { limits: lim, signal });
  const out = []; let anchor = null, point = null, embed = '';
  for (const e of xmlEvents(xml, { limits: lim, signal })) {
    if (e.type === 'start' && ['twoCellAnchor', 'oneCellAnchor', 'absoluteAnchor'].includes(e.name)) anchor = { kind: e.name, from: {}, to: {}, part, sheet: sheet.name };
    else if (anchor && e.type === 'start' && ['from', 'to'].includes(e.name)) point = e.name;
    else if (anchor && e.type === 'start' && e.name === 'blip') embed = attr(e.attrs, 'embed') || '';
    else if (anchor && point && e.type === 'start' && ['col', 'row', 'colOff', 'rowOff'].includes(e.name)) anchor.capture = e.name;
    else if (anchor && point && e.type === 'text' && anchor.capture) anchor[point][anchor.capture] = Number(e.text);
    else if (e.type === 'end' && ['col', 'row', 'colOff', 'rowOff'].includes(e.name) && anchor) anchor.capture = '';
    else if (e.type === 'end' && ['from', 'to'].includes(e.name)) point = null;
    else if (anchor && e.type === 'end' && ['twoCellAnchor', 'oneCellAnchor', 'absoluteAnchor'].includes(e.name)) {
      const rel = rs.get(embed);
      out.push(Object.assign(anchor, { relationship_id: embed, target: rel ? (rel.external ? rel.target : resolvePart(part, rel.target)) : '', anchor: JSON.stringify({ from: anchor.from, to: anchor.to }) }));
      anchor = null; embed = '';
    }
  }
  return out;
}
function finalize(type, ctx, zip, blocks, markdown, metadata) {
  const eligible = blocks.filter(b => b.card_eligible && b.raw?.text);
  const locators = blocks.filter(b => b.locator?.value).length;
  const status = eligible.length ? 'ok' : 'review_required';
  return {
    status, code: status === 'review_required' ? 'OOXML_NO_ELIGIBLE_CONTENT' : '',
    text: markdown, sourceType: type, sourceEncoding: 'ooxml-local', sourceLanguage: metadata.language || 'unknown',
    extractor: `${type}-ooxml-local`, blocks, metadata: Object.assign(metadata, {
      ooxml_metrics: Object.assign({}, zip.metrics, {
        block_count: blocks.length, eligible_blocks: eligible.length,
        locator_coverage: blocks.length ? locators / blocks.length : 1
      })
    }),
    message: status === 'review_required' ? 'OOXML 文件有效，但没有可进入卡片生成的内容。' : ''
  };
}
function parseOoxml(buffer, type, options = {}) {
  try {
    return type === 'docx' ? parseDocx(buffer, options) : type === 'xlsx' ? parseXlsx(buffer, options) : type === 'pptx' ? parsePptx(buffer, options) :
      fail('OOXML_UNSUPPORTED', 'Unsupported OOXML document type');
  } catch (error) {
    if (!(error instanceof OoxmlError)) return { status: 'failed', code: 'OOXML_EXTRACTION_FAILED', message: String(error.message || error) };
    const status = error.code === 'OOXML_ABORTED' ? 'cancelled' :
      error.code === 'OOXML_UNSUPPORTED' || error.code === 'OOXML_ENCRYPTED' ? 'unsupported' :
      error.code === 'OOXML_LIMIT_EXCEEDED' ? 'limits_exceeded' : 'failed';
    return { status, code: error.code, message: error.message, details: error.details };
  }
}

module.exports = { DEFAULT_LIMITS, OoxmlError, SafeZip, parseDocx, parseXlsx, parsePptx, parseOoxml, xmlEvents };

},
/**
 * @module src/core/block-v0
 * Local, deterministic ingestion contract and structure-first packing.
 */
"src/core/block-v0.js": function(require, module, exports) {
const crypto = require("crypto");
const BLOCK_SCHEMA_VERSION = 'block_v0';
const DEFAULT_LIMITS = Object.freeze({
  maxFileBytes: 64 * 1024 * 1024, maxStreams: 4096, maxStreamBytes: 16 * 1024 * 1024,
  maxTextChars: 2 * 1024 * 1024, maxAttachments: 256, maxPdfPages: 5000
});

function hash(value) {
  return crypto.createHash('sha256').update(value || '').digest('hex');
}
function stableId(sourceHash, order, locator, rawText) {
  return `block-${hash(`${sourceHash}\0${order}\0${locator?.scheme || ''}\0${locator?.value || ''}\0${rawText || ''}`).slice(0, 24)}`;
}
function createBlock(input) {
  const raw = String(input.raw_text ?? input.text ?? '');
  const inferred = input.inferred && typeof input.inferred === 'object' ? input.inferred : {};
  const status = ['present', 'missing', 'unsupported', 'extraction_failed'].includes(input.status) ? input.status : (raw ? 'present' : 'missing');
  const locator = input.locator && typeof input.locator === 'object' ? input.locator : { scheme: 'unknown', value: '' };
  const order = Math.max(0, Number(input.order) || 0);
  return {
    schema_version: BLOCK_SCHEMA_VERSION,
    block_id: input.block_id || stableId(input.source_hash, order, locator, raw),
    source_hash: String(input.source_hash || ''),
    order,
    parent_id: input.parent_id || null,
    kind: String(input.kind || 'text'),
    locator,
    provenance: Array.isArray(input.provenance) ? input.provenance : [locator],
    raw: { text: raw, fields: input.raw_fields && typeof input.raw_fields === 'object' ? input.raw_fields : {} },
    inferred,
    parse: {
      method: String(input.parse_method || 'local-deterministic'),
      quality: Number.isFinite(input.parse_quality) ? Math.max(0, Math.min(1, input.parse_quality)) : (raw ? 1 : 0),
      status
    },
    card_eligible: input.card_eligible !== false && status === 'present',
    exclusion_reason: input.card_eligible === false ? String(input.exclusion_reason || 'not_card_content') : null,
    metadata: input.metadata && typeof input.metadata === 'object' && !Array.isArray(input.metadata) ? input.metadata : {}
  };
}
function validateBlock(block) {
  const errors = [];
  if (block?.schema_version !== BLOCK_SCHEMA_VERSION) errors.push('schema_version');
  if (!/^block-[a-f0-9]{24}$/.test(String(block?.block_id || ''))) errors.push('block_id');
  if (!/^[a-f0-9]{64}$/.test(String(block?.source_hash || ''))) errors.push('source_hash');
  if (!Number.isInteger(block?.order) || block.order < 0) errors.push('order');
  if (!block?.locator?.scheme || typeof block.locator.value !== 'string') errors.push('locator');
  if (!['present', 'missing', 'unsupported', 'extraction_failed'].includes(block?.parse?.status)) errors.push('parse.status');
  return { valid: errors.length === 0, errors };
}
function redactQueryTokens(value) {
  try {
    const url = new URL(String(value));
    for (const key of [...url.searchParams.keys()]) {
      if (/(token|key|auth|sig|signature|uid|user|email|recipient|track|click|open|redirect|ref|utm_|fbclid|gclid)/i.test(key)) {
        url.searchParams.set(key, '[REDACTED]');
      }
    }
    return url.toString();
  } catch {
    return String(value).replace(/([?&](?:token|key|auth|sig|signature|uid|email|track|utm_[^=]*)=)[^&#\s]+/gi, '$1[REDACTED]');
  }
}
function classifyContent(text, metadata = {}) {
  const value = `${text || ''}\n${metadata.url || ''}`;
  if (/(unsubscribe|取消订阅|退订|opt[ -]?out)/i.test(value)) return { kind: 'unsubscribe', eligible: false };
  if (/(pixel|beacon|open\.gif|track(?:ing)?[./?]|utm_(?:source|campaign)|1x1)/i.test(value)) return { kind: 'tracking', eligible: false };
  if (/(view (?:this )?email in browser|marketing preferences|推广|营销邮件)/i.test(value)) return { kind: 'marketing', eligible: false };
  return { kind: '', eligible: true };
}
function estimateTokens(text) {
  const s = String(text || '');
  return Math.max(1, Math.ceil((s.match(/[\u3400-\u9fff]/g) || []).length + (s.replace(/[\u3400-\u9fff]/g, '').length / 4)));
}
function splitAtomic(block, hardBudget, tokenCounter) {
  const text = block.raw.text;
  const out = [];
  let start = 0;
  while (start < text.length) {
    let low = start + 1, high = text.length, best = start + 1;
    while (low <= high) {
      const mid = Math.floor((low + high) / 2);
      if (tokenCounter(text.slice(start, mid)) <= hardBudget) { best = mid; low = mid + 1; } else high = mid - 1;
    }
    let end = best;
    if (end < text.length) {
      const natural = Math.max(text.lastIndexOf('\n', end), text.lastIndexOf('。', end), text.lastIndexOf(' ', end));
      if (natural > start + Math.floor((end - start) / 2)) end = natural + 1;
    }
    out.push(createBlock(Object.assign({}, block, {
      block_id: undefined, raw_text: text.slice(start, end), raw_fields: block.raw.fields,
      locator: Object.assign({}, block.locator, { fragment: `chars=${start}-${end}` }),
      provenance: block.provenance, metadata: Object.assign({}, block.metadata, { split_from: block.block_id, char_start: start, char_end: end })
    })));
    start = end;
  }
  return out;
}
function packBlocks(blocks, options = {}) {
  const hardBudget = Math.max(16, Number(options.hardBudget) || 2000);
  const softBudget = Math.min(hardBudget, Math.max(8, Number(options.softBudget) || Math.floor(hardBudget * 0.85)));
  const tokenCounter = typeof options.tokenCounter === 'function' ? options.tokenCounter : estimateTokens;
  const ordered = [...(blocks || [])].sort((a, b) => a.order - b.order);
  const atomic = ordered.flatMap((block) => block.card_eligible !== false && tokenCounter(block.raw?.text || '') > hardBudget ? splitAtomic(block, hardBudget, tokenCounter) : [block]);
  const packs = [];
  let current = null;
  for (const block of atomic) {
    const text = block.card_eligible === false ? '' : String(block.raw?.text || '');
    const tokens = text ? tokenCounter(text) : 0;
    if (!current || (current.token_count + tokens > softBudget && current.block_ids.length)) {
      if (current) packs.push(current);
      current = { pack_id: '', text: '', token_count: 0, block_ids: [], locators: [], blocks: [] };
    }
    if (text) current.text += (current.text ? '\n\n' : '') + text;
    current.token_count += tokens;
    current.block_ids.push(block.block_id);
    current.locators.push(...(block.provenance || [block.locator]));
    current.blocks.push(block);
  }
  if (current) packs.push(current);
  for (let i = 0; i < packs.length; i += 1) packs[i].pack_id = `pack-${hash(packs[i].block_ids.join('|')).slice(0, 20)}`;
  const locatorCount = atomic.reduce((sum, b) => sum + (b.provenance || [b.locator]).length, 0);
  return {
    packs,
    metrics: {
      input_blocks: ordered.length, atomic_blocks: atomic.length, output_packs: packs.length,
      split_atomic_blocks: atomic.filter((b) => b.metadata?.split_from).length,
      max_pack_tokens: packs.reduce((m, p) => Math.max(m, p.token_count), 0),
      locator_coverage: locatorCount ? packs.reduce((s, p) => s + p.locators.length, 0) / locatorCount : 1
    }
  };
}

function readCfb(buffer, limits = DEFAULT_LIMITS) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 512 || buffer.subarray(0, 8).toString('hex') !== 'd0cf11e0a1b11ae1') throw typed('unsupported', 'MSG_CFB_SIGNATURE');
  if (buffer.length > limits.maxFileBytes) throw typed('limits_exceeded', 'MSG_FILE_LIMIT');
  const sectorShift = buffer.readUInt16LE(30);
  const sectorSize = 2 ** sectorShift;
  if (![512, 4096].includes(sectorSize)) throw typed('unsupported', 'MSG_SECTOR_SIZE');
  const sector = (id) => {
    const start = 512 + id * sectorSize;
    if (id < 0 || start + sectorSize > buffer.length) throw typed('extraction_failed', 'MSG_SECTOR_RANGE');
    return buffer.subarray(start, start + sectorSize);
  };
  const difat = [];
  for (let i = 0; i < 109; i += 1) { const id = buffer.readUInt32LE(76 + i * 4); if (id < 0xFFFFFFFA) difat.push(id); }
  if (difat.length > limits.maxStreams) throw typed('limits_exceeded', 'MSG_FAT_LIMIT');
  const fat = [];
  for (const id of difat) for (let p = 0; p < sectorSize; p += 4) fat.push(sector(id).readUInt32LE(p));
  const chain = (start, maxBytes = limits.maxStreamBytes) => {
    const chunks = []; const seen = new Set(); let id = start; let size = 0;
    while (id < 0xFFFFFFFA) {
      if (seen.has(id) || seen.size >= limits.maxStreams) throw typed('extraction_failed', 'MSG_CHAIN_LOOP');
      seen.add(id); const chunk = sector(id); size += chunk.length;
      if (size > maxBytes) throw typed('limits_exceeded', 'MSG_STREAM_LIMIT');
      chunks.push(chunk); id = fat[id];
    }
    return Buffer.concat(chunks);
  };
  const dir = chain(buffer.readUInt32LE(48));
  const entries = [];
  for (let off = 0; off + 128 <= dir.length && entries.length < limits.maxStreams; off += 128) {
    const nameBytes = Math.min(64, Math.max(0, dir.readUInt16LE(off + 64) - 2));
    const name = dir.subarray(off, off + nameBytes).toString('utf16le');
    if (!name) continue;
    const start = dir.readUInt32LE(off + 116); const size = Number(dir.readBigUInt64LE(off + 120));
    entries.push({ name, type: dir[off + 66], start, size, id: off / 128 });
  }
  const root = entries.find((entry) => entry.type === 5);
  let miniStream = Buffer.alloc(0); const miniFat = [];
  try {
    if (root && root.size > 0) miniStream = chain(root.start, limits.maxStreamBytes * 4).subarray(0, root.size);
    const miniFatStart = buffer.readUInt32LE(60); const miniFatSectors = Math.min(buffer.readUInt32LE(64), limits.maxStreams);
    if (miniFatSectors && miniFatStart < 0xFFFFFFFA) {
      const miniFatBuffer = chain(miniFatStart, miniFatSectors * sectorSize);
      for (let p = 0; p + 4 <= miniFatBuffer.length; p += 4) miniFat.push(miniFatBuffer.readUInt32LE(p));
    }
  } catch (_) { /* individual small streams remain typed unsupported */ }
  const readMini = (entry) => {
    const chunks = []; const seen = new Set(); let id = entry.start; let size = 0;
    while (id < 0xFFFFFFFA) {
      if (seen.has(id) || seen.size >= limits.maxStreams) throw typed('extraction_failed', 'MSG_MINI_CHAIN_LOOP');
      seen.add(id); const start = id * 64;
      if (start + 64 > miniStream.length) throw typed('extraction_failed', 'MSG_MINI_SECTOR_RANGE');
      chunks.push(miniStream.subarray(start, start + 64)); size += 64;
      if (size > limits.maxStreamBytes) throw typed('limits_exceeded', 'MSG_STREAM_LIMIT');
      id = miniFat[id];
    }
    return Buffer.concat(chunks).subarray(0, entry.size);
  };
  const streams = new Map();
  for (const entry of entries) {
    if (entry.type !== 2 || entry.size <= 0 || entry.size >= 4096) continue;
    try { streams.set(entry.name, { entry, status: 'present', data: readMini(entry) }); }
    catch (error) { streams.set(entry.name, { entry, status: error.code === 'limits_exceeded' ? 'unsupported' : 'extraction_failed', data: null }); }
  }
  for (const entry of entries) {
    if (entry.type !== 2 || entry.size <= 0 || entry.size < 4096) continue;
    try { streams.set(entry.name, { entry, status: 'present', data: chain(entry.start).subarray(0, Math.min(entry.size, limits.maxStreamBytes)) }); }
    catch (error) { streams.set(entry.name, { entry, status: error.code === 'limits_exceeded' ? 'unsupported' : 'extraction_failed', data: null }); }
  }
  return { entries, streams };
}
function typed(code, message) { const error = new Error(message); error.code = code; return error; }
function decodeProperty(item, type) {
  if (!item?.data) return '';
  if (type === '001f') return item.data.toString('utf16le').replace(/\0+$/, '');
  if (type === '001e') return item.data.toString('latin1').replace(/\0+$/, '');
  return '';
}
function parseMsg(buffer, options = {}) {
  const limits = Object.assign({}, DEFAULT_LIMITS, options.limits || {});
  const sourceHash = hash(buffer);
  let cfb;
  try { cfb = readCfb(buffer, limits); } catch (error) {
    return { status: error.code || 'extraction_failed', sourceType: 'outlook-msg', text: '', message: error.message, blocks: [] };
  }
  const find = (tag, types = ['001f', '001e']) => {
    for (const type of types) {
      const key = `__substg1.0_${tag}${type}`.toLowerCase();
      const match = [...cfb.streams.entries()].find(([name]) => name.toLowerCase() === key);
      if (match) {
        let value = decodeProperty(match[1], type);
        if (type === '0102' && match[1].data && tag === '1013') value = match[1].data.toString('utf8').replace(/\0+$/, '');
        if (type === '0040' && match[1].data?.length >= 8) {
          const ticks = match[1].data.readBigUInt64LE(0);
          const millis = Number(ticks / 10000n) - 11644473600000;
          if (Number.isFinite(millis)) value = new Date(millis).toISOString();
        }
        return { value, stream: match[0], status: match[1].status };
      }
    }
    return { value: '', stream: `property:${tag}`, status: 'missing' };
  };
  const props = {
    subject: find('0037'), sender: find('0c1a'), sender_email: find('5d01'), to: find('0e04'), cc: find('0e03'),
    sent_at: find('0039', ['0040']), received_at: find('0e06', ['0040']), headers: find('007d'),
    plain: find('1000'), html: find('1013', ['001f', '001e', '0102']), rtf: find('1009', ['0102'])
  };
  for (const field of ['headers', 'plain', 'html']) {
    props[field].value = String(props[field].value || '').replace(/https?:\/\/[^\s"'<>]+/gi, (url) => redactQueryTokens(url));
  }
  const blocks = []; let order = 0;
  for (const [field, prop] of Object.entries(props)) {
    const status = prop.value ? 'present' : prop.status;
    const classification = classifyContent(prop.value);
    blocks.push(createBlock({
      source_hash: sourceHash, order: order++, kind: field, raw_text: prop.value.slice(0, limits.maxTextChars),
      locator: { scheme: 'mapi-stream', value: prop.stream }, parse_method: 'msg-cfb-mapi',
      status, card_eligible: classification.eligible && !['headers', 'sent_at', 'received_at'].includes(field),
      exclusion_reason: classification.kind || (!['headers', 'sent_at', 'received_at'].includes(field) ? '' : 'envelope_metadata'),
      metadata: { property: field, raw_presence: status, redacted: false }
    }));
  }
  const urls = [...new Set(`${props.html.value}\n${props.plain.value}`.match(/https?:\/\/[^\s"'<>]+/gi) || [])].slice(0, 512);
  for (const url of urls) {
    const classification = classifyContent('', { url });
    blocks.push(createBlock({
      source_hash: sourceHash, order: order++, kind: classification.kind || 'remote_asset', raw_text: redactQueryTokens(url),
      locator: { scheme: 'mapi-derived-url', value: `url:${order}` }, parse_method: 'msg-url-inventory', status: 'present',
      card_eligible: classification.eligible, exclusion_reason: classification.kind || 'remote_asset',
      metadata: { remote: true, query_tokens_redacted: true }
    }));
  }
  const body = props.plain.value || props.html.value.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  const replyClues = /(^|\n)(from:|sent:|to:|subject:|发件人：|发送时间：|-----original message-----)/im.test(body);
  const attachments = cfb.entries.filter((e) => /^__attach_version1\.0_/i.test(e.name)).slice(0, limits.maxAttachments).map((e) => ({
    locator: { scheme: 'cfb-directory', value: `entry:${e.id}` }, name: e.name, inline: 'unknown', status: 'unsupported'
  }));
  for (const attachment of attachments) {
    blocks.push(createBlock({
      source_hash: sourceHash, order: order++, kind: 'attachment', raw_text: '',
      locator: attachment.locator, parse_method: 'msg-cfb-directory', status: attachment.status,
      card_eligible: false, exclusion_reason: 'attachment_inventory',
      metadata: { filename: attachment.name, inline: attachment.inline }
    }));
  }
  return {
    status: 'ok', sourceType: 'outlook-msg', text: body, blocks,
    metadata: {
      subject: props.subject.value, from: props.sender_email.value || props.sender.value, to: props.to.value, cc: props.cc.value,
      headers: props.headers.value, body_presence: { plain: !!props.plain.value, html: !!props.html.value, rtf: props.rtf.status === 'present' },
      reply_chain_clues: replyClues, attachments, parse_warnings: blocks.filter((b) => b.parse.status !== 'present').map((b) => `${b.kind}:${b.parse.status}`)
    }
  };
}

function inspectPdf(buffer, options = {}) {
  const limits = Object.assign({}, DEFAULT_LIMITS, options.limits || {});
  const sourceHash = hash(buffer);
  if (!Buffer.isBuffer(buffer) || !buffer.subarray(0, 8).toString('latin1').startsWith('%PDF-')) return { status: 'unsupported', sourceType: 'pdf', message: 'PDF_SIGNATURE', blocks: [] };
  if (buffer.length > limits.maxFileBytes) return { status: 'limits_exceeded', sourceType: 'pdf', message: 'PDF_FILE_LIMIT', blocks: [] };
  const raw = buffer.toString('latin1');
  const pageMatches = [...raw.matchAll(/\/Type\s*\/Page(?!s)\b/g)].slice(0, limits.maxPdfPages);
  const imageMatches = [...raw.matchAll(/\/Subtype\s*\/Image\b/g)];
  const fontMatches = [...raw.matchAll(/\/(?:Font|ToUnicode)\b/g)];
  const textOps = [...raw.matchAll(/\b(?:BT|Tj|TJ)\b/g)];
  const rotations = [...raw.matchAll(/\/Rotate\s+(-?\d+)/g)].map((m) => Number(m[1]));
  const pages = []; const blocks = [];
  const count = Math.max(1, pageMatches.length);
  for (let i = 0; i < count; i += 1) {
    const start = pageMatches[i]?.index || 0; const end = pageMatches[i + 1]?.index || raw.length;
    const segment = raw.slice(start, end);
    const hasImage = /\/Subtype\s*\/Image\b/.test(segment) || (count === 1 && imageMatches.length > 0);
    const hasText = /\b(?:BT|Tj|TJ)\b/.test(segment) || (count === 1 && fontMatches.length > 0 && textOps.length > 0);
    const classification = hasText && hasImage ? 'mixed' : hasText ? 'native' : hasImage ? 'scanned' : 'blank';
    const rotation = rotations[i] ?? rotations[0] ?? 0;
    const page = {
      page: i + 1, classification, rotation, dpi: null,
      image_locators: hasImage ? [{ scheme: 'pdf-object-scan', value: `page:${i + 1}:image` }] : [],
      ocr: { required: classification === 'scanned' || classification === 'mixed', status: classification === 'native' ? 'not_required' : (classification === 'blank' ? 'not_applicable' : 'provider_required') },
      visual: { stamp_visible: 'unknown', signature_visible: 'unknown', approval_status: 'unverified' }
    };
    pages.push(page);
    blocks.push(createBlock({
      source_hash: sourceHash, order: i, kind: 'pdf_page_inventory', raw_text: '',
      locator: { scheme: 'pdf-page', value: `page:${i + 1}` }, parse_method: 'pdf-local-inventory',
      status: classification === 'blank' ? 'missing' : 'present', card_eligible: false,
      exclusion_reason: 'inventory_only', metadata: page
    }));
  }
  const pureScan = pages.some((p) => p.classification === 'scanned') && pages.every((p) => ['scanned', 'blank'].includes(p.classification));
  return {
    status: 'ok', sourceType: 'pdf', blocks, pages, text: '',
    metadata: { page_inventory_version: 'pdf_inventory_v0', pure_scan: pureScan, ocr_required: pages.some((p) => p.ocr.required), deterministic: true }
  };
}
function blocksToMarkdown(blocks) {
  return (blocks || []).filter((b) => b.parse.status === 'present' && b.raw.text).map((b) => b.raw.text).join('\n\n').trim();
}
function normalizeLocalTextBlocks(text, options = {}) {
  const sourceHash = String(options.sourceHash || hash(options.buffer || ''));
  const sourceType = String(options.sourceType || 'txt');
  const scheme = sourceType === 'md' ? 'markdown-line' : sourceType === 'email' ? 'email-body-line' : 'text-line';
  const lines = String(text || '').replace(/\r\n?/g, '\n').split('\n');
  const blocks = [];
  let order = Math.max(0, Number(options.orderStart) || 0);
  const add = (kind, value, start, end, extra = {}) => {
    const raw = String(value || '').trim();
    if (!raw) return;
    const classification = classifyContent(raw);
    blocks.push(createBlock({
      source_hash: sourceHash, order: order++, kind, raw_text: raw,
      locator: { scheme, value: `L${start + 1}-L${end + 1}` },
      parse_method: `${sourceType}-block-v0`, status: 'present',
      card_eligible: extra.card_eligible === false ? false : classification.eligible,
      exclusion_reason: extra.exclusion_reason || classification.kind || '',
      metadata: Object.assign({ line_start: start + 1, line_end: end + 1 }, extra.metadata || {})
    }));
  };
  let paragraph = []; let paragraphStart = 0; let fenced = false; let fenceStart = 0; let fence = [];
  const flushParagraph = (end) => {
    if (paragraph.length) add('paragraph', paragraph.join('\n'), paragraphStart, end);
    paragraph = [];
  };
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (/^\s*```/.test(line)) {
      flushParagraph(index - 1);
      if (!fenced) { fenced = true; fenceStart = index; fence = [line]; }
      else { fence.push(line); add('code_block', fence.join('\n'), fenceStart, index); fenced = false; fence = []; }
      continue;
    }
    if (fenced) { fence.push(line); continue; }
    if (!line.trim()) { flushParagraph(index - 1); continue; }
    const heading = /^(#{1,6})\s+(.+)$/.exec(line);
    if (heading) {
      flushParagraph(index - 1);
      add('heading', line, index, index, { metadata: { level: heading[1].length } });
      continue;
    }
    if (/^\s*(?:[-*+]|\d+[.)])\s+/.test(line)) {
      flushParagraph(index - 1); add('list_item', line, index, index); continue;
    }
    if (/^\s*\|.*\|\s*$/.test(line)) {
      flushParagraph(index - 1);
      const start = index; const table = [line];
      while (index + 1 < lines.length && /^\s*\|.*\|\s*$/.test(lines[index + 1])) table.push(lines[++index]);
      add('table', table.join('\n'), start, index); continue;
    }
    if (!paragraph.length) paragraphStart = index;
    paragraph.push(line);
  }
  if (fenced) add('code_block', fence.join('\n'), fenceStart, lines.length - 1, { metadata: { unterminated: true } });
  flushParagraph(lines.length - 1);
  return blocks;
}
function createEmailBlocks(email, bodyText, buffer) {
  const sourceHash = hash(buffer || '');
  const blocks = []; let order = 0;
  for (const [field, value] of [['subject', email.subject], ['from', email.from], ['to', email.to], ['cc', email.cc], ['date', email.date], ['message_id', email.messageId]]) {
    if (!String(value || '').trim()) continue;
    blocks.push(createBlock({
      source_hash: sourceHash, order: order++, kind: `email_${field}`, raw_text: String(value),
      locator: { scheme: 'mime-header', value: field }, parse_method: 'eml-mime',
      status: 'present', card_eligible: field === 'subject', exclusion_reason: field === 'subject' ? '' : 'envelope_metadata'
    }));
  }
  const body = normalizeLocalTextBlocks(bodyText, { sourceHash, sourceType: 'email', orderStart: order });
  blocks.push(...body);
  order += body.length;
  for (let index = 0; index < (email.attachments || []).length; index += 1) {
    const attachment = email.attachments[index];
    blocks.push(createBlock({
      source_hash: sourceHash, order: order++, kind: 'attachment', raw_text: '',
      locator: { scheme: 'mime-attachment', value: `part:${index + 1}` }, parse_method: 'eml-mime',
      status: 'present', card_eligible: false, exclusion_reason: 'attachment_inventory',
      metadata: {
        filename: String(attachment.filename || ''), content_type: String(attachment.contentType || ''),
        size_bytes: Buffer.isBuffer(attachment.data) ? attachment.data.length : 0
      }
    }));
  }
  return blocks;
}
function localTextPackingOptions(options) {
  const input = options && typeof options === 'object' ? options : {};
  const legacyTokenBudget = Math.max(16, Number(input.hardBudget) || 2000);
  const characterEquivalentBudget = legacyTokenBudget * 4;
  return Object.assign({}, input, {
    hardBudget: characterEquivalentBudget,
    softBudget: characterEquivalentBudget
  });
}
module.exports = {
  BLOCK_SCHEMA_VERSION, DEFAULT_LIMITS, blocksToMarkdown, classifyContent, createBlock, estimateTokens,
  createEmailBlocks, inspectPdf, localTextPackingOptions, normalizeLocalTextBlocks, packBlocks, parseMsg, redactQueryTokens, stableId, validateBlock
};

},
/**
 * @module src/core/extractors
 * 二进制 / 纯文本文件解析入口；委托给 document-parser + external-pdf
 * @exports extractTextFromBuffer
 */
"src/core/extractors.js": function(require, module, exports) {
const { createParsePackage, documentPlan } = require("src/core/document-parser.js");
const { extractDocumentWithApis } = require("src/core/external-pdf.js");
const { blocksToMarkdown, createBlock, createEmailBlocks, inspectPdf, localTextPackingOptions, normalizeLocalTextBlocks, packBlocks, parseMsg } = require("src/core/block-v0.js");
const { probeLocalOcr, runLocalPdfOcr } = require("src/core/local-ocr.js");
const { parseOoxml } = require("src/core/ooxml.js");

async function extractTextFromBuffer(filePath, buffer, options = {}) {
  const plan = documentPlan(filePath);
  if (plan.mode === 'unsupported') {
    return {
      status: 'unsupported_media',
      text: '',
      sourceType: plan.sourceType,
      message: unsupportedMessage(plan.sourceType)
    };
  }
  if (plan.mode === 'text') {
    const result = textResult(buffer, plan.sourceType);
    if (result.status !== 'ok' || options.localTextBlockAdapter === false) return withParsePackage(result, {
      sourcePath: filePath,
      buffer,
      sourceType: plan.sourceType,
      parser: 'text-normalizer'
    });
    const blocks = normalizeLocalTextBlocks(result.text, { buffer, sourceType: plan.sourceType });
    const packed = options.blockPacking === false ? { packs: [], metrics: { disabled: true } } : packBlocks(blocks, localTextPackingOptions(options.blockPacking));
    result.blocks = blocks;
    result.metadata = { block_metrics: packed.metrics, block_normalizer: 'local-text-v0' };
    return withParsePackage(result, {
      sourcePath: filePath, buffer, sourceType: plan.sourceType, parser: 'text-block-v0',
      metadata: result.metadata, blocks, blockPacks: packed.packs
    });
  }
  if (plan.mode === 'email') {
    // v2.9.0: 改走 MIME 解析（parseEmailMessage），提取附件二进制与完整头部。
    const email = parseEmailMessage(buffer);
    const attachmentMeta = (email.attachments || []).map((item) => ({
      filename: item.filename,
      contentType: item.contentType,
      size: item.data ? item.data.length : 0
    }));
    // v2.9.0: 空正文但有附件的邮件不再判 failed，合成占位正文，
    //   保证附件一定能进入保存/切片流程，同时给总结阶段附件上下文。
    const bodyText = email.text || (attachmentMeta.length
      ? `本邮件正文为空，包含 ${attachmentMeta.length} 个附件：${attachmentMeta.map((item) => item.filename).join('、')}。`
      : '');
    const metadata = {
      subject: email.subject,
      from: email.from,
      to: email.to,
      cc: email.cc,
      date: email.date,
      messageId: email.messageId,
      sourceEncoding: 'mime',
      attachments: attachmentMeta
    };
    const result = readableTextResult(bodyText, 'email', { encoding: 'mime' });
    result.title = email.subject;
    result.metadata = metadata;
    // 附件二进制挂在 result 上（不进 parsePackage 的 JSON 序列化），
    // 由 processTask 落盘到 _attachments 并入队切片。
    result.attachments = email.attachments || [];
    if (options.localTextBlockAdapter !== false && result.status === 'ok') {
      const blocks = createEmailBlocks(email, bodyText, buffer);
      const packed = options.blockPacking === false ? { packs: [], metrics: { disabled: true } } : packBlocks(blocks, localTextPackingOptions(options.blockPacking));
      result.blocks = blocks;
      result.metadata = Object.assign({}, metadata, { block_metrics: packed.metrics, block_normalizer: 'eml-block-v0' });
      return withParsePackage(result, {
        sourcePath: filePath, buffer, sourceType: 'email', parser: 'eml-block-v0',
        metadata: result.metadata, blocks, blockPacks: packed.packs
      });
    }
    return withParsePackage(result, {
      sourcePath: filePath,
      buffer,
      sourceType: 'email',
      parser: 'eml-parser',
      metadata
    });
  }
  if (plan.mode === 'msg') {
    if (options.localMsgAdapter === false) return { status: 'unsupported_media', text: '', sourceType: 'outlook-msg', message: '本地 MSG 适配器已关闭。' };
    const msg = parseMsg(buffer, options.msgAdapter || {});
    if (msg.status !== 'ok') return msg;
    const packed = options.blockPacking === false ? { packs: [], metrics: { disabled: true } } : packBlocks(msg.blocks, options.blockPacking || {});
    const bodyText = msg.text || blocksToMarkdown(msg.blocks) || `Outlook 邮件正文为空。主题：${msg.metadata.subject || '(无主题)'}`;
    const result = readableTextResult(bodyText, 'outlook-msg', { encoding: 'cfb-mapi' });
    result.title = msg.metadata.subject;
    result.metadata = Object.assign({}, msg.metadata, { block_metrics: packed.metrics });
    result.blocks = msg.blocks;
    result.attachments = [];
    return withParsePackage(result, {
      sourcePath: filePath, buffer, sourceType: 'outlook-msg', parser: 'msg-cfb-mapi',
      metadata: result.metadata, blocks: msg.blocks, blockPacks: packed.packs
    });
  }
  if (plan.mode === 'ooxml') {
    const enabled = plan.sourceType === 'docx'
      ? options.localOoxml?.docxEnabled !== false
      : plan.sourceType === 'pptx'
        ? options.localOoxml?.pptxEnabled !== false
        : options.localOoxml?.xlsxEnabled !== false;
    if (enabled) {
      const local = parseOoxml(buffer, plan.sourceType, {
        limits: options.localOoxml?.limits || {}, signal: options.signal
      });
      if (local.status === 'ok' || local.status === 'review_required') {
        const packed = options.blockPacking === false ? { packs: [], metrics: { disabled: true } } : packBlocks(local.blocks, options.blockPacking || {});
        local.metadata = Object.assign({}, local.metadata, { block_metrics: packed.metrics });
        if (local.status === 'ok') return withParsePackage(local, {
          sourcePath: filePath, buffer, sourceType: plan.sourceType, parser: local.extractor,
          metadata: local.metadata, blocks: local.blocks, blockPacks: packed.packs
        });
        local.parsePackage = createParsePackage({
          sourcePath: filePath, buffer, sourceType: plan.sourceType, parser: local.extractor,
          markdown: '', language: local.sourceLanguage, metadata: local.metadata,
          blocks: local.blocks, blockPacks: packed.packs
        });
        return local;
      }
      if (local.status === 'cancelled') return local;
      if (options.pdfExtractor?.allowExternalUpload !== true) {
        return Object.assign({}, local, {
          actionable: { code: local.code, retryable: local.status !== 'unsupported', external_upload_required: true }
        });
      }
    }
  }

  const fileName = String(filePath || '').split(/[\\/]/).pop() || 'source';
  const pdfInventory = plan.sourceType === 'pdf' && options.localPdfInventory !== false ? inspectPdf(buffer, options.pdfInventory || {}) : null;
  const config = Object.assign({}, options.pdfExtractor || {}, options.documentExtractor || {}, {
    fileName,
    order: plan.engines.join(','),
    mineruApiModel: plan.mineruModel
  });
  if (pdfInventory?.status === 'ok' && pdfInventory.metadata?.ocr_required && options.localOcr?.enabled === true) {
    const probe = await probeLocalOcr(options.localOcr, options.localOcrDependencies || {});
    if (probe.available) {
      const local = await runLocalPdfOcr({
        pdfBuffer: buffer, pages: pdfInventory.pages, sourceHash: pdfInventory.blocks[0]?.source_hash || '',
        settings: options.localOcr, probe, signal: options.signal,
        loadCheckpoint: options.loadOcrCheckpoint, saveCheckpoint: options.saveOcrCheckpoint
      }, options.localOcrDependencies || {});
      const ocrBlocks = local.pages.flatMap((page) => page.blocks.map((block, index) => createBlock({
        source_hash: pdfInventory.blocks[0]?.source_hash || '', order: (page.page * 100000) + index,
        kind: block.visual_type || 'ocr_text', raw_text: block.text, raw_fields: block.raw_fields,
        inferred: block.inferred, locator: block.locator, provenance: [block.locator],
        parse_method: `local-ocr:${local.provider}`, parse_quality: block.confidence,
        status: block.text ? 'present' : 'missing', card_eligible: block.card_eligible,
        exclusion_reason: block.exclusion_reason,
        metadata: { page: page.page, confidence: block.confidence, language: block.language,
          visual_type: block.visual_type, approval_status: block.visual_type ? 'unverified' : undefined }
      })));
      const allBlocks = [...pdfInventory.blocks, ...ocrBlocks].sort((a, b) => a.order - b.order);
      const packed = options.blockPacking === false ? { packs: [], metrics: { disabled: true } } : packBlocks(allBlocks, options.blockPacking || {});
      const text = local.pages.map((page) => page.text).filter(Boolean).join('\n\n').trim();
      if (text) {
        return withParsePackage({
          status: 'ok', text, sourceType: 'pdf', sourceEncoding: `local-ocr:${local.provider}`,
          sourceLanguage: local.pages.find((page) => page.language)?.language || 'unknown',
          extractor: `local-ocr:${local.provider}`,
          metadata: { local_ocr: { provider: local.provider, provider_version: local.providerVersion, metrics: local.metrics } }
        }, {
          sourcePath: filePath, buffer, sourceType: 'pdf', parser: `local-ocr:${local.provider}`,
          pages: mergeOcrPages(pdfInventory.pages, local.pages), blocks: allBlocks, blockPacks: packed.packs,
          metadata: { pdf_inventory: pdfInventory.metadata, local_ocr: {
            provider: local.provider, provider_version: local.providerVersion,
            settings_fingerprint: local.settingsFingerprint, metrics: local.metrics, block_metrics: packed.metrics
          }}
        });
      }
    }
  }
  const external = await extractDocumentWithApis(buffer, config);
  if (!external || external.status !== 'ok') {
    if (pdfInventory?.status === 'ok' && pdfInventory.metadata?.pure_scan) {
      return {
        status: 'ocr_required', text: '', sourceType: 'pdf', sourceEncoding: 'pdf-local-inventory',
        extractor: 'pdf-local-inventory',
        message: 'PDF 为纯扫描件；本地页清单已完成，需要配置 OCR 提供方或明确授权现有远程解析。',
        blocks: pdfInventory.blocks, pageInventory: pdfInventory.pages,
        actionable: { code: 'PDF_OCR_PROVIDER_REQUIRED', retryable: true, external_upload_required: true }
      };
    }
    return {
      status: 'failed',
      text: '',
      sourceType: plan.sourceType,
      sourceEncoding: external?.engine || '',
      sourceLanguage: 'unknown',
      extractor: external?.engine || 'document-api',
      message: external?.message || '云端文档解析失败。'
    };
  }
  const text = String(external.text || '').trim();
  return withParsePackage({
    status: 'ok',
    text,
    sourceType: plan.sourceType,
    sourceEncoding: external.engine || 'document-api',
    sourceLanguage: detectDominantLanguage(text),
    extractor: external.engine || 'document-api',
    metadata: external.metadata || {}
  }, {
    sourcePath: filePath,
    buffer,
    sourceType: plan.sourceType,
    parser: external.engine,
    parserModel: config.mineruApiModel,
    remoteJobId: external.remoteJobId,
    pages: external.pages,
    images: external.images,
    provenance: external.provenance,
    blocks: pdfInventory?.blocks || [],
    pageInventory: pdfInventory?.pages || [],
    metadata: Object.assign({}, external.metadata || {}, pdfInventory ? { pdf_inventory: pdfInventory.metadata } : {})
  });
}

function mergeOcrPages(inventoryPages, ocrPages) {
  const byPage = new Map((ocrPages || []).map((page) => [Number(page.page), page]));
  return (inventoryPages || []).map((page) => {
    const ocr = byPage.get(Number(page.page));
    if (!ocr) return page;
    return Object.assign({}, page, {
      text: ocr.text,
      blocks: ocr.blocks.map((block, index) => ({
        text: block.text, bbox: block.bbox, confidence: block.confidence,
        language: block.language, line_id: index + 1, block_id: block.visual_type || 'ocr'
      })),
      ocr: Object.assign({}, page.ocr, {
        status: ocr.status, provider: 'local', confidence: ocr.confidence,
        language: ocr.language, block_count: ocr.blocks.length
      })
    });
  });
}

function withParsePackage(result, options) {
  if (!result || result.status !== 'ok') return result;
  result.parsePackage = createParsePackage(Object.assign({}, options, {
    markdown: result.text,
    language: result.sourceLanguage || 'unknown'
  }));
  return result;
}

function unsupportedMessage(sourceType) {
  if (sourceType === 'outlook-msg') return '暂不支持 Outlook MSG，请导出为 EML 后处理。';
  if (sourceType === 'video' || sourceType === 'audio') return '音视频处理属于后续版本能力。';
  return '不支持的文件类型。';
}

function textResult(buffer, sourceType) {
  const decoded = decodeTextBuffer(buffer);
  return readableTextResult(decoded.text, sourceType, decoded);
}

function readableTextResult(text, sourceType, decoded = {}) {
  const clean = String(text || '').trim();
  if (looksLikeGibberish(clean)) {
    return {
      status: 'failed',
      text: '',
      sourceType,
      sourceEncoding: decoded.encoding || '',
      sourceLanguage: detectDominantLanguage(clean),
      message: '文本内容疑似编码错误或二进制乱码，请转换为受支持的文本编码后重试。'
    };
  }
  return {
    status: clean ? 'ok' : 'failed',
    text: clean,
    sourceType,
    sourceEncoding: decoded.encoding || '',
    sourceLanguage: detectDominantLanguage(clean),
    message: clean ? '' : '未读取到可用文本。'
  };
}

function decodeTextBuffer(buffer) {
  const input = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer || '');
  if (input.length === 0) return decodedCandidate('utf-8', '');
  // v2.9.2: 增强二进制检测——常见二进制文件魔数优先拒收
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  // JPEG: FF D8 FF
  // PDF: 25 50 44 46
  // ZIP: 50 4B 03 04 或 50 4B 05 06 或 50 4B 07 08
  // RAR: 52 61 72 21
  if (input.length >= 4) {
    // PNG检测：前8字节完整匹配
    if (input.length >= 8 && input[0] === 0x89 && input[1] === 0x50 && input[2] === 0x4E && input[3] === 0x47) {
      return decodedCandidate('binary-rejected', '');
    }
    // JPEG检测：FF D8 FF
    if (input[0] === 0xFF && input[1] === 0xD8 && input[2] === 0xFF) {
      return decodedCandidate('binary-rejected', '');
    }
    // PDF检测：25 50 44 46 (%PDF)
    if (input[0] === 0x25 && input[1] === 0x50 && input[2] === 0x44 && input[3] === 0x46) {
      return decodedCandidate('binary-rejected', '');
    }
    // ZIP检测：50 4B (PK)
    if (input[0] === 0x50 && input[1] === 0x4B) {
      return decodedCandidate('binary-rejected', '');
    }
    // RAR检测：52 61 72 21 (Rar!)
    if (input[0] === 0x52 && input[1] === 0x61 && input[2] === 0x72 && input[3] === 0x21) {
      return decodedCandidate('binary-rejected', '');
    }
  }
  // 文本缓冲区告警：含 NUL 字节的文件几乎可以肯定是二进制（PDF/ZIP/图片等），
  // 即便扩展名是 .md/.txt 也要拒收，避免二进制字节流被当文本送进 AI。
  const nulCount = countByte(input, 0x00);
  if (nulCount > 0 && (!looksLikeLegitimateText(input) || nulCount > 2)) {
    // v2.9.1: 无 BOM 的 UTF-16 文本（ASCII 字符隔字节为 0x00）含大量 NUL，
    //   旧逻辑直接按二进制拒收。字节分布符合 UTF-16 特征时放行，交给候选评分。
    if (!looksLikeUtf16Bytes(input)) return decodedCandidate('binary-rejected', '');
  }
  if (input.length >= 3 && input[0] === 0xef && input[1] === 0xbb && input[2] === 0xbf) {
    return decodedCandidate('utf-8-bom', input.slice(3).toString('utf8'));
  }
  if (input.length >= 2 && input[0] === 0xff && input[1] === 0xfe) {
    return decodedCandidate('utf-16le-bom', input.slice(2).toString('utf16le'));
  }
  if (input.length >= 2 && input[0] === 0xfe && input[1] === 0xff) {
    return decodeWithTextDecoder(input.slice(2), 'utf-16be')
      || decodedCandidate('utf-16be-bom', swapUtf16Bytes(input.slice(2)).toString('utf16le'));
  }

  // v2.9.2: 性能优化——先尝试 UTF-8 快速路径
  // 对于纯 ASCII 或有效 UTF-8，直接返回不尝试其他编码
  const utf8Text = input.toString('utf8');
  const utf8Valid = !utf8Text.includes('\uFFFD') && utf8Text.length > 0;
  let hasNonAscii = false;
  for (let i = 0; i < utf8Text.length && i < 1000; i += 1) {
    if (utf8Text.charCodeAt(i) > 127) { hasNonAscii = true; break; }
  }
  // UTF-8 快速路径：有效 UTF-8 + 含非ASCII → 直接返回
  // v2.9.2: 不再检查ShiftJIS字节特征，因为有效UTF-8本身已经是强信号
  if (utf8Valid && hasNonAscii) {
    const score = readabilityScore(utf8Text);
    if (score > 0.8) return decodedCandidate('utf-8', utf8Text);
  }

  // v2.9.1: gb18030 提到 shift_jis/windows-31j 之前——评分平手时 GB 优先。
  //   真日文文档靠 looksLikeShiftJisBytes 的 +0.35 加分仍会胜出，不受影响；
  //   而 GBK 文档被 ShiftJIS 解成半角片假名是最常见的静默乱码（评分经常打平）。
  const candidates = [
    decodedCandidate('utf-8', utf8Text),
    decodedCandidate('utf-16le', input.toString('utf16le')),
    decodeWithTextDecoder(input, 'utf-16be'),
    decodeWithTextDecoder(input, 'gb18030'),
    decodeWithTextDecoder(input, 'shift_jis'),
    decodeWithTextDecoder(input, 'windows-31j'),
    decodeWithTextDecoder(input, 'big5'),
    // v2.9.1: 韩文 EUC-KR 与西欧 windows-1252 候选。
    //   旧版缺 euc-kr → 韩文被 gb18030 静默误解成错误汉字（无任何报错）；
    //   缺 windows-1252 → cp1252 特有字符（€ ’ “ 等 0x80-0x9F 区）按 latin1 解出 C1 控制符。
    //   gb18030 排在 big5/euc-kr 之前：平分时 GB 优先（本插件语料以大陆简体为主）。
    decodeWithTextDecoder(input, 'euc-kr'),
    decodeWithTextDecoder(input, 'windows-1252'),
    decodedCandidate('latin1', input.toString('latin1'))
  ].filter(Boolean);
  for (const candidate of candidates) {
    candidate.score += encodingHeuristicBonus(input, candidate.encoding, candidate.text);
  }
  candidates.sort((a, b) => b.score - a.score);
  // 自适应兜底：当最优候选的 readability 分数仍低于阈值时，认为解码失败。
  // 返回 'utf-8' 空文本而不是乱码文本，让调用方走 failed 分支。
  const best = candidates[0];
  if (!best || best.score < DECODE_MIN_CONFIDENCE) {
    return decodedCandidate('low-confidence', best ? best.text : '');
  }
  return best;
}

// 文本缓冲区中含 NUL 字节时是否仍可能是合法文本？
// 唯一例外是使用了 PUA/控制字符的某些专业日志，但通用插件场景下 NUL ≈ 二进制。
function looksLikeLegitimateText(buffer) {
  if (Buffer.isBuffer(buffer) && buffer.length >= 3) {
    if (buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) return true;
    if (buffer[0] === 0xff && buffer[1] === 0xfe) return true;
    if (buffer[0] === 0xfe && buffer[1] === 0xff) return true;
  }
  return false;
}

function countByte(buffer, byte) {
  let n = 0;
  const len = Buffer.isBuffer(buffer) ? buffer.length : 0;
  for (let i = 0; i < len; i += 1) if (buffer[i] === byte) n += 1;
  return n;
}

const DECODE_MIN_CONFIDENCE = -0.15;

function encodingHeuristicBonus(buffer, encoding, text) {
  const enc = String(encoding || '').toLowerCase();
  const looksSjis = looksLikeShiftJisBytes(buffer);

  // v2.9.2: Shift_JIS 最高优先级——如果字节符合SJIS特征
  if (looksSjis) {
    // Shift_JIS / windows-31j 且包含日文字符（假名或汉字）
    if (enc === 'shift_jis' || enc === 'windows-31j') {
      if (/[぀-ヿ一-鿿]/.test(text)) return 0.65;  // 强于其他编码
      return 0.45;  // 即使没有日文字符，字节特征也是强信号
    }
    // 其他编码尝试解码SJIS字节流，降低优先级
    if (enc === 'windows-1252' || enc === 'latin1' || enc === 'gb18030') {
      return -0.5;
    }
  }

  // v2.9.1: UTF-8 优先门。旧版仅在「有效 UTF-8 且含 CJK」时加分，导致
  //   越南语/俄语/法语等无 CJK 的合法 UTF-8 文档被 ShiftJIS/GB18030 候选
  //   的伪 CJK 解码反超（UTF-8 三字节序列与 SJIS/GBK 双字节区间高度重叠）。
  //   新判据：零替换字符 + 含任意非 ASCII 字节 → 该字节流几乎不可能是其他
  //   编码（GBK/SJIS/Big5/EUC-KR 文本同时构成合法 UTF-8 序列的概率趋近于 0；
  //   纯 ASCII 各编码解码相同，不需要仲裁）→ 强倾向 UTF-8 并压制误码候选。
  const utf8Text = buffer.toString('utf8');
  const utf8Valid = !utf8Text.includes('\uFFFD') && utf8Text.length > 0;
  let hasNonAscii = false;
  for (let i = 0; i < utf8Text.length; i += 1) {
    if (utf8Text.charCodeAt(i) > 127) { hasNonAscii = true; break; }
  }
  if (utf8Valid && hasNonAscii) {
    if (enc === 'utf-8' || enc === 'utf-8-bom') return hasCjk(utf8Text) ? 0.5 : 0.45;
    if (enc === 'shift_jis' || enc === 'windows-31j' || enc === 'gb18030' || enc === 'big5' || enc === 'euc-kr') return -0.5;
  }
  if ((enc === 'utf-16le' || enc === 'utf-16be') && !looksLikeUtf16Bytes(buffer)) return -2;
  if ((enc === 'gb18030' || enc === 'big5') && looksSjis) return -0.12;
  // v2.9.1: 韩文 EUC-KR——字节符合 KS X 1001 韩文字区特征且解码后出现
  //   韩文音节、无替换字符 → 强烈倾向 euc-kr；符合该字节特征的缓冲同时
  //   惩罚 gb18030/big5/sjis，避免韩文被静默误解成错误汉字。
  const eucKrBytes = looksLikeEucKrBytes(buffer);
  if (enc === 'euc-kr' && eucKrBytes && /[가-힣]/.test(text) && !text.includes('�')) return 0.6;
  if ((enc === 'gb18030' || enc === 'big5' || enc === 'shift_jis' || enc === 'windows-31j') && eucKrBytes) return -0.3;
  // v2.9.1: Big5——解码出现注音符号即可较有把握判定为台湾内容。
  //   不单独按字节结构加分：Big5 与 GB2312 字节段高度重叠，字节启发会把
  //   简体中文误判成 Big5（静默乱码），平分时保持 gb18030 优先。
  if (enc === 'big5' && /[ㄅ-ㄯ]/.test(text)) return 0.35;
  // v2.9.1: 西欧单字节编码——合法重音字母现已计入可读字符不再扣分。
  //   仅当「高字节密度异常（>15%）且解码文本确实带乱码证据」才惩罚：
  //   GBK 误解成 latin1 会产生大量 C1 控制符，误解成 cp1252 会产生乱码
  //   二联体（C0-DF 后跟 80-BF 区符号）；真西欧文本（含 € " ' 等
  //   cp1252 专有符号）两个信号都为 0，不受惩罚。
  if ((enc === 'latin1' || enc === 'windows-1252') && highByteRatio(buffer) > 0.15) {
    const chars = [...String(text || '')];
    const tn = chars.length || 1;
    const c1 = chars.filter((ch) => { const cp = ch.codePointAt(0); return cp >= 0x80 && cp <= 0x9f; }).length / tn;
    const dig = countMojibakeDigraphs(text) / tn;
    if (c1 > 0.01 || dig > 0.02) return -0.6;
  }
  // v2.9.2: 单字节 windows-1252 专有符号（0x80-0x9F 区）强倾向 cp1252
  //   例如：0x80 = €，0x93/0x94 = ""，0x96 = –，0x97 = —
  //   这些字节在 GB18030/ShiftJIS/EUC-KR 中都不构成有意义的单字符，只有 cp1252 能正确解码
  if (enc === 'windows-1252' && !looksSjis) {
    // 检查是否包含 cp1252 专有符号（€ "' 等 0x80-0x9F 区）
    if (/[€\u201A\u0192\u201E\u2026\u2020\u2021\u02C6\u2030\u0160\u2039\u0152\u017D\u2018\u2019\u201C\u201D\u2022\u2013\u2014\u0161\u203A\u0153\u017E\u0178]/.test(text)) {
      return 0.4;
    }
  }
  if (enc === 'latin1') return -0.2;
  return 0;
}

// v2.9.1: KS X 1001 韩文字区字节特征：首字节 B0-C8 / 尾字节 A1-FE 的双字节对
//   占绝对多数（其他高位双字节对不超过其 35%），且 ASCII 可打印字节（空格、
//   英文、数字——韩文有词间空格而中文几乎没有）占比 > 12%。
//   双条件排除 GBK 简体中文：GB2312 一级汉字区（B0A1-D7F9）虽也产生 B0-C8 对，
//   但同时有大量 C9+ 首字节对（otherPairs 超标）且几乎没有 ASCII 空格。
function looksLikeEucKrBytes(buffer) {
  let hangulPairs = 0;
  let otherPairs = 0;
  let ascii = 0;
  const len = Buffer.isBuffer(buffer) ? buffer.length : 0;
  for (let i = 0; i < len; i += 1) {
    const byte = buffer[i];
    if (byte >= 0x20 && byte <= 0x7e) ascii += 1;
    if (i + 1 >= len) break;
    const trail = buffer[i + 1];
    if (byte >= 0xb0 && byte <= 0xc8 && trail >= 0xa1 && trail <= 0xfe) {
      hangulPairs += 1;
      i += 1;
    } else if (byte >= 0x81 && byte <= 0xfe && trail >= 0x41 && trail <= 0xfe && trail !== 0x7f) {
      otherPairs += 1;
      i += 1;
    }
  }
  // 阈值说明：韩文词间空格使 ASCII 占比通常 >15%，但密集短句可低至 5-7%；
  //   简体中文几乎无空格，otherPairs 条件（<35%）已排除 GB2312 一级汉字区误命中。
  //   v2.9.2: 短文本（仅1-2个韩文对）放宽阈值，避免极短韩文被GB18030反超。
  if (hangulPairs === 0) return false;
  // 超短文本：所有双字节对都是韩文音节区，无其他高位字节对 → 高置信度韩文
  if (hangulPairs <= 2 && otherPairs === 0) return true;
  // 常规文本：韩文音节区占优，其他字节对 <35%，ASCII 占比合理
  return hangulPairs >= 2 && otherPairs <= hangulPairs * 0.35;
}

function highByteRatio(buffer) {
  const len = Buffer.isBuffer(buffer) ? buffer.length : 0;
  if (!len) return 0;
  let high = 0;
  for (let i = 0; i < len; i += 1) if (buffer[i] >= 0x80) high += 1;
  return high / len;
}

function looksLikeUtf16Bytes(buffer) {
  if (buffer.length < 4) return false;
  let evenZeros = 0;
  let oddZeros = 0;
  const pairs = Math.floor(buffer.length / 2);
  for (let i = 0; i + 1 < buffer.length; i += 2) {
    if (buffer[i] === 0) evenZeros += 1;
    if (buffer[i + 1] === 0) oddZeros += 1;
  }
  return evenZeros / pairs > 0.25 || oddZeros / pairs > 0.25;
}

// v2.9.1 收紧：旧版「有一个合法双字节对就判定 ShiftJIS」——GBK 文档里
//   E0-FC 首字节约占 13%，短文极易偶然凑出一两对，被加 SJIS 分后
//   中文静默解成半角片假名乱码。新增条件：合法对覆盖的高位字节须占
//   全部高位字节的 60% 以上（真 SJIS 文档高位字节几乎都是成对的；
//   GBK 误凑对只占 ~13%；极短日文如「日本」4 字节 2 对仍满足）。
function looksLikeShiftJisBytes(buffer) {
  let pairs = 0;
  let validPairs = 0;
  let highBytes = 0;
  for (let i = 0; i < buffer.length; i += 1) {
    const lead = buffer[i];
    if (lead >= 0x80) highBytes += 1;
    if (i + 1 >= buffer.length) break;
    const trail = buffer[i + 1];
    if ((lead >= 0x81 && lead <= 0x9f) || (lead >= 0xe0 && lead <= 0xfc)) {
      pairs += 1;
      if ((trail >= 0x40 && trail <= 0x7e) || (trail >= 0x80 && trail <= 0xfc)) validPairs += 1;
      i += 1;
    }
  }
  return pairs > 0 && validPairs / pairs >= 0.75 && validPairs * 2 >= highBytes * 0.6;
}

function hasCjk(text) {
  return /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(String(text || ''));
}

function decodeWithTextDecoder(buffer, encoding) {
  try {
    if (typeof TextDecoder !== 'function') return null;
    return decodedCandidate(encoding, new TextDecoder(encoding, { fatal: false }).decode(buffer));
  } catch {
    return null;
  }
}

function decodedCandidate(encoding, text) {
  return { encoding, text, score: readabilityScore(text) };
}

// v2.9.1: \u4E71\u7801\u4E8C\u8054\u4F53\uFF08mojibake digraph\uFF09\u2014\u2014UTF-8 \u591A\u5B57\u8282\u5E8F\u5217\u88AB\u8BEF\u6309 latin1/cp1252 \u5355\u5B57\u8282
//   \u89E3\u7801\u7684\u5178\u578B\u4EA7\u7269\uFF1A\u9AD8\u4F4D\u9996\u5B57\u8282\uFF08\u00C0-\u00FF\uFF09\u7D27\u8DDF\u4E00\u4E2A\u7EED\u5B57\u8282\uFF08\u20AC-\u00BF\uFF09\u3002\u5408\u6CD5\u897F\u6B27\u8BED\u8A00\u6587\u672C\u91CC
//   \u300C\u91CD\u97F3\u5B57\u6BCD + \u7EED\u5B57\u8282\u533A\u5B57\u7B26\u300D\u7684\u7EC4\u5408\u51E0\u4E4E\u4E0D\u51FA\u73B0\uFF0C\u662F\u6BD4\u300C\u811A\u672C\u767D\u540D\u5355\u300D\u53EF\u9760\u5F97\u591A\u7684\u4E71\u7801\u4FE1\u53F7\u3002
const MOJIBAKE_DIGRAPH_PATTERN = /[\u00C0-\u00DF][\u0080-\u00BF]/g;

function countMojibakeDigraphs(text) {
  const matches = String(text || '').match(MOJIBAKE_DIGRAPH_PATTERN);
  return matches ? matches.length : 0;
}

// v2.9.1: \u8BC4\u5206\u91CD\u6784\u2014\u2014\u65E7\u7248\u628A C0-FF \u91CD\u97F3\u5B57\u6BCD\u4E00\u5F8B\u5F53 mojibake \u6309\u300C\u4E2A\u6570\u300D\u6263\u5206\uFF0C
//   \u6CD5\u8BED\u6587\u6863\u91CC\u51E0\u5341\u4E2A \u00E9/\u00E0 \u5C31\u80FD\u628A\u5206\u6570\u6263\u7A7F\uFF08\u5B9E\u6D4B -5.7\uFF09\uFF0C\u5408\u6CD5\u6587\u6863\u88AB\u8BEF\u5224\u4E71\u7801\u4E22\u5F03\u3002
//   \u65B0\u7248\u5168\u90E8\u6309\u300C\u6BD4\u4F8B\u300D\u6263\u5206\uFF0C\u4E71\u7801\u4FE1\u53F7\u6362\u6210\u771F\u6B63\u7684\u4E09\u4EF6\u5957\uFF1A\u66FF\u6362\u5B57\u7B26 / \u63A7\u5236\u5B57\u7B26\uFF08\u542B
//   C1 \u533A 80-9F\uFF0CUTF-8 \u7EED\u5B57\u8282\u8BEF\u8BFB\u7684\u5178\u578B\u4EA7\u7269\uFF09/ \u4E71\u7801\u4E8C\u8054\u4F53\u3002
// v2.9.2: 性能优化版——避免对大文本创建字符数组
function readabilityScore(text) {
  const value = String(text || '');
  if (!value) return -100;
  const n = value.length;
  if (n === 0) return -100;

  // 性能优化：对大文本采样评估而非遍历全部
  const maxScan = n > 5000 ? Math.min(5000, Math.floor(n * 0.1)) : n;
  const step = n > maxScan ? Math.floor(n / maxScan) : 1;

  let replacement = 0;
  let controls = 0;
  let unexpected = 0;
  let readable = 0;
  let scanned = 0;

  for (let i = 0; i < n && scanned < maxScan; i += step) {
    const ch = value[i];
    const cp = ch.codePointAt(0);
    scanned += 1;

    if (ch === '\uFFFD') replacement += 1;
    else if (cp >= 0x00 && cp <= 0x08 || cp >= 0x0B && cp <= 0x0C || cp >= 0x0E && cp <= 0x1F || cp >= 0x80 && cp <= 0x9F) {
      controls += 1;
    }
    else if (cp >= 0xE000 && cp <= 0xF8FF || cp >= 0xF0000 && cp <= 0xFFFFD || cp >= 0x100000 && cp <= 0x10FFFD) {
      unexpected += 1;
    }
    else {
      // 简化的可读字符判断：大部分Unicode字符都是可读的
      readable += 1;
    }
  }

  const mojibake = countMojibakeDigraphs(value.slice(0, maxScan));
  const scale = n / scanned;

  return (readable * scale / n)
    - ((replacement * scale / n) * 0.9)
    - ((controls * scale / n) * 1.5)
    - ((mojibake / n) * 0.6)
    - ((unexpected * scale / n) * 0.8);
}

// v2.9.1: 补充韩/俄/阿/泰/印地语识别——sourceLanguage 会作为语言提示影响
//   AI 总结/原子化措辞，旧版对非中日英一律返回 'unknown'。
function detectDominantLanguage(text) {
  const value = String(text || '');
  const scriptCount = (pattern) => (value.match(pattern) || []).length;
  const kana = scriptCount(/[\p{Script=Hiragana}\p{Script=Katakana}]/gu);
  const hangul = scriptCount(/\p{Script=Hangul}/gu);
  const han = scriptCount(/\p{Script=Han}/gu);
  const cyrillic = scriptCount(/\p{Script=Cyrillic}/gu);
  const arabic = scriptCount(/\p{Script=Arabic}/gu);
  const thai = scriptCount(/\p{Script=Thai}/gu);
  const devanagari = scriptCount(/\p{Script=Devanagari}/gu);
  const latin = (value.match(/[A-Za-z]/g) || []).length;
  if (hangul > 0) return 'ko';
  if (kana > 0) return 'ja';
  const others = Math.max(cyrillic, arabic, thai, devanagari);
  if (han > latin && han >= others) return 'zh';
  if (cyrillic > latin && cyrillic >= others) return 'ru';
  if (arabic > latin && arabic >= others) return 'ar';
  if (thai > latin && thai >= devanagari) return 'th';
  if (devanagari > latin) return 'hi';
  if (latin > 0) return 'en';
  return 'unknown';
}

function swapUtf16Bytes(buffer) {
  const out = Buffer.from(buffer);
  for (let i = 0; i + 1 < out.length; i += 2) {
    const first = out[i];
    out[i] = out[i + 1];
    out[i + 1] = first;
  }
  return out;
}

function parseEmail(raw) {
  const normalizedRaw = String(raw || '').replace(/\\r\\n/g, '\n').replace(/\\n/g, '\n');
  const [headerPart, ...bodyParts] = normalizedRaw.split(/\r?\n\r?\n/);
  const headers = {};
  for (const line of headerPart.split(/\r?\n/)) {
    const match = line.match(/^([^:]+):\s*(.*)$/);
    if (match) headers[match[1].toLowerCase()] = match[2].trim();
  }
  const body = bodyParts.join('\n\n');
  return {
    subject: headers.subject || '',
    from: headers.from || '',
    to: headers.to || '',
    date: headers.date || '',
    text: stripHtml(body).trim()
  };
}

// v2.9.1: HTML 实体完整解码——旧版只解 4 个命名实体，邮件 HTML 正文里的
//   &#20013; / &#x4E2D; / &eacute; / &copy; 等会原样漏进知识卡片（内容级乱码）。
//   数字实体用 String.fromCodePoint 按码点还原（增补平面字符生成合法代理对）；
//   代理区码点（0xD800-0xDFFF）会抛 RangeError，捕获后保留原文，杜绝孤立代理。
const HTML_NAMED_ENTITIES = {
  nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'",
  copy: '©', reg: '®', trade: '™', deg: '°', plusmn: '±', micro: 'µ',
  mdash: '—', ndash: '–', hellip: '…', bull: '•', middot: '·',
  lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”', laquo: '«', raquo: '»',
  times: '×', divide: '÷', frac12: '½', frac14: '¼', sup2: '²', sup3: '³',
  euro: '€', yen: '¥', pound: '£', cent: '¢', sect: '§', para: '¶',
  dagger: '†', permil: '‰', larr: '←', rarr: '→', uarr: '↑', darr: '↓',
  eacute: 'é', egrave: 'è', agrave: 'à', ccedil: 'ç', ntilde: 'ñ',
  auml: 'ä', ouml: 'ö', uuml: 'ü', szlig: 'ß', iexcl: '¡', iquest: '¿'
};

function decodeHtmlEntities(text) {
  return String(text || '').replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[a-zA-Z][a-zA-Z0-9]*);/g, (whole, body) => {
    if (body[0] === '#') {
      const code = body[1] === 'x' || body[1] === 'X'
        ? parseInt(body.slice(2), 16)
        : parseInt(body.slice(1), 10);
      if (!Number.isFinite(code) || code < 0 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) return whole;
      try { return String.fromCodePoint(code); } catch (_) { return whole; }
    }
    return Object.prototype.hasOwnProperty.call(HTML_NAMED_ENTITIES, body) ? HTML_NAMED_ENTITIES[body] : whole;
  });
}

function stripHtml(html) {
  return decodeHtmlEntities(String(html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, ''))
    .replace(/\n{3,}/g, '\n\n');
}

// ---------------------------------------------------------------------------
// v2.9.0: MIME multipart 邮件解析（含附件二进制提取）
//   设计约束：附件是二进制，必须对原始 Buffer 做字节级结构解析。
//   latin1 是 1:1 字节映射，用它定位边界/头部后，载荷用 Buffer.slice 按
//   相同索引切出，二进制字节不受损。parseEmail（纯文本版）保留兼容旧调用。
// ---------------------------------------------------------------------------

const MIME_EXTENSIONS = {
  'application/pdf': 'pdf',
  'application/zip': 'zip',
  'application/msword': 'doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.ms-excel': 'xls',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'application/vnd.ms-powerpoint': 'ppt',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
  'application/json': 'json',
  'application/xml': 'xml',
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/tiff': 'tiff',
  'text/plain': 'txt',
  'text/html': 'html',
  'text/csv': 'csv',
  'message/rfc822': 'eml'
};

function mimeExtension(subtype) {
  return MIME_EXTENSIONS[String(subtype || '').toLowerCase()] || 'bin';
}

function mimeHeader(headers, name) {
  return headers ? String(headers[String(name || '').toLowerCase()] || '') : '';
}

// 从 Content-Type / Content-Disposition 里取参数值（支持引号包裹）
function mimeParam(headerValue, name) {
  const match = String(headerValue || '').match(new RegExp(`${name}\\s*=\\s*("([^"]*)"|([^;\\s]+))`, 'i'));
  if (!match) return '';
  return match[2] !== undefined ? match[2] : (match[3] || '');
}

// 头部解析：支持 RFC 2822 折叠行续行（以空格/制表符开头的行并入上一行）
function parseMimeHeaders(headerText) {
  // headerText 来自 latin1 结构解析（1:1 字节映射）。真实邮件中未走
  // RFC 2047 编码词的 8-bit 头部几乎都是 UTF-8 字节，统一转回 UTF-8；
  // 纯 ASCII（含编码词本身）转换是恒等的，不影响后续 decodeMimeWords。
  const toUtf8 = (value) => Buffer.from(value, 'latin1').toString('utf8');
  const headers = {};
  let currentKey = null;
  for (const line of String(headerText || '').split(/\r?\n/)) {
    if (/^[ \t]/.test(line) && currentKey) {
      headers[currentKey] = `${headers[currentKey]} ${toUtf8(line.trim())}`.trim();
      continue;
    }
    const match = line.match(/^([^:]+):\s*(.*)$/);
    if (match) {
      currentKey = match[1].toLowerCase();
      headers[currentKey] = toUtf8(match[2].trim());
    }
  }
  return headers;
}

// 解析单个 MIME 实体：返回 { headers, body } 或 { headers, children }（multipart）
function parseMimeEntity(buf) {
  const input = Buffer.isBuffer(buf) ? buf : Buffer.from(buf || '');
  const text = input.toString('latin1');
  let headerEnd = text.indexOf('\r\n\r\n');
  let separatorLength = 4;
  if (headerEnd < 0) {
    headerEnd = text.indexOf('\n\n');
    separatorLength = 2;
  }
  if (headerEnd < 0) {
    headerEnd = input.length;
    separatorLength = 0;
  }
  const headers = parseMimeHeaders(text.slice(0, headerEnd));
  const bodyStart = headerEnd + separatorLength;
  const contentType = mimeHeader(headers, 'content-type') || 'text/plain';
  const boundary = mimeParam(contentType, 'boundary');
  if (/^multipart\//i.test(contentType) && boundary) {
    return { headers, children: splitMultipart(input, text, bodyStart, boundary) };
  }
  return { headers, body: input.slice(bodyStart) };
}

// 按 boundary 切分子部件；起止边界之间的前言/尾声按 MIME 规范丢弃
function splitMultipart(buf, text, bodyStart, boundary) {
  const delimiter = `--${boundary}`;
  const children = [];
  let cursor = text.indexOf(delimiter, bodyStart);
  while (cursor >= 0) {
    let after = cursor + delimiter.length;
    if (text.startsWith('--', after)) break; // 结束边界 --boundary--
    if (text.startsWith('\r\n', after)) after += 2;
    else if (text.startsWith('\n', after)) after += 1;
    const next = text.indexOf(delimiter, after);
    if (next < 0) break;
    let partEnd = next;
    if (partEnd >= 2 && text.startsWith('\r\n', partEnd - 2)) partEnd -= 2;
    else if (partEnd >= 1 && text.startsWith('\n', partEnd - 1)) partEnd -= 1;
    if (partEnd > after) children.push(parseMimeEntity(buf.slice(after, partEnd)));
    cursor = next;
  }
  return children;
}

// Content-Transfer-Encoding 解码，输出原始字节
function decodePartPayload(entity) {
  const body = entity.body || Buffer.alloc(0);
  const encoding = mimeHeader(entity.headers, 'content-transfer-encoding').toLowerCase().trim();
  if (encoding === 'base64') {
    return Buffer.from(body.toString('latin1').replace(/[^A-Za-z0-9+/=]/g, ''), 'base64');
  }
  if (encoding === 'quoted-printable') return decodeQuotedPrintable(body);
  return body;
}

// quoted-printable：=XX 十六进制字节 + 软换行（行尾 =）
function decodeQuotedPrintable(buf) {
  const text = (Buffer.isBuffer(buf) ? buf : Buffer.from(buf || '')).toString('latin1');
  const bytes = [];
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === '=') {
      if (text[i + 1] === '\r' && text[i + 2] === '\n') { i += 2; continue; }
      if (text[i + 1] === '\n') { i += 1; continue; }
      const hex = text.slice(i + 1, i + 3);
      if (/^[0-9A-Fa-f]{2}$/.test(hex)) {
        bytes.push(parseInt(hex, 16));
        i += 2;
        continue;
      }
      bytes.push(0x3d);
      continue;
    }
    bytes.push(text.charCodeAt(i) & 0xff);
  }
  return Buffer.from(bytes);
}

// 按声明 charset 解码字节；声明编码出现替换字符或不受支持时回退自适应探测
function decodeBufferWithCharset(buf, charset) {
  const aliases = { 'gb2312': 'gbk', 'ascii': 'utf-8', 'us-ascii': 'utf-8', 'utf8': 'utf-8' };
  const cs = aliases[String(charset || '').trim().toLowerCase()] || String(charset || '').trim().toLowerCase();
  if (cs && typeof TextDecoder === 'function') {
    try {
      const text = new TextDecoder(cs, { fatal: false }).decode(buf);
      if (text && !text.includes('�')) return text;
    } catch { /* 未知 charset 标签 → 走自适应兜底 */ }
  }
  return decodeTextBuffer(buf).text;
}

// RFC 2047 编码词：=?UTF-8?B?…?= / =?GBK?Q?…?=（常见于中文主题与附件名）
function decodeMimeWords(value) {
  const collapsed = String(value || '').replace(/\?=\s+=\?/g, '?==?');
  return collapsed.replace(/=\?([^?]+)\?([BbQq])\?([^?]*)\?=/g, (whole, charset, kind, data) => {
    try {
      const buf = kind.toLowerCase() === 'b'
        ? Buffer.from(data, 'base64')
        : decodeQuotedPrintable(Buffer.from(data.replace(/_/g, ' '), 'latin1'));
      return decodeBufferWithCharset(buf, charset);
    } catch { return whole; }
  });
}

function sanitizeAttachmentFileName(name) {
  const cleaned = String(name || '')
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_')
    .replace(/^[\s.]+|[\s.]+$/g, '')
    .slice(0, 120);
  return cleaned || 'attachment';
}

function decodeTextPart(entity) {
  const contentType = mimeHeader(entity.headers, 'content-type');
  const subtype = (contentType.split(';')[0].trim().split('/')[1] || 'plain').toLowerCase();
  const charset = mimeParam(contentType, 'charset');
  let text = decodeBufferWithCharset(decodePartPayload(entity), charset);
  if (subtype === 'html') text = stripHtml(text);
  return { subtype, text: text.replace(/\r\n/g, '\n').trim() };
}

// 叶子部件分流：文本进正文候选；带文件名 / 非文本 / 嵌套邮件 进附件
function handleMimeLeaf(entity, textParts, attachments) {
  const contentType = mimeHeader(entity.headers, 'content-type') || 'text/plain';
  const fullType = contentType.split(';')[0].trim().toLowerCase();
  const disposition = mimeHeader(entity.headers, 'content-disposition');
  const filename = decodeMimeWords(mimeParam(disposition, 'filename') || mimeParam(contentType, 'name'));

  if (fullType === 'message/rfc822') {
    // 嵌套邮件整体存为 .eml，随后作为新邮件源递归进入切片流水线
    const inner = parseMimeEntity(entity.body || Buffer.alloc(0));
    const innerSubject = decodeMimeWords(mimeHeader(inner.headers, 'subject'));
    attachments.push({
      filename: `${sanitizeAttachmentFileName(innerSubject || 'nested-message')}.eml`,
      contentType: 'message/rfc822',
      data: Buffer.from(entity.body || Buffer.alloc(0))
    });
    return;
  }

  // 无文件名的内联 CID 图片（签名/企业 logo 等装饰图）不进附件，避免垃圾任务
  const inlineDecorative = /inline/i.test(disposition) && !!mimeHeader(entity.headers, 'content-id') && !filename;
  if ((fullType.startsWith('text/') && !filename) || inlineDecorative) {
    textParts.push(decodeTextPart(entity));
    return;
  }

  const payload = decodePartPayload(entity);
  if (!payload.length) return;
  attachments.push({
    filename: sanitizeAttachmentFileName(filename || `attachment-${attachments.length + 1}.${mimeExtension(fullType)}`),
    contentType: fullType,
    data: payload
  });
}

// 递归遍历部件树；multipart/alternative 内按 text/plain 优先取一份正文
function collectMimeParts(entity, textParts, attachments) {
  if (Array.isArray(entity.children)) {
    const contentType = mimeHeader(entity.headers, 'content-type').toLowerCase();
    if (contentType.startsWith('multipart/alternative')) {
      const alternatives = [];
      for (const child of entity.children) {
        const childType = (mimeHeader(child.headers, 'content-type') || 'text/plain').toLowerCase();
        if (Array.isArray(child.children) || childType.startsWith('multipart/')) {
          collectMimeParts(child, textParts, attachments);
        } else if (childType.startsWith('text/') && !mimeParam(mimeHeader(child.headers, 'content-disposition') || mimeHeader(child.headers, 'content-type'), 'filename')) {
          alternatives.push(child);
        } else {
          handleMimeLeaf(child, textParts, attachments);
        }
      }
      const chosen = alternatives.find((child) => (mimeHeader(child.headers, 'content-type') || '').toLowerCase().startsWith('text/plain')) || alternatives[0];
      if (chosen) textParts.push(decodeTextPart(chosen));
      return;
    }
    for (const child of entity.children) collectMimeParts(child, textParts, attachments);
    return;
  }
  handleMimeLeaf(entity, textParts, attachments);
}

function pickEmailBody(textParts) {
  const plain = textParts.filter((part) => part.subtype === 'plain').map((part) => part.text).filter(Boolean).join('\n\n').trim();
  if (plain) return plain;
  return textParts.filter((part) => part.subtype !== 'plain').map((part) => part.text).filter(Boolean).join('\n\n').trim();
}

// 解析整封 .eml：头部元数据 + 正文 + 附件二进制
function parseEmailMessage(buffer) {
  const raw = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer || '');
  try {
    const root = parseMimeEntity(raw);
    const textParts = [];
    const attachments = [];
    collectMimeParts(root, textParts, attachments);
    return {
      subject: decodeMimeWords(mimeHeader(root.headers, 'subject')),
      from: decodeMimeWords(mimeHeader(root.headers, 'from')),
      to: decodeMimeWords(mimeHeader(root.headers, 'to')),
      cc: decodeMimeWords(mimeHeader(root.headers, 'cc')),
      date: mimeHeader(root.headers, 'date'),
      messageId: mimeHeader(root.headers, 'message-id'),
      text: pickEmailBody(textParts),
      attachments
    };
  } catch (error) {
    // 畸形邮件兜底：退回纯文本旧路径，行为不差于 v2.8
    const decoded = decodeTextBuffer(raw);
    const simple = parseEmail(decoded.text);
    return Object.assign({}, simple, { cc: '', messageId: '', attachments: [] });
  }
}

// v2.9.1: 乱码判定重构（配合 readabilityScore / isExpectedReadableChar 改造）：
//   旧版把拉丁扩展（U+00C0-U+00FF）占比当乱码信号，合法法语/越南语文档被误杀；
//   且「符号占比 > 0.22」一条就判死韩文/俄文/阿拉伯文等非白名单文字。
//   新版只认真正的乱码信号：替换字符 U+FFFD、控制字符（含 C1 区 U+0080-U+009F，
//   即 UTF-8 续字节被误按 latin1 单字节解码的产物）、乱码二联体、私用区字符。
//   定位：解码阶段已尽量产出正确文本，本函数只是最后一道防线。
function looksLikeGibberish(text) {
  const value = String(text || '');
  if (!value) return false;
  if (/\\u[0-9a-f]{4}/i.test(value)) return true;
  const chars = [...value];
  const n = chars.length;
  const replacement = chars.filter((ch) => ch === '\uFFFD').length;
  const controls = chars.filter((ch) => /[\x00-\x08\x0B\x0C\x0E-\x1F\u0080-\u009F]/.test(ch)).length;
  const mojibake = countMojibakeDigraphs(value);
  const unexpected = chars.filter(isUnexpectedScriptOrPrivate).length;
  const readable = chars.filter(isExpectedReadableChar).length;
  // v2.9.2: 放宽短文本阈值，替换字符密集（>10%）直接判为乱码
  if (replacement > 0 && replacement / n > 0.1) return true;
  if (n < 80 && controls === 0 && replacement === 0 && unexpected === 0 && readable / n > 0.75) return false;
  return n > 30 && (
    replacement / n > 0.02
    || controls / n > 0.03
    || mojibake / n > 0.05
    || unexpected / n > 0.05
    || readable / n < 0.62
  );
}

// v2.9.1: 「可读字符」不再用 CJK+ASCII 白名单——那会把法/越/韩/俄/阿/泰等一切
//   非白名单文字当符号，合法文档被误判乱码。改用 Unicode 属性：任何人类语言文字
//   （字母/标记/数字）、任何标点、任何符号、空白都算可读；真正的异常字符
//   （控制符 / 替换符 / 私用区）由 readabilityScore 与 isUnexpectedScriptOrPrivate 负责。
function isExpectedReadableChar(ch) {
  return /[\p{L}\p{M}\p{N}\p{P}\p{S}\p{Z}\s]/u.test(ch);
}

// v1.5 (m-05): \u4E4B\u524D\u628A\u97E9/\u963F/\u6CF0/\u5370\u5730\u7B49\u5408\u6CD5\u811A\u672C\u5F53 unexpected_script\uFF0C
//              \u5BFC\u81F4\u97E9\u6587 / \u963F\u62C9\u4F2F\u6587\u6587\u6863\u88AB\u8BEF\u5224\u4E3A\u4E71\u8BED\u76F4\u63A5\u8D70 failed\u3002
//              \u6539\u4E3A\u53EA\u628A"\u79C1\u6709\u533A + \u66FF\u6362\u5B57\u7B26 + \u4EE3\u7406\u5BF9"\u8FD9\u4E9B\u771F\u6B63\u53EF\u7591\u7684\u5224\u4E3A unexpected\u3002
// v2.9.1 \u4FEE\u590D\uFF1A\u65E7\u7248\u6B63\u5219\u6F0F\u5199 /u \u6807\u5FD7\u2014\u2014\u65E0 u \u6807\u5FD7\u65F6 \uF0000 \u88AB\u89E3\u6790\u6210
//   \uF000 \u540E\u8DDF\u5B57\u9762\u5B57\u7B26 0\uFF0C0-\uFFFF \u9000\u5316\u6210\u300C0x30-0xFFFF \u5168\u5B57\u7B26\u8303\u56F4\u300D\uFF0C
//   \u4EFB\u4F55\u5B57\u6BCD/\u6570\u5B57/CJK/\u97E9\u6587\u90FD\u88AB\u8BA1\u4E3A unexpected\uFF0C\u6240\u6709\u6587\u6863\u53EF\u8BFB\u6027\u8BC4\u5206\u88AB
//   \u538B\u5230 0.2-0.4\uFF08\u6B63\u5E38\u5E94\u63A5\u8FD1 1.0\uFF09\u3002\u8865 u \u6807\u5FD7\u5E76\u6539\u7528 \u{...} \u62EC\u53F7\u5199\u6CD5\u3002
function isUnexpectedScriptOrPrivate(ch) {
  return /[\uE000-\uF8FF\u{F0000}-\u{FFFFD}\u{100000}-\u{10FFFD}\uFFFD]/u.test(ch);
}

module.exports = {
  countMojibakeDigraphs,
  decodeHtmlEntities,
  decodeMimeWords,
  decodeQuotedPrintable,
  decodeTextBuffer,
  detectDominantLanguage,
  extractTextFromBuffer,
  looksLikeGibberish,
  parseEmail,
  parseEmailMessage,
  readabilityScore,
  sanitizeAttachmentFileName,
  stripHtml
};

},
/**
 * @module src/core/moc
 * 工程资料文件夹的 Map-of-Content（索引）Markdown 生成
 * @exports createFolderIndexMarkdown
 * @exports folderIndexPath
 */
"src/core/moc.js": function(require, module, exports) {
function folderIndexPath(route) {
  return `${String(route.output_folder || '').replace(/\/$/, '')}/_索引.md`;
}

function createFolderIndexMarkdown(route) {
  const title = `${route.folder_type} 索引`;
  return `---\ntitle: ${JSON.stringify(title)}\nlibrary: ${JSON.stringify(route.library)}\nfolder_type: ${JSON.stringify(route.folder_type)}\nindex_type: fixed-folder\n---\n\n# ${title}\n\n## 知识卡片\n\n\`\`\`dataview\nTABLE card_kind AS 类型, Category, TagL1, TagL2, confidence AS 可信度, source_file AS 来源\nFROM ${JSON.stringify(route.output_folder)}\nWHERE library = ${JSON.stringify(route.library)}\n  AND folder_type = ${JSON.stringify(route.folder_type)}\n  AND file.name != "_索引"\nSORT updated DESC\n\`\`\`\n\n## 标签三元组索引\n\nCategory / TagL1 / TagL2 仅用于 MOC 查询与筛选，文件目录由 folder-map.json 固定映射。\n`;
}

module.exports = { createFolderIndexMarkdown, folderIndexPath };


},
/**
 * @module src/core/ecosystem
 * 检测 vault 中已安装的 Obsidian 生态插件（dataview / templater / quickadd 等）
 * 用于自适应地插入 MOC / frontmatter 链接
 * @exports detectEcosystemPlugins
 */
"src/core/ecosystem.js": function(require, module, exports) {
const OPTIONAL_PLUGINS = [
  { id: 'dataview', name: 'Dataview', role: 'MOC 表格和动态查询' },
  { id: 'tag-wrangler', name: 'Tag Wrangler', role: '标签重命名、合并与治理' },
  { id: 'quickadd', name: 'QuickAdd', role: '快捷捕获命令和手动建卡' },
  { id: 'obsidian-tasks-plugin', name: 'Tasks', role: '待办查询和任务视图' },
  { id: 'obsidian-kanban', name: 'Kanban', role: '可选审核看板' },
  { id: 'metadata-menu', name: 'Metadata Menu', role: 'Frontmatter 字段编辑辅助' },
  { id: 'obsidian-linter', name: 'Linter', role: 'Markdown 和 frontmatter 格式整理' },
  { id: 'templater-obsidian', name: 'Templater', role: '模板渲染兼容' },
  { id: 'templates', name: 'Templates', role: '核心模板兼容' }
];

function detectEcosystemPlugins(app) {
  const installed = (app && app.plugins && app.plugins.plugins) || {};
  const enabled = (app && app.plugins && app.plugins.enabledPlugins) || new Set();
  return OPTIONAL_PLUGINS.map((plugin) => ({
    id: plugin.id,
    name: plugin.name,
    installed: Boolean(installed[plugin.id]),
    enabled: typeof enabled.has === 'function' ? enabled.has(plugin.id) : Boolean(enabled[plugin.id]),
    role: plugin.role
  }));
}

module.exports = {
  OPTIONAL_PLUGINS,
  detectEcosystemPlugins
};

},
/**
 * @module src/core/routing
 * 卡片输出路径解析：folder_type → 实际 vault 路径
 * 处理 EPC / 安全 / 质量 等不同 folder_type 的固定路由
 * @exports cardOutputPath
 * @exports resolveFixedRoute
 */
"src/core/routing.js": function(require, module, exports) {
// v1.8 (M-09): 解析固定目录映射。优先精确匹配；找不到时退化到前缀匹配（处理 EPC 工程类合并条目）。
//       例如 AI 输出 "04-设计优化方案(EPC工程)" 但 folder-map 只有 "04-设计优化方案及设计方案(EPC工程)"，
//       走前缀匹配把两者归到同一个目录。
function resolveFixedRoute(folderMap, value) {
  const routes = (folderMap && folderMap.routes || []);
  const exact = routes.find((item) => (
    item.library === value.library && item.folder_type === value.folder_type
  ));
  if (exact) return exact;
  // 前缀 fallback：同 library 下找 folder_type 包含 value 的
  if (value.folder_type) {
    const prefix = routes.find((item) => (
      item.library === value.library && item.folder_type.includes(value.folder_type)
    ));
    if (prefix) return prefix;
    // 反向：value 包含某个 route
    const contain = routes.find((item) => (
      item.library === value.library && value.folder_type.includes(item.folder_type)
    ));
    if (contain) return contain;
  }
  // 公共前缀（N- 段）：截断到第一个 "（" 或 "(" 之前再试一次
  if (value.folder_type) {
    const baseType = value.folder_type.split(/[（(]/)[0].trim();
    if (baseType && baseType !== value.folder_type) {
      const baseRoute = routes.find((item) => (
        item.library === value.library && item.folder_type === baseType
      ));
      if (baseRoute) return baseRoute;
    }
  }
  throw new Error(`固定目录映射中不存在：${value.library || 'unknown'} / ${value.folder_type || 'unknown'}`);
}

// v1.5 (M-02 + m-03): cardOutputFolder 折入 cardOutputPath 内部，避免外部多跳一层。
//                     sanitizeFileName 同步处理 '..' 路径穿越（m-03）。
function resolveOutputRoute(settings, folderMap, value) {
  const route = resolveFixedRoute(folderMap, value);
  const library = value.library || route.library;
  const root = normalizeRoutePath(library === 'business' ? settings.businessOutputPath : settings.bidOutputPath);
  const legacyRoot = library === 'business' ? '06-知识库/wiki/业务库' : '06-知识库/wiki/招投标';
  let configured = normalizeRoutePath(route.output_folder);
  if (!root || !configured) throw new Error('输出路径不能为空或指向 vault 根目录');
  if (configured === legacyRoot) throw new Error('输出路由不能直接指向知识库根目录');
  if (configured.startsWith(`${legacyRoot}/`)) configured = configured.slice(legacyRoot.length + 1);
  else if (configured.startsWith(`${root}/`)) configured = configured.slice(root.length + 1);
  const resolved = normalizeRoutePath(`${root}/${configured}`);
  if (!resolved.startsWith(`${root}/`) || resolved === root || resolved.split('/').some((part) => part === '..' || part === '.')) {
    throw new Error('输出路由越界或指向目录根');
  }
  return Object.assign({}, route, { output_folder: resolved });
}

function cardOutputPath(settings, folderMap, card, fileName) {
  const outputFolder = resolveOutputRoute(settings, folderMap, card).output_folder;
  return `${outputFolder}/${sanitizeFileName(fileName)}`;
}

function normalizeRoutePath(value) {
  return String(value || '').trim().replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+/g, '/').replace(/\/+$/, '');
}

function sanitizeFileName(value) {
  let fileName = String(value || 'card.md').replace(/[\\/:*?"<>|#\[\]]+/g, '-').replace(/-+/g, '-');
  // v1.5 (m-03): 防 '..' 路径穿越（用户可能把 title 写为 ".."）
  fileName = fileName.replace(/\.\.+/g, '-').replace(/^\.+/, '');
  return fileName.toLowerCase().endsWith('.md') ? fileName : `${fileName}.md`;
}

module.exports = { cardOutputPath, resolveFixedRoute, resolveOutputRoute, sanitizeFileName };


},
/**
 * @module src/core/external-pdf
 * 外部 OCR/PDF API 调度：MinerU 与 PaddleOCR，按文件类型 / 配置路由
 * @exports extractDocumentWithApis
 */
"src/core/external-pdf.js": function(require, module, exports) {
const { runMineruApi } = require("src/core/mineru-api.js");
const { runPaddleOcrApi } = require("src/core/paddleocr-api.js");

const DEFAULT_ORDER = ['mineru-api', 'paddleocr-api'];
const MAX_MINERU_FILE_BYTES = 200 * 1024 * 1024;

async function extractDocumentWithApis(buffer, config = {}) {
  if (Number(buffer?.length || 0) > MAX_MINERU_FILE_BYTES) {
    return {
      status: 'failed',
      engine: 'document-api',
      text: '',
      message: '源文件超过 MinerU 精准解析 API 的 200 MB 上限，请拆分后重试。'
    };
  }
  if (Number(config.pageCount || 0) > 200) {
    return {
      status: 'failed',
      engine: 'document-api',
      text: '',
      message: '文档超过 MinerU 精准解析 API 的 200 页上限，请拆分后重试。'
    };
  }

  // v1.3: 上传源文件到外部解析器前的二次确认。
  //       通过 globalThis.__eksUploadConfirm 弹窗；用户取消时直接返回 cancelled。
  if (config.confirmUploads !== false && typeof globalThis.__eksUploadConfirm === 'function') {
    const engines = parseOrder(config.order || config.pdfExtractionOrder);
    const primaryEngine = engines[0] || 'mineru-api';
    const confirmed = await globalThis.__eksUploadConfirm({
      fileName: config.fileName || '',
      sizeBytes: Number(buffer?.length || 0),
      engine: engineLabel(primaryEngine)
    });
    if (!confirmed) {
      return {
        status: 'cancelled',
        engine: 'document-api',
        text: '',
        message: '用户取消上传源文件到外部解析器。'
      };
    }
    // v2.9.2: 弹窗确认 = 用户对本次上传的明确授权。必须把它写回 config.allowExternalUpload，
    //   因为该字段在 getPdfExtractorConfig 创建配置时就已经快照（彼时本会话尚未授权，值为 false），
    //   而 runEngine 只读这个快照。不回写会导致"用户点确认后仍被『未确认允许上传』拒绝"，
    //   每次重启后第一个文件都得确认两次才成功（见 2026-07-20/23/24 诊断日志）。
    config.allowExternalUpload = true;
  }

  if (typeof config.run === 'function') {
    const injected = await config.run(buffer, config);
    return normalizeResult(injected, 'document-api');
  }

  const errors = [];
  for (const engine of parseOrder(config.order || config.pdfExtractionOrder)) {
    await emitProgress(config, {
      stage: 'document-engine',
      engine,
      message: `正在尝试云端文档解析器：${engineLabel(engine)}`
    });
    const result = await runEngine(engine, buffer, config);
    if (result && result.status === 'ok' && isUsableMarkdown(result.text)) return result;
    if (result && result.status === 'ok') errors.push(`${engine}: 解析结果未通过可读性检查`);
    if (result && result.message) errors.push(`${engine}: ${result.message}`);
  }

  return {
    status: 'failed',
    engine: 'document-api',
    text: '',
    message: errors.length ? errors.join(' | ') : '云端文档解析未返回可读 Markdown。'
  };
}

async function extractPdfWithExternal(buffer, config = {}) {
  return extractDocumentWithApis(buffer, config);
}

function parseOrder(value) {
  const requested = String(value || '')
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter((item) => DEFAULT_ORDER.includes(item));
  return requested.length ? [...new Set(requested)] : [...DEFAULT_ORDER];
}

async function runEngine(engine, buffer, config) {
  if (config.engineRunners && typeof config.engineRunners[engine] === 'function') {
    return config.engineRunners[engine]({ buffer, config });
  }
  if (!config.allowExternalUpload) return { status: 'unavailable', message: '未确认允许上传源文件到外部解析 API。' };
  if (engine === 'mineru-api') {
    return runMineruApi(buffer, {
      apiKey: config.mineruApiKey,
      endpoint: config.mineruApiEndpoint,
      model: config.mineruApiModel,
      language: config.mineruApiLanguage,
      fileName: config.fileName,
      timeoutMs: config.timeoutMs,
      pollIntervalMs: config.pollIntervalMs,
      requestImpl: config.requestImpl,
      fetchImpl: config.fetchImpl,
      sleep: config.sleep,
      onProgress: config.onProgress,
      signal: config.signal
    });
  }
  if (engine === 'paddleocr-api') {
    return runPaddleOcrApi(buffer, {
      apiKey: config.paddleOcrApiKey,
      endpoint: config.paddleOcrApiEndpoint,
      model: config.paddleOcrApiModel,
      fileName: config.fileName,
      timeoutMs: config.timeoutMs,
      pollIntervalMs: config.pollIntervalMs,
      requestImpl: config.requestImpl,
      fetchImpl: config.fetchImpl,
      sleep: config.sleep,
      onProgress: config.onProgress,
      signal: config.signal
    });
  }
  return { status: 'unavailable', message: `不支持的云端解析器：${engine}` };
}

function normalizeResult(result, fallbackEngine) {
  if (!result || result.status !== 'ok') {
    return {
      status: result?.status || 'failed',
      engine: result?.engine || fallbackEngine,
      text: '',
      message: result?.message || '云端文档解析失败。'
    };
  }
  if (!isUsableMarkdown(result.text)) {
    return {
      status: 'failed',
      engine: result.engine || fallbackEngine,
      text: '',
      message: result.message || '云端解析结果未通过可读性检查。'
    };
  }
  return result;
}

function isUsableMarkdown(text) {
  const value = String(text || '').trim();
  if (value.length < 20 || /\\u[0-9a-f]{4}/i.test(value)) return false;
  const chars = [...value];
  const corrupt = chars.filter((char) => char === '\uFFFD' || /[\x00-\x08\x0B\x0C\x0E-\x1F\uD800-\uDFFF]/.test(char)).length;
  const readable = chars.filter((char) => /[\p{L}\p{N}\s，。、“”‘’：；！？（）【】《》,.()[\]{}:;!?/+=_%#&'"|@<>·…—-]/u.test(char)).length;
  return corrupt / chars.length <= 0.02 && readable / chars.length >= 0.72;
}

function engineLabel(engine) {
  return engine === 'mineru-api' ? 'MinerU API' : 'PaddleOCR API';
}

async function emitProgress(config, payload) {
  if (typeof config.onProgress === 'function') await config.onProgress(payload);
}

module.exports = {
  DEFAULT_ORDER,
  MAX_MINERU_FILE_BYTES,
  extractDocumentWithApis,
  extractPdfWithExternal,
  isUsableMarkdown,
  parseOrder
};

},
/**
 * @module src/core/mineru-api
 * MinerU 云端 OCR API 调用层：上传 + 轮询 + 下载 zip
 * @exports runMineruApi
 */
"src/core/mineru-api.js": function(require, module, exports) {
const { extractZipEntryEndingWith } = require("src/core/zip.js");
const { normalizeOcrArtifact } = require("src/core/provenance.js");

async function runMineruApi(buffer, options = {}) {
  if (!options.apiKey) return unavailable('未配置 MinerU API Token。');
  if (typeof (options.requestImpl || options.fetchImpl || globalThis.fetch) !== 'function') return unavailable('当前环境不支持网络请求。');

  const fetcher = options.requestImpl || options.fetchImpl || globalThis.fetch;
  const endpoint = String(options.endpoint || 'https://mineru.net/api/v4').replace(/\/$/, '');
  const headers = {
    Authorization: `Bearer ${options.apiKey}`,
    'Content-Type': 'application/json'
  };
  const fileName = safeFileName(options.fileName || 'source.pdf');
  const pollIntervalMs = Math.max(500, Number(options.pollIntervalMs) || 5000);
  const maxPolls = Math.max(1, Math.ceil((Number(options.timeoutMs) || 300000) / pollIntervalMs));
  const sleep = options.sleep || ((ms) => cancellableDelay(ms, options.signal));

  try {
    await emit(options, { stage: 'mineru-api-request', message: 'MinerU：正在申请上传地址' });
    const createResponse = await fetcher(`${endpoint}/file-urls/batch`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        files: [{ name: fileName, is_ocr: true }],
        model_version: options.model || 'vlm',
        language: options.language || 'ch_server',
        enable_table: options.enableTable !== false,
        enable_formula: options.enableFormula !== false
      }),
      signal: options.signal
    });
    const createPayload = await readJson(createResponse, 'MinerU 申请上传地址');
    const batchId = createPayload?.data?.batch_id;
    const uploadUrl = createPayload?.data?.file_urls?.[0];
    if (!batchId || !uploadUrl) throw new Error(createPayload?.msg || 'MinerU 未返回上传地址或批次 ID。');

    await emit(options, { stage: 'mineru-api-upload', message: 'MinerU：正在上传源文件' });
    const uploadResponse = await fetcher(uploadUrl, { method: 'PUT', body: Buffer.from(buffer || []), signal: options.signal });
    if (!uploadResponse.ok) throw new Error(`MinerU 文件上传失败（HTTP ${uploadResponse.status}）。`);

    for (let attempt = 0; attempt < maxPolls; attempt += 1) {
      if (attempt > 0) await sleep(pollIntervalMs);
      const resultResponse = await fetcher(`${endpoint}/extract-results/batch/${encodeURIComponent(batchId)}`, {
        method: 'GET',
        headers: { Authorization: headers.Authorization },
        signal: options.signal
      });
      const resultPayload = await readJson(resultResponse, 'MinerU 查询任务');
      const result = resultPayload?.data?.extract_result?.[0];
      if (!result) throw new Error(resultPayload?.msg || 'MinerU 未返回任务状态。');
      const progress = result.extract_progress || {};
      await emit(options, {
        stage: 'mineru-api-poll',
        message: progress.total_pages
          ? `MinerU：已解析 ${progress.extracted_pages || 0}/${progress.total_pages} 页`
          : `MinerU：${stateLabel(result.state)}`,
        extractedPages: progress.extracted_pages || 0,
        totalPages: progress.total_pages || 0,
        remoteState: result.state
      });
      if (result.state === 'failed') throw new Error(result.err_msg || 'MinerU 解析失败。');
      if (result.state !== 'done') continue;
      if (!result.full_zip_url) throw new Error('MinerU 完成任务未返回结果下载地址。');

      await emit(options, { stage: 'mineru-api-download', message: 'MinerU：正在下载 Markdown 结果' });
      const zipResponse = await fetcher(result.full_zip_url, { method: 'GET', signal: options.signal });
      if (!zipResponse.ok) throw new Error(`MinerU 结果下载失败（HTTP ${zipResponse.status}）。`);
      const zipBuffer = Buffer.from(await zipResponse.arrayBuffer());
      const markdown = extractZipEntryEndingWith(zipBuffer, 'full.md').trim();
      if (!markdown) throw new Error('MinerU 结果 ZIP 中未找到 full.md。');
      const contentListText = extractZipEntryEndingWith(zipBuffer, 'content_list.json');
      if (contentListText) {
        try {
          const artifact = normalizeOcrArtifact(JSON.parse(contentListText), 'mineru');
          if (artifact.spans.length) {
            return {
              status: 'ok', engine: 'mineru-api-markdown', text: artifact.markdown,
              pages: artifact.pages, provenance: { version: artifact.provenance_version, spans: artifact.spans }, message: ''
            };
          }
        } catch (error) {
          emitProvenanceDiag('mineru.provenance', 'structured_result_invalid');
        }
      }
      emitProvenanceDiag('mineru.provenance', 'markdown_only');
      return { status: 'ok', engine: 'mineru-api-markdown', text: markdown, message: '' };
    }
    throw new Error(`MinerU 解析超时（${Math.round(maxPolls * pollIntervalMs / 1000)} 秒）。`);
  } catch (error) {
    return { status: 'failed', engine: 'mineru-api', text: '', message: safeError(error) };
  }
}

async function readJson(response, operation) {
  if (!response || !response.ok) throw new Error(`${operation}失败（HTTP ${response?.status || 0}）。`);
  const payload = await response.json();
  if (payload?.code !== undefined && payload.code !== 0) throw new Error(`${operation}失败：${payload.msg || payload.code}`);
  return payload;
}

function stateLabel(state) {
  return ({ 'waiting-file': '等待文件上传', pending: '排队中', running: '正在解析', converting: '正在转换格式' })[state] || String(state || '处理中');
}

function safeFileName(value) {
  return String(value || 'source.pdf').split(/[\\/]/).pop().replace(/[^\p{L}\p{N}._()（）\- ]/gu, '_') || 'source.pdf';
}

function safeError(error) {
  return String(error?.message || error || '未知错误').replace(/Bearer\s+\S+/gi, 'Bearer ***');
}

function unavailable(message) {
  return Promise.resolve({ status: 'unavailable', engine: 'mineru-api', text: '', message });
}

function emitProvenanceDiag(scope, reason) {
  try { globalThis.__eksDiag?.diag?.(scope, { count: 1, reason }); } catch (_) {}
}

async function emit(options, payload) {
  if (typeof options.onProgress === 'function') await options.onProgress(payload);
}

function cancellableDelay(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(Object.assign(new Error('任务已取消'), { name: 'AbortError', code: 'TASK_CANCELLED' }));
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(timer);
      reject(Object.assign(new Error('任务已取消'), { name: 'AbortError', code: 'TASK_CANCELLED' }));
    }, { once: true });
  });
}

module.exports = { runMineruApi };

},
/**
 * @module src/core/paddleocr-api
 * 飞桨 PaddleOCR API 调用层：单页/多页图像 OCR
 * @exports runPaddleOcrApi
 */
"src/core/paddleocr-api.js": function(require, module, exports) {
const { normalizeOcrArtifact } = require("src/core/provenance.js");

async function runPaddleOcrApi(buffer, options = {}) {
  if (!options.apiKey) return unavailable('未配置 PaddleOCR API Token。');
  const fetcher = options.requestImpl || options.fetchImpl || globalThis.fetch;
  const FormDataCtor = options.FormDataCtor || globalThis.FormData;
  const BlobCtor = options.BlobCtor || globalThis.Blob;
  if (typeof fetcher !== 'function' || (!options.requestImpl && (typeof FormDataCtor !== 'function' || typeof BlobCtor !== 'function'))) {
    return unavailable('当前环境不支持 PaddleOCR 文件上传。');
  }

  const endpoint = String(options.endpoint || 'https://paddleocr.aistudio-app.com/api/v2/ocr/jobs').replace(/\/$/, '');
  const headers = { Authorization: `bearer ${options.apiKey}` };
  const pollIntervalMs = Math.max(500, Number(options.pollIntervalMs) || 5000);
  const maxPolls = Math.max(1, Math.ceil((Number(options.timeoutMs) || 300000) / pollIntervalMs));
  const sleep = options.sleep || ((ms) => cancellableDelay(ms, options.signal));

  try {
    const optionalPayload = JSON.stringify({
      useDocOrientationClassify: options.useDocOrientationClassify === true,
      useDocUnwarping: options.useDocUnwarping === true,
      useChartRecognition: options.useChartRecognition === true
    });
    const upload = options.requestImpl
      ? multipartUpload(buffer, options, optionalPayload)
      : browserFormUpload(buffer, options, optionalPayload, FormDataCtor, BlobCtor);

    await emit(options, { stage: 'paddleocr-api-submit', message: 'PaddleOCR：正在提交解析任务' });
    const createResponse = await fetcher(endpoint, {
      method: 'POST',
      headers: Object.assign({}, headers, upload.headers),
      body: upload.body,
      signal: options.signal
    });
    const createPayload = await readJson(createResponse, 'PaddleOCR 提交任务');
    const jobId = createPayload?.data?.jobId;
    if (!jobId) throw new Error('PaddleOCR 未返回任务 ID。');

    for (let attempt = 0; attempt < maxPolls; attempt += 1) {
      if (attempt > 0) await sleep(pollIntervalMs);
      const jobResponse = await fetcher(`${endpoint}/${encodeURIComponent(jobId)}`, { method: 'GET', headers, signal: options.signal });
      const jobPayload = await readJson(jobResponse, 'PaddleOCR 查询任务');
      const data = jobPayload?.data || {};
      const progress = data.extractProgress || {};
      await emit(options, {
        stage: 'paddleocr-api-poll',
        message: progress.totalPages
          ? `PaddleOCR：已解析 ${progress.extractedPages || 0}/${progress.totalPages} 页`
          : `PaddleOCR：${stateLabel(data.state)}`,
        extractedPages: progress.extractedPages || 0,
        totalPages: progress.totalPages || 0,
        remoteState: data.state
      });
      if (data.state === 'failed') throw new Error(data.errorMsg || 'PaddleOCR 解析失败。');
      if (data.state !== 'done') continue;
      const jsonUrl = data.resultUrl?.jsonUrl;
      if (!jsonUrl) throw new Error('PaddleOCR 完成任务未返回 JSONL 下载地址。');

      await emit(options, { stage: 'paddleocr-api-download', message: 'PaddleOCR：正在下载 Markdown 结果' });
      const resultResponse = await fetcher(jsonUrl, { method: 'GET', signal: options.signal });
      if (!resultResponse.ok) throw new Error(`PaddleOCR 结果下载失败（HTTP ${resultResponse.status}）。`);
      const text = await resultResponse.text();
      const parsedArtifact = parsePaddleArtifact(text);
      const markdown = parsedArtifact.markdown || parsePaddleJsonl(text);
      if (!markdown) throw new Error('PaddleOCR 结果中没有可用的 Markdown。');
      return {
        status: 'ok', engine: 'paddleocr-api-markdown', text: markdown,
        ...(parsedArtifact.spans.length ? {
          pages: parsedArtifact.pages,
          provenance: { version: parsedArtifact.provenance_version, spans: parsedArtifact.spans }
        } : {}),
        message: ''
      };
    }
    throw new Error(`PaddleOCR 解析超时（${Math.round(maxPolls * pollIntervalMs / 1000)} 秒）。`);
  } catch (error) {
    return { status: 'failed', engine: 'paddleocr-api', text: '', message: safeError(error) };
  }
}

function browserFormUpload(buffer, options, optionalPayload, FormDataCtor, BlobCtor) {
  const form = new FormDataCtor();
  form.append('model', options.model || 'PaddleOCR-VL-1.6');
  form.append('optionalPayload', optionalPayload);
  form.append(
    'file',
    new BlobCtor([Buffer.from(buffer || [])], { type: 'application/pdf' }),
    safeFileName(options.fileName || 'source.pdf')
  );
  return { headers: {}, body: form };
}

function multipartUpload(buffer, options, optionalPayload) {
  const boundary = `----eks-${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}`;
  const fileName = safeFileName(options.fileName || 'source.pdf').replace(/"/g, '_');
  const chunks = [];
  const field = (name, value) => {
    chunks.push(Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`,
      'utf8'
    ));
  };
  field('model', options.model || 'PaddleOCR-VL-1.6');
  field('optionalPayload', optionalPayload);
  chunks.push(Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${fileName}"\r\nContent-Type: application/pdf\r\n\r\n`,
    'utf8'
  ));
  chunks.push(Buffer.from(buffer || []));
  chunks.push(Buffer.from(`\r\n--${boundary}--\r\n`, 'utf8'));
  return {
    headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` },
    body: Buffer.concat(chunks)
  };
}

function parsePaddleJsonl(value) {
  const pages = [];
  for (const line of String(value || '').split(/\r?\n/)) {
    if (!line.trim()) continue;
    const parsed = JSON.parse(line);
    for (const result of parsed?.result?.layoutParsingResults || []) {
      const markdown = String(result?.markdown?.text || '').trim();
      if (markdown) pages.push(markdown);
    }
  }
  return pages.join('\n\n').trim();
}

function parsePaddleArtifact(value) {
  const pages = [];
  for (const line of String(value || '').split(/\r?\n/)) {
    if (!line.trim()) continue;
    const parsed = JSON.parse(line);
    for (const result of parsed?.result?.layoutParsingResults || []) {
      pages.push(Object.assign({}, result?.prunedResult || result, {
        page: result?.page ?? result?.page_no ?? result?.page_index + 1
      }));
    }
  }
  const artifact = normalizeOcrArtifact(pages, 'paddle');
  if (!artifact.spans.length) emitProvenanceDiag('paddle.provenance', 'markdown_only');
  return artifact;
}

async function readJson(response, operation) {
  if (!response || !response.ok) throw new Error(`${operation}失败（HTTP ${response?.status || 0}）。`);
  return response.json();
}

function stateLabel(state) {
  return ({ pending: '排队中', running: '正在解析' })[state] || String(state || '处理中');
}

function safeFileName(value) {
  return String(value || 'source.pdf').split(/[\\/]/).pop().replace(/[^\p{L}\p{N}._()（）\- ]/gu, '_') || 'source.pdf';
}

function safeError(error) {
  return String(error?.message || error || '未知错误').replace(/bearer\s+\S+/gi, 'bearer ***');
}

function unavailable(message) {
  return Promise.resolve({ status: 'unavailable', engine: 'paddleocr-api', text: '', message });
}

function emitProvenanceDiag(scope, reason) {
  try { globalThis.__eksDiag?.diag?.(scope, { count: 1, reason }); } catch (_) {}
}

async function emit(options, payload) {
  if (typeof options.onProgress === 'function') await options.onProgress(payload);
}

function cancellableDelay(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(Object.assign(new Error('任务已取消'), { name: 'AbortError', code: 'TASK_CANCELLED' }));
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(timer);
      reject(Object.assign(new Error('任务已取消'), { name: 'AbortError', code: 'TASK_CANCELLED' }));
    }, { once: true });
  });
}

module.exports = { parsePaddleArtifact, parsePaddleJsonl, runPaddleOcrApi };

},
/**
 * @module src/core/zip
 * 轻量 zip 解压（仅 zip.js / fflate-free，避免大依赖）
 * @exports extractZipEntryEndingWith
 */
"src/core/zip.js": function(require, module, exports) {
const zlib = require("zlib");

function extractZipEntryEndingWith(buffer, suffix) {
  const input = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer || []);
  const endOffset = findEndOfCentralDirectory(input);
  if (endOffset < 0) return '';

  const entryCount = input.readUInt16LE(endOffset + 10);
  let cursor = input.readUInt32LE(endOffset + 16);
  for (let index = 0; index < entryCount; index += 1) {
    if (cursor + 46 > input.length || input.readUInt32LE(cursor) !== 0x02014b50) break;
    const method = input.readUInt16LE(cursor + 10);
    const compressedSize = input.readUInt32LE(cursor + 20);
    const fileNameLength = input.readUInt16LE(cursor + 28);
    const extraLength = input.readUInt16LE(cursor + 30);
    const commentLength = input.readUInt16LE(cursor + 32);
    const localHeaderOffset = input.readUInt32LE(cursor + 42);
    const name = decodeZipFileName(input, cursor).replace(/\\/g, '/');
    if (name.toLowerCase().endsWith(String(suffix || '').toLowerCase())) {
      const content = readLocalEntry(input, localHeaderOffset, compressedSize, method);
      return content.toString('utf8');
    }
    cursor += 46 + fileNameLength + extraLength + commentLength;
  }
  return '';
}

// v2.9.1: ZIP 文件名解码。旧版一律按 UTF-8 解，而 Windows 资源管理器压缩、
//   旧版 7-Zip 等会把文件名以 GBK 字节直接写入且不设 EFS 标志
//   （通用位标志 bit 11 = 0x800），中文条目名变成「娴嬭瘯.md」式乱码，
//   按后缀查找 .md 条目时匹配不到。规则：
//   EFS 置位 → UTF-8；否则字节流构成合法 UTF-8（纯 ASCII 或含非 ASCII 均算）
//   → UTF-8；含非法序列 → 试 GBK（Windows 中文环境最常见）；最终兜底 latin1。
function decodeZipFileName(input, centralDirOffset) {
  const flags = input.readUInt16LE(centralDirOffset + 8);
  const fileNameLength = input.readUInt16LE(centralDirOffset + 28);
  const raw = input.slice(centralDirOffset + 46, centralDirOffset + 46 + fileNameLength);
  if (flags & 0x800) return raw.toString('utf8');
  const utf8 = raw.toString('utf8');
  if (!utf8.includes('\uFFFD')) return utf8;
  // 含非法序列 → 不是 UTF-8，按 GBK 解码（Windows 中文压缩工具最常见）
  try {
    if (typeof TextDecoder === 'function') {
      const gbk = new TextDecoder('gbk', { fatal: false }).decode(raw);
      if (gbk && !gbk.includes('\uFFFD')) return gbk;
    }
  } catch {
    // 忽略：落到 latin1 兜底
  }
  return raw.toString('latin1');
}

function readLocalEntry(buffer, offset, compressedSize, method) {
  if (offset + 30 > buffer.length || buffer.readUInt32LE(offset) !== 0x04034b50) return Buffer.alloc(0);
  const fileNameLength = buffer.readUInt16LE(offset + 26);
  const extraLength = buffer.readUInt16LE(offset + 28);
  const start = offset + 30 + fileNameLength + extraLength;
  const compressed = buffer.slice(start, start + compressedSize);
  if (method === 0) return compressed;
  if (method === 8) return zlib.inflateRawSync(compressed);
  throw new Error(`不支持的 ZIP 压缩方式：${method}`);
}

function findEndOfCentralDirectory(buffer) {
  const minimum = Math.max(0, buffer.length - 65557);
  for (let offset = buffer.length - 22; offset >= minimum; offset -= 1) {
    if (buffer.readUInt32LE(offset) === 0x06054b50) return offset;
  }
  return -1;
}

module.exports = { extractZipEntryEndingWith };

},
/**
 * @module src/core/component-loader
 * Component path and legacy folder-map contract boundary.
 */
"src/core/component-loader.js": function(require, module, exports) {
const ALLOWED_EXTENSIONS = new Set(['.json', '.md']);
const BUILTIN_SCHEMA_VERSION = '2.17.2';
const BUILTIN_INFRASTRUCTURE_SCHEMAS = Object.freeze({
  'schemas/block-v0.schema.json': Object.freeze({
    version: BUILTIN_SCHEMA_VERSION,
    hash: 'dfb742a17c699cadab370f8d9c3e3c741fd38b465652805338a539a0d63e514a',
    base64: 'ewogICIkc2NoZW1hIjogImh0dHBzOi8vanNvbi1zY2hlbWEub3JnL2RyYWZ0LzIwMjAtMTIvc2NoZW1hIiwKICAiJGlkIjogImh0dHBzOi8vZW5naW5lZXJpbmcta25vd2xlZGdlLXNsaWNlci5sb2NhbC9zY2hlbWFzL2Jsb2NrLXYwLnNjaGVtYS5qc29uIiwKICAidGl0bGUiOiAiRW5naW5lZXJpbmcgS25vd2xlZGdlIFNsaWNlciBwZXJtaXNzaXZlIGJsb2NrX3YwIiwKICAidHlwZSI6ICJvYmplY3QiLAogICJyZXF1aXJlZCI6IFsic2NoZW1hX3ZlcnNpb24iLCAiYmxvY2tfaWQiLCAic291cmNlX2hhc2giLCAib3JkZXIiLCAicGFyZW50X2lkIiwgImtpbmQiLCAibG9jYXRvciIsICJwcm92ZW5hbmNlIiwgInJhdyIsICJpbmZlcnJlZCIsICJwYXJzZSIsICJjYXJkX2VsaWdpYmxlIiwgImV4Y2x1c2lvbl9yZWFzb24iLCAibWV0YWRhdGEiXSwKICAicHJvcGVydGllcyI6IHsKICAgICJzY2hlbWFfdmVyc2lvbiI6IHsgImNvbnN0IjogImJsb2NrX3YwIiB9LAogICAgImJsb2NrX2lkIjogeyAidHlwZSI6ICJzdHJpbmciLCAicGF0dGVybiI6ICJeYmxvY2stW2EtZjAtOV17MjR9JCIgfSwKICAgICJzb3VyY2VfaGFzaCI6IHsgInR5cGUiOiAic3RyaW5nIiwgInBhdHRlcm4iOiAiXlthLWYwLTldezY0fSQiIH0sCiAgICAib3JkZXIiOiB7ICJ0eXBlIjogImludGVnZXIiLCAibWluaW11bSI6IDAgfSwKICAgICJwYXJlbnRfaWQiOiB7ICJ0eXBlIjogWyJzdHJpbmciLCAibnVsbCJdIH0sCiAgICAia2luZCI6IHsgInR5cGUiOiAic3RyaW5nIiwgIm1pbkxlbmd0aCI6IDEgfSwKICAgICJsb2NhdG9yIjogeyAiJHJlZiI6ICIjLyRkZWZzL2xvY2F0b3IiIH0sCiAgICAicHJvdmVuYW5jZSI6IHsgInR5cGUiOiAiYXJyYXkiLCAiaXRlbXMiOiB7ICIkcmVmIjogIiMvJGRlZnMvbG9jYXRvciIgfSB9LAogICAgInJhdyI6IHsKICAgICAgInR5cGUiOiAib2JqZWN0IiwKICAgICAgInJlcXVpcmVkIjogWyJ0ZXh0IiwgImZpZWxkcyJdLAogICAgICAicHJvcGVydGllcyI6IHsgInRleHQiOiB7ICJ0eXBlIjogInN0cmluZyIgfSwgImZpZWxkcyI6IHsgInR5cGUiOiAib2JqZWN0IiwgImFkZGl0aW9uYWxQcm9wZXJ0aWVzIjogdHJ1ZSB9IH0sCiAgICAgICJhZGRpdGlvbmFsUHJvcGVydGllcyI6IHRydWUKICAgIH0sCiAgICAiaW5mZXJyZWQiOiB7ICJ0eXBlIjogIm9iamVjdCIsICJhZGRpdGlvbmFsUHJvcGVydGllcyI6IHRydWUgfSwKICAgICJwYXJzZSI6IHsKICAgICAgInR5cGUiOiAib2JqZWN0IiwKICAgICAgInJlcXVpcmVkIjogWyJtZXRob2QiLCAicXVhbGl0eSIsICJzdGF0dXMiXSwKICAgICAgInByb3BlcnRpZXMiOiB7CiAgICAgICAgIm1ldGhvZCI6IHsgInR5cGUiOiAic3RyaW5nIiB9LAogICAgICAgICJxdWFsaXR5IjogeyAidHlwZSI6ICJudW1iZXIiLCAibWluaW11bSI6IDAsICJtYXhpbXVtIjogMSB9LAogICAgICAgICJzdGF0dXMiOiB7ICJlbnVtIjogWyJwcmVzZW50IiwgIm1pc3NpbmciLCAidW5zdXBwb3J0ZWQiLCAiZXh0cmFjdGlvbl9mYWlsZWQiXSB9CiAgICAgIH0sCiAgICAgICJhZGRpdGlvbmFsUHJvcGVydGllcyI6IHRydWUKICAgIH0sCiAgICAiY2FyZF9lbGlnaWJsZSI6IHsgInR5cGUiOiAiYm9vbGVhbiIgfSwKICAgICJleGNsdXNpb25fcmVhc29uIjogeyAidHlwZSI6IFsic3RyaW5nIiwgIm51bGwiXSB9LAogICAgIm1ldGFkYXRhIjogeyAidHlwZSI6ICJvYmplY3QiLCAiYWRkaXRpb25hbFByb3BlcnRpZXMiOiB0cnVlIH0KICB9LAogICIkZGVmcyI6IHsKICAgICJsb2NhdG9yIjogewogICAgICAidHlwZSI6ICJvYmplY3QiLAogICAgICAicmVxdWlyZWQiOiBbInNjaGVtZSIsICJ2YWx1ZSJdLAogICAgICAicHJvcGVydGllcyI6IHsgInNjaGVtZSI6IHsgInR5cGUiOiAic3RyaW5nIiwgIm1pbkxlbmd0aCI6IDEgfSwgInZhbHVlIjogeyAidHlwZSI6ICJzdHJpbmciIH0gfSwKICAgICAgImFkZGl0aW9uYWxQcm9wZXJ0aWVzIjogdHJ1ZQogICAgfQogIH0sCiAgImFkZGl0aW9uYWxQcm9wZXJ0aWVzIjogdHJ1ZQp9Cg=='
  }),
  'schemas/parse-package.schema.json': Object.freeze({
    version: BUILTIN_SCHEMA_VERSION,
    hash: '3a1d2efe1a804834e7310b79161817888ff82ee2dbad15fad0c492a67570f31b',
    base64: 'ewogICIkc2NoZW1hIjogImh0dHBzOi8vanNvbi1zY2hlbWEub3JnL2RyYWZ0LzIwMjAtMTIvc2NoZW1hIiwKICAiJGlkIjogImVuZ2luZWVyaW5nLWtub3dsZWRnZS1zbGljZXI6Ly9zY2hlbWEvcGFyc2UtcGFja2FnZS0xLjEiLAogICJ0eXBlIjogIm9iamVjdCIsCiAgImFkZGl0aW9uYWxQcm9wZXJ0aWVzIjogZmFsc2UsCiAgInJlcXVpcmVkIjogWyJzb3VyY2VfcGF0aCIsICJzb3VyY2VfaGFzaCIsICJzb3VyY2VfdHlwZSIsICJwYXJzZXIiLCAibGFuZ3VhZ2UiLCAibWFya2Rvd24iLCAicGFnZXMiLCAicXVhbGl0eSIsICJzY2hlbWFfdmVyc2lvbiJdLAogICJwcm9wZXJ0aWVzIjogewogICAgInNvdXJjZV9wYXRoIjogeyAidHlwZSI6ICJzdHJpbmciLCAibWluTGVuZ3RoIjogMSB9LAogICAgInNvdXJjZV9oYXNoIjogeyAidHlwZSI6ICJzdHJpbmciLCAicGF0dGVybiI6ICJeW2EtZjAtOV17NjR9JCIgfSwKICAgICJzb3VyY2VfdHlwZSI6IHsgInR5cGUiOiAic3RyaW5nIiwgIm1pbkxlbmd0aCI6IDEgfSwKICAgICJwYXJzZXIiOiB7ICJlbnVtIjogWyJtaW5lcnUtYXBpIiwgInBhZGRsZW9jci1hcGkiLCAidGV4dC1ub3JtYWxpemVyIiwgImVtbC1wYXJzZXIiXSB9LAogICAgInBhcnNlcl9tb2RlbCI6IHsgInR5cGUiOiAic3RyaW5nIiB9LAogICAgInJlbW90ZV9qb2JfaWQiOiB7ICJ0eXBlIjogInN0cmluZyIgfSwKICAgICJsYW5ndWFnZSI6IHsgImVudW0iOiBbInpoIiwgImVuIiwgImphIiwgIm1peGVkIiwgInVua25vd24iXSB9LAogICAgIm1hcmtkb3duIjogeyAidHlwZSI6ICJzdHJpbmciIH0sCiAgICAicGFnZXMiOiB7CiAgICAgICJ0eXBlIjogImFycmF5IiwKICAgICAgIml0ZW1zIjogewogICAgICAgICJ0eXBlIjogIm9iamVjdCIsCiAgICAgICAgInJlcXVpcmVkIjogWyJwYWdlIiwgInRleHQiXSwKICAgICAgICAicHJvcGVydGllcyI6IHsKICAgICAgICAgICJwYWdlIjogeyAidHlwZSI6ICJpbnRlZ2VyIiwgIm1pbmltdW0iOiAxIH0sCiAgICAgICAgICAidGV4dCI6IHsgInR5cGUiOiAic3RyaW5nIiB9LAogICAgICAgICAgInNwYW5faWRzIjogeyAidHlwZSI6ICJhcnJheSIsICJpdGVtcyI6IHsgInR5cGUiOiAic3RyaW5nIiB9IH0KICAgICAgICB9CiAgICAgIH0KICAgIH0sCiAgICAicHJvdmVuYW5jZSI6IHsKICAgICAgInR5cGUiOiAib2JqZWN0IiwKICAgICAgInJlcXVpcmVkIjogWyJ2ZXJzaW9uIiwgInNwYW5zIl0sCiAgICAgICJwcm9wZXJ0aWVzIjogewogICAgICAgICJ2ZXJzaW9uIjogeyAidHlwZSI6ICJzdHJpbmciIH0sCiAgICAgICAgInNwYW5zIjogewogICAgICAgICAgInR5cGUiOiAiYXJyYXkiLAogICAgICAgICAgIml0ZW1zIjogewogICAgICAgICAgICAidHlwZSI6ICJvYmplY3QiLAogICAgICAgICAgICAicmVxdWlyZWQiOiBbInNwYW5faWQiLCAic3RhcnQiLCAiZW5kIiwgInRleHQiLCAidGV4dF9oYXNoIl0sCiAgICAgICAgICAgICJwcm9wZXJ0aWVzIjogewogICAgICAgICAgICAgICJzcGFuX2lkIjogeyAidHlwZSI6ICJzdHJpbmciIH0sCiAgICAgICAgICAgICAgInBhZ2UiOiB7ICJ0eXBlIjogImludGVnZXIiLCAibWluaW11bSI6IDEgfSwKICAgICAgICAgICAgICAiYmxvY2tfaWQiOiB7ICJ0eXBlIjogInN0cmluZyIgfSwKICAgICAgICAgICAgICAibGluZV9pZCI6IHsgInR5cGUiOiAic3RyaW5nIiB9LAogICAgICAgICAgICAgICJiYm94IjogeyAidHlwZSI6ICJhcnJheSIsICJpdGVtcyI6IHsgInR5cGUiOiAibnVtYmVyIiB9LCAibWluSXRlbXMiOiA0IH0sCiAgICAgICAgICAgICAgInN0YXJ0IjogeyAidHlwZSI6ICJpbnRlZ2VyIiwgIm1pbmltdW0iOiAwIH0sCiAgICAgICAgICAgICAgImVuZCI6IHsgInR5cGUiOiAiaW50ZWdlciIsICJtaW5pbXVtIjogMCB9LAogICAgICAgICAgICAgICJ0ZXh0IjogeyAidHlwZSI6ICJzdHJpbmciIH0sCiAgICAgICAgICAgICAgInRleHRfaGFzaCI6IHsgInR5cGUiOiAic3RyaW5nIiB9CiAgICAgICAgICAgIH0KICAgICAgICAgIH0KICAgICAgICB9CiAgICAgIH0KICAgIH0sCiAgICAiaW1hZ2VzIjogeyAidHlwZSI6ICJhcnJheSIsICJpdGVtcyI6IHsgInR5cGUiOiAib2JqZWN0IiB9IH0sCiAgICAicXVhbGl0eSI6IHsKICAgICAgInR5cGUiOiAib2JqZWN0IiwKICAgICAgInJlcXVpcmVkIjogWyJyZWFkYWJsZSIsICJzY29yZSIsICJjb21wb25lbnRzIl0sCiAgICAgICJwcm9wZXJ0aWVzIjogewogICAgICAgICJyZWFkYWJsZSI6IHsgInR5cGUiOiAiYm9vbGVhbiIgfSwKICAgICAgICAic2NvcmUiOiB7ICJ0eXBlIjogIm51bWJlciIsICJtaW5pbXVtIjogMCwgIm1heGltdW0iOiAxIH0sCiAgICAgICAgImNvbXBvbmVudHMiOiB7ICJ0eXBlIjogIm9iamVjdCIgfQogICAgICB9CiAgICB9LAogICAgInNjaGVtYV92ZXJzaW9uIjogeyAiY29uc3QiOiAiMS4xIiB9CiAgfQp9Cg=='
  })
});
const BUILTIN_INFRASTRUCTURE_SCHEMA_PATHS = Object.freeze(Object.keys(BUILTIN_INFRASTRUCTURE_SCHEMAS));

function builtInInfrastructureSchema(relativePath) {
  const normalized = normalizeComponentRelativePath(relativePath);
  const entry = BUILTIN_INFRASTRUCTURE_SCHEMAS[normalized];
  if (!entry) return null;
  const text = Buffer.from(entry.base64, 'base64').toString('utf8');
  const actualHash = require('crypto').createHash('sha256').update(text).digest('hex');
  if (actualHash !== entry.hash) {
    throw new ComponentError('COMPONENT_CONFIG_INVALID', '内置兼容 Schema 完整性校验失败。', {
      reason: 'builtin_schema_integrity', relativePath: normalized
    });
  }
  return Object.freeze({ relativePath: normalized, version: entry.version, hash: entry.hash, text });
}
const LEGACY_PROMPTS = Object.freeze({
  'bid:00-项目总览': '提示词/招投标/00-项目总览.md',
  'bid:01-营业与客户信息': '提示词/招投标/01-营业与客户信息.md',
  'bid:02-招标文件解读': '提示词/招投标/02-招标文件解读.md',
  'bid:03-投标决策与立项': '提示词/招投标/03-投标决策与立项.md',
  'bid:04-设计优化方案': '提示词/招投标/04-设计优化方案.md',
  'bid:04-设计优化方案及设计方案(EPC工程)': '提示词/招投标/04-EPC设计方案.md',
  'bid:05-报批报建（当地政策）': '提示词/招投标/05-报批报建.md',
  'bid:06-技术标': '提示词/招投标/06-技术标.md',
  'bid:07-商务报价': '提示词/招投标/07-商务报价.md',
  'bid:08-采购与分包': '提示词/招投标/08-采购与分包.md',
  'bid:09-风险评估与合规': '提示词/招投标/09-风险评估与合规.md',
  'bid:10-内部会议与评审': '提示词/招投标/10-内部会议与评审.md',
  'bid:11-答疑澄清与投标过程': '提示词/招投标/11-答疑澄清与投标过程.md',
  'bid:12-开标评标与中标跟踪': '提示词/招投标/12-开标评标与中标跟踪.md',
  'bid:13-合同谈判与签约': '提示词/招投标/13-合同谈判与签约.md',
  'bid:14-发表资料与对外汇报': '提示词/招投标/14-发表资料与对外汇报.md',
  'bid:15-复盘与知识沉淀': '提示词/招投标/15-复盘与知识沉淀.md',
  'bid:90-通用知识库': '提示词/招投标/90-通用知识库.md',
  'bid:91-模板库': '提示词/招投标/91-模板库.md',
  'business:01-客户库': '提示词/业务库/01-客户库.md',
  'business:02-案例库': '提示词/业务库/02-案例库.md',
  'business:03-提案库': '提示词/业务库/03-提案库.md',
  'business:04-报价库': '提示词/业务库/04-报价库.md',
  'business:05-施工计划库': '提示词/业务库/05-施工计划库.md',
  'business:06-风险库': '提示词/业务库/06-风险库.md',
  'business:07-失败中成长': '提示词/业务库/07-失败中成长.md',
  'business:08-人才能力库': '提示词/业务库/08-人才能力库.md',
  'business:09-政府申请（报批报建）': '提示词/业务库/09-政府申请.md'
});

class ComponentError extends Error {
  constructor(code, message, details = {}) {
    super(String(message || '组件配置错误'));
    this.name = 'ComponentError';
    this.code = code;
    this.category = 'component_config';
    this.retryable = false;
    this.stage = 'component-contracts';
    this.details = details;
  }
}

function fail(reason, value = '') {
  const extension = String(value || '').match(/(\.[^./\\]+)$/)?.[1]?.toLowerCase() || '';
  throw new ComponentError('COMPONENT_PATH_INVALID', '组件相对路径无效。', {
    reason, extension
  });
}

function normalizeComponentRelativePath(value, options = {}) {
  if (typeof value !== 'string') fail('not_a_string', value);
  const original = value;
  const replaced = original.trim().replace(/\\/g, '/');
  if (!replaced) fail('empty', original);
  if (replaced.endsWith('/')) fail('trailing_slash', original);
  if (replaced.startsWith('/') || /^[A-Za-z]:\//.test(replaced) || replaced.startsWith('//')) fail('absolute_path', original);
  if (/[\0-\x1f\x7f]/.test(replaced)) fail('control_character', original);
  const segments = replaced.split('/');
  if (segments.some((segment) => !segment || segment === '.' || segment === '..')) fail('unsafe_segment', original);
  const normalized = segments.join('/');
  const dot = normalized.lastIndexOf('.');
  const extension = dot >= 0 ? normalized.slice(dot).toLowerCase() : '';
  const allowed = new Set(options.allowedExtensions || ALLOWED_EXTENSIONS);
  if (!allowed.has(extension)) fail(extension ? 'unsupported_extension' : 'missing_extension', original);
  return normalized;
}

function resolveComponentFilePath(rootValue, relativeValue) {
  const root = String(rootValue || '').trim().replace(/\\/g, '/').replace(/\/+$/, '');
  if (!root || root === '.' || root.startsWith('/') || /^[A-Za-z]:\//.test(root)
    || /(^|\/)\.\.(?:\/|$)/.test(root)) {
    throw new ComponentError('COMPONENT_CONFIG_INVALID', '组件包根路径无效。', {
      reason: !root ? 'empty_component_root' : 'unsafe_component_root'
    });
  }
  const relativePath = normalizeComponentRelativePath(relativeValue);
  const path = `${root}/${relativePath}`.replace(/\/+/g, '/');
  if (path === root || !path.startsWith(`${root}/`)) {
    throw new ComponentError('COMPONENT_PATH_INVALID', '组件相对路径不能指向组件包根目录。', {
      reason: 'resolved_to_component_root'
    });
  }
  return path;
}

function normalizeFolderMapConfig(folderMap) {
  if (!folderMap || typeof folderMap !== 'object' || Array.isArray(folderMap) || !Array.isArray(folderMap.routes)) {
    throw new ComponentError('COMPONENT_CONFIG_INVALID', 'folder-map.json 缺少 routes 数组。', {
      reason: 'routes_missing'
    });
  }
  const seen = new Set();
  const routes = folderMap.routes.map((route, index) => {
    if (!route || typeof route !== 'object' || Array.isArray(route)) {
      throw new ComponentError('COMPONENT_CONFIG_INVALID', `folder-map route ${index + 1} 无效。`, {
        reason: 'route_not_object', routeIndex: index
      });
    }
    const next = Object.assign({}, route);
    const library = String(next.library || '').trim();
    const folderType = String(next.folder_type || '').trim();
    const outputFolder = String(next.output_folder || '').trim();
    if (!library || !folderType || !outputFolder) {
      throw new ComponentError('COMPONENT_CONFIG_INVALID', `folder-map route ${index + 1} 缺少必填字段。`, {
        reason: 'route_fields_missing', routeIndex: index
      });
    }
    const routeKey = `${library}:${folderType}`;
    if (seen.has(routeKey)) {
      throw new ComponentError('COMPONENT_CONFIG_INVALID', `folder-map route ${index + 1} 重复。`, {
        reason: 'duplicate_route', routeIndex: index
      });
    }
    seen.add(routeKey);
    const normalizedOutput = outputFolder.replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+/g, '/').replace(/\/+$/, '');
    if (!normalizedOutput || normalizedOutput.split('/').some((part) => part === '.' || part === '..')) {
      throw new ComponentError('COMPONENT_CONFIG_INVALID', `folder-map route ${index + 1} 输出路径无效。`, {
        reason: 'unsafe_output_folder', routeIndex: index
      });
    }
    next.output_folder = normalizedOutput;
    const candidates = [next.prompt, next.prompt_path, next.promptPath, next.template]
      .filter((candidate) => typeof candidate === 'string' && candidate.trim());
    if (candidates.length > 1 && new Set(candidates.map((item) => item.trim().replace(/\\/g, '/'))).size > 1) {
      throw new ComponentError('COMPONENT_CONFIG_INVALID', `folder-map route ${index + 1} 含冲突 prompt 字段。`, {
        reason: 'ambiguous_prompt_fields', routeIndex: index
      });
    }
    let prompt = candidates[0];
    if (!prompt) prompt = LEGACY_PROMPTS[`${String(next.library || '').trim()}:${String(next.folder_type || '').trim()}`];
    if (!prompt) {
      throw new ComponentError('COMPONENT_CONFIG_INVALID', `folder-map route ${index + 1} 缺少可确定的 prompt。`, {
        reason: 'prompt_missing', routeIndex: index,
        library: String(next.library || '').slice(0, 24),
        folderTypeHashRequired: Boolean(next.folder_type)
      });
    }
    next.prompt = normalizeComponentRelativePath(prompt, { allowedExtensions: ['.md'] });
    delete next.prompt_path;
    delete next.promptPath;
    delete next.template;
    return next;
  });
  return Object.assign({}, folderMap, { routes });
}

function validateRuntimeContracts(contracts) {
  for (const [name, schema] of Object.entries(contracts?.schemas || {})) {
    if (!schema || typeof schema !== 'object' || Array.isArray(schema)
      || schema.type !== 'object' || !schema.properties || !Array.isArray(schema.required)) {
      throw new ComponentError('COMPONENT_CONFIG_INVALID', `Schema 配置无效：${name}`, {
        reason: 'schema_contract_invalid', component: name
      });
    }
  }
  for (const [name, prompt] of Object.entries(contracts?.prompts || {})) {
    if (typeof prompt !== 'string' || !prompt.trim()) {
      throw new ComponentError('COMPONENT_CONFIG_INVALID', `Prompt/模板内容为空：${name}`, {
        reason: 'prompt_content_empty', component: name
      });
    }
  }
  return contracts;
}

module.exports = {
  BUILTIN_INFRASTRUCTURE_SCHEMA_PATHS,
  ComponentError,
  LEGACY_PROMPTS,
  builtInInfrastructureSchema,
  normalizeComponentRelativePath,
  normalizeFolderMapConfig,
  resolveComponentFilePath,
  validateRuntimeContracts
};

},
/**
 * @module src/core/component-contracts
 * 跨模块共享的契约 / 类型守卫 / 卡片字段约束
 */
"src/core/component-contracts.js": function(require, module, exports) {
function parseFolderMap(text) {
  let parsed;
  try {
    parsed = JSON.parse(String(text || ''));
  } catch (error) {
    throw new Error(`folder-map.json is not valid JSON: ${error.message}`);
  }
  return parsed;
}

function validateFolderMap(folderMap, promptExists = () => true) {
  const errors = [];
  if (!folderMap || typeof folderMap !== 'object') return ['folder map must be an object'];
  if (folderMap.version !== '1.1') errors.push('folder map version must be 1.1');
  if (!Array.isArray(folderMap.routes)) return [...errors, 'folder map routes must be an array'];

  const seen = new Set();
  let bidCount = 0;
  let businessCount = 0;
  for (const [index, route] of folderMap.routes.entries()) {
    const label = `route ${index + 1}`;
    if (!route || typeof route !== 'object') {
      errors.push(`${label} must be an object`);
      continue;
    }
    if (!['bid', 'business'].includes(route.library)) errors.push(`${label} library must be bid or business`);
    if (route.library === 'bid') bidCount += 1;
    if (route.library === 'business') businessCount += 1;
    if (!String(route.folder_type || '').trim()) errors.push(`${label} folder_type is required`);

    const key = `${route.library}:${route.folder_type}`;
    if (seen.has(key)) errors.push(`duplicate route: ${key}`);
    seen.add(key);

    const root = route.library === 'bid'
      ? '06-知识库/wiki/招投标/'
      : route.library === 'business'
        ? '06-知识库/wiki/业务库/'
        : '';
    const output = String(route.output_folder || '').replace(/\\/g, '/');
    if (!root || !output.startsWith(root) || /category|tagl1|tagl2/i.test(output)) {
      errors.push(`${label} output_folder must use its fixed wiki root`);
    }
    if (!String(route.prompt || '').startsWith('提示词/')) errors.push(`${label} prompt path is invalid`);
    else if (!promptExists(route.prompt)) errors.push(`${label} prompt does not exist: ${route.prompt}`);
  }

  if (bidCount !== 19) errors.push(`expected 19 bid routes, got ${bidCount}`);
  if (businessCount !== 9) errors.push(`expected 9 business routes, got ${businessCount}`);
  return errors;
}

function validateSchemaDocument(schema) {
  const errors = [];
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) return ['schema must be an object'];
  if (schema.$schema !== 'https://json-schema.org/draft/2020-12/schema') errors.push('schema draft must be 2020-12');
  if (!String(schema.$id || '').startsWith('engineering-knowledge-slicer://schema/')) errors.push('schema $id is invalid');
  if (schema.type !== 'object') errors.push('root schema type must be object');
  if (!schema.properties || typeof schema.properties !== 'object') errors.push('schema properties are required');
  if (!Array.isArray(schema.required)) errors.push('schema required must be an array');
  if (typeof schema.additionalProperties !== 'boolean') errors.push('schema must decide additionalProperties explicitly');
  return errors;
}

module.exports = {
  parseFolderMap,
  validateFolderMap,
  validateSchemaDocument
};

},
/**
 * @module src/core/migration
 * tasks.json 老格式迁移：v1/v2 ledger → v3 标准格式
 * 含字段补全 / 状态重映射 / 备份
 * @exports migrateTaskLedgerV3
 */
"src/core/migration.js": function(require, module, exports) {
const crypto = require("crypto");

const LEGACY_ACTIVE = new Set(['extracting', 'parsing', 'classifying', 'summarizing', 'slicing', 'atomizing', 'validating', 'writing']);
const VALID_TERMINAL = new Set(['queued', 'written', 'needs_review', 'completed_no_output', 'needs_ocr', 'failed', 'skipped', 'cancelled', 'unsupported', 'unsupported_media', 'paused', 'rolled_back']);

// v1.1.3: bundle 内每个模块都是独立作用域，main.js 顶层定义进不来。
// 这里保留一份与主定义完全一致的局部副本，专门给 migrateTaskLedgerV3 用。
function normalizeUnicodeForm(value) {
  let str = String(value || '');
  if (!str) return str;
  if (typeof str.normalize === 'function') {
    try { str = str.normalize('NFC'); } catch { /* 不可用则忽略 */ }
  }
  str = str.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F\uFEFF]/g, '');
  str = str.replace(/ {2,}/g, ' ');
  return str;
}

function migrateVaultPath(value) {
  const original = String(value || '');
  const cleaned = normalizeUnicodeForm(original).replace(/\\/g, '/');
  const unsafe = !cleaned || cleaned.startsWith('/') || /^[A-Za-z]:(?:\/|$)/.test(cleaned)
    || /[\x00-\x1F\x7F]/.test(original)
    || cleaned.split('/').some((part) => !part || part === '.' || part === '..');
  return {
    path: unsafe ? '' : cleaned,
    rejected: unsafe && original ? {
      reason: 'unsafe_legacy_path',
      redacted_hint: `<rejected-path:${Buffer.byteLength(original, 'utf8')}b>`
    } : null
  };
}

function migrateTaskLedgerV3(tasks, versions = {}) {
  const pipelineVersion = versions.pipelineVersion || '1.1.1';
  const promptBundleVersion = versions.promptBundleVersion || '1.1';
  return (Array.isArray(tasks) ? tasks : []).map((task) => {
    const canonical = ['1.1', '1.2'].includes(task.schema_version) && Boolean(task.task_id) && Boolean(task.run_id);
    // v1.1.2: 旧任务 source_path 可能在 macOS 上是 NFD 编码、Windows 上是 GBK，统一规范成 NFC，
    // 避免按路径查文件时因编码不一致出现"找不到源文件"。
    const migratedPath = migrateVaultPath(task.source_path || task.sourcePath || '');
    const sourcePath = migratedPath.path;
    const sourceHash = String(task.source_hash || task.sourceHash || '');
    const taskId = task.task_id || task.taskId || `slicer-${sourceHash.slice(0, 12)}`;
    const library = task.library || (sourcePath.includes('/业务库/') ? 'business' : 'bid');
    const wasActive = !canonical && LEGACY_ACTIVE.has(task.status);
    const status = canonical
      ? task.status
      : wasActive
      ? 'failed'
      : task.status === 'archived'
        ? 'written'
        : VALID_TERMINAL.has(task.status)
          ? task.status
          : 'failed';
    const errors = [...(Array.isArray(task.errors) ? task.errors : [])];
    if (wasActive) {
      errors.push({
        stage: 'migration',
        message: '版本升级后旧处理中任务无法安全续接，请手动重试。',
        at: new Date().toISOString()
      });
    }
    const runId = task.run_id || stableId(`${library}:${sourceHash}:${pipelineVersion}:${promptBundleVersion}`);
    const reviewAtomIds = [...new Set((Array.isArray(task.review_atom_ids)
      ? task.review_atom_ids
      : Array.isArray(task.draftFiles) ? task.draftFiles : []).map(String).filter(Boolean))];
    const hasPersistedReviewArtifact = Boolean(task.artifacts?.review);
    const hasConcreteReview = hasPersistedReviewArtifact && reviewAtomIds.length > 0;
    let migratedStatus = status;
    if (!hasConcreteReview && status === 'needs_review') {
      migratedStatus = (Array.isArray(task.written_card_ids) && task.written_card_ids.length) ? 'written' : 'completed_no_output';
    } else if (hasConcreteReview && status === 'completed_no_output') {
      migratedStatus = 'needs_review';
    }
    const normalized = {
      task_id: taskId,
      run_id: runId,
      source_path: sourcePath,
      source_aliases: Array.isArray(task.source_aliases) ? task.source_aliases : [],
      source_hash: sourceHash,
      source_type: task.source_type || task.sourceType || 'unknown',
      library,
      pipeline_version: pipelineVersion,
      prompt_bundle_version: promptBundleVersion,
      schema_version: versions.schemaVersion || '1.1',
      status: migratedStatus,
      remote_jobs: Array.isArray(task.remote_jobs) ? task.remote_jobs : [],
      retry_counts: task.retry_counts || {},
      artifacts: task.artifacts || {},
      written_card_ids: Array.isArray(task.written_card_ids) ? task.written_card_ids : [],
      writtenFiles: Array.isArray(task.writtenFiles) ? task.writtenFiles.map((value) => String(value).replace(/\\/g, '/')) : [],
      component_contract_hash: String(task.component_contract_hash || ''),
      review_atom_ids: reviewAtomIds,
      errors,
      progress: task.progress || {},
      lease: null,
      created_at: task.created_at || task.createdAt || new Date().toISOString(),
      updated_at: task.updated_at || task.updatedAt || new Date().toISOString()
    };
    // Current ledgers are an extensible persistence contract.  Reconstructing a
    // canonical task from a whitelist silently discarded queue, regeneration,
    // attachment-parent, review and retry state on every load/save cycle.
    // Preserve every JSON-safe extension field for canonical records and only
    // apply the destructive shape conversion above to genuinely old records.
    // Known fields are still normalized by `normalized`, so aliases and unsafe
    // stale values cannot override the current contract.
    const migrated = canonical ? Object.assign({}, task, normalized) : normalized;
    if (migratedPath.rejected) migrated.migration_path_rejection = migratedPath.rejected;
    if (!hasConcreteReview && migrated.status === 'completed_no_output') {
      migrated.terminal_outcome = 'completed_no_output';
      if (!migrated.result_counts) migrated.result_counts = { generated: 0, written: 0, review: 0 };
      migrated.result_counts.review = 0;
    }
    return migrated;
  });
}

function readinessIssues(settings = {}, contractResult = { valid: true, errors: [] }) {
  const issues = [];
  if (!String(settings.minimaxApiKey || '').trim()) issues.push(issue('minimax-key-missing', 'MiniMax API Key 未配置。'));
  if (!String(settings.pdfMineruApiKey || '').trim()) issues.push(issue('mineru-key-missing', 'MinerU API Token 未配置。'));
  if (settings.pdfAllowExternalUpload !== true) issues.push(issue('external-upload-not-confirmed', '尚未确认允许上传源文件到外部解析 API。'));
  if (!contractResult || contractResult.valid !== true) {
    issues.push(issue('component-contract-invalid', `组件包契约无效：${(contractResult?.errors || []).join('；')}`));
  }
  if (!String(settings.pdfPaddleOcrApiKey || '').trim()) {
    issues.push(issue('paddleocr-key-missing', 'PaddleOCR Token 未配置，PDF/图片补盲不可用。', false));
  }
  return issues;
}

function issue(code, message, blocking = true) {
  return { code, message, blocking };
}

function stableId(value) {
  return `run-${crypto.createHash('sha256').update(String(value)).digest('hex').slice(0, 16)}`;
}

module.exports = {
  migrateTaskLedgerV3,
  readinessIssues
};

},
/**
 * @module src/core/provenance
 * Stable OCR provenance normalization and fail-closed evidence resolution.
 */
"src/core/provenance.js": function(require, module, exports) {
const crypto = require("crypto");

function normalizeOcrArtifact(input, engine) {
  const collected = Array.isArray(input) ? input : collectPages(input);
  const rawPages = groupFlatPageBlocks(collected);
  const pages = [];
  const spans = [];
  const markdownParts = [];
  let offset = 0;
  for (let pageIndex = 0; pageIndex < rawPages.length; pageIndex += 1) {
    const rawPage = rawPages[pageIndex] || {};
    const explicitPage = positiveInteger(rawPage.page ?? rawPage.page_no ?? rawPage.page_number ?? rawPage.page_idx + 1);
    const page = explicitPage || pageIndex + 1;
    const rawBlocks = collectBlocks(rawPage);
    const pageSpans = rawBlocks.length ? rawBlocks : [{ text: rawPage.text ?? rawPage.markdown?.text ?? rawPage.markdown ?? '' }];
    const marker = `<!-- eks-page:${page} -->\n`;
    markdownParts.push(marker);
    offset += marker.length;
    const pageStart = offset;
    for (let blockIndex = 0; blockIndex < pageSpans.length; blockIndex += 1) {
      const raw = pageSpans[blockIndex] || {};
      const text = cleanOcrText(raw.text ?? raw.content ?? raw.block_content ?? raw.transcription ?? raw.rec_text ?? '');
      if (!text) continue;
      const separator = spans.length && offset > pageStart ? '\n\n' : '';
      if (separator) { markdownParts.push(separator); offset += separator.length; }
      const start = offset;
      markdownParts.push(text);
      offset += text.length;
      const bbox = normalizeBbox(raw.bbox ?? raw.box ?? raw.block_bbox ?? raw.coordinate ?? raw.poly ?? raw.polygon);
      const blockId = stableOptionalId(raw.block_id ?? raw.blockId ?? raw.id);
      const lineId = stableOptionalId(raw.line_id ?? raw.lineId ?? raw.line_no ?? raw.line_idx);
      spans.push({
        span_id: `${engine}:p${page}:${blockId || `s${blockIndex + 1}`}${lineId ? `:${lineId}` : ''}`,
        page,
        ...(blockId ? { block_id: blockId } : {}),
        ...(lineId ? { line_id: lineId } : {}),
        ...(bbox ? { bbox } : {}),
        start,
        end: offset,
        text,
        text_hash: hashText(normalizeText(text))
      });
    }
    const pageText = markdownParts.join('').slice(pageStart, offset);
    pages.push({ page, text: pageText, span_ids: spans.filter((span) => span.page === page).map((span) => span.span_id) });
    markdownParts.push('\n\n');
    offset += 2;
  }
  return { markdown: markdownParts.join('').trimEnd(), pages, spans, provenance_version: '1.0' };
}

function groupFlatPageBlocks(items) {
  if (!Array.isArray(items) || !items.length) return [];
  const looksFlat = items.every((item) =>
    item && typeof item === 'object'
    && !collectBlocks(item).length
    && (item.page_idx !== undefined || item.page !== undefined || item.page_no !== undefined));
  if (!looksFlat) return items;
  const grouped = new Map();
  for (const item of items) {
    const page = positiveInteger(item.page ?? item.page_no ?? Number(item.page_idx) + 1);
    const key = page || grouped.size + 1;
    if (!grouped.has(key)) grouped.set(key, { page: key, blocks: [] });
    grouped.get(key).blocks.push(item);
  }
  return [...grouped.values()];
}

function collectPages(value) {
  if (!value || typeof value !== 'object') return [];
  for (const key of ['pages', 'page_results', 'pageResults', 'layoutParsingResults', 'layout_parsing_results', 'results']) {
    if (Array.isArray(value[key])) return value[key];
  }
  if (value.result) return collectPages(value.result);
  return [];
}

function collectBlocks(page) {
  for (const key of ['blocks', 'lines', 'parsing_res_list', 'layout_blocks', 'layoutBlocks', 'ocr_results', 'ocrResults']) {
    if (Array.isArray(page?.[key])) return page[key].flatMap((item) => Array.isArray(item?.lines) ? item.lines.map((line) => Object.assign({}, item, line)) : [item]);
  }
  const pruned = page?.prunedResult || page?.pruned_result || page?.res || page?.result;
  if (pruned && pruned !== page) return collectBlocks(pruned);
  if (Array.isArray(page?.rec_texts)) {
    return page.rec_texts.map((text, index) => ({
      text,
      bbox: page.rec_boxes?.[index] || page.dt_polys?.[index],
      line_id: index + 1,
      block_id: 'ocr'
    }));
  }
  return [];
}

function normalizeLegacyArtifact(markdown, pages, parser) {
  const text = String(markdown || '');
  const supplied = Array.isArray(pages) ? pages : [];
  if (supplied.length && supplied.some((page) => positiveInteger(page?.page) && typeof page?.text === 'string')) {
    return normalizeOcrArtifact(supplied, parser || 'ocr');
  }
  return {
    markdown: text,
    pages: [],
    spans: text ? [{ span_id: `${parser || 'ocr'}:text`, start: 0, end: text.length, text, text_hash: hashText(normalizeText(text)) }] : [],
    provenance_version: '1.0'
  };
}

function resolveEvidence(parsePackage, quote, hint = {}) {
  const normalizedQuote = normalizeText(quote);
  if (!normalizedQuote) return failed('empty_quote');
  const markdown = String(parsePackage?.markdown || '');
  const spans = Array.isArray(parsePackage?.provenance?.spans) ? parsePackage.provenance.spans : [];
  const candidates = [];
  for (const span of spans) {
    const normalizedSpan = normalizeWithMap(span.text ?? markdown.slice(span.start, span.end));
    for (const local of allIndexes(normalizedSpan.text, normalizedQuote)) {
      const rawLocalStart = normalizedSpan.map[local] ?? 0;
      const rawLocalEnd = (normalizedSpan.map[local + normalizedQuote.length - 1] ?? rawLocalStart) + 1;
      candidates.push({
        span,
        start: Number(span.start || 0) + rawLocalStart,
        end: Number(span.start || 0) + rawLocalEnd
      });
    }
  }
  if (!candidates.length) {
    const normalizedDocument = normalizeWithMap(markdown);
    for (const local of allIndexes(normalizedDocument.text, normalizedQuote)) {
      const start = normalizedDocument.map[local] ?? 0;
      const end = (normalizedDocument.map[local + normalizedQuote.length - 1] ?? start) + 1;
      candidates.push({ span: {}, start, end });
    }
  }
  const bounded = candidates.filter((candidate) =>
    (!positiveInteger(hint.page) || candidate.span.page === positiveInteger(hint.page))
    && (!Number.isFinite(hint.start) || candidate.start >= hint.start)
    && (!Number.isFinite(hint.end) || candidate.start < hint.end));
  const pool = bounded.length ? bounded : candidates;
  if (!pool.length) return failed('quote_not_found');
  const occurrence = Math.max(1, positiveInteger(hint.occurrence) || 1);
  if (pool.length > 1 && !Number.isFinite(hint.start) && !positiveInteger(hint.page) && !positiveInteger(hint.occurrence)) {
    return failed('ambiguous_quote', pool.length);
  }
  const match = pool[Math.min(occurrence - 1, pool.length - 1)];
  const page = positiveInteger(match.span.page);
  const locator = {
    version: '1.0',
    kind: page && match.span.bbox ? 'ocr-region' : page ? 'ocr-page-span' : 'ocr-text-span',
    precision: page && match.span.bbox ? 'region' : page ? 'page+text' : 'parsed-text',
    quote_hash: hashText(normalizedQuote),
    occurrence,
    text_start: match.start,
    text_end: match.end,
    ...(page ? { page } : {}),
    ...(match.span.span_id ? { span_id: match.span.span_id } : {}),
    ...(match.span.block_id ? { block_id: match.span.block_id } : {}),
    ...(match.span.line_id ? { line_id: match.span.line_id } : {}),
    ...(match.span.bbox ? { bbox: match.span.bbox } : {})
  };
  return { ok: true, locator, label: locatorLabel(locator), matches: pool.length };
}

function verifyLocator(parsePackage, quote, locator) {
  if (!locator || typeof locator !== 'object') return failed('locator_missing');
  if (locator.quote_hash !== hashText(normalizeText(quote))) return failed('quote_hash_mismatch');
  const result = resolveEvidence(parsePackage, quote, {
    page: locator.page,
    start: Number(locator.text_start),
    end: Number(locator.text_end),
    occurrence: locator.occurrence
  });
  if (!result.ok) return result;
  if (result.locator.text_start !== Number(locator.text_start) || result.locator.text_end !== Number(locator.text_end)) {
    return failed('text_span_mismatch');
  }
  if (locator.page && result.locator.page !== locator.page) return failed('page_mismatch');
  if (locator.bbox && JSON.stringify(result.locator.bbox) !== JSON.stringify(locator.bbox)) return failed('bbox_mismatch');
  return result;
}

// Local, deterministic and fail-closed repair for normalized/paraphrased quotes.
// Only source text from the winning eligible block can become the repaired quote.
function reconcileEvidence(parsePackage, quote, hint = {}) {
  const exact = resolveEvidence(parsePackage, quote, hint);
  if (exact.ok) {
    const markdown = String(parsePackage?.markdown || '');
    const verbatim = markdown.slice(exact.locator.text_start, exact.locator.text_end) || String(quote || '');
    const indexedMatches = Object.values(parsePackage?.evidence_index || {}).filter((entry) =>
      entry.card_eligible !== false && String(entry.raw_text || '').includes(verbatim));
    if (indexedMatches.length === 1) {
      const entry = indexedMatches[0];
      exact.locator = Object.assign({}, exact.locator, {
        block_id: entry.block_id,
        precision: 'block-exact',
        ...(positiveInteger(entry.locator?.page) ? { page: positiveInteger(entry.locator.page) } : {})
      });
      exact.label = locatorLabel(exact.locator);
    }
    const repaired = verbatim !== String(quote || '');
    return Object.assign({ method: repaired ? 'normalized-contiguous' : 'exact', repaired, quote: verbatim }, exact);
  }
  const query = normalizeEvidenceWithMap(quote).text;
  if (query.length < 2) return Object.assign({ attempted: true }, exact);
  const indexed = Object.values(parsePackage?.evidence_index || {});
  const entries = (indexed.length ? indexed : (parsePackage?.blocks || []).map((block) => ({
    block_id: block.block_id, locator: block.locator, raw_text: block.raw?.text || block.text,
    card_eligible: block.card_eligible
  }))).filter((entry) => entry.card_eligible !== false && String(entry.raw_text || '').trim())
    .filter((entry) => !hint.block_id || String(entry.block_id) === String(hint.block_id));
  const matches = [];
  for (const entry of entries) {
    const raw = String(entry.raw_text || '');
    const normalized = normalizeEvidenceWithMap(raw);
    for (const start of allIndexes(normalized.text, query)) {
      const rawStart = normalized.map[start];
      const rawEnd = (normalized.map[start + query.length - 1] ?? rawStart) + 1;
      if (Number.isInteger(rawStart) && rawEnd > rawStart) {
        matches.push({ entry, rawStart, rawEnd, quote: raw.slice(rawStart, rawEnd) });
      }
    }
  }
  if (!matches.length) return { ok: false, attempted: true, reason: 'quote_not_found', candidate_count: entries.length };
  if (matches.length !== 1) return { ok: false, attempted: true, reason: 'ambiguous_quote', matches: matches.length };
  const winner = matches[0];
  const entryLocator = winner.entry.locator && typeof winner.entry.locator === 'object' ? winner.entry.locator : null;
  if (!entryLocator || !entryLocator.scheme || typeof entryLocator.value !== 'string') {
    return { ok: false, attempted: true, reason: 'locator_missing' };
  }
  const locator = Object.assign({}, entryLocator, {
    block_id: winner.entry.block_id,
    precision: 'block-exact',
    block_text_start: winner.rawStart,
    block_text_end: winner.rawEnd,
    quote_hash: hashText(normalizeText(winner.quote))
  });
  return {
    ok: true, quote: winner.quote, locator, label: locatorLabel(locator),
    repaired: true, attempted: true, method: 'normalized-contiguous',
    context: evidenceContext(winner.entry, parsePackage)
  };
}
function evidenceContext(entry, parsePackage) {
  const block = (parsePackage?.blocks || []).find((item) => String(item.block_id) === String(entry.block_id)) || {};
  const metadata = Object.assign({}, block.metadata || {}, entry.metadata || {});
  const locator = Object.assign({}, block.locator || {}, entry.locator || {});
  const context = {
    section: metadata.section || metadata.heading || locator.section || '',
    table: {
      sheet: metadata.sheet || locator.sheet || '',
      range: metadata.range || locator.range || '',
      row: metadata.row ?? locator.row ?? '',
      column: metadata.column ?? locator.column ?? '',
      headers: metadata.headers || metadata.header_path || locator.headers || []
    },
    message: {
      thread_id: metadata.thread_id || locator.thread_id || '',
      message_id: metadata.message_id || locator.message_id || '',
      from: metadata.from || '',
      date: metadata.date || '',
      subject: metadata.subject || ''
    }
  };
  return context;
}
function evidenceSearchText(entry, parsePackage) {
  const context = evidenceContext(entry, parsePackage);
  return [
    context.section,
    context.table.sheet, context.table.range,
    ...(Array.isArray(context.table.headers) ? context.table.headers : [context.table.headers]),
    context.message.subject, context.message.from,
    entry.raw_text
  ].filter(Boolean).join(' ');
}
function comparable(value) { return normalizeText(value).toLowerCase().replace(/[「」『』“”‘’"'`]/g, '').trim(); }
function tokenSet(value) { return new Set(String(value).match(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]|[a-z]+|\d+(?:\.\d+)?(?:%|‰|mm|cm|m2|m²|m3|m³|mpa|kn)?/giu) || []); }
function grams(value) { const out = new Set(); for (let i = 0; i < value.length - 1; i += 1) out.add(value.slice(i, i + 2)); return out; }
function factSet(value) { return new Set((String(value).normalize('NFKC').match(/\d+(?:[.,]\d+)?\s*(?:%|‰|[a-zµμ°℃℉²³/·]+|[\p{Script=Han}]{0,4})?/giu) || []).map((item) => item.replace(/[\s,]/g, '').toLowerCase())); }
function dice(a, b) { if (!a.size && !b.size) return 1; let hit = 0; for (const item of a) if (b.has(item)) hit += 1; return 2 * hit / Math.max(1, a.size + b.size); }
function subset(a, b) { let hit = 0; for (const item of a) if (b.has(item)) hit += 1; return hit / Math.max(1, a.size); }
function round3(value) { return Number.isFinite(value) ? Math.round(value * 1000) / 1000 : 0; }

function locatorLabel(locator) {
  const parts = [];
  if (locator.page) parts.push(`第 ${locator.page} 页`);
  if (locator.block_id) parts.push(`块 ${locator.block_id}`);
  if (locator.line_id) parts.push(`行 ${locator.line_id}`);
  if (!locator.page) parts.push(`解析文本字符 ${locator.text_start}-${locator.text_end}`);
  const precision = ({ region: '区域级', 'page+text': '页内文本级', 'parsed-text': '解析文本级' })[locator.precision] || '未知精度';
  return `${parts.join(' · ')}（${precision}）`;
}

function normalizeWithMap(value) {
  const source = String(value || '');
  let text = '';
  const map = [];
  let pendingSpace = false;
  for (let index = 0; index < source.length; index += 1) {
    const normalized = source[index].normalize('NFKC');
    for (const char of normalized) {
      if (/\s/u.test(char)) { pendingSpace = text.length > 0; continue; }
      if (pendingSpace) { text += ' '; map.push(index); pendingSpace = false; }
      text += char;
      map.push(index);
    }
  }
  return { text: text.trim(), map };
}

function normalizeEvidenceWithMap(value) {
  const source = String(value || '');
  let text = '';
  const map = [];
  for (let index = 0; index < source.length; index += 1) {
    for (const char of source[index].normalize('NFKC')) {
      if (/\s/u.test(char)) continue;
      text += char;
      map.push(index);
    }
  }
  return { text, map };
}

function normalizeText(value) { return String(value || '').normalize('NFKC').replace(/\s+/gu, ' ').trim(); }
function allIndexes(haystack, needle) {
  const out = [];
  for (let at = haystack.indexOf(needle); at >= 0; at = haystack.indexOf(needle, at + 1)) out.push(at);
  return out;
}
function hashText(value) { return crypto.createHash('sha256').update(String(value || '')).digest('hex').slice(0, 16); }
function positiveInteger(value) { const number = Number(value); return Number.isInteger(number) && number > 0 ? number : 0; }
function stableOptionalId(value, fallback = '') { return value === undefined || value === null || value === '' ? fallback : String(value); }
function cleanOcrText(value) { return String(value || '').replace(/\r\n?/g, '\n').trim(); }
function normalizeBbox(value) {
  if (!Array.isArray(value) || !value.length) return null;
  const flat = value.flat(Infinity).map(Number);
  if (flat.length < 4 || flat.some((number) => !Number.isFinite(number))) return null;
  return flat;
}
function failed(reason, matches = 0) { return { ok: false, reason, matches }; }

module.exports = {
  hashText, locatorLabel, normalizeLegacyArtifact, normalizeOcrArtifact, normalizeText,
  reconcileEvidence, resolveEvidence, verifyLocator
};

},
/**
 * @module src/core/document-parser
 * 文档解析计划 / 解析包产出：根据文件类型选 OCR / 直读 / 拆分
 * @exports documentPlan
 * @exports createParsePackage
 */
"src/core/document-parser.js": function(require, module, exports) {
const crypto = require("crypto");
const { normalizeLegacyArtifact } = require("src/core/provenance.js");
const { createBlock } = require("src/core/block-v0.js");

const MAX_MINERU_FILE_BYTES = 200 * 1024 * 1024;

function documentPlan(filePath) {
  const lower = String(filePath || '').toLowerCase();
  if (/\.md$/.test(lower)) return plan('md', 'text');
  if (/\.txt$/.test(lower)) return plan('txt', 'text');
  if (/\.eml$/.test(lower)) return plan('email', 'email');
  if (/\.pdf$/.test(lower)) return plan('pdf', 'remote', ['mineru-api', 'paddleocr-api']);
  if (/\.(png|jpe?g|webp|gif|bmp|tiff?)$/.test(lower)) return plan('image', 'remote', ['mineru-api', 'paddleocr-api']);
  if (/\.docx$/.test(lower)) return plan('docx', 'ooxml', ['mineru-api']);
  if (/\.doc$/.test(lower)) return plan('docx', 'remote', ['mineru-api']);
  if (/\.pptx$/.test(lower)) return plan('pptx', 'ooxml', ['mineru-api']);
  if (/\.ppt$/.test(lower)) return plan('pptx', 'remote', ['mineru-api']);
  if (/\.xlsx$/.test(lower)) return plan('xlsx', 'ooxml', ['mineru-api']);
  if (/\.xls$/.test(lower)) return plan('xlsx', 'remote', ['mineru-api']);
  if (/\.(html|htm)$/.test(lower)) return Object.assign(plan('html', 'remote', ['mineru-api']), { mineruModel: 'MinerU-HTML' });
  if (/\.msg$/.test(lower)) return plan('outlook-msg', 'msg');
  if (/\.(mp4|mov|avi|mkv)$/.test(lower)) return plan('video', 'unsupported');
  if (/\.(mp3|wav|m4a)$/.test(lower)) return plan('audio', 'unsupported');
  return plan('unknown', 'unsupported');
}

function plan(sourceType, mode, engines = []) {
  return { sourceType, mode, engines, mineruModel: 'vlm' };
}

function createParsePackage(options) {
  const isOcr = /^mineru-api|^paddleocr-api|^local-ocr:/.test(String(options.parser || ''));
  const artifact = options.provenance && Array.isArray(options.provenance.spans)
    ? { markdown: String(options.markdown || ''), pages: options.pages || [], spans: options.provenance.spans, provenance_version: options.provenance.version || '1.0' }
    : isOcr ? normalizeLegacyArtifact(options.markdown, options.pages, normalizeParser(options.parser)) : null;
  const markdown = String(artifact?.markdown ?? options.markdown ?? '').trim();
  const quality = markdownQuality(markdown);
  const sourceHash = crypto.createHash('sha256').update(options.buffer || Buffer.alloc(0)).digest('hex');
  let blocks = Array.isArray(options.blocks) ? options.blocks.filter(Boolean) : [];
  // Every parser crosses the same block-v0 boundary before any AI work. Remote
  // markdown-only parsers do not get invented page metadata: page locators are
  // emitted only when the parser supplied page text.
  if (!blocks.length && markdown) {
    const suppliedPages = Array.isArray(artifact?.pages) ? artifact.pages : [];
    const textPages = suppliedPages.filter((page) => positivePage(page?.page) && typeof page?.text === 'string' && page.text.trim());
    if (textPages.length) {
      blocks = textPages.map((page, index) => createBlock({
        source_hash: sourceHash, order: index, kind: 'page-text', raw_text: page.text,
        locator: { scheme: 'page', value: String(page.page), page: positivePage(page.page) },
        parse_method: normalizeParser(options.parser), metadata: { generated_fallback: true }
      }));
    } else {
      blocks = [createBlock({
        source_hash: sourceHash, order: 0, kind: 'parsed-markdown', raw_text: markdown,
        locator: { scheme: 'parsed-text-span', value: `chars:0-${markdown.length}`, text_start: 0, text_end: markdown.length },
        parse_method: normalizeParser(options.parser), metadata: { generated_fallback: true, page_claimed: false }
      })];
    }
  }
  const evidenceIndex = Object.fromEntries(blocks
    .filter((block) => block?.block_id && block?.locator && String(block?.raw?.text || '').trim())
    .map((block) => [block.block_id, {
      block_id: block.block_id,
      locator: block.locator,
      raw_text: String(block.raw.text),
      card_eligible: block.card_eligible !== false
    }]));
  return {
    source_path: String(options.sourcePath || '').replace(/\\/g, '/'),
    source_hash: sourceHash,
    source_type: options.sourceType || 'unknown',
    parser: normalizeParser(options.parser),
    parser_model: options.parserModel || '',
    remote_job_id: options.remoteJobId || '',
    language: options.language || 'unknown',
    markdown,
    pages: Array.isArray(artifact?.pages) && artifact.pages.length
      ? artifact.pages
      : Array.isArray(options.pages) && options.pages.length ? options.pages
        : Array.isArray(options.pageInventory) ? options.pageInventory : [],
    ...(artifact ? { provenance: { version: artifact.provenance_version || '1.0', spans: artifact.spans || [] } } : {}),
    images: Array.isArray(options.images) ? options.images : [],
    quality,
    // v2.9.0: 透传解析元数据（邮件主题/发件人/附件清单等），供卡片链接与总结阶段使用。
    //   只接受纯 JSON 对象（附件二进制不进这里，见 extractTextFromBuffer email 分支）。
    metadata: options.metadata && typeof options.metadata === 'object' && !Array.isArray(options.metadata) ? options.metadata : {},
    blocks,
    block_packs: Array.isArray(options.blockPacks) ? options.blockPacks : [],
    evidence_index: evidenceIndex,
    evidence_index_version: 'block-evidence-v1',
    schema_version: '1.1'
  };
}

const PARSE_CONTRACT_VERSION = 'block-runtime-v1';

function upgradeParsePackage(input, options = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return input;
  const markdown = String(input.markdown ?? input.text ?? '');
  const sourceHash = String(input.source_hash || options.sourceHash || crypto.createHash('sha256').update(markdown).digest('hex'));
  const parser = normalizeParser(input.parser || options.parser);
  const originalBlocks = Array.isArray(input.blocks) ? input.blocks.filter(Boolean) : [];
  const normalizedBlocks = [];
  for (let order = 0; order < originalBlocks.length; order += 1) {
    const original = originalBlocks[order];
    const rawText = String(original?.raw?.text ?? original?.text ?? '');
    const locator = original?.locator && typeof original.locator === 'object'
      && String(original.locator.scheme || '').trim() && typeof original.locator.value === 'string'
      ? original.locator : null;
    if (!rawText.trim() || !locator) continue;
    const block = createBlock({
      source_hash: String(original.source_hash || sourceHash),
      order: Number.isInteger(original.order) ? original.order : order,
      block_id: String(original.block_id || original.id || '') || undefined,
      parent_id: original.parent_id,
      kind: original.kind || 'text',
      locator,
      provenance: Array.isArray(original.provenance) && original.provenance.length ? original.provenance : [locator],
      raw_text: rawText,
      raw_fields: original.raw?.fields || original.raw_fields,
      inferred: original.inferred,
      parse_method: original.parse?.method || parser,
      parse_quality: original.parse?.quality,
      status: original.parse?.status,
      card_eligible: original.card_eligible !== false,
      exclusion_reason: original.exclusion_reason,
      metadata: original.metadata
    });
    normalizedBlocks.push(block);
  }
  if (!normalizedBlocks.length && markdown.trim()) {
    const suppliedPages = Array.isArray(input.pages) ? input.pages.filter((page) =>
      positivePage(page?.page) && typeof page?.text === 'string' && page.text.trim()) : [];
    if (suppliedPages.length) {
      for (const [order, page] of suppliedPages.entries()) {
        normalizedBlocks.push(createBlock({
          source_hash: sourceHash, order, kind: 'page-text', raw_text: page.text,
          locator: { scheme: 'page', value: String(page.page), page: positivePage(page.page) },
          parse_method: parser, metadata: { generated_fallback: true, migrated_legacy: true }
        }));
      }
    } else {
      normalizedBlocks.push(createBlock({
        source_hash: sourceHash, order: 0, kind: 'parsed-markdown', raw_text: markdown,
        locator: { scheme: 'parsed-text-span', value: `chars:0-${markdown.length}`, text_start: 0, text_end: markdown.length },
        parse_method: parser,
        metadata: { generated_fallback: true, migrated_legacy: true, page_claimed: false }
      }));
    }
  }
  const evidenceIndex = {};
  const spans = [];
  let searchFrom = 0;
  for (const block of normalizedBlocks) {
    const rawText = String(block.raw?.text || '');
    evidenceIndex[block.block_id] = {
      block_id: block.block_id, locator: block.locator, raw_text: rawText,
      card_eligible: block.card_eligible !== false,
      ...(block.metadata && Object.keys(block.metadata).length ? { metadata: block.metadata } : {})
    };
    let start = markdown.indexOf(rawText, searchFrom);
    if (start < 0) start = markdown.indexOf(rawText);
    if (start < 0 && block.locator?.scheme === 'parsed-text-span'
      && Number.isInteger(block.locator.text_start) && Number.isInteger(block.locator.text_end)
      && markdown.slice(block.locator.text_start, block.locator.text_end) === rawText) {
      start = block.locator.text_start;
    }
    if (start < 0) continue;
    const end = start + rawText.length;
    const locator = block.locator || {};
    spans.push({
      span_id: `runtime:${block.block_id}`, block_id: block.block_id,
      start, end, text: rawText, text_hash: crypto.createHash('sha256').update(normalizeContractText(rawText)).digest('hex').slice(0, 16),
      ...(positivePage(locator.page) ? { page: positivePage(locator.page) } : {}),
      ...(locator.line_id ? { line_id: locator.line_id } : {}),
      ...(Array.isArray(locator.bbox) ? { bbox: locator.bbox } : {})
    });
    searchFrom = end;
  }
  const blockPacks = [];
  for (const block of normalizedBlocks.filter((item) => item.card_eligible !== false)) {
    const text = String(block.raw?.text || '');
    for (let start = 0; start < text.length; start += 4000) {
      const part = text.slice(start, start + 4000);
      if (!part.trim()) continue;
      blockPacks.push({
        pack_id: `pack-${crypto.createHash('sha256').update(`${block.block_id}\0${start}\0${part}`).digest('hex').slice(0, 20)}`,
        text: part, token_count: Math.max(1, Math.ceil(part.length / 3)),
        block_ids: [block.block_id], locators: [block.locator]
      });
    }
  }
  const contractShape = {
    version: PARSE_CONTRACT_VERSION, markdown_hash: crypto.createHash('sha256').update(markdown).digest('hex'),
    blocks: normalizedBlocks.map((block) => ({
      block_id: block.block_id, locator: block.locator,
      text_hash: crypto.createHash('sha256').update(String(block.raw?.text || '')).digest('hex')
    }))
  };
  const fingerprint = crypto.createHash('sha256').update(JSON.stringify(contractShape)).digest('hex');
  return Object.assign({}, input, {
    markdown, source_hash: input.source_hash || sourceHash, parser,
    blocks: normalizedBlocks, block_packs: blockPacks,
    evidence_index: evidenceIndex, evidence_index_version: 'block-evidence-v1',
    provenance: { version: input.provenance?.version || '1.0', spans },
    parse_contract: { version: PARSE_CONTRACT_VERSION, fingerprint }
  });
}

function normalizeContractText(value) {
  return String(value || '').normalize('NFKC').replace(/\s+/gu, ' ').trim();
}

function positivePage(value) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : 0;
}

function normalizeParser(parser) {
  const value = String(parser || '');
  if (value.startsWith('local-ocr:')) return value;
  if (value.startsWith('mineru-api')) return 'mineru-api';
  if (value.startsWith('paddleocr-api')) return 'paddleocr-api';
  if (value === 'eml-parser') return value;
  if (value === 'eml-block-v0' || value === 'text-block-v0') return value;
  if (value === 'msg-cfb-mapi') return value;
  if (value === 'pdf-local-inventory') return value;
  if (value === 'docx-ooxml-local' || value === 'xlsx-ooxml-local' || value === 'pptx-ooxml-local') return value;
  return 'text-normalizer';
}

function markdownQuality(markdown) {
  const chars = [...String(markdown || '')];
  if (!chars.length) return { readable: false, score: 0, components: { length: 0, readable_ratio: 0, corrupt_ratio: 0, structure: 0 } };
  const corrupt = chars.filter((char) => char === '\uFFFD' || /[\x00-\x08\x0B\x0C\x0E-\x1F]/.test(char)).length;
  const readable = chars.filter((char) => /[\p{L}\p{N}\s，。、“”‘’：；！？（）【】《》,.()[\]{}:;!?/+=_%#&'"|@<>·…—-]/u.test(char)).length;
  const lengthScore = Math.min(1, chars.length / 200);
  const readableRatio = readable / chars.length;
  const corruptRatio = corrupt / chars.length;
  const structure = /(^|\n)#{1,6}\s|\|.+\||(^|\n)[-*]\s/m.test(markdown) ? 1 : 0.6;
  const score = clamp((0.25 * lengthScore) + (0.5 * readableRatio) + (0.25 * structure) - corruptRatio);
  return {
    readable: chars.length >= 20 && corruptRatio <= 0.02 && readableRatio >= 0.72,
    score: Number(score.toFixed(4)),
    components: {
      length: Number(lengthScore.toFixed(4)),
      readable_ratio: Number(readableRatio.toFixed(4)),
      corrupt_ratio: Number(corruptRatio.toFixed(4)),
      structure
    }
  };
}

function clamp(value) {
  return Math.max(0, Math.min(1, value));
}

module.exports = {
  MAX_MINERU_FILE_BYTES,
  createParsePackage,
  upgradeParsePackage,
  PARSE_CONTRACT_VERSION,
  markdownQuality,
  documentPlan
};

},
/**
 * @module src/core/identity
 * 卡片身份指纹：源文件 hash + 内容 fingerprint → 稳定卡片 ID
 * @exports atomFingerprint
 * @exports sourceIdentity
 * @exports runIdentity
 */
"src/core/identity.js": function(require, module, exports) {
const crypto = require("crypto");

function sourceIdentity({ library, sourceHash }) {
  return `source-${hash(`${library}:${sourceHash}`).slice(0, 20)}`;
}

function runIdentity({ sourceIdentity: sourceId, pipelineVersion, promptBundleVersion, schemaVersion }) {
  return `run-${hash(`${sourceId}:${pipelineVersion}:${promptBundleVersion}:${schemaVersion}`).slice(0, 20)}`;
}

function atomFingerprint(atom) {
  const identityFields = {
    card_kind: atom?.card_kind || '',
    title: atom?.title || '',
    content: atom?.content || {},
    source_locator: atom?.source?.source_locator || ''
  };
  return hash(stableStringify(normalizeValue(identityFields)));
}

// v1.8 (M-08): cardIdentity 改用完整 sourceHash + 完整 fingerprint，
//              避免 slice(0,12) 截断导致的 48-bit 生日碰撞（~16M 文档级别）。
//              加库名前缀（bid/business）防止跨库碰撞。
function cardIdentity(library, sourceHash, fingerprint) {
  const lib = String(library || 'unknown').slice(0, 8);
  const src = String(sourceHash || '').slice(0, 16);
  const fp = String(fingerprint || '').slice(0, 16);
  return `card-${lib}-${src}-${fp}`;
}

function normalizeValue(value) {
  if (typeof value === 'string') return value.trim().replace(/\s+/g, ' ').toLowerCase();
  if (Array.isArray(value)) return value.map(normalizeValue);
  if (value && typeof value === 'object') {
    const result = {};
    for (const key of Object.keys(value).sort()) result[key] = normalizeValue(value[key]);
    return result;
  }
  return value;
}

function stableStringify(value) {
  return JSON.stringify(value);
}

function hash(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

module.exports = {
  atomFingerprint,
  cardIdentity,
  runIdentity,
  sourceIdentity
};

},
/**
 * @module src/core/time-policy
 * Central timestamp semantics: precise internal instants, stable local business
 * dates, and localized operational display. Legacy ISO strings are accepted.
 */
"src/core/time-policy.js": function(require, module, exports) {
const CALENDAR_DATE = /^\d{4}-\d{2}-\d{2}$/;

function resolveRuntimeTimeZone(configuredTimeZone = '') {
  const candidate = String(configuredTimeZone || '').trim();
  if (candidate) {
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: candidate }).format(new Date(0));
      return candidate;
    } catch (_) { /* invalid configuration falls back to runtime local time */ }
  }
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch (_) { return 'UTC'; }
}

function preciseIsoInstant(value) {
  const date = value === undefined || value === null || value === '' ? new Date() : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toISOString();
}

function formatBusinessDate(value, options = {}) {
  if (value === undefined || value === null || value === '') return '';
  const text = String(value).trim();
  if (CALENDAR_DATE.test(text)) return text;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: resolveRuntimeTimeZone(options.timeZone),
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  });
  const parts = Object.fromEntries(formatter.formatToParts(date).map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function formatOperationalLocalDateTime(value, options = {}) {
  if (value === undefined || value === null || value === '') return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat(options.locale || 'zh-CN', {
    timeZone: resolveRuntimeTimeZone(options.timeZone),
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  }).format(date);
}

module.exports = {
  formatBusinessDate,
  formatOperationalLocalDateTime,
  preciseIsoInstant,
  resolveRuntimeTimeZone
};

},
/**
 * @module src/core/pipeline
 * 单文件任务流水线的骨架：创建任务记录、驱动 AI 流水线、产出卡片
 * @exports createTaskRecord
 */
"src/core/pipeline.js": function(require, module, exports) {
const { runIdentity, sourceIdentity } = require("src/core/identity.js");
const { preciseIsoInstant } = require("src/core/time-policy.js");

// v1.5 (M-02): 删除 TRANSITIONS / transitionTask / acquireLease / releaseLease /
//              retryFailedTask / runPipelineTask / artifact / requiredHandler /
//              copyTask 死代码；只保留 createTaskRecord（主流程还在用）。
//              这些都是 v1.1 重构期的中间产物，从来没被 main.js 外部调用。

function createTaskRecord(options) {
  const versions = options.versions || {};
  const sourceId = sourceIdentity({ library: options.library, sourceHash: options.sourceHash });
  const runId = runIdentity({
    sourceIdentity: sourceId,
    pipelineVersion: versions.pipelineVersion || '1.1.0',
    promptBundleVersion: versions.promptBundleVersion || '1.1',
    schemaVersion: versions.schemaVersion || '1.1'
  });
  const now = preciseIsoInstant(options.now);
  return {
    task_id: sourceId,
    run_id: runId,
    source_path: String(options.sourcePath || '').replace(/\\/g, '/'),
    source_aliases: [],
    source_hash: options.sourceHash,
    source_type: options.sourceType,
    library: options.library,
    pipeline_version: versions.pipelineVersion || '1.1.0',
    prompt_bundle_version: versions.promptBundleVersion || '1.1',
    schema_version: versions.schemaVersion || '1.1',
    status: 'queued',
    remote_jobs: [],
    retry_counts: {},
    artifacts: {},
    written_card_ids: [],
    review_atom_ids: [],
    errors: [],
    progress: {},
    lease: null,
    created_at: now,
    updated_at: now
  };
}

module.exports = {
  createTaskRecord
};

},
/**
 * @module src/core/schema-validator
 * AI 输出结构校验：classification.schema.json / card.schema.json 实例校验
 * @exports validateSchema
 */
"src/core/schema-validator.js": function(require, module, exports) {
function validateSchema(schema, value) {
  const errors = [];
  visit(schema, value, '$', errors);
  return { valid: errors.length === 0, errors };
}

function visit(schema, value, path, errors) {
  if (!schema || typeof schema !== 'object') return;

  if (Object.hasOwn(schema, 'const') && value !== schema.const) {
    errors.push(`${path} must equal ${JSON.stringify(schema.const)}`);
    return;
  }
  if (Array.isArray(schema.enum) && !schema.enum.includes(value)) {
    errors.push(`${path} must be one of ${schema.enum.map((item) => JSON.stringify(item)).join(', ')}`);
    return;
  }

  const acceptedTypes = Array.isArray(schema.type) ? schema.type : (schema.type ? [schema.type] : []);
  if (acceptedTypes.length && !acceptedTypes.some((type) => matchesType(type, value))) {
    errors.push(`${path} must be ${acceptedTypes.join(' or ')}`);
    return;
  }

  if (typeof value === 'string') {
    if (schema.minLength !== undefined && value.length < schema.minLength) errors.push(`${path} is shorter than ${schema.minLength}`);
    if (schema.maxLength !== undefined && value.length > schema.maxLength) errors.push(`${path} is longer than ${schema.maxLength}`);
    if (schema.pattern && !(new RegExp(schema.pattern).test(value))) errors.push(`${path} does not match ${schema.pattern}`);
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    if (schema.minimum !== undefined && value < schema.minimum) errors.push(`${path} is below ${schema.minimum}`);
    if (schema.maximum !== undefined && value > schema.maximum) errors.push(`${path} is above ${schema.maximum}`);
  }

  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) errors.push(`${path} has fewer than ${schema.minItems} items`);
    if (schema.maxItems !== undefined && value.length > schema.maxItems) errors.push(`${path} has more than ${schema.maxItems} items`);
    if (schema.uniqueItems && new Set(value.map(stableValue)).size !== value.length) errors.push(`${path} contains duplicate items`);
    if (schema.items) value.forEach((item, index) => visit(schema.items, item, `${path}[${index}]`, errors));
  }

  if (isObject(value)) {
    for (const key of schema.required || []) {
      if (!Object.hasOwn(value, key)) errors.push(`${path}.${key} is required`);
    }
    const properties = schema.properties || {};
    for (const [key, item] of Object.entries(value)) {
      if (properties[key]) visit(properties[key], item, `${path}.${key}`, errors);
      else if (schema.additionalProperties === false) errors.push(`${path}.${key} is not allowed`);
      else if (isObject(schema.additionalProperties)) visit(schema.additionalProperties, item, `${path}.${key}`, errors);
    }
  }
}

function matchesType(type, value) {
  if (type === 'null') return value === null;
  if (type === 'array') return Array.isArray(value);
  if (type === 'object') return isObject(value);
  if (type === 'integer') return Number.isInteger(value);
  if (type === 'number') return typeof value === 'number' && Number.isFinite(value);
  return typeof value === type;
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function stableValue(value) {
  if (!isObject(value) && !Array.isArray(value)) return `${typeof value}:${String(value)}`;
  if (Array.isArray(value)) return `[${value.map(stableValue).join(',')}]`;
  return `{${Object.keys(value).sort().map((key) => `${key}:${stableValue(value[key])}`).join(',')}}`;
}

module.exports = { validateSchema };


},
/**
 * @module src/core/ai-pipeline
 * MiniMax M3 API 调用层：summarizeDocument / atomizeSummary / classifyDocument
 * 含重试 / 修复 / schema 校验 / 截断兜底
 * @exports requestMiniMaxJson
 * @exports summarizeDocument
 * @exports atomizeSummary
 * @exports classifyDocument
 */
"src/core/ai-pipeline.js": function(require, module, exports) {
const { validateSchema } = require("src/core/schema-validator.js");
const { reconcileEvidence, resolveEvidence, verifyLocator } = require("src/core/provenance.js");

// v1.1.9: ai-pipeline.js 是独立 bundle 模块闭包，main.js 里的本地 function diag 对它不可见。
// 通过 globalThis.__eksDiag 委托到唯一的诊断入口，确保 minimax.timeout/transport/http 等
// 失败打点能正常工作而不报 "diag is not defined"。若共享诊断还没初始化，则静默 no-op（不抛错）。
function diag(scope, payload) {
  try { return globalThis.__eksDiag && globalThis.__eksDiag.diag ? globalThis.__eksDiag.diag(scope, payload) : undefined; }
  catch (_) { /* 诊断日志自身不能炸 */ }
}
function keyFingerprint(value) {
  try { return globalThis.__eksDiag && globalThis.__eksDiag.keyFingerprint ? globalThis.__eksDiag.keyFingerprint(value) : 'fp:<unavailable>'; }
  catch (_) { return 'fp:<unavailable>'; }
}

function buildClassificationPrompt({ classifierPrompt, folderMap, parsePackage }) {
  const whitelist = (folderMap.routes || []).map((route) => ({
    library: route.library,
    folder_type: route.folder_type
  }));
  const fullEvidence = (parsePackage.sections || []).length
    ? parsePackage.sections.map((section) => `## ${section.heading || section.section_id}\n${section.markdown || ''}`).join('\n\n')
    : String(parsePackage.markdown || '');
  const evidence = classificationSample(parsePackage, 24000, fullEvidence);
  return [
    classifierPrompt,
    '以下目录是唯一合法白名单。library 与 folder_type 必须精确匹配其中一项，不得新建、翻译或改写目录名：',
    JSON.stringify(whitelist, null, 2),
    '文件元数据：',
    JSON.stringify({
      source_name: parsePackage.source_name,
      source_path: parsePackage.source_path,
      source_type: parsePackage.source_type,
      parser: parsePackage.parser,
      parse_quality: parsePackage.quality
    }, null, 2),
    '解析后的文档内容：',
    evidence,
    '只返回符合 classification.schema.json 的 JSON。'
  ].filter(Boolean).join('\n\n');
}

// v2.9.1: 代理对安全截断。JS 字符串是 UTF-16，BMP 外字符（emoji、CJK 扩展 B
//   汉字如 𠀀、部分数学符号）占两个码元，slice 正好切在高低代理之间会产出
//   孤立代理（lone surrogate）——写 frontmatter / JSON.stringify / 送 AI 时
//   变成乱码方块或损坏的 JSON。切点落在代理对中间时，把切点前移到高位代理之前。
function adjustSurrogateCut(text, index) {
  const hi = text.charCodeAt(index - 1);
  const lo = text.charCodeAt(index);
  if (hi >= 0xd800 && hi <= 0xdbff && lo >= 0xdc00 && lo <= 0xdfff) return index - 1;
  return index;
}

// v2.9.1: 定长截取统一入口——起止两端都做代理对校正。按换行符边界切的场景
//   天然安全（0x0A 不会出现在代理对中间），只有「按固定字符数截断」需要它。
function safeSlice(text, start, end) {
  const from = adjustSurrogateCut(text, start);
  const to = adjustSurrogateCut(text, end);
  return text.slice(from, to);
}

function classificationSample(input, maxChars = 24000, fallbackMarkdown = '') {
  const parsePackage = input && typeof input === 'object' ? input : null;
  const text = String(parsePackage ? (fallbackMarkdown || parsePackage.markdown || '') : input || '');
  const blocks = Array.isArray(parsePackage?.blocks) ? parsePackage.blocks.filter((block) =>
    block?.card_eligible !== false && String(block?.raw?.text || '').trim()) : [];
  if (blocks.length) {
    const group = (block) => {
      const kind = String(block.kind || '').toLowerCase();
      if (/heading|title/.test(kind)) return 0;
      if (/table_header/.test(kind)) return 1;
      if (/table|cell/.test(kind)) return 2;
      if (/list|bullet/.test(kind)) return 3;
      return 4;
    };
    const buckets = [[], [], [], [], []];
    for (const block of [...blocks].sort((a, b) =>
      Number(a.order || 0) - Number(b.order || 0) || String(a.block_id).localeCompare(String(b.block_id)))) {
      buckets[group(block)].push(block);
    }
    const ordered = [];
    for (let index = 0; ordered.length < blocks.length; index += 1) {
      let added = false;
      for (const bucket of buckets) {
        if (bucket[index]) { ordered.push(bucket[index]); added = true; }
      }
      if (!added) break;
    }
    const perBlock = Math.max(160, Math.min(1200, Math.floor(maxChars / Math.min(ordered.length, 20))));
    const selected = [];
    let used = 0;
    for (const block of ordered) {
      const locator = `${block.locator?.scheme || 'block'}:${block.locator?.value || block.block_id}`;
      const piece = `[${block.kind || 'body'} | ${locator}]\n${safeSlice(String(block.raw.text), 0, perBlock)}\n`;
      if (used + piece.length > maxChars) continue;
      selected.push(piece); used += piece.length;
      if (used >= maxChars - perBlock) break;
    }
    if (selected.length) return selected.join('\n');
  }
  if (text.length <= maxChars) return text;
  const headingLines = safeSlice((text.match(/^#{1,6}\s+.+$/gm) || []).join('\n'), 0, 4000);
  const remaining = Math.max(6000, maxChars - headingLines.length - 120);
  const frontSize = Math.floor(remaining * 0.5);
  const middleSize = Math.floor(remaining * 0.2);
  const endSize = remaining - frontSize - middleSize;
  const middleStart = Math.max(frontSize, Math.floor(text.length / 2 - middleSize / 2));
  const lastHeading = Math.max(text.lastIndexOf('\n# '), text.lastIndexOf('\n## '), text.lastIndexOf('\n### '));
  const sectionTailSize = Math.floor(endSize * 0.6);
  const absoluteTailSize = endSize - sectionTailSize;
  // v2.9.1: 全部定长截取改走 safeSlice，避免 emoji / CJK 扩展 B 汉字被切出孤立代理
  const sectionTail = lastHeading >= 0
    ? safeSlice(text, lastHeading + 1, lastHeading + 1 + sectionTailSize)
    : safeSlice(text, Math.max(0, text.length - sectionTailSize), text.length);
  return [
    safeSlice(text, 0, frontSize),
    '\n\n[文档标题目录汇总]\n', headingLines,
    '\n\n[文档中段代表内容]\n', safeSlice(text, middleStart, middleStart + middleSize),
    '\n\n[最后章节开头]\n', sectionTail,
    '\n\n[文档实际尾部]\n', safeSlice(text, Math.max(0, text.length - absoluteTailSize), text.length)
  ].join('');
}

async function classifyDocument(options) {
  const basePrompt = buildClassificationPrompt(options);
  const result = await requestWithContract({
    prompt: basePrompt,
    stage: 'classification',
    schema: options.classificationSchema,
    requestJson: options.requestJson,
    maxRepairAttempts: options.maxRepairAttempts,
    onProgress: options.onProgress,
    extraValidation(value) {
      return findRoute(options.folderMap, value) ? [] : ['分类结果不在固定目录白名单'];
    }
  });
  return Object.assign({}, result, findRoute(options.folderMap, result));
}

function findRoute(folderMap, classification) {
  return (folderMap.routes || []).find((route) => route.library === classification.library && route.folder_type === classification.folder_type) || null;
}

// ==================== v2.7 切片引擎（借鉴 Tencent/WeKnora 的知识点切片思路） ====================
// 参考实现：
//   - docreader/splitter/splitter.py        → 受保护模式 + 重叠合并（protected_regex / chunk_overlap）
//   - internal/infrastructure/chunker/profiler.go        → 文档画像驱动策略选择（ProfileDocument / SelectStrategy）
//   - internal/infrastructure/chunker/heading_splitter.go → 标题边界切分 + 层级面包屑（ContextHeader）+ 小节合并（coalesceTinyChunks）
//   - internal/infrastructure/chunker/heuristic_splitter.go → 候选边界 + 贪心装箱（dropBoundsInsideSpans / bin-packing）
// 与 WeKnora 相同的原则：
//   1) 切块前先给文档做"画像"，按结构信号选择切分策略（heading / heuristic / legacy）
//   2) 代码块 / 表格 / LaTeX 公式等"受保护区域"永不被拦腰切断
//   3) 每个切片携带标题层级面包屑（ContextHeader），让下游 AI 拿到章节语境
//   4) 相邻、同语境、过小的切片合并（coalesce），减少 AI 调用次数
//   5) 切片之间保留可配置的重叠（overlap），避免段落语境在切点处断裂
//   6) 切分结果做顺序 / 覆盖 / 超尺寸校验（只告警不阻断）

// 受保护区域的正则：围栏代码块（含未闭合）、LaTeX 块级公式。
// 表格按行组识别（见 findProtectedSpans），不走正则。
const PROTECTED_SPAN_PATTERNS = [
  /```[^\n]*\n[\s\S]*?(?:```|$)/g,
  /\$\$[\s\S]*?\$\$/g
];

// 文档画像：一次性扫描文档，收集决定切分策略的结构信号。
// 对应 WeKnora profiler.go 的 ProfileDocument + SelectStrategy。
function profileMarkdown(text) {
  const source = String(text || '');
  const profile = {
    totalChars: source.length,
    totalLines: 0,
    avgLineLen: 0,
    headingCounts: {},
    headingTotal: 0,
    dominantHeadingLevel: 0,
    numberedSectionCount: 0,
    hasTables: false,
    hasCode: false,
    hasMath: false,
    codeChars: 0,
    codeRatio: 0,
    blankParagraphBreaks: 0,
    strategy: 'legacy'
  };
  if (!source) return profile;
  const lines = source.split('\n');
  profile.totalLines = lines.length;
  let lengthSum = 0;
  let lengthCount = 0;
  let inFence = false;
  for (const raw of lines) {
    const trimmed = raw.trim();
    if (trimmed.startsWith('```')) { inFence = !inFence; profile.hasCode = true; continue; }
    if (inFence) { profile.codeChars += raw.length; continue; }
    lengthSum += raw.length;
    lengthCount += 1;
    const heading = raw.match(/^(#{1,6})\s+\S/);
    if (heading) {
      const level = heading[1].length;
      profile.headingCounts[level] = (profile.headingCounts[level] || 0) + 1;
      profile.headingTotal += 1;
      continue;
    }
    if (/^\s*\d+(?:\.\d+)*[.、]\s*\S/.test(raw)) profile.numberedSectionCount += 1;
    if (trimmed.startsWith('|') && trimmed.endsWith('|') && trimmed.length >= 2) profile.hasTables = true;
    if (trimmed.includes('$$')) profile.hasMath = true;
  }
  if (lengthCount > 0) profile.avgLineLen = lengthSum / lengthCount;
  if (profile.totalChars > 0) profile.codeRatio = profile.codeChars / profile.totalChars;
  profile.blankParagraphBreaks = (source.match(/\n\n\n/g) || []).length;
  // 主标题层级：优先取出现 >= 3 次的最低层级（真正的文档骨架），
  // 否则取最深出现层级（小文档只有 H1 + 几个 H2 时的退化策略）。同 WeKnora DominantHeadingLevel。
  for (let level = 1; level <= 6; level += 1) {
    if ((profile.headingCounts[level] || 0) >= 3) { profile.dominantHeadingLevel = level; break; }
  }
  if (!profile.dominantHeadingLevel) {
    for (let level = 6; level >= 1; level -= 1) {
      if ((profile.headingCounts[level] || 0) > 0) { profile.dominantHeadingLevel = level; break; }
    }
  }
  // 策略选择（同 WeKnora SelectStrategy 的 tier 思路）：
  //   heading   —— 有 Markdown 标题骨架 → 优先按标题边界切分
  //   heuristic —— 无标题但有段落结构 → 按安全换行装箱（受保护区域不切断）
  //   legacy    —— 纯长文 → 同样走安全换行装箱（兜底）
  if (profile.headingTotal >= 3 && profile.dominantHeadingLevel > 0) {
    profile.strategy = 'heading';
  } else if (profile.numberedSectionCount >= 5 || profile.blankParagraphBreaks > 0 || source.includes('\n\n')) {
    profile.strategy = 'heuristic';
  } else {
    profile.strategy = 'legacy';
  }
  return profile;
}

// 计算受保护区域的 [start, end) 区间列表（升序、重叠区间合并）。
// 落在这些区间内的换行不会成为切点，代码块 / 表格 / 公式因此不会被拦腰切断。
function findProtectedSpans(text) {
  const spans = [];
  for (const pattern of PROTECTED_SPAN_PATTERNS) {
    pattern.lastIndex = 0;
    let match;
    while ((match = pattern.exec(text)) !== null) {
      if (match[0].length > 0) spans.push([match.index, match.index + match[0].length]);
      if (match.index === pattern.lastIndex) pattern.lastIndex += 1;
    }
  }
  // Markdown 表格：连续 >= 2 行以 | 开头结尾的行视为一个表格整体。
  // span 不含行尾换行，表格结束后紧跟的换行仍是合法切点。
  const lines = text.split('\n');
  let pos = 0;
  let tableStart = -1;
  let tableLineCount = 0;
  let tableLastEnd = 0;
  const flushTable = () => {
    if (tableStart >= 0 && tableLineCount >= 2) spans.push([tableStart, tableLastEnd]);
    tableStart = -1;
    tableLineCount = 0;
  };
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const trimmed = line.trim();
    const isTableLine = trimmed.startsWith('|') && trimmed.endsWith('|') && trimmed.length >= 2;
    if (isTableLine) {
      if (tableStart < 0) tableStart = pos;
      tableLineCount += 1;
      tableLastEnd = pos + line.length;
    } else {
      flushTable();
    }
    pos += line.length + (i < lines.length - 1 ? 1 : 0);
  }
  flushTable();
  spans.sort((a, b) => a[0] - b[0] || b[1] - a[1]);
  const merged = [];
  for (const span of spans) {
    const last = merged[merged.length - 1];
    if (last && span[0] <= last[1]) last[1] = Math.max(last[1], span[1]);
    else merged.push([span[0], span[1]]);
  }
  return merged;
}

// 按主标题层级把文档切成带起止偏移与面包屑的 section 列表。
// 返回 null 表示没有可用的标题骨架（调用方退回整段切分）。
// 对应 WeKnora heading_splitter.go 的 findHeadingBoundaries + 层级面包屑快照。
function splitByHeadings(text, primaryLevel) {
  const lines = text.split('\n');
  const bounds = [0];
  const headingEvents = [];
  let pos = 0;
  let inFence = false;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const trimmed = line.trim();
    if (trimmed.startsWith('```')) {
      inFence = !inFence;
    } else if (!inFence) {
      const match = line.match(/^(#{1,6})\s+\S/);
      if (match) {
        const level = match[1].length;
        headingEvents.push({ pos, level, line: line.trim() });
        if (level <= primaryLevel && pos > 0) bounds.push(pos);
      }
    }
    pos += line.length + (i < lines.length - 1 ? 1 : 0);
  }
  if (bounds.length <= 1) return null;

  const sections = [];
  const stack = [];
  let eventIndex = 0;
  const renderBreadcrumb = () => stack.map((entry) => entry.text).join('\n');
  for (let b = 0; b < bounds.length; b += 1) {
    const start = bounds[b];
    const end = b + 1 < bounds.length ? bounds[b + 1] : text.length;
    let breadcrumb = '';
    while (eventIndex < headingEvents.length && headingEvents[eventIndex].pos < end) {
      const event = headingEvents[eventIndex];
      while (stack.length && stack[stack.length - 1].level >= event.level) stack.pop();
      stack.push({ level: event.level, text: event.line });
      if (event.pos === start) breadcrumb = renderBreadcrumb();
      eventIndex += 1;
    }
    // section 内部没有领头标题时，继承上一节的层级语境（同 WeKnora hierarchy 持续观测）
    if (!breadcrumb && stack.length) breadcrumb = renderBreadcrumb();
    sections.push({ text: text.slice(start, end), start, end, breadcrumb });
  }
  return sections;
}

// 找出所有"安全切点"：每个换行之后都是一个候选切点，但落在受保护区域内的换行被剔除。
// 对应 WeKnora heuristic_splitter.go 的 dropBoundsInsideSpans。
function buildSafeBreaks(text, spans) {
  const breaks = [0];
  let si = 0;
  for (let i = 0; i < text.length; i += 1) {
    if (text.charCodeAt(i) !== 10) continue;
    while (si < spans.length && spans[si][1] <= i) si += 1;
    const inside = si < spans.length && i >= spans[si][0];
    if (!inside) breaks.push(i + 1);
  }
  breaks.push(text.length);
  return breaks;
}

// 在安全切点上做贪心装箱：累积块直到超过 maxChars 再 flush，
// flush 后按 overlapRatio 把起点回退到最近的安全切点形成重叠。
// 对应 WeKnora heuristic_splitter.go 的 bin-packing + splitter.py 的 chunk_overlap。
function packWithOverlap(text, breaks, maxChars, overlapRatio) {
  const out = [];
  const minChunkSize = Math.max(50, Math.floor(maxChars / 4));
  const overlapChars = Math.floor(maxChars * overlapRatio);
  let chunkStart = breaks[0];
  let curEnd = breaks[0];
  for (let i = 1; i < breaks.length; i += 1) {
    const nextEnd = breaks[i];
    const blockLen = nextEnd - curEnd;
    if (blockLen > maxChars) {
      // 单个块本身超尺寸（巨型表格 / 代码块 / 超长单行）：flush 当前累积后硬切该块
      if (curEnd > chunkStart) {
        out.push({ text: text.slice(chunkStart, curEnd), start: chunkStart, end: curEnd });
        chunkStart = curEnd;
      }
      // v2.9.1: 硬切点做代理对校正——超长块（巨型表格/代码块）按 maxChars 截断时
      //   可能切在 emoji / CJK 扩展 B 汉字中间产出孤立代理；pieceEnd 由校正后的
      //   位置推进，校正最多前移 1 字符，pieceEnd <= offset 时兜底前进 1 防死循环。
      for (let offset = curEnd; offset < nextEnd;) {
        let pieceEnd = Math.min(offset + maxChars, nextEnd);
        if (pieceEnd < nextEnd) pieceEnd = adjustSurrogateCut(text, pieceEnd);
        if (pieceEnd <= offset) pieceEnd = Math.min(offset + 1, nextEnd);
        out.push({ text: text.slice(offset, pieceEnd), start: offset, end: pieceEnd });
        offset = pieceEnd;
      }
      curEnd = nextEnd;
      chunkStart = nextEnd;
      continue;
    }
    const accumulated = nextEnd - chunkStart;
    if (accumulated > maxChars && curEnd - chunkStart >= minChunkSize) {
      out.push({ text: text.slice(chunkStart, curEnd), start: chunkStart, end: curEnd });
      // 重叠回退：取 [curEnd - overlapChars, curEnd] 内、大于旧 chunkStart 的最大安全切点
      let overlapStart = -1;
      if (overlapChars > 0) {
        const floor = curEnd - overlapChars;
        for (const candidate of breaks) {
          if (candidate <= chunkStart) continue;
          if (candidate < floor) continue;
          // 严格小于 curEnd：候选 == curEnd 意味着零重叠，等价于关闭重叠
          if (candidate >= curEnd) break;
          overlapStart = candidate;
        }
      }
      chunkStart = overlapStart >= 0 ? overlapStart : curEnd;
    }
    curEnd = nextEnd;
  }
  if (curEnd > chunkStart) out.push({ text: text.slice(chunkStart, curEnd), start: chunkStart, end: curEnd });
  return out.length ? out : [{ text, start: 0, end: text.length }];
}

// 把一个（可能超尺寸的）文本段切成 <= maxChars 的带偏移片段，受保护区域不切断。
function splitRespectingProtected(text, maxChars, overlapRatio) {
  if (!text) return [];
  if (text.length <= maxChars) return [{ text, start: 0, end: text.length }];
  const spans = findProtectedSpans(text);
  const breaks = buildSafeBreaks(text, spans);
  return packWithOverlap(text, breaks, maxChars, overlapRatio);
}

// 两个面包屑的行对齐公共前缀。同 WeKnora heading_splitter.go 的 commonHeadingPrefix。
function commonBreadcrumbPrefix(a, b) {
  if (a === b) return a;
  const la = String(a || '').split('\n');
  const lb = String(b || '').split('\n');
  const n = Math.min(la.length, lb.length);
  let common = 0;
  for (let i = 0; i < n; i += 1) {
    if (la[i].trim() !== lb[i].trim()) break;
    common = i + 1;
  }
  return common ? la.slice(0, common).join('\n') : '';
}

// 合并相邻、同语境、过小的切片，减少 AI 调用次数。
// 只合并 cur.end === next.start（相邻且无重叠）的切片，避免重叠内容被拼接重复。
// 对应 WeKnora heading_splitter.go 的 coalesceTinyChunks（target ≈ chunkSize/2）。
function coalesceTinyChunks(chunks, maxChars) {
  if (chunks.length <= 1) return chunks;
  const target = Math.max(200, Math.floor(maxChars / 2));
  const out = [];
  let cur = chunks[0];
  for (let i = 1; i < chunks.length; i += 1) {
    const next = chunks[i];
    const adjacent = cur.end === next.start;
    const shared = commonBreadcrumbPrefix(cur.breadcrumb || '', next.breadcrumb || '');
    const sameContext = (cur.breadcrumb || '') === (next.breadcrumb || '') || shared !== '';
    const canMerge = adjacent
      && sameContext
      && cur.markdown.length < target
      && cur.markdown.length + next.markdown.length <= maxChars;
    if (canMerge) {
      cur = {
        markdown: cur.markdown + next.markdown,
        start: cur.start,
        end: next.end,
        breadcrumb: shared || cur.breadcrumb || ''
      };
      continue;
    }
    out.push(cur);
    cur = next;
  }
  out.push(cur);
  return out;
}

// 切片校验：顺序升序、原文被完整覆盖（允许重叠）、超尺寸告警。
// 只打 diag 日志不阻断流程。对应 WeKnora splitter.py 的 _validate_chunks 与 validator.go。
function validateChunks(chunks, source, maxChars) {
  try {
    if (!chunks.length) {
      diag('splitter.validate', { ok: false, reason: 'no-chunks', chars: source.length });
      return false;
    }
    for (let i = 1; i < chunks.length; i += 1) {
      if (chunks[i].start < chunks[i - 1].start) {
        diag('splitter.validate', { ok: false, reason: 'order', index: i });
        return false;
      }
    }
    let covered = 0;
    for (const chunk of chunks) {
      if (chunk.start > covered) {
        diag('splitter.validate', { ok: false, reason: 'gap', at: covered, next: chunk.start });
        return false;
      }
      covered = Math.max(covered, chunk.end);
    }
    if (covered < source.length) {
      diag('splitter.validate', { ok: false, reason: 'tail-gap', covered, total: source.length });
      return false;
    }
    for (const chunk of chunks) {
      const len = chunk.end - chunk.start;
      if (len > maxChars * 1.5) diag('splitter.validate', { warn: 'oversize', len, max: maxChars });
    }
    return true;
  } catch (error) {
    diag('splitter.validate', { ok: false, reason: 'exception', message: String((error && error.message) || error) });
    return false;
  }
}

// v2.7 重写：WeKnora 式切片主入口。
// options:
//   maxChars      —— 单切片字符上限（默认 12000）
//   overlapRatio  —— 相邻切片重叠比例（0–0.5，默认 0）
//   coalesceTiny  —— 是否合并过小相邻切片（默认 true）
//   profile       —— 预先算好的文档画像（可选，避免重复扫描）
// 返回形状向后兼容：{ chunk_id, markdown, headings } 并新增 breadcrumb（标题层级语境）。
function splitMarkdownSections(markdown, options = {}) {
  const source = String(markdown || '');
  const maxChars = Math.max(100, Number(options.maxChars) || 12000);
  const rawOverlap = Number(options.overlapRatio);
  const overlapRatio = Number.isFinite(rawOverlap) ? Math.min(0.5, Math.max(0, rawOverlap)) : 0;
  const coalesceTiny = options.coalesceTiny !== false;
  if (!source.trim()) return [{ chunk_id: 'chunk-001', markdown: source, headings: [], breadcrumb: '' }];

  const profile = options.profile && typeof options.profile === 'object' ? options.profile : profileMarkdown(source);
  diag('splitter.profile', {
    chars: profile.totalChars,
    headings: profile.headingTotal,
    dominant: profile.dominantHeadingLevel,
    tables: profile.hasTables,
    code: profile.hasCode,
    codeRatio: Number((profile.codeRatio || 0).toFixed(3)),
    strategy: profile.strategy
  });

  let sections = null;
  if (profile.strategy === 'heading' && profile.dominantHeadingLevel > 0) {
    sections = splitByHeadings(source, profile.dominantHeadingLevel);
  }
  if (!sections || !sections.length) {
    sections = [{ text: source, start: 0, end: source.length, breadcrumb: '' }];
  }

  const rawChunks = [];
  for (const section of sections) {
    const pieces = splitRespectingProtected(section.text, maxChars, overlapRatio);
    for (const piece of pieces) {
      rawChunks.push({
        markdown: piece.text,
        start: section.start + piece.start,
        end: section.start + piece.end,
        breadcrumb: section.breadcrumb
      });
    }
  }

  const chunks = coalesceTiny ? coalesceTinyChunks(rawChunks, maxChars) : rawChunks;
  validateChunks(chunks, source, maxChars);
  const documentFingerprint = sourceFingerprint(source);
  const pageBreakOffsets = [];
  for (let offset = source.indexOf('\f'); offset >= 0; offset = source.indexOf('\f', offset + 1)) pageBreakOffsets.push(offset);

  const provenanceSpans = Array.isArray(options.provenance?.spans) ? options.provenance.spans : [];
  return chunks.map((chunk, index) => {
    const overlapping = provenanceSpans.filter((span) => Number(span.end) > chunk.start && Number(span.start) < chunk.end);
    const pages = [...new Set(overlapping.map((span) => Number(span.page)).filter((page) => Number.isInteger(page) && page > 0))];
    return ({
    chunk_id: `chunk-${String(index + 1).padStart(3, '0')}`,
    stableChunkId: `chunk-${documentFingerprint}-${String(index + 1).padStart(3, '0')}`,
    markdown: chunk.markdown,
    headings: [...String(chunk.markdown).matchAll(/^#{1,6}\s+(.+)$/gm)].map((match) => match[1].trim()),
    breadcrumb: chunk.breadcrumb || '',
    headingPath: String(chunk.breadcrumb || '').split('\n').filter(Boolean),
    sourceStart: chunk.start,
    sourceEnd: chunk.end,
    pageStart: pages.length ? Math.min(...pages) : (pageBreakOffsets.length ? pageAtOffset(pageBreakOffsets, chunk.start) : undefined),
    pageEnd: pages.length ? Math.max(...pages) : (pageBreakOffsets.length ? pageAtOffset(pageBreakOffsets, Math.max(chunk.start, chunk.end - 1)) : undefined),
    provenanceSpanIds: overlapping.map((span) => span.span_id).filter(Boolean),
    contentFingerprint: sourceFingerprint(chunk.markdown),
    tokenEstimate: Math.ceil(chunk.markdown.length / 3),
    overlap: index > 0 ? Math.max(0, chunks[index - 1].end - chunk.start) : 0
  });
  });
}

function sourceFingerprint(value) {
  let hash = 2166136261;
  const text = String(value || '');
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function pageAtOffset(pageBreakOffsets, offset) {
  let low = 0;
  let high = pageBreakOffsets.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (pageBreakOffsets[middle] < offset) low = middle + 1;
    else high = middle;
  }
  return low + 1;
}

const COMMON_PROMPT_RULES = Object.freeze([
  '不得编造输入中不存在的事实；证据不足时使用空值并明确冲突。',
  '所有面向使用者的内容统一使用简体中文。',
  '只返回契约要求的 JSON，不输出 Markdown 代码围栏或解释文字。'
]);

function composePrompt(parts, commonRules = COMMON_PROMPT_RULES) {
  const seen = new Set();
  const values = [];
  for (const part of [...(parts || []), ...(commonRules || [])]) {
    const text = String(part || '').trim();
    if (!text) continue;
    const key = text.replace(/\s+/g, ' ');
    if (seen.has(key)) continue;
    seen.add(key);
    values.push(text);
  }
  return values.join('\n\n');
}

async function summarizeDocument(options) {
  const installedEvidenceSchema = options.summarySchema?.properties?.evidence?.items;
  const installedRequiresBlockId = Array.isArray(installedEvidenceSchema?.required)
    && installedEvidenceSchema.required.includes('block_id');
  diag('component.summaryContractDifference', {
    installedSchemaRequiresBlockId: installedRequiresBlockId,
    runtimeSchemaRequiresBlockId: true,
    runtimePromptContractInjected: true,
    replacementApplied: false
  });
  // v2.7: 透传 WeKnora 式切片参数（重叠比例 + 小节合并开关）
  const packedChunks = Array.isArray(options.parsePackage.block_packs)
    ? options.parsePackage.block_packs.filter((pack) => String(pack.text || '').trim()).map((pack, index) => ({
      chunk_id: `block-pack-${String(index + 1).padStart(3, '0')}`,
      stableChunkId: pack.pack_id,
      markdown: pack.text,
      headings: [],
      breadcrumb: '',
      headingPath: [],
      provenanceSpanIds: pack.block_ids || [],
      tokenEstimate: pack.token_count
    }))
    : [];
  const legacyChunks = splitMarkdownSections(options.parsePackage.markdown, {
    maxChars: options.maxChunkChars,
    overlapRatio: options.chunkOverlapRatio,
    coalesceTiny: options.coalesceTinyChunks,
    provenance: options.parsePackage.provenance
  });
  // block-native 输入不得仅因结构 packing 增加正常模式 provider 请求。
  // 若 pack 数高于既有 splitter，则保留旧切分；证据仍在 parsePackage.evidence_index 中做逐字回查。
  const chunks = packedChunks.length && packedChunks.length <= legacyChunks.length ? packedChunks : legacyChunks;
  for (const chunk of chunks) {
    chunk.legacyChunkId = chunk.chunk_id;
    chunk.chunk_id = String(chunk.stableChunkId || chunk.chunk_id);
    chunk.stableChunkId = chunk.chunk_id;
    chunk.sourceBlocks = summarySourceBlocks(options.parsePackage, chunk);
    chunk.block_ids = chunk.sourceBlocks.map((block) => block.block_id);
  }
  const parseContractFingerprint = String(options.parsePackage?.parse_contract?.fingerprint || '');
  const emptySourceChunks = chunks.filter((chunk) =>
    String(chunk.markdown || '').trim() && (!chunk.sourceBlocks.length
      || chunk.sourceBlocks.reduce((sum, block) => sum + String(block.text || '').length, 0) <= 0));
  if (emptySourceChunks.length) {
    const error = new Error(`解析产物内部契约不完整：${emptySourceChunks.length}/${chunks.length} 个非空总结分块没有可引用来源块。请保留原文件并从“解析”检查点重试；若仍失败，请导出脱敏诊断报告。`);
    error.name = 'ParseContractError';
    error.code = 'PARSE_CONTRACT_SOURCE_BLOCKS_MISSING';
    error.category = 'internal_parse_contract';
    error.stage = 'summary-map-preflight';
    error.retryable = false;
    error.details = {
      planned_chunks: chunks.length,
      non_empty_chunks: chunks.filter((chunk) => String(chunk.markdown || '').trim()).length,
      zero_source_block_chunks: emptySourceChunks.length,
      zero_source_span_characters: emptySourceChunks.filter((chunk) =>
        chunk.sourceBlocks.reduce((sum, block) => sum + String(block.text || '').length, 0) <= 0).length,
      block_count: Array.isArray(options.parsePackage?.blocks) ? options.parsePackage.blocks.length : 0,
      evidence_index_count: Object.keys(options.parsePackage?.evidence_index || {}).length,
      parse_contract_fingerprint: parseContractFingerprint,
      provider_calls: 0
    };
    diag('summary.map.parseContractRejected', error.details);
    throw error;
  }
  const partials = new Array(chunks.length);
  diag('summary.map.plan', {
    chunkTotal: chunks.length,
    stableChunkIds: chunks.map((chunk) => chunk.chunk_id).slice(0, 120)
  });
  const concurrency = Math.max(1, Math.min(3, Number(options.summaryConcurrency) || 2));
  let nextChunkIndex = 0;
  async function summarizeChunk(index) {
    const chunk = chunks[index];
    const cachedEnvelope = typeof options.loadSummaryMapChunk === 'function'
      ? await options.loadSummaryMapChunk(chunk)
      : null;
    const cached = cachedEnvelope?.parseContractFingerprint === parseContractFingerprint
      ? cachedEnvelope.payload
      : (!parseContractFingerprint && cachedEnvelope && !Object.hasOwn(cachedEnvelope, 'parseContractFingerprint')
        ? cachedEnvelope : null);
    const sanitizedCached = cached ? sanitizeSummaryEvidence(
      normalizeSummaryMap(cached, options, chunk),
      { stage: 'summary-map-cache', chunkId: chunk.chunk_id }
    ) : null;
    const cachedErrors = sanitizedCached ? [
      ...validateSchema(summarySchemaWithRuntimeProvenance(options.summarySchema), sanitizedCached).errors,
      ...exactCoverage(sanitizedCached.coverage, 'chunk_ids', [chunk.chunk_id], '总结分块覆盖不完整')
    ] : ['missing'];
    if (sanitizedCached && cachedErrors.length === 0) {
      partials[index] = sanitizedCached;
      diag('summary.map.cacheHit', {
        chunkIndex: index + 1, chunkTotal: chunks.length,
        stableChunkId: chunk.chunk_id,
        canonicalChunkId: chunk.chunk_id,
        sourceBlockCount: chunk.sourceBlocks.length,
        sourceSpanCharacters: chunk.sourceBlocks.reduce((sum, block) => sum + block.text.length, 0),
        mapOutputCount: sanitizedCached.key_points.length,
        sanitizationCount: sanitizedCached.evidence_sanitization?.dropped_points || 0
      });
      await emitProgress(options.onProgress, {
        stage: 'summary-map', chunkIndex: index + 1, chunkTotal: chunks.length,
        cacheHit: true, message: `复用逐段总结 ${index + 1}/${chunks.length}`
      });
      return;
    }
    if (cachedEnvelope) {
      diag('summary.map.cacheMiss', {
        chunkIndex: index + 1, chunkTotal: chunks.length,
        stableChunkId: chunk.chunk_id, canonicalChunkId: chunk.chunk_id,
        reason: cached ? 'checkpoint_invalid' : 'parse_contract_changed'
      });
    }
    // v2.7: 把标题层级面包屑（WeKnora ContextHeader）注入 prompt，让 AI 拿到章节语境
    const chunkContext = chunk.breadcrumb
      ? `当前分块 ${chunk.chunk_id}（${index + 1}/${chunks.length}），所属章节路径：\n${chunk.breadcrumb}`
      : `当前分块 ${chunk.chunk_id}（${index + 1}/${chunks.length}）：`;
    const runtimeContract = [
      '【运行时逐字证据契约（不可被组件提示词省略或覆盖）】',
      '下面 SOURCE_BLOCKS 是本分块唯一允许引用的来源。每条 evidence 必须填写其中一个 block_id；quote 必须是从该块 text 复制的短小、连续逐字片段。',
      '不得改写、概括、跨块拼接或根据标题/顺序猜测证据；locator 由程序按 block_id 回填，模型不得编造页码、行号、表格行或消息信息。',
      '若没有可逐字支持的知识点，key_points 与 evidence 返回空数组。',
      'SOURCE_BLOCKS:',
      JSON.stringify(chunk.sourceBlocks, null, 2)
    ].join('\n');
    const prompt = composePrompt([
      options.basePrompt,
      '当前文档类型专用规则：',
      options.typePrompt,
      '分类结果：',
      JSON.stringify(options.classification, null, 2),
      chunkContext,
      runtimeContract,
      `coverage.chunk_ids 必须且只能包含 ["${chunk.chunk_id}"]，complete 必须为 true。`,
      '所有面向使用者的内容统一使用简体中文。只返回符合 structured-summary.schema.json 的 JSON。'
    ]);
    partials[index] = await requestWithContract({
      prompt,
      stage: 'summary-map',
      schema: summarySchemaWithRuntimeProvenance(options.summarySchema),
      requestJson: options.requestJson,
      requestStream: options.requestStream,
      streaming: !!options.requestStream,
      maxRepairAttempts: options.maxRepairAttempts,
      onProgress: options.onProgress,
      context: { chunk, chunkId: chunk.chunk_id, chunkIndex: index + 1, chunkTotal: chunks.length },
      normalizeValue: (value) => sanitizeSummaryEvidence(
        normalizeSummaryMap(value, options, chunk),
        { stage: 'summary-map', chunkId: chunk.chunk_id }
      ),
      finalSanitize: (value) => sanitizeSummaryEvidence(value, {
        stage: 'summary-map', chunkId: chunk.chunk_id
      }),
      extraValidation: (value) => [
        ...exactCoverage(value.coverage, 'chunk_ids', [chunk.chunk_id], '总结分块覆盖不完整'),
        ...summaryEvidenceErrors(value, options.parsePackage)
      ]
    });
    if (typeof options.saveSummaryMapChunk === 'function') {
      await options.saveSummaryMapChunk(chunk, {
        parseContractFingerprint,
        payload: partials[index]
      });
    }
    diag('summary.map.completed', {
      chunkIndex: index + 1, chunkTotal: chunks.length,
      stableChunkId: chunk.chunk_id,
      canonicalChunkId: chunk.chunk_id,
      sourceBlockCount: chunk.sourceBlocks.length,
      sourceSpanCharacters: chunk.sourceBlocks.reduce((sum, block) => sum + block.text.length, 0),
      mapOutputCount: partials[index]?.key_points?.length || 0,
      sanitizationCount: partials[index]?.evidence_sanitization?.dropped_points || 0
    });
  }
  async function summaryWorker() {
    while (true) {
      const index = nextChunkIndex++;
      if (index >= chunks.length) return;
      await summarizeChunk(index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, chunks.length) }, () => summaryWorker()));

  provenanceFailureSummary(partials, 'summary-map');
  const usableChunks = partials.filter((partial) => (partial?.key_points || []).length > 0).length;
  if (!usableChunks) {
    const error = new Error(`全部 ${partials.length} 个总结分块都没有可由来源块逐字验证的知识点。请确认解析正文包含可引用内容，或更换能按 block_id 返回原文短引的模型后从总结检查点重试。`);
    error.code = 'SUMMARY_ALL_CHUNKS_UNSUPPORTED';
    error.stage = 'summary-map';
    error.retryable = false;
    error.details = {
      outcome: 'no_verified_knowledge',
      chunks: partials.length,
      empty_verified_chunks: partials.length,
      reduce_calls: 0,
      atomization_calls: 0
    };
    diag('summary.map.allEmpty', error.details);
    throw error;
  }
  if (partials.length === 1) return partials[0];
  return reduceSummaryHierarchy(options, partials, Math.max(2, Number(options.reduceBatchSize) || 8));
}

function normalizeSummaryReduce(value, requestedChunkIds, parsePackage) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  let result = value;
  // Some OpenAI-compatible/provider adapters wrap a structured-output item once.
  // Only unwrap an unambiguous envelope; never discard unknown sibling data.
  const keys = Object.keys(result);
  if (keys.length === 1 && keys[0] === 'item' && result.item && typeof result.item === 'object' && !Array.isArray(result.item)) {
    result = result.item;
  }
  if (!result || typeof result !== 'object' || Array.isArray(result)) return result;
  const expected = [...new Set((requestedChunkIds || []).map(String))];
  const coverage = result.coverage;
  const actual = Array.isArray(coverage?.chunk_ids) ? coverage.chunk_ids.map(String) : [];
  const actualSet = new Set(actual);
  const expectedSet = new Set(expected);
  const hasUnknown = actual.some((id) => !expectedSet.has(id));
  const hasDuplicates = actualSet.size !== actual.length;
  // Coverage is request bookkeeping, not model-authored content. It is safe to
  // reconstruct only when it is absent or a duplicate-free subset of the exact
  // validated map chunks supplied to this reduce call.
  if (expected.length && !hasUnknown && !hasDuplicates && actual.every((id) => expectedSet.has(id))) {
    result = Object.assign({}, result, {
      coverage: { chunk_ids: expected, complete: true }
    });
  }
  if (Array.isArray(result.evidence) && Object.keys(parsePackage?.evidence_index || {}).length) {
    result = Object.assign({}, result, {
      evidence: result.evidence.map((item) => reconcileBlockEvidence(parsePackage, item))
    });
  } else if (/^(mineru-api|paddleocr-api)$/.test(String(parsePackage?.parser || '')) && Array.isArray(result.evidence)) {
    result = Object.assign({}, result, {
      evidence: result.evidence.map((item) => {
        if (!item || typeof item !== 'object') return item;
        const resolved = item.provenance
          ? verifyLocator(parsePackage, item.quote, item.provenance)
          : resolveEvidence(parsePackage, item.quote);
        if (!resolved.ok) {
          return Object.assign({}, item, { locator: '', provenance_resolution: { ok: false, reason: resolved.reason } });
        }
        return Object.assign({}, item, {
          quote: exactEvidenceQuote(parsePackage, resolved, item.quote),
          locator: resolved.label,
          provenance: resolved.locator,
          source_page: resolved.locator.page || '',
          locator_precision: resolved.locator.precision
        });
      })
    });
  }
  return result;
}

function normalizeSummaryMap(value, options, chunk) {
  if (!value || typeof value !== 'object') return value;
  const result = Object.assign({}, value, {
    document_title: value.document_title || options.parsePackage.source_name || '结构化总结',
    library: options.classification.library,
    folder_type: options.classification.folder_type,
    document_type: options.classification.document_type,
    // Coverage is deterministic request bookkeeping.  Old checkpoints may
    // contain the pre-stable logical id; loading them rewrites it once to the
    // canonical id used by every new-run boundary.
    coverage: { chunk_ids: [chunk.chunk_id], complete: true }
  });
  if (Array.isArray(result.evidence)) {
    // v2.7: 优先用标题层级面包屑做定位（"第3章 结构 > 3.2 荷载"），退回 chunk 内首个标题
    var breadcrumbPath = String(chunk.breadcrumb || '')
      .split('\n')
      .map(function(line) { return line.replace(/^#{1,6}\s+/, '').trim(); })
      .filter(Boolean)
      .join(' > ');
    result.evidence = result.evidence.map(function(item, index) {
      if (!item || typeof item !== 'object') return item;
      var normalized = Object.assign({}, item, {
        evidence_id: item.evidence_id || ('evidence-' + (index + 1)),
        locator: item.locator || '',
        quote: item.quote || ''
      });
      if (Object.keys(options.parsePackage?.evidence_index || {}).length) {
        normalized = reconcileBlockEvidence(
          options.parsePackage,
          normalized,
          new Map((chunk.sourceBlocks || []).map((block) => [String(block.block_id), String(block.text || '')]))
        );
      } else if (/^(mineru-api|paddleocr-api)$/.test(String(options.parsePackage?.parser || ''))) {
        var resolved = resolveEvidence(options.parsePackage, normalized.quote, {
          start: chunk.sourceStart,
          end: chunk.sourceEnd,
          page: chunk.pageStart === chunk.pageEnd ? chunk.pageStart : undefined
        });
        if (resolved.ok) {
          normalized.quote = exactEvidenceQuote(options.parsePackage, resolved, normalized.quote);
          normalized.locator = resolved.label;
          normalized.provenance = resolved.locator;
          normalized.source_page = resolved.locator.page || '';
          normalized.locator_precision = resolved.locator.precision;
        } else {
          normalized.locator = '';
          normalized.provenance_resolution = { ok: false, reason: resolved.reason };
        }
      }
      return normalized;
    });
  }
  return result;
}

function reconcileBlockEvidence(parsePackage, item, allowedBlocks) {
  if (!item || typeof item !== 'object') return item;
  const index = parsePackage?.evidence_index || {};
  const requestedId = String(item.block_id || item.provenance?.block_id || '');
  const quote = String(item.quote || '').trim();
  if (!requestedId) {
    return Object.assign({}, item, {
      locator: '', block_id: '',
      provenance_resolution: { ok: false, reason: 'block_id_missing' }
    });
  }
  const allowedBlockIds = allowedBlocks instanceof Map
    ? new Set(allowedBlocks.keys())
    : allowedBlocks;
  if (allowedBlockIds && !allowedBlockIds.has(requestedId)) {
    return Object.assign({}, item, {
      locator: '', block_id: requestedId,
      provenance_resolution: { ok: false, reason: 'block_outside_chunk' }
    });
  }
  const repaired = reconcileEvidence(parsePackage, quote, requestedId ? { block_id: requestedId } : {});
  if (repaired.ok && String(repaired.locator?.block_id || '') !== requestedId) {
    return Object.assign({}, item, {
      locator: '', block_id: requestedId,
      provenance_resolution: { ok: false, reason: 'block_id_mismatch' }
    });
  }
  const entry = repaired.ok ? index[repaired.locator.block_id] : null;
  if (!entry || entry.card_eligible === false || !repaired.ok) {
    return Object.assign({}, item, {
      locator: '', block_id: requestedId || '',
      provenance_resolution: { ok: false, reason: repaired.reason || 'BLOCK_EVIDENCE_UNVERIFIED' }
    });
  }
  if (allowedBlocks instanceof Map && !allowedBlocks.get(requestedId)?.includes(String(repaired.quote || ''))) {
    return Object.assign({}, item, {
      locator: '', block_id: requestedId,
      provenance_resolution: { ok: false, reason: 'quote_outside_chunk' }
    });
  }
  return Object.assign({}, item, {
    quote: repaired.quote,
    block_id: entry.block_id,
    locator: `${entry.locator.scheme}:${entry.locator.value}`,
    provenance: repaired.locator,
    locator_precision: 'block-exact',
    provenance_resolution: { ok: true, method: repaired.repaired ? 'reconciled' : 'exact' }
  });
}

function summarySourceBlocks(parsePackage, chunk) {
  const evidenceIndex = parsePackage?.evidence_index || {};
  const spans = Array.isArray(parsePackage?.provenance?.spans) ? parsePackage.provenance.spans : [];
  const ids = new Set();
  for (const id of chunk.provenanceSpanIds || []) {
    if (evidenceIndex[id]) ids.add(String(id));
    const span = spans.find((item) => String(item?.span_id || '') === String(id));
    if (span?.block_id) ids.add(String(span.block_id));
  }
  if (!ids.size && Number.isInteger(chunk.sourceStart) && Number.isInteger(chunk.sourceEnd)) {
    for (const span of spans) {
      if (Number(span?.end) > chunk.sourceStart && Number(span?.start) < chunk.sourceEnd && span?.block_id) {
        ids.add(String(span.block_id));
      }
    }
  }
  if (!ids.size) {
    const chunkText = String(chunk.markdown || '');
    for (const entry of Object.values(evidenceIndex)) {
      const raw = String(entry?.raw_text || '');
      if (raw && (chunkText.includes(raw) || raw.includes(chunkText))) ids.add(String(entry.block_id));
    }
  }
  return [...ids].map((blockId) => evidenceIndex[blockId]).filter((entry) =>
    entry && entry.card_eligible !== false && String(entry.raw_text || '').trim()
  ).map((entry) => {
    const raw = String(entry.raw_text);
    const chunkText = String(chunk.markdown || '');
    let text = raw;
    let blockStart = 0;
    if (Number.isInteger(chunk.sourceStart) && Number.isInteger(chunk.sourceEnd)) {
      const documentText = String(parsePackage?.markdown || '');
      const blockDocumentStart = documentText.indexOf(raw);
      if (blockDocumentStart >= 0) {
        const overlapStart = Math.max(chunk.sourceStart, blockDocumentStart);
        const overlapEnd = Math.min(chunk.sourceEnd, blockDocumentStart + raw.length);
        if (overlapEnd > overlapStart) {
          blockStart = overlapStart - blockDocumentStart;
          text = raw.slice(blockStart, overlapEnd - blockDocumentStart);
        }
      }
    } else if (raw.includes(chunkText)) {
      blockStart = raw.indexOf(chunkText);
      text = chunkText;
    }
    const locator = entry.locator && typeof entry.locator === 'object'
      ? Object.assign({}, entry.locator)
      : {};
    locator.source_span = {
      start: blockStart,
      end: blockStart + text.length,
      unit: 'character',
      bounded: text.length < raw.length
    };
    return { block_id: String(entry.block_id), locator, text };
  }).filter((block) => block.text.trim());
}

function summarySchemaWithRuntimeProvenance(schema) {
  if (!schema || typeof schema !== 'object') return schema;
  const result = JSON.parse(JSON.stringify(schema));
  const evidenceItem = result?.properties?.evidence?.items;
  if (result.properties && typeof result.properties === 'object') {
    result.properties.map_status = { type: 'string', enum: ['verified', 'unsupported'] };
    result.properties.evidence_sanitization = {
      type: 'object',
      properties: {
        dropped_evidence: { type: 'integer', minimum: 0 },
        dropped_points: { type: 'integer', minimum: 0 },
        kept_evidence: { type: 'integer', minimum: 0 },
        kept_points: { type: 'integer', minimum: 0 },
        reasons: { type: 'object' }
      },
      required: ['dropped_evidence', 'dropped_points', 'kept_evidence', 'kept_points', 'reasons']
    };
  }
  if (evidenceItem && typeof evidenceItem === 'object') {
    evidenceItem.properties = Object.assign({}, evidenceItem.properties, { block_id: { type: 'string', minLength: 1 } });
    evidenceItem.required = [...new Set([...(evidenceItem.required || []), 'block_id'])];
  }
  return result;
}

function sanitizeSummaryEvidence(value, context = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  const rawEvidence = Array.isArray(value.evidence) ? value.evidence : [];
  const keptEvidence = rawEvidence.filter((item) =>
    item?.provenance_resolution?.ok === true && item?.provenance?.block_id && item?.quote
  );
  const keptIds = new Set(keptEvidence.map((item) => String(item.evidence_id || '')));
  const reasons = {};
  for (const item of rawEvidence) {
    if (keptIds.has(String(item?.evidence_id || ''))) continue;
    const reason = String(item?.provenance_resolution?.reason || 'unverified_evidence');
    reasons[reason] = (reasons[reason] || 0) + 1;
  }
  let droppedPoints = 0;
  const keyPoints = [];
  for (const point of Array.isArray(value.key_points) ? value.key_points : []) {
    const verifiedIds = [...new Set((point?.evidence_ids || []).map(String).filter((id) => keptIds.has(id)))];
    if (!verifiedIds.length) {
      droppedPoints += 1;
      continue;
    }
    keyPoints.push(Object.assign({}, point, { evidence_ids: verifiedIds }));
  }
  const stats = {
    dropped_evidence: rawEvidence.length - keptEvidence.length,
    dropped_points: droppedPoints,
    kept_evidence: keptEvidence.length,
    kept_points: keyPoints.length,
    reasons
  };
  const result = Object.assign({}, value, {
    evidence: keptEvidence,
    key_points: keyPoints,
    evidence_sanitization: stats,
    map_status: keyPoints.length ? 'verified' : 'unsupported'
  });
  diag(keyPoints.length ? 'summary.evidence.sanitized' : 'summary.map.emptyVerified',
    Object.assign({}, context, stats));
  return result;
}

function summaryEvidenceErrors(summary) {
  const evidence = Array.isArray(summary?.evidence) ? summary.evidence : [];
  const byId = new Map(evidence.map((item) => [String(item?.evidence_id || ''), item]));
  const errors = [];
  for (const item of evidence) {
    if (!item?.provenance_resolution?.ok || !item?.provenance?.block_id || !item?.quote) {
      errors.push(`证据 ${item?.evidence_id || 'unknown'} 缺少唯一来源块的逐字引文与定位`);
    }
  }
  for (const point of summary?.key_points || []) {
    const ids = Array.isArray(point?.evidence_ids) ? point.evidence_ids.map(String) : [];
    if (!ids.length || ids.some((id) => !byId.get(id)?.provenance_resolution?.ok)) {
      errors.push(`知识点 ${point?.point_id || 'unknown'} 缺少已验证证据归属`);
    }
  }
  return errors;
}

function mergeStructuredSummaries(partials, chunkIds, schema) {
  const first = partials[0] || {};
  const keyPoints = [];
  const evidence = [];
  const entities = [];
  const suggestedLinks = [];
  for (let index = 0; index < partials.length; index += 1) {
    const partial = partials[index];
    const prefix = (partial.coverage?.chunk_ids || [`part-${index + 1}`]).join('-');
    const evidenceMap = new Map();
    for (let evidenceIndex = 0; evidenceIndex < (partial.evidence || []).length; evidenceIndex += 1) {
      const item = partial.evidence[evidenceIndex];
      const oldId = item.evidence_id || `evidence-${evidenceIndex + 1}`;
      const newId = `${prefix}-${oldId}`;
      evidenceMap.set(oldId, newId);
      evidence.push(Object.assign({}, item, { evidence_id: newId }));
    }
    for (let pointIndex = 0; pointIndex < (partial.key_points || []).length; pointIndex += 1) {
      const point = partial.key_points[pointIndex];
      const oldId = point.point_id || `point-${pointIndex + 1}`;
      keyPoints.push(Object.assign({}, point, {
        point_id: `${prefix}-${oldId}`,
        evidence_ids: (point.evidence_ids || []).map((id) => evidenceMap.get(id) || `${prefix}-${id}`)
      }));
    }
    entities.push(...(partial.entities || []));
    suggestedLinks.push(...(partial.suggested_links || []));
  }
  const merged = applySchemaConstants(schema, {
    document_title: first.document_title || '结构化总结',
    library: first.library,
    folder_type: first.folder_type,
    document_type: first.document_type,
    executive_summary: [...new Set(partials.map((item) => item.executive_summary).filter(Boolean))].join('\n\n'),
    entities,
    key_points: keyPoints,
    evidence,
    suggested_links: suggestedLinks,
    coverage: { chunk_ids: chunkIds, complete: true },
    model_confidence: Math.min(...partials.map((item) => Number(item.model_confidence) || 0)),
    schema_version: '1.1'
  });
  if (Array.isArray(merged.evidence)) {
    merged.evidence = merged.evidence.map(function(item, index) {
      if (!item || typeof item !== 'object') return item;
      return Object.assign({}, item, {
        evidence_id: item.evidence_id || ('evidence-' + (index + 1)),
        locator: item.locator || '',
        quote: item.quote || ''
      });
    });
  }
  const validation = validateSchema(schema, merged);
  const errors = [...validation.errors, ...exactCoverage(merged.coverage, 'chunk_ids', chunkIds, '总结分块覆盖不完整')];
  if (errors.length) throw new Error(errors.join('；'));
  // v2.8.1: 总结合并结果诊断——"未生成任何可用知识原子"排障第一步：确认总结本身有没有知识点
  diag('summary.merged', {
    chunks: chunkIds.length,
    partials: partials.length,
    keyPoints: keyPoints.length,
    evidence: evidence.length,
    title: merged.document_title
  });
  return merged;
}

function exactEvidenceQuote(parsePackage, resolved, fallback) {
  const start = Number(resolved?.locator?.text_start);
  const end = Number(resolved?.locator?.text_end);
  const markdown = String(parsePackage?.markdown || '');
  return Number.isInteger(start) && Number.isInteger(end) && start >= 0 && end > start && end <= markdown.length
    ? markdown.slice(start, end)
    : fallback;
}

function provenanceFailureSummary(summaries, stage) {
  const reasons = {};
  let checked = 0;
  for (const summary of summaries || []) {
    for (const item of summary?.evidence || []) {
      checked += 1;
      const reason = item?.provenance_resolution?.reason;
      if (reason) reasons[reason] = (reasons[reason] || 0) + 1;
    }
  }
  const failed = Object.values(reasons).reduce((sum, count) => sum + count, 0);
  diag('provenance.aggregate', { stage, checked, resolved: checked - failed, failed, reasons });
}

function summarySize(summary) {
  return JSON.stringify(summary || {}).length;
}

function budgetedReduceGroups(level, maxInputChars, maxItems) {
  const groups = [];
  let group = [];
  let used = 0;
  for (const item of level) {
    const size = summarySize(item);
    if (group.length && (group.length >= maxItems || used + size > maxInputChars)) {
      groups.push(group);
      group = [];
      used = 0;
    }
    group.push(item);
    used += size;
  }
  if (group.length) groups.push(group);
  return groups;
}

function stableReduceId(round, chunkIds, group) {
  return `r${round}-${sourceFingerprint(JSON.stringify({
    chunkIds,
    content: group.map((item) => sourceFingerprint(JSON.stringify(item)))
  }))}`;
}

async function reduceSummaryHierarchy(options, initial, batchSize) {
  let level = initial;
  let round = 1;
  const maxInputChars = Math.max(6000, Number(options.reduceInputBudgetChars) || 18000);
  const maxItems = Math.max(2, Math.min(batchSize, Number(options.reduceBatchSize) || batchSize));
  while (level.length > 1) {
    const next = [];
    const groups = budgetedReduceGroups(level, maxInputChars, maxItems);
    diag('summary.reduce.plan', {
      round, inputs: level.length, groups: groups.length, maxInputChars, maxItems,
      groupCharacters: groups.map((group) => group.reduce((sum, item) => sum + summarySize(item), 0))
    });
    for (let groupIndex = 0; groupIndex < groups.length; groupIndex += 1) {
      const group = groups[groupIndex];
      if (group.length === 1) {
        next.push(group[0]);
        continue;
      }
      const chunkIds = [...new Set(group.flatMap((item) => item.coverage.chunk_ids))];
      const checkpoint = {
        stableReduceId: stableReduceId(round, chunkIds, group),
        round,
        groupIndex,
        chunkIds
      };
      const cached = typeof options.loadSummaryReduceChunk === 'function'
        ? await options.loadSummaryReduceChunk(checkpoint)
        : null;
      if (cached) {
        const normalized = normalizeSummaryReduce(cached, chunkIds, options.parsePackage);
        const cachedErrors = [
          ...validateSchema(summarySchemaWithRuntimeProvenance(options.summarySchema), normalized).errors,
          ...exactCoverage(normalized.coverage, 'chunk_ids', chunkIds, '总结分块覆盖不完整')
        ];
        if (!cachedErrors.length) {
          next.push(normalized);
          diag('summary.reduce.cacheHit', { round, groupIndex, stableReduceId: checkpoint.stableReduceId, chunks: chunkIds.length });
          continue;
        }
        diag('summary.reduce.cacheMiss', { round, groupIndex, stableReduceId: checkpoint.stableReduceId, reason: 'checkpoint_invalid' });
      }
      const prompt = composePrompt([
        options.basePrompt,
        '当前文档类型专用规则：',
        options.typePrompt,
        `这是第 ${round} 轮分层归并。合并以下总结，去重但不得删除任何有证据的独立事实、决策、要求、风险、参数、行动项或经验。`,
        `coverage.chunk_ids 必须完整且只能为：${JSON.stringify(chunkIds)}；complete 必须为 true。`,
        '输出根对象必须直接是 structured summary；若供应商要求使用 item 包裹，item 的值必须是该完整 summary，插件会移除这一层供应商包裹。',
        JSON.stringify(group, null, 2),
        '只返回符合 structured-summary.schema.json 的 JSON。'
      ]);
      let reduced;
      try {
        reduced = await requestWithContract({
          prompt,
          stage: 'summary-reduce',
          schema: summarySchemaWithRuntimeProvenance(options.summarySchema),
          requestJson: options.requestJson,
          requestStream: options.requestStream,
          streaming: !!options.requestStream,
          maxRepairAttempts: options.maxRepairAttempts,
          onProgress: options.onProgress,
          context: { chunkIds, partialCount: group.length, reduceRound: round, reduceGroup: groupIndex + 1, reduceGroupTotal: groups.length },
          normalizeValue: (value) => sanitizeSummaryEvidence(
            normalizeSummaryReduce(value, chunkIds, options.parsePackage),
            { stage: 'summary-reduce', chunkIds }
          ),
          finalSanitize: (value) => sanitizeSummaryEvidence(value, {
            stage: 'summary-reduce', chunkIds
          }),
          extraValidation: (value) => [
            ...exactCoverage(value.coverage, 'chunk_ids', chunkIds, '总结分块覆盖不完整'),
            ...summaryEvidenceErrors(value)
          ]
        });
      } catch (error) {
        if (error?.code !== 'AI_OUTPUT_TRUNCATED') throw error;
        reduced = mergeStructuredSummaries(group, chunkIds, options.summarySchema);
        diag('summary.reduce.truncationRecovered', {
          round, groupIndex, stableReduceId: checkpoint.stableReduceId, chunks: chunkIds.length,
          inputCharacters: group.reduce((sum, item) => sum + summarySize(item), 0)
        });
      }
      if (typeof options.saveSummaryReduceChunk === 'function') {
        await options.saveSummaryReduceChunk(checkpoint, reduced);
      }
      next.push(reduced);
    }
    // If every budget group was a singleton, force a lossless local pair merge so
    // the hierarchy always converges without sending an oversized provider request.
    if (next.length === level.length) {
      const forced = [];
      for (let index = 0; index < next.length; index += 2) {
        const pair = next.slice(index, index + 2);
        forced.push(pair.length === 1 ? pair[0] : mergeStructuredSummaries(
          pair,
          [...new Set(pair.flatMap((item) => item.coverage.chunk_ids))],
          options.summarySchema
        ));
      }
      level = forced;
    } else {
      level = next;
    }
    round += 1;
  }
  provenanceFailureSummary(level, 'summary-final');
  return level[0];
}

async function atomizeSummary(options) {
  const pointIds = (options.summary.key_points || []).map((point) => point.point_id);
  if (!pointIds.length) {
    const error = new Error('结构化总结中没有可由来源逐字验证的知识点，已停止知识原子化。请检查正文解析与 block_id 短引证据后从总结阶段重试。');
    error.code = 'SUMMARY_ALL_CHUNKS_UNSUPPORTED';
    error.stage = 'atomization';
    error.retryable = false;
    error.details = { outcome: 'no_verified_knowledge', requestedPoints: 0, providerCalls: 0 };
    diag('atomization.skipped.noVerifiedPoints', error.details);
    throw error;
  }
  const configuredBatchSize = Number(options.maxPointsPerRequest) || 1;
  const batchSize = Math.max(1, Math.min(3, configuredBatchSize));
  const batches = [];
  for (let offset = 0; offset < pointIds.length; offset += batchSize) {
    batches.push(pointIds.slice(offset, offset + batchSize));
  }

  const results = new Array(batches.length);
  let completedBatches = 0;
  let nextBatchIndex = 0;
  const batchFailures = [];
  const concurrency = Math.max(1, Math.min(3, Number(options.atomizationConcurrency) || 2));
  async function processBatch(index) {
    if (options.signal?.aborted) throw abortError();
    const batchPointIds = batches[index];
    const stableBatchId = stableAtomBatchId(batchPointIds, index);
    const descriptor = { index, pointIds: batchPointIds, stableBatchId };
    let cached = null;
    if (typeof options.loadAtomBatch === 'function') {
      try {
        cached = await options.loadAtomBatch(descriptor);
      } catch (error) {
        const checkpointError = new Error(`无法读取已保存的原子批次 ${index + 1}/${batches.length}：${String(error?.message || error)}`);
        checkpointError.code = 'ATOMIZATION_CHECKPOINT_READ_FAILED';
        checkpointError.stage = 'atomization';
        checkpointError.retryable = true;
        throw checkpointError;
      }
    }
    if (cached) {
      const normalized = normalizeAtomBatch(cached, options.summary, batchPointIds);
      const errors = [
        ...validateSchema(options.atomSchema, normalized).errors,
        ...exactCoverage(normalized.coverage, 'point_ids', batchPointIds, '知识点覆盖不完整'),
        ...exactAtomAttribution(normalized.atoms, batchPointIds)
      ];
      if (!errors.length) {
        results[index] = normalized;
        completedBatches += 1;
        diag('atomization.batch.cacheHit', { batchIndex: index + 1, batchTotal: batches.length, stableBatchId });
        await emitProgress(options.onProgress, {
          stage: 'atomization', batchIndex: completedBatches, batchTotal: batches.length,
          batchComplete: true, message: `已复用 ${completedBatches}/${batches.length} 个有效原子批次`
        });
        return;
      }
      diag('atomization.batch.cacheMiss', { batchIndex: index + 1, stableBatchId, reason: 'checkpoint_invalid', errors });
    }
    const pointSet = new Set(batchPointIds);
    const keyPoints = (options.summary.key_points || []).filter((point) => pointSet.has(point.point_id));
    const evidenceIds = new Set(keyPoints.flatMap((point) => point.evidence_ids || []));
    const batchSummary = Object.assign({}, options.summary, {
      executive_summary: keyPoints.map((point) => point.content).join('；'),
      key_points: keyPoints,
      evidence: (options.summary.evidence || []).filter((item) => evidenceIds.has(item.evidence_id))
    });
    await emitProgress(options.onProgress, {
      stage: 'atomization',
      batchIndex: completedBatches,
      batchTotal: batches.length,
      message: `正在处理第 ${index + 1} 批；已验证 ${completedBatches}/${batches.length} 批`
    });
    const batchResult = await atomizeSummaryBatch(
      options, batchSummary, batchPointIds, index + 1, batches.length
    );
    if (options.signal?.aborted) throw abortError();
    if (typeof options.saveAtomBatch === 'function') {
      let saveError = null;
      for (let attempt = 1; attempt <= 2; attempt += 1) {
        try {
          await options.saveAtomBatch(descriptor, batchResult);
          saveError = null;
          break;
        } catch (error) {
          saveError = error;
          diag('atomization.batch.checkpointRetry', {
            batchIndex: index + 1, batchTotal: batches.length, stableBatchId, attempt,
            message: String(error?.message || error)
          });
        }
      }
      if (saveError) {
        const checkpointError = new Error(`无法保存原子批次 ${index + 1}/${batches.length}：${String(saveError?.message || saveError)}`);
        checkpointError.code = 'ATOMIZATION_CHECKPOINT_WRITE_FAILED';
        checkpointError.stage = 'atomization';
        checkpointError.retryable = true;
        throw checkpointError;
      }
    }
    results[index] = batchResult;
    completedBatches += 1;
    diag('atomization.batch', {
      batchIndex: index + 1, batchTotal: batches.length, completedBatches,
      requestedPoints: batchPointIds.length,
      atoms: Array.isArray(batchResult?.atoms) ? batchResult.atoms.length : 0,
      stableBatchId
    });
    await emitProgress(options.onProgress, {
      stage: 'atomization', batchIndex: completedBatches, batchTotal: batches.length,
      batchComplete: true, message: `已验证并保存 ${completedBatches}/${batches.length} 个原子批次`
    });
  }
  async function worker() {
    while (!options.signal?.aborted) {
      const index = nextBatchIndex++;
      if (index >= batches.length) return;
      try {
        await processBatch(index);
      } catch (error) {
        if (error?.name === 'AbortError' || error?.code === 'TASK_CANCELLED') throw error;
        const failure = {
          index, batchIndex: index + 1, pointIds: batches[index],
          stableBatchId: stableAtomBatchId(batches[index], index),
          code: error?.code || 'ATOMIZATION_BATCH_FAILED',
          message: String(error?.message || error)
        };
        batchFailures.push(failure);
        diag('atomization.batch.failed', Object.assign({
          batchTotal: batches.length, completedBatches
        }, failure));
      }
    }
  }
  await Promise.allSettled(Array.from({ length: Math.min(concurrency, batches.length) }, () => worker()));
  if (options.signal?.aborted) throw abortError();
  if (batchFailures.length) {
    batchFailures.sort((left, right) => left.index - right.index);
    const error = new Error(
      `知识原子化仅完成 ${completedBatches}/${batches.length} 批；失败批次：`
      + batchFailures.map((failure) => `${failure.batchIndex}(${failure.pointIds.join('、') || '空批次'})`).join('、')
    );
    error.code = 'ATOMIZATION_BATCH_INCOMPLETE';
    error.stage = 'atomization';
    error.category = batchFailures.every((failure) => failure.code.startsWith('ATOMIZATION_CHECKPOINT_'))
      ? 'checkpoint'
      : 'ai_provider';
    error.retryable = true;
    error.details = { completedBatches, batchTotal: batches.length, failedBatches: batchFailures };
    throw error;
  }
  const completedResults = results.filter(Boolean);

  if (completedResults.length !== batches.length) {
    const error = new Error(`知识原子化批次覆盖不完整：已验证 ${completedResults.length}/${batches.length} 批`);
    error.code = 'ATOMIZATION_BATCH_INCOMPLETE';
    error.stage = 'atomization';
    error.category = 'checkpoint';
    error.retryable = true;
    error.details = { completedBatches: completedResults.length, batchTotal: batches.length };
    throw error;
  }
  if (completedResults.length === 1 && batches.length === 1) return completedResults[0];
  const mergedAtoms = completedResults.flatMap((result) => result.atoms || []);
  const merged = applySchemaConstants(options.atomSchema, {
    atoms: mergedAtoms,
    coverage: { point_ids: pointIds, complete: completedResults.length === batches.length },
    schema_version: '1.1'
  });
  const validation = validateSchema(options.atomSchema, merged);
  const errors = [
    ...validation.errors,
    ...exactCoverage(merged.coverage, 'point_ids', pointIds, '知识点覆盖不完整'),
    ...exactAtomAttribution(merged.atoms, pointIds)
  ];
  if (errors.length) throw new Error(errors.join('；'));
  return merged;
}

function stableAtomBatchId(pointIds, index) {
  const value = (pointIds || []).map(String).join('|') || `empty-${index}`;
  let hash = 2166136261;
  for (const char of value) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return `${index + 1}-${(hash >>> 0).toString(16)}`;
}

function exactAtomAttribution(atoms, pointIds) {
  const expected = new Set(pointIds || []);
  const attributed = new Set();
  for (const atom of atoms || []) {
    for (const pointId of atom?.content?.point_ids || []) {
      if (expected.has(pointId)) attributed.add(pointId);
    }
  }
  return [...expected].filter((pointId) => !attributed.has(pointId))
    .map((pointId) => `知识点 ${pointId} 没有有效归属原子或明确的审核安全结果`);
}

function validateAtomizationResult(value, summary, atomSchema) {
  const pointIds = (summary?.key_points || []).map((point) => point.point_id);
  const normalized = normalizeAtomBatch(value, summary || {}, pointIds);
  return {
    value: normalized,
    errors: [
      ...validateSchema(atomSchema, normalized).errors,
      ...exactCoverage(normalized?.coverage, 'point_ids', pointIds, '知识点覆盖不完整'),
      ...exactAtomAttribution(normalized?.atoms, pointIds)
    ]
  };
}

async function atomizeSummaryBatch(options, summary, pointIds, batchIndex, batchTotal) {
  const prompt = [
    options.atomPrompt,
    'Type Mapping（静态/动态卡片判定只能参考此契约）：',
    options.typeMapping,
    '标签字典（Category / TagL1 / TagL2 只能从中精确选择，不得自造）：',
    options.tagLibrary,
    '结构化总结：',
    JSON.stringify(summary, null, 2),
    '已有知识卡片候选（related_candidates 只能引用这些 card_id；没有明确语义关系时返回空数组）：',
    JSON.stringify((options.linkCandidates || []).map((item) => ({ card_id: item.card_id, title: item.title, path: item.path })), null, 2),
    '允许的关联类型仅为 supports、contradicts、supersedes、depends_on、implements、related。',
    '每个独立且有复用价值的知识点生成一个原子；禁止只描述”召开会议、进行了讨论、应当优化”等空泛内容。',
    '每个原子的 source 必须包含源文件双链、原文定位、逐字证据和父总结双链。',
    `coverage.point_ids 必须完整且只能为：${JSON.stringify(pointIds)}；complete 必须为 true。`,
    // v2.9.2: 归一化靠 content.point_ids 把原子归属到知识点。此前所有 prompt 只要求 coverage.point_ids（批次级），
    //   从不要求逐原子的 content.point_ids → 多知识点批次里每个原子都因"无归属"被丢弃（诊断日志
    //   droppedNoPointAttribution 全等于 rawAtoms），最终误报"AI 返回内容不是有效 JSON"。这里显式立约。
    `每个原子的 content.point_ids 必须是非空字符串数组，取值只能来自本批知识点 ${JSON.stringify(pointIds)}。归属是多对多：同一可复用知识单元可覆盖多个 point_id；一个 point_id 含多个独立要求时可生成多个原子。不得为了逐点交差而强制一要点一卡。`,
    `这是知识原子化第 ${batchIndex}/${batchTotal} 批；只处理本批知识点，不得重复其他批次。`,
    '标题和正文统一使用简体中文。只返回符合 knowledge-atoms.schema.json 的 JSON。',
    // v1.1.10: 显式列出必须的最外层结构。AI 返回不带 {atoms:[...], coverage:{...}, schema_version:”1.1”}
    //   包裹的形状（如直接返回 atom 数组、或单个 atom 对象、或裸 markdown）都会被严格 schema 校验拒绝。
    //   显式约束 shape 是 90% 错误的根因。
    '【输出包裹格式（严格）】必须直接返回一个 JSON 对象，禁止用 Markdown 代码围栏（不要 ```json ... ```），禁止外层再套一层数组或对象。该对象的 keys 只能出现以下三个：atoms、coverage、schema_version，缺一不可。',
    '示例（只是格式示例，不是内容约束）：{“atoms”:[{“atom_id”:”...”,”title”:”...”,”card_kind”:”static|event”,”library”:”bid|business”,”folder_type”:”...”,”content”:{...},”source”:{“source_link”:”...”,”source_locator”:”...”,”evidence_quote”:”...”,”parent_summary”:”...”},”model_confidence”:0.0,”validation_issues”:[],”related_candidates”:[]}, ...],”coverage”:{“point_ids”:[' + pointIds.map((id) => '”' + id + '”').join(',') + '],”complete”:true},”schema_version”:”1.1”}'
  ].filter(Boolean).join('\n\n');
  return requestWithContract({
    prompt,
    stage: 'atomization',
    schema: options.atomSchema,
    requestJson: options.requestJson,
    maxRepairAttempts: options.maxRepairAttempts,
    onProgress: options.onProgress,
    context: { pointIds, batchIndex, batchTotal, signal: options.signal },
    normalizeValue: (value) => normalizeAtomBatch(value, summary, pointIds),
    // v2.8.1: 知识点非空但归一化后原子为 0 时，走一次"带校验错误的修复提示词"重试，
    //   而不是静默通过、最后在 writing 阶段才炸"未生成任何可用知识原子"
    extraValidation: (value) => [
      ...exactCoverage(value.coverage, 'point_ids', pointIds, '知识点覆盖不完整'),
      ...exactAtomAttribution(value.atoms, pointIds),
      ...(pointIds.length && !(Array.isArray(value.atoms) && value.atoms.length)
        ? [`本批 ${pointIds.length} 个知识点（${pointIds.join('、')}）却返回了 0 个可用原子，请为每个知识点至少生成一个符合 schema 的原子，并在 content.point_ids 中准确填写上述 point_id`]
        : [])
    ]
  });
}

function normalizeAtomBatch(value, summary, pointIds) {
  if (!value || typeof value !== 'object') return value;
  // MiniMax 偶尔直接返回 atom 数组。包回契约对象，避免有内容却被当成 0 个原子。
  if (Array.isArray(value)) {
    value = {
      atoms: value,
      coverage: { point_ids: pointIds, complete: true },
      schema_version: '1.1'
    };
  }
  value = Object.assign({}, value);
  value.atoms = (value.atoms || []).map((atom) => {
    if (!atom || typeof atom !== 'object') return atom;
    const normalized = Object.assign({}, atom);
    // Missing empty-list metadata is semantically neutral. A present wrong type and
    // model_confidence remain untouched so strict validation triggers targeted repair.
    if (!Object.hasOwn(normalized, 'validation_issues')) normalized.validation_issues = [];
    if (!Object.hasOwn(normalized, 'related_candidates')) normalized.related_candidates = [];
    return normalized;
  });
  const allowed = new Set(pointIds);
  const points = new Map((summary.key_points || []).map((point) => [point.point_id, point]));
  const evidence = new Map((summary.evidence || []).map((item) => [item.evidence_id, item]));
  const assigned = [];
  const covered = new Set();
  // v2.8.1: 统计归一化丢弃原因——旧实现静默丢弃，"未生成任何可用知识原子"无从查起
  const rawCount = Array.isArray(value.atoms) ? value.atoms.length : 0;
  let droppedMismatch = 0;
  let droppedNoPoint = 0;
  const unassigned = [];
  for (const atom of value.atoms || []) {
    const candidatePointIds = [
      ...(Array.isArray(atom?.content?.point_ids) ? atom.content.point_ids : []),
      atom?.content?.point_id,
      ...(Array.isArray(atom?.point_ids) ? atom.point_ids : []),
      atom?.point_id,
      ...(Array.isArray(atom?.source?.point_ids) ? atom.source.point_ids : []),
      atom?.source?.point_id
    ].filter(Boolean);
    const rawPointIds = [...new Set(candidatePointIds)];
    const matched = rawPointIds.filter((pointId) => allowed.has(pointId));
    if (rawPointIds.length && !matched.length) { droppedMismatch += 1; continue; }
    if (!matched.length) {
      unassigned.push(atom);
      continue;
    }
    assigned.push({ atom, pointIds: matched });
    matched.forEach((pointId) => covered.add(pointId));
  }

  // Never infer attribution from provider array order. Missing point_ids is a
  // contract error and receives the single bounded repair already provided by
  // requestWithContract. If repair still fails, the batch remains unresolved.
  droppedNoPoint = unassigned.length;

  const keptAtoms = assigned.map(({ atom, pointIds: attributedIds }) => {
    const attributedPoints = attributedIds.map((pointId) => points.get(pointId)).filter(Boolean);
    const evidenceItems = attributedPoints.flatMap((point) => point.evidence_ids || [])
      .map((id) => evidence.get(id)).filter(Boolean);
    const evidenceItem = evidenceItems[0] || {};
    return Object.assign({}, atom, {
      content: Object.assign({}, atom.content || {}, { point_ids: [...new Set(attributedIds)] }),
      source: Object.assign({}, atom.source || {}, {
        source_link: '[[source]]',
        source_locator: evidenceItem.locator || '',
        source_page: evidenceItem.source_page || evidenceItem.provenance?.page || '',
        source_provenance: evidenceItem.provenance || null,
        locator_precision: evidenceItem.locator_precision || evidenceItem.provenance?.precision || '',
        evidence_quote: evidenceItem.quote || '',
        evidence_ids: evidenceItems.map((item) => item.evidence_id).filter(Boolean),
        parent_summary: '[[summary]]'
      })
    });
  });
  // v2.8.1: AI 返回了原子但被归一化丢光时，必须留下可追查的诊断
  if (rawCount > 0 && (droppedMismatch || droppedNoPoint || !keptAtoms.length)) {
    diag('atomization.normalize', {
      requestedPoints: pointIds.length,
      rawAtoms: rawCount,
      keptAtoms: keptAtoms.length,
      droppedPointIdMismatch: droppedMismatch,
      retainedOneToMany: Math.max(0, keptAtoms.length - covered.size),
      droppedNoPointAttribution: droppedNoPoint
    });
  }
  return Object.assign({}, value, { atoms: keptAtoms });
}

async function requestWithContract(options) {
  const maxRepairs = options.maxRepairAttempts === undefined ? 1 : Math.max(0, Number(options.maxRepairAttempts));
  const useStream = options.streaming === true && typeof options.requestStream === 'function';
  let prompt = options.prompt;
  let lastErrors = [];
  for (let attempt = 0; attempt <= maxRepairs; attempt += 1) {
    await emitProgress(options.onProgress, Object.assign({}, options.context || {}, {
      stage: options.stage,
      attempt: attempt + 1,
      message: attempt ? '正在修正不符合契约的 AI 结果' : (useStream ? '正在调用 MiniMax M3 (SSE)' : '正在调用 MiniMax M3')
    }));
    let rawValue;
    let value;
    try {
      if (useStream && attempt === 0) {
        // 第一次尝试走 SSE 流式；失败则降级到非流式
        try {
          rawValue = await options.requestStream(prompt, Object.assign({ stage: options.stage, attempt: attempt + 1, schema: options.schema }, options.context || {}), {
            onDelta: (event, state) => {
              if (typeof options.onStreamDelta === 'function') {
                try { options.onStreamDelta(event, state); } catch (_) {}
              }
            },
            onProgressText: (text) => {
              if (typeof options.onStreamText === 'function') {
                try { options.onStreamText(text); } catch (_) {}
              }
            }
          });
        } catch (streamError) {
          diag('minimax.stream-fallback', { stage: options.stage, errorMessage: String(streamError && streamError.message || streamError) });
          rawValue = await options.requestJson(prompt, Object.assign({ stage: options.stage, attempt: attempt + 1, schema: options.schema }, options.context || {}));
        }
      } else {
        rawValue = await options.requestJson(prompt, Object.assign({ stage: options.stage, attempt: attempt + 1, schema: options.schema }, options.context || {}));
      }
      value = parseJsonPayload(rawValue);
    } catch (error) {
      if (error?.code !== 'AI_INVALID_JSON') throw error;
      lastErrors = [error.message];
      if (attempt < maxRepairs) {
        prompt = buildRepairPrompt(options.prompt, lastErrors, rawValue);
        continue;
      }
      break;
    }
    if (typeof options.normalizeValue === 'function') value = options.normalizeValue(value);
    value = applySchemaConstants(options.schema, value);
    if (value && typeof value === 'object' && Array.isArray(value.evidence)) {
      var fbLocator = value.document_title || '文档内容';
      value.evidence = value.evidence.map(function(item, index) {
        if (!item || typeof item !== 'object') return item;
        return Object.assign({}, item, {
          evidence_id: item.evidence_id || ('evidence-' + (index + 1)),
          locator: item.locator || fbLocator,
          quote: item.quote || fbLocator
        });
      });
    }
    const validation = validateSchema(options.schema, value);
    lastErrors = [...validation.errors, ...(options.extraValidation ? options.extraValidation(value) : [])];
    if (!lastErrors.length) return value;
    if (attempt < maxRepairs) {
      prompt = buildRepairPrompt(options.prompt, lastErrors, value);
    }
  }
  if (typeof options.finalSanitize === 'function' && typeof value !== 'undefined') {
    const sanitized = options.finalSanitize(value, lastErrors);
    const validation = validateSchema(options.schema, sanitized);
    const remaining = [
      ...validation.errors,
      ...(options.extraValidation ? options.extraValidation(sanitized) : [])
    ];
    if (!remaining.length) {
      diag('provider.contractRepair.sanitized', {
        stage: options.stage,
        providerAttempts: maxRepairs + 1,
        validationErrorsBeforeSanitize: lastErrors.length
      });
      return sanitized;
    }
    lastErrors = remaining;
  }
  const error = new Error(lastErrors.join('；') || `${options.stage} 结果不符合契约`);
  error.code = 'AI_SCHEMA_OUTPUT_INVALID';
  error.stage = options.stage;
  error.validationErrors = lastErrors.slice();
  throw error;
}

function buildRepairPrompt(originalPrompt, errors, previousValue) {
  // v2.9.1: 定长截断走 safeSlice——切断的代理对进入修复 prompt 会干扰 AI 输出
  const previous = typeof previousValue === 'string'
    ? safeSlice(previousValue, 0, 12000)
    : JSON.stringify(previousValue, null, 2);
  return [
    originalPrompt,
    '上一次结果未通过校验，请只修正 JSON，不得改变原文事实。',
    `需要修正的问题：${errors.join('；')}`,
    '上一次结果：',
    previous || '未返回可解析内容，请重新输出完整 JSON。'
  ].join('\n\n');
}

function applySchemaConstants(schema, value) {
  if (!schema || typeof schema !== 'object') return value;
  if (Object.hasOwn(schema, 'const')) return schema.const;
  if (Array.isArray(value) && schema.items) {
    return value.map((item) => applySchemaConstants(schema.items, item));
  }
  if (value && typeof value === 'object' && !Array.isArray(value) && schema.properties) {
    const result = Object.assign({}, value);
    for (const [key, propertySchema] of Object.entries(schema.properties)) {
      if (Object.hasOwn(propertySchema || {}, 'const') || Object.hasOwn(result, key)) {
        result[key] = applySchemaConstants(propertySchema, result[key]);
      }
    }
    return result;
  }
  return value;
}

async function requestMiniMaxJson({ settings, prompt, fetchImpl, context, signal }) {
  if (!settings || !settings.minimaxApiKey) throw new Error('MiniMax 国内版 API Key 未配置');
  const fetcher = fetchImpl || globalThis.fetch;
  const endpoint = settings.minimaxEndpoint || 'https://api.minimaxi.com/anthropic/v1/messages';
  const anthropicProtocol = /\/anthropic\/v1\/messages\/?$/i.test(endpoint);
  if (typeof fetcher !== 'function') throw new Error('当前环境不支持网络请求');
  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  const timeoutMs = Math.max(10000, Number(settings.aiRequestTimeoutMs) || 180000);
  const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
  const abortFromCaller = () => controller?.abort();
  if (signal) signal.addEventListener('abort', abortFromCaller, { once: true });
  let response;
  try {
    const body = {
      model: settings.minimaxModel || 'MiniMax-M3',
      messages: [
        { role: 'system', content: '你是工程知识处理引擎。严格返回 JSON，不要输出 Markdown 代码围栏。' },
        { role: 'user', content: prompt }
      ],
      max_completion_tokens: 2048,
      reasoning_split: true,
      temperature: context && context.stage === 'classification' ? 0.1 : 0.2
    };
    if (context?.schema) {
      body.tools = [{
        type: 'function',
        function: {
          name: 'return_structured_result',
          description: '返回严格符合参数 Schema 的工程知识处理结果。',
          parameters: context.schema
        }
      }];
      body.tool_choice = 'auto';
    }
    let headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${settings.minimaxApiKey}` };
    if (anthropicProtocol) {
      body.max_tokens = 8192;
      delete body.max_completion_tokens;
      delete body.reasoning_split;
      body.system = '你是工程知识处理引擎。只通过指定工具返回结构化结果，不要输出额外说明。';
      body.messages = [{ role: 'user', content: prompt }];
      if (context?.schema) {
        body.tools = [{
          name: 'return_structured_result',
          description: '返回严格符合输入 Schema 的工程知识处理结果。',
          input_schema: context.schema
        }];
        body.tool_choice = { type: 'tool', name: 'return_structured_result' };
      }
      headers = { 'Content-Type': 'application/json', 'x-api-key': settings.minimaxApiKey, 'anthropic-version': '2023-06-01' };
    }
    response = await fetchWithTransientRetry(fetcher, endpoint, {
      method: 'POST',
      headers,
      signal: controller ? controller.signal : undefined,
      body: JSON.stringify(body)
    }, settings);
  } catch (error) {
    if (error && error.name === 'AbortError') {
      if (signal?.aborted) throw abortError();
      diag('minimax.timeout', { endpoint, timeoutMs, stage: context && context.stage });
      throw new Error(`MiniMax 国内版请求超时（${Math.round(timeoutMs / 1000)} 秒）`);
    }
    diag('minimax.transport', {
      endpoint,
      stage: context && context.stage,
      errorClass: error && error.constructor ? error.constructor.name : typeof error,
      errorMessage: String(error && error.message || error)
    });
    throw new Error(`MiniMax 国内版请求失败：${sanitizeError(error)}`);
  } finally {
    if (timer) clearTimeout(timer);
    if (signal) signal.removeEventListener('abort', abortFromCaller);
  }
  if (!response.ok) {
    const detail = await safeResponseText(response);
    diag('minimax.http', {
      endpoint,
      stage: context && context.stage,
      status: response.status,
      bodySnippet: String(detail || '').slice(0, 500)
    });
    throw new Error(`MiniMax 国内版请求失败（HTTP ${response.status}）${detail ? `：${detail}` : ''}`);
  }
  const payload = await response.json();
  if (anthropicProtocol) {
    if (payload?.stop_reason === 'max_tokens') {
      throw outputTruncatedError('MiniMax 输出达到 8192 token 上限，结果已截断。');
    }
    const toolUse = (payload?.content || []).find((item) => item?.type === 'tool_use' && item?.name === 'return_structured_result');
    const text = (payload?.content || []).filter((item) => item?.type === 'text').map((item) => item.text || '').join('\n');
    const content = toolUse?.input || text;
    if (!content) throw new Error('MiniMax 国内版返回内容为空');
    return parseJsonPayload(content);
  }
  const choice = payload && payload.choices && payload.choices[0];
  if (choice?.finish_reason === 'length' || choice?.finish_reason === 'max_output') {
    throw outputTruncatedError('MiniMax 输出达到 2048 token 上限，结果已截断；请缩小单批知识点数量后重试。');
  }
  const toolCall = choice?.message?.tool_calls?.find((item) => item?.function?.name === 'return_structured_result');
  const content = toolCall?.function?.arguments || (choice && choice.message && choice.message.content);
  if (!content) throw new Error('MiniMax 国内版返回内容为空');
  return parseJsonPayload(content);
}

/**
 * v2.2 (PR 4) SSE 流式请求 POC
 *
 * 用 globalThis.fetch 的 ReadableStream 读取 text/event-stream，
 * 把 data: {json} 事件按 \n\n 切分，逐条 JSON.parse 后回调 onDelta。
 *
 * ⚠️ 限制：
 * - Obsidian 的 `requestUrl` 不暴露 stream，所以这里走 globalThis.fetch
 *   （Obsidian 桌面端是 Electron / Chromium 27+，fetch + ReadableStream 都有）
 * - iOS 移动端 fetch 也支持，但 ReadableStream 行为可能差异更大
 * - 失败时不重试（与 fetchWithTransientRetry 行为不同），调用方需自己 try/catch
 */
async function sseJsonRequest(url, init, onDelta) {
  const response = await globalThis.fetch(url, init);
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`SSE 请求失败（HTTP ${response.status}）${text ? `：${text.slice(0, 200)}` : ''}`);
  }
  if (!response.body || typeof response.body.getReader !== 'function') {
    throw new Error('当前环境不支持 ReadableStream，无法使用 SSE 流式');
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';
  let eventCount = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let sepIndex;
    while ((sepIndex = buffer.indexOf('\n\n')) >= 0) {
      const block = buffer.slice(0, sepIndex);
      buffer = buffer.slice(sepIndex + 2);
      const event = parseSseEvent(block);
      if (!event) continue;
      eventCount += 1;
      if (typeof onDelta === 'function') onDelta(event);
      if (event.type === 'message_stop' || event.type === 'done' || event.type === 'response.done') {
        try { await reader.cancel(); } catch (_) {}
        return { ok: true, events: eventCount };
      }
    }
  }
  return { ok: true, events: eventCount };
}

function parseSseEvent(block) {
  const lines = block.split('\n');
  let eventName = 'message';
  const dataLines = [];
  for (const line of lines) {
    if (!line || line.startsWith(':')) continue;
    if (line.startsWith('event:')) eventName = line.slice(6).trim();
    else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim());
  }
  if (!dataLines.length) return null;
  const dataStr = dataLines.join('\n');
  if (dataStr === '[DONE]') return { type: 'done', raw: dataStr };
  let data;
  try { data = JSON.parse(dataStr); } catch (_) { return { type: eventName, raw: dataStr }; }
  return Object.assign({ type: eventName }, data);
}

/**
 * 累积 Anthropic-style content_block_delta 事件里的 text 增量，
 * 以及 tool_use block 里的 input_json_delta（拼成完整 JSON 字符串）。
 */
function collectSseTextDeltas(event, state) {
  if (!event) return;
  // Anthropic Messages API SSE
  if (event.type === 'content_block_start' && event.content_block && event.content_block.type === 'tool_use') {
    state.toolUseId = event.content_block.id;
    state.toolInputJson = '';
  }
  if (event.type === 'content_block_delta' && event.delta) {
    if (event.delta.type === 'text_delta' && typeof event.delta.text === 'string') {
      state.text += event.delta.text;
    } else if (event.delta.type === 'input_json_delta' && typeof event.delta.partial_json === 'string') {
      state.toolInputJson += event.delta.partial_json;
    }
  }
}

/**
 * v2.2 (PR 4) MiniMax 流式变体
 * 与 requestMiniMaxJson 等价的请求体，但启用 stream:true 并通过 SSE 累积返回。
 * 返回字符串（与 requestMiniMaxJson 的 parseJsonPayload 输入等价）。
 */
async function requestMiniMaxStream({ settings, prompt, context, signal, onDelta, onProgressText }) {
  if (!settings || !settings.minimaxApiKey) throw new Error('MiniMax 国内版 API Key 未配置');
  const endpoint = settings.minimaxEndpoint || 'https://api.minimaxi.com/anthropic/v1/messages';
  const anthropicProtocol = /\/anthropic\/v1\/messages\/?$/i.test(endpoint);
  const body = {
    model: settings.minimaxModel || 'MiniMax-M3',
    messages: anthropicProtocol
      ? [{ role: 'user', content: prompt }]
      : [{ role: 'system', content: '你是工程知识处理引擎。严格返回 JSON，不要输出 Markdown 代码围栏。' },
         { role: 'user', content: prompt }],
    max_completion_tokens: 2048,
    reasoning_split: true,
    temperature: context && context.stage === 'classification' ? 0.1 : 0.2,
    stream: true
  };
  if (anthropicProtocol) {
    body.max_tokens = 8192;
    delete body.max_completion_tokens;
    delete body.reasoning_split;
    body.system = '你是工程知识处理引擎。只通过指定工具返回结构化结果，不要输出额外说明。';
  }
  let headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${settings.minimaxApiKey}` };
  if (context?.schema) {
    body.tools = anthropicProtocol
      ? [{ name: 'return_structured_result', description: '返回严格符合输入 Schema 的工程知识处理结果。', input_schema: context.schema }]
      : [{ type: 'function', function: { name: 'return_structured_result', description: '返回严格符合参数 Schema 的工程知识处理结果。', parameters: context.schema } }];
    body.tool_choice = anthropicProtocol ? { type: 'tool', name: 'return_structured_result' } : 'auto';
  }
  if (anthropicProtocol) {
    headers = { 'Content-Type': 'application/json', 'x-api-key': settings.minimaxApiKey, 'anthropic-version': '2023-06-01' };
  }
  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  const timeoutMs = Math.max(10000, Number(settings.aiRequestTimeoutMs) || 180000);
  const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
  const abortFromCaller = () => controller?.abort();
  if (signal) signal.addEventListener('abort', abortFromCaller, { once: true });
  try {
    const state = { text: '', toolInputJson: '' };
    await sseJsonRequest(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: controller ? controller.signal : undefined
    }, (event) => {
      collectSseTextDeltas(event, state);
      if (typeof onDelta === 'function') onDelta(event, state);
      // 透传进度文本（每 30 字符报告一次，避免 onProgress 风暴）
      if (typeof onProgressText === 'function' && state.text.length % 30 < 2) {
        onProgressText(state.text);
      }
    });
    const finalContent = state.toolInputJson || state.text;
    if (!finalContent) throw new Error('MiniMax 流式返回内容为空');
    return finalContent;
  } catch (error) {
    if (error && error.name === 'AbortError') {
      if (signal?.aborted) throw abortError();
      throw new Error(`MiniMax 流式请求超时（${Math.round(timeoutMs / 1000)} 秒）`);
    }
    throw error;
  } finally {
    if (timer) clearTimeout(timer);
    if (signal) signal.removeEventListener('abort', abortFromCaller);
  }
}

function exactCoverage(coverage, key, expected, message) {
  if (!coverage || coverage.complete !== true) return [message];
  const actual = Array.isArray(coverage[key]) ? coverage[key] : [];
  const left = [...new Set(actual)].sort();
  const right = [...new Set(expected)].sort();
  return left.length === right.length && left.every((item, index) => item === right[index]) ? [] : [message];
}

function outputTruncatedError(message) {
  const error = new Error(message);
  error.code = 'AI_OUTPUT_TRUNCATED';
  return error;
}

async function fetchWithTransientRetry(fetcher, endpoint, options, settings) {
  const configuredAttempts = Number(settings?.aiRequestMaxAttempts);
  const maxAttempts = Number.isFinite(configuredAttempts)
    ? Math.min(5, Math.max(1, Math.round(configuredAttempts)))
    : 3;
  const configuredBaseMs = Number(settings?.aiRetryBaseMs);
  const baseMs = Number.isFinite(configuredBaseMs) ? Math.max(0, configuredBaseMs) : 800;
  let lastError;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    let retryAfterMs = 0;
    let retryStatus = 0;
    try {
      diag('outbound.request', { provider: 'minimax', attempt, maxAttempts });
      const response = await fetcher(endpoint, options);
      if (response.ok || !isTransientHttpStatus(response.status) || attempt === maxAttempts) return response;
      retryStatus = Number(response.status) || 0;
      retryAfterMs = parseRetryAfterMs(response.headers?.get?.('retry-after'));
      await safeResponseText(response);
    } catch (error) {
      if (error?.name === 'AbortError' || attempt === maxAttempts) throw error;
      lastError = error;
    }
    const exponentialMs = Math.min(30_000, baseMs * (2 ** (attempt - 1)));
    const jitterMs = Math.round(exponentialMs * (0.85 + Math.random() * 0.3));
    const backoffMs = Math.max(retryAfterMs, jitterMs);
    diag('outbound.retry', {
      provider: 'minimax', attempt, nextAttempt: attempt + 1, status: retryStatus,
      rateLimited: retryStatus === 429 || retryStatus === 529, retryAfterMs, backoffMs
    });
    await sleep(backoffMs, options.signal);
  }

  throw lastError || new Error('MiniMax request failed after retries');
}

function isTransientHttpStatus(status) {
  // v2.8.1: 加入 529——Anthropic 协议（MiniMax 国内版兼容接口）的 overloaded_error，
  //   纯服务端过载、稍后即恢复。旧版不重试 529，用户一次 529 就废掉整个已跑 9 分钟的任务。
  return [408, 425, 429, 500, 502, 503, 504, 529].includes(Number(status));
}

function parseRetryAfterMs(value) {
  if (value === undefined || value === null || value === '') return 0;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, Math.round(seconds * 1000));
  const date = Date.parse(String(value));
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : 0;
}

function sleep(ms, signal) {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(Object.assign(new Error('任务已取消'), { name: 'AbortError', code: 'TASK_CANCELLED' }));
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(timer);
      reject(Object.assign(new Error('任务已取消'), { name: 'AbortError', code: 'TASK_CANCELLED' }));
    }, { once: true });
  });
}

function parseJsonPayload(value) {
  if (value && typeof value === 'object') return unwrapTextJson(value);
  let text = String(value || '').trim().replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
  text = text.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
  try { return JSON.parse(text); } catch {}
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start >= 0 && end > start) {
    const sliced = text.slice(start, end + 1).replace(/,\s*([}\]])/g, '$1');
    try { return JSON.parse(sliced); } catch {}
    // 兜底：尝试补全未闭合的括号/引号
    const repaired = repairJsonText(sliced);
    if (repaired) {
      try { return JSON.parse(repaired); } catch {}
    }
  }
  // 外层对象截断时，lastIndexOf('}') 可能只命中内部对象；此前 slice 会把
  // 未闭合的 atoms/coverage 尾部直接丢掉。对从首个 { 到响应末尾的文本再修一次。
  if (start >= 0) {
    const repaired = repairJsonText(text.slice(start));
    if (repaired) {
      try { return JSON.parse(repaired); } catch {}
    }
  }
  const error = new Error('AI 返回内容不是有效 JSON');
  error.code = 'AI_INVALID_JSON';
  throw error;
}

/**
 * v2.4: AI 输出截断时尝试补全 JSON。
 * - 去掉尾部逗号
 * - 补全未闭合的字符串 / 数组 / 对象
 * 返回补全后的文本；仍不可解析则返回 null。
 */
function repairJsonText(text) {
  if (!text || typeof text !== 'string') return null;
  let s = text.replace(/,\s*$/, '');
  // 在 escape 状态外，记录最后未闭合的引号
  let inString = false;
  let escape = false;
  const stack = []; // 期望闭合的括号，'[' 或 '{'
  for (let i = 0; i < s.length; i += 1) {
    const ch = s[i];
    if (escape) { escape = false; continue; }
    if (ch === '\\') { escape = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === '{' || ch === '[') stack.push(ch === '{' ? '}' : ']');
    else if (ch === '}' || ch === ']') stack.pop();
  }
  // 收尾
  if (inString) s += '"';
  while (stack.length) {
    const closer = stack.pop();
    s += closer;
  }
  // 二次去尾随逗号
  s = s.replace(/,\s*([}\]])/g, '$1').replace(/,\s*$/, '');
  try { JSON.parse(s); return s; } catch { return null }
}

function unwrapTextJson(value) {
  if (Array.isArray(value)) return value.map(unwrapTextJson);
  if (!value || typeof value !== 'object') return value;
  const result = {};
  if (typeof value.$text === 'string') {
    try {
      const parsed = parseJsonPayload(value.$text);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) Object.assign(result, parsed);
    } catch {}
  }
  for (const [key, item] of Object.entries(value)) {
    if (key === '$text') continue;
    result[key] = unwrapTextJson(item);
  }
  return Object.keys(result).length ? result : value;
}

async function safeResponseText(response) {
  try { return String(await response.text()).replace(/\s+/g, ' ').slice(0, 300); } catch { return ''; }
}

function sanitizeError(error) {
  return String(error && error.message ? error.message : error || '未知错误').replace(/(bearer|token|api[_ -]?key)\s*[:=]?\s*\S+/gi, '$1 ***');
}

async function emitProgress(onProgress, payload) {
  if (typeof onProgress === 'function') await onProgress(payload);
}

module.exports = {
  atomizeSummary,
  buildClassificationPrompt,
  classifyDocument,
  composePrompt,
  classificationSample,
  coalesceTinyChunks,
  commonBreadcrumbPrefix,
  findProtectedSpans,
  findRoute,
  normalizeAtomBatch,
  normalizeSummaryReduce,
  parseJsonPayload,
  parseRetryAfterMs,
  profileMarkdown,
  repairJsonText,
  requestMiniMaxJson,
  requestMiniMaxStream,
  requestWithContract,
  reconcileBlockEvidence,
  safeSlice,
  sanitizeSummaryEvidence,
  summarySchemaWithRuntimeProvenance,
  summarySourceBlocks,
  splitByHeadings,
  splitMarkdownSections,
  validateAtomizationResult,
  summarizeDocument,
  validateChunks
};

},
/**
 * @module src/core/confidence
 * 卡片置信度评分：基于 schema 合规度 / AI 不确定性 / 字段完整度
 * @exports calculateConfidence
 */
"src/core/confidence.js": function(require, module, exports) {
const WEIGHTS = { P: 0.25, T: 0.15, E: 0.35, S: 0.15, A: 0.10 };

function calculateConfidence(input) {
  const hardRules = [];
  const parseMarkdown = normalizeText(input.parsePackage && input.parsePackage.markdown);
  const source = input.atom && input.atom.source ? input.atom.source : {};
  const evidenceQuote = normalizeText(source.evidence_quote);
  const atomText = normalizeText(`${input.atom && input.atom.title || ''} ${flattenContent(input.atom && input.atom.content)}`);

  const P = clamp(input.parsePackage && input.parsePackage.quality && input.parsePackage.quality.score);
  const alternative = Math.max(0, ...((input.classification && input.classification.alternatives) || []).map((item) => Number(item.model_confidence) || 0));
  const modelTypeScore = clamp(input.classification && input.classification.model_confidence);
  const margin = clamp(modelTypeScore - alternative);
  const T = clamp(0.65 * modelTypeScore + 0.2 * (input.routeValid ? 1 : 0) + 0.15 * margin);

  const hasSourceLink = Boolean(String(source.source_link || '').trim());
  const hasLocator = Boolean(String(source.source_locator || '').trim());
  const hasParent = Boolean(String(source.parent_summary || '').trim());
  const provenanceVerified = source.provenance_verified !== false;
  const quoteFound = Boolean(evidenceQuote) && provenanceVerified && parseMarkdown.includes(evidenceQuote);
  // Facts are card-scoped: a value elsewhere in the document (another block,
  // table row or email message) is not evidence for this card.  The aligned
  // verbatim quote is the only default fact scope; callers may provide an
  // explicitly bound same-block span after provenance verification.
  const boundEvidence = normalizeText(source.bound_evidence_text || evidenceQuote);
  const factConsistency = evidenceConsistency(atomText, boundEvidence);
  const numbersGrounded = factConsistency.ok;
  const E = clamp((hasLocator ? 0.2 : 0) + (hasSourceLink ? 0.1 : 0) + (hasParent ? 0.1 : 0) + (quoteFound ? 0.4 : 0) + (numbersGrounded ? 0.2 : 0));

  const S = clamp((input.schemaValid ? 0.4 : 0) + (input.routeValid ? 0.3 : 0) + (input.labelsValid ? 0.3 : 0));
  const meaningful = atomText.length >= 12 && !isVague(atomText);
  const A = clamp((meaningful ? 0.6 : 0) + (!input.duplicate ? 0.4 : 0));
  const components = { P, T, E, S, A };
  let score = Object.entries(WEIGHTS).reduce((sum, [key, weight]) => sum + components[key] * weight, 0);

  if (P < 0.7) hardRules.push('解析质量低于 0.70，必须重新解析');
  if (!hasSourceLink) hardRules.push('缺少源文件链接');
  if (!hasLocator) hardRules.push('缺少原文定位');
  if (!evidenceQuote) hardRules.push('缺少逐字证据');
  if (!quoteFound) {
    hardRules.push('逐字证据无法在解析文本中定位');
    score = Math.min(score, 0.59);
  }
  if (!numbersGrounded) hardRules.push(...factConsistency.plainReasons);
  if (!input.schemaValid || !input.routeValid || !input.labelsValid) {
    hardRules.push('Schema、固定目录或标签字典校验未通过');
    score = Math.min(score, 0.69);
  }
  if (!meaningful) {
    hardRules.push('知识原子内容空泛或信息量不足');
    score = Math.min(score, 0.69);
  }
  if (input.duplicate) {
    hardRules.push('与已有知识卡片重复');
    score = Math.min(score, 0.69);
  }

  score = round(clamp(score));
  const rejected = P < 0.7 || !hasSourceLink || !hasLocator || !evidenceQuote || !numbersGrounded;
  const threshold = normalizeAutoApproveThreshold(input.autoApproveConfidenceThreshold);
  let decision;
  if (rejected) decision = 'reject';
  else if (score >= threshold && hardRules.length === 0) decision = 'auto_ingest';
  else if (score >= 0.7) decision = 'review';
  else decision = 'regenerate';

  return {
    score,
    decision,
    components: Object.fromEntries(Object.entries(components).map(([key, value]) => [key, round(value)])),
    weights: WEIGHTS,
    auto_approve_threshold: threshold,
    hard_rules: hardRules,
    material_differences: factConsistency
  };
}

function normalizeAutoApproveThreshold(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0.9;
  return Math.round(Math.max(0.7, Math.min(1, number)) * 1000) / 1000;
}

const FACT_UNITS = '(?:%|‰|mm|cm|km|m|m2|m3|m²|m³|pa|kpa|mpa|gpa|n|kn|kg|t|l|ml|℃|°c|元|万元|亿元|年|月|日|小时|分钟|秒)';
function extractedFacts(text) {
  const value = String(text || '').normalize('NFKC');
  const facts = [];
  const occupied = [];
  const datePattern = /\b((?:19|20)\d{2})\s*(?:[-/.年]\s*(\d{1,2})\s*(?:[-/.月]\s*(\d{1,2})\s*日?)?)?/giu;
  for (const match of value.matchAll(datePattern)) {
    const month = match[2] ? Number(match[2]) : 0;
    const day = match[3] ? Number(match[3]) : 0;
    facts.push({ kind: 'date', value: `${Number(match[1])}${month ? `-${String(month).padStart(2, '0')}` : ''}${day ? `-${String(day).padStart(2, '0')}` : ''}`, unit: '', raw: match[0] });
    occupied.push([match.index, match.index + match[0].length]);
  }
  const numericPattern = new RegExp(`[-+]?\\d+(?:[.,]\\d+)?\\s*${FACT_UNITS}?`, 'giu');
  for (const match of value.matchAll(numericPattern)) {
    if (occupied.some(([start, end]) => match.index >= start && match.index < end)) continue;
    const parts = match[0].trim().match(/^([-+]?\d+(?:[.,]\d+)?)\s*(.*)$/u);
    if (!parts) continue;
    facts.push({ kind: 'number', value: String(Number(parts[1].replace(/,/g, ''))), unit: normalizeUnit(parts[2]), raw: match[0] });
  }
  return facts.filter((fact, index, all) =>
    all.findIndex((candidate) => candidate.kind === fact.kind && candidate.value === fact.value && candidate.unit === fact.unit) === index);
}

function normalizeUnit(unit) {
  const value = String(unit || '').normalize('NFKC').toLowerCase().replace(/\s+/g, '');
  return ({ '°c': '℃', m2: 'm²', m3: 'm³', '毫升': 'ml', '升': 'l' })[value] || value;
}

function compareFacts(statementFacts, evidenceFacts) {
  if (!statementFacts.length && !evidenceFacts.length) return { status: 'not_applicable', blocking: false, differences: [] };
  const differences = [];
  for (const fact of statementFacts) {
    if (evidenceFacts.some((candidate) => candidate.kind === fact.kind && candidate.value === fact.value && candidate.unit === fact.unit)) continue;
    const sameValue = evidenceFacts.filter((candidate) => candidate.kind === fact.kind && candidate.value === fact.value);
    if (sameValue.length) {
      const evidenceUnits = [...new Set(sameValue.map((candidate) => candidate.unit))];
      const status = !fact.unit || evidenceUnits.includes('') ? 'missing_in_evidence' : 'ambiguous_conversion';
      differences.push({ status, claim: fact.raw, evidence: sameValue.map((candidate) => candidate.raw) });
      continue;
    }
    const sameKind = evidenceFacts.filter((candidate) => candidate.kind === fact.kind);
    differences.push({ status: sameKind.length ? 'conflict' : 'unsupported_addition', claim: fact.raw, evidence: sameKind.map((candidate) => candidate.raw) });
  }
  if (!differences.length) return { status: 'matched', blocking: false, differences: [] };
  const priority = ['conflict', 'unsupported_addition', 'ambiguous_conversion', 'missing_in_evidence'];
  return { status: priority.find((status) => differences.some((item) => item.status === status)), blocking: true, differences };
}

function evidenceConsistency(statement, evidence) {
  const statementFacts = extractedFacts(statement);
  const evidenceFacts = extractedFacts(evidence);
  const facts = compareFacts(statementFacts, evidenceFacts);
  const materialClaims = explicitMaterialClaims(statement);
  const evidenceMaterials = explicitMaterialClaims(evidence);
  for (const claim of materialClaims) {
    if (normalizeText(evidence).toLowerCase().includes(claim.value.toLowerCase())) continue;
    facts.differences.push({
      status: evidenceMaterials.length ? 'material_conflict' : 'unsupported_material',
      claim: claim.raw,
      evidence: evidenceMaterials.map((item) => item.raw)
    });
  }
  if (facts.differences.some((item) => ['material_conflict', 'unsupported_material'].includes(item.status))) {
    facts.status = facts.differences.some((item) => item.status === 'material_conflict')
      ? 'material_conflict' : 'unsupported_material';
    facts.blocking = true;
  }
  const statementModality = explicitModality(statement);
  const evidenceModality = explicitModality(evidence);
  let modalityStatus = 'matched';
  if (statementModality !== evidenceModality) {
    modalityStatus = statementModality && !evidenceModality ? 'strengthened_obligation'
      : !statementModality && evidenceModality ? 'weakened_obligation' : 'changed_obligation';
  }
  const conditions = conditionTokens(statement);
  const evidenceConditions = conditionTokens(evidence);
  const addedConditions = conditions.filter((token) => !evidenceConditions.includes(token));
  const removedConditions = evidenceConditions.filter((token) => !conditions.includes(token));
  const conditionStatus = addedConditions.length ? 'invented_condition'
    : removedConditions.length ? 'removed_condition_or_exception' : 'matched';
  const plainReasons = [];
  const factLabels = {
    conflict: '生成内容中的数字或日期与原文冲突',
    unsupported_addition: '生成内容增加了原文没有的数字或日期',
    missing_in_evidence: '原文依据缺少核验该数值所需的单位',
    ambiguous_conversion: '生成内容与原文的单位换算关系不明确'
    ,material_conflict: '生成内容中的材料、产品或型号与原文冲突'
    ,unsupported_material: '生成内容增加了原文没有的材料、产品或型号'
  };
  if (facts.blocking) plainReasons.push(factLabels[facts.status]);
  if (modalityStatus === 'strengthened_obligation') plainReasons.push('生成内容把原文加强为强制要求');
  if (modalityStatus === 'weakened_obligation') plainReasons.push('生成内容弱化了原文的强制要求');
  if (modalityStatus === 'changed_obligation') plainReasons.push('生成内容改变了原文的义务强度');
  if (conditionStatus === 'invented_condition') plainReasons.push('生成内容增加了原文没有的适用条件');
  if (conditionStatus === 'removed_condition_or_exception') plainReasons.push('生成内容删除了原文的条件或例外');
  return {
    ok: plainReasons.length === 0,
    status: facts.status,
    failures: plainReasons,
    plainReasons,
    factComparison: facts,
    statementFacts,
    evidenceFacts,
    modality: { status: modalityStatus, statement: statementModality || 'none', evidence: evidenceModality || 'none' },
    conditions: { status: conditionStatus, statement: conditions, evidence: evidenceConditions }
  };
}

function explicitMaterialClaims(value) {
  const original = String(value || '');
  const source = original.normalize('NFKC');
  const output = [];
  const pattern = /(?:材料|材质|产品|型号|饰面|面层)\s*[:：=为]\s*([^；;，,\n]{1,80})/giu;
  for (const match of source.matchAll(pattern)) {
    const material = normalizeText(match[1]).replace(/[。.]$/, '');
    if (material) output.push({ value: material, raw: original.slice(match.index, match.index + match[0].length) });
  }
  return output.filter((item, index, all) =>
    all.findIndex((candidate) => candidate.value.toLowerCase() === item.value.toLowerCase()) === index);
}

function explicitModality(text) {
  const value = String(text || '').toLowerCase();
  if (/不得|禁止|严禁|must not|shall not|may not|prohibited/u.test(value)) return 'prohibited';
  if (/必须|务必|须|应当|应予|must|shall|required/u.test(value)) return 'must';
  if (/可以|允许|可选择|may|optional|permitted/u.test(value)) return 'may';
  return '';
}

function conditionTokens(text) {
  return (String(text || '').normalize('NFKC').match(
    /(?:如果|若|当|除非|仅当|只在|不超过|不少于|大于|小于|if|when|unless|except|only if|provided that)[^。！？!?;；]{0,100}/giu
  ) || []).map((value) => normalizeText(value).toLowerCase());
}

function flattenContent(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  if (Array.isArray(value)) return value.map(flattenContent).join(' ');
  if (typeof value === 'object') {
    return Object.entries(value)
      .filter(([key]) => key !== 'id' && !/_ids?$/.test(key))
      .map(([, item]) => flattenContent(item))
      .join(' ');
  }
  return '';
}

function isVague(text) {
  return /^(召开|开展|推进|优化|加强|提升|讨论|研究).{0,20}(会议|工作|管理|效率|方案)?[。.]?$/.test(String(text || '').trim());
}

function normalizeText(value) {
  return String(value || '').normalize('NFKC').replace(/\s+/g, ' ').trim();
}

function clamp(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.max(0, Math.min(1, number));
}

function round(value) {
  return Math.round(value * 1000) / 1000;
}

module.exports = { WEIGHTS, calculateConfidence, evidenceConsistency, extractedFacts, normalizeAutoApproveThreshold };

},
/**
 * @module src/core/markdown-renderer
 * 知识卡片 Markdown 渲染：buildCardRecord / renderKnowledgeCard / renderStructuredSummary
 * 含 YAML frontmatter / 章节拼接 / 空字段容错
 * @exports buildCardRecord
 * @exports cardFileName
 * @exports renderKnowledgeCard
 * @exports renderStructuredSummary
 */
"src/core/markdown-renderer.js": function(require, module, exports) {
const { atomFingerprint, cardIdentity } = require("src/core/identity.js");
const { formatBusinessDate } = require("src/core/time-policy.js");

function buildCardRecord(options) {
  const atom = options.atom;
  const fingerprint = atomFingerprint(atom);
  const cardId = cardIdentity(options.library, options.sourceHash, fingerprint);
  const suppliedNow = options.now === undefined || options.now === null || options.now === ''
    ? (typeof options.clock === 'function' ? options.clock() : new Date())
    : options.now;
  const businessDate = formatBusinessDate(suppliedNow, { timeZone: options.businessTimeZone });
  const related = (atom.related_candidates || []).map((item) => typeof item === 'string' ? item : item.target).filter(Boolean);
  const relations = (atom.related_candidates || []).filter((item) => item && typeof item === 'object' && item.target).map((item) => ({
    target: item.target,
    relation: item.relation || 'related'
  }));
  const tags = [...new Set([atom.Category, atom.TagL1, atom.TagL2].filter(Boolean))];
  const sourceLink = String(atom.source && atom.source.source_link || '');
  const sourceFile = sourceLink.replace(/^\[\[/, '').replace(/\]\]$/, '').split('/').pop();
  const card = {
    title: atom.title,
    card_id: cardId,
    atom_fingerprint: fingerprint,
    card_kind: atom.card_kind,
    library: atom.library,
    folder_type: atom.folder_type,
    output_folder: options.route.output_folder,
    status: 'confirmed',
    source_file: sourceFile,
    source_link: sourceLink,
    source_hash: options.sourceHash,
    source_page: atom.source && atom.source.source_page || '',
    source_locator: atom.source && atom.source.source_locator || '',
    source_provenance: atom.source && atom.source.source_provenance || null,
    locator_precision: atom.source && atom.source.locator_precision || '',
    evidence_quote: atom.source && atom.source.evidence_quote || '',
    parent_summary: atom.source && atom.source.parent_summary || '',
    related,
    relations,
    aliases: [],
    tags,
    confidence: options.confidence.score,
    confidence_components: options.confidence.components,
    schema_version: options.versions.schemaVersion,
    pipeline_version: options.versions.pipelineVersion,
    prompt_bundle_version: options.versions.promptBundleVersion,
    created: businessDate,
    updated: businessDate,
    content: atom.content || {}
  };
  for (const key of ['Info_Type', 'Event_Type', 'Category', 'TagL1', 'TagL2', 'project', 'client', 'stage']) {
    if (atom[key]) card[key] = atom[key];
  }
  if (options.supersedes) card.supersedes = options.supersedes;
  return card;
}

function renderKnowledgeCard(card, options = {}) {
  // Lazy compatibility: legacy ISO frontmatter remains readable in storage and is
  // normalized only in rendered business fields; no bulk/destructive rewrite occurs.
  const renderedCard = Object.assign({}, card, {
    created: formatBusinessDate(card.created, options),
    updated: formatBusinessDate(card.updated, options)
  });
  const frontmatterOrder = [
    'title', 'card_id', 'atom_fingerprint', 'card_kind', 'Info_Type', 'Event_Type', 'library', 'folder_type',
    'output_folder', 'project', 'client', 'stage', 'status', 'Category', 'TagL1', 'TagL2', 'created', 'updated',
    'source_file', 'source_link', 'source_hash', 'source_page', 'source_locator', 'source_provenance', 'locator_precision', 'parent_summary', 'supersedes', 'superseded_by',
    'related', 'aliases', 'tags', 'confidence', 'confidence_components', 'schema_version', 'pipeline_version', 'prompt_bundle_version'
  ];
  const lines = ['---'];
  for (const key of frontmatterOrder) {
    if (!hasValue(renderedCard[key]) && !['related', 'aliases', 'tags'].includes(key)) continue;
    lines.push(`${key}: ${yamlValue(renderedCard[key])}`);
  }
  lines.push('---', '', `# ${card.title}`, '');

  if (card.card_kind === 'event') renderEventBody(lines, card.content || {});
  else renderStaticBody(lines, card.content || {});

  optionalSection(lines, '来源证据', [
    `- 来源文件：${card.source_link}`,
    card.source_page ? `- 来源页：${card.source_page}` : '',
    `- 证据位置：${card.source_locator || card.source_page}`,
    card.locator_precision ? `- 定位精度：${card.locator_precision}` : '',
    `- 原文摘录：${card.evidence_quote}`
  ].filter(Boolean));
  optionalSection(lines, '关联知识', [
    `- 上游总结：${card.parent_summary}`,
    ...(Array.isArray(card.content && card.content.semantic_links) ? card.content.semantic_links : []).map((relation) => `- ${relation.relation || 'related'} ${relation.target || relation.target_card_id || ''}`),
    ...(Array.isArray(card.relations) ? card.relations : []).map((relation) => `- ${relation.relation || 'related'} ${relation.target}`),
    ...(Array.isArray(card.related) ? card.related : []).map((target) => `- related ${target}`)
  ]);
  return `${lines.join('\n').replace(/\n{3,}/g, '\n\n')}\n`;
}

function renderStaticBody(lines, content) {
  lines.push('## 核心知识', '', content.core_knowledge || content.statement || content.summary || '');
  optionalSection(lines, '适用条件与边界', content.applicable_conditions);
  optionalSection(lines, '关键参数、条款或方法', content.details);
}

function renderEventBody(lines, content) {
  lines.push('## 背景与触发', '', content.background || content.context || '');
  optionalSection(lines, '争议点或讨论问题', content.discussion);
  optionalSection(lines, '已确认方案或结论', content.confirmed_solution || content.decision);
  optionalSection(lines, '未决事项', content.unresolved_items);
  optionalSection(lines, '后续行动', content.action_items);
}

function optionalSection(lines, title, value) {
  if (!hasValue(value)) return;
  lines.push('', `## ${title}`, '', formatBody(value));
}

function formatBody(value) {
  if (Array.isArray(value)) return value.map((item) => `- ${typeof item === 'string' ? item : JSON.stringify(item)}`).join('\n');
  if (value && typeof value === 'object') return Object.entries(value).map(([key, item]) => `- ${key}：${formatBody(item)}`).join('\n');
  return String(value || '');
}

function cardFileName(card) {
  return `${String(card.card_id || 'card-unassigned').replace(/[^a-zA-Z0-9-]/g, '-')}.md`;
}

function renderStructuredSummary(summary, sourceLink) {
  const lines = [
    '---',
    `title: ${yamlValue(summary.document_title)}`,
    'artifact_type: "structured-summary"',
    `library: ${yamlValue(summary.library)}`,
    `folder_type: ${yamlValue(summary.folder_type)}`,
    `document_type: ${yamlValue(summary.document_type)}`,
    `source_link: ${yamlValue(sourceLink)}`,
    `schema_version: ${yamlValue(summary.schema_version)}`,
    '---', '', `# ${summary.document_title}`, '', '## 摘要', '', summary.executive_summary || '', '', '## 结构化要点', ''
  ];
  for (const point of summary.key_points || []) lines.push(`- **${point.kind || '要点'}** ${point.content} ^${point.point_id}`);
  lines.push('', '## 来源证据', '');
  for (const evidence of summary.evidence || []) lines.push(`- ${evidence.locator}：${evidence.quote} ^${evidence.evidence_id}`);
  lines.push('', '## 源文件', '', `- ${sourceLink}`);
  return `${lines.join('\n').replace(/\n{3,}/g, '\n\n')}\n`;
}

function yamlValue(value) {
  if (Array.isArray(value)) return JSON.stringify(value);
  if (value && typeof value === 'object') return JSON.stringify(value);
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return JSON.stringify(String(value === undefined || value === null ? '' : value));
}

function hasValue(value) {
  if (value === undefined || value === null || value === '') return false;
  if (Array.isArray(value)) return value.length > 0;
  return true;
}

module.exports = { buildCardRecord, cardFileName, renderKnowledgeCard, renderStructuredSummary, yamlValue };

},
/**
 * @module src/core/diagnostic-report
 * Bounded, redacted, troubleshooting-oriented failure reports.
 */
"src/core/diagnostic-report.js": function(require, module, exports) {
const crypto = require("crypto");

const REPORT_VERSION = '1.2';
const SCHEMA_VERSION = 'eks-diagnostic-report/1.2';
const MAX_JSON_BYTES = 64 * 1024;
const MAX_MARKDOWN_BYTES = 72 * 1024;
const SECRET_KEY = /^(?:sourcePath|artifactPath)$|(?:authorization|api[-_]?key|token|jwt|secret|password|cookie|prompt|source[_-]?(?:text|content|markdown)|body|response)/i;
const CREDENTIAL = /(Bearer\s+)[^\s,;]+|((?:sk|key|paddle|gh[pousxr])[-_])[A-Za-z0-9._-]{12,}|eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]+/gi;
const SENSITIVE_QUERY = /([?&](?:api_?key|access_?token|token|jwt|secret|signature)=)[^&#\s]+/gi;

function hash(value, length = 16) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex').slice(0, length);
}

function redactString(value) {
  let text = String(value || '').replace(CREDENTIAL, (_all, bearer, prefix) => bearer ? `${bearer}***` : `${prefix || ''}***`)
    .replace(SENSITIVE_QUERY, '$1***');
  text = text.replace(/(?:[A-Za-z]:)?[\\/](?:[^\\/\s]+[\\/]){2,}[^\\/\s]*/g, (match) => `<path:${hash(match)}>`);
  if (text.length > 500) text = `${text.slice(0, 460)}…<truncated:${text.length}>`;
  return text;
}

function redact(value, key = '', seen = new WeakSet()) {
  if (SECRET_KEY.test(key)) return '<redacted>';
  if (typeof value === 'string') return redactString(value);
  if (value === null || value === undefined || typeof value !== 'object') return value;
  if (seen.has(value)) return '[Circular]';
  seen.add(value);
  if (Array.isArray(value)) return value.slice(0, 100).map((item) => redact(item, '', seen));
  const output = {};
  for (const [childKey, childValue] of Object.entries(value)) {
    output[childKey] = redact(childValue, childKey, seen);
  }
  return output;
}

function safeSettings(settings = {}) {
  const keys = [
    'aiProvider', 'minimaxModel', 'aiChunkSize', 'aiMaxChunks', 'maxPointsPerRequest',
    'summaryConcurrency', 'atomizationConcurrency', 'aiRequestTimeoutMs', 'aiRequestMaxAttempts',
    'aiRetryBaseMs', 'rateLimitMs', 'rateLimitMaxConcurrent', 'rateLimitBackoffMaxMs',
    'useStreamingAi', 'useEnvKeys', 'targetLanguage', 'businessTimeZone', 'confirmUploads',
    'pdfExtractionOrder'
  ];
  return Object.fromEntries(keys.filter((key) => Object.hasOwn(settings, key)).map((key) => [key, settings[key]]));
}

function compactReason(value) {
  return redactString(String(value || 'unknown')).replace(/\s+/g, ' ').slice(0, 180);
}

function eventIdentity(event) {
  const data = event?.data || {};
  return data.stableBatchId || data.stableChunkId || data.stableReduceId || '';
}

function isRelevantEvent(event, input) {
  const data = event?.data || {};
  const task = input.task || {};
  const started = Date.parse(task.diagnostic_started_at || task.created_at || 0);
  const at = Date.parse(event?.at || 0);
  if (Number.isFinite(started) && Number.isFinite(at) && at < started - 1000) return false;
  if (data.taskId && task.task_id && data.taskId !== task.task_id) return false;
  if (data.runId && task.run_id && data.runId !== task.run_id) return false;
  return true;
}

function compactEvents(events = [], input = {}) {
  const safe = events.filter((event) => isRelevantEvent(event, input)).slice(-160).map((event) => ({
    at: event.at,
    code: String(event.scope || 'unknown'),
    data: redact(event.data || {})
  }));
  const output = [];
  for (let index = 0; index < safe.length; index += 1) {
    const first = safe[index];
    if (!/cacheHit$/.test(first.code)) {
      output.push(first);
      continue;
    }
    const ids = [];
    const indices = [];
    let end = index;
    while (end < safe.length && safe[end].code === first.code) {
      const id = eventIdentity(safe[end]);
      if (id) ids.push(id);
      const batchIndex = Number(safe[end].data?.batchIndex);
      if (Number.isInteger(batchIndex) && batchIndex > 0) indices.push(batchIndex);
      end += 1;
    }
    const count = end - index;
    output.push(count === 1 ? first : {
      at: first.at,
      endAt: safe[end - 1].at,
      code: `${first.code}.range`,
      count,
      ids: ids.slice(0, 40),
      indices: indices.slice(0, 120)
    });
    index = end - 1;
  }
  return output.slice(-80);
}

function workDiagnosis(events, artifacts, error) {
  const atomEvents = events.filter((event) => /^atomization\.batch(?:\.cacheHit)?(?:\.range)?$/.test(event.code));
  const atomFailures = events.filter((event) => event.code === 'atomization.batch.failed');
  const atomExpected = Math.max(
    Number(error?.details?.batchTotal) || 0,
    ...events.map((event) => Number(event.data?.batchTotal) || 0),
    0
  );
  const completedIds = [...new Set(atomEvents.flatMap((event) => [
    eventIdentity(event),
    ...(Array.isArray(event.ids) ? event.ids : [])
  ]).filter(Boolean))].sort();
  const failed = (error?.details?.failedBatches || atomFailures.map((event) => event.data || {})).map((item) => ({
    id: item.stableBatchId || `batch-${item.batchIndex || '?'}`,
    index: Number(item.batchIndex) || null,
    code: item.code || 'ATOMIZATION_BATCH_FAILED',
    reason: compactReason(item.message || item.reason)
  }));
  const failedIds = new Set(failed.map((item) => item.id));
  const knownIds = [...new Set([
    ...completedIds,
    ...failed.map((item) => item.id),
    ...artifacts.filter((item) => item.name.startsWith('atom-batch-')).map((item) => item.name.slice('atom-batch-'.length))
  ])].sort();
  const missing = atomExpected > knownIds.length
    ? Array.from({ length: atomExpected }, (_, index) => index + 1)
      .filter((index) => !failed.some((item) => item.index === index)
        && !events.some((event) => /^atomization\.batch/.test(event.code)
          && (Number(event.data?.batchIndex) === index || event.indices?.includes(index))))
      .map((index) => `batch-index-${index}`)
    : [];

  const summaryArtifacts = artifacts.filter((item) => item.name.startsWith('summary-map-'));
  const summaryEvents = events.filter((event) => /^summary\.map\.(?:cacheHit|completed)(?:\.range)?$/.test(event.code));
  const summaryPlan = events.findLast?.((event) => event.code === 'summary.map.plan');
  const plannedSummaryIds = Array.isArray(summaryPlan?.data?.stableChunkIds) ? summaryPlan.data.stableChunkIds : [];
  const summaryExpected = Math.max(
    Number(error?.details?.progress?.chunkTotal) || 0,
    ...events.map((event) => Number(event.data?.chunkTotal) || 0),
    plannedSummaryIds.length,
    summaryArtifacts.length,
    0
  );
  const summaryCompleted = [...new Set([
    ...summaryArtifacts.filter((item) => item.exists && item.validation !== 'invalid-envelope').map((item) => item.name.slice('summary-map-'.length)),
    ...summaryEvents.flatMap((event) => [eventIdentity(event), ...(event.ids || [])])
  ])].sort();
  const completedSummarySet = new Set(summaryCompleted);
  const missingSummaryIds = plannedSummaryIds.filter((id) => !completedSummarySet.has(id));
  return {
    summaryChunks: {
      expected: summaryExpected,
      completed: summaryCompleted.length,
      completedIds: summaryCompleted.slice(0, 120),
      missingIds: missingSummaryIds.slice(0, 120),
      missingCount: Math.max(missingSummaryIds.length, summaryExpected - summaryCompleted.length)
    },
    atomBatches: {
      expected: atomExpected,
      completed: Number(error?.details?.completedBatches) || completedIds.length,
      completedIds: completedIds.slice(0, 120),
      missing,
      failed
    }
  };
}

function counterSummary(events, counters = {}) {
  const count = (pattern) => events.reduce((sum, event) => sum + (pattern.test(event.code) ? Number(event.count) || 1 : 0), 0);
  const hasRequestCounter = Object.hasOwn(counters || {}, 'apiRequests');
  return {
    outboundRequests: hasRequestCounter
      ? Math.max(0, Number(counters.apiRequests) || 0)
      : count(/^outbound\.request$/) || count(/minimax\.(?:http|transport|timeout)/),
    retries: count(/^outbound\.retry$/) || Number(counters.aiRetries) || count(/retry|checkpointRetry/i),
    rateLimits: events.reduce((sum, event) => sum + (event.code === 'outbound.retry' && event.data?.rateLimited ? 1 : 0), 0),
    backoffs: count(/backoff/i),
    cache: {
      hits: count(/cacheHit/),
      misses: count(/cacheMiss/)
    },
    summaryReduceRequests: Number(counters.summaryReduceRequests) || 0,
    providerContractRepairs: count(/provider\.contractRepair/),
    evidenceSanitizations: count(/^summary\.evidence\.sanitized$/),
    emptyVerifiedChunks: count(/^summary\.map\.emptyVerified$/),
    fatalAllEmptySummaries: count(/^summary\.map\.allEmpty$/),
    parseContractRejections: count(/^summary\.map\.parseContractRejected$/)
  };
}

function nextActions(error, work) {
  const actions = [];
  if (error?.retryable) actions.push('从 Dashboard 重试该任务；有效检查点会复用，仅补失败或缺失批次。');
  if (work.atomBatches.missing.length || work.atomBatches.failed.length) actions.push('核对 atomBatches 的稳定 ID；持续失败时连同本报告提交支持人员。');
  if (error?.category === 'auth') actions.push('在设置中重新测试服务连接；不要在报告或消息中粘贴 API Key。');
  if (error?.category === 'rate_limit') actions.push('等待服务限流窗口结束后重试，并检查报告中的 rateLimits/backoffs。');
  if (!actions.length) actions.push(error?.suggestedAction || '按 finalError 建议处理后重试；若复现，请提交完整报告。');
  actions.push('无需发送源文件、原始 diag.log、提示词、模型响应或密钥。');
  return actions;
}

function buildDiagnosticReport(input = {}) {
  const task = input.task || {};
  const error = redact(input.error || task.errors?.at?.(-1) || {});
  const events = compactEvents(input.events || [], input);
  const artifacts = redact(input.artifacts || []);
  const work = workDiagnosis(events, artifacts, error);
  const startedAt = task.diagnostic_started_at || task.progress?.startedAt || task.created_at || '';
  const endedAt = task.updated_at || input.generatedAt || '';
  const sourcePath = String(task.source_path || '');
  const causal = Array.isArray(error?.details?.causalChain) && error.details.causalChain.length
    ? error.details.causalChain.map((item) => ({
      code: item.code || 'CAUSE_UNCLASSIFIED',
      category: item.category || 'internal',
      retryable: item.retryable === true,
      type: item.type || 'Error',
      message: compactReason(item.message)
    }))
    : [{
      code: error.code || 'INTERNAL_UNEXPECTED',
      category: error.category || 'internal',
      retryable: error.retryable === true,
      message: compactReason(error.technicalMessage || error.message)
    }];
  return redact({
    reportVersion: REPORT_VERSION,
    schemaVersion: SCHEMA_VERSION,
    generatedAt: input.generatedAt || new Date().toISOString(),
    runtime: {
      pluginId: input.manifest?.id || 'engineering-knowledge-slicer',
      pluginVersion: input.manifest?.version || '',
      pipelineVersion: task.pipeline_version || '',
      promptBundleVersion: task.prompt_bundle_version || '',
      platform: input.platform || {},
      settings: safeSettings(input.settings)
    },
    identity: {
      taskId: task.task_id || '',
      runId: task.run_id || '',
      sourceHash: String(task.source_hash || '').slice(0, 24),
      sourcePathHash: hash(sourcePath, 24),
      sourceType: task.source_type || sourcePath.split('.').pop()?.toLowerCase() || 'unknown'
    },
    execution: {
      stage: error.stage || task.progress?.stage || task.status || 'unknown',
      status: task.status || 'unknown',
      attempt: Number(task.attempt || task.retry_count || 0),
      startedAt,
      endedAt,
      elapsedMs: Math.max(0, Date.parse(endedAt) - Date.parse(startedAt)) || Number(task.progress?.elapsedMs) || 0,
      lastSuccessfulCheckpoint: [...artifacts].reverse().find((item) => item.exists && item.validation === 'valid' && !/^error|diagnostic/.test(item.name))?.name || null
    },
    finalError: error,
    causalChain: causal,
    work,
    operations: counterSummary(events, input.counters),
    timeline: events,
    terminal: redact(task.diagnostic_terminal || { ledgerPersisted: task.status === 'failed', errorArtifactPersisted: !!task.artifacts?.error, uiTransition: 'unknown' }),
    artifacts,
    nextActions: nextActions(error, work),
    sendToSupport: 'Send this complete report. Do not send the source document, API keys, prompts, or raw provider responses.'
  });
}

function fitReport(report, maxBytes = MAX_JSON_BYTES) {
  const output = JSON.parse(JSON.stringify(report));
  const size = () => Buffer.byteLength(JSON.stringify(output, null, 2));
  while (size() > maxBytes && output.timeline?.length > 20) output.timeline.shift();
  while (size() > maxBytes && output.artifacts?.length > 30) output.artifacts.pop();
  while (size() > maxBytes && output.work?.summaryChunks?.completedIds?.length > 20) output.work.summaryChunks.completedIds.pop();
  while (size() > maxBytes && output.work?.atomBatches?.completedIds?.length > 20) output.work.atomBatches.completedIds.pop();
  if (size() > maxBytes) {
    output.timeline = output.timeline?.slice(-10) || [];
    output.artifacts = output.artifacts?.slice(0, 15) || [];
    output.truncated = true;
  }
  return output;
}

function boundedDiagnosticJson(report, maxBytes = MAX_JSON_BYTES) {
  return JSON.stringify(fitReport(report, maxBytes), null, 2);
}

function renderDiagnosticMarkdown(report) {
  const fitted = fitReport(report, MAX_JSON_BYTES);
  const summary = [
    '# Engineering Knowledge Slicer Diagnostic Report',
    '',
    `> Send this complete report to support. Do not send the source document, API keys, prompts, or raw provider responses.`,
    '',
    `- Report/schema: ${fitted.reportVersion} / ${fitted.schemaVersion}`,
    `- Plugin: ${fitted.runtime.pluginId} ${fitted.runtime.pluginVersion}`,
    `- Task/run: ${fitted.identity.taskId} / ${fitted.identity.runId}`,
    `- Source: hash ${fitted.identity.sourceHash || fitted.identity.sourcePathHash}; type ${fitted.identity.sourceType}`,
    `- Stage/status: ${fitted.execution.stage} / ${fitted.execution.status}`,
    `- Error: ${fitted.finalError.code || 'INTERNAL_UNEXPECTED'} (${fitted.finalError.category || 'internal'}, retryable=${!!fitted.finalError.retryable})`,
    `- Checkpoint: ${fitted.execution.lastSuccessfulCheckpoint || 'none'}`,
    `- Summary chunks: ${fitted.work.summaryChunks.completed}/${fitted.work.summaryChunks.expected}; missing ${fitted.work.summaryChunks.missingCount}`,
    `- Atom batches: ${fitted.work.atomBatches.completed}/${fitted.work.atomBatches.expected}; missing ${fitted.work.atomBatches.missing.length}; failed ${fitted.work.atomBatches.failed.length}`,
    '',
    '## Machine-readable report',
    '',
    '```json',
    boundedDiagnosticJson(fitted),
    '```'
  ].join('\n');
  if (Buffer.byteLength(summary) <= MAX_MARKDOWN_BYTES) return summary;
  return summary.slice(0, MAX_MARKDOWN_BYTES - 80) + '\n```\n\n> Report truncated to hard size bound.\n';
}

module.exports = {
  MAX_JSON_BYTES, MAX_MARKDOWN_BYTES, REPORT_VERSION, SCHEMA_VERSION,
  boundedDiagnosticJson, buildDiagnosticReport, compactEvents, redact, renderDiagnosticMarkdown
};

},
/**
 * @module src/core/reliability
 * Stable errors, redaction, retry decisions, validation reports and stage metrics.
 */
"src/core/reliability.js": function(require, module, exports) {
const SECRET_KEYS = /^(authorization|proxy-authorization|api[-_]?key|token|jwt|secret|password|cookie|set-cookie)$/i;
const CREDENTIAL = /(Bearer\s+)[^\s,;]+|((?:sk|key|paddle|gh[pousxr])[-_])[A-Za-z0-9._-]{12,}|eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]+/gi;
const SENSITIVE_QUERY = /([?&](?:api_?key|access_?token|token|jwt|secret|signature)=)[^&#\s]+/gi;
const SECRET_SETTING_KEYS = new Set(['minimaxApiKey', 'pdfMineruApiKey', 'pdfPaddleOcrApiKey', 'embeddingApiKey']);

class AppError extends Error {
  constructor(input = {}) {
    super(String(input.message || '工程知识切片遇到错误'));
    this.name = 'AppError';
    this.code = String(input.code || 'INTERNAL_UNEXPECTED');
    this.category = String(input.category || 'internal');
    this.severity = String(input.severity || 'error');
    this.retryable = input.retryable === true;
    this.stage = String(input.stage || 'process');
    this.taskId = String(input.taskId || '');
    this.runId = String(input.runId || '');
    this.sourcePath = String(input.sourcePath || '');
    this.artifactPath = String(input.artifactPath || '');
    this.provider = String(input.provider || '');
    this.requestId = String(input.requestId || '');
    this.technicalMessage = redactText(input.technicalMessage || '');
    this.suggestedAction = String(input.suggestedAction || '查看错误详情并按建议重试；若持续发生，请导出脱敏诊断信息。');
    this.details = sanitizeForLog(input.details || {});
    this.timestamp = input.timestamp || new Date().toISOString();
    this.version = input.version || {};
    if (input.diagnosticMode === true && input.stack) this.diagnosticStack = redactText(input.stack);
  }
  toJSON() {
    const value = {};
    for (const key of ['code', 'category', 'severity', 'retryable', 'stage', 'taskId', 'runId', 'sourcePath',
      'artifactPath', 'provider', 'requestId', 'message', 'technicalMessage', 'suggestedAction', 'details',
      'timestamp', 'version', 'diagnosticStack']) {
      if (this[key] !== undefined && this[key] !== '') value[key] = this[key];
    }
    return value;
  }
}

function toAppError(error, context = {}) {
  if (error instanceof AppError) return error;
  const message = redactText(error?.message || error || '未知错误');
  const status = Number(error?.status || error?.statusCode || 0);
  const code = String(error?.code || '');
  const classified = error?.retryable === true
    ? {
        code: code || 'RETRYABLE_STAGE_FAILURE',
        category: error.category || (code.startsWith('ATOMIZATION_CHECKPOINT_') ? 'checkpoint' : 'ai_provider'),
        retryable: true,
        severity: 'error',
        suggestedAction: '直接重试该文件；已验证并保存的批次会复用，只处理失败或缺失批次。'
      }
    : classifyFailure({ status, code, message });
  return new AppError(Object.assign({}, context, classified, {
    stage: error?.stage || context.stage,
    artifactPath: error?.artifactPath || context.artifactPath,
    provider: error?.provider || context.provider,
    message: userMessage(classified.category),
    technicalMessage: message,
    stack: error?.stack,
    details: Object.assign({}, context.details || {}, error?.details || {})
  }));
}

function classifyFailure(input = {}) {
  const status = Number(input.status || 0);
  const code = String(input.code || '').toUpperCase();
  const message = String(input.message || '');
  if (code === 'COMPONENT_PATH_INVALID') return result(code, 'component_config', false, '组件路径配置无效', '修正组件相对路径后重试；路径必须是组件包内的 .md 或 .json 文件，不能是目录。');
  if (code === 'COMPONENT_NOT_FOUND') return result(code, 'component_config', false, '找不到组件文件', '该组件没有可用的内置兼容回退；恢复缺失的用户组件后重试，已有解析产物会复用，无需重新上传。');
  if (code === 'COMPONENT_CONFIG_INVALID') return result(code, 'component_config', false, '组件配置无效', '内置兼容回退不会替换已存在但无效的自定义内容；修正 folder-map、Schema 或 Prompt 后重试，已有解析产物会复用。');
  if (code === 'VAULT_PATH_INVALID') return result(code, 'path_contract', false, '插件路径契约无效', '修复或移除包含主机绝对路径的旧索引/状态记录后重试；已有解析与统一知识产物会复用。');
  if (code === 'STRUCTURED_WRITE_NOT_PERSISTED') return result(code, 'structured_state', true, '未写入任何知识卡片', '写入结果未能由 Obsidian 打开，事务和索引已安全回滚；请保留源文件并重试。');
  if (code === 'STRUCTURED_INDEX_CORRUPT') return result(code, 'structured_state', false, '结构化索引已损坏', '修复索引 JSON 后重试；插件不会覆盖原文件，解析与统一知识检查点会复用。');
  if (code === 'PROJECT_REGISTRY_CORRUPT' || code === 'PROJECT_REGISTRY_INVALID') return result(code, 'structured_state', false, '项目登记表损坏或格式无效', '修复项目登记表 JSON/数组格式后重试；插件不会覆盖原文件，已有检查点会复用。');
  if (code === 'TASK_LEDGER_CORRUPT') return result(code, 'task_ledger', false, '任务账本损坏或无法读取', '修复 tasks.json 或从滚动备份恢复；插件不会清空或覆盖损坏账本。');
  if (code === 'SOURCE_PATH_MISSING') return result(code, 'file', false, '缺少源文件定位信息', '若已有解析产物请直接重试；否则重新扫描源文件以恢复 vault 相对路径。');
  if (code === 'SUMMARY_ALL_CHUNKS_UNSUPPORTED') return result(code, 'unsupported_knowledge', false,
    '所有分块均无可核验知识', '确认解析正文包含可引用原文；如正文正常，请改用能按 block_id 返回短小逐字引文的模型，然后从总结检查点重试。');
  if (code === 'PARSE_CONTRACT_SOURCE_BLOCKS_MISSING') return result(code, 'internal_parse_contract', false,
    '解析产物内部契约不完整', '模型尚未被调用。请保留原文件并从“解析”检查点重试；若仍失败，请导出脱敏诊断报告。');
  if (code === 'OCR_CANCELLED') return result(code, 'cancelled', false, '本地 OCR 已取消', '如需继续，请重新将文件加入队列；有效页级检查点会复用。');
  if (code === 'OCR_UNAVAILABLE') return result(code, 'local_ocr', true, '本地 OCR 不可用', '在设置中启用并检测本地 OCR，或配置绝对可执行文件路径。');
  if (code === 'OCR_RENDER_FAILURE') return result(code, 'local_ocr', true, 'PDF 页面渲染失败', '确认 pdftoppm 可用后重试；已完成页面会复用。');
  if (code === 'OCR_TIMEOUT') return result(code, 'local_ocr', true, '本地 OCR 超时', '提高单页超时或降低并发后重试。');
  if (code === 'OCR_MALFORMED_OUTPUT') return result(code, 'local_ocr', false, '本地 OCR 输出格式无效', '检查自定义 provider 是否返回 local_ocr_v1 JSON 合同。');
  if (code === 'OCR_LIMITS_EXCEEDED') return result(code, 'local_ocr', false, '本地 OCR 安全限制已超出', '拆分 PDF 或降低页面分辨率后重试。');
  if (code === 'TASK_CANCELLED' || /取消/.test(message)) return result('CANCELLED_BY_USER', 'cancelled', false, '任务已取消', '如需继续，请重新将文件加入队列。');
  if (status === 401 || status === 403 || /鉴权|unauthori[sz]ed|forbidden/i.test(message)) return result('AUTH_PROVIDER_REJECTED', 'auth', false, '外部服务鉴权失败', '请检查服务密钥和账号权限后测试连接。');
  if (status === 429 || /rate.?limit|限流/i.test(message)) return result('RATE_LIMIT_PROVIDER_BUSY', 'rate_limit', true, '外部服务限流', '稍后重试；插件会遵循 Retry-After 并退避。');
  if (code.includes('TIMEOUT') || /timed? ?out|超时/i.test(message)) return result('TIMEOUT_STAGE_EXCEEDED', 'timeout', true, '处理阶段超时', '可以重试该阶段；若持续发生，请检查网络和超时设置。');
  if (status >= 500 || /ECONNRESET|ENOTFOUND|EAI_AGAIN|network/i.test(`${code} ${message}`)) return result('NETWORK_TRANSIENT_FAILURE', 'network', true, '外部服务暂时不可用', '插件可安全重试该阶段；若持续发生，请测试服务连接。');
  if (/JSON/i.test(code) || /JSON/.test(message)) return result('JSON_PARSE_INVALID_RESPONSE', 'json_parse', false, '服务返回格式无法解析', '重新生成该阶段；若持续发生，请检查提示词与供应商响应。');
  if (/SCHEMA|VALIDATION|必填字段|不符合契约|覆盖不完整|(?:^|[；\s])\$\.[\w.[\]-]+ (?:is required|is not allowed|must be)/i.test(`${code} ${message}`)) return result('SCHEMA_OUTPUT_INVALID', 'schema', false, '模型输出未通过结构校验', '重新生成该批次；若持续发生，请检查 Schema 与提示词版本。');
  if (/ENOENT|未找到源文件/.test(`${code} ${message}`)) return result('FILE_NOT_FOUND', 'file', false, '找不到源文件', '确认文件仍在输入目录且未被移动或删除。');
  return result(code && /^[A-Z][A-Z0-9_]+$/.test(code) ? code : 'INTERNAL_UNEXPECTED', 'internal', false, '工程知识切片处理失败', '查看技术详情；修复原因后仅重试失败阶段。');
}

function result(code, category, retryable, message, suggestedAction) {
  return { code, category, retryable, severity: category === 'cancelled' ? 'info' : 'error', message, suggestedAction };
}

function userMessage(category) {
  return ({ auth: '外部服务鉴权失败', rate_limit: '外部服务限流', timeout: '处理阶段超时',
    network: '外部服务暂时不可用', json_parse: '服务返回格式无法解析', schema: '模型输出未通过结构校验',
    file: '找不到源文件', path_contract: '插件路径契约无效', structured_state: '结构化状态无法读取',
    task_ledger: '任务账本无法读取', component_config: '组件配置加载失败', cancelled: '任务已取消', checkpoint: '已保存批次读取或写入失败',
    ai_provider: '知识原子化批次未完整完成', local_ocr: '本地 OCR 处理失败',
    internal_parse_contract: '解析产物内部契约不完整' })[category] || '工程知识切片处理失败';
}

function redactText(value) {
  return String(value || '').replace(CREDENTIAL, (_whole, bearer, prefix) => bearer ? `${bearer}***` : `${prefix || ''}***`)
    .replace(SENSITIVE_QUERY, '$1***');
}

function sanitizeForLog(value, seen = new WeakSet()) {
  if (typeof value === 'string') return redactText(value);
  if (value === null || value === undefined || typeof value !== 'object') return value;
  if (seen.has(value)) return '[Circular]';
  seen.add(value);
  if (Array.isArray(value)) return value.map((item) => sanitizeForLog(item, seen));
  const out = {};
  for (const [key, item] of Object.entries(value)) {
    out[key] = SECRET_KEYS.test(key) ? '***' : sanitizeForLog(item, seen);
  }
  return out;
}

function sanitizeSettingsForPersistence(settings = {}) {
  const output = {};
  for (const [key, value] of Object.entries(settings)) {
    if (!SECRET_SETTING_KEYS.has(key) && !SECRET_KEYS.test(key)) output[key] = value;
  }
  return output;
}

function loadCredentialFile(filePath, options = {}) {
  const fs = options.fs;
  if (!fs || !fs.existsSync(filePath)) return {};
  const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
}

function saveCredentialFile(filePath, secrets = {}, options = {}) {
  const fs = options.fs;
  if (!fs) throw new Error('credential filesystem unavailable');
  const allowed = new Set(['minimaxApiKey', 'pdfMineruApiKey', 'pdfPaddleOcrApiKey', 'embeddingApiKey']);
  const output = {};
  for (const [key, value] of Object.entries(secrets || {})) {
    if (allowed.has(key) && String(value || '').trim()) output[key] = String(value).trim();
  }
  const tempPath = `${filePath}.tmp-${Number(options.pid || 0)}`;
  fs.writeFileSync(tempPath, `${JSON.stringify(output, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  fs.renameSync(tempPath, filePath);
  try { fs.chmodSync(filePath, 0o600); } catch (_) { /* Windows/受限文件系统可能不支持 chmod */ }
}

function computeBackoffMs(attempt, options = {}) {
  const baseMs = Math.max(1, Number(options.baseMs) || 800);
  const maxMs = Math.max(baseMs, Number(options.maxMs) || 30000);
  const jitterRatio = Math.max(0, Math.min(1, Number(options.jitterRatio) || 0));
  const random = typeof options.random === 'function' ? options.random() : Math.random();
  const raw = Math.min(maxMs, baseMs * (2 ** Math.max(0, Number(attempt) - 1)));
  return Math.round(raw * (1 - jitterRatio + (2 * jitterRatio * random)));
}

function buildValidationReport(input = {}) {
  const failures = [];
  if (input.schemaValid === false) failures.push('SCHEMA');
  if (input.routeValid === false) failures.push('ROUTING');
  if (input.tagsValid === false) failures.push('TAG');
  if (input.sourceLinkValid === false) failures.push('SOURCE_LINK');
  if (input.evidenceFound === false) failures.push('EVIDENCE');
  const difference = input.materialDifferences || {};
  const factFailureCodes = {
    missing_in_evidence: 'FACT_MISSING_IN_EVIDENCE',
    unsupported_addition: 'UNSUPPORTED_ADDITION',
    conflict: 'FACT_CONFLICT',
    ambiguous_conversion: 'AMBIGUOUS_CONVERSION'
  };
  if (factFailureCodes[difference.status]) failures.push(factFailureCodes[difference.status]);
  if (difference.modality?.status && difference.modality.status !== 'matched') failures.push('MODALITY_CONFLICT');
  if (difference.conditions?.status && difference.conditions.status !== 'matched') failures.push('CONDITION_CONFLICT');
  if (input.dateConsistency === false) failures.push('DATE_CONFLICT');
  if (input.entityConsistency === false) failures.push('SUBJECT_CONFLICT');
  if (input.unsafePath === true) failures.push('UNSAFE_PATH');
  if (input.unsupportedContent === true) failures.push('UNSUPPORTED_CONTENT');
  if (input.duplicateScore >= 1) failures.push('DUPLICATE');
  return {
    schemaValid: input.schemaValid !== false,
    routeValid: input.routeValid !== false,
    tagsValid: input.tagsValid !== false,
    sourceLinkValid: input.sourceLinkValid !== false,
    parentSummaryValid: input.parentSummaryValid !== false,
    evidenceFound: input.evidenceFound !== false,
    evidenceMatchScore: number(input.evidenceMatchScore),
    numberConsistency: !factFailureCodes[difference.status] && input.numberConsistency !== false,
    materialDifferenceStatus: difference.status || 'not_applicable',
    materialDifferences: difference,
    dateConsistency: input.dateConsistency !== false,
    entityConsistency: input.entityConsistency !== false,
    atomicityScore: number(input.atomicityScore),
    duplicateScore: number(input.duplicateScore),
    hardGateFailures: failures,
    nonOverridableFailures: failures.filter((failure) =>
      ['SCHEMA', 'ROUTING', 'SOURCE_LINK', 'EVIDENCE', 'FACT_MISSING_IN_EVIDENCE',
        'UNSUPPORTED_ADDITION', 'FACT_CONFLICT', 'AMBIGUOUS_CONVERSION', 'MODALITY_CONFLICT',
        'CONDITION_CONFLICT', 'DATE_CONFLICT', 'SUBJECT_CONFLICT', 'UNSAFE_PATH',
        'UNSUPPORTED_CONTENT', 'DUPLICATE'].includes(failure)),
    warnings: Array.isArray(input.warnings) ? input.warnings : [],
    confidenceComponents: input.confidenceComponents || {},
    finalDecision: failures.length ? 'review' : (input.finalDecision || 'auto_ingest')
  };
}

function createStageMetric(input = {}) {
  const started = Number(input.stageStartedAt || Date.now());
  const completed = Number(input.stageCompletedAt || Date.now());
  return sanitizeForLog({
    taskId: input.taskId || '', runId: input.runId || '', sourceFingerprint: String(input.sourceHash || '').slice(0, 12),
    stage: input.stage || '', stageStartedAt: started, stageCompletedAt: completed,
    stageDurationMs: Math.max(0, completed - started), queueWaitMs: Number(input.queueWaitMs) || 0,
    attempt: Number(input.attempt) || 1, provider: input.provider || '', requestCount: Number(input.requestCount) || 0,
    retryCount: Number(input.retryCount) || 0, pollCount: Number(input.pollCount) || 0,
    inputCharacters: Number(input.inputCharacters) || 0, estimatedInputTokens: Math.ceil((Number(input.inputCharacters) || 0) / 3),
    outputCharacters: Number(input.outputCharacters) || 0, estimatedOutputTokens: Math.ceil((Number(input.outputCharacters) || 0) / 3),
    bytesRead: Number(input.bytesRead) || 0, bytesWritten: Number(input.bytesWritten) || 0,
    cacheHit: input.cacheHit === true, cacheMiss: input.cacheMiss === true,
    cardsGenerated: Number(input.cardsGenerated) || 0, cardsWritten: Number(input.cardsWritten) || 0,
    cardsRejected: Number(input.cardsRejected) || 0,
    candidateCards: Number(input.candidateCards) || 0, autoApproved: Number(input.autoApproved) || 0,
    reviewPending: Number(input.reviewPending) || 0, cardsMerged: Number(input.cardsMerged) || 0,
    duplicateCardsMerged: Number(input.duplicateCardsMerged) || 0, errorCode: input.errorCode || ''
  });
}

function reasonHistogram(items) {
  const out = {};
  for (const item of items || []) {
    for (const failure of item.validationReport?.hardGateFailures || ['SOFT_CONFIDENCE']) {
      const key = String(failure).replace(/[^A-Z0-9_]/gi, '_').slice(0, 64);
      out[key] = (out[key] || 0) + 1;
    }
  }
  return out;
}

function number(value) { return Number.isFinite(Number(value)) ? Number(value) : 0; }

module.exports = {
  AppError, buildValidationReport, classifyFailure, computeBackoffMs, createStageMetric,
  loadCredentialFile, redactText, saveCredentialFile, sanitizeForLog, sanitizeSettingsForPersistence, toAppError
};

},
/**
 * @module src/core/link-service
 * 卡片间链接建议：基于标签 / Map_Index / 共享实体的双向链接候选
 * @exports findLinkCandidates
 * @exports validateRelations
 */
"src/core/link-service.js": function(require, module, exports) {
const RELATION_TYPES = Object.freeze(['supports', 'contradicts', 'supersedes', 'depends_on', 'implements', 'related']);

function findLinkCandidates(atom, cards, options = {}) {
  const limit = Math.min(20, Math.max(1, Number(options.limit) || 20));
  const atomTokens = tokenSet(`${atom.title || ''} ${flatten(atom.content)}`);
  return (cards || []).map((card) => {
    const cardTokens = tokenSet(`${card.title || ''} ${card.text || ''}`);
    let score = intersectionSize(atomTokens, cardTokens) * 2;
    const semanticScore = cosineSparse(termVector(atomTokens), termVector(cardTokens));
    score += Math.round(semanticScore * 20);
    if (atom.Category && atom.Category === card.Category) score += 6;
    if (atom.TagL1 && atom.TagL1 === card.TagL1) score += 3;
    if (atom.TagL2 && atom.TagL2 === card.TagL2) score += 2;
    return Object.assign({}, card, { candidate_score: score });
  }).sort((left, right) => right.candidate_score - left.candidate_score || String(left.card_id).localeCompare(String(right.card_id))).slice(0, limit);
}

function normalizeEntityName(value, aliases = {}) {
  const normalized = String(value?.name || value || '').normalize('NFKC').trim().toLowerCase().replace(/\s+/g, '');
  return String(aliases[normalized] || normalized);
}

function buildKnowledgeIndex(cards, options = {}) {
  const aliases = Object.assign({}, options.aliases || {});
  const entities = {};
  const reverseRelations = {};
  const evolution = { supersedes: {}, contradictedBy: {} };
  const projects = new Map();
  const signatures = [];
  for (const card of cards || []) {
    const id = String(card.card_id || '');
    if (!id) continue;
    signatures.push({ card_id: id, signature: simHash(`${card.title || ''} ${card.text || ''}`) });
    for (const entity of card.entities || []) {
      const canonical = normalizeEntityName(entity, aliases);
      if (!canonical) continue;
      if (!entities[canonical]) entities[canonical] = { canonical, aliases: [], card_ids: [] };
      entities[canonical].card_ids.push(id);
      const original = String(entity?.name || entity || '').trim();
      if (original && !entities[canonical].aliases.includes(original)) entities[canonical].aliases.push(original);
    }
    for (const relation of card.relations || []) {
      const target = String(relation.target_card_id || relation.target || '');
      const type = String(relation.relation || relation.type || 'related');
      if (!target) continue;
      if (!reverseRelations[target]) reverseRelations[target] = [];
      reverseRelations[target].push({ source_card_id: id, relation: type });
      if (type === 'supersedes') {
        if (!evolution.supersedes[id]) evolution.supersedes[id] = [];
        evolution.supersedes[id].push(target);
      }
      if (type === 'contradicts') {
        if (!evolution.contradictedBy[target]) evolution.contradictedBy[target] = [];
        evolution.contradictedBy[target].push(id);
      }
    }
    const projectName = String(card.project || '').trim();
    if (projectName) {
      const key = `${card.library || 'bid'}:${projectName}`;
      if (!projects.has(key)) projects.set(key, { name: projectName, library: card.library || 'bid', cards: [] });
      projects.get(key).cards.push({ card_id: id, title: card.title || id, path: card.path || '' });
    }
  }
  for (const value of Object.values(entities)) value.card_ids = [...new Set(value.card_ids)].sort();
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    aliases,
    entities,
    reverseRelations,
    evolution,
    semanticSignatures: signatures,
    projects: [...projects.values()].sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'))
  };
}

function renderProjectAggregation(project) {
  const lines = ['---', `title: ${JSON.stringify(project.name)}`, 'artifact_type: "project-aggregation"', `library: ${JSON.stringify(project.library)}`, 'schema_version: "1"', '---', '', `# ${project.name}`, '', '## 知识卡片', ''];
  for (const card of project.cards || []) lines.push(`- [[${String(card.path || '').replace(/\.md$/i, '')}|${card.title}]]`);
  lines.push('', '## 动态聚合', '', '```dataview', `LIST FROM "" WHERE project = ${JSON.stringify(project.name)} OR project_name = ${JSON.stringify(project.name)}`, '```', '');
  return lines.join('\n');
}

function simHash(text) {
  const crypto = require('crypto');
  const weights = new Int32Array(64);
  for (const token of tokenSet(text)) {
    const digest = crypto.createHash('sha256').update(token).digest();
    for (let bit = 0; bit < 64; bit += 1) weights[bit] += (digest[Math.floor(bit / 8)] & (1 << (bit % 8))) ? 1 : -1;
  }
  let result = 0n;
  for (let bit = 0; bit < 64; bit += 1) if (weights[bit] >= 0) result |= 1n << BigInt(bit);
  return result.toString(16).padStart(16, '0');
}

function hammingDistance(left, right) {
  let value = BigInt(`0x${left || '0'}`) ^ BigInt(`0x${right || '0'}`);
  let count = 0;
  while (value) { count += Number(value & 1n); value >>= 1n; }
  return count;
}

function termVector(tokens) {
  const vector = new Map();
  for (const token of tokens) vector.set(token, (vector.get(token) || 0) + 1);
  return vector;
}

function cosineSparse(left, right) {
  let dot = 0; let leftNorm = 0; let rightNorm = 0;
  for (const value of left.values()) leftNorm += value * value;
  for (const value of right.values()) rightNorm += value * value;
  for (const [key, value] of left) dot += value * (right.get(key) || 0);
  return leftNorm && rightNorm ? dot / Math.sqrt(leftNorm * rightNorm) : 0;
}

function validateRelations(relations, candidates) {
  const candidateIds = new Set((candidates || []).map((item) => item.card_id));
  const valid = [];
  const issues = [];
  for (const relation of relations || []) {
    if (!candidateIds.has(relation.target_card_id)) {
      issues.push(`关联目标不在候选集：${relation.target_card_id}`);
      continue;
    }
    if (!RELATION_TYPES.includes(relation.relation)) {
      issues.push(`不支持的关联类型：${relation.relation}`);
      continue;
    }
    valid.push({ target_card_id: relation.target_card_id, relation: relation.relation });
  }
  return { valid, issues };
}

function tokenSet(text) {
  const normalized = String(text || '').toLowerCase();
  const tokens = normalized.match(/[a-z0-9][a-z0-9_-]+|[\u3400-\u9fff]{2,}/g) || [];
  const set = new Set();
  for (const token of tokens) {
    set.add(token);
    if (/^[\u3400-\u9fff]+$/.test(token)) {
      for (let index = 0; index < token.length - 1; index += 1) set.add(token.slice(index, index + 2));
    }
  }
  return set;
}

function intersectionSize(left, right) {
  let count = 0;
  for (const item of left) if (right.has(item)) count += 1;
  return count;
}

function flatten(value) {
  if (value === null || value === undefined) return '';
  if (typeof value !== 'object') return String(value);
  return Object.values(value).map(flatten).join(' ');
}

module.exports = {
  RELATION_TYPES, buildKnowledgeIndex, cosineSparse, findLinkCandidates, hammingDistance,
  normalizeEntityName, renderProjectAggregation, simHash, validateRelations
};


},
/**
 * @module src/core/workflow
 * 顶层工作流编排：parse → classify → summarize → atomize → buildCard → save
 * 串联 ai-pipeline / routing / link-service / markdown-renderer / confidence
 * @exports runKnowledgeWorkflow
 */
"src/core/table-knowledge.js": function(require, module, exports) {
'use strict';

const crypto = require('crypto');

const text = (value) => String(value == null ? '' : value).normalize('NFKC').replace(/\s+/g, ' ').trim();
const id = (prefix, value) => `${prefix}-${crypto.createHash('sha256').update(value).digest('hex').slice(0, 20)}`;
const columnNumber = (value) => [...String(value || '').toUpperCase()]
  .reduce((number, character) => number * 26 + character.charCodeAt(0) - 64, 0);
const meaningful = (value) => text(value) && !/^(?:[-—/\\]|n\/?a|无|合计|小计|序号)$/iu.test(text(value));
const headerLike = (value) => /材料|产品|部位|位置|区域|系统|规格|型号|单位|性能|要求|做法|施工|验收|责任|适用|备注|名称/iu.test(text(value));

function tableKey(block) {
  const metadata = block.metadata || {};
  if (block.kind === 'spreadsheet_cell') return `xlsx:${metadata.sheet || ''}`;
  if (block.kind === 'table_cell') return `docx:${metadata.part || ''}:${metadata.table || 0}`;
  if (block.kind === 'table') return `text:${block.locator?.value || block.block_id}`;
  if (/table/i.test(block.kind || '') || metadata.table || metadata.table_id) {
    return `ocr:${metadata.table_id || metadata.table || block.locator?.page || block.locator?.value || block.block_id}`;
  }
  return '';
}

function cellPosition(block, fallbackRow, fallbackColumn) {
  const metadata = block.metadata || {};
  return {
    row: Number(metadata.row || metadata.table_row || fallbackRow),
    column: Number(metadata.cell || metadata.column_index || columnNumber(metadata.column) || fallbackColumn)
  };
}

function markdownCells(block) {
  const lines = String(block.raw?.text || '').split(/\r?\n/).filter((line) => /^\s*\|.*\|\s*$/.test(line));
  return lines.flatMap((line, rowIndex) => {
    const cells = line.trim().replace(/^\||\|$/g, '').split('|').map(text);
    if (cells.every((cell) => /^:?-{3,}:?$/.test(cell))) return [];
    return cells.map((value, columnIndex) => ({
      block, value, row: rowIndex + 1, column: columnIndex + 1
    }));
  });
}

function collectTables(parsePackage) {
  const groups = new Map();
  for (const block of parsePackage?.blocks || []) {
    const key = tableKey(block);
    if (!key || block.card_eligible === false || block.parse?.status === 'missing') continue;
    if (!groups.has(key)) groups.set(key, []);
    if (block.kind === 'table') groups.get(key).push(...markdownCells(block));
    else {
      const position = cellPosition(block, groups.get(key).length + 1, 1);
      groups.get(key).push({ block, value: text(block.raw?.text), ...position });
    }
  }
  return [...groups.entries()].map(([key, cells]) => ({ key, cells })).filter((table) => table.cells.some((cell) => meaningful(cell.value)));
}

function expandedValue(cell, table) {
  if (meaningful(cell.value)) return cell.value;
  const merge = cell.block.metadata?.merge;
  if (!merge) return '';
  const preceding = table.cells.filter((candidate) =>
    candidate.row <= cell.row && candidate.column <= cell.column && meaningful(candidate.value));
  return preceding.length ? preceding[preceding.length - 1].value : '';
}

function analyzeTable(table) {
  const rows = new Map();
  for (const cell of table.cells) {
    if (!rows.has(cell.row)) rows.set(cell.row, []);
    rows.get(cell.row).push(cell);
  }
  const orderedRows = [...rows.entries()].sort((a, b) => a[0] - b[0]);
  const headerRows = [];
  let previousHeaderSignature = '';
  for (const [row, cells] of orderedRows.slice(0, 5)) {
    const values = cells.map((cell) => expandedValue(cell, table)).filter(meaningful);
    if (!values.length) continue;
    const signature = values.map((value) => text(value).toLowerCase()).join('|');
    if (headerRows.length && signature === previousHeaderSignature) break;
    const headerScore = values.filter(headerLike).length / values.length;
    if (!headerRows.length || headerScore >= 0.5 || values.length === 1) {
      headerRows.push(row);
      previousHeaderSignature = signature;
    }
    else break;
  }
  if (!headerRows.length && orderedRows.length) headerRows.push(orderedRows[0][0]);
  const maxColumn = Math.max(0, ...table.cells.map((cell) => cell.column));
  const headers = new Map();
  for (let column = 1; column <= maxColumn; column += 1) {
    const path = headerRows.map((row) => {
      const cell = table.cells.find((candidate) => candidate.row === row && candidate.column === column);
      return cell ? expandedValue(cell, table) : '';
    }).filter(meaningful);
    headers.set(column, [...new Set(path)].join(' / ') || `第${column}列`);
  }
  const signatures = new Set();
  const subjects = [];
  let repeatedHeaders = 0;
  let emptyRows = 0;
  for (const [row, cells] of orderedRows) {
    if (headerRows.includes(row)) continue;
    const values = new Map(cells.map((cell) => [cell.column, expandedValue(cell, table)]));
    const nonempty = [...values.values()].filter(meaningful);
    if (!nonempty.length) { emptyRows += 1; continue; }
    const headerMatches = [...values].filter(([column, value]) =>
      text(value).toLowerCase() === text(headers.get(column)).split(' / ').pop().toLowerCase()).length;
    if (headerMatches >= Math.max(2, Math.ceil(nonempty.length * 0.6))) { repeatedHeaders += 1; continue; }
    const fields = [...values].filter(([, value]) => meaningful(value))
      .map(([column, value]) => ({ header: headers.get(column), value, column }));
    const signature = fields.map((field) => `${field.header}:${field.value}`).join('|').toLowerCase();
    if (signatures.has(signature)) continue;
    signatures.add(signature);
    const subjectFields = fields.filter((field) => /材料|产品|名称|部位|位置|区域|系统|做法/iu.test(field.header));
    const requirementFields = fields.filter((field) => !subjectFields.includes(field));
    const subject = subjectFields.map((field) => field.value).join(' / ') || fields[0].value;
    const content = `${subject}：${requirementFields.map((field) => `${field.header}=${field.value}`).join('；') || fields.map((field) => `${field.header}=${field.value}`).join('；')}`;
    const evidenceCells = cells.filter((cell) => meaningful(cell.value));
    subjects.push({ row, subject, content, fields, evidenceCells });
  }
  return { ...table, headers: Object.fromEntries(headers), headerRows, subjects, repeatedHeaders, emptyRows };
}

function structureAwareTableKnowledge(parsePackage, summary = {}) {
  const tables = collectTables(parsePackage).map(analyzeTable);
  const existing = new Set((summary.key_points || []).map((point) => text(point.content).toLowerCase()));
  const keyPoints = [];
  const evidence = [];
  let duplicates = 0;
  for (const table of tables) {
    for (const subject of table.subjects) {
      const normalized = text(subject.content).toLowerCase();
      if (existing.has(normalized)) { duplicates += 1; continue; }
      existing.add(normalized);
      const evidenceIds = subject.evidenceCells.map((cell) => {
        const evidenceId = id('table-evidence', `${cell.block.block_id}|${cell.row}|${cell.column}|${cell.value}`);
        evidence.push({
          evidence_id: evidenceId,
          block_id: cell.block.block_id,
          locator: `${cell.block.locator?.scheme || ''}:${cell.block.locator?.value || ''}`,
          quote: cell.value,
          source_page: cell.block.locator?.page || cell.block.metadata?.page || cell.block.metadata?.sheet || '',
          locator_precision: 'table-cell',
          provenance: { ...(cell.block.locator || {}), block_id: cell.block.block_id, row: cell.row, column: cell.column },
          table_context: { table: table.key, headers: table.headers, row: subject.row, section: cell.block.metadata?.section || '' }
        });
        return evidenceId;
      });
      keyPoints.push({
        point_id: id('table-point', `${table.key}|${subject.content}`),
        kind: 'table_requirement',
        content: subject.content,
        evidence_ids: [...new Set(evidenceIds)],
        table_subject: subject.subject,
        table_context: { table: table.key, headers: table.headers, row: subject.row }
      });
    }
  }
  const subjectsFound = tables.reduce((sum, table) => sum + table.subjects.length, 0);
  const dense = tables.filter((table) => table.subjects.length >= 6);
  const ratio = subjectsFound ? keyPoints.length / subjectsFound : 1;
  const warning = dense.length && ratio < 0.6 ? {
    code: 'TABLE_DENSE_COVERAGE_WARNING',
    message: `发现 ${subjectsFound} 个表格知识主题，仅生成 ${keyPoints.length} 个候选，压缩比例异常。`,
    blocking: false
  } : null;
  return {
    keyPoints, evidence,
    diagnostics: {
      tables_found: tables.length,
      subjects_found: subjectsFound,
      candidates_generated: keyPoints.length,
      consolidated: duplicates,
      dropped: {
        empty_rows: tables.reduce((sum, table) => sum + table.emptyRows, 0),
        repeated_headers: tables.reduce((sum, table) => sum + table.repeatedHeaders, 0),
        duplicates
      },
      coverage_ratio: ratio,
      warning
    }
  };
}

function enrichSummaryWithTableKnowledge(parsePackage, summary) {
  const result = structureAwareTableKnowledge(parsePackage, summary);
  return {
    summary: {
      ...summary,
      key_points: [...(summary.key_points || []), ...result.keyPoints],
      evidence: [...(summary.evidence || []), ...result.evidence],
      table_coverage: result.diagnostics
    },
    diagnostics: result.diagnostics
  };
}

module.exports = { collectTables, analyzeTable, structureAwareTableKnowledge, enrichSummaryWithTableKnowledge };


},
"src/core/workflow.js": function(require, module, exports) {
const { atomizeSummary, classifyDocument, summarizeDocument, validateAtomizationResult } = require("src/core/ai-pipeline.js");
const { upgradeParsePackage } = require("src/core/document-parser.js");
const { calculateConfidence, evidenceConsistency, extractedFacts } = require("src/core/confidence.js");
const { atomFingerprint } = require("src/core/identity.js");
const { buildCardRecord } = require("src/core/markdown-renderer.js");
const { resolveFixedRoute } = require("src/core/routing.js");
const { findLinkCandidates, validateRelations } = require("src/core/link-service.js");
const { buildValidationReport } = require("src/core/reliability.js");
const { verifyLocator, reconcileEvidence } = require("src/core/provenance.js");
let enrichSummaryWithTableKnowledge = (_parsePackage, summary) => ({
  summary, diagnostics: { tables_found: 0, subjects_found: 0, candidates_generated: 0, dropped: {} }
});
try {
  ({ enrichSummaryWithTableKnowledge } = require("src/core/table-knowledge.js"));
} catch (_) { /* isolated legacy harnesses may omit optional bundle dependencies */ }
const workflowDiag = (event, details) => {
  try { globalThis.__eksDiag?.diag?.(event, details); } catch (_) {}
};

async function runKnowledgeWorkflow(options) {
  options = Object.assign({}, options, {
    parsePackage: upgradeParsePackage(options.parsePackage, { sourceHash: options.sourceHash })
  });
  const classification = options.classification || await classifyDocument({
    parsePackage: options.parsePackage,
    folderMap: options.folderMap,
    classifierPrompt: options.prompts.classifier,
    classificationSchema: options.schemas.classification,
    requestJson: options.requestJson,
    onProgress: options.onProgress
  });
  await emitArtifact(options.onArtifact, 'classification', classification);
  const route = resolveFixedRoute(options.folderMap, classification);
  const typePrompt = options.prompts.type || (typeof options.loadTypePrompt === 'function' ? await options.loadTypePrompt(route, classification) : '');
  const baseSummary = options.summary || await summarizeDocument({
    parsePackage: options.parsePackage,
    classification,
    basePrompt: options.prompts.summaryBase,
    typePrompt,
    summarySchema: options.schemas.summary,
    maxChunkChars: options.maxChunkChars,
    chunkOverlapRatio: options.chunkOverlapRatio,
    coalesceTinyChunks: options.coalesceTinyChunks,
    summaryConcurrency: options.summaryConcurrency,
    loadSummaryMapChunk: options.loadSummaryMapChunk,
    saveSummaryMapChunk: options.saveSummaryMapChunk,
    loadSummaryReduceChunk: options.loadSummaryReduceChunk,
    saveSummaryReduceChunk: options.saveSummaryReduceChunk,
    maxRepairAttempts: 2,
    requestJson: options.requestJson,
    requestStream: options.requestStream,
    onProgress: options.onProgress
  });
  const tableEnrichment = enrichSummaryWithTableKnowledge(options.parsePackage, baseSummary);
  const summary = tableEnrichment.summary;
  workflowDiag('table.coverage', tableEnrichment.diagnostics);
  await emitArtifact(options.onArtifact, 'summary', summary);
  const linkCandidates = findLinkCandidates({ title: summary.document_title, content: summary }, options.existingCards || [], { limit: 20 });
  let atomResult = options.atomResult;
  if (atomResult) {
    const cachedAggregate = validateAtomizationResult(atomResult, summary, options.schemas.atoms);
    if (cachedAggregate.errors.length) {
      workflowDiag('atomization.aggregate.cacheRejected', {
        errors: cachedAggregate.errors,
        expectedPoints: (summary.key_points || []).length
      });
      atomResult = null;
    } else {
      atomResult = cachedAggregate.value;
      workflowDiag('atomization.aggregate.cacheHit', {
        points: (summary.key_points || []).length,
        atoms: atomResult.atoms.length
      });
    }
  }
  atomResult = atomResult || await atomizeSummary({
    summary,
    atomPrompt: options.prompts.atoms,
    typeMapping: options.prompts.typeMapping,
    tagLibrary: options.prompts.tagLibrary,
    linkCandidates,
    atomSchema: options.schemas.atoms,
    maxPointsPerRequest: options.maxPointsPerRequest,
    atomizationConcurrency: options.atomizationConcurrency,
    signal: options.signal,
    loadAtomBatch: options.loadAtomBatch,
    saveAtomBatch: options.saveAtomBatch,
    requestJson: options.requestJson,
    onProgress: options.onProgress
  });
  const consolidation = consolidateAtoms(atomResult.atoms || []);
  atomResult = Object.assign({}, atomResult, { atoms: consolidation.atoms, consolidation: consolidation.metrics });
  await emitArtifact(options.onArtifact, 'atoms', atomResult);

  const existingFingerprints = new Set([
    ...(options.existingFingerprints || []),
    ...(options.existingCards || []).map((card) => card.atom_fingerprint).filter(Boolean)
  ]);
  const accepted = [];
  const alreadyPersisted = [];
  const review = [];
  const hardRejected = [];
  const pageCount = Array.isArray(options.parsePackage.pages) && options.parsePackage.pages.length
    ? options.parsePackage.pages.length
    : Number(options.parsePackage.total_pages || options.parsePackage.page_count || 0);
  const shortDocumentMaxCards = Math.max(5, Number(options.shortDocumentMaxCards) || 20);
  const quantityAnomaly = pageCount > 0 && pageCount <= 3 && (atomResult.atoms || []).length > shortDocumentMaxCards;
  const tableCoverageWarning = summary.table_coverage?.warning || null;
  const noEligibleSourceBlocks = Array.isArray(options.parsePackage.blocks) && options.parsePackage.blocks.length > 0
    && !options.parsePackage.blocks.some((block) => block?.card_eligible === true && String(block?.raw?.text || '').trim());
  const provenanceDiagnostics = {};
  const evidenceReconciliationMetrics = { exact: 0, reconciled: 0, ambiguous: 0, not_found: 0, missing_locator: 0 };
  for (const atom of atomResult.atoms || []) {
    atom.source = Object.assign({}, atom.source || {}, {
      source_link: `[[${options.parsePackage.source_path}]]`
    });
    const alignment = typeof reconcileEvidence === 'function'
      ? reconcileEvidence(options.parsePackage, atom.source.evidence_quote, atom.source.source_provenance || {})
      : { ok: false, attempted: false, reason: 'repair_unavailable' };
    atom.source.evidence_repair = alignment.ok
      ? { attempted: true, repaired: !!alignment.repaired, method: alignment.method, score: alignment.score, margin: alignment.margin }
      : { attempted: true, repaired: false, reason: alignment.reason, best_score: alignment.best_score, margin: alignment.margin };
    if (alignment.ok) {
      evidenceReconciliationMetrics[alignment.repaired ? 'reconciled' : 'exact'] += 1;
    } else if (/ambiguous/.test(String(alignment.reason))) {
      evidenceReconciliationMetrics.ambiguous += 1;
    } else if (/locator_missing/.test(String(alignment.reason))) {
      evidenceReconciliationMetrics.missing_locator += 1;
    } else {
      evidenceReconciliationMetrics.not_found += 1;
    }
    if (alignment.ok) {
      atom.source.evidence_quote = alignment.quote;
      atom.source.source_provenance = alignment.locator;
      atom.source.source_locator = alignment.label;
      atom.source.source_page = alignment.locator.page || '';
      atom.source.block_id = alignment.locator.block_id || atom.source.block_id;
      atom.source.locator_precision = alignment.locator.precision;
      atom.source.provenance_verified = true;
      atom.source.context = alignment.context || evidenceContextForBlock(options.parsePackage, alignment.locator.block_id);
    } else if (Object.keys(options.parsePackage?.evidence_index || {}).length) {
      const requestedId = String(atom.source?.source_provenance?.block_id || atom.source?.block_id || '');
      const quote = String(atom.source?.evidence_quote || '');
      let entry = requestedId ? options.parsePackage.evidence_index[requestedId] : null;
      if (!entry && quote) {
        const matches = Object.values(options.parsePackage.evidence_index).filter((candidate) =>
          candidate.card_eligible !== false && String(candidate.raw_text || '').includes(quote));
        if (matches.length === 1) entry = matches[0];
      }
      const verified = !!entry && entry.card_eligible !== false && !!quote && String(entry.raw_text || '').includes(quote);
      atom.source.provenance_verified = verified;
      if (verified) {
        atom.source.block_id = entry.block_id;
        atom.source.source_provenance = Object.assign({}, entry.locator, { block_id: entry.block_id, precision: 'block-exact' });
        atom.source.source_locator = `${entry.locator.scheme}:${entry.locator.value}`;
        atom.source.locator_precision = 'block-exact';
      } else {
        atom.source.source_locator = '';
        provenanceDiagnostics.BLOCK_EVIDENCE_UNVERIFIED = (provenanceDiagnostics.BLOCK_EVIDENCE_UNVERIFIED || 0) + 1;
      }
    } else if (/^(mineru-api|paddleocr-api)$/.test(String(options.parsePackage?.parser || ''))) {
      const verified = verifyLocator(options.parsePackage, atom.source.evidence_quote, atom.source.source_provenance);
      atom.source.provenance_verified = verified.ok;
      if (!verified.ok) {
        atom.source.source_locator = '';
        provenanceDiagnostics[verified.reason] = (provenanceDiagnostics[verified.reason] || 0) + 1;
      } else {
        atom.source.source_locator = verified.label;
        atom.source.source_page = verified.locator.page || '';
        atom.source.locator_precision = verified.locator.precision;
      }
    }
    reconcileAtomLinks(atom, linkCandidates);
    normalizePresentationFields(atom);
    expandEvidenceWithinVerifiedBlock(options.parsePackage, atom);
    const fingerprint = atomFingerprint(atom);
    const labelsValid = typeof options.validateLabels === 'function' ? options.validateLabels(atom) : true;
    const routeValid = atom.library === classification.library && atom.folder_type === classification.folder_type;
    const matchingExisting = (options.existingCards || []).filter((card) => card.atom_fingerprint === fingerprint);
    const persistedIds = new Set(options.persistedCardIds || []);
    const alreadyPersistedCard = matchingExisting.find((card) =>
      card.source_hash === options.sourceHash && persistedIds.has(card.card_id));
    const duplicate = !alreadyPersistedCard && existingFingerprints.has(fingerprint);
    const evidenceQuote = String(atom.source?.evidence_quote || '');
    const resolvedBlockId = String(atom.source?.source_provenance?.block_id || atom.source?.block_id || '');
    const excludedEvidenceBlock = resolvedBlockId
      ? (options.parsePackage.blocks || []).find((block) =>
        String(block?.block_id || '') === resolvedBlockId && block?.card_eligible === false)
      : null;
    const unverifiedVisualApproval = options.parsePackage.source_type === 'pdf'
      && /(批准|审批通过|已签署|approved|accepted)/i.test(`${atom.title || ''}\n${atom.content || ''}\n${evidenceQuote}`)
      && (options.parsePackage.pages || []).some((page) => page?.visual?.approval_status === 'unverified');
    // Reserve every fingerprint immediately, including review/rejected atoms. Otherwise
    // identical atoms later in the same provider response can create duplicate review
    // items and may both be approved into the same stable file.
    existingFingerprints.add(fingerprint);
    const confidence = calculateConfidence({
      parsePackage: options.parsePackage,
      classification,
      atom,
      schemaValid: true,
      routeValid,
      labelsValid,
      duplicate,
      autoApproveConfidenceThreshold: options.autoApproveConfidenceThreshold
    });
    const validationReport = buildValidationReport({
      schemaValid: true,
      routeValid,
      tagsValid: labelsValid,
      sourceLinkValid: !!atom.source?.source_link,
      parentSummaryValid: true,
      evidenceFound: atom.source?.provenance_verified === true,
      evidenceMatchScore: confidence.components?.evidence || 0,
      numberConsistency: !confidence.material_differences?.factComparison?.blocking,
      materialDifferences: confidence.material_differences,
      atomicityScore: confidence.components?.atom_quality || 0,
      duplicateScore: duplicate ? 1 : 0,
      confidenceComponents: confidence.components || {},
      finalDecision: confidence.decision
    });
    const card = buildCardRecord({
      atom,
      route,
      sourceHash: options.sourceHash,
      confidence,
      versions: options.versions,
      now: options.now,
      businessTimeZone: options.businessTimeZone
    });
    card.validation_report = validationReport;
    if (alreadyPersistedCard) {
      alreadyPersisted.push({
        atom_id: atom.atom_id,
        card_id: alreadyPersistedCard.card_id,
        path: alreadyPersistedCard.path,
        status: 'already_persisted'
      });
      continue;
    }
    const rejectCodes = [];
    if (duplicate) rejectCodes.push('DUPLICATE_CONFLICT');
    if (excludedEvidenceBlock || noEligibleSourceBlocks) rejectCodes.push('UNSUPPORTED_SOURCE_BLOCK');
    if (unverifiedVisualApproval) rejectCodes.push('UNSAFE_UNVERIFIED_VISUAL_CLAIM');
    if (rejectCodes.length) {
      hardRejected.push({
        atom_id: atom.atom_id, atom, proposed_card: card, status: 'rejected',
        reason_codes: rejectCodes, non_overridable: true
      });
    } else if (confidence.decision === 'auto_ingest') {
      accepted.push(card);
    } else {
      const reasons = [...confidence.hard_rules, ...(atom.validation_issues || [])];
      if (excludedEvidenceBlock) reasons.push(`来源块不可生成卡片：${excludedEvidenceBlock.exclusion_reason || 'not_card_content'} (${excludedEvidenceBlock.block_id})`);
      if (unverifiedVisualApproval) reasons.push('视觉印章/签名仅记录可见性，未验证审批状态；禁止自动形成批准结论');
      if (noEligibleSourceBlocks) reasons.push('整份来源没有可生成卡片的知识内容块');
      if (!labelsValid && !reasons.some((reason) => /标签/.test(reason))) reasons.push('标签字典校验未通过');
      if (!routeValid && !reasons.some((reason) => /目录/.test(reason))) reasons.push('知识原子目录与文档分类不一致');
      if (duplicate && !reasons.some((reason) => /重复/.test(reason))) reasons.push('与已有知识卡片重复');
      if (!reasons.length) reasons.push(`可信度 ${confidence.score} 低于自动入库阈值 ${confidence.auto_approve_threshold}`);
      review.push({
        atom_id: atom.atom_id,
        library: atom.library,
        folder_type: atom.folder_type,
        status: 'pending',
        reasons,
        reason_codes: reviewReasonCodes(validationReport, confidence, atom.validation_issues),
        confidence,
        validationReport,
        atom,
        proposed_card: card,
        review_context: reviewContext(atom, validationReport, reasons)
      });
    }
  }
  if (Object.keys(provenanceDiagnostics).length) {
    workflowDiag('provenance.validation', {
      failed: Object.values(provenanceDiagnostics).reduce((sum, count) => sum + count, 0),
      reasons: provenanceDiagnostics
    });
  }
  workflowDiag('provenance.reconciliation', evidenceReconciliationMetrics);
  // v2.8.1: 工作流最终产出诊断——accepted/review 全空时，这条日志直接说明原子在哪一步丢的
  workflowDiag('workflow.result', {
    title: summary && summary.document_title,
    summaryKeyPoints: (summary && Array.isArray(summary.key_points)) ? summary.key_points.length : 0,
    atoms: (atomResult && Array.isArray(atomResult.atoms)) ? atomResult.atoms.length : 0,
    accepted: accepted.length,
    review: review.length,
    generated: consolidation.metrics.generated,
    merged: consolidation.metrics.merged,
    droppedNoKnowledge: consolidation.metrics.dropped_no_knowledge,
    hardRejected: hardRejected.length,
    quantityWarning: quantityAnomaly,
    autoApproveThreshold: Number(options.autoApproveConfidenceThreshold),
    truncated: !!(atomResult && atomResult._truncated)
  });
  // v1.4 (M-07): 透传截断标志，dashboard 可显示警告
  return {
    classification,
    route,
    summary,
    atomResult,
    accepted,
    alreadyPersisted,
    review,
    hardRejected,
    documentWarnings: [...(quantityAnomaly ? [{
      code: 'DOCUMENT_QUANTITY_ANOMALY',
      message: `${pageCount} 页产生 ${(atomResult.atoms || []).length} 个候选；仅记录文档级警告，不阻塞逐卡自动入库。`,
      sample_atom_ids: (atomResult.atoms || []).slice(0, 3).map((atom) => atom.atom_id)
    }] : []), ...(tableCoverageWarning ? [tableCoverageWarning] : [])],
    metrics: {
      stageCardinalities: {
        tables_found: summary.table_coverage?.tables_found || 0,
        table_subjects: summary.table_coverage?.subjects_found || 0,
        table_candidates: summary.table_coverage?.candidates_generated || 0,
        summary_points: (summary.key_points || []).length,
        atom_candidates: consolidation.metrics.generated,
        consolidated: consolidation.metrics.output,
        auto_approved: accepted.length,
        targeted_review: review.length,
        hard_rejected: consolidation.metrics.dropped_no_knowledge + hardRejected.length
      },
      candidateCards: accepted.length + review.length,
      autoApproved: accepted.length,
      reviewPending: review.length,
      hardRejected: consolidation.metrics.dropped_no_knowledge + hardRejected.length,
      alreadyPersisted: alreadyPersisted.length,
      merged: consolidation.metrics.merged,
      // Compatibility aliases for pre-v2.18 consumers.  New UI and diagnostics
      // must use candidateCards/hardRejected.
      cardsGenerated: accepted.length + review.length,
      cardsRejected: consolidation.metrics.dropped_no_knowledge + hardRejected.length,
      automaticallyRepaired: (atomResult.atoms || []).filter((atom) => atom.source?.evidence_repair?.repaired).length,
      reasonHistograms: {
        review: histogram(review.flatMap((item) => item.reason_codes || [])),
        rejected: histogram(hardRejected.flatMap((item) => item.reason_codes || [])),
        merge: { SEMANTIC_COMPATIBLE: consolidation.metrics.merged },
        drop: { NON_REUSABLE_NOISE: consolidation.metrics.dropped_no_knowledge }
      },
      providerRequestsAdded: 0
    },
    truncated: !!(atomResult && atomResult._truncated),
    truncatedCompleted: Array.isArray(atomResult?.coverage?.point_ids) ? atomResult.coverage.point_ids.length : (atomResult?.atoms?.length || 0)
  };
}

function histogram(values) {
  return (values || []).reduce((out, value) => {
    out[value] = (out[value] || 0) + 1;
    return out;
  }, {});
}

function reviewReasonCodes(report, confidence, issues = []) {
  const codes = [];
  const failures = report.hardGateFailures || [];
  if (failures.some((value) => ['EVIDENCE', 'FACT_MISSING_IN_EVIDENCE', 'UNSUPPORTED_ADDITION',
    'FACT_CONFLICT', 'AMBIGUOUS_CONVERSION', 'MODALITY_CONFLICT', 'CONDITION_CONFLICT',
    'DATE_CONFLICT', 'SUBJECT_CONFLICT'].includes(value))) codes.push('GROUNDING_DEFECT');
  if (failures.some((value) => ['SCHEMA', 'ROUTING', 'TAG', 'SOURCE_LINK', 'UNSAFE_PATH'].includes(value))) codes.push('SCHEMA_ROUTE_DEFECT');
  if (failures.includes('DUPLICATE')) codes.push('DUPLICATE_CONFLICT');
  if ((issues || []).some((value) => /原子|拆分|完整|上下文|fragment|atomic/i.test(String(value)))) codes.push('SLICING_DEFECT');
  if (!codes.length && confidence.decision !== 'auto_ingest') codes.push('SOFT_CONFIDENCE');
  return [...new Set(codes)];
}

function normalizePresentationFields(atom) {
  const repaired = [];
  for (const key of ['Category', 'TagL1', 'TagL2', 'Info_Type', 'Event_Type', 'Card_Type', 'Map_Index']) {
    if (typeof atom[key] !== 'string') continue;
    const normalized = atom[key].normalize('NFKC').replace(/\s+/g, ' ').trim();
    if (normalized !== atom[key]) { atom[key] = normalized; repaired.push(key); }
  }
  if (repaired.length) atom.presentation_repairs = repaired;
  return atom;
}

function evidenceContextForBlock(parsePackage, blockId) {
  const block = (parsePackage?.blocks || []).find((item) => String(item.block_id) === String(blockId)) || {};
  const metadata = block.metadata || {};
  const locator = block.locator || {};
  return {
    section: metadata.section || metadata.heading || locator.section || '',
    table: {
      sheet: metadata.sheet || locator.sheet || '', range: metadata.range || locator.range || '',
      row: metadata.row ?? locator.row ?? '', column: metadata.column ?? locator.column ?? '',
      headers: metadata.headers || metadata.header_path || locator.headers || []
    },
    message: {
      thread_id: metadata.thread_id || locator.thread_id || '', message_id: metadata.message_id || locator.message_id || '',
      from: metadata.from || '', date: metadata.date || '', subject: metadata.subject || ''
    }
  };
}

function expandEvidenceWithinVerifiedBlock(parsePackage, atom) {
  if (typeof evidenceConsistency !== 'function' || typeof extractedFacts !== 'function') {
    return { expanded: false, reason: 'difference_policy_unavailable' };
  }
  if (atom?.source?.provenance_verified !== true) return { expanded: false, reason: 'evidence_unverified' };
  const blockId = String(atom.source?.source_provenance?.block_id || atom.source?.block_id || '');
  const entry = blockId && parsePackage?.evidence_index?.[blockId];
  if (!entry || String(entry.block_id) !== blockId || entry.card_eligible === false) {
    return { expanded: false, reason: 'verified_block_unavailable' };
  }
  const quote = String(atom.source.evidence_quote || '');
  const blockText = String(entry.raw_text || '');
  if (!quote || !blockText.includes(quote)) return { expanded: false, reason: 'quote_outside_verified_block' };
  const claim = atomText(atom);
  const quoteResult = evidenceConsistency(claim, quote);
  if (quoteResult.ok) {
    atom.source.bound_evidence_text = quote;
    return { expanded: false, reason: 'quote_sufficient' };
  }
  const blockResult = evidenceConsistency(claim, blockText);
  atom.source.bound_evidence_text = blockText;
  atom.source.evidence_scope = {
    expanded: true,
    block_id: blockId,
    crossed_blocks: false,
    method: 'verified_block_exact'
  };
  if (blockResult.ok || blockResult.status !== quoteResult.status) {
    atom.source.review_evidence_excerpt = boundedBlockExcerpt(blockText, quote, claim);
  }
  return { expanded: true, reason: blockResult.ok ? 'verified_in_same_block' : 'same_block_still_differs' };
}

function boundedBlockExcerpt(blockText, quote, claim) {
  const facts = extractedFacts(claim);
  const anchors = [quote, ...facts.map((fact) => fact.raw)].filter(Boolean);
  const offsets = anchors.map((anchor) => blockText.normalize('NFKC').indexOf(String(anchor).normalize('NFKC'))).filter((offset) => offset >= 0);
  const center = offsets.length ? Math.min(...offsets) : Math.max(0, blockText.indexOf(quote));
  const start = Math.max(0, center - 240);
  const end = Math.min(blockText.length, Math.max(start + 480, center + 720));
  return `${start ? '…' : ''}${blockText.slice(start, end).trim()}${end < blockText.length ? '…' : ''}`;
}

function consolidateAtoms(atoms) {
  const output = [];
  let merged = 0;
  let dropped = 0;
  for (const original of atoms || []) {
    const atom = JSON.parse(JSON.stringify(original));
    const text = atomText(atom);
    if (!isReusableKnowledge(text)) { dropped += 1; continue; }
    const duplicate = output.findIndex((item) => compatible(item, atom, 0.86, false));
    const adjacent = output.length && compatible(output[output.length - 1], atom, 0.76, true) ? output.length - 1 : -1;
    const index = duplicate >= 0 ? duplicate : adjacent;
    if (index < 0) output.push(atom);
    else { output[index] = mergeAtoms(output[index], atom); merged += 1; }
  }
  return { atoms: output, metrics: { generated: (atoms || []).length, merged, dropped_no_knowledge: dropped, output: output.length } };
}
function isReusableKnowledge(text) {
  const value = String(text || '').trim();
  if (value.length < 8) return false;
  if (/^(?:目录|contents?|版权|copyright|联系方式|contact|扫码|qr\s*code|退订|unsubscribe)[\s:：\-—]*$/iu.test(value)) return false;
  return /[\p{L}\p{N}]/u.test(value);
}
function atomText(atom) {
  const content = typeof atom?.content === 'string' ? atom.content : Object.entries(atom?.content || {})
    .filter(([key]) => !['point_ids', 'source_point_ids', 'evidence_ids'].includes(key))
    .map(([, value]) => typeof value === 'string' ? value : JSON.stringify(value)).join(' ');
  return `${atom?.title || ''} ${content}`.replace(/\s+/g, ' ').trim();
}
function atomFacts(atom) {
  return new Set((atomText(atom).normalize('NFKC').match(
    /(?:\d{1,4}[-/.年]\d{1,2}(?:[-/.月]\d{1,2}日?)?|\d+(?:[.,]\d+)?\s*(?:%|‰|[a-zµμ°℃℉²³/·]+|[\p{Script=Han}]{0,4}))/giu
  ) || []).map((value) => value.toLowerCase().replace(/[\s,]/g, '')));
}
function contentTerms(atom) {
  const text = atomText(atom).toLowerCase().normalize('NFKC');
  const words = text.match(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]|[a-z][a-z0-9_-]{1,}/giu) || [];
  const stop = new Set(['the', 'and', 'for', 'with', 'this', 'that', 'from', '以及', '或者', '可以', '进行', '应当']);
  return new Set(words.filter((word) => !stop.has(word)));
}
function propositionType(atom) {
  const explicit = String(atom.card_kind || atom.Info_Type || atom.Event_Type || '').toLowerCase();
  const text = atomText(atom);
  if (/event|事件|会议|发送|received|sent|approved|完了|実施/u.test(`${explicit} ${text}`)) return 'event';
  if (/步骤|procedure|手順|步骤|先.+再|第[一二三四五\d]+步/u.test(text)) return 'procedure';
  if (/必须|不得|禁止|应(?:当|该)?|must|shall|may not|prohibited|禁止|べき|なければ/u.test(text)) return 'requirement';
  if (/记录|record|台账|ログ|履歴/u.test(text)) return 'record';
  return 'claim';
}
function modality(atom) {
  const text = atomText(atom).toLowerCase();
  if (/不得|禁止|严禁|must not|shall not|may not|prohibited|禁止/u.test(text)) return 'prohibited';
  if (/必须|务必|须|must|shall|required|なければ|必須/u.test(text)) return 'must';
  if (/可以|可(?:以)?|may|optional|任意|可能/u.test(text)) return 'may';
  return 'asserted';
}
function conditionSignature(atom) {
  const clauses = atomText(atom).match(/(?:如果|若|当|除非|仅当|在.+?时|if|when|unless|except|provided that|場合|とき|ただし)[^。！？!?;；]{0,100}/giu) || [];
  return new Set(clauses.flatMap((clause) => [...contentTerms({ content: clause })]));
}
function sourceNeighborhood(atom) {
  const provenance = atom.source?.source_provenance || {};
  return String(provenance.section_id || provenance.sheet || provenance.message_id || provenance.thread_id
    || provenance.block_id || atom.source?.block_id || atom.source?.source_locator || '');
}
function equalSet(a, b) { return a.size === b.size && [...a].every((item) => b.has(item)); }
function atomSimilarity(a, b) {
  const aa = contentTerms(a);
  const bb = contentTerms(b);
  let hit = 0; for (const item of aa) if (bb.has(item)) hit += 1;
  return 2 * hit / Math.max(1, aa.size + bb.size);
}
function compatible(a, b, threshold, adjacentOnly) {
  if (propositionType(a) !== propositionType(b) || modality(a) !== modality(b)) return false;
  if (!equalSet(atomFacts(a), atomFacts(b)) || !equalSet(conditionSignature(a), conditionSignature(b))) return false;
  if (atomSimilarity(a, b) < threshold) return false;
  const leftLocator = sourceNeighborhood(a);
  const rightLocator = sourceNeighborhood(b);
  const sameEvidence = !!leftLocator && leftLocator === rightLocator;
  const equivalentQuote = String(a.source?.evidence_quote || '').trim()
    && String(a.source?.evidence_quote || '').trim() === String(b.source?.evidence_quote || '').trim();
  if (!sameEvidence && !equivalentQuote) return false;
  return !adjacentOnly || sameEvidence;
}
function mergeAtoms(a, b) {
  const merged = JSON.parse(JSON.stringify(a));
  merged.content = Object.assign({}, typeof a.content === 'object' ? a.content : { statement: a.content }, {
    point_ids: [...new Set([...(a.content?.point_ids || []), ...(b.content?.point_ids || [])])]
  });
  merged.merged_atom_ids = [...new Set([...(a.merged_atom_ids || [a.atom_id]), ...(b.merged_atom_ids || [b.atom_id])])];
  merged.merged_evidence = [...(a.merged_evidence || [a.source]), ...(b.merged_evidence || [b.source])];
  merged.provenance = {
    atom_ids: merged.merged_atom_ids,
    point_ids: merged.content.point_ids,
    evidence: merged.merged_evidence
  };
  return merged;
}
function reviewContext(atom, report, reasons) {
  const statement = atomText(atom);
  const evidenceQuote = String(atom.source?.review_evidence_excerpt || atom.source?.bound_evidence_text || atom.source?.evidence_quote || '');
  const sourceContext = atom.source?.context || {};
  return {
    statement, evidence_quote: evidenceQuote,
    locator: String(atom.source?.source_locator || ''), page: atom.source?.source_page || atom.source?.source_provenance?.page || '',
    block_id: atom.source?.source_provenance?.block_id || atom.source?.block_id || '',
    section: sourceContext.section || sourceContext.table?.sheet || sourceContext.message?.subject || '',
    source_context: sourceContext,
    material_differences: report.materialDifferences || {
      status: 'not_applicable',
      modality: { status: 'matched' },
      conditions: { status: 'matched' }
    },
    automatic_repair: atom.source?.evidence_repair || { attempted: false },
    gate_checklist: { source_evidence: report.evidenceFound, numbers: report.numberConsistency,
      schema: report.schemaValid, route: report.routeValid, tags: report.tagsValid, duplicate: report.duplicateScore < 1 },
    recommended_action: report.hardGateFailures?.length ? '重新切片或修正原文定位；必要检查未通过，不能人工强制批准。' : '抽查原文差异；确认只是可信度偏低后，可填写审核理由批量批准。',
    developer_details_hidden: true,
    plain_reasons: reasons.map((reason) => /定位|证据|逐字/.test(reason) ? '尚未找到唯一、逐字一致的原文依据'
      : /可信度/.test(reason) ? '必要检查已通过，但综合可信度未达到自动入库门槛' : String(reason))
  };
}

function reconcileAtomLinks(atom, candidates) {
  const validation = validateRelations(atom.related_candidates || [], candidates);
  const byId = new Map(candidates.map((candidate) => [candidate.card_id, candidate]));
  atom.related_candidates = validation.valid.map((relation) => {
    const target = byId.get(relation.target_card_id);
    const path = String(target.path || '').replace(/\.md$/i, '');
    return { target: `[[${path}]]`, relation: relation.relation };
  });
}

async function emitArtifact(handler, name, value) {
  if (typeof handler === 'function') await handler(name, value);
}

module.exports = { runKnowledgeWorkflow, consolidateAtoms, normalizePresentationFields, reviewContext, expandEvidenceWithinVerifiedBlock };

},
/**
 * @module src/core/production-ux
 * Human explanations and stable, durable pipeline progress.
 */
"src/core/production-ux.js": function(require, module, exports) {
const CAUSES = [
  { test: /evidence|证据.*(?:定位|缺失|找不到)|locator/i, kind: '证据位置缺失', happened: '系统没有在原文中找到足够明确的依据位置。', effect: '这条内容暂时不能可靠地追溯到源文档。', action: '请对照原文补充页码或原文摘录，再交由人工确认。' },
  { test: /schema|结构校验|字段.*(?:无效|缺失)|validation/i, kind: '内容格式不完整', happened: '生成结果缺少必要信息，或信息格式不符合要求。', effect: '直接入库可能造成字段缺失或后续检索异常。', action: '建议重新生成；仍失败时请人工补齐必填信息。' },
  { test: /数量异常|threshold|超过阈值|过多|过少/i, kind: '数量需要确认', happened: '本次生成的内容数量明显高于或低于通常范围。', effect: '可能存在过度拆分、遗漏或重复内容。', action: '请抽查原文与条目数量；确认合理后可批准符合条件的条目。' },
  { test: /provider|供应商|MiniMax|MinerU|Paddle|HTTP|response|响应/i, kind: '外部服务返回异常', happened: '外部处理服务没有返回可直接使用的结果。', effect: '当前文件或条目尚未完成处理。', action: '稍后重试；若反复发生，请检查服务连接和账号状态。' },
  { test: /upload|上传|consent|授权|保密审批/i, kind: '尚未确认上传', happened: '系统还没有获得把该文件交给云端解析服务的确认。', effect: '文件没有上传，处理也没有继续。', action: '确认文件符合保密要求后重新处理，并在提示中选择是否允许上传。' },
  { test: /标签|目录|分类/i, kind: '分类信息需要确认', happened: '系统无法把内容可靠地放入现有分类。', effect: '直接入库可能进入错误目录，影响查找。', action: '请选择正确分类或标签后再批准。' },
  { test: /重复|duplicate/i, kind: '可能已有相同内容', happened: '系统发现知识库中可能已经存在相同或非常相近的内容。', effect: '直接入库可能产生重复卡片。', action: '请对比已有内容，选择保留、合并或拒绝。' }
];

function explainIssue(value) {
  const reasons = Array.isArray(value?.reasons)
    ? value.reasons
    : [value?.message, value?.technicalMessage, value?.code, value?.category, value?.provider, value];
  const raw = reasons.map(String).filter(Boolean);
  const joined = raw.join('；');
  const known = CAUSES.find((cause) => cause.test.test(joined));
  const fallback = {
    kind: '需要人工确认',
    happened: '这条内容没有通过自动检查。',
    effect: '在确认之前不会自动入库，已有可靠内容不受影响。',
    action: '请对照原文检查；可选择重新生成、拒绝或转为人工处理。'
  };
  return Object.assign({}, known || fallback, { technical: value, raw });
}

const STAGE_BASE = { start: 0, parsing: 8, classification: 22, classifying: 22, 'summary-map': 32,
  summarizing: 32, atomization: 58, atomizing: 58, validating: 82, writing: 90, complete: 100 };
const STAGE_SPAN = { parsing: 14, classification: 10, classifying: 10, 'summary-map': 26,
  summarizing: 26, atomization: 24, atomizing: 24, validating: 8, writing: 9 };
function pipelineProgress(task, progress = task?.progress || {}) {
  const stage = progress.stage || task?.status || 'start';
  const total = Number(progress.batchTotal) || Number(progress.chunkTotal) || Number(progress.totalPages) || 0;
  const done = Number(progress.batchIndex) || Number(progress.chunkIndex) || Number(progress.extractedPages) || 0;
  const fraction = total > 0 ? Math.max(0, Math.min(1, done / total)) : 0;
  const calculated = (STAGE_BASE[stage] || 0) + (STAGE_SPAN[stage] || 0) * fraction;
  const previous = Number(progress.completedWork ?? task?.progress?.completedWork) || 0;
  const durable = ['written', 'needs_review', 'completed_no_output'].includes(task?.status) && stage === 'complete';
  return { completedWork: durable ? 100 : Math.min(99, Math.max(previous, calculated)), durable };
}

function queuePosition(task, tasks = []) {
  if (!task) return { ordinal: 0, total: 0, label: '处理队列 0/0' };
  let ordinal = Number(task.queue_order) || 0;
  let total = Number(task.queue_total) || 0;
  if (!ordinal || !total) {
    const ordered = [...tasks].sort((a, b) => String(a.created_at || '').localeCompare(String(b.created_at || '')));
    ordinal = Math.max(1, ordered.findIndex((item) => item.task_id === task.task_id) + 1);
    total = ordered.length;
  }
  return { ordinal, total, label: `处理队列 ${ordinal}/${total}` };
}

module.exports = { explainIssue, pipelineProgress, queuePosition };

},
/**
 * @module src/core/completion-ui
 * Pure rules for authoritative completion rendering and stale progress rejection.
 */
"src/core/completion-ui.js": function(require, module, exports) {
const { PROCESSING_STATUSES: PROCESSING } = require("src/core/task.js");
const { deriveVerifiedFacts } = require("src/knowledge-write-port.js");
const TERMINAL = new Set(['written', 'needs_review', 'completed_no_output', 'needs_ocr', 'skipped', 'unsupported', 'unsupported_media', 'cancelled', 'rolled_back']);

function pendingReviewCount(tasks) {
  return (tasks || []).reduce((sum, task) => {
    if (!['needs_review', 'completed_no_output'].includes(task.status) || !task.artifacts?.review) return sum;
    return sum + (Number(task.result_counts?.review) || (Array.isArray(task.review_atom_ids) ? new Set(task.review_atom_ids.map(String).filter(Boolean)).size : 0));
  }, 0);
}

function canonicalTaskUiState(tasks, completedTaskId) {
  const rows = Array.isArray(tasks) ? tasks : [];
  const reviewCount = pendingReviewCount(rows);
  return {
    rows,
    reviewCount,
    needsReview: reviewCount,
    persistedReviewItemCount: rows.reduce((sum, task) =>
      sum + (task.artifacts?.review && Array.isArray(task.review_atom_ids)
        ? new Set(task.review_atom_ids.map(String).filter(Boolean)).size : 0), 0),
    pending: rows.filter((task) => task.status === 'queued' || task.status === 'discovered').length,
    processing: rows.filter((task) => PROCESSING.has(task.status)).length,
    failed: rows.filter((task) => task.status === 'failed').length,
    written: rows.reduce((sum, task) => sum + deriveVerifiedFacts(task).count, 0),
    completedTaskId
  };
}

function shouldAcceptIncrementalProgress(task, terminalTaskIds) {
  return !!task && PROCESSING.has(task.status) && !(terminalTaskIds && terminalTaskIds.has(task.task_id));
}

function completionUiSnapshot(tasks, completedTaskId) {
  const canonical = canonicalTaskUiState(tasks, completedTaskId);
  const rows = canonical.rows;
  const completed = rows.find((task) => task.task_id === completedTaskId);
  const active = rows.find((task) => PROCESSING.has(task.status));
  const runId = completed?.queue_run_id || active?.queue_run_id || '';
  const cohort = runId ? rows.filter((task) => task.queue_run_id === runId) : rows;
  const total = Number(completed?.queue_total || active?.queue_total)
    || Math.max(0, ...cohort.map((task) => Number(task.queue_total) || 0))
    || cohort.length;
  const finished = cohort.filter((task) => TERMINAL.has(task.status)).length;
  const activeProgress = active && Number(active.progress?.completedWork || 0);
  const overallPercent = total > 0
    ? Math.min(active ? 99.9 : 100, ((finished + (activeProgress || 0) / 100) / total) * 100)
    : 0;
  return {
    taskCount: rows.length,
    queuedCount: rows.filter((task) => task.status === 'queued').length,
    activeCount: rows.filter((task) => PROCESSING.has(task.status)).length,
    activeTask: active || null,
    reviewCount: canonical.reviewCount,
    persistedReviewItemCount: canonical.persistedReviewItemCount,
    counts: canonical,
    runId,
    overallPercent
  };
}

module.exports = { canonicalTaskUiState, completionUiSnapshot, pendingReviewCount, shouldAcceptIncrementalProgress };

},
/**
 * @module src/core/selected-regeneration
 * Pure state transitions for safe, resumable regeneration of attributed review atoms.
 */
"src/core/selected-regeneration.js": function(require, module, exports) {
function pointIdsOf(item) {
  return [...new Set((item?.atom?.content?.point_ids || []).map(String).filter(Boolean))].sort();
}

function requestId(taskId, atomIds, pointIds) {
  const value = `${taskId}|${[...atomIds].sort().join('|')}|${[...pointIds].sort().join('|')}`;
  let hash = 2166136261;
  for (const char of value) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return `selected-${(hash >>> 0).toString(16)}`;
}

function createSelectedRegenerationPlan({ taskId, reviewItems, allAtoms, selectedAtomIds, summary }) {
  const selected = new Set(selectedAtomIds || []);
  const chosen = (reviewItems || []).filter((item) => selected.has(item.atom_id));
  if (!chosen.length) throw new Error('请先选择至少一项');
  const missing = chosen.filter((item) => !pointIdsOf(item).length);
  if (missing.length) {
    throw new Error('所选内容缺少知识点归属，无法安全地只重新生成这些内容。请使用“仅重做知识原子”重做整个文件。');
  }
  const pointIds = [...new Set(chosen.flatMap(pointIdsOf))].sort();
  const pointSet = new Set(pointIds);
  const affectedAtoms = (allAtoms || []).filter((atom) =>
    (atom?.content?.point_ids || []).some((id) => pointSet.has(String(id))));
  const outside = affectedAtoms.filter((atom) => !selected.has(atom.atom_id));
  if (outside.length) {
    throw new Error('所选知识点还关联到未选或已入库内容，无法在不影响它们的情况下单独重新生成。请使用“仅重做知识原子”重做整个文件。');
  }
  const keyPoints = (summary?.key_points || []).filter((point) => pointSet.has(String(point.point_id)));
  if (keyPoints.length !== pointIds.length) {
    throw new Error('总结中的知识点归属已不完整，无法安全地只重新生成所选内容。请使用“仅重做知识原子”重做整个文件。');
  }
  const evidenceIds = new Set(keyPoints.flatMap((point) => point.evidence_ids || []));
  const selectedSummary = Object.assign({}, summary, {
    executive_summary: keyPoints.map((point) => point.content).join('；'),
    key_points: keyPoints,
    evidence: (summary?.evidence || []).filter((item) => evidenceIds.has(item.evidence_id)),
    coverage: Object.assign({}, summary?.coverage || {}, { point_ids: pointIds, complete: true })
  });
  return {
    request_id: requestId(taskId, chosen.map((item) => item.atom_id), pointIds),
    atom_ids: chosen.map((item) => item.atom_id).sort(),
    point_ids: pointIds,
    selected_summary: selectedSummary
  };
}

function mergeSelectedRegenerationResult(artifact, plan, result, now) {
  const selected = new Set(plan.atom_ids);
  const untouched = (artifact.items || []).filter((item) => !selected.has(item.atom_id));
  const regenerated = (result.review || []).map((item) => Object.assign({}, item, {
    regeneration_request_id: plan.request_id
  }));
  const audit = {
    request_id: plan.request_id,
    action: 'regenerate_selected',
    atom_ids: plan.atom_ids,
    point_ids: plan.point_ids,
    status: 'completed',
    accepted_card_ids: (result.accepted || []).map((card) => card.card_id),
    review_atom_ids: regenerated.map((item) => item.atom_id),
    completed_at: now
  };
  return Object.assign({}, artifact, {
    items: [...untouched, ...regenerated],
    regeneration_requests: [
      ...(artifact.regeneration_requests || []).filter((item) => item.request_id !== plan.request_id),
      audit
    ],
    handled: [...(artifact.handled || []), ...(artifact.items || [])
      .filter((item) => selected.has(item.atom_id))
      .map((item) => Object.assign({}, item, {
        review_action: 'regenerate_selected',
        review_action_at: now,
        regeneration_request_id: plan.request_id
      }))]
  });
}

function markManualPending(artifact, atomIds, now) {
  const selected = new Set(atomIds || []);
  return Object.assign({}, artifact, {
    items: (artifact.items || []).map((item) => selected.has(item.atom_id)
      ? Object.assign({}, item, { status: 'manual_pending', manual_requested_at: now })
      : item),
    manual_requests: [
      ...(artifact.manual_requests || []),
      ...(artifact.items || []).filter((item) => selected.has(item.atom_id))
        .map((item) => ({ atom_id: item.atom_id, status: 'pending', requested_at: now }))
    ]
  });
}

function archiveRejected(artifact, atomIds, now) {
  const selected = new Set(atomIds || []);
  const rejected = (artifact.items || []).filter((item) => selected.has(item.atom_id));
  return Object.assign({}, artifact, {
    items: (artifact.items || []).filter((item) => !selected.has(item.atom_id)),
    rejected: [...(artifact.rejected || []), ...rejected.map((item) => Object.assign({}, item, {
      review_action: 'reject_selected',
      review_action_at: now
    }))]
  });
}

async function consumeSelectedRegeneration(options) {
  let result = await options.loadCheckpoint();
  if (!result) {
    result = await options.generate();
    await options.saveCheckpoint(result);
  }
  const existingIds = new Set(await options.loadExistingCardIds());
  const written = [];
  for (const card of result.accepted || []) {
    if (!existingIds.has(card.card_id)) {
      await options.writeCard(card, result.route);
      existingIds.add(card.card_id);
      written.push(card.card_id);
    }
  }
  return { result, written };
}

module.exports = {
  archiveRejected,
  consumeSelectedRegeneration,
  createSelectedRegenerationPlan,
  markManualPending,
  mergeSelectedRegenerationResult,
  pointIdsOf
};

},
/**
 * @module src/core/review-service
 * 审核面板服务：按文件夹 / 状态 / 标签分组 + 批量审批
 * @exports groupReviewItems
 * @exports applyBatchAction
 */
"src/core/review-service.js": function(require, module, exports) {
function groupReviewItems(items) {
  const groups = new Map();
  for (const item of items || []) {
    const issue = [...(item.reasons || [])].sort().join('；') || '其他异常';
    const cause = (item.reason_codes || ['UNCLASSIFIED']).join('+');
    const section = item.review_context?.section || item.review_context?.block_id || item.review_context?.locator || '未定位章节';
    const key = `${cause}|${section}`;
    if (!groups.has(key)) {
      groups.set(key, {
        group_id: `review-${hashCode(key)}`,
        library: item.library,
        folder_type: item.folder_type,
        reasons: item.reasons || [],
        reason_codes: item.reason_codes || [],
        section,
        label: `${section} · ${plainCauseLabel(cause)}`,
        items: []
      });
    }
    groups.get(key).items.push(item);
  }
  return [...groups.values()].sort((left, right) => right.items.length - left.items.length || left.label.localeCompare(right.label, 'zh-CN'));
}
function plainCauseLabel(code) {
  const labels = {
    SLICING_DEFECT: '切片边界需修正', GROUNDING_DEFECT: '原文依据需确认',
    SCHEMA_ROUTE_DEFECT: '结构或归档需修正', DUPLICATE_CONFLICT: '重复或冲突',
    SOFT_CONFIDENCE: '仅可信度偏低', UNCLASSIFIED: '其他异常'
  };
  return String(code).split('+').map((item) => labels[item] || item).join(' / ');
}

// v1.4 (M-05): 批量修正的字段白名单与校验器。
//       用户在 dashboard prompt 输入 JSON 后，必须先过 validateCorrection 才会真正落到 atom。
//       任意不在白名单的字段、类型不是 string、数值空字符串都会被拒绝。
const ALLOWED_CORRECTION_FIELDS = new Set([
  'Category', 'TagL1', 'TagL2', 'Info_Type', 'Event_Type', 'Card_Type', 'Map_Index'
]);
function validateCorrection(correction) {
  if (!correction || typeof correction !== 'object' || Array.isArray(correction)) {
    throw new Error('修正内容必须是 JSON 对象，例如 {"Category":"…","TagL1":"…"}');
  }
  const cleaned = {};
  for (const [key, value] of Object.entries(correction)) {
    if (!ALLOWED_CORRECTION_FIELDS.has(key)) {
      throw new Error(`字段 "${key}" 不在白名单（${[...ALLOWED_CORRECTION_FIELDS].join(' / ')}）内，已被拒绝`);
    }
    if (value == null || value === '') continue; // 视为"不修改该字段"
    if (typeof value !== 'string') {
      throw new Error(`字段 "${key}" 必须是字符串，当前为 ${typeof value}`);
    }
    const trimmed = value.trim();
    if (!trimmed) continue;
    if (trimmed.length > 100) {
      throw new Error(`字段 "${key}" 长度超过 100 字符`);
    }
    cleaned[key] = trimmed;
  }
  if (Object.keys(cleaned).length === 0) {
    throw new Error('没有可应用的修正字段（所有字段都是空字符串）');
  }
  return cleaned;
}

function applyBatchAction(items, action, correction = {}) {
  const statuses = {
    approve_group: 'approved_override',
    regenerate_group: 'regenerate',
    discard_group: 'discarded',
    apply_correction: 'corrected'
  };
  if (!statuses[action]) throw new Error(`不支持的批量审核操作：${action}`);
  return (items || []).map((item) => {
    const next = clone(item);
    next.status = statuses[action];
    if (action === 'apply_correction') next.atom = Object.assign({}, next.atom || {}, correction);
    return next;
  });
}

function isApprovalEligible(item) {
  if (!item || !['pending', 'corrected', 'passed', undefined].includes(item.status)) return false;
  if (item.eligible === false || item.ineligible === true) return false;
  const report = item.validationReport || item.validation_report || {};
  const hardFailures = report.nonOverridableFailures || (report.hardGateFailures || []).filter((failure) =>
    ['SCHEMA', 'ROUTING', 'SOURCE_LINK', 'EVIDENCE', 'FACT_MISSING_IN_EVIDENCE',
      'UNSUPPORTED_ADDITION', 'FACT_CONFLICT', 'AMBIGUOUS_CONVERSION', 'MODALITY_CONFLICT',
      'CONDITION_CONFLICT', 'DATE_CONFLICT', 'SUBJECT_CONFLICT', 'UNSAFE_PATH',
      'UNSUPPORTED_CONTENT', 'DUPLICATE'].includes(failure));
  if (hardFailures.length) return false;
  if (report.evidenceFound !== true || item.atom?.source?.provenance_verified !== true) return false;
  if (report.materialDifferenceStatus && !['matched', 'not_applicable'].includes(report.materialDifferenceStatus)) return false;
  const reasons = (item.reasons || []).join('；');
  return !/schema|结构校验|必填字段|证据.*(?:缺失|找不到)|逐字证据|locator missing|数字.*不存在|目录与.*不一致|重复/i.test(reasons);
}

function safeApprovalPlan(items) {
  const eligible = (items || []).filter(isApprovalEligible);
  return {
    total: (items || []).length,
    eligible: eligible.length,
    blocked: (items || []).length - eligible.length,
    eligibleIds: eligible.map((item) => item.atom_id),
    blockedIds: (items || []).filter((item) => !isApprovalEligible(item)).map((item) => item.atom_id),
    items: eligible
  };
}

function nextReviewIndex(currentIndex, remainingCount) {
  if (remainingCount <= 0) return -1;
  return Math.max(0, Math.min(Number(currentIndex) || 0, remainingCount - 1));
}

function pendingReviewItems(reviewArtifacts) {
  return (reviewArtifacts || []).flatMap((artifact) => artifact.items || []).filter((item) => item.status === 'pending' || item.status === 'corrected');
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function hashCode(value) {
  let hash = 0;
  for (const char of String(value)) hash = ((hash << 5) - hash + char.charCodeAt(0)) | 0;
  return Math.abs(hash).toString(36);
}

module.exports = { applyBatchAction, groupReviewItems, pendingReviewItems, isApprovalEligible, safeApprovalPlan, nextReviewIndex };


},
"src/core/semantic-embedding.js": function(require, module, exports) {
'use strict';
const crypto = require('crypto');

const INDEX_SCHEMA = 1;
const CACHE_SCHEMA = 1;
const SUGGESTION_SCHEMA = 1;
const INDEX_FILE = 'vector-index.v1.json';
const CACHE_FILE = 'embedding-cache.v1.json';
const SUGGESTION_FILE = 'semantic-shadow.v1.json';
const QUEUE_FILE = 'semantic-queue.v1.json';
const SECRET_KEY = /(api.?key|token|secret|authorization|password|credential)/i;
const ALIYUN_BAILIAN_ENDPOINT = 'https://dashscope.aliyuncs.com/api/v1/services/embeddings/text-embedding/text-embedding';
const ALIYUN_BAILIAN_MODEL = 'qwen3.7-text-embedding';
const ALIYUN_BAILIAN_DIMENSIONS = 1024;
const ALIYUN_BAILIAN_BATCH_MAX = 20;

function stableHash(value) {
  return crypto.createHash('sha256').update(String(value), 'utf8').digest('hex');
}
function normalizeText(value, max = 800) {
  return String(value || '').normalize('NFKC').replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ').trim().slice(0, max);
}
function compactList(value, maxItems = 12) {
  const list = Array.isArray(value) ? value : String(value || '').split(/[,，;；]/);
  return [...new Set(list.map((item) => normalizeText(item, 80)).filter(Boolean))].sort().slice(0, maxItems);
}
function privacyReducedPayload(card) {
  const title = normalizeText(card.Title || card.title, 240);
  const category = normalizeText(card.Category || card.category, 100);
  const tags = compactList([card.TagL1, card.TagL2, ...(card.tags || [])]);
  const summary = normalizeText(
    card.claim_summary || card.Claim_Summary || card.claim || card.summary
      || card.Fact || card.Conclusion || card.content_summary || '',
    1200
  );
  return [`title: ${title}`, `category: ${category}`, `tags: ${tags.join(' | ')}`, `claim: ${summary}`].join('\n');
}
function cacheKey(model, dimensions, payload) {
  return `${normalizeText(model, 160)}:${Number(dimensions)}:${stableHash(payload)}`;
}
function embeddingSignature(settings = {}) {
  return [
    settings.embeddingProvider || 'aliyun-bailian-qwen37',
    settings.embeddingProtocol || 'dashscope-native-v1',
    ALIYUN_BAILIAN_ENDPOINT,
    ALIYUN_BAILIAN_MODEL,
    ALIYUN_BAILIAN_DIMENSIONS
  ].join(':');
}
function cosine(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length || !a.length) return -1;
  let dot = 0, aa = 0, bb = 0;
  for (let i = 0; i < a.length; i += 1) {
    const x = Number(a[i]), y = Number(b[i]);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return -1;
    dot += x * y; aa += x * x; bb += y * y;
  }
  return aa && bb ? dot / Math.sqrt(aa * bb) : -1;
}
function metadataOf(card) {
  return {
    library: normalizeText(card.library, 80),
    category: normalizeText(card.Category || card.category, 100),
    tagL1: normalizeText(card.TagL1 || card.tagL1, 100)
  };
}
function privacyReducedCard(card) {
  return {
    card_id: cardId(card),
    Title: normalizeText(card.Title || card.title, 240),
    Category: normalizeText(card.Category || card.category, 100),
    TagL1: normalizeText(card.TagL1 || card.tagL1, 100),
    TagL2: normalizeText(card.TagL2 || card.tagL2, 100),
    tags: compactList(card.tags || []),
    library: normalizeText(card.library, 80),
    claim_summary: normalizeText(card.claim_summary || card.Claim_Summary || card.claim || card.summary || card.Fact || card.Conclusion, 1200),
    atom_fingerprint: normalizeText(card.atom_fingerprint, 180),
    evidence_id: normalizeText(card.evidence_id, 180)
  };
}
function cardId(card) {
  return normalizeText(card.card_id || card.cardId || card.atom_fingerprint || stableHash(privacyReducedPayload(card)).slice(0, 24), 180);
}
function extractFacts(text) {
  const value = normalizeText(text, 1600).toLowerCase();
  return {
    numbers: [...new Set(value.match(/\b\d+(?:\.\d+)?\s*(?:%|mm|cm|m|km|kg|t|mpa|kpa|v|kv|a|kw|mw|℃|°c)?\b/g) || [])].sort(),
    dates: [...new Set(value.match(/\b(?:19|20)\d{2}(?:[-/.年]\d{1,2}(?:[-/.月]\d{1,2}日?)?)?\b/g) || [])].sort(),
    versions: [...new Set(value.match(/\bv?\d+\.\d+(?:\.\d+)?(?:[-+][a-z0-9.-]+)?\b/g) || [])].sort(),
    subjects: [...new Set(value.match(/(?:项目|公司|系统|设备|合同|标段)[:：]?\s*[\p{L}\p{N}_-]{2,30}/gu) || [])].sort()
  };
}
function deterministicGuard(left, right) {
  const a = extractFacts(privacyReducedPayload(left));
  const b = extractFacts(privacyReducedPayload(right));
  const mismatch = [];
  for (const key of ['numbers', 'dates', 'versions', 'subjects']) {
    if (a[key].length && b[key].length && JSON.stringify(a[key]) !== JSON.stringify(b[key])) mismatch.push(key);
  }
  const evidenceA = normalizeText(left.evidence_id || left.atom_fingerprint || '', 180);
  const evidenceB = normalizeText(right.evidence_id || right.atom_fingerprint || '', 180);
  const evidenceIdentity = Boolean(evidenceA && evidenceB && evidenceA === evidenceB);
  return { compatible: mismatch.length === 0, mismatch, evidenceIdentity };
}
function inferRelation(left, right, guard) {
  if (!guard.compatible) return 'related';
  const combined = `${privacyReducedPayload(left)} ${privacyReducedPayload(right)}`.toLowerCase();
  if (/(取代|替代|废止|supersed)/.test(combined)) return 'supersedes';
  if (/(冲突|矛盾|不一致|conflict)/.test(combined)) return 'conflicts';
  return 'related';
}
function redactDiagnostic(event) {
  const output = {};
  for (const [key, value] of Object.entries(event || {})) {
    if (SECRET_KEY.test(key)) continue;
    if (['payload', 'vector', 'response', 'body', 'text', 'path'].includes(key)) continue;
    if (typeof value === 'string') output[key] = value.slice(0, 160).replace(/(?:sk-|Bearer\s+)[A-Za-z0-9._-]+/gi, '<redacted>');
    else if (typeof value === 'number' || typeof value === 'boolean' || value === null) output[key] = value;
  }
  return output;
}
function semanticSettingsSnapshot(settings) {
  return {
    enabled: settings.semanticEnabled === true,
    consent: settings.semanticConsent === true,
    mode: 'shadow',
    provider: 'aliyun-bailian-qwen37',
    endpointConfigured: true,
    keyConfigured: Boolean(String(settings.embeddingApiKey || '').trim()
      || (typeof process !== 'undefined' && String(process.env?.EKS_EMBEDDING_API_KEY || '').trim())),
    model: ALIYUN_BAILIAN_MODEL,
    dimensions: ALIYUN_BAILIAN_DIMENSIONS,
    relatedThreshold: Number(settings.semanticRelatedThreshold || 0.82),
    duplicateThreshold: Number(settings.semanticDuplicateThreshold || 0.92)
  };
}
function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(Object.assign(new Error('aborted'), { code: 'SEM_ABORTED' }));
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(timer);
      reject(Object.assign(new Error('aborted'), { code: 'SEM_ABORTED' }));
    }, { once: true });
  });
}

class AliyunBailianQwen37EmbeddingProvider {
  constructor(options = {}) {
    this.fetch = options.fetch;
    this.env = options.env || {};
  }
  async embed(payloads, settings, signal, options = {}) {
    if (!Array.isArray(payloads) || !payloads.length || payloads.length > ALIYUN_BAILIAN_BATCH_MAX) {
      throw Object.assign(new Error('batch size invalid'), { code: 'SEM_BATCH_LIMIT', retryable: false });
    }
    const key = String(settings.embeddingApiKey || this.env.EKS_EMBEDDING_API_KEY || '').trim();
    if (!key) throw Object.assign(new Error('key required'), { code: 'SEM_AUTH_MISSING' });
    if (!this.fetch) throw Object.assign(new Error('fetch unavailable'), { code: 'SEM_FETCH_UNAVAILABLE' });
    const maxAttempts = Number(settings.embeddingMaxAttempts || 3);
    let last;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), Number(settings.embeddingTimeoutMs || 30000));
      const forward = () => controller.abort();
      signal?.addEventListener('abort', forward, { once: true });
      try {
        const response = await this.fetch(ALIYUN_BAILIAN_ENDPOINT, {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
          body: JSON.stringify({
            model: ALIYUN_BAILIAN_MODEL,
            input: { texts: payloads },
            parameters: {
              dimension: ALIYUN_BAILIAN_DIMENSIONS,
              output_type: 'dense',
              text_type: options.textType === 'query' ? 'query' : 'document',
              ...(options.textType === 'query' && options.instruct ? { instruct: String(options.instruct) } : {})
            }
          }),
          signal: controller.signal
        });
        if (response.status === 401 || response.status === 403) throw Object.assign(new Error('authentication failed'), { code: 'SEM_AUTH', retryable: false });
        if (!response.ok) throw Object.assign(new Error(`http ${response.status}`), { code: response.status === 429 ? 'SEM_RATE_LIMIT' : 'SEM_HTTP', retryable: response.status === 429 || response.status >= 500 });
        let json;
        try { json = await response.json(); } catch (_) {
          throw Object.assign(new Error('invalid response json'), { code: 'SEM_SCHEMA', retryable: false });
        }
        const rows = Array.isArray(json?.output?.embeddings) ? json.output.embeddings : [];
        if (rows.length !== payloads.length) throw Object.assign(new Error('embedding count mismatch'), { code: 'SEM_COUNT', retryable: false });
        const ordered = new Array(payloads.length);
        for (const row of rows) {
          const index = Number(row?.text_index);
          if (!Number.isInteger(index) || index < 0 || index >= payloads.length || ordered[index]) {
            throw Object.assign(new Error('embedding order mismatch'), { code: 'SEM_SCHEMA', retryable: false });
          }
          const vector = row?.embedding;
          if (!Array.isArray(vector)) throw Object.assign(new Error('embedding schema mismatch'), { code: 'SEM_SCHEMA', retryable: false });
          if (vector.length !== ALIYUN_BAILIAN_DIMENSIONS) throw Object.assign(new Error('embedding dimension mismatch'), { code: 'SEM_DIMENSION', retryable: false });
          if (vector.some((value) => !Number.isFinite(Number(value)))) throw Object.assign(new Error('embedding nonfinite value'), { code: 'SEM_NONFINITE', retryable: false });
          ordered[index] = vector.map(Number);
        }
        Object.defineProperty(ordered, 'usage', {
          value: {
            inputTokens: Number(json?.usage?.total_tokens || json?.usage?.input_tokens || 0),
            requestId: normalizeText(json?.request_id || '', 120)
          },
          enumerable: false
        });
        return ordered;
      } catch (error) {
        last = error;
        if (signal?.aborted) throw Object.assign(new Error('aborted'), { code: 'SEM_ABORTED' });
        if (error?.name === 'AbortError') last = Object.assign(new Error('timeout'), { code: 'SEM_TIMEOUT', retryable: true });
        if (last.retryable === false || attempt >= maxAttempts) throw last;
        await sleep(Math.min(30000, Number(settings.embeddingRetryBaseMs || 500) * 2 ** (attempt - 1)), signal);
      } finally {
        clearTimeout(timeout);
        signal?.removeEventListener('abort', forward);
      }
    }
    throw last;
  }
}

class ExactCosineIndex {
  constructor(state, options = {}) {
    this.state = state || { schema: INDEX_SCHEMA, signature: '', entries: {}, tombstones: {} };
    this.maxCandidates = Number(options.maxCandidates || 500);
    this.comparisons = 0;
  }
  upsert(id, vector, metadata, payloadHash) {
    this.state.entries[id] = { vector, metadata, payloadHash, updatedAt: Date.now() };
    delete this.state.tombstones[id];
  }
  tombstone(id) {
    delete this.state.entries[id];
    this.state.tombstones[id] = Date.now();
  }
  search(vector, filter = {}, topK = 8, excludeId = '') {
    this.comparisons = 0;
    const candidates = [];
    for (const [id, entry] of Object.entries(this.state.entries)) {
      if (id === excludeId) continue;
      if (filter.library && entry.metadata.library !== filter.library) continue;
      if (filter.category && entry.metadata.category !== filter.category) continue;
      if (filter.tagL1 && entry.metadata.tagL1 !== filter.tagL1) continue;
      candidates.push([id, entry]);
      if (candidates.length >= this.maxCandidates) break;
    }
    return candidates.map(([id, entry]) => {
      this.comparisons += 1;
      return { id, score: cosine(vector, entry.vector), metadata: entry.metadata };
    }).filter((item) => item.score >= 0).sort((a, b) => b.score - a.score || a.id.localeCompare(b.id)).slice(0, topK);
  }
  rebuild(liveIds) {
    const live = new Set(liveIds);
    for (const id of Object.keys(this.state.entries)) if (!live.has(id)) this.tombstone(id);
  }
}

class SemanticPostProcessor {
  constructor(options = {}) {
    this.settings = options.settings || {};
    this.readState = options.readState || (async () => null);
    this.writeState = options.writeState || (async () => {});
    this.diagnostics = options.diagnostics || (() => {});
    this.provider = options.provider || new AliyunBailianQwen37EmbeddingProvider({ fetch: options.fetch, env: options.env });
    this.controller = new AbortController();
    this.queue = [];
    this.running = 0;
    this.metrics = { queued: 0, processed: 0, failed: 0, cacheHits: 0, requests: 0, embeddingInputTokens: 0, comparisons: 0, suggestions: 0 };
  }
  configure(settings) { this.settings = settings || {}; }
  signature() { return embeddingSignature(this.settings); }
  emit(stage, event) { this.diagnostics(stage, redactDiagnostic(Object.assign({ stage }, event))); }
  async load() {
    const [cache, index, suggestions, queue] = await Promise.all([
      this.readState(CACHE_FILE), this.readState(INDEX_FILE), this.readState(SUGGESTION_FILE), this.readState(QUEUE_FILE)
    ]);
    const signature = this.signature();
    this.cache = cache?.schema === CACHE_SCHEMA && cache.signature === signature ? cache : { schema: CACHE_SCHEMA, signature, entries: {} };
    this.indexState = index?.schema === INDEX_SCHEMA && index.signature === signature ? index : { schema: INDEX_SCHEMA, signature, entries: {}, tombstones: {} };
    this.suggestions = suggestions?.schema === SUGGESTION_SCHEMA && suggestions.signature === signature ? suggestions : { schema: SUGGESTION_SCHEMA, signature, items: [], metrics: {} };
    this.queue = Array.isArray(queue?.items) ? queue.items.map((item) => item.card).filter(Boolean) : [];
    this.index = new ExactCosineIndex(this.indexState, { maxCandidates: this.settings.semanticMaxCandidates });
    if (this.queue.length && this.isAllowed()) this.drain();
  }
  isAllowed() {
    return this.settings.semanticConsent === true && this.settings.semanticEnabled === true && String(this.settings.semanticMode || 'shadow') === 'shadow';
  }
  async persist() {
    await Promise.all([
      this.writeState(CACHE_FILE, this.cache),
      this.writeState(INDEX_FILE, this.indexState),
      this.writeState(SUGGESTION_FILE, this.suggestions),
      this.writeState(QUEUE_FILE, { schema: 1, items: this.queue.map((card) => ({ card })) })
    ]);
  }
  async enqueue(card) {
    if (!this.isAllowed()) return { queued: false, code: 'SEM_DISABLED' };
    this.queue.push(privacyReducedCard(card));
    this.metrics.queued += 1;
    await this.writeState(QUEUE_FILE, { schema: 1, items: this.queue.map((item) => ({ card: item })) });
    this.drain();
    return { queued: true };
  }
  drain() {
    const concurrency = Math.max(1, Number(this.settings.embeddingConcurrency || 2));
    while (this.running < concurrency && this.queue.length && !this.controller.signal.aborted) {
      const card = this.queue.shift();
      this.running += 1;
      this.processBatch([card]).catch(() => {}).finally(async () => {
        this.running -= 1;
        await this.persist().catch(() => {});
        this.drain();
      });
    }
  }
  async processBatch(cards) {
    if (!this.isAllowed()) return { processed: 0, failed: 0 };
    const batch = cards.slice(0, Math.min(ALIYUN_BAILIAN_BATCH_MAX, Math.max(1, Number(this.settings.embeddingBatchSize || ALIYUN_BAILIAN_BATCH_MAX))));
    const payloads = batch.map(privacyReducedPayload);
    const keys = payloads.map((payload) => cacheKey(this.signature(), ALIYUN_BAILIAN_DIMENSIONS, payload));
    const vectors = new Array(batch.length);
    const misses = [];
    keys.forEach((key, index) => {
      if (this.cache.entries[key]) {
        vectors[index] = this.cache.entries[key].vector;
        this.metrics.cacheHits += 1;
      } else misses.push(index);
    });
    if (misses.length) {
      try {
        if (Number(this.settings.embeddingRateLimitMs || 0)) await sleep(Number(this.settings.embeddingRateLimitMs), this.controller.signal);
        const embedded = await this.provider.embed(misses.map((index) => payloads[index]), this.settings, this.controller.signal, { textType: 'document' });
        this.metrics.requests += 1;
        this.metrics.embeddingInputTokens += Math.max(0, Number(embedded.usage?.inputTokens || 0));
        misses.forEach((index, offset) => {
          vectors[index] = embedded[offset];
          this.cache.entries[keys[index]] = { vector: embedded[offset], createdAt: Date.now() };
        });
      } catch (error) {
        this.metrics.failed += batch.length;
        this.emit('provider', { ok: false, code: error?.code || 'SEM_PROVIDER', count: batch.length });
        return { processed: 0, failed: batch.length };
      }
    }
    batch.forEach((card, index) => {
      const id = cardId(card);
      const metadata = metadataOf(card);
      const candidates = this.index.search(vectors[index], metadata, Number(this.settings.semanticTopK || 8), id);
      this.metrics.comparisons += this.index.comparisons;
      for (const candidate of candidates) {
        if (candidate.score < Number(this.settings.semanticRelatedThreshold || 0.82)) continue;
        const existing = this.indexState.entries[candidate.id]?.card || {};
        const guard = deterministicGuard(card, existing);
        const duplicateCandidate = candidate.score >= Number(this.settings.semanticDuplicateThreshold || 0.92) && guard.compatible;
        this.suggestions.items.push({
          schema: SUGGESTION_SCHEMA,
          left: stableHash(id).slice(0, 16),
          right: stableHash(candidate.id).slice(0, 16),
          score: Math.round(candidate.score * 10000) / 10000,
          duplicateCandidate,
          relation: inferRelation(card, existing, guard),
          guards: { compatible: guard.compatible, mismatch: guard.mismatch, evidenceIdentity: guard.evidenceIdentity },
          status: 'review_suggestion'
        });
        this.metrics.suggestions += 1;
      }
      this.index.upsert(id, vectors[index], metadata, stableHash(payloads[index]));
      this.indexState.entries[id].card = {
        card_id: id, Title: normalizeText(card.Title || card.title, 240),
        Category: metadata.category, TagL1: metadata.tagL1,
        claim_summary: normalizeText(card.claim_summary || card.claim || card.summary, 1200),
        atom_fingerprint: normalizeText(card.atom_fingerprint, 180)
      };
      this.metrics.processed += 1;
    });
    this.suggestions.items = this.suggestions.items.slice(-5000);
    this.suggestions.metrics = Object.assign({}, this.metrics);
    this.emit('complete', { ok: true, count: batch.length, cacheHits: this.metrics.cacheHits, comparisons: this.metrics.comparisons });
    return { processed: batch.length, failed: 0 };
  }
  async run(cards) {
    if (!this.isAllowed()) return Object.assign({}, this.metrics, { code: 'SEM_CONSENT_REQUIRED' });
    const size = Math.min(ALIYUN_BAILIAN_BATCH_MAX, Math.max(1, Number(this.settings.embeddingBatchSize || ALIYUN_BAILIAN_BATCH_MAX)));
    for (let i = 0; i < cards.length; i += size) {
      await this.processBatch(cards.slice(i, i + size));
    }
    await this.persist();
    return Object.assign({}, this.metrics);
  }
  async rebuild(cards) {
    this.indexState = { schema: INDEX_SCHEMA, signature: this.signature(), entries: {}, tombstones: {} };
    this.index = new ExactCosineIndex(this.indexState, { maxCandidates: this.settings.semanticMaxCandidates });
    this.suggestions = { schema: SUGGESTION_SCHEMA, signature: this.signature(), items: [], metrics: {} };
    return this.run(cards);
  }
  async clear() {
    this.cache = { schema: CACHE_SCHEMA, signature: this.signature(), entries: {} };
    this.indexState = { schema: INDEX_SCHEMA, signature: this.signature(), entries: {}, tombstones: {} };
    this.index = new ExactCosineIndex(this.indexState, { maxCandidates: this.settings.semanticMaxCandidates });
    this.suggestions = { schema: SUGGESTION_SCHEMA, signature: this.signature(), items: [], metrics: {} };
    this.queue = [];
    await this.persist();
  }
  abort() {
    this.controller.abort();
    this.emit('lifecycle', { ok: true, code: 'SEM_ABORTED', remaining: this.queue.length });
  }
}

module.exports = {
  ALIYUN_BAILIAN_BATCH_MAX, ALIYUN_BAILIAN_DIMENSIONS, ALIYUN_BAILIAN_ENDPOINT, ALIYUN_BAILIAN_MODEL,
  AliyunBailianQwen37EmbeddingProvider, CACHE_SCHEMA, ExactCosineIndex, INDEX_SCHEMA,
  SemanticPostProcessor, cacheKey, cardId, cosine, deterministicGuard, extractFacts,
  embeddingSignature, inferRelation, metadataOf, privacyReducedPayload, redactDiagnostic, semanticSettingsSnapshot,
  privacyReducedCard, stableHash
};

}
};
const __cache = {};
function __require(id) {
  if (__modules[id]) {
    if (!__cache[id]) {
      const module = { exports: {} };
      __cache[id] = module;
      __modules[id](__require, module, module.exports);
    }
    return __cache[id].exports;
  }
  if (__nativeRequire) return __nativeRequire(id);
  throw new Error('Cannot find module ' + id);
}
module.exports = __require('main.js');
})();
