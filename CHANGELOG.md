# 工程知识切片 变更记录

## v2.14.1 — 2026-07-29 组件路径与解析续传生产修复

- 修复旧版/缺字段 `folder-map.json` 在加载类型 Prompt 时把空相对路径归一化为组件根目录（如 `06-知识库`）并反复按文件读取的问题。组件加载现在先拒绝空值、根目录、尾随斜杠、绝对路径、穿越段和非 `.md`/`.json` 扩展名，Windows 分隔符与合法自定义组件根保持兼容。
- 仅对内置 28 条固定路由或无歧义旧字段确定性补齐 Prompt；未知路由缺 Prompt、冲突字段和无效 JSON 均 fail closed，不依据文档内容发明路由。
- 新增 `COMPONENT_PATH_INVALID`、`COMPONENT_NOT_FOUND`、`COMPONENT_CONFIG_INVALID`，统一归为 `component_config`，不再被 JSON/validation 关键词误报为模型 `SCHEMA_OUTPUT_INVALID`。诊断只记录相对组件路径、原因和扩展名。
- 解析完成后显式进入 `component-contracts` 阶段，组件失败不再沿用 `mineru-api-download`。任务级请求计数以本次运行基线为准，显式零值不会被全局时间线的旧请求覆盖。
- pipeline 指纹升级到 1.2.1：重试保留 `parsed` artifact，仅使 classification 及其下游按需失效；不会再次上传、下载或调用 PDF parser。新增生产序列、Windows/空值/根路径、错误分类、零调用续传、自定义根和计数回归。
- 诊断报告升级为 `eks-diagnostic-report/1.1`；三文件发布合同、上传授权门、正常请求量、影子只读行为和用户数据保持不变。

## v2.14.0 — 2026-07-29 本地文本/邮件 block_v0 归一化

- 基于 v2.13 影子评估审计保持质量阈值与 prompt 调优 gated：现有本地真实样本不是足够、可归因的独立 cohort，不据此制造提升结论。
- MD/TXT 默认按标题、段落、列表、表格、代码块输出稳定行 locator 的 `block_v0`；EML 同时输出正文、主题、信封字段与不可制卡附件 inventory，附件二进制保存、自动入队与双向链接语义不变。
- 所有本地常见格式统一进入 `block_packs`、`evidence_index` 与结构优先分类抽样；normal 模式 provider 请求不增加，shadow 仍只读，外传授权门不变。
- 新增 settingsVersion 25 兼容迁移与设置开关；关闭后回退既有文本/EML parser。解析输入指纹包含新开关，旧缓存安全失效，不迁移旧卡。
- 新增确定性跨路径、行定位、packing/evidence、附件隔离、tracking 排除、无 provider、回退与迁移回归；无新增运行时依赖，三文件发布合同不变。

## v2.13.0 — 2026-07-29 生产影子评估与证据调优基线

- 新增默认关闭、插件内、本地优先的影子评估：复用正常解析、分类、总结、原子化、验证逻辑和已有检查点，但不调用写卡、MOC、索引或任务账本终态更新；影子检查点独立命名，支持取消后恢复。
- provider 请求按每次运行硬预算计数，默认 0；零预算强制关闭远程文档解析/上传，只消费本地解析与已有 AI 检查点。上传授权门不被放宽，正常模式请求数保持不变。
- 新增按类型、解析器、大小、语言的确定性分层轮询队列，以及选中任务运行入口；不依据样本文本或文件名制定规则。
- 新增 `eks-shadow-evaluation/1.0` / `eks-shadow-store/1.0`：稳定来源哈希伪名、解析/eligible/证据/覆盖/分类/卡片/审核/重复/缓存/阶段时延/provider 计数和类型化原因；禁止正文、引文、文件名、完整路径、凭证、prompt/response。
- Dashboard 与设置页支持启用、预算/队列/保留配置、聚合查看、保存版本基线和本地导出 JSON/Markdown；当前版本不提供直接提升，影子结果保持只读。
- 新增迁移、保留边界、确定性抽样、脱敏、零 provider、检查点复用、无写卡/上传/账本写入和正常模式默认关闭回归；无新增运行时依赖，三文件发布合同不变。

## v2.12.0 — 2026-07-29 block-native quality closure

- `autoApproveConfidenceThreshold` 从迁移、UI、任务处理、工作流贯穿到评分；范围统一夹紧为 0.70–1.00，默认 0.90，不再使用硬编码 0.85。
- `OOXML_NO_ELIGIBLE_CONTENT` 等 typed `review_required` 直接进入任务账本与审核台，不计作通用失败，也不调用 AI。
- parsed artifact v3 指纹覆盖适配器、OOXML 限制、OCR、block packing、parser 与 block 合同；页级 OCR checkpoint 独立保留，AI 检查点绑定解析输入。
- parse package 新增轻量 `block_id → locator → raw_text` 索引；block pack、总结证据与原子来源保持 block ID，逐字无法验证时禁止自动入库。旧 parse package/card 继续走原 provenance/markdown 兼容路径。
- 分类抽样结构优先且预算确定，不增加请求数；新增 DOCX/XLSX/PPTX/MSG/PDF-style 跨层 fixture 和门槛、迁移、证据链回归。诊断不记录正文或密钥。

## v2.11.0 — 2026-07-29 本地 PPTX 原生结构解析

- 补齐 Office Open XML 摄取矩阵：PPTX 默认本地优先，按 `presentation.xml` relationship 顺序处理幻灯片，不按文件名猜测顺序；保留标题/正文/项目符号、文本框占位符与 EMU 边界、表格单元格及合并、演讲者备注、隐藏页、转场/动画存在性、超链接、图片与图表锚点。
- 输出稳定的 slide/shape/paragraph/table/cell/note `block_v0` locator；图片与图表作为不可直接制卡的 provenance metadata，alt text 仅保留为描述，不推断图像语义。有效空演示文稿进入 `OOXML_NO_ELIGIBLE_CONTENT` 审核态。
- 复用 v2.10 安全 ZIP/XML 层与资源限制，新增缺失/越界 slide relationship、畸形包、取消、packing、locator、外传门回退的确定性回归。PPTX 本地关闭或解析失败时，仍只有既有 `pdfAllowExternalUpload` 显式授权才能走远程解析；旧 `.ppt` 保持远程路径。
- 新增默认开启的 `localPptxAdapterEnabled` 兼容迁移和设置入口；无新增运行时依赖或 AI 调用。真实样本 benchmark 继续只读本机已有 DOCX/XLSX，未发现可用 PPTX 样本时不生成或提交替代文档。发布包仍严格只有 `main.js`、`manifest.json`、`styles.css`。

## v2.10.0 — 2026-07-29 本地 DOCX / XLSX 原生解析

- 新增零运行时依赖的安全 OOXML ZIP 层：只信任中央目录并复核本地头，拒绝 traversal、重复条目、加密、多磁盘/ZIP64、未知压缩、DTD/实体，限制条目数、压缩/解压字节、压缩比、单 XML 大小、深度与文本量，并支持 `AbortSignal` 和 typed errors。
- DOCX 默认本地优先，按正文、页眉、页脚、脚注、尾注、批注的包内顺序输出 `block_v0`；保留段落/样式/outline、编号层级、表格行列与合并、超链接、引用、媒体 relationship/锚点、分节/分页线索、语言以及 raw/inferred/presence 状态。
- XLSX 默认本地优先，保留 workbook/sheet 顺序与可见性、used range、单元格坐标/类型/原值、共享/内联字符串、公式与缓存值分离、日期 serial、合并继承、隐藏行列、autofilter/table、drawing/image 锚点和安全的行身份推断；不移动列值、不虚构公式缓存。
- DOCX/XLSX 本地失败或不支持时，只有现有 `pdfAllowExternalUpload` 显式外传门允许后才进入原远程路径；空但有效的 OOXML 返回 `OOXML_NO_ELIGIBLE_CONTENT` review state。
- 新增默认开启的适配器设置迁移、最小 UI、确定性嵌入构建源、合成 golden/security/fallback/packing/locator 回归及只读真实样本 benchmark。发布仍严格只有 `main.js`、`manifest.json`、`styles.css`。

## Unreleased — 系统可靠性、检查点与可观测性优化

