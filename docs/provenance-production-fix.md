# 生产 provenance 与零产出语义修复

## 根因

远端解析器可以只返回 Markdown。旧适配器只从 extractor 已有 blocks 构造 `evidence_index`，因此正文
有效但 blocks 为空时，下游把整份文档视为没有合格来源块。summary reduce 和 atom batch 还允许用
标题、摘要文本或输出顺序补证据/归因，导致逐字证据在重试、缓存和批次重排后丢失。结构化适配器同时
会把未知旧目录默认映射到项目总览或术语通用知识。最终任务只表达“处理结束”，没有表达“写入为零”。

## 新契约

- 每个解析器在 AI 前经过同一 block-v0 边界。Markdown-only 生成稳定 parsed-text-span block；只有解析器
  明确提供 page/sheet/row/message/attachment 信息时才保留对应 locator。
- 卡片合格块保留稳定 `block_id`、locator、原始逐字文本和 provenance；噪声块继续排除。
- summary map/reduce 的 evidence 必须是同一合格 block 的连续原文子串，并携带 block_id/locator。
  atom 只能引用 summary 已验证 evidence；一对多和多对一通过 point/evidence ID 明示。
- 本地修复只做 NFKC 全半角、空白和 OCR 布局换行规范化，并把结果替换成实际连续原文。跨 block、
  row、message、attachment 的拼接禁止；多处命中为 ambiguous。
- 正常逐字证据不增加模型调用。契约无效时沿用既有 checkpoint/retry，至多一次格式修复；成功批次不重跑。

## 终态与路由

写入数、legacy 写入与 structured commit 均为零时使用 `completed_no_output`，显示“生成 N、写入 0、
硬拒绝 N”和根因分组，不显示入库成功，也不强迫逐条审核。合法零知识文档同样是处理成功但零产出，
不是 provider 失败。

结构化 writer 默认关闭不变。开启后只有 Phase2 精确 metadata/route 或类型兼容的显式 legacy map
才能确定两库分类；否则阻止写入并形成 grouped routing review。

## 组件兼容

内置 block-v0 与 parse-package fallback 只补足旧组件包缺失的契约，不覆盖磁盘上的自定义文件。
诊断事件记录 effective built-in version、内容哈希、relative path 和 missing/invalid/difference 原因，
便于判断安装包漂移；无自动替换或破坏性升级。
