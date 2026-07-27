# 1. Executive Summary

主要根因是阶段恢复缺少完整行为证据、取消没有真正贯穿外部请求、组件契约重复读取、批内 fingerprint 占用时机错误，以及 Dashboard 只有概览而缺少可操作任务/错误视图。本次在保持路径、Schema、卡片 identity、命令与旧数据读取兼容的前提下，交付 AbortSignal 全链、RateLimiter 排队取消/超时/Retry-After、mtime cache、稳定 chunk provenance、批内重复修复、确定性恢复测试和原生 UI 改进。未发现仓库中的明文生产密钥；此前 settings 回写风险继续由过滤入口保护。

# 2. Baseline

- 初始 lint：通过，但只是 `node --check`，不是 ESLint。
- 初始 typecheck：不存在正式命令，未伪造。
- 初始 test：通过；默认命令当时漏掉 21 项 splitter 测试。
- 初始 build：通过，但只是 `node --check main.js`。
- 初始 benchmark：short 2.05ms/100；long structured 71.67ms/100；不含外部网络。

# 3. Critical Findings

- P0 `SEC-01`，settings persistence：运行时 secret 可能进入同步 vault；已由 `saveSafeSettings` 和测试修复。
- P1 `QUAL-02`，workflow fingerprint set：review 原子未立即占用 fingerprint，后续同批副本可重复；已修复并集成验证。
- P1 `PERF-04`，RateLimiter/MinerU/PaddleOCR/MiniMax：取消只在阶段边界生效；已贯穿 signal。
- P1 `PERF-03`，summary map：成功 chunk 未独立持久化，reduce 失败可能重复 map；未完成，保留为真实风险。
- P2 `PERF-06`，component loaders：每任务重复读 schema/prompt/tag/map；已加 mtime+size cache。
- P2 `UX-01`，Dashboard：缺少任务筛选、时间线和错误中心；已交付基础生产 UI。
- P3 `ARCH-01`，bundle/source：生产源码仍是单文件 bundle，无正式 typecheck；为避免一次性高风险重写，本次未迁移。

# 4. Duplicate Work Removed

- 组件包重复读取 → path+mtime+size cache；文件变化自动 miss。
- 恢复时重复分类/总结/原子化 → v2 stage artifact 复用；集成测试 provider calls = 0。
- 同响应重复 atom → 首次判定即 reserve fingerprint；测试只产生一张 accepted card。
- 心跳全量刷新 → 保持局部 progress/message/elapsed DOM 更新。
- 取消后继续 polling → signal 中止 sleep/fetch，测试 call count 停在 3。

# 5. Performance Results

- API 调用：恢复 fixture 从理论 3 个昂贵阶段调用降为实测 0；不代表真实网络耗时比例。
- Prompt 输入：本次未改正文输入规模；未做 token 成本量化。
- Hash：document fingerprint 从初版错误的逐 chunk 重算修正为每次 split 一次。
- 磁盘写入：组件包命中不再读 vault；tasks 仍用 500ms 防抖和滚动备份。未做 adapter 全量计数。
- UI 全刷新：1 秒 heartbeat 为局部更新；无 Obsidian render instrumentation，不量化次数。
- 最终 benchmark：short 3.27ms/100；long 88.05ms/100；long-no-coalesce 36.76ms/100。新增 provenance 有开销，不声称本地切片更快。

# 6. Knowledge Slicing Improvements

- 分段：保留 heading/paragraph/table/code/formula 结构边界。
- 原子化：继续只读结构化 summary 与 evidence，不无条件重发全文。
- 去重：修复批内 reserve，并保留历史精确 fingerprint。
- 证据：新增 stableChunkId、contentFingerprint、page range、headingPath、tokenEstimate、overlap。
- 关系：保留 supports/contradicts/supersedes/depends_on/implements/related。
- 演化：optional supersedes/contradicts 与 frontmatter/render 基础保持。
- 聚合页：固定目录 Dataview `_索引` 保持；独立项目 Wiki 尚未自动生成。