- 新增宽松、版本化 `block_v0` 合同与结构优先 token packing，保留稳定 locator/provenance 并暴露覆盖率和预算指标。
- `.msg` 从 unsupported 改为本地 CFB/MAPI 解析；查询 token 脱敏，tracking/marketing/unsubscribe 保留溯源但禁止生成卡片。
- PDF 增加本地 native/scanned/mixed/blank 页清单与 typed OCR gate；不改变 `pdfAllowExternalUpload`，扫描件无 OCR provider 时进入可操作审核状态。
- 新增生产安全的 `local_ocr_v1` provider：自动优先探测 Tesseract，支持无 shell 插值的自定义绝对可执行文件，页级超时/取消/资源限制/有界并发/临时目录清理，以及按来源、provider 版本和设置指纹持久化的页级 checkpoint。
- 修复三文件发布包中的本地 OCR 运行时依赖：`src/local-ocr.js` 仅作为构建源并确定性嵌入 `main.js` 内部模块；构建会拒绝相对运行时依赖，并在仅含 `main.js`、`manifest.json`、`styles.css` 的洁净目录验证插件入口可加载。
- 扫描与混合页的本地 OCR 结果确定性合并到 `block_v0`/`parsePackage`；保留旋转、bbox、图像与 quote locator、置信度和语言。低置信或未验证印章、签名、视觉审批材料禁止自动制卡，印章图像不会推断为已批准。
- 将视觉印章/签名可见性与审批结论分离，并为新适配器、限制和 packing 增加确定性合成回归。
- 新增 `eks-diagnostic-report/1.0`：失败任务最佳努力持久化、Dashboard 一键复制的结构化 Markdown + JSON 诊断报告。报告覆盖运行时/安全设置、稳定任务与来源哈希、阶段与耗时、错误分类/可重试性、最后有效检查点、summary chunk/atom batch 缺口（含 27/104 等场景）、缓存与出站重试计数、紧邻故障的压缩时间线、终态持久化/UI 转场和 artifact 校验。
- 报告深度脱敏并排除源正文、prompt、模型响应、密钥及完整路径；JSON/Markdown 分别具有 64/72 KiB 硬上限。重复 cache hit 合并为稳定 ID 范围/计数。报告生成、持久化和剪贴板失败均不影响任务状态。
- 新增确定性 `regression-diagnostic-report`，覆盖结构版本、脱敏、硬大小边界、27/104 缺批诊断、事件压缩以及源路径/API Key 不泄漏。
- 修复超长文档原子化续传：缓存读取异常不再被 `Promise.allSettled` 静默吞掉或终止单个 worker；单批供应商失败不再取消/阻塞其余批次，其他有效结果会在有界并发下继续校验并持久化，重试只请求失败或缺失批次。
- 原子化部分失败统一返回 `ATOMIZATION_BATCH_INCOMPLETE`（`atomization` 阶段、可重试），错误 artifact 包含完成数、总批数及逐失败批次稳定 ID/知识点/原因；聚合 atoms、卡片生成和写入仅在严格完整覆盖后执行。
- 有效批次缓存命中完全绕过 limiter；限流失败冷却按真实出站请求计时并自动过期，本地取消不再累计供应商失败。新增“先前请求失败 + 缓存命中交错”、缓存读取失败 worker 恢复及 104 批续传回归。
- 原子聚合 artifact 恢复时重新执行 schema、精确 coverage 与逐知识点归属校验；无效旧缓存安全降级为复用细粒度批次检查点重建，不删除或迁移用户数据。
- 移除处理中状态卡下方与权威 `处理队列 X/Y` 重复的待处理队列统计；紧凑概览同步移除冗余项，保留待审核、失败、已入库等有效计数。
- MinerU、PaddleOCR API 与本地 PaddleOCR 结构化结果保留页码、块/行标识、边界框及解析文本偏移；不再把整份 OCR 文档虚构为第 1 页。
- 新增稳定 OCR 来源定位模型与 fail-closed resolver：定位由规范化摘录哈希、确定性 occurrence、文本区间及可用的页/块/行/bbox 组成，并在总结、原子和卡片写入前回查持久化解析产物。
- 纯文本/旧版 OCR 使用“解析文本级”回退定位，不伪造页码或坐标；重复摘录必须通过分块边界或 occurrence 消歧，否则拒绝定位。
- 卡片分别渲染 `source_page`、`source_locator`、`source_provenance` 与 `locator_precision`；原生 PDF/Markdown 的既有定位逻辑保持兼容。
- 新增不含文档正文的来源诊断计数与 MinerU/Paddle/纯文本/重复摘录/规范化/跨页/旧数据/原生回归测试。
- 异常改为“发生了什么 / 影响 / 建议”的中文说明；原始原因、代码、ID、校验报告和候选卡片完整保留在可展开的“技术详情”中。
- 窄侧栏异常使用独立卡片、筛选和每页 20 项；支持全选可批准项、部分批准，以及所选项重新生成、拒绝和人工处理，硬性失败项无法批准。
- 处理区只保留一个整批总进度条。总进度按稳定文件队列和真实流水线阶段单调计算，持久化输出完成前最多显示 99%。
- “待处理”改为“待处理队列”，任务保存稳定的文件级队列序号和总数（如“处理队列 11/20”）；完成、恢复和重试不会缩小分母。
- 新增生产 UX 回归测试，覆盖中文映射、诊断保留、40 项分页边界、38 通过 + 2 失败的部分批准保护、单进度条、单调进度和稳定队列序号。
- 统一时间语义：知识卡片 frontmatter 的 `created` / `updated` 改为经配置或运行时本地时区安全换算的 `YYYY-MM-DD`；旧 ISO 值继续可读并在渲染时惰性格式化，不执行破坏性迁移。
- 新增集中式时间策略 helpers，dashboard 与服务测试使用本地化运营时间；任务恢复、产物、审核/回滚审计、缓存、性能与诊断日志继续保留精确 ISO instant。
- 新增 UTC 跨 Asia/Shanghai 日期边界、旧 ISO 兼容、业务日期、运营本地化显示和日志毫秒精度测试。
- Dashboard 改为单一状态/下一步主操作、紧凑计数与 Tasks / Review / Errors 键盘可操作 tabs；次要动作、设置和路径渐进披露。运行中状态优先于历史错误，缺失/非法时间不再显示 `undefined`。
- 原子化进度只计严格校验并已 checkpoint 的批次；首个终止失败会取消同级请求并等待全部 settle，禁止晚到成功日志和 31/31 假完成。
- 每批使用稳定知识点标识持久化，重启仅请求失败/缺失批次；聚合 atoms 产物仅在每个请求知识点都有有效归属时生成。
- 仅对缺失的空列表元数据做语义中性的确定性补齐；缺失置信度或已存在的错误类型继续触发严格 schema 与一次有界定向修复。
- 错误详情记录真实请求、重试、prompt/output 字符与估算 token 计数；新增精确生产故障、并发取消、续传与 DOM/窄栏语义回归。
- 修复大型 PDF 的 `summary-reduce` 供应商输出被 `{item: ...}` 单层包裹时触发 `$.coverage is required / $.item is not allowed / 总结分块覆盖不完整`：仅解包无歧义的单键 `item`，不放宽 schema 或 `additionalProperties`。
- reduce coverage 缺失或为所请求 map chunk 的无重复子集时，从本次已校验的 map 输入确定性重建完整 coverage；含未知 chunk 或重复 ID 时拒绝猜测，执行有界 schema-repair retry。
- 契约失败携带稳定 `AI_SCHEMA_OUTPUT_INVALID` 内部错误并归类为 `SCHEMA_OUTPUT_INVALID`，新增 `summaryReduceRequests` 计数；reduce 重试/进程恢复继续复用逐 chunk 持久化 map artifact。
- summary map chunk 独立持久化；reduce 失败重启只重试 reduce。
- 文件写入采用读回校验、adapter rename transaction、rollback 和 Vault API fallback。
- 新增 API/prompt/IO/UI counters、供应商独立 limiter、持久服务测试结果。
- 新增 prompt 公共规则组合、SimHash/稀疏语义近重复、实体别名、反向/演化索引及项目聚合页。
- 任务加入多选、批量动作和分页；新增 DOM/a11y mock、strict JSDoc typecheck 与非破坏性真实 esbuild 验证。

- 修复批内重复原子在首项进入审核时未立即占用 fingerprint、可能形成重复审核卡的问题；新增确定性工作流测试。
- 有效 classification/summary/atoms 检查点恢复经集成测试证明不会再次调用 provider。
- 任务 AbortController 贯穿 MiniMax、MinerU、PaddleOCR 的排队、请求、上传、轮询等待和下载；RateLimiter 支持排队取消与超时。
- 组件包按文件 mtime/size 缓存，切片新增向后兼容的稳定 ID、指纹、标题/页码/token/overlap 元数据。
- Dashboard 增加状态卡筛选、任务搜索/筛选/时间线、错误代码中心以及键盘焦点和 ARIA 改进。
- 修复运行时 API 密钥可能随 settings 保存进入 `data.json` 的安全风险；所有设置持久化统一过滤 secret 字段。
- 阶段 artifact 升级为 v2 envelope，以来源和 pipeline/prompt/schema 版本指纹校验复用；旧 artifact 保持可读，无需用户迁移。
- 增加稳定 `AppError`、重试分类、深层日志脱敏、阶段性能指标和可复用 `ValidationReport`。
- 增加 9 项安全/可靠性回归、lockfile、JavaScript lint 门和不调用付费 API 的 benchmark。
- 补充优化基线、调用链审计、知识切片差距、UI/UX 规范、错误码和结果/回滚文档。

### 迁移

无需手动迁移或重新处理历史资料。新 artifact 在阶段再次执行时自然写入；历史任务、卡片和配置格式保持兼容。

## v2.9.3 — 2026-07-27 可靠性修复与流水线并发优化

本版本正式收录 2026-07-24 最新测试日志之后完成的修复，不改变既有产品功能范围。

### ✅ 上传确认与 SSE 可靠性（`53afa00`）
- 上传外部解析 API 的确认弹窗通过后，立即回写本次解析配置的授权状态，修复每次启动后首个文件已确认仍被拒绝、需要确认两次的问题。
- 补齐 `requestMiniMaxStream` 的模块导出与入口导入，修复启用 SSE 时的 `ReferenceError` 以及由错误退避引发的处理卡顿。

### 🧩 原子化归属与 JSON 修复（`53afa00`、`add4fa2`）
- 在原子化提示词中明确每个原子的 `content.point_ids` 归属契约，并兼容模型把归属写在原子顶层的返回形式。
- 扩展归属字段兼容范围；仅在原子数量与剩余知识点数量严格对应时按顺序补齐缺失归属，显式错误归属仍会被拒绝。
- 兼容模型直接返回原子数组；增强外层 JSON 被截断但内部对象已闭合时的修复路径，减少有效内容被误判为非法 JSON。

### ⚡ 总结并发解耦（`add4fa2`、`114f9cb`）
- 分块总结改为有界并发并保持结果顺序，降低长文档总结耗时。
- 新增独立的「总结并发数」设置（1–3，默认 2），不再复用原子化并发；降低原子化并发以规避 429 时不会连带拖慢总结。

### 💾 重试落盘与减少任务 IO（`114f9cb`）
- 批量重试和单任务重试在队列或处理器重新读取账本前强制完成防抖写盘，避免仍读到旧的 `failed` 状态而跳过已重新入队任务。
- 任务账本备份由每次生成时间戳文件改为单一 `tasks.bak.json` 滚动备份，保留上一版恢复能力，同时减少 vault 与同步盘的目录项和写入 IO。

### 🧪 测试
- 原子化归属、JSON 截断修复、总结独立并发、重试账本可见性与滚动备份均有回归测试覆盖。

## v2.9.2 — 2026-07-24 诊断日志三处线上故障根因修复

依据用户回传的 `diag.log`（2026-07-20 / 23 / 24 三次会话）定位并修复三个独立的真实故障。均为根因修复，不做症状回避。

### 🧩 原子化「知识点归属」契约缺失（主故障，07-24 任务失败）
- **现象**：`atomization.normalize` 连续多批 `rawAtoms=3/4/3` 却 `keptAtoms=0`、`droppedNoPointAttribution` 等于 rawAtoms，任务最终误报「AI 返回内容不是有效 JSON」。
- **根因**：归一化靠每个原子的 `content.point_ids` 把原子归属到知识点，多知识点批次（默认每批 3 个）缺归属即整批丢弃；但**所有原子化提示词（基础模板 + 内联拼装）只要求批次级 `coverage.point_ids`，从不要求逐原子的 `content.point_ids`**——契约从未向 AI 声明，AI 自然不输出，于是每个原子都「无归属」被丢光。修复重试轮才提到 `content.point_ids`，但为时已晚且重试又返回了非法 JSON，错误信息被带偏。
- **修复**：① 原子化内联提示词显式立约——「每个原子的 `content.point_ids` 必须是非空数组，取值只能来自本批知识点，一个原子只归属一个知识点」；② 基础提示词模板 `99-知识原子生成.md` 的强制规则与输出示例同步补上 `content.point_ids`；③ `normalizeAtomBatch` 容错——个别模型把归属写到原子顶层 `point_ids` 时也接受，降低丢弃率。归属正确后证据摘录才会取到对应知识点的证据，不做猜测式顺序分配（避免张冠李戴）。

### 🔌 SSE 路径 `requestMiniMaxStream is not defined`（07-23 六连报错 + 卡死）
- **现象**：`minimax.stream-fallback {"errorMessage":"requestMiniMaxStream is not defined"}` ×6，每条后跟一次 `ratelimit.backoff`，该文件总结阶段 5 分钟未出结果。
- **根因**：`requestMiniMaxStream` 定义在 `ai-pipeline` 模块闭包内，却**既未列入该模块 `module.exports`、也未在 `main.js` 顶层 `require` 解构里导入**，插件类 SSE 接线处引用即抛 ReferenceError；该错误又被限流器当成 API 失败计入退避，级联放大卡顿。SSE 默认关闭故长期未暴露，用户一旦开启即触发。
- **修复**：`ai-pipeline` 导出 `requestMiniMaxStream`，`main.js` 顶层解构补导入。

### ✅ 上传确认「点确认后仍被拒、需确认两次」（07-20/23/24 每次重启后首文件）
- **现象**：`upload.confirm {"confirmed":true}` 记录后 15–33ms 内 `processTask.failed: 未确认允许上传源文件到外部解析 API`，每个会话第一个文件都得确认两次才成功。
- **根因**：`config.allowExternalUpload` 在 `getPdfExtractorConfig` 创建配置时即快照（彼时本会话尚未授权，为 false），而 `runEngine` 只读这个快照；确认弹窗虽然设置了会话授权标记，却**从未回写到该快照**——v2.8.1 自以为修好的注释其实没接通。
- **修复**：`extractDocumentWithApis` 中用户弹窗确认后把 `config.allowExternalUpload = true` 回写，`runEngine` 即时放行。取消 / 未授权分支行为不变。

