# 错误代码参考

错误代码稳定，UI 显示用户消息、任务/文件/阶段位置与建议操作；技术信息默认折叠，堆栈只在诊断模式保存且先脱敏。

| Code | Category | 可重试 | 建议 |
|---|---|---:|---|
| `CONFIG_*` | config | 否 | 修正设置 |
| `SECRET_*` | secret | 否 | 配置密钥，禁止写日志 |
| `FILE_NOT_FOUND` / `FILE_*` | file | 否 | 检查文件与路径 |
| `COMPONENT_PATH_INVALID` | component_config | 否 | 相对路径必须指向组件包内 `.md`/`.json` 文件，不能为空、目录、根路径或穿越路径 |
| `COMPONENT_NOT_FOUND` | component_config | 否 | 恢复或修正缺失组件文件；重试复用 parsed artifact |
| `COMPONENT_CONFIG_INVALID` | component_config | 否 | 修正 folder-map、Schema 或 Prompt 配置 |
| `UNSUPPORTED_*` | unsupported | 否 | 转为支持格式 |
| `SIZE_LIMIT_*` | size_limit | 否 | 拆分文件或调整明确上限 |
| `PARSER_*` / `OCR_*` | parser/ocr | 视状态 | 检查服务与解析质量 |
| `OCR_UNAVAILABLE` | local_ocr | 是 | 启用并检测本地 OCR，或配置有效的绝对可执行文件 |
| `OCR_RENDER_FAILURE` | local_ocr | 是 | 检查 `pdftoppm` 与 PDF 完整性 |
| `OCR_TIMEOUT` | local_ocr | 是 | 提高单页超时或降低并发 |
| `OCR_MALFORMED_OUTPUT` | local_ocr | 否 | 修复自定义 provider 的 `local_ocr_v1` JSON 输出 |
| `OCR_CANCELLED` | cancelled | 否 | 用户取消；重试会复用有效页级 checkpoint |
| `OCR_LIMITS_EXCEEDED` | local_ocr | 否 | 拆分 PDF 或降低渲染分辨率 |
| `NETWORK_TRANSIENT_FAILURE` | network | 是 | 退避后重试 |
| `AUTH_PROVIDER_REJECTED` | auth | 否 | 检查密钥/权限 |
| `RATE_LIMIT_PROVIDER_BUSY` | rate_limit | 是 | 遵循 Retry-After |
| `TIMEOUT_STAGE_EXCEEDED` | timeout | 是 | 重试阶段/检查超时 |
| `PROVIDER_*` / `POLLING_*` | provider/polling | 视状态 | 查看 request id |
| `JSON_PARSE_INVALID_RESPONSE` | json_parse | 否 | 重做阶段并检查 Prompt |
| `SCHEMA_OUTPUT_INVALID` | schema | 否 | 检查 Schema/Prompt 版本 |
| `ROUTING_*` / `TAG_*` | routing/tag | 否 | 保持白名单，进入审核 |
| `EVIDENCE_*` | evidence | 否 | 补足来源证据 |
| `DUPLICATE_*` | duplicate | 否 | 合并或跳过 |
| `WRITE_*` | write | 视错误 | 检查 vault 路径/权限 |
| `MIGRATION_*` | migration | 否 | 保留原文件并从备份恢复 |
| `CANCELLED_BY_USER` | cancelled | 否 | 需要时重新入队 |
| `INTERNAL_UNEXPECTED` | internal | 否 | 导出脱敏诊断信息 |

`AppError` 字段包含 code/category/severity/retryable/stage/taskId/runId/sourcePath/artifactPath/provider/requestId/message/technicalMessage/suggestedAction/details/timestamp/version。不得包含全文、完整 prompt、Authorization、cookie、JWT 或 API key。

`AI_SCHEMA_OUTPUT_INVALID` 是 AI 契约层抛出的内部稳定标记，进入任务账本前会映射为
`SCHEMA_OUTPUT_INVALID`。字段缺失/额外字段、精确 coverage 失败和最终契约校验失败均走该分类，
不会再落入 `INTERNAL_UNEXPECTED`。性能 counters 中的 `summaryReduceRequests` 统计首次 reduce、
JSON repair retry，以及 SSE 失败后的非流式降级调用。

组件错误在 JSON/schema 关键词分类之前处理，因此组件配置中的 JSON 或 validation 文本不会
污染模型输出错误统计。组件诊断阶段固定为 `component-contracts`，技术详情只包含相对路径、
失败原因、扩展名和路由序号等安全元数据，不包含源文档内容。
