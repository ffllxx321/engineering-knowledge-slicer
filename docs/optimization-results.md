# 系统优化结果

## 修改与原因

1. 所有设置写入统一经过 secret 过滤，修复环境密钥可能回写 `data.json` 的 P0 风险。
2. artifact 升级为 v2 envelope，加入 source/runtime 输入指纹、完成时间和校验状态；旧 artifact 继续可读。
3. 新增稳定 `AppError`、错误分类、深层日志脱敏、确定性退避、阶段指标和机器可读 ValidationReport。
4. workflow 每张卡只生成一次 ValidationReport，审核与后续写入可直接复用。
5. RateLimiter 增加 FIFO 排队取消与 queue timeout；任务 AbortController 贯穿 MiniMax JSON/SSE、MinerU/PaddleOCR 上传、轮询等待和下载。
6. 修复批内重复原子在首项进入 review 时未占用 fingerprint 的缺陷；稳定文件 upsert 保持。
7. 组件包按 path+mtime+size 缓存；切片增加可选稳定 ID、指纹、页码、标题路径、token 与 overlap metadata。
8. Dashboard 增加可点击总览筛选、任务搜索/状态筛选、折叠时间线、错误代码中心、ARIA 与焦点样式。
9. 新增 8 项确定性 workflow/recovery/abort/Retry-After 集成测试，并把 21 项 splitter 测试纳入默认测试命令。

命令、右键入口、输入/输出目录、固定路由、Markdown 正文、Frontmatter、Schema、Type Mapping、Tag Library、source_hash/card_id/atom_fingerprint 均保持不变。

## 实测

纠正续作基线 benchmark（Node v22.22.2，100 次）：短文档 2.05ms（均值 0.0205ms）；4,463 字结构文档 71.67ms（均值 0.7167ms）；关闭合并 20.09ms（均值 0.2009ms）。最终复验为 3.27ms（均值 0.0327ms）、88.05ms（均值 0.8805ms）和 36.76ms（均值 0.3676ms），均为 120 chunks。微基准存在运行抖动；新增 provenance 有可测 CPU 开销且没有减少该 fixture 的调用数，因此不声称性能提升。

真实 API 调用、供应商延迟和 token 成本未实测，不做量化声明。检查点恢复的行为由代码级确定性测试证明：source/runtime 指纹一致复用，变化则 miss；旧 artifact 仍读取。任务账本写入、UI 全刷新、hash 次数没有新的端到端计数器基线，因此不做百分比声明。

## 变化摘要

- AI 调用：确定性恢复集成测试中，classification/summary/atoms 三个有效 checkpoint 下 provider 调用为 0；真实网络延迟未测。
- Prompt：现有轻量分类、结构切片、summary 驱动原子化保持；规模未新增正文。
- 文件 IO：artifact 多一层小型 metadata；任务 ledger 防抖/滚动备份保持。预期恢复正确性提高，未宣称 IO 降幅。
- UI：1 秒心跳增量 DOM 路径保持；任务/错误交互已实现。没有浏览器 instrumentation，完整刷新次数未量化。
- 错误：稳定 code、retryable、位置、建议；Header/JWT/Bearer/query/嵌套字段脱敏。
- 知识：每卡 ValidationReport；已有结构切片、精确去重和 typed relations 保持。

## 兼容性与迁移

无需用户操作。旧 settings、任务数组和 raw artifact 均继续读取；新 artifact 在首次重跑阶段自然写成 v2。旧卡无需迁移或重新处理。若回退旧版本，新 v2 artifact 不会被旧代码识别为原 payload，建议回退前只删除 `_slicer_artifacts` 中目标 run 的中间产物，绝不删除知识卡或源文件。

## 严格 gap closure 补充

- 成功 map chunk 现按 stable chunk ID 独立持久化，reduce 失败后的重启只重试 reduce。
- 新增无外部数据库的 token cosine/SimHash 候选、实体 alias registry、reverse/evolution sidecar 和每项目 Wiki。
- 任务支持多选/批量动作/50 项分页，服务测试结果跨会话持久化。
- strict JSDoc typecheck 已建立；真实 esbuild 在临时目录运行并断言不改写手工生产 bundle。
- 写入使用临时文件、读回校验、rename/rollback transaction；不支持 adapter transaction 时使用带读回与恢复的 Vault API fallback。

## 外部验证边界

供应商 remote job cancel endpoint 不存在于当前适配契约；本地 queue/fetch/sleep/polling 已取消。真实付费 API 延迟、费用、OCR 准确率及 Obsidian 真机屏幕阅读器/主题仍需外部环境，因此不做伪造量化。

## 手动验证与回滚

在测试 vault 中：启用插件；扫描短文档；观察阶段进度；中断后继续并确认 artifact cache hit；修改 pipeline/prompt/schema version 后确认 cache miss；制造 429/401 mock 检查错误建议；审核 ValidationReport；用浅/深主题及键盘检查主要操作。回滚代码使用本提交的父提交；用户数据无需迁移。若只回滚缓存格式，删除目标 run artifact 后重试即可。
