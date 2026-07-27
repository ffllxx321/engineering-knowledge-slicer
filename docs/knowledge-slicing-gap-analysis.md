# 知识切片能力差距

## 仓库已证实具备

- 标题/段落/受保护表格、代码和公式边界切片，面包屑与 overlap。
- chunk_id、来源 hash、结构化 map/reduce、覆盖校验和失败显式处理。
- 稳定 source identity、run identity、card_id、atom fingerprint；批内和历史精确去重。
- 来源链接、证据、父总结、五维置信度与硬门槛。
- 可选 typed relations：`supports/contradicts/supersedes/depends_on/implements/related`。
- 固定 folder routing、Type Mapping 和 Tag Library 白名单。

README 对 WeKnora 的描述来自仓库已有记录；本次未联网重新验证其当前内部实现，因此下列内容均是行业通用的参考方向，不声称是 WeKnora 的具体实现。

## 差距与影响

| 不足 | 证据 | 检索/复用影响 | 最小改进 | 中期方向 |
|---|---|---|---|---|
| chunk 页码范围不总是完整 | splitter 以 Markdown offset/heading 为主 | PDF 定位不够精确 | parse package 有页信息时透传 pageStart/pageEnd | 页级局部 OCR 与定位 |
| chunk fingerprint 未持久化为独立索引 | 阶段 artifact 为整体 | reduce 失败可能重跑成功 map | content fingerprint + chunk sidecar | chunk 级 cache/失败重试 |
| 近重复仅精确 fingerprint | `Set(atom_fingerprint)` | 改写后的同义卡可能重复 | 轻量 SimHash/MinHash sidecar | 可选 embedding 混合检索 |
| 实体缺少统一别名表 | summary 有 entities，未形成 registry | 客户/供应商别名聚合弱 | 可选 entity sidecar | 人工反馈驱动规范化 |
| 关系未形成反向索引 | 卡片可带 typed relation | 图遍历和影响分析成本高 | Markdown 兼容 JSON sidecar | 图谱导出接口，非图数据库 |
| 演化字段使用不足 | relation 支持 supersedes/contradicts | 新旧知识冲突难发现 | 新卡可选 `supersedes`/`contradicts` | 来源更新影响追踪 |
| 聚合页以目录 MOC 为主 | `moc.js` | 项目/客户维度不足 | 增量项目聚合页 | 主题 Wiki 模板 |
| 人工修正未形成反馈记录 | review 修改仅落当前项 | Prompt/规则无法学习 | 记录脱敏 correction reason | 离线质量评估集 |

## 不建议当前实施

不引入图数据库、在线向量数据库、大型 UI 框架或强制迁移全部旧卡。这些方案会扩大运维、隐私与回滚面，当前 Markdown + 可选 sidecar + 增量索引足以演进。旧卡不需要补字段或重处理。
