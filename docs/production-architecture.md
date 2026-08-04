# 生产架构

## 唯一流程

生产处理只有一条路径：`AutoDocumentParser` 自动识别文档，形成通用知识单元；本地质量检查把少量不确定内容送到确认；确认后的内容生成两库写入计划；`ProductionCommitService` 通过 `KnowledgeWritePort` 原子提交；最后从持久化账本重新加载当前运行 manifest，并逐一从 Obsidian Vault 公共 API 打开 Markdown，核对记录身份、来源、内容哈希和目标库根目录。只有计划、提交、最终可见三个路径集合完全相同，任务才是“已入库”。

自动解析没有用户可编排的引擎顺序。DOCX、XLSX、PPTX、MSG、EML、TXT、MD 在本地确定性解析。PDF 先检查文本层和版式质量；可靠文本 PDF 在本地解析，扫描件、文本不足或复杂版式才在隐私许可下使用 MinerU；MinerU 不可用或失败后自动尝试本地 OCR，仍未达到质量门则失败。PaddleOCR API 只保留旧配置导入兼容，生产调用会得到 `LEGACY_PADDLEOCR_REMOVED`。影子评估只可通过 `EKS_ENABLE_DEVELOPMENT_SHADOW=1` 在开发环境运行，不能影响任务、写入、审核或成功。

机器可检查的约束位于 `src/production-flow-contract.js`。生产入口是 `EngineeringKnowledgeSlicerPlugin.processTask`，生产知识写入入口是 `ProductionCommitService.commit`。

## 五个状态

- 等待：尚未开始，或者旧结果、重启后的完成结果需要在新运行中重新验证。
- 处理中：包括解析完成、模型完成、知识单元生成、质量检查和写入计划完成；这些阶段都不是成功。
- 待确认：只用于内容、归属或路由确实不确定的少量事项。
- 已入库：当前 `run_id` 的清单中 `planned = committed = visible_verified`，每个最终文件均为两库根目录内可打开且哈希一致的 Markdown。
- 失败：提交、验证或回滚不完整。零最终文件也属于失败，不能显示成功。

所有生产状态变更通过 `transitionProductionState`。内部阶段只用于进度和诊断，不再形成第二套终态。

## 缓存与恢复

解析、OCR、翻译和模型规范化等昂贵中间结果可以复用。每次处理或重试都会生成新的 `run_id`，并清空旧运行的最终写入证据。写入计划、旧事务、旧 `writtenFiles`、数组长度和源文件哈希都不能证明当前运行成功。

启动时，带当前权威 manifest 的已入库记录会再次逐文件验证并保持可见；任何旧式、缺失或不可验证的成功记录都会回到等待重新验证。源文件目录、中间产物、任务账本、诊断和缓存从不计入知识文件数量。

## 设置迁移

生产只读取 `knowledgeTenderRoot` 和 `knowledgeBusinessRoot`，默认且权威值分别是 `06-知识库/招投标库` 和 `06-知识库/业务库`。旧顶层默认值与旧 wiki 默认值在加载时迁移；旧自定义根不会被移动或删除，并要求用户确认。旧的 `structuredActiveRoot`、`structuredBusinessRoot`、`bidOutputPath` 和 `businessOutputPath` 之后仅是兼容数据，不参与生产路由。

## 旧入口

传统卡片 writer、旧审核直接写卡、旧重新生成写卡和旧事务成功恢复已从生产调用链断开。调用旧写入会得到 `LEGACY_KNOWLEDGE_WRITE_REMOVED`；调用旧事务恢复会得到 `LEGACY_RECOVERY_REMOVED`。任务账本、诊断、缓存、事务记录和索引属于辅助状态写入，不计作知识文件。

## 故障排查

诊断分别列出 generated、planned、committed 和 visible_verified。先比较集合差异，再检查最终路径是否位于两库根、扩展名是否为 `.md`、文件是否可打开、`record_id`/`record_kind`/来源是否匹配以及内容哈希是否变化。路径在诊断中使用脱敏标识；需要定位时从任务详情点击当前运行清单中的最终 Markdown。