### 🔀 合并并行编码优化（PR #1，来自 trae/agent）
- 本版本同时并入另一路并行开发（PR #1）对解码层的增强，与本修复无冲突：`decodeTextBuffer` 增加 PNG/JPEG/PDF/ZIP/RAR 魔数优先拒收与 UTF-8 快速路径；`encodingHeuristicBonus` 增加 Shift_JIS 字节特征加分与 cp1252 专有符号（`€`/`""`/`–` 等 0x80-0x9F）加分；`looksLikeEucKrBytes` 放宽超短韩文阈值；`readabilityScore` 改为大文本采样评估；`looksLikeGibberish` 对替换字符密集（>10%）短文本直接判乱码。
- 已验证：v2.9.1 既有的 GBK→ShiftJIS 误判防护（`looksLikeShiftJisBytes` 收紧）仍在，上述加分不会对 GBK 文档误触发；合并后 `smoke-encoding`（21 例）与 PR #1 自带 `test-encoding-comprehensive`（37 例）全绿。

### 🧪 测试
- 新增 `scripts/smoke-v292.js`（22 用例）：SSE 导出/导入双侧校验；`normalizeAtomBatch` 契约位置 / 顶层容错 / 无归属丢弃 / 单点自动归属 / 错误 point_id 五种归属情形 + 诊断打点；`atomizeSummary` 端到端验证 prompt 含 `content.point_ids` 且带归属返回全部入库；`extractDocumentWithApis` 真实闸门——确认后放行、取消拦截、未授权且无确认入口仍拦截（不回归放行）。
- 全部 8 套烟雾测试通过（6/21/ratelimit/6/9/12/21/22）+ PR #1 的 37 例编码测试通过；`node --check` 通过；bundle 加载冒烟通过（插件类 + 全部原型方法）。

---

## v2.9.1 — 2026-07-23 编码/乱码根因修复（解码侧修好，而非输出侧拦截）

针对「知识卡片/总结文件出现乱码」问题的系统性修复。原则：**在解码与截断环节就把文本产出正确**，而不是检测到乱码后拒绝输出（那是回避问题）。

### 🌍 自适应字符集解码重建（extractors 模块）
- **评分比例化**：`readabilityScore` 旧版按「字符个数」扣分，几十个重音字母就能把法语文档扣到 -5.7 判死；新版全部按占比，乱码信号换成真三件套——替换字符 U+FFFD / 控制字符（含 C1 区 U+0080-009F，即 UTF-8 续字节被误按 latin1 单字节解码的典型产物）/ 乱码二联体（`[À-ß][€-¿]`，如「Ã©」）
- **修复 v1.5 遗留的 /u 缺失 bug**：`isUnexpectedScriptOrPrivate` 的正则漏写 `u` 标志，`\uF0000` 被解析成 `\uF000` + 字面字符 `0`，导致 `0-\uFFFF` 退化成覆盖几乎所有文字字符的范围——**任何语言文档的可读性评分都被压到 0.2-0.4**（正常应接近 1.0）。这是法语/韩语等文档被误判乱码的深层根因
- **UTF-8 优先门扩展**：旧版仅在「有效 UTF-8 且含 CJK」时压制其他候选，越南语/俄语等无 CJK 的合法 UTF-8 被 ShiftJIS 的伪汉字解码反超（UTF-8 三字节与 SJIS/GBK 双字节区间重叠）；新判据「零替换字符 + 含任意非 ASCII」即强倾向 UTF-8（一个字节流既是合法 UTF-8 又是 GBK/SJIS 的概率趋近于 0）
- **新增候选编码**：EUC-KR（韩文）与 windows-1252（西欧）。旧版缺 euc-kr → 韩文被 gb18030 **静默**解成错误汉字（「茄臂茄臂」式，无任何报错）；缺 windows-1252 → `€` `“` `”` 等 0x80-0x9F 专有符号只能按 latin1 解出 C1 控制符
- **EUC-KR 字节特征判定**（`looksLikeEucKrBytes`）：KS X 1001 韩文字区首字节 B0-C8 / 尾字节 A1-FE 的双字节对占绝对多数 + ASCII 空格占比 >5%（韩文有词间空格，简体中文几乎没有）——双条件防 GB2312 一级汉字区（B0A1-D7F9 与韩文区字节重叠）误触发
- **ShiftJIS 判定收紧**：旧版「凑出一对合法双字节就判定」，GBK 短文极易偶然命中被解成半角片假名；新增「合法对须覆盖 60% 以上高位字节」（真日文高位字节几乎成对，GBK 误凑对只占 ~13%），同时候选序中 gb18030 提到 shift_jis 之前——平手时 GB 优先（本插件语料以大陆简体为主），真日文靠 +0.35 结构加分仍胜出
- **西欧单字节惩罚加证据条件**：高字节密度 >15% 时，仅当解码文本确实带 C1 控制符或乱码二联体才惩罚——真西欧文本（含 cp1252 专有符号）不受影响，GBK 误解产物被压制
- **UTF-16 无 BOM 放行**：旧版含 NUL 字节即按二进制拒收，无 BOM 的 UTF-16 文本（ASCII 隔字节为 0x00）被误杀；零字节交替分布符合 UTF-16 特征时放行交候选评分

### ✂️ 代理对安全截断（ai-pipeline 模块）
- JS 字符串是 UTF-16，emoji 与 CJK 扩展 B 汉字（如 𠀀）占两个码元，按固定字符数截断可能切在中间产出**孤立代理**——写 frontmatter / JSON 序列化 / 送 AI 时变成乱码方块或损坏的 JSON
- 新增 `adjustSurrogateCut` / `safeSlice`：切点落在代理对中间时前移一位。覆盖所有定长截断场景——`packWithOverlap` 超长块硬切（巨型表格/代码块）、`classificationSample` 分类抽样五段截取、`fallbackQuote` 证据引用截断、`buildRepairPrompt` 修复提示词截断
- 按换行符边界切的场景天然安全（0x0A 不会出现在代理对中间），未做多余改动

### 📦 ZIP 文件名 EFS/GBK 解码（zip 模块）
- Windows 资源管理器压缩、旧版 7-Zip 会把中文文件名以 GBK 字节写入且不设 EFS 标志（通用位标志 bit 11），旧版一律按 UTF-8 解 → 条目名乱码、按后缀找 `.md` 条目匹配不到。新规则：EFS 置位 → UTF-8；字节流合法 UTF-8 → UTF-8；否则试 GBK → latin1 兜底

### 🔤 其他
- `parseMimeHeaders` 补原始 UTF-8 头部转换：非 RFC 2047 编码词但直接写 UTF-8 字节的邮件头（中文邮件客户端常见，如纯中文 `Subject:`）旧版按 latin1 留下「åªæéä»¶」式乱码
- `stripHtml` 配套 `decodeHtmlEntities`：数字实体（`&#20013;`）/ 十六进制（`&#x6587;`）/ 约 50 个常用命名实体（`&eacute;` `&mdash;` `&euro;` 等）；代理区码点实体拒绝转换（防孤立代理注入）；未知实体原样保留
- `detectDominantLanguage` 补 ko/ru/ar/th/hi 识别（旧版非中日英一律 `unknown`，影响 AI 总结措辞的语言提示）
- `looksLikeGibberish` 重构为最后一道防线：只认真乱码信号（替换符 >2% / 控制符 >3% / 乱码二联体 >5% / 可读字符 <62%），不再把拉丁扩展字母当乱码——合法法/越/韩/俄长文不再误杀

### 🧪 测试
- 新增 `scripts/smoke-encoding.js`（21 用例）：法/越/俄 UTF-8、韩文 EUC-KR、GBK 中文、真日文 ShiftJIS、无 BOM UTF-16LE、cp1252 专有符号、纯 ASCII、二进制拒收、HTML 实体（含代理区拒绝）、五语言识别、乱码判定正反例、safeSlice 全切点无孤立代理穷举、`splitMarkdownSections` 超长单行硬切拼接与原文逐字节一致、ZIP 三种文件名编码
- 全部 7 套烟雾测试通过（6/21/ratelimit/6/9/12/21）；`node --check` 通过；bundle 加载冒烟通过

---

## v2.9.0 — 2026-07-23 邮件附件切片 + 会话级失败缓存与启动续传

### 📎 邮件附件：保存、切片、双向链接
- **MIME 解析器**（`parseEmailMessage`）：对 .eml 原始字节做 multipart 递归解析（mixed/alternative/related），支持 base64 / quoted-printable 传输编码、RFC 2047 编码词（`=?UTF-8?B?…?=`，中文主题/发件人/附件名不再乱码）、charset 声明解码（GBK/Big5 等，失败回退自适应探测）；畸形邮件自动回退旧的纯文本路径，不差于 v2.8
- **附件保存 + 自动入队切片**：附件保存到 `<邮件所在目录>/_attachments/<邮件名>/`（仍在 intake 根内，重扫按 hash 去重）；可处理类型（pdf/docx/xlsx/pptx/图片/txt/md/html）的附件**立即建任务入队**，同轮自动处理即接管
- **双向链接**：邮件知识卡片追加「## 关联附件」节（`[[附件.pdf]]`）；附件切出的卡片追加「> 来源邮件：[[邮件名]]」回链；附件卡 frontmatter 的 `source_link` 天然指向附件文件，附件文件→卡片方向由 Obsidian 反向链接面板提供
- **衍生**：嵌套邮件（message/rfc822）整体存为 `.eml` 递归进流水线；无文件名的内联 CID 图片（签名/logo 装饰图）不进附件，避免垃圾任务；**正文为空但有附件的邮件不再整体判 failed**（合成占位正文，附件照常保存切片）；新增 `email.attachments` 诊断事件
- `.msg`（Outlook）仍维持「暂不支持，请导出 EML」
- 复用点：断点续传零新增代码——附件任务的解析/总结/原子化产物沿用既有 artifacts 缓存（`artifactsPath/<run_id>/*.json`）

### 🗑️ 会话级失败缓存（审核工作台）
- 处理失败的文件现在显示在**审核工作台**顶部「处理失败的文件」区块：文件名 + 失败阶段 + 错误原因，每条带「重试」（沿用 `retryTask`，自动断点续传）和「移除」按钮
- **会话级语义**：插件启动时（`sessionStartupCleanup`）自动从任务账本清除上一会话遗留的 failed 记录——失败展示只存在于当前会话，关闭软件后不再显示；处理概览的「失败」统计因此同样只反映本次会话

### ▶️ 启动续传询问
- 打开软件时检测上次关闭时处于解析/判定/总结/原子化/写入/排队中的任务，弹窗列出文件名并询问：
  - **「继续处理」**→ 重新入队，`processTask` 经 artifacts 缓存**自动从上次完成的步骤接着往下**（已解析不重解析、已总结不重总结）
  - **「放弃」**→ 从账本移除这些记录，保持处理概览干净（源文件仍在 vault，可重新扫描）
- 启动清理全程 try/catch 兜底并打诊断日志（`startup.failedCleared` / `startup.interruptedFound` / `startup.interruptedDiscarded`），不会阻塞插件加载

### 🧪 测试
- 新增 `scripts/smoke-email-mime.js`：从 main.js 抽取真实 extractors 模块，覆盖 multipart 结构、plain 优先于 html、base64 字节完整性、QP 解码、GBK 正文、编码词附件名、内联 CID 跳过、嵌套邮件、二进制垃圾兜底、`extractTextFromBuffer` email 分支端到端（含 parsePackage 元数据透传与可序列化性）
- 既有 5 套烟雾测试全部通过；`node --check` 通过

---

## v2.8.1 — 2026-07-20 用户诊断日志反馈的四个问题修复

根据用户实机诊断日志（`~/.eks/logs/diag.log`）定位并修复：

### 🐛 诊断日志头部重复累积
`flushDiagLog` 剥离旧头部时查找的 `'\n\n\n\n'` 标记在文件里从不出现（头部结尾只有 `\n\n`），旧头部永远剥不掉，每次 flush 都在文件最前面再摞一份头部说明（用户日志里累积了 27 份，还挤占 2000 行 trim 额度）。改为按行剥离文件开头的所有头部块（第一行为标题 + 后续空行/`>` 说明行），升级后第一次 flush 即自愈历史重复文件。

