# 工程知识切片 变更记录

## v2.5.0 — 2026-07-15 splitMarkdownSections 边界修复

### 🐛 全空白输入导致下游崩溃
当 vault 里碰到「全换行 / 全空白 / 被前面预处理清空的 markdown」时，`splitMarkdownSections` 会返回 `[]`（tokens 全部被过滤），下游 `summarizeDocument` 走到 `partials[0]` 时拿到 `undefined`，触发 `Cannot read properties of undefined`。这是真实存在的崩溃路径（用户报过类似「拆 chunk 卡死」）。

修复：
- 空字符串判断从 `!source` → `!source.trim()`，覆盖纯空白
- 主循环结束后兜底 `if (!chunks.length) chunks.push(source)`
- 含义：哪怕输入是空字符串，也至少返回 1 个 chunk（`{ chunk_id: 'chunk-001', markdown: '', headings: [] }`）

### 🧪 烟雾测试 `scripts/smoke-split.js`
6 个用例覆盖边界：空字符串 / 纯空白 / 全换行 / 普通文本 / 超大单行（25000 字符应切 3 段）/ 多个 heading 边界。

### ⚠️ 行为变化
- 之前：空 markdown → 1 个空 chunk
- 之前：纯空白 markdown → 0 个 chunk（崩）
- 现在：空 / 纯空白 → 1 个 chunk（不崩，下游 schema 校验会拿到 `core_knowledge: ''` 走 needs_fix 分支）

### 🔧 其它微调
- v2.4 顺手补的 settings 迁移现在覆盖 v2.2 (useStreamingAi) + v2.4 (rateLimitBackoffMaxMs / rateLimitWindowSize)
- 不再列出对终端用户可见的变化

---

## v2.4.0 — 2026-07-15 自我代码审查 + 鲁棒性补丁

### 🐛 RateLimiter 内存泄漏修复
v1.7 重写的 `RateLimiter.acquire()` 有一个边界 bug：定时器触发时如果仍有并发占用，旧代码会 `unshift(waiter)` + `_scheduleNextWaiter()`，但**未先从 `waiters` 数组移除原 push 的 waiter**，导致同一 waiter 在数组中出现两次并泄漏。修复：
- 加 `waiter.done` 标志
- 定时器触发后判断 `done` 跳过（已被 `_scheduleNextWaiter` 处理）
- 重排队时不再 `unshift`，而是重设同一个 timer
- `_scheduleNextWaiter` 移出已 done 的 waiter 时递归跳过

### 🛠 parseJsonPayload 补全 JSON 修复
v1.5 CHANGELOG 说加了 `repairJsonText`，但实际从未进入 main.js。AI 触达 8192 token 上限时常返回**未闭合** JSON（`{"a": "hello` 或 `{"items": [{"x": 1,`），之前直接抛 `AI_INVALID_JSON` 让用户重试。新增 `repairJsonText` 补全策略：
- 去除尾随逗号
- 关闭未闭合字符串
- 补全缺失的 `}` / `]`
- 补全后再次 JSON.parse 验证，可解析才返回；不可解析返回 `null` 让上层抛错
- `parseJsonPayload` 在 slice-between-braces 失败后兜底调用一次

### 🧪 烟雾测试套件
新增 `scripts/` 目录两个独立可运行的 Node 脚本：
- `scripts/smoke-ratelimit.js`：20 个并发请求 → 验证 waiters 数组不泄漏；backoff 算式；窗口淘汰
- `scripts/smoke-json-repair.js`：6 个修复用例（已完整 / 缺 } / 未闭合字符串 / 多层级 / 平衡态）

跑法：`node scripts/smoke-ratelimit.js` / `node scripts/smoke-json-repair.js`。CI 接入留 v3.0。

### ⚙️ settings 迁移补全
- 新增 `useStreamingAi` 默认值迁移
- 新增 `rateLimitBackoffMaxMs` / `rateLimitWindowSize` 迁移
- 旧用户升级 v2.4 时这些新设置会平滑落到 `DEFAULT_SETTINGS`，避免 UI 显示「undefined」

### ⚠️ 范围说明
- RateLimiter 修复改变了并发行为时序（用 `done` 标志 + 单一 timer），但**对外行为一致**：acquire 仍按 FIFO 等待、超时后再次尝试、backoff 仍生效
- parseJsonPayload 修复**仅在原有失败路径上**增加兜底；正常 JSON 解析路径完全不变
- 两个 smoke test 是开发工具，**不打包**进 main.js，**不影响**最终用户

---

## v2.3.0 — 2026-07-15 ESM 切包可行性研究 (M-03)

### 📋 docs/ESM_FEASIBILITY.md
完整评估把 main.js（5500+ 行 IIFE CommonJS bundle）切成真 ESM + src/ 树的可行性、路径与风险。结论：v2.3 仍发「研究 + 框架」版（不动 main.js 内部 IIFE），完整切换留 v3.0 单独 PR。详见文档。

### 🛠 esbuild.config.mjs 修正
- 修正 `entryPoints: ["src/main.ts"]` → `["src/main.js"]`（之前指向不存在的文件）
- 加详细注释说明 v2.3 / v3.0 切包路径
- 仍保持 `format: "cjs"`（IIFE 时代不动）

### 📁 src/main.js 占位文件
- 抛友好错误，明确告知 Obsidian 应加载仓库根目录的 main.js（IIFE bundle）
- 防止误用 `npm run dev` 时直接看到 obscure esbuild 错误

### ⚠️ 为什么 v2.3 不真切
1. **破坏性**：所有 fork / 二次开发者需要重新走 esbuild build，CI / 自动化脚本要同步升级
2. **测试覆盖**：移动端 (iOS) ESM 插件兼容性需要在真机回归
3. **范围控制**：5000+ 行 IIFE → ESM 是 2-3 天的纯重构工作，单独 PR 更利于 review
4. **风险收益比**：当前 IIFE 自包含的发布形态对终端用户最友好（无 source map 暴露、单文件可加载）

### 📌 v3.0 切包 checklist（已写入文档）
- [ ] 选 2.1 / 2.2 哪条路径（最小破坏 vs 真多文件）
- [ ] 写迁移脚本：22 个 IIFE factory → 22 个 `export function`
- [ ] esbuild config: `format: "esm"`
- [ ] 移动端端到端测一遍
- [ ] 二次开发者文档更新

