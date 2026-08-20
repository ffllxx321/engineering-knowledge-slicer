# Phase 4 OCR 与复杂表格预生成恢复

Phase 4 在格式无关语义规划前增加一个仓库自有、确定性的结构恢复层。它不调用 provider，也不修写原文。

## 基线（HEAD `7cf1503`）

在隔离 detached worktree 中，以 `phase4-pre-generation-v1.json` 运行 production pipeline 探针，观察到：编号结构推断边为 0；同一条换行要求生成 2 张卡；重复页边栏生成 2 张卡；复杂表格仅生成 1 张不完整行卡。该基线命令只读取基线提交并在 `/tmp` 创建后删除 worktree。

## 设计边界

- OCR 只接受显式编号、解析器样式/几何、同页同容器缩进和明确续行标志。每条推断边携带 `origin`、`confidence` 与 `reason`；页、附件、消息、工作表或幻灯片边界会清空隐式层级。
- 冲突编号保持扁平并记录 `ambiguous_or_conflicting_numbering`。重复页眉、页脚和页码在规划前标为噪声。
- `raw_verbatim` 保存适配器原始文本；规范化文本仅用于匹配和规划。结构化 writer 的引用证据读取 `raw_verbatim`。
- 表格只在坐标、显式表头行和 span 图完整时重建。表头路径按占用坐标传播 group、leaf、unit 与 rowspan row label；事实保留所有源 cell ID、locator 和 provenance。
- 缺坐标、span 重叠、缺结构标签或单位冲突整表 fail closed，并产生 `review_required` diagnostic；不会创建“第 N 列”等猜测表头。

## 维护命令

```bash
npm run test:phase4-structure
npm run lint
npm run typecheck
npm run build
npm test
npm run gate:v3-obsidian
```

夹具与机器可读指标契约位于 `scripts/fixtures/phase4-pre-generation-v1.json` 和 `scripts/fixtures/phase4-expected-metrics-v1.json`。