### 🐛 MiniMax 529（服务端过载）不重试，一次就杀死整个任务
`isTransientHttpStatus` 的可重试状态码清单没有 529（Anthropic 协议的 `overloaded_error`，MiniMax 国内版兼容接口会返回）。用户一份文档跑到原子化第 9 分钟，遇到一次 529 整个任务直接 failed。现在 529 与 429/5xx 一样走指数退避重试（`aiRequestMaxAttempts` 次）。

### 🐛 上传确认弹窗点「确认」后仍被「未确认允许上传」拒绝
弹窗确认（`confirmUploads`）与解析引擎的授权门（`settings.pdfAllowExternalUpload`）是两套独立逻辑：用户在弹窗点了确认，9ms 后 `runEngine` 仍以「未确认允许上传源文件到外部解析 API」拒绝，只能再去设置里手动开开关。现在：
- 弹窗点「确认」→ 本次会话视为已授权（`runEngine` 放行）
- 勾选「不再询问」→ 持久化 `pdfAllowExternalUpload = true`
- `upload.confirm` 诊断事件新增 `sessionApproved` 字段

### 🐛 「MiniMax 未生成任何可用知识原子」无诊断、无自救
用户一份 21K 字 / 101 个标题的手册跑了 12 分钟后报此错误，日志里查不到任何原因。根因链路：AI 返回的原子在 `normalizeAtomBatch` 被静默丢弃（point_id 不匹配 / 重复归属 / 无归属），批次「成功」通过校验但 atoms 为空，最终在 writing 阶段才炸。现在：
- `summary.merged` 诊断：总结合并后的知识点数 / 证据数（确认总结本身有没有产出）
- `atomization.batch` 诊断：每批请求知识点数 vs 产出原子数
- `atomization.normalize` 诊断：归一化丢弃计数（point_id 不匹配 / 重复 / 无归属）
- `workflow.result` 诊断：最终 accepted / review 计数
- 知识点非空但原子为 0 的批次会触发一次「带校验错误的修复提示词」重试，不再静默通过
- 报错信息带上下文计数（总结知识点数、原子化产出数）和诊断事件指引

### 🧪 测试
- 新增 `scripts/smoke-diag-fixes.js`：从 main.js 抽取真实的 `stripDiagHeaders` / `isTransientHttpStatus` 验证（27 份重复头部一次清净、529 判定为瞬态）
- 既有 4 套烟雾测试全部通过；`node --check` 通过

---

## v2.8.0 — 2026-07-20 自动扫描改为设置项，默认关闭

### ⚙️ 启动自动扫描设置项（默认关闭）
- 新增设置 `autoScanOnStartup`（默认 `false`），设置面板「启动时自动扫描」开关（位于「并发处理文档数」下方）
- **关闭（默认）**：插件启动不读源文件目录、不触发云端解析与 MiniMax 调用；扫描只能通过控制台「扫描并自动处理」按钮或命令「扫描源文件」手动触发
- **开启**：每次打开 Obsidian，工作区布局就绪后自动扫描源文件目录（招投标 / 业务库），扫描完按既有逻辑进入自动处理；启动与失败均打 `autoScan.start` / `autoScan.error` 诊断日志
- 设计动机：自动扫描会连带触发云端解析和 AI 计费，属于高成本行为，应由用户明确选择开启，而不是默认生效

### 🔢 设置迁移（settingsVersion 16 → 17）
- 旧用户升级后 `autoScanOnStartup` 一律落为 `false`（布尔强转，杜绝脏值），即升级后自动扫描保持关闭
- 手动触发路径（按钮 / 命令 / 文件菜单「用工程知识切片处理」）行为不变

---

## v2.7.0 — 2026-07-20 切片引擎重写（借鉴 Tencent/WeKnora）

研究了腾讯开源的 [WeKnora](https://github.com/Tencent/WeKnora) 的知识点切片思路（`docreader/splitter/splitter.py` 的受保护模式 + 重叠合并、`internal/infrastructure/chunker/` 的文档画像驱动策略 + 标题面包屑 + 小节合并 + 候选边界装箱），把其中与「切片质量 / 处理效率」直接相关的设计移植到本插件已有的切片流水线。**不引入 ask agent / WIKI 等新功能**，只优化已有功能。

### ✨ 文档画像驱动策略选择（借鉴 profiler.go / SelectStrategy）
新增 `profileMarkdown(text)`：切块前对文档做一次性轻量扫描，收集标题数量与层级分布、表格 / 代码 / 公式存在性、代码占比、编号章节数、段落断行数等结构信号，据此选择切分策略：
- `heading` —— 标题 ≥ 3 个且有主层级 → 按标题边界切分（Tier 1）
- `heuristic` —— 无标题骨架但有段落结构 → 按安全换行装箱（Tier 2）
- `legacy` —— 纯长文 → 安全换行装箱兜底（Tier 3）

画像结果打 `splitter.profile` 诊断日志，便于排障时确认走了哪条策略。

### ✨ 标题边界切分 + 层级面包屑（借鉴 heading_splitter.go 的 ContextHeader）
- 新 `splitByHeadings`：按主标题层级（出现 ≥ 3 次的最低层级，同 WeKnora `DominantHeadingLevel`）切 section，代码块内的 `#` 行不误判为标题
- 每个切片新增 `breadcrumb` 字段：标题层级路径（如 `# 第三章 结构设计\n## 3.2 荷载计算`），与 WeKnora 一致——面包屑不塞进正文（保持「拼接即还原原文」的覆盖不变式），作为独立语境传递
- 总结 prompt 注入 `所属章节路径：…`，AI 拿到的不再是孤零零的分块，而是带章节语境的分块 → 证据定位（evidence locator）更准：`normalizeSummaryMap` 的回退定位优先用面包屑路径（「第三章 结构设计 > 3.2 荷载计算」）而非首个标题

### ✨ 受保护区域永不切断（借鉴 splitter.py 的 protected_regex）
旧实现按行累积切分，表格 / 代码块 / LaTeX 公式可能被拦腰切成两半喂给 AI，总结质量直接塌方。新实现：
- 识别围栏代码块（含未闭合兜底）、Markdown 表格（连续 ≥ 2 行 `|…|`）、`$$…$$` 块级公式为受保护区域
- 受保护区域内的换行被剔除出候选切点（同 WeKnora `dropBoundsInsideSpans`）
- 单个受保护区域超过 maxChars 时才硬切（同 WeKnora「太长则进一步分段」）

### ✨ 小节合并 coalesceTinyChunks（借鉴 heading_splitter.go）
同一标题语境下过小的相邻切片自动合并（目标 ≈ maxChars/2，同 WeKnora），**直接减少 AI 调用次数**——对「一节一两句话」的规范 / 清单类文档提速明显（此前这类文档每个小节都要独立调一次 AI）。合并规则：
- 只合并 `cur.end === next.start`（相邻无重叠）的切片，有重叠的切片不合并，避免内容重复拼接
- 只合并共享标题前缀（`commonBreadcrumbPrefix`，同 WeKnora `commonHeadingPrefix`）的切片，不跨顶级章节混并
- 可在设置中关闭（「合并过小切片」开关）

### ✨ 切片重叠 overlap（借鉴 splitter.py 的 chunk_overlap）
新增 `chunkOverlapRatio` 设置（默认 0.1，对应 WeKnora 80/512 ≈ 15% 的思路；范围 0–0.5）：flush 一个切片后，下一个切片的起点回退到 `overlapChars` 窗口内最近的安全换行切点，段落语境不再在切点处断裂。设为 0 即关闭（关闭时「拼接所有 chunk === 原文」精确成立）。

### ✨ 切片校验（借鉴 splitter.py _validate_chunks / validator.go）
新 `validateChunks`：每次切分后自检「起点升序 / 原文完整覆盖（允许重叠）/ 超尺寸告警」，失败打 `splitter.validate` 诊断日志（只告警不阻断）。

### ⚙️ 设置项（settingsVersion 15 → 16）
- `chunkOverlapRatio`（默认 0.1）—— 切片重叠比例，设置面板「切片重叠比例」
- `coalesceTinyChunks`（默认 true）—— 合并过小切片开关，设置面板「合并过小切片」
- 非法值迁移回退默认；两项均从 `processTask → runKnowledgeWorkflow → summarizeDocument` 全链路透传

### ⚠️ 行为变化
- `splitMarkdownSections` 返回形状向后兼容：`{ chunk_id, markdown, headings }` 不变，**新增** `breadcrumb` 字段
- 切分结果与旧版不再逐字节一致（按标题边界 + 合并 + 重叠重排）；artifact 缓存在任务重跑时自动覆盖，无需手动迁移
- 无重叠无合并时 `join(chunks.markdown) === 原文` 精确成立（烟雾测试已锁定）

### 🧪 测试
- 新增 `scripts/smoke-splitter-v26.js`（21 用例）：画像 / 策略选择 / 标题切分 + 面包屑 / 受保护表格、代码块、LaTeX / 小节合并（含不跨章语境）/ 重叠 / 覆盖校验 / 向后兼容 / 边界夹取
- 新增 `scripts/load-ai-pipeline.js`：从 main.js 抽取真实模块隔离执行的共享加载器（不再内嵌旧实现副本）
- `scripts/smoke-split.js` 改用真实模块加载，v2.5 的 6 个回归用例全绿
- 全部 4 套烟雾测试（split / splitter-v26 / ratelimit / json-repair）通过；`node --check` 通过；22 个 bundle 模块结构不变

---

## v2.6.0 — 2026-07-15 短文档原子化性能优化

### ⚡ 原子化请求降量与有限并发
- `maxPointsPerRequest` 正式接入完整工作流，默认每批 3 个知识点，不再固定每批 1 个。
- 新增 `atomizationConcurrency`，默认同时处理 2 批，设置页可选 1-3。
- MiniMax JSON 与 SSE 请求统一经过 `RateLimiter.run()`，并修复请求结束时提前放行 waiter、绕过滑动窗口的问题。

### 🛡 短文档数量异常保护
- 新增 `shortDocumentMaxCards`，默认 20。
- 3 页以内文档生成卡片数超过阈值时，整批转入审核台人工确认，不截断、不丢弃知识原子。
- 设置页新增「每批知识点数」「原子化并发数」「短文档卡片异常阈值」。

### ⚙️ 版本与迁移
- `settingsVersion` 14 → 15；旧设置自动补齐并限制到安全范围。
- `manifest.json` / `package.json` 同步升级到 2.6.0。

---

## v2.5.0 — 2026-07-15 splitMarkdownSections 边界修复

### 🐛 全空白输入导致下游崩溃
当 vault 里碰到「全换行 / 全空白 / 被前面预处理清空的 markdown」时，`splitMarkdownSections` 会返回 `[]`（tokens 全部被过滤），下游 `summarizeDocument` 走到 `partials[0]` 时拿到 `undefined`，触发 `Cannot read properties of undefined`。这是真实存在的崩溃路径（用户报过类似「拆 chunk 卡死」）。

修复：
- 空字符串判断从 `!source` → `!source.trim()`，覆盖纯空白
- 主循环结束后兜底 `if (!chunks.length) chunks.push(source)`
- 含义：哪怕输入是空字符串，也至少返回 1 个 chunk（`{ chunk_id: 'chunk-001', markdown: '', headings: [] }`）

### 🧪 烟雾测试 `scripts/smoke-split.js`
6 个用例覆盖边界：空字符串 / 纯空白 / 全换行 / 普通文本 / 超大单行（25000 字符应切 3 段）/ 多个 heading 边界。

### ⚠️ 行为变化
- 之前：空 markdown → 1 个空 chunk
- 之前：纯空白 markdown → 0 个 chunk（崩）
- 现在：空 / 纯空白 → 1 个 chunk（不崩，下游 schema 校验会拿到 `core_knowledge: ''` 走 needs_fix 分支）

### 🔧 其它微调
- v2.4 顺手补的 settings 迁移现在覆盖 v2.2 (useStreamingAi) + v2.4 (rateLimitBackoffMaxMs / rateLimitWindowSize)
- 不再列出对终端用户可见的变化

---

## v2.4.0 — 2026-07-15 自我代码审查 + 鲁棒性补丁

### 🐛 RateLimiter 内存泄漏修复
v1.7 重写的 `RateLimiter.acquire()` 有一个边界 bug：定时器触发时如果仍有并发占用，旧代码会 `unshift(waiter)` + `_scheduleNextWaiter()`，但**未先从 `waiters` 数组移除原 push 的 waiter**，导致同一 waiter 在数组中出现两次并泄漏。修复：
- 加 `waiter.done` 标志
- 定时器触发后判断 `done` 跳过（已被 `_scheduleNextWaiter` 处理）
- 重排队时不再 `unshift`，而是重设同一个 timer
- `_scheduleNextWaiter` 移出已 done 的 waiter 时递归跳过

### 🛠 parseJsonPayload 补全 JSON 修复
v1.5 CHANGELOG 说加了 `repairJsonText`，但实际从未进入 main.js。AI 触达 8192 token 上限时常返回**未闭合** JSON（`{"a": "hello` 或 `{"items": [{"x": 1,`），之前直接抛 `AI_INVALID_JSON` 让用户重试。新增 `repairJsonText` 补全策略：
- 去除尾随逗号
- 关闭未闭合字符串
- 补全缺失的 `}` / `]`
- 补全后再次 JSON.parse 验证，可解析才返回；不可解析返回 `null` 让上层抛错
- `parseJsonPayload` 在 slice-between-braces 失败后兜底调用一次

### 🧪 烟雾测试套件
新增 `scripts/` 目录两个独立可运行的 Node 脚本：
- `scripts/smoke-ratelimit.js`：20 个并发请求 → 验证 waiters 数组不泄漏；backoff 算式；窗口淘汰
- `scripts/smoke-json-repair.js`：6 个修复用例（已完整 / 缺 } / 未闭合字符串 / 多层级 / 平衡态）

