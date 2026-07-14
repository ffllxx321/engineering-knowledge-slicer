# 工程知识切片 变更记录

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
