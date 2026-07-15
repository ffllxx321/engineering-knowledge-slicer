# 工程知识切片 · 构建与开发

> **v2.1+ 开发约定**

## 单文件 bundle 模式（默认发布形态）

`main.js` 是一个自包含的 CommonJS IIFE bundle（约 5500 行，22 个内嵌模块）。Obsidian 加载的只有这一个文件。优点：

- 零依赖（除 `obsidian` + `electron`），安装即用
- 跨平台无差异（macOS / Windows / Linux 都是同一份 JS）
- 不需要 source map（用户拿到的就是产物）

## 开发模式

```bash
# 安装依赖
npm install

# 监听 main.js 改动（如果你在改 main.js）
npm run dev

# 打包发布版本
npm run build
```

`esbuild.config.mjs` 当前只用于校验 `main.js` 语法（不动产物）。

## 模块组织（main.js 内部 IIFE）

每个模块的入口用注释 `// "src/core/<name>.js": function(...)` 标记。当前模块清单：

| 模块 ID | 大致行号 | 职责 |
|--------|----------|------|
| `obsidian` 适配 | 1-25 | Plugin/ItemView/Modal/Notice 等 obsidian API 解构 |
| 顶层工具函数 | 30-260 | diag / keyFingerprint / redactCredential / flushDiagLog / normalizeUnicodeForm / normalizeVaultPath |
| 工具类 | 264-340 | RateLimiter |
| Plugin class | 295-1300 | 主入口：onload / onunload / scan / processTask / loadTasks / saveTasks / renderQueue |
| `src/core/migration.js` | 1310-1410 | migrateTaskLedgerV3 |
| `src/core/task.js` | 1411-1580 | DEFAULT_SETTINGS / runtimeVersions |
| `src/core/identity.js` | ~4110 | atomFingerprint / sourceIdentity / runIdentity |
| `src/core/pipeline.js` | ~4130 | createTaskRecord |
| `src/core/routing.js` | ~3300 | cardOutputPath / resolveFixedRoute / sanitizeFileName |
| `src/core/markdown-renderer.js` | ~5270 | buildCardRecord / renderKnowledgeCard / renderStructuredSummary |
| `src/core/ai-pipeline.js` | ~4170 | requestMiniMaxJson / summarizeDocument / atomizeSummary |
| `src/core/workflow.js` | ~5400 | runKnowledgeWorkflow |
| `src/core/review-service.js` | ~5530 | groupReviewItems / applyBatchAction |
| `src/core/external-pdf.js` | ~3200 | extractDocumentWithApis |
| `src/core/mineru-api.js` | ~3500 | runMineruApi |
| `src/core/paddleocr-api.js` | ~3650 | runPaddleOcrApi |
| `src/core/extractors.js` | ~2780 | extractTextFromBuffer |
| `src/core/document-parser.js` | ~2700 | documentPlan / createParsePackage |
| `src/core/moc.js` | ~3300 | createFolderIndexMarkdown |
| `src/core/tags.js` | ~2720 | parseTagLibrary / suggestMapIndex / validateCard |
| `src/core/ecosystem.js` | ~3980 | detectEcosystemPlugins |
| `src/core/schema-validator.js` | ~4320 | validateSchema |

## 跨模块通信

- **diag / keyFingerprint** 通过 `globalThis.__eksDiag` blackboard 共享（v1.1.10 起）
- **upload confirm** 通过 `globalThis.__eksUploadConfirm` 桥接（v1.3 起）
- 闭包内函数只对同模块可见；模块间通过 `module.exports` 暴露 + `require()` 引入

## 添加新模块

1. 在 main.js 末尾 `},` 后追加 `"src/core/<name>.js": function(require, module, exports) { ... },`
2. 用 `const { xxx } = require("src/core/<name>.js");` 在需要的地方导入
3. 模块内函数是闭包私有的；要对外暴露的放 `module.exports = { ... }`

## 切 ESM / 真 source split

参考 `CHANGELOG.md` 的 **M-03** 路线。需要在 esbuild.config.mjs 里加 `format: 'esm'` + 加 src/ 多文件 + Obsidian 1.5+ 才支持 ESM plugin。预计 v3.0 单独规划。
