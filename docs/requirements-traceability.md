# Phase 0–5 与完成标准追踪矩阵

审计基点为 `49beea8`，日期 2026-07-27。状态含义：完成＝生产代码与确定性证据均存在；部分＝已交付安全基础但仍有明确缺口；阻塞＝本地环境无法验证且没有伪造结论。代码行会随 bundle 构建变化，因此以模块/函数和测试名作为稳定证据。

## Phase 0–5

| Phase | 要求 | 状态 | 生产证据 | 测试/测量证据 | 未实现或限制 |
|---|---|---|---|---|---|
| 0 | 运行依赖、lint、typecheck、test、build、benchmark | 完成 | `package.json` | `npm ci/lint/test/build/benchmark` | 仓库没有正式 ESLint 与 typecheck；build 仍是语法门 |
| 0 | 基线、当前行为、安全与密钥风险 | 完成 | `saveSafeSettings`、`sanitizeSettingsForPersistence` | `smoke-reliability-v210` | 未扫描远程供应商凭据，且不应自动轮换 |
| 0 | 脱敏日志 | 完成 | reliability `sanitizeForLog`、`redactText` | 深层 Header/JWT/query 测试 | 日志载体仍为兼容旧版的批量文本，不强迁 JSONL |
| 1 | 统一错误对象/稳定代码 | 完成 | reliability `AppError/toAppError/classifyFailure` | `smoke-reliability-v210` | 部分旧版兼容路径仍产生自由文本，主 v3 workflow 已统一 |
| 1 | 结构化指标、阶段计时、调用/Token/IO字段 | 完成 | `createStageMetric`、`performance.task` | 指标字段与脱敏测试 | 尚未对每个 Obsidian adapter IO 自动计数 |
| 1 | Mock Provider/确定性工作流夹具 | 完成 | `integration-workflow-recovery.js` | 8 项集成断言，不调用付费 API | 没有真实 OCR 精度测试 |
| 2 | 配置/组件包缓存 | 完成 | `loadComponentText` mtime+size cache | 最终 smoke + bundle syntax | Obsidian 实机 mtime 行为需手验 |
| 2 | Hash 复用、任务去重 | 完成 | `scanSourceFiles`、`processTask` 复用 `source_hash` | identity/split 既有回归 | 历史库近重复仍非语义 embedding |
| 2 | 防抖持久化与原子写/备份 | 部分 | `saveTasks/_flushSaveTasks`、滚动备份 | `smoke-performance-reliability` | vault adapter `writeFile` 是 create/modify；没有通用 rename transaction API |
| 2 | 增量 UI 刷新 | 完成 | `refreshProgressOnly/refreshProgress` | 代码路径审计 | 无 Obsidian DOM 性能自动化 |
| 2 | 独立限流/排队取消/超时 | 完成（供应商级） | `RateLimiter` FIFO、queue timeout、AbortSignal；解析服务各自轮询 | `smoke-ratelimit` + integration abort | 未盲目把 MinerU/PaddleOCR 合并进 MiniMax limiter |
| 2 | 可取消 Polling/API | 完成 | task controller → MinerU/PaddleOCR/fetch/sleep/MiniMax/SSE | integration 验证取消后 provider call 不增加 | 供应商已接收的远程 job 无取消端点可调用 |
| 2 | 失败阶段/检查点复用 | 完成（阶段级） | artifact v2 fingerprint envelope | recovery 集成：有效 artifact 为 0 provider calls | map chunk 独立持久化仍未交付 |
| 3 | 轻量分类输入 | 完成 | `classificationSample/buildClassificationPrompt` | ai-pipeline smoke | 真实分类准确率未用付费 API 实测 |
| 3 | 结构切分与 provenance | 完成 | `splitMarkdownSections` 的 stableChunkId/fingerprint/page/heading/token/overlap | `smoke-splitter-v26` 21 项 | 页码由 form-feed 映射；解析器无页边界时只能为页 1 |
| 3 | 原子化只读总结/证据 | 完成 | `atomizeSummaryBatch` | workflow tests | 精确上下文按 chunk 回取接口仍未建立 |
| 3 | ValidationReport 复用 | 完成 | workflow 每卡一次构建并挂载 review/card | reliability + integration | 写入只做稳定路径 upsert，不重复昂贵校验 |
| 3 | 公共 Prompt 与版本指纹 | 部分 | 组件包公共 prompts + artifact runtime versions | checkpoint tests | 仍有少量强制规则在运行时 prompt 组合中重复 |
| 3 | 短文档合并请求安全评估 | 完成（不合并） | 分类/总结保持独立 checkpoint | audit/results | 缺少准确率数据，故未把职责塞入单请求 |
| 4 | Chunk 稳定 ID/标题/页码/指纹 | 完成 | splitter optional metadata，保留旧 `chunk_id` | splitter smoke | 老 artifact 不强制迁移 |
| 4 | 批内和历史精确去重 | 完成 | workflow 立即 reserve fingerprint；稳定 card filename upsert | integration 无重复卡断言 | 近义改写只提供候选基础，非向量判定 |
| 4 | 近重复/实体/关系基础 | 部分 | link-service token candidates；typed relations | link/workflow integration | 没有 embedding/实体 alias registry |
| 4 | evidence/反向追踪 | 完成 | card source_link/locator/evidence/parent_summary + chunk metadata | workflow/schemas | 解析器不给页边界时无法制造精确页码 |
| 4 | evolution：supersedes/contradicts | 完成（可选基础） | relation whitelist + optional frontmatter | schema/render path | 不自动判定法律/合同替代关系，避免误连 |
| 4 | 项目聚合页 | 部分 | 固定目录 `_索引` Dataview 聚合 + project/client optional fields | build/smoke | 尚无按每个项目自动建独立 Wiki 文件 |
| 5 | 信息架构/总览 | 完成（单 View 分区） | overview/task/review/error/settings 区域 | syntax/build + CSS token审计 | 未引入多路由或框架 |
| 5 | 任务筛选/搜索/大列表 | 完成 | `renderTaskExplorer`，100 项上限 | 可测试静态代码；手验步骤见 results | 无虚拟滚动 |
| 5 | 阶段时间线/进度 | 完成 | details timeline、aria-live、heartbeat | progress tests + code audit | provider 不给百分比时不显示虚假百分比 |
| 5 | 审核/错误中心 | 完成（基础） | reason grouping、批量动作、ValidationReport modal、error code grouping | workflow/error tests | 标签编辑仍用兼容 prompt 对话框 |
| 5 | 设置分组/服务测试 | 完成（既有+保持） | 基础路径、MiniMax、云解析、高级参数、服务测试 | build | 最近连接结果未跨会话持久化 |
| 5 | 可访问性 | 完成（代码级） | text labels、focus-visible、details/summary、aria-label/live、wrap | CSS/DOM audit | 屏幕阅读器与 Obsidian 主题仍需宿主手验 |