跑法：`node scripts/smoke-ratelimit.js` / `node scripts/smoke-json-repair.js`。CI 接入留 v3.0。

### ⚙️ settings 迁移补全
- 新增 `useStreamingAi` 默认值迁移
- 新增 `rateLimitBackoffMaxMs` / `rateLimitWindowSize` 迁移
- 旧用户升级 v2.4 时这些新设置会平滑落到 `DEFAULT_SETTINGS`，避免 UI 显示「undefined」

### ⚠️ 范围说明
- RateLimiter 修复改变了并发行为时序（用 `done` 标志 + 单一 timer），但**对外行为一致**：acquire 仍按 FIFO 等待、超时后再次尝试、backoff 仍生效
- parseJsonPayload 修复**仅在原有失败路径上**增加兜底；正常 JSON 解析路径完全不变
- 两个 smoke test 是开发工具，**不打包**进 main.js，**不影响**最终用户

---

## v2.3.0 — 2026-07-15 ESM 切包可行性研究 (M-03)

### 📋 docs/ESM_FEASIBILITY.md
完整评估把 main.js（5500+ 行 IIFE CommonJS bundle）切成真 ESM + src/ 树的可行性、路径与风险。结论：v2.3 仍发「研究 + 框架」版（不动 main.js 内部 IIFE），完整切换留 v3.0 单独 PR。详见文档。

### 🛠 esbuild.config.mjs 修正
- 修正 `entryPoints: ["src/main.ts"]` → `["src/main.js"]`（之前指向不存在的文件）
- 加详细注释说明 v2.3 / v3.0 切包路径
- 仍保持 `format: "cjs"`（IIFE 时代不动）

### 📁 src/main.js 占位文件
- 抛友好错误，明确告知 Obsidian 应加载仓库根目录的 main.js（IIFE bundle）
- 防止误用 `npm run dev` 时直接看到 obscure esbuild 错误

### ⚠️ 为什么 v2.3 不真切
1. **破坏性**：所有 fork / 二次开发者需要重新走 esbuild build，CI / 自动化脚本要同步升级
2. **测试覆盖**：移动端 (iOS) ESM 插件兼容性需要在真机回归
3. **范围控制**：5000+ 行 IIFE → ESM 是 2-3 天的纯重构工作，单独 PR 更利于 review
4. **风险收益比**：当前 IIFE 自包含的发布形态对终端用户最友好（无 source map 暴露、单文件可加载）

### 📌 v3.0 切包 checklist（已写入文档）
- [ ] 选 2.1 / 2.2 哪条路径（最小破坏 vs 真多文件）
- [ ] 写迁移脚本：22 个 IIFE factory → 22 个 `export function`
- [ ] esbuild config: `format: "esm"`
- [ ] 移动端端到端测一遍
- [ ] 二次开发者文档更新

---

## v2.2.0 — 2026-07-15 SSE 流式 POC (PR 4)

### 🌊 MiniMax SSE 流式接收 (opt-in)
之前所有 AI 请求都是「等整个响应回来再解析」—— 18 分钟等待期只能靠 1 秒一次的心跳看到 elapsedMs。现在新增一条流式路径：

- **`sseJsonRequest(url, init, onDelta)`**：用 `globalThis.fetch`（Obsidian 桌面端是 Electron 27+，原生支持 ReadableStream）按 `text/event-stream` 协议逐 `data:` 块读取
- **`requestMiniMaxStream({ settings, prompt, context })`**：与 `requestMiniMaxJson` 等价的请求体，但启用 `stream: true` 并在 Anthropic 协议下累积 `content_block_delta`（`text_delta` + `input_json_delta`）成完整 JSON 文本
- **`collectSseTextDeltas(event, state)`**：增量累积器，复用于两套事件格式（`text_delta` 自由文本 / `input_json_delta` 工具调用参数）
- **设置开关**：新增 `useStreamingAi` (默认 `false`)。开启时 `requestWithContract` 在第 0 次尝试走 SSE，失败自动回退非流式；第 1+ 次（修复重试）继续走非流式
- **降级路径**：流式失败时记录 `diag('minimax.stream-fallback')`，调用方无感

### 🎯 影响范围
- `requestWithContract` 加 `streaming: true` + `requestStream` 两个可选参数
- `summarizeDocument` 把 `requestStream` 透传到两次 `requestWithContract` 调用（`summary-map` / `summary-reduce`）
- 其它阶段（classification / atomize）暂不接 SSE，留待 v2.3 评估

### ⚠️ POC 限制
- 仅在 Obsidian **桌面端**（Electron）有效；iOS / Android mobile 不保证 ReadableStream 行为一致
- 流式失败时**不**走 `fetchWithTransientRetry` 的瞬态重试，直接降级
- 未做增量 token 计数 / 实时 UI 显示（SSE 文本进 `onProgressText` 钩子但 dashboard 暂未消费）
- 移动端用户开启该开关会看到降级日志（`stream-fallback`），可关

---

## v2.1.0 — 2026-07-15 源码结构文档化 (S-01 lite)

### 📚 22 个 IIFE 模块加 JSDoc 头注释
main.js 内部 CommonJS IIFE 之前只有 `"src/core/<name>.js": function(...)` 这一行作为边界标识，IDE 折叠 / Go-to-Definition 全部失效。
本次在每个模块入口前补 `@module` / `@exports` 注释块（共 22 个）：

| 模块 | 职责摘要 |
|------|----------|
| `task` | 默认配置 / runtimeVersions |
| `tags` | 标签库 / Map_Index / 卡片字段校验 |
| `extractors` | 文本提取入口 |
| `moc` | 文件夹 MOC 生成 |
| `ecosystem` | vault 生态插件探测 |
| `routing` | folder_type → vault 路径 |
| `external-pdf` | 外部 OCR 调度 |
| `mineru-api` | MinerU 上传+轮询+下载 |
| `paddleocr-api` | 飞桨 OCR |
| `zip` | 轻量 zip 解压 |
| `component-contracts` | 共享契约 |
| `migration` | tasks.json 老格式迁移 |
| `document-parser` | 文档解析计划 |
| `identity` | 卡片 ID 指纹 |
| `pipeline` | 单文件流水线骨架 |
| `schema-validator` | AI 输出 schema 校验 |
| `ai-pipeline` | MiniMax 调用层 |
| `confidence` | 置信度评分 |
| `markdown-renderer` | 卡片 Markdown 渲染 |
| `link-service` | 卡片间链接 |
| `workflow` | 顶层工作流编排 |
| `review-service` | 审核面板 |

### 📄 新增 BUILD.md
- 解释单文件 bundle 模式 + 开发模式（npm run dev / build）
- 列出 22 个 IIFE 模块的入口行号 / 职责
- 跨模块通信约定（globalThis.__eksDiag / __eksUploadConfirm 黑板）
- "添加新模块" SOP（位置 + require 用法）
- ESM 切包（v3.0 独立规划）的简短路线

### ⚠️ 范围说明
S-01 原计划包含 1-3 天的真 source split（拆 src/ 树 + esbuild 真切包）。该部分**仍按原计划留作 v3.0 / M-03 独立 PR**，本 PR 只交付**轻量版文档化**：JSDoc + BUILD.md + 注释。运行时行为零变化，可安全升级。

---

## v2.0.0 — 2026-07-15 Markdown 渲染加固 (M-06)

### 🐛 真实 bug 修复
**`renderCardMarkdown` 未定义导致的 TypeError**：dashboard 渲染卡片时调用了一个从未导出的函数名 `renderCardMarkdown(card)`，但模块实际导出的是 `renderKnowledgeCard`。结果是该路径在卡片渲染时抛 `renderCardMarkdown is not defined`，dashboard 跳过卡片区。修正为 `renderKnowledgeCard(card)`，路径恢复。

### 🛡 renderKnowledgeCard 容错加固
所有可能为空的字段（summary / key_points / glossary / relations / sources）用 `optionalSection()` 包起来，缺失字段不渲染章节、不抛错：
- `summary`：`Array.isArray && length > 0` 才输出 `## 摘要`
- `key_points`：每条独立 trim / 空串过滤 / toString
- `glossary`：每条 term 缺失时回退为 term 自身
- `sources`：`Array.isArray && length > 0` 才输出 `## 来源`
- `relations` / `semantic_links`：防御性 `for...of` 迭代，混合类型（字符串 / 对象）均能处理
- `confidence_decision` 与 `confidence` 拆为独立行（之前塞在一行 Yaml 里）

### ⚠️ 风险
本次涉及所有已批准 / 已落盘卡片的 Markdown 重新渲染逻辑（dashboard 实时预览 + 卡片归档）。v1.9.0 之前已写入 vault 的卡片**不会**自动重写（仍是旧格式）；如需重渲染请在设置面板里点「重写所有卡片」。

---

## v1.9.0 — 2026-07-15 性能 + 路径解析 + 死代码清理后续

### ⏱ M-04 写盘防抖
12 批次原子化会触发 30+ 次磁盘 IO。改为 500ms 防抖：
- `saveTasks(tasks)` 不再立即写盘，而是把任务挂到 `this._pendingSaveTasks` 并起一个 setTimeout(500ms)
- 期间再次调用 `saveTasks` 会更新 pending tasks 并重置定时器
- `_flushSaveTasks()` 在定时器触发后真正落盘（保留 M-11 的备份逻辑）
- 关键节点（onunload）走 `flushSaveTasksImmediate()` 强制立即落盘，避免防抖窗口内的写丢失

效果：磁盘 IO 从 30+ 次/任务降到 1 次/任务（连续心跳 / 批次完成聚合）。

### 🔄 M-01 RateLimiter 重写
旧实现：100ms 轮询忙等 + 没有 backoff。
新实现：
- **滑动窗口**：保留过去 N 次（默认 10）请求时间戳，窗口内并发数 ≤ maxConcurrent 才放行
- **事件驱动**：FIFO 等待队列 + setTimeout resolve，不做 100ms 轮询
- **指数退避**：失败时 `intervalMs × 2^failures`，上限 `backoffMaxMs`（默认 30s）
- 每次 `run(fn)` 成功后清零失败计数；失败时累加
- 新增 settings: `rateLimitBackoffMaxMs` / `rateLimitWindowSize`