# 7. UI/UX Improvements

- 总览数字可点击筛选。
- 任务支持文件搜索、状态筛选、100 项上限、折叠详情、阶段时间线、重试/取消/打开源文件。
- 审核保持异常优先、原因分组、批量批准/修正/重做/丢弃与详情。
- 错误按稳定 code 分组，显示文件、阶段、建议和折叠技术信息。
- 设置保持基础路径、服务和高级并发/限流/超时分组。
- 进度继续显示当前文件、阶段、批次、elapsed，不制造无依据百分比。
- 可访问性增加文字状态、aria-label/live、focus-visible 和长文本换行。

# 8. Files Changed

- `main.js`：生产 workflow、限流/取消、缓存、chunk metadata、去重和 UI。
- `styles.css`：任务/错误/时间线与可访问焦点样式。
- `scripts/integration-workflow-recovery.js`：恢复、去重、取消和 Retry-After 集成测试。
- `package.json`：把 splitter 与新集成测试纳入默认 test。
- `README.md`、`CHANGELOG.md`：用户能力和限制。
- `docs/*.md`：基线、审计、差距、UI、结果、追踪矩阵和本报告。

# 9. Compatibility

- 历史任务：兼容，v3 ledger migration 与旧 artifact raw payload 读取保持。
- 历史卡片：兼容，没有删除/重命名 frontmatter；旧 `chunk_id` 保持。
- 配置：兼容，未改变固定输入/输出/route 含义。
- 迁移：无需手动迁移；artifact v2 惰性写入。
- 历史资料：无需重新处理。

# 10. Verification

- `npm ci`：通过。
- `npm run lint`：通过（语法门）。
- typecheck：仓库无正式命令。
- `npm test`：通过，包含 6 split、21 splitter、RateLimiter、7 JSON、23 v2.9.2、5 performance、9 reliability、8 integration。
- `npm run build`：通过（语法门）。
- `npm run benchmark`：通过。
- 额外 smoke：diag 9、email 12、encoding 21、comprehensive encoding 37 全通过。
- `git diff --check`：通过。

# 11. Remaining Risks

- map chunk 尚未独立持久化；reduce 失败会重复成功 map。
- 没有正式 TypeScript typecheck/ESLint/真实 esbuild 产物重建门。
- 跨文档语义近重复、实体 alias registry、自动项目 Wiki 尚未实现。
- Obsidian 宿主中的浅深主题、屏幕阅读器与真实大库 render 次数需手工验证。
- 远程供应商 job 已提交后没有仓库可用的 server-side cancel API；本地会停止等待和后续请求。

# 12. Recommended Next Steps

1. 以 chunk fingerprint 建立独立 map artifact，支持仅重试失败 chunk。
2. 把自包含 bundle 迁移到可构建 source modules，并建立真实 typecheck/esbuild CI。
3. 在 Obsidian 测试 vault 加 UI harness，测 render 次数、键盘与浅深主题。
4. 增加可选近重复 sidecar 与实体 alias 人工反馈，不引入图数据库。
5. 为 MinerU/PaddleOCR adapter 增加供应商支持时的 server-side cancel。

## 15 项完成检查

1. [x] 阅读真实仓库：baseline/audit。
2. [x] 运行构建和测试：Verification。
3. [x] 性能/工作流基线：baseline/benchmark。
4. [x] 重复工作代码证据：workflow audit。
5. [x] 低风险性能优化：cache/cancel/checkpoint。
6. [x] 不重复卡片：integration duplicate assertions。
7. [x] 恢复不重复 provider：integration provider calls = 0。
8. [x] 结构化错误：AppError/reference。
9. [x] 脱敏日志：reliability tests。
10. [x] 用户可见进度：heartbeat/task timeline。
11. [x] 新增测试：8 integration + default splitter。
12. [~] lint/test/build 已运行；正式 typecheck 不存在，明确记录。
13. [x] 未实测项没有量化声明。
14. [x] 保持功能与数据兼容。
15. [x] 摘要、迁移与回滚说明齐全。
