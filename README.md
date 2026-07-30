# 工程知识切片（Engineering Knowledge Slicer）

> 当前版本 **v2.19.0**（settingsVersion 29）· Obsidian Desktop 1.5.0+ · MIT

通过 **MinerU / PaddleOCR + MiniMax M3**，把工程资料（PDF、Word、PPT、图片、邮件等）批量转化为**中文、可追溯、固定目录归档**的 Obsidian 知识卡片。

## 核心能力

- **端到端流水线**：源文件 → 云端文档解析（MinerU 主 / PaddleOCR 补盲）→ 类型判定 → 结构化总结 → 知识原子化 → 自动入库 / 审核台
- **低成本本地摄取**：DOCX / XLSX / PPTX 默认使用零运行时依赖的本地 OOXML 结构解析；失败或关闭时只有显式外传授权成立才会上传。PDF 可选本地页清单与 OCR，MSG 默认本地只读解析
- **邮件附件闭环（v2.9）**：.eml 的附件保存到 `_attachments/` 并自动入队切片；邮件卡与附件卡互相「[[…]]」双向链接，附件文件→卡片方向由 Obsidian 反向链接面板提供
- **本地文本证据块（v2.14）**：MD / TXT / EML 默认归一化为稳定行定位的 `block_v0`，与 Office、MSG、PDF/OCR 共用 evidence index、结构 packing 和分类抽样；不增加 AI 请求，EML 附件保存与入队语义保持不变
- **固定目录归档**：业务库 / 招投标两条线，由 `组件包/folder-map.json` 唯一路由到 28 个固定目录
- **v2.7 切片引擎**：借鉴 Tencent/WeKnora 的知识点切片思路——文档画像驱动策略选择、标题层级面包屑、受保护区域（表格/代码块/公式）永不切断、小节合并、切片重叠、覆盖校验
- **可信度门槛**：五维加权（解析/类型/证据/结构/原子质量）+ 硬性门槛，低于 `autoApproveConfidenceThreshold`（默认 0.9）的卡片进入审核台
- **Block-native 证据闭环**：本地 DOCX/XLSX/PPTX/MSG 与 PDF/OCR 块使用稳定 `block_id` 贯穿切片、总结、原子和卡片；逐字证据无法回到来源块时只进入审核
- **选择性缓存失效**：解析缓存绑定全部 ingestion 设置与 parser/block 合同；页级 OCR checkpoint 可独立复用，后续阶段仅在输入指纹匹配时恢复
- **进度可观察**：批次进度 + 1 秒心跳计时 + HTML5 进度条，长任务不再「无响应假死」
- **并发 + 限流**：文档级并发（默认 3）+ AI 请求限流器（指数退避、遵循 Retry-After），原子化批次内支持有限并发（默认 2 路）
- **SSE 流式输出（POC）**：可选开启，AI 调用期间逐 token 回显
- **密钥外部化**：API 密钥读取自 `~/.eks-secrets.json`，避免 OneDrive/iCloud 同步泄露
- **诊断报告**：Dashboard 错误详情一键复制结构化脱敏报告（64 KiB JSON 硬上限），优先提交该报告而不是原始日志
- **生产影子评估（v2.13）**：默认关闭；在插件内复用本地解析与已有检查点，以确定性分层队列采集脱敏质量/成本/时延指标，不写卡片、MOC、索引，也不改变任务终态。provider 请求有每次运行硬预算，设为 0 时绝不联网
- **受控结构化写入（未发布）**：仅在高级设置显式开启。Pilot 复用真实 normalized block 和既有 AI 产物生成四类记录的 dry-run 计划，零结构化写入；Cutover 与旧卡 writer 互斥，并通过稳定 ID/路径索引、Phase 3 硬风险、事务 manifest、乐观 hash 与失败恢复后才写两库。
- **诊断日志**：全链路脱敏 diag 日志，默认写到 `~/.eks/logs/diag.log`，保留为本地深度排查兼容入口
- **安全检查点与结构化错误**：阶段产物以 source/pipeline/prompt/schema 指纹校验后复用；错误提供稳定代码、可重试性和建议操作，日志递归脱敏 Header、JWT 和敏感 URL 参数
- **可取消的外部工作**：取消会中止 MiniMax 排队/JSON/SSE 请求以及 MinerU/PaddleOCR 上传、轮询等待和下载，不再等当前远程阶段自然超时
- **任务与错误中心**：状态卡可直接筛选，任务支持文件搜索、状态筛选、阶段时间线和折叠详情；错误按稳定代码分组并显示位置与建议操作
- **增强切片溯源**：在保留旧 `chunk_id` 的同时提供稳定 chunk ID、内容指纹、标题路径、页码范围、token 估算和 overlap 元数据
- **可验证 OCR 来源**：保留解析器实际返回的页/块/行/bbox 与文本偏移；卡片写入前按摘录哈希和区间回查持久化解析产物。纯文本 OCR 明确标注“解析文本级”，不会虚构页码或坐标
- **会话级失败缓存与启动续传（v2.9）**：失败文件在审核工作台显示原因（可重试/移除），重启后自动清空；启动时检测上次中断的任务，可「继续」（断点续传）或「放弃」
- **多语言编码健壮性（v2.9.1）**：自适应字符集探测覆盖 UTF-8 / GBK / EUC-KR（韩文）/ ShiftJIS / Big5 / windows-1252 / 无 BOM UTF-16；ZIP 文件名识别 EFS 标志与 GBK 回退；所有定长截断做代理对安全校正（emoji / 生僻汉字不切坏）——解码侧把文本产出正确，而非检出乱码后拒绝输出