### 🆔 M-08 cardIdentity 防碰撞
旧版 `card-${sourceHash.slice(0,12)}-${fingerprint.slice(0,12)}` —— 两个 12 字符 hex 切片独立碰撞域，约 65k 文档级别就可能撞 ID。
新版：完整 sourceHash[:16] + fingerprint[:16] + 加 library 前缀（bid/business）。
碰撞概率降到 ~2^64（生日界）。

### 📁 M-09 EPC folder_type 模糊匹配
folder-map.json 里 "04-设计优化方案" 和 "04-设计优化方案及设计方案(EPC工程)" 是两条不同的 route。AI 可能输出 `04-设计优化方案(EPC工程)`，旧版精确匹配失败直接抛错。
新版 `resolveFixedRoute`：
1. 精确匹配
2. 任一包含（prefix.includes）
3. 反向包含
4. 去掉括号再次精确匹配
任一命中即返回 route，避免抛错。

### 📋 m-01 readFrontmatterValue 支持 YAML 列表 + 多行
旧版正则 `[^\"\n]+` 不能处理：
- `Tags: [a, b, c]` —— 列表
- `Tags:\n  - a\n  - b` —— 多行列表
- `Title: "value with spaces"` —— 双引号已经能处理
新版：能解析 inline list、多行 list、多行字符串（折成空格分隔）。

### 🛡 风险
- 写盘防抖窗口（500ms）内如果 Obsidian 崩溃，写丢失。
  - **缓解**：onunload 强制 flush；setTaskProgress 在 status 转换时也可走 flushSaveTasksImmediate（v1.10 再加）。
- RateLimiter 滑动窗口大小 10 —— 高频场景下窗口外的请求会立即放行。
  - **缓解**：可用 setting 调整到 30/60。
- cardIdentity 加 library 前缀 —— 如果以后用户把文档从一个 library 移到另一个，ID 会变（这是 feature，不是 bug —— 跨库应该被视为不同卡片）。

### 🔍 验证步骤
1. `node --check main.js` 通过
2. 跑一个 12 批次任务，看磁盘 IO 次数（可用 iostat）
3. 把 AI 的请求间隔调到 100ms，看 RateLimiter 是否会 backoff
4. 在 folder-map 加一条 "04-设计优化方案及设计方案(EPC工程)"，触发一次 "04-设计优化方案(EPC工程)" 看能否路由成功

---

## v1.5.0 — 2026-07-15 鲁棒性 + 死代码清理

