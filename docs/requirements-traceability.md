# Phase 0–5 严格追踪矩阵

## v2.20 通用企业知识管线

| 要求 | 生产证据 | 自动化证据 |
|---|---|---|
| 物理解析与语义理解分离、未知格式降级 | `canonicalizeDocument` | `testCanonicalAndProfile`、跨格式等价 |
| 多标签画像与区域级语义分割 | `inferProfile`、`segmentDocument` | mixed/long/dense tests |
| 通用知识单元、旧 artifact 规范化 | `normalizeKnowledgeUnit`、`planKnowledgeUnits` | legacy migration/boundary tests |
| 区域覆盖、局部修复、压缩遥测 | `repairCoverage`、telemetry | coverage/cost tests |
| 单元级两库、标签规范化 | `routeUnit`、`normalizeTags` | mixed routing/tag tests |
| 证据关系、稳定双向链接、归档 | `relationEvidence`、structured writer | relation/archive/idempotence tests |
| 四记录、完整计划、事务/回滚 | `buildCanonicalRecords`、`buildPlan`、`commitPlan` | universal E2E + existing writer rollback suites |
| 少量分组审核、无正常 UI JSON | `groupedReview`、`humanLocator` | grouped review/Markdown assertions |
| 生产接线与内置回退 | `runStructuredWriterPhase`、embedded module | embed/build/builtin fallback suites |

架构与用户配置边界见 `docs/universal-enterprise-knowledge-pipeline-v220.md`。

审计基点 `a42cd418`，2026-07-27。完成只表示生产路径和确定性自动化证据同时存在；外部供应商效果不以本地测试冒充。

## 未发布 Phase 2/3 生产阶段

| 能力 | 状态 | 生产证据 |
|---|---|---|
| 默认关闭、Advanced 可见、Pilot/Cutover 互斥 | 完成 | settings/migration/UI 与 `runStructuredWriterPhase` |
| 真实 normalized block → Phase 2 → Phase 3 → plan | 完成 | 复用 workflow artifact；新增 provider 请求为 0 |
| 四类稳定 ID、中文 Markdown、版本化 ID→path | 完成 | `src/structured-writer.js` |
| 精确项目登记与确定性两库路由 | 完成 | `project-registry.v1.json`、Phase 1 category |
| 类型关系、稳定 wikilink、分组待处理 | 完成 | `RELATION_TYPES`、`resolveRelations` |
| CompanyKnowledge 人工批准 | 完成 | 未传批准 decision 不生成 |
| dry-run、锁、事务、隔离恢复、文档回滚 | 完成 | `buildPlan`、`commitPlan`、`rollbackTransaction` |
| 幂等、归档移动链接、旧卡/来源兼容 | 完成 | hash=noop、ID basename link、互斥 writer |
| 成本/大小边界与 bundle 单一接口 | 完成 | 零额外 linking AI、三项上限、embed sync check |

| Phase | 要求 | 状态 | 生产证据 | 自动化证据 |
|---|---|---|---|---|
| 0 | 依赖、lint、typecheck、test、build、benchmark、安全 | 完成 | `package.json`、`tsconfig.json`、安全设置入口 | 完整验证命令、可靠性/secret tests |
| 1 | 错误、日志、阶段与 IO/API/prompt/UI 计数 | 完成 | `AppError`、`createStageMetric`、`operationCounters` | reliability 与 gap-closure tests |
| 1 | Mock Provider 与恢复夹具 | 完成 | provider adapter 注入点 | workflow recovery + map/reduce restart fixture |
| 2 | 缓存、hash、去重、防抖、事务写 | 完成 | component cache、identity、验证式 temp/rename/rollback + Vault fallback | performance/reliability 与生产证据断言 |
| 2 | 独立供应商 limiter、取消、失败阶段复用 | 完成 | 三供应商独立 limiter、AbortSignal、stage + map artifact | rate-limit、abort、map/reduce restart tests |
| 3 | 轻量分类、结构切分、summary 原子化、ValidationReport | 完成 | ai-pipeline/workflow | splitter/workflow suites |
| 3 | Prompt 公共规则去重及指纹失效 | 完成 | `COMMON_PROMPT_RULES`、`composePrompt`、artifact fingerprint | prompt dedup + checkpoint tests |
| 4 | chunk、近重复、实体 alias/index | 完成（无外部数据库基础） | stable chunk、cosine/SimHash、`knowledge-index.v1.json` | semantic/entity tests |
| 4 | typed/reverse/evolution relation、影响追踪 | 完成 | relation whitelist、reverse/evolution index | link index assertions |
| 4 | 每项目聚合页 | 完成 | `_项目/<project>.md` 静态链接 + Dataview | aggregation renderer test |
| 5 | 总览、任务批选、大列表扩展 | 完成 | 搜索、筛选、50 项分页、多选、批量重试/取消 | lightweight DOM mock |
| 5 | 审核、错误、设置、服务测试 | 完成 | 审核白名单修正、错误中心、持久 service results | review/reliability/evidence tests |
| 5 | 可访问性 | 完成（自动化可验证范围） | labels/live/button/focus/text status | lightweight DOM mock |
| 0–5 | JavaScript 类型质量与真实 build | 完成 | strict `@ts-check` JSDoc contracts；temp esbuild | `npm run typecheck/build`，不改生产 bundle |

## 外部验证边界（不是生产代码缺口）

- 供应商契约没有远端 cancel endpoint；本地会停止 queue/fetch/sleep/polling，不能声称撤销服务器 job。
- 真实 OCR 准确率、AI 费用和网络延迟需要用户凭据；CI 不调用付费 API。
- Obsidian/Electron 的屏幕阅读器、第三方主题和真实超大 Vault 需宿主集成环境；仓库覆盖 DOM/ARIA 契约与分页状态。

## Section 20

15 项完成标准均有代码和命令/自动化证据。完整 12 节结果、兼容性、回滚和 gap-closure checklist 见 `docs/final-delivery-report.md`。
