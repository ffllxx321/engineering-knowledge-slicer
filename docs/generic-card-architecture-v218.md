# v2.18 通用卡片架构与根因追踪

## 卡片质量合同

每张卡只能表达一个可独立复用的 claim、procedure、requirement、event 或 record。卡片必须带足以脱离原文理解的主体、动作/事实、适用条件与例外；所有数字、单位、日期、模态（必须/可以/禁止）不得丢失或改变。`source.evidence_quote` 必须是解析来源中的逐字连续 span，并带稳定 locator；表格还保留 sheet/range/row/column/header，邮件还保留 thread/message/from/date/subject。语义重复不得形成两张卡。总结点只是覆盖来源，不是卡片边界：point 与 card 是多对多关系。

## v2.17.2 根因链

1. parsing 保留了 block 与 eligible 状态，但旧门禁曾把任一不可制卡块扩散为全局噪声；这解释了无关 footer 影响正常卡片。
2. summary map/reduce 将同一知识单元拆成多个 key point，随后 atom batch 直接按 point ID 切批。
3. atom prompt 明示“一个原子只归属一个知识点”，normalize 又用 `Map<pointId, atom>` 丢弃同 point 的后续原子，并按 point 顺序输出。因此系统同时不能 many-to-one，也不能安全 one-to-many。
4. evidence 默认从第一个 summary evidence 回填，模型改写后的 quote 不能逐字定位，于是大量本来有来源的卡片进入 evidence hard gate。v2.17.2 的本地 repair 改善了症状，但候选仍以整块/行比较，结构上下文不足。
5. consolidation 以厨房、卫生间、卧室、扶手等房间/构件词表判断 subject，并假定相邻/同证据才可合并；这是 fixture/domain-shaped 行为，无法泛化到邮件、财务、HR、日文或非工程资料。
6. confidence 之后又以“短文档超过固定卡数”逐卡阻断，形成数量异常 → 整文档 review explosion。审核 UI 于是承担了补偿切片质量的工作，而不是异常队列。

## 新流水线

`block/section structure → summary propositions → many-to-many atom candidates → deterministic verbatim grounding → semantic-compatible consolidation → quality validation → accept/review/reject`

- 结构：沿用 parsed block、section、table、message metadata 和稳定 evidence index。
- 候选：provider 请求数与现有 batch 保持不变；输出允许多 point 一 card、单 point 多 card。
- grounding：先 exact span，再以多语言词元、字符、数字/单位、结构提示做保守唯一匹配；胜出分数、margin 或事实覆盖不足即失败关闭，绝不借用不可制卡或无关块。
- consolidation：仅合并 proposition type、modality、numeric/temporal facts、conditions/exceptions、source neighborhood 与内容相似度均兼容的候选。主题词从内容自身提取，无业务词表、标题、quota 或预期卡数。
- validation/routing：全部 hard gate 与既有 0.90 阈值通过才自动入库；grounding、schema/route、slicing 和 duplicate/conflict 使用独立原因码。噪声/重复/unsafe 直接拒绝；软可信度进入可批量审核，硬门禁不可覆写。
- quantity：只产生 `DOCUMENT_QUANTITY_ANOMALY` 文档警告和最多三个样本，不改变每张卡的决策。

## 迁移与成本

命令“本地重新归并、校验并路由最近任务（零模型调用）”直接读取旧 envelope 或 legacy payload 的 parsed/classification/summary/atoms，运行本地 grounding、consolidation、validation、routing，写 review v2.0 审计。provider 函数在该路径被替换为 fail-fast guard，请求计数前后必须相等。写卡以已有 `card_id` 去重，避免静默重复；昂贵解析/OCR/总结/原子产物只有各自输入合同指纹变化时才在正常重跑中失效。

默认 provider 请求数和成本增量为 0；没有新增付费调用。`MiniMax-M3`、自动批准阈值 0.90、语义嵌入 `qwen3.7-text-embedding` 的端点、模型和启用策略均保持不变。

诊断只记录阶段数量、原因直方图、请求/成本计数和匿名结构字段；禁止源文本、evidence quote、prompt、密钥和 provider 原始响应。
# v2.19 一致性边界补充

- Task ledger 的当前 schema 是可扩展持久化合同：已知字段在加载时规范化，未知 JSON 字段原样保留；旧别名记录才转换为规范形状。
- 卡片事实的信任边界是已对齐的 `evidence_quote`，或经 block locator 明确绑定的同块 span。整篇文档、相邻表格行和同邮件线程的其他消息都不是隐式证据。
- Artifact envelope v2/v3 使用同一识别 guard。生产恢复只复用匹配当前输入指纹的 envelope；legacy parsed 经验证可升级 envelope，legacy AI 下游必须重建。
- Cardinality 使用 `candidateCards / autoApproved / reviewPending / hardRejected / alreadyPersisted / merged`；`cardsGenerated / cardsRejected` 仅为旧消费者兼容别名。