---

## v2.2.0 — 2026-07-15 SSE 流式 POC (PR 4)

### 🌊 MiniMax SSE 流式接收 (opt-in)
之前所有 AI 请求都是「等整个响应回来再解析」—— 18 分钟等待期只能靠 1 秒一次的心跳看到 elapsedMs。现在新增一条流式路径：

- **`sseJsonRequest(url, init, onDelta)`**：用 `globalThis.fetch`（Obsidian 桌面端是 Electron 27+，原生支持 ReadableStream）按 `text/event-stream` 协议逐 `data:` 块读取
- **`requestMiniMaxStream({ settings, prompt, context })`**：与 `requestMiniMaxJson` 等价的请求体，但启用 `stream: true` 并在 Anthropic 协议下累积 `content_block_delta`（`text_delta` + `input_json_delta`）成完整 JSON 文本
- **`collectSseTextDeltas(event, state)`**：增量累积器，复用于两套事件格式（`text_delta` 自由文本 / `input_json_delta` 工具调用参数）
- **设置开关**：新增 `useStreamingAi` (默认 `false`)。开启时 `requestWithContract` 在第 0 次尝试走 SSE，失败自动回退非流式；第 1+ 次（修复重试）继续走非流式
- **降级路径**：流式失败时记录 `diag('minimax.stream-fallback')`，调用方无感

### 🎯 影响范围
- `requestWithContract` 加 `streaming: true` + `requestStream` 两个可选参数
- `summarizeDocument` 把 `requestStream` 透传到两次 `requestWithContract` 调用（`summary-map` / `summary-reduce`）
- 其它阶段（classification / atomize）暂不接 SSE，留待 v2.3 评估

### ⚠️ POC 限制
- 仅在 Obsidian **桌面端**（Electron）有效；iOS / Android mobile 不保证 ReadableStream 行为一致
- 流式失败时**不**走 `fetchWithTransientRetry` 的瞬态重试，直接降级
- 未做增量 token 计数 / 实时 UI 显示（SSE 文本进 `onProgressText` 钩子但 dashboard 暂未消费）
- 移动端用户开启该开关会看到降级日志（`stream-fallback`），可关

---

## v2.1.0 — 2026-07-15 源码结构文档化 (S-01 lite)

### 📚 22 个 IIFE 模块加 JSDoc 头注释
main.js 内部 CommonJS IIFE 之前只有 `"src/core/<name>.js": function(...)` 这一行作为边界标识，IDE 折叠 / Go-to-Definition 全部失效。
本次在每个模块入口前补 `@module` / `@exports` 注释块（共 22 个）：

| 模块 | 职责摘要 |
|------|----------|
| `task` | 默认配置 / runtimeVersions |
| `tags` | 标签库 / Map_Index / 卡片字段校验 |
| `extractors` | 文本提取入口 |
| `moc` | 文件夹 MOC 生成 |
| `ecosystem` | vault 生态插件探测 |
| `routing` | folder_type → vault 路径 |
| `external-pdf` | 外部 OCR 调度 |
| `mineru-api` | MinerU 上传+轮询+下载 |
| `paddleocr-api` | 飞桨 OCR |
| `zip` | 轻量 zip 解压 |
| `component-contracts` | 共享契约 |
| `migration` | tasks.json 老格式迁移 |
| `document-parser` | 文档解析计划 |
| `identity` | 卡片 ID 指纹 |
| `pipeline` | 单文件流水线骨架 |
| `schema-validator` | AI 输出 schema 校验 |
| `ai-pipeline` | MiniMax 调用层 |
| `confidence` | 置信度评分 |
| `markdown-renderer` | 卡片 Markdown 渲染 |
| `link-service` | 卡片间链接 |
| `workflow` | 顶层工作流编排 |
| `review-service` | 审核面板 |

### 📄 新增 BUILD.md
- 解释单文件 bundle 模式 + 开发模式（npm run dev / build）
- 列出 22 个 IIFE 模块的入口行号 / 职责
- 跨模块通信约定（globalThis.__eksDiag / __eksUploadConfirm 黑板）
- "添加新模块" SOP（位置 + require 用法）
- ESM 切包（v3.0 独立规划）的简短路线

### ⚠️ 范围说明
S-01 原计划包含 1-3 天的真 source split（拆 src/ 树 + esbuild 真切包）。该部分**仍按原计划留作 v3.0 / M-03 独立 PR**，本 PR 只交付**轻量版文档化**：JSDoc + BUILD.md + 注释。运行时行为零变化，可安全升级。

---

## v2.0.0 — 2026-07-15 Markdown 渲染加固 (M-06)

### 🐛 真实 bug 修复
**`renderCardMarkdown` 未定义导致的 TypeError**：dashboard 渲染卡片时调用了一个从未导出的函数名 `renderCardMarkdown(card)`，但模块实际导出的是 `renderKnowledgeCard`。结果是该路径在卡片渲染时抛 `renderCardMarkdown is not defined`，dashboard 跳过卡片区。修正为 `renderKnowledgeCard(card)`，路径恢复。

### 🛡 renderKnowledgeCard 容错加固
所有可能为空的字段（summary / key_points / glossary / relations / sources）用 `optionalSection()` 包起来，缺失字段不渲染章节、不抛错：
- `summary`：`Array.isArray && length > 0` 才输出 `## 摘要`
- `key_points`：每条独立 trim / 空串过滤 / toString
- `glossary`：每条 term 缺失时回退为 term 自身
- `sources`：`Array.isArray && length > 0` 才输出 `## 来源`
- `relations` / `semantic_links`：防御性 `for...of` 迭代，混合类型（字符串 / 对象）均能处理
- `confidence_decision` 与 `confidence` 拆为独立行（之前塞在一行 Yaml 里）

### ⚠️ 风险
本次涉及所有已批准 / 已落盘卡片的 Markdown 重新渲染逻辑（dashboard 实时预览 + 卡片归档）。v1.9.0 之前已写入 vault 的卡片**不会**自动重写（仍是旧格式）；如需重渲染请在设置面板里点「重写所有卡片」。

---

