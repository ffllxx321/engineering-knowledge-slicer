# 两库受控写入与 Obsidian 关系审计

审计基线：`f429216` 及其后的本次设置页改动。结论以生产入口
`main.js`、并行模块 `src/phase1-foundation.js`、`src/phase2-candidate-pipeline.js`
和 `src/phase3-review-gate.js` 为准。

## A. 今天实际具备什么

当前生产流程会解析来源、生成旧版知识卡片，并由 `writeAcceptedCard()` 按现有
`folder-map.json` 的 `route.output_folder` 写入 `bidOutputPath` 或
`businessOutputPath`。这是既有卡片流程，不等于 Phase 1/2/3 的四类记录和新两库目录方案。

Phase 1 只定义 `Project`、`SourceDocument`、`BusinessItem`、`CompanyKnowledge`
的 schema、目录分类和迁移试算；`DIRECTORY_PLAN.mode` 是 `definitions_only`，
`auto_create_or_move` 是 `false`。Phase 2 是独立候选管线，只返回路由建议和
`BusinessItem` 候选。Phase 3 是纯计算影子审核，结果明确报告零写入、零删除和零状态迁移。
生产 `main.js` 没有导入或调用这三个模块。因此，通用 Phase 1/2/3 工作流今天**不会**
把文档分解后的四类记录写进新“在办投标库/长期业务库”目录；它只有候选、校验、审核和
撤回计划能力，尚未完成生产接线。现有生产卡片落盘能力不能被表述为新两库记录写入能力。

## B. 安全自动写目录前还缺什么

1. 在生产解析产物与 Phase 2 输入之间建立版本化适配器，并以真实文档影子运行验证覆盖率。
2. 把 Phase 3 决策账本接入真实审核界面；项目歧义、关键事实冲突、缺证、模型补写和
   `CompanyKnowledge` 提升必须阻断自动写入。
3. 定义稳定 ID、ID 到规范路径的索引、四类 Markdown 序列化格式和两库根目录配置；
   `people`/`organization` 目前不是 Phase 1 一等记录类型，不能先生成虚构目标。
4. 实现“预检计划 → 临时写入/校验 → 原子提交”的受控 writer：路径白名单、冲突检测、
   写入清单、旧内容快照、失败恢复、并发锁和逐批上限都必须落地。
5. 用真实但脱敏的代表队列完成只读影子、人工批准 pilot、有限自动写入三阶段验收；
   `phase3_write_enabled` 不能仅靠开关直接绕过前述门禁。
6. 明确迁移和归档策略，验证旧卡片继续可读、来源文件永不被删除、暂停项目不会被自动归档，
   再考虑默认开启任何目录创建或移动。

## C. Wikilink/backlink 的结构化用法

每条记录使用不可变 `record_id`，规范文件名建议为
`<record_kind>--<record_id>.md`，标题放在 frontmatter 的 `title`/`aliases`，避免改名造成
身份漂移。关系同时保存类型化 ID 字段和可点击 wikilink，例如：

```yaml
record_kind: business_item
record_id: bi-…
project_ids: [prj-…]
source_document_ids: [src-…]
relations:
  - type: derived_from
    target_id: src-…
    target: "[[source_document--src-…|招标文件]]"
```

`Project` 汇总其 `SourceDocument`、`BusinessItem` 和经批准的
`CompanyKnowledge`；`SourceDocument` 是出处枢纽，保留 `source_path`、`source_hash`
和证据定位；`BusinessItem` 用 `derived_from`/`related`/`supersedes` 等显式关系；
`CompanyKnowledge` 只有人工批准提升后才能被项目引用。Obsidian backlinks 提供反向导航，
但规范事实仍是稳定 ID 和类型化关系，不能依赖标题文本推断。

人员和组织当前只在既有卡片的 `entities` 等弱结构字段中可能出现，Phase 1 没有相应 schema。
在新增并验证 `Person`/`Organization` 记录类型及实体消歧前，只保存来源原文中的名称和定位，
不创建 wikilink；同名、别名或模型猜测一律进入未解析关系审核。

## D. 幂等、回滚、未解析关系与归档

- 幂等键使用 `record_kind + record_id`；内容摘要排除显示顺序等非语义差异。同键同摘要为
  no-op，同键不同摘要必须走带版本/来源检查的更新，禁止另建重名记录。
- 关系键使用 `source_id + relation_type + target_id`，排序去重；只允许链接到索引中类型兼容、
  唯一存在的目标。写双向关系时作为同一事务提交；backlink 是结果，不替代反向字段校验。
- 每批先生成确定性写入清单，记录创建、修改、旧摘要、旧内容和生成器版本。任一步失败就按清单
  逆序恢复：新文件移入可恢复的隔离区，修改文件恢复精确旧内容；不得删除来源文件或改变项目状态。
- 目标不存在、同名多 ID、同 ID 多路径、类型不兼容、证据不足或关系仅由模型推断时，不写
  wikilink；保存 `unresolved_relations`（原始名称、来源文档/块/定位、候选 ID、原因），集中人工
  选择、创建或拒绝。审核决定追加到账本，重跑按决定幂等复用。
- 归档是状态迁移，不是改 ID。允许的明确结果沿用 Phase 1 转移规则；暂停项目需人工决定。
  归档移动若以后启用，先更新 ID→路径索引，再用 Obsidian 可解析的稳定 ID 链接重写受影响链接，
  并纳入同一回滚清单。业务库知识保持原位，在办库只保存引用；来源和 provenance 永久保留。