## 仓库结构

```
.
├── manifest.json            # Obsidian 插件元信息
├── main.js                  # 插件主入口（自包含 bundle，24 个内嵌模块，可直接发布）
├── styles.css               # 仪表盘 / 进度条样式
├── data.json                # 插件默认 settings（不含密钥）
├── LICENSE                  # MIT
├── CHANGELOG.md             # 变更记录
├── docs/                    # 技术文档（ESM 可行性分析等）
├── scripts/
│   ├── load-ai-pipeline.js  # 从 main.js 抽取真实 ai-pipeline 模块的共享测试加载器
│   ├── smoke-split.js       # v2.5 切片回归用例（6 例）
│   ├── smoke-splitter-v26.js# v2.7 WeKnora 式切片引擎烟雾测试（21 例）
│   ├── smoke-ratelimit.js   # 限流器烟雾测试
│   ├── smoke-json-repair.js # JSON 修复烟雾测试
│   ├── smoke-diag-fixes.js  # 诊断日志相关修复的回归测试
│   ├── smoke-email-mime.js  # v2.9 MIME 邮件解析 + 附件提取烟雾测试
│   ├── smoke-encoding.js    # v2.9.1 编码根因修复回归（21 例）
│   ├── smoke-v292.js        # v2.9.2 诊断日志三大故障回归（22 例）
│   ├── paddleocr_extract.py # PaddleOCR CLI 包装（开发辅助，不参与运行）
│   └── pdf_extract.py       # PDF 元数据提取（开发辅助，不参与运行）
└── 组件包/
    ├── README.md
    ├── 工程知识切片插件-PRD.md       # 产品需求文档
    ├── 工程知识切片插件-PRD产品审计.md
    ├── Tag_Library.md
    ├── folder-map.json
    ├── schemas/             # 6 份 JSON Schema
    ├── 提示词/              # 00 类型判定 / 01 结构化总结 / 99 知识原子 + 业务库 / 招投标
    └── 模板/                # 静态信息卡片 / 动态事件卡片 / Type Mapping
```

## 安装

1. 把 `manifest.json` / `main.js` / `styles.css` 拷贝到 vault 的 `.obsidian/plugins/engineering-knowledge-slicer/` 目录
2. 在 Obsidian → 设置 → 第三方插件 → 启用「工程知识切片」
3. 命令面板 → 「打开工程知识切片控制台」，按提示填写三大 API 密钥

### 密钥配置（推荐）

在用户主目录新建 `~/.eks-secrets.json`：

```json
{
  "minimaxApiKey": "你的 MiniMax API Key",
  "pdfMineruApiKey": "你的 MinerU JWT Token",
  "pdfPaddleOcrApiKey": "你的 PaddleOCR API Key"
}
```

`useEnvKeys` 开关默认开启，插件启动时自动注入。也可以在 UI 设置面板直接输入；输入值会原子写入同一份 `~/.eks-secrets.json`，不会写入 vault 的 `data.json`。该文件是本地普通凭据文件，不是操作系统安全密钥库。

## v2.7 切片引擎（借鉴 Tencent/WeKnora）

