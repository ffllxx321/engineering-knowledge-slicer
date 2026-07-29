# Artifact v2 迁移说明

迁移是惰性、幂等且无需用户操作的：

- 历史 raw JSON artifact 仅在通过对应阶段的结构白名单时读取；无法验证的裸 payload 会安全失效。
- 新写入 artifact 使用 `{ artifactVersion, stage, inputFingerprint, completedAt, validationState, payload }`。
- source hash 或 pipeline/prompt/schema 版本变化时，新代码忽略不匹配的 v2 artifact 并重跑对应阶段，不覆盖源文件或历史卡片。
- JSON 缺失/损坏只视为 cache miss；原文件不会被迁移器就地覆盖。

## v2.15 路径、路由与回滚迁移

- 合法 vault 相对自定义路径原样保留，仅把 `\` 归一化为 `/`。缺失、空、根目录、Windows 盘符绝对路径和穿越路径补对应默认值；插件不搬移已有数据。
- 危险受管目录重叠不会被静默改址。处理会以 `SETTINGS_PATH_INVALID` 停止，用户在设置页修正后恢复。
- 内置 `06-知识库/wiki/招投标|业务库/...` folder-map 路由按相应配置输出根解释；新的相对路由使用相同契约。
- 回滚按 journal 的 `previous_content` 恢复覆盖文件，只有 null 才代表新文件可删除。旧 `writtenFiles` 仅在当前配置输出根内兼容。
- parsed 指纹不包含 Prompt、Schema、folder-map 或输出根；下游修复不会重新上传或解析。组件内容变化从 classification 起失效，输出根变化只改变写入位置。

回退旧插件前，如旧版本无法理解 v2 envelope，只删除目标 run 的 `_slicer_artifacts/<run_id>/` 中间产物并重新处理。不要删除来源文件、已入库卡片、任务备份或整个知识库。