## Section 20：15 项完成标准

| # | 标准 | 状态与证据 |
|---:|---|---|
| 1 | 阅读真实仓库 | 完成：审计生产 `main.js`、组件包、schemas、prompts、PRD、scripts、docs 与 Git 历史。 |
| 2 | 运行现有构建和测试 | 完成：基线与最终命令记录在 baseline/results。 |
| 3 | 性能和工作流基线 | 完成：`optimization-baseline.md`、benchmark JSON。 |
| 4 | 有代码位置的重复工作清单 | 完成：`workflow-performance-audit.md` Issue 表。 |
| 5 | 至少一批低风险性能优化 | 完成：mtime cache、可取消 queue/poll/fetch、阶段 checkpoint、批内 reserve。 |
| 6 | 验证不重复生成卡片 | 完成：`integration-workflow-recovery.js` 断言同响应重复原子仅一张 accepted，第二项带 DUPLICATE gate；稳定 filename upsert。 |
| 7 | 验证恢复不重复昂贵 API | 完成：同一集成测试注入三个有效产物，provider calls 精确为 0。 |
| 8 | 结构化错误代码 | 完成：reliability module 与 error reference。 |
| 9 | 脱敏日志 | 完成：嵌套 Header/JWT/query/secret tests。 |
| 10 | 用户可见进度 | 完成：轻量 heartbeat、当前文件/阶段/批次、timeline、aria-live。 |
| 11 | 补测试 | 完成：集成恢复/去重/AbortSignal/Retry-After 8 项，并把 splitter 21 项纳入默认 `npm test`。 |
| 12 | 最终 lint/typecheck/test/build | 部分环境事实：lint/test/build 已运行；不存在正式 typecheck script，明确记录为缺失而非伪造通过。 |
| 13 | 未实测不夸大 | 完成：真实供应商延迟、token 成本、Obsidian render 次数均写“未实测”。 |
| 14 | 保持基本需求和功能 | 完成：命令、右键、路径、schema、frontmatter、身份、旧 artifact/task 读取保持。 |
| 15 | 摘要和回滚说明 | 完成：`optimization-results.md` 与 migration 文档。 |