长文档送入 MiniMax 前先切块做 map/reduce 总结。v2.7 把 [WeKnora](https://github.com/Tencent/WeKnora)（`docreader/splitter/splitter.py` + `internal/infrastructure/chunker/`）中与**切片质量和处理效率**直接相关的设计移植到本插件，不引入 ask agent / WIKI 等新功能：

| 机制 | 说明 |
|---|---|
| **文档画像 → 策略选择** | `profileMarkdown` 一次性扫描标题层级分布、表格/代码/公式存在性等结构信号，选择 `heading`（按标题切）/ `heuristic`（按段落安全换行）/ `legacy`（兜底）三条策略 |
| **标题层级面包屑** | 每个切片携带 `breadcrumb` 字段（如 `# 第三章 结构设计\n## 3.2 荷载计算`），总结 prompt 注入「所属章节路径」，证据定位更准；面包屑不塞进正文，保持「拼接即还原原文」 |
| **受保护区域** | 围栏代码块、Markdown 表格、`$$…$$` 块级公式识别为受保护区域，候选切点剔除区域内换行，永不拦腰切断；超长受保护块才硬切 |
| **小节合并** | 同一标题语境下过小的相邻切片自动合并（目标 ≈ 单段上限/2），**直接减少 AI 调用次数**——规范/清单类「一节一句话」文档提速明显；不跨顶级章节混并 |
| **切片重叠** | `chunkOverlapRatio`（默认 0.1）在 flush 后回退到重叠窗口内最近的安全换行切点，段落语境不在切点处断裂；设 0 即关闭 |
| **覆盖校验** | 每次切分后自检「起点升序 / 原文完整覆盖 / 超尺寸告警」，失败打 `splitter.validate` 诊断日志（只告警不阻断） |

## 常用命令

| 命令 ID | 名称 |
|---------|------|
| `open-slicer-dashboard` | 打开工程知识切片控制台 |
| `scan-source-files` | 扫描源文件 |
| `process-next-source-file` | 处理下一个队列文件 |
| `auto-process-source-files` | 自动处理可信卡片 |
| `retry-failed-source-files` | 重试失败任务并自动处理 |
| `rollback-last-batch` | 回滚最近一批卡片 |
| `open-ai-settings` | 打开 AI 设置 |
| `run-shadow-evaluation` | 运行本地影子评估（需先显式启用） |
| `export-shadow-evaluation` | 本地导出影子评估 JSON / Markdown |

## 关键设置项

| 设置 | 默认 | 说明 |
|---|---|---|
| **启动时自动扫描** | 关 | v2.8 新增，开启后每次打开 Obsidian 自动扫描源目录并开始处理；会触发云端解析与 AI 计费，默认关闭，建议手动点「扫描并自动处理」 |
| **生产影子评估** | 关 | 只读候选输出；代表队列按类型/解析器/大小/语言确定性分层，脱敏指标受保留天数与样本数双重限制 |
| **影子 provider 请求预算** | 0 | 单次运行硬上限；0 只允许本地解析与命中已有检查点，远程文档上传始终关闭 |
| **本地 DOCX / XLSX / PPTX 适配器** | 开 | 在本机保留 Office 原生结构，不上传、不调用 AI；本地失败后的云端回退仍受显式外传授权控制 |
| 自动入库置信度门槛 | 0.9 | 低于门槛的卡片进入审核台 |
| 并发处理文档数 | 3 | 同时处理的源文件数 |
| AI 单段字符数 | 12000 | 切块上限（`maxChunkChars`） |
| **切片重叠比例** | 0.1 | v2.7 新增，0–0.5；0 = 关闭重叠 |
| **合并过小切片** | 开 | v2.7 新增，同语境微型切片合并，减少 AI 调用 |
| AI 最大分段数 | 40 | 单文档切块数上限 |
| **每批知识点数** | 3 | v2.6 新增，原子化每批知识点数（1–3） |
| **原子化并发数** | 2 | v2.6 新增，同时进行的原子化批次数（1–3） |
| **短文档卡片异常阈值** | 20 | v2.6 新增，短文档产出卡片数超过该值视为异常 |
| 启用 SSE 流式输出 (POC) | 关 | AI 调用逐 token 回显 |
| 卡住任务判定时间 | — | 无进度超时后标记任务失败 |

## 本地构建与测试（开发用）

`main.js` 是已经构建好的发布版，运行时不需要 `src/`。

```bash
npm install
npm run lint
npm run build      # esbuild → main.js
npm test
npm run benchmark  # 仅测本地编排，不调用付费 API
npm run dev        # 监听模式
```

烟雾测试（不需要 Obsidian，从 main.js 抽取真实模块隔离执行）：

```bash
node --check main.js                 # 语法检查
node scripts/smoke-split.js          # v2.5 切片回归（6 例）
node scripts/smoke-splitter-v26.js   # v2.7 切片引擎（21 例）
node scripts/smoke-ratelimit.js      # 限流器
node scripts/smoke-json-repair.js    # JSON 修复
node scripts/smoke-diag-fixes.js     # 诊断修复回归
node scripts/smoke-email-mime.js     # MIME 邮件解析（v2.9）
node scripts/smoke-encoding.js       # 编码根因修复回归（v2.9.1，21 例）
node scripts/smoke-v292.js           # 诊断日志故障回归（v2.9.2，22 例）
```

## 诊断与排障

- 诊断日志默认写到 vault 之外的 `~/.eks/logs/diag.log`（无法创建时回退到 `.obsidian/plugins/engineering-knowledge-slicer/diag.log`），覆盖切片画像（`splitter.profile`）、切片校验（`splitter.validate`）、AI 请求/限流、密钥指纹等全链路节点，统一脱敏
- 任务失败后，在 Dashboard →「错误」展开任务并点击「复制脱敏诊断报告」。请发送复制出的完整 Markdown/JSON；无需且不应发送源文件、API Key、提示词或原始模型响应。字段与安全边界见 [`docs/error-diagnostics.md`](docs/error-diagnostics.md)
- 时间语义：卡片与用户可见持久记录使用本地日历日期 `YYYY-MM-DD`；任务恢复、产物、回滚、服务测试与诊断日志保留内部精确 ISO instant。旧 ISO 卡片按运行时/配置时区惰性显示，不批量改写。详见 [时间戳策略](docs/timestamp-policy.md)。
- 切片行为异常时先看 `splitter.profile` 确认走了哪条策略（heading / heuristic / legacy）
- 设置面板「诊断日志」开关可控制采集

## 已知限制

- 回滚目前仅删除已入库文件，不恢复 MOC 索引
- PaddleOCR 走云端时不支持 OCR 模型参数调整，使用默认 `PaddleOCR-VL-1.6`
- SSE 流式输出为 POC 状态，MiniMax 接口行为变化时可能回退为整包接收
- 切分结果自 v2.7 起与旧版不再逐字节一致（按标题边界 + 合并 + 重叠重排），artifact 缓存在任务重跑时自动覆盖
- 生产实现仍是自包含 JavaScript bundle；`npm run typecheck` 对新增 JSDoc 契约执行 strict TypeScript 检查，`npm run build` 在临时目录真实打包并断言不改写生产 bundle。
- 发布 ZIP 始终只有 `main.js`、`manifest.json`、`styles.css`，不会携带组件包。用户组件包中的 folder-map、标签库、提示词、模板和业务配置仍是外部且优先；仅当 `schemas/block-v0.schema.json` 或 `schemas/parse-package.schema.json` 缺失时，运行时使用 `main.js` 内与仓库当前规范逐字节一致的兼容副本。已有但无效的文件不会被内置内容掩盖。
- 远端供应商没有公开 cancel endpoint；本地取消会立即停止队列、请求等待和后续轮询。

## 优化与诊断文档

- [优化基线](docs/optimization-baseline.md)
- [工作流性能审计](docs/workflow-performance-audit.md)
- [知识切片差距](docs/knowledge-slicing-gap-analysis.md)
- [错误代码](docs/error-code-reference.md)
- [优化结果与回滚](docs/optimization-results.md)
- [Phase 0–5 与完成标准追踪矩阵](docs/requirements-traceability.md)

## 变更记录

见 [CHANGELOG.md](./CHANGELOG.md)

## 质量门禁

依次运行 `npm ci`、`npm run lint`、`npm run typecheck`、`npm test`、`npm run build`、`npm run benchmark`。
# 可选语义嵌入（v2.16）

插件可在最终卡片成功持久化后，异步调用阿里云百炼 Model Studio 的原生 DashScope 文本嵌入接口。内置提供商 `aliyun-bailian-qwen37` 固定使用北京公共同步端点 `https://dashscope.aliyuncs.com/api/v1/services/embeddings/text-embedding/text-embedding`、模型 `qwen3.7-text-embedding`、1024 维 dense 输出、`document` 文本类型，单请求最多 20 条。默认 Shadow 模式且关闭，必须在设置中明确同意并启用。

正常设置只需填写标准 Model Studio API Key。密钥不会写入 vault 内的 `data.json`、诊断、报告、向量或队列，但会以与 MiniMax/MinerU 相同的最低风险方式持久化到本机用户目录 `~/.eks-secrets.json`，并尽力设置为仅当前用户可读写；这不是操作系统安全密钥库，也不是“不落盘”。内部仍支持 `EKS_EMBEDDING_API_KEY` 环境变量回退。设置页“测试连接”只发送固定隐私中性探针，不使用卡片/文档内容；测试要求先同意，并会产生一次外部配额或可能计费请求。

发送文本固定为标题、分类、标签和规范化主张摘要。源文件/卡片路径、原始证据、秘密、诊断、完整 Markdown 和易变运行数据不会发送。向量只保存在独立版本化 JSON 索引，不写入 Markdown。Shadow 结果仅提供脱敏指标和审核建议，不会自动删除、合并、改状态或写关系。提供“立即运行 / 重建索引 / 清空语义数据”显式控制。

语义后处理不参与解析、OCR、Office 提取、结构切片、分类、原子生成或事实校验。任何配置、网络、鉴权、超时或响应结构错误都只记录稳定脱敏代码并计数，不阻塞或降级卡片入库。
