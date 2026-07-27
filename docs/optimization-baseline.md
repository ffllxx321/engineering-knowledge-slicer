# 优化基线（2026-07-27）

## 仓库与工具链

- 初始提交：`c5a40b4a0a856f014bde074ed3a941903cd75b24`
- 初始分支：`main`，与 `origin/main` 同步；工作区干净
- 形态：Obsidian Desktop 原生 DOM 插件；生产实现是 7,639 行自包含 `main.js` bundle，`src/main.js` 为占位边界
- Node：v22.22.2；包管理：npm；初始无 lockfile，本次 `npm install --ignore-scripts` 生成 lockfile
- ESLint：缺失；TypeScript 源码/typecheck：缺失。没有伪造 typecheck；本次补充 `npm run lint` 作为 JavaScript 语法门

## 初始验证

| 检查 | 命令 | 初始结果 |
|---|---|---|
| 依赖完整性 | `npm install --ignore-scripts` | 通过 |
| lint | 无既有命令 | 缺失 |
| typecheck | 无既有命令 | 缺失 |
| unit/integration | `npm test` | 通过：6 split + rate limiter + 7 JSON repair + 23 v2.9.2 + 5 reliability |
| build | `npm run build` | 通过（`node --check main.js`） |
| benchmark | 无既有命令 | 缺失 |

已有测试覆盖切片、限流、JSON 修复、SSE 接线、原子归属、上传授权、总结并发、重试落盘和滚动备份；不依赖真实付费 API。缺少统一错误、深层脱敏、检查点失效、ValidationReport、路径安全和完整 Obsidian UI 自动化。

## 真实工作流

入口为命令、ribbon、文件右键和 Dashboard；`scanSourceFiles` 计算内容 hash 并创建任务；`processTask` 依次执行解析、运行时契约加载、分类、分段总结、原子化、置信度/去重、审核或写入。状态主序列为 `queued → parsing → parsed → classifying → summarizing → atomizing → validating → writing → written/needs_review`，另有 `paused/cancelled/failed/unsupported`。

外部调用点：MiniMax JSON/SSE、MinerU 上传/轮询/下载、PaddleOCR 上传/轮询。真实服务、网络延迟、OCR 质量与 token 账单未在本地重现。

持久化点：`tasks.json` 与滚动备份、每阶段 artifact、summary Markdown、review artifact、逐任务日志、rollback ledger、卡片/MOC。UI 刷新点：关键状态调用全视图 `render()`；心跳调用 `refreshProgress()` 只更新进度 DOM。

## 基线风险

- P0：环境密钥注入 `this.settings` 后，多个路径直接 `saveData(this.settings)`，可能写入 vault 中的插件数据。
- P1：artifact 只按文件存在复用，不校验 source/pipeline/prompt/schema 指纹。
- P1：错误仍以自由文本为主，重试决策和用户建议不稳定。
- P1：ValidationReport 未形成单一机器可读产物。
- P2：运行时契约和任务账本在阶段间仍有重复读取；已有 500ms 防抖但关键路径仍经常 load/merge。
- P2：单一 AI limiter 覆盖 MiniMax JSON/SSE；解析服务自身轮询尚无共享 provider limiter。
- P2：Dashboard 信息架构仍是单页；缺少完整筛选、分页、任务时间线和错误中心。
- P3：生产 bundle 手工维护，`src/` 与生成物边界不理想，暂不适合高风险拆包。

假设：为保持发布兼容，本轮不把 bundle 一次性迁移到 TypeScript/ESM；新增能力采用 bundle 内纯模块与可抽取测试。
