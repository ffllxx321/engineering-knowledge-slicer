# 工作流与性能审计

调用链：命令/右键/Dashboard → `scanSourceFiles` / `processSingleFile` → `processTask` → `extractTextFromBuffer` → MinerU/PaddleOCR 条件解析 → `runKnowledgeWorkflow` → `classifyDocument` → `summarizeDocument`（结构切片/map/reduce）→ `atomizeSummary` → 置信度/去重 → review 或 `writeAcceptedCard` → MOC/rollback/task ledger。

| ID | 优先级 | 类别 | 位置/函数 | 证据与根因 | 影响 | 处理与验证 |
|---|---|---|---|---|---|---|
| SEC-01 | P0 | secret | `main.js` `onload`、设置保存 | 密钥注入 settings 后直接 `saveData(settings)` | 密钥可能进入同步 vault | 已修：`saveSafeSettings`；深层测试 |
| PERF-01 | P1 | checkpoint | `loadArtifact` | 仅检查路径/JSON，不验证输入与契约 | 升级后错误复用或人工清缓存 | 已修：v2 envelope + 指纹；旧格式兼容测试 |
| REL-01 | P1 | error | `processTask` catch | 字符串错误，无稳定 code/retryable/action | UI与重试难以可靠决策 | 已修：`AppError`/分类/三层信息 |
| QUAL-01 | P1 | validation | `runKnowledgeWorkflow` | 置信度计算结果未形成复用报告 | 审核与写入可能重复推导 | 已修：每卡 `ValidationReport` |
| PERF-02 | P1 | AI | `classifyDocument` | 仓库实现已构建文档画像/代表片段而非始终全文 | 分类 token 风险已受控 | 保持；回归现有 prompt 调用图 |
| PERF-03 | P1 | AI | `summarizeDocument` | 长文档 map/reduce；成功 chunk 暂未独立持久化 | reduce 失败时可能重复 map | 部分解决（阶段级 checkpoint）；chunk 级缓存仍是明确缺口 |
| REL-ATOM-01 | P0 | AI | `atomizeSummary` | `Promise.all` 首错即拒绝，其他批次继续；启动序号误作完成进度；无批次 checkpoint | 晚到日志、心跳早停、31/31 假完成、重跑成功调用、无聚合产物 | 已修：共享取消 + `allSettled`、严格批次 checkpoint、精确归属聚合门禁 |
| PERF-04 | P1 | polling | MinerU/PaddleOCR loops | 原实现支持超时但 AbortSignal 未全链透传 | 取消等待当前 API 完成 | 已修：task controller 贯穿排队、fetch、sleep、poll、MiniMax/SSE；集成测试证明取消后不再 poll |
| PERF-05 | P2 | IO | `persistArtifact`/`setTaskProgress` | 每个 artifact 后 load tasks；进度关键点全量 merge | 大账本额外读/序列化 | 已有 500ms 写防抖；本轮保留，避免并发丢更新 |
| PERF-06 | P2 | config | `loadRuntimeContracts`/`loadTagLibraryText` | 每任务读取相同 schema/prompt/tag/folder-map | 批处理重复 vault IO | 已修：`loadComponentText` 以 path+mtime+size 缓存，修改即失效 |
| PERF-07 | P2 | UI | `refreshViews` | 关键阶段重建 Dashboard；心跳已增量 | 阶段多时仍有重排 | 已修用户功能：任务搜索/筛选/100项上限/时间线/错误中心；心跳仍仅更新局部 DOM |
| PERF-08 | P2 | limiter | `RateLimiter` | JSON/SSE 共用 MiniMax limiter，解析 provider 独立轮询无 limiter | 多供应商吞吐/公平性有限 | 保持供应商安全值；未盲目增并发 |
| PERF-09 | P2 | logging | `diag`/`flushDiagLog` | 1 秒批量、2000 行上限；旧格式非 JSONL | IO已缓冲，字段结构不完全统一 | 新错误/指标结构化；完整 JSONL 迁移暂缓 |
| QUAL-02 | P1 | duplicate | workflow fingerprint set | 原实现仅 accepted 后 reserve；首项进审核时，同批后续相同原子仍不算重复 | 可产生两条重复审核项并被同时批准 | 已修：每个原子判定后立即 reserve；确定性集成测试 |
| QUAL-03 | P2 | relation | `link-service` | 已有 typed relation 白名单 | 无实体 sidecar/演化索引 | 保持可选字段；渐进方案见 gap |
| UX-01 | P2 | UI | `SlicerDashboardView` | 单页总览/队列/审核，错误附着审核区 | 搜索、筛选、时间线、错误中心不足 | 样式/现有增量路径保留；设计规范已补 |
| ARCH-01 | P3 | build | `main.js`/`src/main.js` | bundle 是实际源码，拆包迁移风险高 | 可维护性与类型安全有限 | 未重写；新增模块仍可隔离测试 |

### 阶段 I/O 与恢复摘要

- 解析前仅首次读源二进制；成功后保存 `parsed`，恢复可跳过上传/解析。
- classification/summary/atoms 各保存 artifact；新格式验证 source hash 与运行时版本。
- prompt 输入：分类使用画像，长文档结构切片；原子化读取结构化 summary，不无条件回读全文。
- 卡片去重：source hash 任务身份 + `atom_fingerprint` Set；写入保持稳定 `card_id`。
- 失败恢复：阶段 artifact 命中则跳过昂贵阶段；指纹变化、缺失、损坏才重跑。
