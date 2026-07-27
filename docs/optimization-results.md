# 系统优化结果

## 修改与原因

1. 所有设置写入统一经过 secret 过滤，修复环境密钥可能回写 `data.json` 的 P0 风险。
2. artifact 升级为 v2 envelope，加入 source/runtime 输入指纹、完成时间和校验状态；旧 artifact 继续可读。
3. 新增稳定 `AppError`、错误分类、深层日志脱敏、确定性退避、阶段指标和机器可读 ValidationReport。
4. workflow 每张卡只生成一次 ValidationReport，审核与后续写入可直接复用。
5. 新增 lockfile、lint 门、9 项可靠性测试和可重复本地 benchmark。

命令、右键入口、输入/输出目录、固定路由、Markdown 正文、Frontmatter、Schema、Type Mapping、Tag Library、source_hash/card_id/atom_fingerprint 均保持不变。

## 实测

初始 `npm test` 与 build 全绿。新增 benchmark（Node v22.22.2，100 次）测得：短文档切片均值约 0.0212ms；4,463 字结构文档启用合并路径约 0.7191ms/次、关闭合并约 0.2054ms/次，均产出 120 chunks。该 fixture 没有产生调用数下降，因此不声称合并带来收益；它揭示大量同级短章节场景仍需策略优化。

真实 API 调用、供应商延迟和 token 成本未实测，不做量化声明。检查点恢复的行为由代码级确定性测试证明：source/runtime 指纹一致复用，变化则 miss；旧 artifact 仍读取。任务账本写入、UI 全刷新、hash 次数没有新的端到端计数器基线，因此不做百分比声明。

## 变化摘要

- AI 调用：编排结构不变；恢复时更安全复用阶段，避免错误复用。预期减少有效检查点后的重复调用，未测真实 API。
- Prompt：现有轻量分类、结构切片、summary 驱动原子化保持；规模未新增正文。
- 文件 IO：artifact 多一层小型 metadata；任务 ledger 防抖/滚动备份保持。预期恢复正确性提高，未宣称 IO 降幅。
- UI：既有 1 秒心跳增量 DOM 路径保持；没有虚构完整刷新下降。
- 错误：稳定 code、retryable、位置、建议；Header/JWT/Bearer/query/嵌套字段脱敏。
- 知识：每卡 ValidationReport；已有结构切片、精确去重和 typed relations 保持。

## 兼容性与迁移

无需用户操作。旧 settings、任务数组和 raw artifact 均继续读取；新 artifact 在首次重跑阶段自然写成 v2。旧卡无需迁移或重新处理。若回退旧版本，新 v2 artifact 不会被旧代码识别为原 payload，建议回退前只删除 `_slicer_artifacts` 中目标 run 的中间产物，绝不删除知识卡或源文件。

## 已知限制与未实施

- MinerU/PaddleOCR 的 AbortSignal 尚未完整贯穿上传、sleep、轮询和下载。
- 成功 map chunk 尚未独立缓存；reduce 失败可能重复成功 map。
- 契约/tag/folder-map 尚未按 mtime 缓存。
- 完整任务筛选、分页、阶段时间线、独立错误中心需 Obsidian 宿主测试后渐进交付。
- 正式 TypeScript/typecheck 与 source split 未建立；本轮避免高风险 bundle 重写。

## 手动验证与回滚

在测试 vault 中：启用插件；扫描短文档；观察阶段进度；中断后继续并确认 artifact cache hit；修改 pipeline/prompt/schema version 后确认 cache miss；制造 429/401 mock 检查错误建议；审核 ValidationReport；用浅/深主题及键盘检查主要操作。回滚代码使用本提交的父提交；用户数据无需迁移。若只回滚缓存格式，删除目标 run artifact 后重试即可。
