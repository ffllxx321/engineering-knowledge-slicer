# Artifact v2 迁移说明

迁移是惰性、幂等且无需用户操作的：

- 历史 raw JSON artifact 继续直接读取。
- 新写入 artifact 使用 `{ artifactVersion, stage, inputFingerprint, completedAt, validationState, payload }`。
- source hash 或 pipeline/prompt/schema 版本变化时，新代码忽略不匹配的 v2 artifact 并重跑对应阶段，不覆盖源文件或历史卡片。
- JSON 缺失/损坏只视为 cache miss；原文件不会被迁移器就地覆盖。

回退旧插件前，如旧版本无法理解 v2 envelope，只删除目标 run 的 `_slicer_artifacts/<run_id>/` 中间产物并重新处理。不要删除来源文件、已入库卡片、任务备份或整个知识库。
