# 真实端到端验收

`npm run acceptance:real` 启动官方 Obsidian AppImage，在系统临时目录创建干净 Vault，安装仓库根目录的 `main.js`、`manifest.json`、`styles.css`，再调用插件的生产扫描和自动处理命令。默认语料在运行时生成，覆盖 MD、EML、DOCX、XLSX、PPTX、PDF；它们通过生产适配器，不会作为源文档提交。

可用 `npm run acceptance:real -- --corpus /absolute/a.pdf:/absolute/b.docx` 或 `EKS_ACCEPTANCE_CORPUS` 加入本机语料。文件只复制到临时 Vault。只要明确提供了外部语料，顶层 `passed` 就要求每个外部来源都进入 `stored` / `completed_with_output`，产生至少一张可打开的非空卡片，持久化验证计数大于零且没有错误码；`unsupported`、`needs_review`、`failed`、缺失任务或零卡片都会令命令失败。报告会先写入，再以非零状态退出。

Fixture harness health 与 external-corpus acceptance 分开报告。未提供外部文件的默认 CI 只用内置 fixture 验证真实宿主、生产链、恢复与质量 oracle；这不会被表述成外部语料通过。`metrics.external_corpus` 明确记录 supplied、observed、successful、unsuccessful 和匿名状态计数。

报告 `test-artifacts/acceptance-real.{json,md}` 只记录来源类别（fixture/external）、类型、大小桶、SHA-256、状态、计数、卡片哈希/字节数、质量指标和错误码，不记录路径、文件名、原文、prompt、Provider 原始响应或密钥。不适合自动处理的格式会以真实终态报告，绝不改走 writer。

默认阶段是“宿主真实 / 语料真实 / Provider 模拟”：宿主、Vault API、生产 bundle、扫描、账本、适配器、生产 `requestMiniMax` 和写入链均真实；只有网络对端是本机 HTTP MiniMax Anthropic 合同模拟器，它会注入 429、503 和首次非中文响应，并验证重试与修复。设置 `EKS_ACCEPTANCE_MINIMAX_API_KEY` 时应由独立 CI job 运行 provider-real 阶段；没有 secret 时必须标记 `not_run`，不是通过。

自动 oracle 验证终态、false success、非空中文卡片、乱码、稳定 ID、Vault API 重开、二次启动幂等和翻译检查点复用。Fixture gold gate 的校准基线是生产质量门实际接受的 MD、EML、DOCX：要求三个来源均有命中，并保留其中全部 5 个唯一受保护事实；刻意极小、被质量门拒绝的 XLSX、PPTX、PDF 仍必须给出真实终态和错误码，不能伪装成成功。Provider-real 的单个 EML fixture 必须保留其 2 个事实。报告用稳定的 Git tree SHA 标识被测源码，避免 amend 后留下 pre-commit SHA。它无法可靠自动判断行业结论是否完整、上下文取舍是否最佳、关系是否符合专家隐含知识，这些仍需领域评审。