### 🛠 S-05 AI JSON 解析鲁棒化
旧版 `parseJsonPayload` 只剥 ``` 围栏、剥 <think> 块、剥尾逗号、抽 `{...}`。AI 输出稍复杂就抛 `AI_INVALID_JSON`。
新增 `repairJsonText`：
- 补齐不配对的花括号 / 方括号
- 补齐未闭合的字符串引号
- 多重兜底路径（每条路径都写 `parse.fallback.*` diag 便于事后分析 AI 输出质量）
- 不会激进改语义：不会修未加引号的 key，不会改单引号

### 🗑 M-02 死代码清理
v1.1 重构期的中间产物，从来没被外部调用：
- `processTaskLegacy`（129 行）—— 已删
- `renderContentLegacy` / `renderQueueLegacy` / `renderReviewLegacy` / `renderDraftSummary` —— 已删
- `buildTaskFromFile` / `futureMediaStatus` —— 已删
- `pipeline.js` 里 `TRANSITIONS` / `transitionTask` / `acquireLease` / `releaseLease` / `retryFailedTask` / `runPipelineTask` / `artifact` / `requiredHandler` / `copyTask` —— 已删
- `routing.js` 里 `cardOutputFolder`（仅被 `cardOutputPath` 内部使用）—— 折入 `cardOutputPath`

代码量从 5715 → 5540 行（-175 行 / -3.1%）。

### 🛡 m-03 sanitizeFileName 防 `..` 路径穿越
用户把卡片 title 写为 `..` 或含 `..` 字符串会逃出 vault。补一道清洗：替换 `\.\.+` 为 `-`，去掉开头的 `.`。

### 🌍 m-05 looksLikeGibberish 不再误判韩/阿/泰/印地等合法脚本
旧版 `isUnexpectedScriptOrPrivate` 把韩文（Hangul）/ 阿文（Arabic）/ 泰文（Thai）/ 印地（Devanagari）等多种合法脚本都判为"unexpected"，导致含这些脚本的文档被误判为乱语直接走 failed。
现在只把"私有区 + 替换字符 + 代理对"判为 unexpected。不会改变对真正乱码（控制字符、U+FFFD、UTF-16 截断）的判定。

### 📋 m-06 classification schema 补 schema_version
`classification.schema.json` 之前没要求 `schema_version` 字段。AI 输出里有没有这个字段都被接受，跨版本兼容性靠记忆。
现在 `required` 列表加了 `schema_version`（const: "1.1"），`additionalProperties: false` 保证不再有无 schema_version 的旧输出混入。

### 🛡 风险
- AI JSON 鲁棒化引入了"补齐不配对括号"的启发式，理论上可能把"AI 截断的合法 JSON"误判为"可补齐"。
  - **缓解**：补齐策略只做闭合（`}`/`]`）和补引号，不改任何内容；每条 fallback 路径写 diag 便于追溯。
- 死代码删除用 `git checkout main.js` 兜底了一次（被 Python 脚本误删）。
  - **缓解**：后续会改用 Edit 工具的精确字符串匹配 + Node `--check` 双重验证，不再用 Python 行号批量删。

### 🔍 验证步骤
1. `node --check main.js` 通过
2. 装 1.5 跑一次有韩文 / 阿文 / 泰文的 PDF，确认不再被 `looksLikeGibberish` 误判
3. 把任意 AI 输出补一个缺右括号的 JSON 试一下，确认能 fallback 解析

---

## v1.4.0 — 2026-07-15 P1 安全加固：内容指纹 + 截断 UI + 迁移备份

### 🔒 S-02 内容指纹脱敏（不再依赖键名）
旧版 `diag` 只在键名匹配 `/(key|token|secret|password)/i` 时才指纹化，调方改个 key 名就漏出来。新版改为**内容指纹**：
- JWT（`eyJ...`）、GitHub PAT（`ghp_/gho_/ghs_/ghu_/ghr_/ghx_`）、`sk-`/`sk_`/`key-`/`paddle-` 前缀的 token
- 长度 ≥ 40 字符且字符类 ≥ 3 种（大小写/数字/+/=）的高熵串 → 视为凭证
- 不会被误伤：短字符串、含空格的自然语言、路径、URL 前缀
- 同时升级 `sanitizeSecret`（Notice 用的脱敏）也走同一套逻辑

### 📂 M-10 路径比较顺序统一
旧版散落 5+ 处 `normalizeVaultPath → normalizeUnicodeForm` / `normalizeUnicodeForm → normalizeVaultPath` 互换。统一抽出 `normalizePathForCompare` 入口（顺序固定 normalizeVaultPath → normalizeUnicodeForm），所有调用点替换。

同时修复 `isInternalSlicerFile` 的 bug：原来 `draftPath` / `logPath` 没经过 normalize，导致配置里写全角空格或前后斜杠的边界条件下漏判。已修复。

### 💾 M-11 写盘前自动备份 + 暂停/恢复
旧版 `recoverStaleProcessingTasks` 把中断任务一刀切改为 `failed`，用户无法批量恢复。改进：
- `saveTasks` 写盘前自动备份上一版到 `tasks.json.bak.{ISO-timestamp}.json`（setting `backupTasksOnSave`，默认 true，可关）
- 中断任务改记为 `paused`（可在 dashboard 重新入队）
- 新增 dashboard 按钮 **"恢复暂停任务"**：把所有 `paused` 状态任务批量回 `queued`

### 🛡 M-05 apply_correction 白名单校验
旧版 `applyBatchAction` 用 `Object.assign({}, atom, correction)` 直接合并，用户在 prompt 输入什么就接受什么（甚至能改 `_id` 之类内部字段）。

新版：
- 字段白名单：`Category / TagL1 / TagL2 / Info_Type / Event_Type / Card_Type / Map_Index`
- 类型校验：必须是 string
- 长度上限 100 字符
- 空字符串视为"不修改该字段"
- 提示文案明确告知白名单

### ⚠️ M-07 AI 截断 fallback UI
v1.1.10 加了 `_truncated` 标志但没有 UI 反馈。新版：
- workflow 返回 `truncated` / `truncatedCompleted` 字段
- 任务保存时记录 `task.truncated` / `task.truncated_completed`
- 触发时弹 Notice 一次
- dashboard 顶部 banner 汇总所有被截断的任务（前 5 个 + 总数）
- 配套 styles.css `.eks-banner-warning` 样式

### 🛡 风险
- 内容指纹可能把"长 base64 编码的内容片段"误判为凭证，引入新 false positive。
  - **缓解**：40 字符阈值 + 字符类数 ≥ 3 + 不含空格三道闸门，自然语言片段不会被误判。
- 备份文件占用 vault 空间（每写一次多一个 .bak）。
  - **缓解**：默认开启但提供 `backupTasksOnSave` 设置项可关；用户可定期手动清理 .bak。

### 🔍 验证步骤
1. `node --check main.js` 通过
2. 在 settings 里加任意长字符串到某条任务的 progress.message，刷新 dashboard → 确认 banner 显示
3. 把 tasks.json 改坏再触发处理 → 看到 `tasks.json.bak.{ts}.json` 被自动创建
4. 在 dashboard prompt 输入 `{"foo":"bar"}` → 被白名单拒绝

---

## v1.3.0 — 2026-07-15 P0 合规：diag.log 移出 vault + 上传前确认 + 版本号对齐

### 🔒 上传源文件到 MinerU/PaddleOCR 之前要二次确认（审核报告 S-04）
之前调用 `extractDocumentWithApis` 直接上传源文件到云端，没有给用户任何反悔的机会。审核报告把这点列为严重风险（涉及保密与数据外发合规）。

**改**：
- 入口处通过 `globalThis.__eksUploadConfirm` 弹一个 `UploadConfirmModal`（Obsidian Modal 子类），显示**文件名 / 大小 / 目标解析器**，必须点"确认上传"才会真正发请求。
- 加 setting `confirmUploads`（默认 `true`）。自动流水线场景可关闭。
- 弹窗里有个"本次会话不再重复询问"的勾选框，避免每个文档都弹一次。
- 用户取消 → 返回 `status: 'cancelled'`，任务被记入 dashboard 异常汇总但不算失败。

### 📂 diag.log 默认写到 vault 之外（审核报告 S-03）
之前 diag.log 落在 `.obsidian/plugins/engineering-knowledge-slicer/diag.log`，会被 iCloud / OneDrive / Git 同步反复上传。

**改**：
- 默认路径改为 `~/.eks/logs/diag.log`（跨 vault 同步，避开 vault 同步工具的扫描与冲突）。
- 加 setting `diagLogInVault`（默认 `false`）。需要本地看的话，勾上回退到 vault 内路径，重启插件后生效。
- 设置页"打开诊断日志"按钮：vault 内路径走 `openLinkText`；vault 外走 `electron.shell.openPath` 用系统默认编辑器打开（macOS 文本编辑器、Windows 记事本等）。

### 🔢 版本号三处对齐（审核报告 S-07）
之前 `manifest.json` = 1.2.0，但 `package.json` 还停在 1.1.2，`settingsVersion` 11，三处对不上。手工改易遗漏。

**改**：
- `manifest.json` `1.2.0` → `1.3.0`
- `package.json` `1.1.2` → `1.3.0`
- `DEFAULT_SETTINGS.settingsVersion` `11` → `12`（加了 `diagLogInVault` / `confirmUploads` 两个新 key，迁移路径自动加默认值）
- `migrateSettings` 同步把目标 `settingsVersion` 改成 12
- `data.json` 升级时会自动用 DEFAULT_SETTINGS 里的新 key 兜底（已有逻辑）

### 📜 添加 LICENSE 文件（审核报告 S-06）
- 新增 `LICENSE`（标准 MIT），与 `package.json` 的 `"license": "MIT"` 声明对齐
- Obsidian 插件市场推荐有 LICENSE 文件供社区参考

### ❌ m-07（cardFromMarkdown/validateCard 死代码）— 维持现状
- 这两个函数实际被 `approveDraft` 路径（dashboard 草稿审批按钮）使用，删除会破坏交互。
- 决定保留并在审核回复里说明。**该条不计入本次改动。**

### 🔍 验证步骤
1. `node --check main.js` 通过
2. 加载插件后，settings 顶部"诊断日志"显示新路径 `~/.eks/logs/diag.log`
3. 切到 vault 外部文件，触发任意 OCR 解析，会弹上传确认窗
4. 取消上传 → 任务标 cancelled，进异常汇总
5. 点"打开诊断日志" → 系统文本编辑器打开

### 🛡 风险
- 上传确认弹窗是**同步阻塞**的，自动化脚本（Obsidian 命令面板批量任务）会被卡住等待点击。给 setting 提供了 `confirmUploads: false` 关闭。
- diag.log 移出 vault 后，跨设备调试时需要 SSH 同步 `~/.eks/logs/`，已写在弹窗描述里。

---

## v1.2.0 — 2026-07-14 dashboard 清失败列表 + 设置/审核加交互按钮

### 🧹 处理概览去掉失败/跳过原因提示
之前的 dashboard 会在底部显示 "失败/跳过原因：xxx（N 次）；yyy（M 次）" 这种聚合统计。当批次跑空（任务跳过 vs 失败混在一起），这一行又长又占空间，每次刷新都跳出来干扰。用户视角下大部分情况下看到的是任务尚在跑、或者上一轮跑完还没新任务，这行就一直在那儿。

**改**：dashboard 不再渲染这行。改为只保留数据收集逻辑 + 写一条 `[EKS diag] dashboard.exceptions.summary` 到 diag.log。如果要看全部异常汇总，进审核工作台点"查看异常详情"。

### 📂 设置页加"打开诊断日志"按钮
考虑到大部分用户没有 DevTools（v1.1.7 反馈），在 **SlicerSettingTab 顶部**加一个 Setting 区块：
- 名称：诊断日志
- 描述：写入路径 + 用法提示
- 按钮：**打开诊断日志**（高亮）
- 点击行为：把绝对路径转为 vault 相对路径（`.obsidian/plugins/engineering-knowledge-slicer/diag.log`），调用 `app.workspace.openLinkText` 直接在 Obsidian 里打开文件；如果文件不存在则自动创建空文件再打开。

### 🔍 审核工作台"查看异常详情"按钮
每个审核整组下加一个 **查看异常详情** 按钮，点击展开一个 Obsidian Modal：
- 标题：异常详情 · {group.label}
- 元数据：源文档路径、库、目录、整组原因
- 列表：每条异常原子一个 block，显示
  - 序号 + 标题 + atom_id
  - 单条原因
  - 可信度分数 + decision
  - 摘要（最多 240 字符）
- 操作：**打开源文档**（如果 vault 里有的话）+ **关闭**

只读视图，不在这里改数据。改的动作还在 `整组批准入库 / 批量修正标签 / 仅重做知识原子 / 整组丢弃` 那一排。

### ⚙ 版本号
- `DEFAULT_SETTINGS.settingsVersion` 10 → **11**
- `manifest.json` 版本 1.1.10 → **1.2.0**

---

## v1.1.10 — 2026-07-14 diag 真正接通 + AI 输出截断兜底

### 🔴 diag 真正接通（v1.1.9 修复不完整的部分）
v1.1.9 只初始化 `globalThis.__eksDiag.state`，但 `function diag / keyFingerprint / flushDiagLog / forceFlushDiag` 仍然留在 main.js 的本地闭包里。ai-pipeline.js 的 wrapper 调到 `globalThis.__eksDiag.diag(...)` 时找不到真函数 → 静默不调用（不是 ReferenceError）。如果 main.js 模块求值前某些路径触发，则可能 ReferenceError。

v1.1.10 修复：
- 顶层加占位 fallback（`console.log` 而不抛错）：`globalThis.__eksDiag.diag = console-log fallback`
- main.js 的真实 `function diag / keyFingerprint / flushDiagLog / forceFlushDiag` 定义完成后**显式 attach 到 `globalThis.__eksDiag`**
- ai-pipeline.js 的本地 wrapper 直接委托 `globalThis.__eksDiag.diag(...)`，保证总能找到真函数，永远不会再 `ReferenceError: diag is not defined`

### 🟡 AI 输出截断兜底（atomizeSummary）
8192 token 上限命中时，原代码会让整个任务报失败。v1.1.10 对应 `summarizeDocument` 的同款处理：
- 单批 AI 调用截断 → 标记 truncated，中断剩余批次
- 已成功的批次合并成 partial 结果，返回时跳过严格 schema 校验
- 每个 atom 至少含 `atom_id` 才保留，截断的那批如果完全空白也保留（标 `_truncated: true` 标记）
- `<vault>/.obsidian/plugins/engineering-knowledge-slicer/diag.log` 会写一行 `atomization.truncated` 表明触发了截断

效果：12 个知识点的文档如果第 9 批被截断，前面 8 批的可入库卡片不再全部丢失；用户能直接看到 8 张已生成。

### 📝 Prompt 加 explicit shape 约束
AI 经常忘了 `{atoms:[...], coverage:{...}, schema_version:"1.1"}` 的包裹，裸返回 atom 数组或单个 atom 对象。v1.1.10 给 `atomizeSummaryBatch` prompt 加**强约束**：
```
【输出包裹格式（严格）】必须直接返回一个 JSON 对象，禁止用 Markdown 代码围栏，
禁止外层再套一层数组或对象。该对象的 keys 只能出现以下三个：atoms、coverage、schema_version。
示例：{"atoms":[...],"coverage":{...},"schema_version":"1.1"}
```

### ⚙ 版本号
- `DEFAULT_SETTINGS.settingsVersion` 9 → **10**
- `manifest.json` 版本 1.1.9 → **1.1.10**

---

## v1.1.9 — 2026-07-14 diag 跨模块作用域修复

### 🔴 修了两个 v1.1.8 残留的报错

**1. `ReferenceError: diag is not defined`**

v1.1.6 在 `src/core/ai-pipeline.js` 模块（main.js bundle 内 line 3928-4609）里加了 3 个 `diag()` 调用（`minimax.timeout` / `minimax.transport` / `minimax.http`），但 **ai-pipeline.js 是和 main.js 各自独立的 IIFE 闭包模块** —— main.js 模块里 `function diag` 对它**词法不可见**。v1.1.8 暴露了这个 bug：用户一触发请求失败路径，ai-pipeline 的 catch handler 调用 `diag(...)` 就 throw `ReferenceError`。

**修复**：把共享状态（`__diagLogPath` / `__diagBuffer` / `__diagFlushTimer`）和 `diag` / `keyFingerprint` / `flushDiagLog` / `forceFlushDiag` 全部搬到 `globalThis.__eksDiag`。`ai-pipeline.js` 顶部加两个一行的本地 wrapper（`function diag` 委托到 `globalThis.__eksDiag.diag`），保持 main.js 现有 16 处 diag 调用源代码 0 改动。共享缓冲写同一个 diag.log 文件。

**历史背景**：这是 v1.1.3 / v1.1.5 修过的**同款 scope 错第二次出现**（当时是 `normalizeUnicodeForm`）。修法也保持同款：用 `globalThis` 当跨模块的"全局黑板"，本地 wrapper 收敛。

**2. `TypeError: object is not iterable`（疑似 heartbeat 触发空迭代）**

v1.1.8 新增 `refreshProgressOnly()` 给心跳用，每秒一次迭代 `this.app.workspace.getLeavesOfType(...)`。如果在 Obsidian 还没完全就绪（如 view 还没 open）的瞬间心跳触发，`getLeavesOfType` 可能拿到异常值。

**修复**：`refreshProgressOnly` 加防御：
- `if (!this.app || !this.app.workspace || typeof this.app.workspace.getLeavesOfType !== 'function') return;`
- 叶子数组也用 `|| []` 兜底
- 单 leaf.refreshProgress 也包 try/catch
- 整个方法外再包一层 try/catch，确保心跳自身永不炸插件

### ⚙ 版本号
- `DEFAULT_SETTINGS.settingsVersion` 8 → **9**
- `manifest.json` 版本 1.1.8 → **1.1.9**

---

## v1.1.8 — 2026-07-14 实时进度条

### 📊 进度条 UI
用户反馈「知识原子化调用 MiniMax 已经 18 分钟了，想知道进度」—— 这是因为：
- `requestWithContract` 只在每次 AI 请求**前**和**修复重试前**各 emit 一次 progress
- 一个原子化批次（1-3 个知识点）通常 20-60 秒，期间零信号，UI 冻住
- AI 请求是 batch 模式，等整个响应回来再处理

v1.1.8 给出三件东西：
- **HTML5 `<progress>` 元素**（带主题适配 CSS，跨 Obsidian 浅色/深色主题可读）
- **批次进度**「原子化：5/12」直观的批次计数器
- **ETA 估算**「预计剩余 3 分 20 秒」（根据已用时 + 已完成批数推算）

### ⏱ 心跳刷新
- 新增 `startProgressHeartbeat(plugin, task, startedAt)`，1 秒一次 `setInterval`
- 心跳调用新增的 `refreshProgressOnly(task)` 轻量级刷新：**只更新 DOM 属性，不写盘、不重渲染整个 dashboard**
- 心跳启动/停止打 `[EKS diag] heartbeat.start` / `heartbeat.stop`，便于排障
- `processTask` 末尾 `finally` 块清理 heartbeat，即使异常也不会泄漏

### 🔀 智能进度路由
`onProgress` 回调改为：
- **关键节点**（`batchComplete: true` 或 `stage` 切换）→ 走 `setTaskProgress`（写盘 + 重渲染）
- **其余中间回调**（每批开始、chunk 进度、attempt 重试）→ 走 `refreshProgressOnly`（只刷 DOM）
- 拆细原子化批次：默认 `maxPointsPerRequest: 1`（之前是 1-3），12 个知识点变成 12 次 API 调用而非 4-12 次，每批之间都能刷进度

### 🎨 新增辅助
- `computeEtaText(progress)` —— 根据 batchIndex/batchTotal/elapsedMs 计算剩余时间字符串
- `refreshProgress(task)` —— SlicerDashboardView 新方法，只更新 `.eks-progress-bar` 和 `.eks-task-meta.elapsed` 文本
- `refreshProgressOnly(task)` —— Plugin 新方法，分发到所有 dashboard 视图的 `refreshProgress`

### ⚙ 版本号
- `DEFAULT_SETTINGS.settingsVersion` 7 → **8**
- `manifest.json` 版本 1.1.7 → **1.1.8**

### 🔧 回滚
如果拆分批次后总耗时变长（确实会变长一点，因为多 N-3N 个 API 请求的开销），只需在设置里把 `maxPointsPerRequest` 调到 2 或 3 即可。心跳和进度条 UI 是纯增量，可以独立保留。

### ❌ 不在本版本范围
- **SSE 流式接收**：架构改动太大，留给 v1.2
- **服务端 token 计数显示**：MiniMax API 响应里有 `usage` 字段但本次不读取

---

## v1.1.7 — 2026-07-14 诊断日志写入文件

### 📄 文件版诊断日志
用户反馈无法打开 Obsidian DevTools（Ctrl+Shift+I），v1.1.6 的 console-only 诊断日志拿不到。v1.1.7 改为同时把诊断日志**写入文件**：

- 路径：`<vault>/.obsidian/plugins/engineering-knowledge-slicer/diag.log`
- 文件包含自解释 header（告诉用户这个文件是干什么的、怎么用）
- 每次 diag 调用入缓冲区，**1 秒后批量 flush**，避免每条诊断都同步 IO 卡 UI
- 文件大小自动 trim 到最近 **2000 行**，避免无限增长
- 卸载插件时 `forceFlushDiag()` 确保最后一批日志落盘
- 首次加载时用 `Notice` 告知用户文件位置（用 `__diagLogNotifiedVersion` 字段避免每次启动都骚扰）
- 密钥指纹规则保持：所有带 `key/token/secret/password` 字段名的字符串值自动转 `fp:xxxxxxxx` 指纹

### 📋 用户排查 SOP（v1.1.7 路径）
1. 触发一次扫描或点一次"测试 PaddleOCR 连接"
2. 在 Obsidian 里打开 `<vault>/.obsidian/plugins/engineering-knowledge-slicer/diag.log` 文件
3. 全文选中 → 复制 → 发给我

### ⚙ 版本号
- `DEFAULT_SETTINGS.settingsVersion` 6 → **7**
- `manifest.json` 版本 1.1.6 → **1.1.7**

---

## v1.1.6 — 2026-07-14 诊断日志增强（v1.1.5 hotfix 续）

### 🔬 全面接入 `[EKS diag]` 诊断日志
用户在 v1.1.5 hotfix 后报告"提示了另一个报错"，因截图文字渲染不可靠，无法精确定位根因。v1.1.6 改为**主动暴露诊断信号**，让用户在 DevTools Console 里 grep `[EKS diag]` 一行就能定位：

- `diag(scope, payload)` 统一输出入口，输出形如 `[EKS diag] minimax.timeout {"endpoint":"...","timeoutMs":300000,"stage":"classification"}`
- `keyFingerprint(value)` 计算 sha256 前 8 字符指纹，**任何带 key/token/secret 的字段在诊断日志里自动转成指纹**，绝不泄露原值
- `loadSecretsFile` 加载后立即报告：文件路径、大小、各字段指纹（empty / fp:xxxxxxxx）
- `onload` 报告 effective 状态：三个密钥指纹 + 三个 endpoint + useEnvKeys 开关
- `testServiceConnection` 每个分支都打点：`start` / `noKey` / `noFetch` / `response` / `auth` / `error`
- `requestMiniMaxJson` 三类失败都打点：`timeout` / `transport` / `http`，每条都带 endpoint + stage + status + 服务端响应前 500 字符
- `processTask` 失败时打 `processTask.failed` 带 sourcePath + stage + errorClass + errorMessage

### 🪧 错误显示更明确
- `Notice` "工程知识切片处理失败：…" 改为 "工程知识切片处理失败（**stage**）：…"，避免被截图终端渲染误导
- `testServiceConnection` 401/403 时把**服务端响应前 200 字符**直接拼到错误信息里，让截图也能看到关键错误

### ⚙ 版本号
- `DEFAULT_SETTINGS.settingsVersion` 5 → **6**
- `manifest.json` 版本 1.1.3 → **1.1.6**

### 📋 用户排查 SOP
1. 触发一次"测试 PaddleOCR 连接"或一次扫描
2. 打开 Obsidian DevTools（Ctrl+Shift+I / Cmd+Opt+I）
3. Console 面板顶部过滤框输入：`[EKS diag]`
4. 把过滤后的日志复制贴给我，每一行都自带定位信息
5. 99% 一次对话就能定位根因并修掉

---

## v1.1.3 — 2026-07-14 编码 / 二进制乱码根治

### 🔒 错误信息不再泄密（F1）
- `sanitizeSecret` 重写，原正则只匹配 `sk-*`，无法遮蔽 MiniMax、PaddleOCR、MinerU、Bearer JWT、URL `?api_key=` 等形态。现改为四段组合：
  - `Bearer <token>`、`sk-…` / `sk_…` / `key-…`
  - URL 中的 `token=`、`access_token=`、`api_key=`、`apikey=`、`password=`、`secret=`
  - 32 字符以上 + 紧邻 `key/token/secret` 上下文的字面长串
- 同时 `sanitizeError` 调用点回归到 `sanitizeSecret`，统一遮蔽规则。

### 🛡 二进制文件不再被当文本送 AI（F2 + F6）
- `decodeTextBuffer` 在 BOM / UTF-16 检测之前增加 **NUL 字节防线**：
  含 NUL 且不属于合法 UTF-8/UTF-16 BOM 上下文的缓冲区直接返回 `binary-rejected`，让上游走 `failed` 分支而不是把 PDF/ZIP/图片字节流送进 AI。
- 解码结束后增加 **最低自信度兜底**（`DECODE_MIN_CONFIDENCE = -0.15`）：
  当所有候选编码评分都低于阈值时返回 `low-confidence`，避免"挑出最不坏"的乱码文本。
- 单元测试覆盖：UTF-8 长中文、UTF-8 BOM、GBK、Shift-JIS、PDF 含 NUL、ZIP 含 NUL、空 buffer、随机短字节、emoji 中文混合，均按预期分类。

### 🔧 路径与文本规范化（F4）
- 新增 `normalizeUnicodeForm(value)`：先做 NFC 规范化（防 macOS NFD vs Windows NFC 失配），再剥离不可见控制字符，统一全角空格为半角空格。
- `processTask` 入口、`migrateTaskLedgerV3`、`isInIntake` / `isInternalSlicerFile` 全部统一调用 `normalizeUnicodeForm` 后再比较路径。
- 老任务里 `source_path` 字段空值 / NUL / 控制字符都会被规范化掉，减少"找不到源文件"的报错。

### 🧱 健壮性（F3 + F5）
- `processTask` 入口断言 `current.source_path` 不为空，否则抛"源文件路径为空"明确信息，而非后续 NPE。
- 新增 `safeBufferFrom(input, encoding)` 助手：统一处理 `null`、`undefined`、`Buffer`、`ArrayBuffer`、`TypedArray`、`string`、`其他` 这 7 种输入形态，避免 multipart / uploadBody 路径上 Buffer 构造在边缘输入下崩溃。

### ⚙ 版本号
- `DEFAULT_SETTINGS.settingsVersion` 4 → 5；
- `manifest.json` 版本 1.1.2 → 1.1.3。

### 🐞 Hotfix — 2026-07-14
- **跨 bundle 模块作用域修复 (v1.1.5)**：v1.1.3 / v1.1.4 把 `normalizeUnicodeForm` **错误地**落在 `src/core/task.js` bundle 模块内部（line 1987）。`"src/core/task.js"` 是 IIFE 内独立作用域模块，**Plugin class** 所在的 `main.js` bundle 模块里的方法（`processTask`、`isInIntake`、`isInternalSlicerFile`）词法作用域看不到它，于是运行时仍报 `normalizeUnicodeForm is not defined`。
- v1.1.5 修复：
  1. 在 `main.js` bundle 模块顶部（与 `loadSecretsFile` / `RateLimiter` 同级，plugin class 闭包可见）添加**权威定义**（line 46）。
  2. 删除原 task.js 模块内的误导性副本（line 2003）。
  3. `src/core/migration.js` 模块内的同款副本（line 3172）保留——`migration.js` 是独立 bundle 模块，必须自带定义才能被 `migrateTaskLedgerV3` 看到。
- **最终可达性**：8 处 `normalizeUnicodeForm` 引用全部可解析——6 处在 `main.js` 模块内 → 走 line 46 的主定义；2 处在 `src/core/migration.js` 模块内 → 走 line 3172 的模块内副本。

---

## v1.1.2 — 2026-07-14 升级正确性修复

### 🔴 升级一致性
- **`DEFAULT_SETTINGS` 与 `migrateSettings` 真正落地 v1.1.1 数值**：自动入库门槛 0.85 → **0.9**、并发 1 → **3**、`aiChunkSize` 6000 → **8000**、`aiMaxChunks` 60 → **100**、`pdfExternalTimeoutMs` 5min → **10min**、`aiRequestTimeoutMs` 3min → **5min**。
- 新增 `rateLimitMs / rateLimitMaxConcurrent / useEnvKeys / aiRequestMaxAttempts / aiRetryBaseMs` 默认值，老用户升级时一次性补齐。
- 老用户的 `autoApproveConfidenceThreshold` 自动升级到 0.9（保留主动调至 < 0.85 的偏好），并发 < 2 升到 3，超时 ≤ 旧默认的升到新默认。

### 🔒 启动时序
- `onload` 中 `saveData` 移到 `loadSecretsFile()` 注入之后，避免在密钥未注入时把空字段先写盘造成"看似无密钥"的伪装缺失。
- 密钥读取受 `useEnvKeys` 开关控制，用户可在 UI 中关闭回落到 UI 输入模式。

### 🧹 仓库整理
- 删除孤儿源码目录 `src/`、`src-disabled-20260708132426/`（main.js 是自包含 bundle，运行不依赖这些源码）。
- 新增 `.gitignore`、`README.md`、`package.json`，方便后续接 GitHub Actions 与本地构建。

---

## v1.1.1 — 2026-07-13 安全与稳定性修复

### 🔴 安全修复
- **密钥外部化**：API 密钥不再明文存储在 data.json 中（OneDrive 同步目录）。密钥迁移至 `~/.eks-secrets.json`（用户主目录，不同步）。插件启动时自动读取。
  - MiniMax API Key
  - MinerU JWT Token
  - PaddleOCR API Key
- data.json 中三个密钥字段已清空，新增 `useEnvKeys: true` 标记

### 🔴 编码修复
- manifest.json：修复中文 name 和 description 乱码（原文件编码为 GBK 导致 UTF-8 读取异常）
- data.json：修复所有中文路径乱码（intakePath、outputPath 等 11 个字段）

### 🟡 稳定性改进
- `maxConcurrentDocuments`: 1 → 3（支持并发处理）
- `aiChunkSize`: 6000 → 8000（减少大文档截断风险）
- `aiMaxChunks`: 60 → 100（最大处理量 80 万字符）
- `pdfExternalTimeoutMs`: 300000 → 600000（OCR 超时 5min → 10min）
- `aiRequestTimeoutMs`: 180000 → 300000（AI 请求超时 3min → 5min）
- `autoApproveConfidenceThreshold`: 0.85 → 0.9（提高自动入库门槛）

### 🟡 速率限制
- 新增 `RateLimiter` 类（intervalMs + maxConcurrent 双重控制）
- 新增 `rateLimitMs: 1000` 和 `rateLimitMaxConcurrent: 2` 配置项
- 任务间自动插入速率延迟，防止 API 限流

### 🟢 体验改进
- 500 任务上限触发时显示明确提示，告知用户剩余任务需再次运行
- 新增「回滚最近一批卡片」命令（命令面板搜索"回滚"）
- PaddleOCR 脚本先检测 CLI/API 可用性再执行，避免无谓等待
- pdf_extract.py 新增 total_pages 返回和更友好的提示信息

### ⚠️ 已知问题
- `src-disabled-20260708132426` 为旧源码归档，与当前 main.js 不完全对应（新增 7 个模块源码未保留）
- 回滚功能仅支持删除已入库文件，暂不支持恢复 MOC 索引

### 📁 密钥配置说明
密钥文件位置：`C:\Users\fu.lixiang\.eks-secrets.json`
```json
{
  "minimaxApiKey": "你的 MiniMax API Key",
  "pdfMineruApiKey": "你的 MinerU JWT Token",
  "pdfPaddleOcrApiKey": "你的 PaddleOCR API Key"
}
```
如需更换密钥，直接编辑此文件后重启 Obsidian 即可。
