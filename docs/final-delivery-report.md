# 1. Executive Summary

主要性能根因是 reduce 失败会重复成功 map、写入缺少可验证提交、观测数字不完整，以及历史索引/UI 大列表能力不足。重复工作已通过 chunk checkpoint、共享 prompt 规则、阶段缓存和分页消除。核心改进包含事务写、三供应商独立 limiter、运行计数、无数据库语义/实体/关系索引、项目页、批量 UI、持久连接测试及真实质量门禁。历史 schema、route、frontmatter、identity、命令与数据读取保持兼容。secret scan 未发现明文生产密钥。

# 2. Baseline

- 初始 lint：通过，仅语法门。
- 初始 typecheck：缺失。
- 初始 test：通过。
- 初始 build：通过，仅 `node --check main.js`。
- 初始 benchmark：short 14.33ms/100；long 334.84ms/100；no-coalesce 79.87ms/100（微基准有运行抖动）。

# 3. Critical Findings

- P0 `SEC-01`，settings persistence：历史运行时 secret 回写风险；此前已修复并保持。
- P1 `PERF-03`，`summarizeDocument`：map 无独立 checkpoint；已修复。
- P1 `DATA-02`，`writeFile/_flushSaveTasks/persistArtifact`：create/modify 无事务与读回；已修复。
- P1 `OBS-03`，workflow/UI/persistence：API/prompt/IO/UI 无统一可测计数；已修复。
- P1 `QUAL-04`，link service：语义近重复、entity alias、reverse/evolution index 缺失；已修复为本地 sidecar 基础。
- P2 `UX-03`，Dashboard/settings：无批选分页、服务结果不持久；已修复。
- P2 `BUILD-01`：typecheck 缺失、production build 会覆盖手工 bundle；已用 strict JSDoc gate 和临时真实 bundle validation 修复。

# 4. Duplicate Work Removed

- reduce 失败后的成功 map 重跑 → 每 chunk stable artifact；两次 fixture 的第二次仅 1 个 reduce call。
- prompt 公共规则重复 → `composePrompt` 去重组合；确定性 occurrence assertions。
- OCR/AI 共用瓶颈 → MiniMax/MinerU/PaddleOCR 独立队列。
- 大列表一次构造 100 行 → 50 行分页、筛选与 debounce。
- 服务状态重复人工判断 → 跨会话保存时间、状态、稳定错误码。

# 5. Performance Results

- API 调用：map/reduce restart fixture 第二次只调用 reduce 1 次；完整 stage checkpoint fixture 为 0 次。
- Prompt：新增 `promptCharacters` 实测计数；真实供应商 token 成本未实测，不做量化声明。
- Hash：保持 source hash 复用；新增每卡一次 SimHash 用于 sidecar。
- 磁盘：新增 ledger/artifact/bytesWritten counters；写入多一次临时文件/读回以换取数据安全，不声称 IO 减少。
- UI：新增 full/incremental counters；任务 DOM 每页上限从 100 降为 50。
- 最终 benchmark：short 5.68ms/100；long 151.98ms/100；no-coalesce 47.87ms/100。仅本地编排，微基准抖动明显，不推断网络收益。

# 6. Knowledge Slicing Improvements

- 分段：stable chunk ID/provenance 保持，map chunk 可独立恢复。
- 原子化：summary/evidence 输入保持。
- 去重：精确 fingerprint + token cosine/SimHash 候选基础。
- 证据：source/summary/chunk/page 元数据保持。
- 关系：typed relations 增加 reverse index。
- 演化：supersedes 与 contradictedBy index。
- 聚合页：按可选 project/project_name 生成 `_项目/<name>.md`，包含静态链接和 Dataview。

# 7. UI/UX Improvements

- 总览：既有可点击状态保持。
- 任务：checkbox 多选、本页全选、批量重试/取消、50 项分页。
- 审核：异常优先与白名单修正保持。
- 错误：稳定错误码分组保持。
- 设置：最近服务测试结果/时间/错误码持久显示。
- 进度：API/prompt/IO/full/incremental UI counters。
- 可访问性：明确 button type/disabled、任务选择 label、live region；lightweight DOM mock 自动验证。

# 8. Files Changed

- `main.js`：生产恢复、事务写、计数、limiter、索引/项目页、UI、服务状态。
- `src/quality-contracts.js`、`tsconfig.json`：strict JSDoc 类型门禁。
- `scripts/gap-closure-tests.js`：25 个 gap assertions。
- `scripts/validate-bundle-build.js`：临时真实 esbuild 与不改生产文件断言。
- `package.json`：lint/typecheck/test/build gates。
- `README.md`、`CHANGELOG.md`、`docs/*.md`：使用、证据、兼容与回滚。

# 9. Compatibility

- 历史任务：兼容，旧数组/artifact 读取不变。
- 历史卡片：兼容，不改/删 frontmatter。
- 配置：兼容，仅增加可选 `serviceTestResults`。
- 迁移：惰性、幂等 sidecar/聚合页生成；无需手动迁移。
- 历史资料：无需重新处理；新索引在新卡写入时重建。

# 10. Verification

- `npm ci`：通过。
- `npm run lint`：通过。
- `npm run typecheck`：通过（strict JSDoc contract）。
- `npm test`：通过；既有 suites + recovery 8 + gap closure 25。
- `npm run build`：通过；410,335-byte temp bundle，生产 `main.js` 未改变。
- `npm run benchmark`：通过。
- extra legacy：diag 9、email 12、encoding 21、comprehensive encoding 37，全通过。
- secret scan、`git diff --check`：通过。

# 11. Remaining Risks

- 供应商未提供 remote cancel endpoint，服务器 job 不能由现有契约撤销；本地取消完整覆盖。
- 真实付费 API 延迟/费用/OCR 准确率未测，不做量化声明。
- Obsidian 真机屏幕阅读器、第三方主题和超大真实 Vault 仍需宿主验收。

# 12. Recommended Next Steps

1. 在具备测试凭据的隔离 Vault 做供应商非计费/小样本验收。
2. 建立 Obsidian/Electron CI harness 覆盖真实焦点和主题。
3. 收集人工确认的 entity aliases，写回 sidecar aliases 字典。
4. 供应商发布 cancel API 时接入 server-side cancellation。

## Gap-closure checklist

- [x] summary map chunk persistence/restart reuse
- [x] transactional task/artifact writes with fallback
- [x] IO/API/prompt/UI counters
- [x] prompt common-rule deduplication
- [x] semantic near-duplicate/entity alias foundation
- [x] reverse relation/evolution index and project pages
- [x] task batch selection and scalable pagination
- [x] persistent service-test results and review safeguards
- [x] lightweight automated DOM/accessibility evidence
- [x] provider limiters and local cancellation coverage
- [x] strict JSDoc typecheck and non-corrupting real build validation
