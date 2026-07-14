# 工程知识切片（Engineering Knowledge Slicer）

通过 **MinerU / PaddleOCR + MiniMax M3**，把工程资料（PDF、Word、PPT、图片、邮件等）批量转化为**中文、可追溯、固定目录归档**的 Obsidian 知识卡片。

## 核心能力

- **端到端流水线**：源文件 → 文档解析 → 类型判定 → 结构化总结 → 知识原子 → 自动入库 / 审核台
- **固定目录归档**：业务库 / 招投标两条线，每条线有固定的 intake/output 目录
- **可信度门槛**：`autoApproveConfidenceThreshold`（默认 0.9），低于门槛的卡片进入审核台
- **并发 + 限流**：默认 3 并发，间隔 1s，自带重试退避
- **密钥外部化**：API 密钥读取自 `~/.eks-secrets.json`，避免 OneDrive/iCloud 同步泄露

## 仓库结构

```
.
├── manifest.json            # Obsidian 插件元信息
├── main.js                  # 插件主入口（自包含 bundle，可直接发布）
├── styles.css               # 仪表盘样式
├── data.json                # 插件默认 settings（不含密钥）
├── CHANGELOG.md             # 变更记录
├── scripts/
│   ├── paddleocr_extract.py # PaddleOCR CLI 包装
│   └── pdf_extract.py       # pdf 元数据提取
└── 组件包/
    ├── README.md
    ├── 工程知识切片插件-PRD.md
    ├── 工程知识切片插件-PRD产品审计.md
    ├── 工程知识切片插件-v1.1验收清单.md
    ├── 工程知识切片插件-v1.1重构计划.md
    ├── Tag_Library.md
    ├── folder-map.json
    ├── schemas/             # 6 份 JSON Schema
    ├── 提示词/              # 00/01/99 + 业务库 / 招投标 库
    └── 模板/                # 静态信息卡片 / 动态事件卡片 / Type Mapping
```

## 安装

1. 把 `.obsidian/plugins/engineering-knowledge-slicer/` 拷贝到你 vault 的同名目录
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

## 本地构建（开发用）

`main.js` 是已经构建好的发布版，运行时不需要 `src/`。如果未来要重构为源码开发：

```bash
npm install
npm run build      # esbuild → main.js
npm run dev        # 监听模式
```

## 已知限制

- 回滚目前仅删除已入库文件，不恢复 MOC 索引
- PaddleOCR 走云端时不支持 OCR 模型参数调整，使用默认 `PaddleOCR-VL-1.6`
- 知识原子 schema v1.1 与后续 v1.2 不向下兼容，升级期间请保留历史卡片目录

## 变更记录

见 [CHANGELOG.md](./CHANGELOG.md)
