# 工程知识切片 变更记录

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
