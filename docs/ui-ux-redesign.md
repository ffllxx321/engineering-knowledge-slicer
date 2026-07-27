# UI/UX 渐进重构规范

现状是原生 Obsidian DOM，已具备总览、实时进度、队列动作、异常优先审核和设置面板。本轮不引入 React/Tailwind，避免 bundle、主题和生命周期成本。

## 信息架构

当前已在同一原生 `ItemView` 内交付总览、任务、审核、错误、设置分区；任务区支持状态筛选、文件搜索和最多 100 项增量范围，避免无界 DOM。没有引入框架或改变命令/route。

- 总览：可点击状态数字、最近运行、吞吐、主要阻塞阶段。
- 任务：已实现状态筛选、文件名搜索、单项重试/取消/打开源文件；行显示文件、阶段、状态、已用时、重试、结果和最后错误。多选批量操作仍由既有审核分组承担，任务多选尚未交付。
- 详情：八阶段时间线；显示 cache hit、provider、request id、artifact 和稳定错误码。
- 审核：按原因/文件/置信度分组，默认只呈现异常；复用 ValidationReport。
- 错误：三层信息“发生什么/在哪里/下一步”，技术详情折叠。
- 设置：基础、服务、高级渐进披露；密钥只显示配置状态，连接测试不自动重复。

## 进度与性能

心跳只调用 `refreshProgress` 修改 `<progress>`、消息和时间；阶段切换才允许全视图刷新。没有历史样本时不显示 ETA。轮询文案使用上传、等待、处理中、下载、质量检查等离散状态，不伪造百分比。

## 设计 Token 与可访问性

只使用 Obsidian `--background-*`、`--text-*`、`--interactive-accent` 等变量；浅/深色共享语义 token。不仅靠颜色表达状态；按钮有文本；焦点使用 `:focus-visible`；动态区域应加 `aria-live="polite"`；对话框打开后聚焦标题/首操作并恢复原焦点；长路径 `overflow-wrap:anywhere`；字体用 `em/rem` 跟随缩放。

## 验证边界

CSS 使用 Obsidian 主题变量并补齐 `:focus-visible`、文本状态、`aria-label`、`aria-live` 与长文本换行。Node CI 只能验证 bundle/CSS/逻辑，不能伪造 Obsidian 宿主中的屏幕阅读器、浅深主题和焦点恢复结果；这些列入手工验证。
