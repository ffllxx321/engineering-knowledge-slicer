# 工程知识切片（Engineering Knowledge Slicer）

> 当前版本 **v2.9.0**（settingsVersion 17）· Obsidian Desktop 1.5.0+ · MIT

通过 **MinerU / PaddleOCR + MiniMax M3**，把工程资料（PDF、Word、PPT、图片、邮件等）批量转化为**中文、可追溯、固定目录归档**的 Obsidian 知识卡片。

## 核心能力

- **端到端流水线**：源文件 → 云端文档解析（MinerU 主 / PaddleOCR 补盲）→ 类型判定 → 结构化总结 → 知识原子化 → 自动入库 / 审核台
- **邮件附件闭环（v2.9）**：.eml 的附件保存到 `_attachments/` 并自动入队切片；邮件卡与附件卡互相「[[…]]」双向链接，附件文件→卡片方向由 Obsidian 反向链接面板提供
- **固定目录归档**：业务库 / 招投标两条线，由 `组件包/folder-map.json` 唯一路由到 28 个固定目录
- **v2.7 切片引擎**：借鉴 Tencent/WeKnora 的知识点切片思路——文档画像驱动策略选择、标题层级面包屑、受保护区域（表格/代码块/公式）永不切断、小节合并、切片重叠、覆盖校验
- **可信度门槛**：五维加权（解析/类型/证据/结构/原子质量）+ 硬性门槛，低于 `autoApproveConfidenceThreshold`（默认 0.9）的卡片进入审核台
- **进度可观察**：批次进度 + 1 秒心跳计时 + HTML5 进度条，长任务不再「无响应假死」
- **并发 + 限流**：文档级并发（默认 3）+ AI 请求限流器（指数退避、遵循 Retry-After），原子化批次内支持有限并发（默认 2 路）
- **SSE 流式输出（POC）**：可选开启，AI 调用期间逐 token 回显
- **密钥外部化**：API 密钥读取自 `~/.eks-secrets.json`，避免 OneDrive/iCloud 同步泄露
- **诊断日志**：全链路脱敏 diag 日志，默认写到 `~/.eks/logs/diag.log`
- **会话级失败缓存与启动续传（v2.9）**：失败文件在审核工作台显示原因（可重试/移除），重启后自动清空；启动时检测上次中断的任务，可「继续」（断点续传）或「放弃」

## 仓库结构

```
.
├── manifest.json            # Obsidian 插件元信息
├── main.js                  # 插件主入口（自包含 bundle，23 个内嵌模块，可直接发布）
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

`useEnvKeys` 开关默认开启，插件启动时自动注入。也可以在 UI 设置面板直接输入（会落到 `data.json`，请勿放入同步目录）。

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

## 关键设置项

| 设置 | 默认 | 说明 |
|---|---|---|
| **启动时自动扫描** | 关 | v2.8 新增，开启后每次打开 Obsidian 自动扫描源目录并开始处理；会触发云端解析与 AI 计费，默认关闭，建议手动点「扫描并自动处理」 |
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
npm run build      # esbuild → main.js
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
```

## 诊断与排障

- 诊断日志默认写到 vault 之外的 `~/.eks/logs/diag.log`（无法创建时回退到 `.obsidian/plugins/engineering-knowledge-slicer/diag.log`），覆盖切片画像（`splitter.profile`）、切片校验（`splitter.validate`）、AI 请求/限流、密钥指纹等全链路节点，统一脱敏
- 切片行为异常时先看 `splitter.profile` 确认走了哪条策略（heading / heuristic / legacy）
- 设置面板「诊断日志」开关可控制采集

## 已知限制

- 回滚目前仅删除已入库文件，不恢复 MOC 索引
- PaddleOCR 走云端时不支持 OCR 模型参数调整，使用默认 `PaddleOCR-VL-1.6`
- SSE 流式输出为 POC 状态，MiniMax 接口行为变化时可能回退为整包接收
- 切分结果自 v2.7 起与旧版不再逐字节一致（按标题边界 + 合并 + 重叠重排），artifact 缓存在任务重跑时自动覆盖

## 变更记录

见 [CHANGELOG.md](./CHANGELOG.md)
