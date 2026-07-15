# 工程知识切片 变更记录

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