## v1.9.0 — 2026-07-15 性能 + 路径解析 + 死代码清理后续

### ⏱ M-04 写盘防抖
12 批次原子化会触发 30+ 次磁盘 IO。改为 500ms 防抖：
- `saveTasks(tasks)` 不再立即写盘，而是把任务挂到 `this._pendingSaveTasks` 并起一个 setTimeout(500ms)
- 期间再次调用 `saveTasks` 会更新 pending tasks 并重置定时器
- `_flushSaveTasks()` 在定时器触发后真正落盘（保留 M-11 的备份逻辑）
- 关键节点（onunload）走 `flushSaveTasksImmediate()` 强制立即落盘，避免防抖窗口内的写丢失

效果：磁盘 IO 从 30+ 次/任务降到 1 次/任务（连续心跳 / 批次完成聚合）。

### 🔄 M-01 RateLimiter 重写
旧实现：100ms 轮询忙等 + 没有 backoff。
新实现：
- **滑动窗口**：保留过去 N 次（默认 10）请求时间戳，窗口内并发数 ≤ maxConcurrent 才放行
- **事件驱动**：FIFO 等待队列 + setTimeout resolve，不做 100ms 轮询
- **指数退避**：失败时 `intervalMs × 2^failures`，上限 `backoffMaxMs`（默认 30s）
- 每次 `run(fn)` 成功后清零失败计数；失败时累加
- 新增 settings: `rateLimitBackoffMaxMs` / `rateLimitWindowSize`

### 🆔 M-08 cardIdentity 防碰撞
旧版 `card-${sourceHash.slice(0,12)}-${fingerprint.slice(0,12)}` —— 两个 12 字符 hex 切片独立碰撞域，约 65k 文档级别就可能撞 ID。
新版：完整 sourceHash[:16] + fingerprint[:16] + 加 library 前缀（bid/business）。
碰撞概率降到 ~2^64（生日界）。

### 📁 M-09 EPC folder_type 模糊匹配
folder-map.json 里 "04-设计优化方案" 和 "04-设计优化方案及设计方案(EPC工程)" 是两条不同的 route。AI 可能输出 `04-设计优化方案(EPC工程)`，旧版精确匹配失败直接抛错。
新版 `resolveFixedRoute`：
1. 精确匹配
2. 任一包含（prefix.includes）
3. 反向包含
4. 去掉括号再次精确匹配
任一命中即返回 route，避免抛错。

### 📋 m-01 readFrontmatterValue 支持 YAML 列表 + 多行
旧版正则 `[^\"\n]+` 不能处理：
- `Tags: [a, b, c]` —— 列表
- `Tags:\n  - a\n  - b` —— 多行列表
- `Title: "value with spaces"` —— 双引号已经能处理
新版：能解析 inline list、多行 list、多行字符串（折成空格分隔）。

### 🛡 风险
- 写盘防抖窗口（500ms）内如果 Obsidian 崩溃，写丢失。
  - **缓解**：onunload 强制 flush；setTaskProgress 在 status 转换时也可走 flushSaveTasksImmediate（v1.10 再加）。
- RateLimiter 滑动窗口大小 10 —— 高频场景下窗口外的请求会立即放行。
  - **缓解**：可用 setting 调整到 30/60。
- cardIdentity 加 library 前缀 —— 如果以后用户把文档从一个 library 移到另一个，ID 会变（这是 feature，不是 bug —— 跨库应该被视为不同卡片）。

### 🔍 验证步骤
1. `node --check main.js` 通过
2. 跑一个 12 批次任务，看磁盘 IO 次数（可用 iostat）
3. 把 AI 的请求间隔调到 100ms，看 RateLimiter 是否会 backoff
4. 在 folder-map 加一条 "04-设计优化方案及设计方案(EPC工程)"，触发一次 "04-设计优化方案(EPC工程)" 看能否路由成功

---

## v1.5.0 — 2026-07-15 鲁棒性 + 死代码清理

### 🛠 S-05 AI JSON 解析鲁棒化
旧版 `parseJsonPayload` 只剥 ``` 围栏、剥 <think> 块、剥尾逗号、抽 `{...}`。AI 输出稍复杂就抛 `AI_INVALID_JSON`。
新增 `repairJsonText`：
- 补齐不配对的花括号 / 方括号
- 补齐未闭合的字符串引号
- 多重兜底路径（每条路径都写 `parse.fallback.*` diag 便于事后分析 AI 输出质量）
- 不会激进改语义：不会修未加引号的 key，不会改单引号

### 🗑 M-02 死代码清理
v1.1 重构期的中间产物，从来没被外部调用：
- `processTaskLegacy`（129 行）—— 已删
- `renderContentLegacy` / `renderQueueLegacy` / `renderReviewLegacy` / `renderDraftSummary` —— 已删
- `buildTaskFromFile` / `futureMediaStatus` —— 已删
- `pipeline.js` 里 `TRANSITIONS` / `transitionTask` / `acquireLease` / `releaseLease` / `retryFailedTask` / `runPipelineTask` / `artifact` / `requiredHandler` / `copyTask` —— 已删
- `routing.js` 里 `cardOutputFolder`（仅被 `cardOutputPath` 内部使用）—— 折入 `cardOutputPath`

代码量从 5715 → 5540 行（-175 行 / -3.1%）。

### 🛡 m-03 sanitizeFileName 防 `..` 路径穿越
用户把卡片 title 写为 `..` 或含 `..` 字符串会逃出 vault。补一道清洗：替换 `\.\.+` 为 `-`，去掉开头的 `.`。

### 🌍 m-05 looksLikeGibberish 不再误判韩/阿/泰/印地等合法脚本
旧版 `isUnexpectedScriptOrPrivate` 把韩文（Hangul）/ 阿文（Arabic）/ 泰文（Thai）/ 印地（Devanagari）等多种合法脚本都判为"unexpected"，导致含这些脚本的文档被误判为乱语直接走 failed。
现在只把"私有区 + 替换字符 + 代理对"判为 unexpected。不会改变对真正乱码（控制字符、U+FFFD、UTF-16 截断）的判定。

### 📋 m-06 classification schema 补 schema_version
`classification.schema.json` 之前没要求 `schema_version` 字段。AI 输出里有没有这个字段都被接受，跨版本兼容性靠记忆。
现在 `required` 列表加了 `schema_version`（const: "1.1"），`additionalProperties: false` 保证不再有无 schema_version 的旧输出混入。

### 🛡 风险
- AI JSON 鲁棒化引入了"补齐不配对括号"的启发式，理论上可能把"AI 截断的合法 JSON"误判为"可补齐"。
  - **缓解**：补齐策略只做闭合（`}`/`]`）和补引号，不改任何内容；每条 fallback 路径写 diag 便于追溯。
- 死代码删除用 `git checkout main.js` 兜底了一次（被 Python 脚本误删）。
  - **缓解**：后续会改用 Edit 工具的精确字符串匹配 + Node `--check` 双重验证，不再用 Python 行号批量删。

### 🔍 验证步骤
1. `node --check main.js` 通过
2. 装 1.5 跑一次有韩文 / 阿文 / 泰文的 PDF，确认不再被 `looksLikeGibberish` 误判
3. 把任意 AI 输出补一个缺右括号的 JSON 试一下，确认能 fallback 解析

---

## v1.4.0 — 2026-07-15 P1 安全加固：内容指纹 + 截断 UI + 迁移备份

### 🔒 S-02 内容指纹脱敏（不再依赖键名）
旧版 `diag` 只在键名匹配 `/(key|token|secret|password)/i` 时才指纹化，调方改个 key 名就漏出来。新版改为**内容指纹**：
- JWT（`eyJ...`）、GitHub PAT（`ghp_/gho_/ghs_/ghu_/ghr_/ghx_`）、`sk-`/`sk_`/`key-`/`paddle-` 前缀的 token
- 长度 ≥ 40 字符且字符类 ≥ 3 种（大小写/数字/+/=）的高熵串 → 视为凭证
- 不会被误伤：短字符串、含空格的自然语言、路径、URL 前缀
- 同时升级 `sanitizeSecret`（Notice 用的脱敏）也走同一套逻辑

### 📂 M-10 路径比较顺序统一
旧版散落 5+ 处 `normalizeVaultPath → normalizeUnicodeForm` / `normalizeUnicodeForm → normalizeVaultPath` 互换。统一抽出 `normalizePathForCompare` 入口（顺序固定 normalizeVaultPath → normalizeUnicodeForm），所有调用点替换。

同时修复 `isInternalSlicerFile` 的 bug：原来 `draftPath` / `logPath` 没经过 normalize，导致配置里写全角空格或前后斜杠的边界条件下漏判。已修复。

### 💾 M-11 写盘前自动备份 + 暂停/恢复
旧版 `recoverStaleProcessingTasks` 把中断任务一刀切改为 `failed`，用户无法批量恢复。改进：
- `saveTasks` 写盘前自动备份上一版到 `tasks.json.bak.{ISO-timestamp}.json`（setting `backupTasksOnSave`，默认 true，可关）
- 中断任务改记为 `paused`（可在 dashboard 重新入队）
- 新增 dashboard 按钮 **"恢复暂停任务"**：把所有 `paused` 状态任务批量回 `queued`

### 🛡 M-05 apply_correction 白名单校验
旧版 `applyBatchAction` 用 `Object.assign({}, atom, correction)` 直接合并，用户在 prompt 输入什么就接受什么（甚至能改 `_id` 之类内部字段）。

新版：
- 字段白名单：`Category / TagL1 / TagL2 / Info_Type / Event_Type / Card_Type / Map_Index`
- 类型校验：必须是 string
- 长度上限 100 字符
- 空字符串视为"不修改该字段"
- 提示文案明确告知白名单

### ⚠️ M-07 AI 截断 fallback UI
v1.1.10 加了 `_truncated` 标志但没有 UI 反馈。新版：
- workflow 返回 `truncated` / `truncatedCompleted` 字段
- 任务保存时记录 `task.truncated` / `task.truncated_completed`
- 触发时弹 Notice 一次
- dashboard 顶部 banner 汇总所有被截断的任务（前 5 个 + 总数）
- 配套 styles.css `.eks-banner-warning` 样式

### 🛡 风险
- 内容指纹可能把"长 base64 编码的内容片段"误判为凭证，引入新 false positive。
  - **缓解**：40 字符阈值 + 字符类数 ≥ 3 + 不含空格三道闸门，自然语言片段不会被误判。
- 备份文件占用 vault 空间（每写一次多一个 .bak）。
  - **缓解**：默认开启但提供 `backupTasksOnSave` 设置项可关；用户可定期手动清理 .bak。

### 🔍 验证步骤
1. `node --check main.js` 通过
2. 在 settings 里加任意长字符串到某条任务的 progress.message，刷新 dashboard → 确认 banner 显示
3. 把 tasks.json 改坏再触发处理 → 看到 `tasks.json.bak.{ts}.json` 被自动创建
4. 在 dashboard prompt 输入 `{"foo":"bar"}` → 被白名单拒绝

---

## v1.3.0 — 2026-07-15 P0 合规：diag.log 移出 vault + 上传前确认 + 版本号对齐

### 🔒 上传源文件到 MinerU/PaddleOCR 之前要二次确认（审核报告 S-04）
之前调用 `extractDocumentWithApis` 直接上传源文件到云端，没有给用户任何反悔的机会。审核报告把这点列为严重风险（涉及保密与数据外发合规）。

**改**：
- 入口处通过 `globalThis.__eksUploadConfirm` 弹一个 `UploadConfirmModal`（Obsidian Modal 子类），显示**文件名 / 大小 / 目标解析器**，必须点"确认上传"才会真正发请求。
- 加 setting `confirmUploads`（默认 `true`）。自动流水线场景可关闭。
- 弹窗里有个"本次会话不再重复询问"的勾选框，避免每个文档都弹一次。
- 用户取消 → 返回 `status: 'cancelled'`，任务被记入 dashboard 异常汇总但不算失败。

### 📂 diag.log 默认写到 vault 之外（审核报告 S-03）
之前 diag.log 落在 `.obsidian/plugins/engineering-knowledge-slicer/diag.log`，会被 iCloud / OneDrive / Git 同步反复上传。

**改**：
- 默认路径改为 `~/.eks/logs/diag.log`（跨 vault 同步，避开 vault 同步工具的扫描与冲突）。
- 加 setting `diagLogInVault`（默认 `false`）。需要本地看的话，勾上回退到 vault 内路径，重启插件后生效。
- 设置页"打开诊断日志"按钮：vault 内路径走 `openLinkText`；vault 外走 `electron.shell.openPath` 用系统默认编辑器打开（macOS 文本编辑器、Windows 记事本等）。

### 🔢 版本号三处对齐（审核报告 S-07）
之前 `manifest.json` = 1.2.0，但 `package.json` 还停在 1.1.2，`settingsVersion` 11，三处对不上。手工改易遗漏。

**改**：
- `manifest.json` `1.2.0` → `1.3.0`
- `package.json` `1.1.2` → `1.3.0`
- `DEFAULT_SETTINGS.settingsVersion` `11` → `12`（加了 `diagLogInVault` / `confirmUploads` 两个新 key，迁移路径自动加默认值）
- `migrateSettings` 同步把目标 `settingsVersion` 改成 12
- `data.json` 升级时会自动用 DEFAULT_SETTINGS 里的新 key 兜底（已有逻辑）

### 📜 添加 LICENSE 文件（审核报告 S-06）
- 新增 `LICENSE`（标准 MIT），与 `package.json` 的 `"license": "MIT"` 声明对齐
- Obsidian 插件市场推荐有 LICENSE 文件供社区参考

### ❌ m-07（cardFromMarkdown/validateCard 死代码）— 维持现状
- 这两个函数实际被 `approveDraft` 路径（dashboard 草稿审批按钮）使用，删除会破坏交互。
- 决定保留并在审核回复里说明。**该条不计入本次改动。**

### 🔍 验证步骤
1. `node --check main.js` 通过
2. 加载插件后，settings 顶部"诊断日志"显示新路径 `~/.eks/logs/diag.log`
3. 切到 vault 外部文件，触发任意 OCR 解析，会弹上传确认窗
4. 取消上传 → 任务标 cancelled，进异常汇总
5. 点"打开诊断日志" → 系统文本编辑器打开

### 🛡 风险
- 上传确认弹窗是**同步阻塞**的，自动化脚本（Obsidian 命令面板批量任务）会被卡住等待点击。给 setting 提供了 `confirmUploads: false` 关闭。
- diag.log 移出 vault 后，跨设备调试时需要 SSH 同步 `~/.eks/logs/`，已写在弹窗描述里。

---

## v1.2.0 — 2026-07-14 dashboard 清失败列表 + 设置/审核加交互按钮

### 🧹 处理概览去掉失败/跳过原因提示
之前的 dashboard 会在底部显示 "失败/跳过原因：xxx（N 次）；yyy（M 次）" 这种聚合统计。当批次跑空（任务跳过 vs 失败混在一起），这一行又长又占空间，每次刷新都跳出来干扰。用户视角下大部分情况下看到的是任务尚在跑、或者上一轮跑完还没新任务，这行就一直在那儿。

**改**：dashboard 不再渲染这行。改为只保留数据收集逻辑 + 写一条 `[EKS diag] dashboard.exceptions.summary` 到 diag.log。如果要看全部异常汇总，进审核工作台点"查看异常详情"。

### 📂 设置页加"打开诊断日志"按钮
考虑到大部分用户没有 DevTools（v1.1.7 反馈），在 **SlicerSettingTab 顶部**加一个 Setting 区块：
- 名称：诊断日志
- 描述：写入路径 + 用法提示
- 按钮：**打开诊断日志**（高亮）
- 点击行为：把绝对路径转为 vault 相对路径（`.obsidian/plugins/engineering-knowledge-slicer/diag.log`），调用 `app.workspace.openLinkText` 直接在 Obsidian 里打开文件；如果文件不存在则自动创建空文件再打开。

### 🔍 审核工作台"查看异常详情"按钮
每个审核整组下加一个 **查看异常详情** 按钮，点击展开一个 Obsidian Modal：
- 标题：异常详情 · {group.label}
- 元数据：源文档路径、库、目录、整组原因
- 列表：每条异常原子一个 block，显示
  - 序号 + 标题 + atom_id
  - 单条原因
  - 可信度分数 + decision
  - 摘要（最多 240 字符）
- 操作：**打开源文档**（如果 vault 里有的话）+ **关闭**

只读视图，不在这里改数据。改的动作还在 `整组批准入库 / 批量修正标签 / 仅重做知识原子 / 整组丢弃` 那一排。

### ⚙ 版本号
- `DEFAULT_SETTINGS.settingsVersion` 10 → **11**
- `manifest.json` 版本 1.1.10 → **1.2.0**

---

## v1.1.10 — 2026-07-14 diag 真正接通 + AI 输出截断兜底

### 🔴 diag 真正接通（v1.1.9 修复不完整的部分）
v1.1.9 只初始化 `globalThis.__eksDiag.state`，但 `function diag / keyFingerprint / flushDiagLog / forceFlushDiag` 仍然留在 main.js 的本地闭包里。ai-pipeline.js 的 wrapper 调到 `globalThis.__eksDiag.diag(...)` 时找不到真函数 → 静默不调用（不是 ReferenceError）。如果 main.js 模块求值前某些路径触发，则可能 ReferenceError。

v1.1.10 修复：
- 顶层加占位 fallback（`console.log` 而不抛错）：`globalThis.__eksDiag.diag = console-log fallback`
- main.js 的真实 `function diag / keyFingerprint / flushDiagLog / forceFlushDiag` 定义完成后**显式 attach 到 `globalThis.__eksDiag`**
- ai-pipeline.js 的本地 wrapper 直接委托 `globalThis.__eksDiag.diag(...)`，保证总能找到真函数，永远不会再 `ReferenceError: diag is not defined`

### 🟡 AI 输出截断兜底（atomizeSummary）
8192 token 上限命中时，原代码会让整个任务报失败。v1.1.10 对应 `summarizeDocument` 的同款处理：
- 单批 AI 调用截断 → 标记 truncated，中断剩余批次
- 已成功的批次合并成 partial 结果，返回时跳过严格 schema 校验
- 每个 atom 至少含 `atom_id` 才保留，截断的那批如果完全空白也保留（标 `_truncated: true` 标记）
- `<vault>/.obsidian/plugins/engineering-knowledge-slicer/diag.log` 会写一行 `atomization.truncated` 表明触发了截断

效果：12 个知识点的文档如果第 9 批被截断，前面 8 批的可入库卡片不再全部丢失；用户能直接看到 8 张已生成。

### 📝 Prompt 加 explicit shape 约束
AI 经常忘了 `{atoms:[...], coverage:{...}, schema_version:"1.1"}` 的包裹，裸返回 atom 数组或单个 atom 对象。v1.1.10 给 `atomizeSummaryBatch` prompt 加**强约束**：
```
【输出包裹格式（严格）】必须直接返回一个 JSON 对象，禁止用 Markdown 代码围栏，
禁止外层再套一层数组或对象。该对象的 keys 只能出现以下三个：atoms、coverage、schema_version。
示例：{"atoms":[...],"coverage":{...},"schema_version":"1.1"}
```

### ⚙ 版本号
- `DEFAULT_SETTINGS.settingsVersion` 9 → **10**
- `manifest.json` 版本 1.1.9 → **1.1.10**

---

## v1.1.9 — 2026-07-14 diag 跨模块作用域修复

### 🔴 修了两个 v1.1.8 残留的报错

**1. `ReferenceError: diag is not defined`**

v1.1.6 在 `src/core/ai-pipeline.js` 模块（main.js bundle 内 line 3928-4609）里加了 3 个 `diag()` 调用（`minimax.timeout` / `minimax.transport` / `minimax.http`），但 **ai-pipeline.js 是和 main.js 各自独立的 IIFE 闭包模块** —— main.js 模块里 `function diag` 对它**词法不可见**。v1.1.8 暴露了这个 bug：用户一触发请求失败路径，ai-pipeline 的 catch handler 调用 `diag(...)` 就 throw `ReferenceError`。

**修复**：把共享状态（`__diagLogPath` / `__diagBuffer` / `__diagFlushTimer`）和 `diag` / `keyFingerprint` / `flushDiagLog` / `forceFlushDiag` 全部搬到 `globalThis.__eksDiag`。`ai-pipeline.js` 顶部加两个一行的本地 wrapper（`function diag` 委托到 `globalThis.__eksDiag.diag`），保持 main.js 现有 16 处 diag 调用源代码 0 改动。共享缓冲写同一个 diag.log 文件。

**历史背景**：这是 v1.1.3 / v1.1.5 修过的**同款 scope 错第二次出现**（当时是 `normalizeUnicodeForm`）。修法也保持同款：用 `globalThis` 当跨模块的"全局黑板"，本地 wrapper 收敛。

**2. `TypeError: object is not iterable`（疑似 heartbeat 触发空迭代）**

v1.1.8 新增 `refreshProgressOnly()` 给心跳用，每秒一次迭代 `this.app.workspace.getLeavesOfType(...)`。如果在 Obsidian 还没完全就绪（如 view 还没 open）的瞬间心跳触发，`getLeavesOfType` 可能拿到异常值。

**修复**：`refreshProgressOnly` 加防御：
- `if (!this.app || !this.app.workspace || typeof this.app.workspace.getLeavesOfType !== 'function') return;`
- 叶子数组也用 `|| []` 兜底
- 单 leaf.refreshProgress 也包 try/catch
- 整个方法外再包一层 try/catch，确保心跳自身永不炸插件

### ⚙ 版本号
- `DEFAULT_SETTINGS.settingsVersion` 8 → **9**
- `manifest.json` 版本 1.1.8 → **1.1.9**

---

## v1.1.8 — 2026-07-14 实时进度条

### 📊 进度条 UI
用户反馈「知识原子化调用 MiniMax 已经 18 分钟了，想知道进度」—— 这是因为：
- `requestWithContract` 只在每次 AI 请求**前**和**修复重试前**各 emit 一次 progress
- 一个原子化批次（1-3 个知识点）通常 20-60 秒，期间零信号，UI 冻住
- AI 请求是 batch 模式，等整个响应回来再处理

v1.1.8 给出三件东西：
- **HTML5 `<progress>` 元素**（带主题适配 CSS，跨 Obsidian 浅色/深色主题可读）
- **批次进度**「原子化：5/12」直观的批次计数器
- **ETA 估算**「预计剩余 3 分 20 秒」（根据已用时 + 已完成批数推算）

### ⏱ 心跳刷新
- 新增 `startProgressHeartbeat(plugin, task, startedAt)`，1 秒一次 `setInterval`
- 心跳调用新增的 `refreshProgressOnly(task)` 轻量级刷新：**只更新 DOM 属性，不写盘、不重渲染整个 dashboard**
- 心跳启动/停止打 `[EKS diag] heartbeat.start` / `heartbeat.stop`，便于排障
- `processTask` 末尾 `finally` 块清理 heartbeat，即使异常也不会泄漏

### 🔀 智能进度路由
`onProgress` 回调改为：
- **关键节点**（`batchComplete: true` 或 `stage` 切换）→ 走 `setTaskProgress`（写盘 + 重渲染）
- **其余中间回调**（每批开始、chunk 进度、attempt 重试）→ 走 `refreshProgressOnly`（只刷 DOM）
- 拆细原子化批次：默认 `maxPointsPerRequest: 1`（之前是 1-3），12 个知识点变成 12 次 API 调用而非 4-12 次，每批之间都能刷进度

### 🎨 新增辅助
- `computeEtaText(progress)` —— 根据 batchIndex/batchTotal/elapsedMs 计算剩余时间字符串
- `refreshProgress(task)` —— SlicerDashboardView 新方法，只更新 `.eks-progress-bar` 和 `.eks-task-meta.elapsed` 文本
- `refreshProgressOnly(task)` —— Plugin 新方法，分发到所有 dashboard 视图的 `refreshProgress`

### ⚙ 版本号
- `DEFAULT_SETTINGS.settingsVersion` 7 → **8**
- `manifest.json` 版本 1.1.7 → **1.1.8**

### 🔧 回滚
如果拆分批次后总耗时变长（确实会变长一点，因为多 N-3N 个 API 请求的开销），只需在设置里把 `maxPointsPerRequest` 调到 2 或 3 即可。心跳和进度条 UI 是纯增量，可以独立保留。

### ❌ 不在本版本范围
- **SSE 流式接收**：架构改动太大，留给 v1.2
- **服务端 token 计数显示**：MiniMax API 响应里有 `usage` 字段但本次不读取

---

## v1.1.7 — 2026-07-14 诊断日志写入文件

### 📄 文件版诊断日志
用户反馈无法打开 Obsidian DevTools（Ctrl+Shift+I），v1.1.6 的 console-only 诊断日志拿不到。v1.1.7 改为同时把诊断日志**写入文件**：

- 路径：`<vault>/.obsidian/plugins/engineering-knowledge-slicer/diag.log`
- 文件包含自解释 header（告诉用户这个文件是干什么的、怎么用）
- 每次 diag 调用入缓冲区，**1 秒后批量 flush**，避免每条诊断都同步 IO 卡 UI
- 文件大小自动 trim 到最近 **2000 行**，避免无限增长
- 卸载插件时 `forceFlushDiag()` 确保最后一批日志落盘
- 首次加载时用 `Notice` 告知用户文件位置（用 `__diagLogNotifiedVersion` 字段避免每次启动都骚扰）
- 密钥指纹规则保持：所有带 `key/token/secret/password` 字段名的字符串值自动转 `fp:xxxxxxxx` 指纹

### 📋 用户排查 SOP（v1.1.7 路径）
1. 触发一次扫描或点一次"测试 PaddleOCR 连接"
2. 在 Obsidian 里打开 `<vault>/.obsidian/plugins/engineering-knowledge-slicer/diag.log` 文件
3. 全文选中 → 复制 → 发给我

### ⚙ 版本号
- `DEFAULT_SETTINGS.settingsVersion` 6 → **7**
- `manifest.json` 版本 1.1.6 → **1.1.7**

---

## v1.1.6 — 2026-07-14 诊断日志增强（v1.1.5 hotfix 续）

### 🔬 全面接入 `[EKS diag]` 诊断日志
用户在 v1.1.5 hotfix 后报告"提示了另一个报错"，因截图文字渲染不可靠，无法精确定位根因。v1.1.6 改为**主动暴露诊断信号**，让用户在 DevTools Console 里 grep `[EKS diag]` 一行就能定位：

- `diag(scope, payload)` 统一输出入口，输出形如 `[EKS diag] minimax.timeout {"endpoint":"...","timeoutMs":300000,"stage":"classification"}`
- `keyFingerprint(value)` 计算 sha256 前 8 字符指纹，**任何带 key/token/secret 的字段在诊断日志里自动转成指纹**，绝不泄露原值
- `loadSecretsFile` 加载后立即报告：文件路径、大小、各字段指纹（empty / fp:xxxxxxxx）
- `onload` 报告 effective 状态：三个密钥指纹 + 三个 endpoint + useEnvKeys 开关
- `testServiceConnection` 每个分支都打点：`start` / `noKey` / `noFetch` / `response` / `auth` / `error`
- `requestMiniMaxJson` 三类失败都打点：`timeout` / `transport` / `http`，每条都带 endpoint + stage + status + 服务端响应前 500 字符
- `processTask` 失败时打 `processTask.failed` 带 sourcePath + stage + errorClass + errorMessage

### 🪧 错误显示更明确
- `Notice` "工程知识切片处理失败：…" 改为 "工程知识切片处理失败（**stage**）：…"，避免被截图终端渲染误导
- `testServiceConnection` 401/403 时把**服务端响应前 200 字符**直接拼到错误信息里，让截图也能看到关键错误

### ⚙ 版本号
- `DEFAULT_SETTINGS.settingsVersion` 5 → **6**
- `manifest.json` 版本 1.1.3 → **1.1.6**

### 📋 用户排查 SOP
1. 触发一次"测试 PaddleOCR 连接"或一次扫描
2. 打开 Obsidian DevTools（Ctrl+Shift+I / Cmd+Opt+I）
3. Console 面板顶部过滤框输入：`[EKS diag]`
4. 把过滤后的日志复制贴给我，每一行都自带定位信息
5. 99% 一次对话就能定位根因并修掉

---

## v1.1.3 — 2026-07-14 编码 / 二进制乱码根治

### 🔒 错误信息不再泄密（F1）
- `sanitizeSecret` 重写，原正则只匹配 `sk-*`，无法遮蔽 MiniMax、PaddleOCR、MinerU、Bearer JWT、URL `?api_key=` 等形态。现改为四段组合：
  - `Bearer <token>`、`sk-…` / `sk_…` / `key-…`
  - URL 中的 `token=`、`access_token=`、`api_key=`、`apikey=`、`password=`、`secret=`
  - 32 字符以上 + 紧邻 `key/token/secret` 上下文的字面长串
- 同时 `sanitizeError` 调用点回归到 `sanitizeSecret`，统一遮蔽规则。

### 🛡 二进制文件不再被当文本送 AI（F2 + F6）
- `decodeTextBuffer` 在 BOM / UTF-16 检测之前增加 **NUL 字节防线**：
  含 NUL 且不属于合法 UTF-8/UTF-16 BOM 上下文的缓冲区直接返回 `binary-rejected`，让上游走 `failed` 分支而不是把 PDF/ZIP/图片字节流送进 AI。
- 解码结束后增加 **最低自信度兜底**（`DECODE_MIN_CONFIDENCE = -0.15`）：
  当所有候选编码评分都低于阈值时返回 `low-confidence`，避免"挑出最不坏"的乱码文本。
- 单元测试覆盖：UTF-8 长中文、UTF-8 BOM、GBK、Shift-JIS、PDF 含 NUL、ZIP 含 NUL、空 buffer、随机短字节、emoji 中文混合，均按预期分类。

### 🔧 路径与文本规范化（F4）
- 新增 `normalizeUnicodeForm(value)`：先做 NFC 规范化（防 macOS NFD vs Windows NFC 失配），再剥离不可见控制字符，统一全角空格为半角空格。
- `processTask` 入口、`migrateTaskLedgerV3`、`isInIntake` / `isInternalSlicerFile` 全部统一调用 `normalizeUnicodeForm` 后再比较路径。
- 老任务里 `source_path` 字段空值 / NUL / 控制字符都会被规范化掉，减少"找不到源文件"的报错。

### 🧱 健壮性（F3 + F5）
- `processTask` 入口断言 `current.source_path` 不为空，否则抛"源文件路径为空"明确信息，而非后续 NPE。
- 新增 `safeBufferFrom(input, encoding)` 助手：统一处理 `null`、`undefined`、`Buffer`、`ArrayBuffer`、`TypedArray`、`string`、`其他` 这 7 种输入形态，避免 multipart / uploadBody 路径上 Buffer 构造在边缘输入下崩溃。

### ⚙ 版本号
- `DEFAULT_SETTINGS.settingsVersion` 4 → 5；
- `manifest.json` 版本 1.1.2 → 1.1.3。

### 🐞 Hotfix — 2026-07-14
- **跨 bundle 模块作用域修复 (v1.1.5)**：v1.1.3 / v1.1.4 把 `normalizeUnicodeForm` **错误地**落在 `src/core/task.js` bundle 模块内部（line 1987）。`"src/core/task.js"` 是 IIFE 内独立作用域模块，**Plugin class** 所在的 `main.js` bundle 模块里的方法（`processTask`、`isInIntake`、`isInternalSlicerFile`）词法作用域看不到它，于是运行时仍报 `normalizeUnicodeForm is not defined`。
- v1.1.5 修复：
  1. 在 `main.js` bundle 模块顶部（与 `loadSecretsFile` / `RateLimiter` 同级，plugin class 闭包可见）添加**权威定义**（line 46）。
  2. 删除原 task.js 模块内的误导性副本（line 2003）。
  3. `src/core/migration.js` 模块内的同款副本（line 3172）保留——`migration.js` 是独立 bundle 模块，必须自带定义才能被 `migrateTaskLedgerV3` 看到。
- **最终可达性**：8 处 `normalizeUnicodeForm` 引用全部可解析——6 处在 `main.js` 模块内 → 走 line 46 的主定义；2 处在 `src/core/migration.js` 模块内 → 走 line 3172 的模块内副本。

---

## v1.1.2 — 2026-07-14 升级正确性修复

### 🔴 升级一致性
- **`DEFAULT_SETTINGS` 与 `migrateSettings` 真正落地 v1.1.1 数值**：自动入库门槛 0.85 → **0.9**、并发 1 → **3**、`aiChunkSize` 6000 → **8000**、`aiMaxChunks` 60 → **100**、`pdfExternalTimeoutMs` 5min → **10min**、`aiRequestTimeoutMs` 3min → **5min**。
- 新增 `rateLimitMs / rateLimitMaxConcurrent / useEnvKeys / aiRequestMaxAttempts / aiRetryBaseMs` 默认值，老用户升级时一次性补齐。
- 老用户的 `autoApproveConfidenceThreshold` 自动升级到 0.9（保留主动调至 < 0.85 的偏好），并发 < 2 升到 3，超时 ≤ 旧默认的升到新默认。

### 🔒 启动时序
- `onload` 中 `saveData` 移到 `loadSecretsFile()` 注入之后，避免在密钥未注入时把空字段先写盘造成"看似无密钥"的伪装缺失。
- 密钥读取受 `useEnvKeys` 开关控制，用户可在 UI 中关闭回落到 UI 输入模式。

### 🧹 仓库整理
- 删除孤儿源码目录 `src/`、`src-disabled-20260708132426/`（main.js 是自包含 bundle，运行不依赖这些源码）。
- 新增 `.gitignore`、`README.md`、`package.json`，方便后续接 GitHub Actions 与本地构建。

---

## v1.1.1 — 2026-07-13 安全与稳定性修复

### 🔴 安全修复
- **密钥外部化**：API 密钥不再明文存储在 data.json 中（OneDrive 同步目录）。密钥迁移至 `~/.eks-secrets.json`（用户主目录，不同步）。插件启动时自动读取。
  - MiniMax API Key
  - MinerU JWT Token
  - PaddleOCR API Key
- data.json 中三个密钥字段已清空，新增 `useEnvKeys: true` 标记

### 🔴 编码修复
- manifest.json：修复中文 name 和 description 乱码（原文件编码为 GBK 导致 UTF-8 读取异常）
- data.json：修复所有中文路径乱码（intakePath、outputPath 等 11 个字段）

### 🟡 稳定性改进
- `maxConcurrentDocuments`: 1 → 3（支持并发处理）
- `aiChunkSize`: 6000 → 8000（减少大文档截断风险）
- `aiMaxChunks`: 60 → 100（最大处理量 80 万字符）
- `pdfExternalTimeoutMs`: 300000 → 600000（OCR 超时 5min → 10min）
- `aiRequestTimeoutMs`: 180000 → 300000（AI 请求超时 3min → 5min）
- `autoApproveConfidenceThreshold`: 0.85 → 0.9（提高自动入库门槛）

### 🟡 速率限制
- 新增 `RateLimiter` 类（intervalMs + maxConcurrent 双重控制）
- 新增 `rateLimitMs: 1000` 和 `rateLimitMaxConcurrent: 2` 配置项
- 任务间自动插入速率延迟，防止 API 限流

### 🟢 体验改进
- 500 任务上限触发时显示明确提示，告知用户剩余任务需再次运行
- 新增「回滚最近一批卡片」命令（命令面板搜索"回滚"）
- PaddleOCR 脚本先检测 CLI/API 可用性再执行，避免无谓等待
- pdf_extract.py 新增 total_pages 返回和更友好的提示信息

### ⚠️ 已知问题
- `src-disabled-20260708132426` 为旧源码归档，与当前 main.js 不完全对应（新增 7 个模块源码未保留）
- 回滚功能仅支持删除已入库文件，暂不支持恢复 MOC 索引

### 📁 密钥配置说明
密钥文件位置：`C:\Users\fu.lixiang\.eks-secrets.json`
```json
{
  "minimaxApiKey": "你的 MiniMax API Key",
  "pdfMineruApiKey": "你的 MinerU JWT Token",
  "pdfPaddleOcrApiKey": "你的 PaddleOCR API Key"
}
```
如需更换密钥，直接编辑此文件后重启 Obsidian 即可。
