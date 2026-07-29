# 本地解析与 `block_v0`

`block_v0` 是解析器与 AI 总结之间的宽松、版本化合同。旧 `parsePackage.markdown/pages/provenance` 字段继续保留；新解析器可同时提供 `blocks` 和 `block_packs`，因此旧缓存与旧调用方仍可读。

- 稳定身份由源 SHA-256、顺序、locator 与原始文本生成。每块区分 `raw` 与 `inferred`，并明确 `present / missing / unsupported / extraction_failed`。
- MSG 默认走本地 CFB/MAPI 只读适配器，不上传。适配器限制文件、FAT/miniFAT 链、流、附件和文本规模；坏链与未知属性按块降级。查询 token 在进入产物前脱敏。
- PDF 先做确定性的本地页清单。启用本地 OCR 后只把 scanned/mixed 页交给 `local_ocr_v1`，native/blank 页分别计数并跳过；关闭、未配置或探测失败时仍返回 `PDF_OCR_PROVIDER_REQUIRED`。任何本地路径都不会改变 `pdfAllowExternalUpload`。
- packing 先合并短原子块，只有单块超过硬 token 预算时才拆分；拆片继承完整 provenance locator。诊断指标包括输入块、拆分块、输出包、最大 token 和 locator 覆盖率。
- marketing、unsubscribe、tracking 与 remote asset 保留在 provenance，但 `card_eligible=false`。PDF 中印章/签名的“可见性”与“审批状态”分离，未验证视觉信息不能自动形成批准结论。

默认值：`localMsgAdapterEnabled=true`、`localPdfInventoryEnabled=true`、`blockV0PackingEnabled=true`、`localOcrEnabled=false`、`localOcrProvider=auto`、`localOcrLanguages=chi_sim+eng`、`localOcrConcurrency=2`、`localOcrTimeoutMs=120000`、`localOcrQualityThreshold=0.72`、`pdfAllowExternalUpload=false`。升级时本地 OCR 明确迁移为关闭，不会因机器上恰好存在引擎而开始处理或外传。

## 本地 OOXML（DOCX / XLSX）

`localDocxAdapterEnabled=true` 与 `localXlsxAdapterEnabled=true` 默认开启。两者使用内置安全 ZIP/XML 层，不读取临时目录、不加载 Office、不联网，也不引入发布时依赖。中央目录、entry 路径、压缩算法和声明大小会在解压前验证；默认限制为 4096 entries、256 MiB 压缩总量、768 MiB 声明/实际解压总量、128 MiB 单 entry、200 倍压缩比、64 MiB 单 XML、128 层 XML 深度、800 万文本字符。加密、ZIP64、多磁盘、DTD/实体、traversal、畸形 relationship/XML 和中止均返回稳定 `OOXML_*` code。

DOCX locator 形如 `word/document.xml#section=1/p=4` 或 `word/document.xml#table=2/row=3/cell=1`；XLSX locator 形如 `xl/worksheets/sheet1.xml#sheet=1/cell=B7`。所有输出 blocks（包括 image metadata 和不可制卡 provenance）都必须有 locator。公式保存于 `metadata.formula`，缓存值独立保存于 `metadata.cached_value`；缺失缓存保持 missing，绝不计算或发明结果。合并区域的非 anchor cell 只记录继承关系与 header，不把 anchor 的值写入其 raw value。

若本地适配器关闭、包不支持或解析失败，只在既有显式外传授权成立时尝试 MinerU；否则直接返回 typed error 与 `external_upload_required=true`，不会绕过确认。有效空文档返回 `review_required / OOXML_NO_ELIGIBLE_CONTENT`，而不是伪造正文。

## 本地 OCR provider 合同

`auto` 会优先使用 PATH 中已安装的 Tesseract；插件不下载模型或依赖。`executable` 只接受可解析、可执行的绝对文件，使用 `spawn(executable, args, {shell:false})` 调用：

发布仍是标准 Obsidian 三文件安装：`main.js`、`manifest.json`、`styles.css`。`src/local-ocr.js` 是仓库内的构建源，`npm run build` 会验证它已确定性嵌入 `main.js` 的 `src/core/local-ocr.js` 内部模块；插件运行时不读取 `src/`、`scripts/` 或 `node_modules`。

```text
<executable> --input <临时 PNG> --page <页码> --languages <语言> --format json
```

标准输出必须是单个 JSON 对象：

```json
{
  "language": "chi_sim+eng",
  "blocks": [{
    "text": "摘录",
    "confidence": 0.96,
    "bbox": [10, 20, 300, 60],
    "language": "chi_sim",
    "visual_type": ""
  }]
}
```

`visual_type` 可为 `stamp`、`signature` 或 `approval_visual`，这些 block 始终 `card_eligible=false`。provider 可附带 `raw_fields` 与 `inferred`，两者分开保存。标准错误仅限诊断且被截断，不记录源正文、临时文件路径或完整 executable 路径。

页级 checkpoint 键包含 source hash、页码、provider、provider version 和设置 fingerprint。读取时重新验证合同、来源、页码、版本、fingerprint、文本与置信度边界；损坏、超限或错配产物按 cache miss 处理。设置质量门槛、语言、DPI 或限制变化会自然失效，旧任务与卡片无需迁移。

默认硬限制为 500 页、单页 24 MiB/4000 万像素/25 万字符、累计 256 MiB/4 亿像素/200 万字符，并发最多 4。错误码包括 `OCR_UNAVAILABLE`、`OCR_RENDER_FAILURE`、`OCR_TIMEOUT`、`OCR_MALFORMED_OUTPUT`、`OCR_CANCELLED`、`OCR_LIMITS_EXCEEDED`；指标包含请求/完成/原生跳过/空白跳过页数、cache hit/miss、渲染字节与像素、文本量和低置信 block 数。

回归命令：`npm run test:production-slice`。测试只生成内存中的 CFB/PDF fixture，不提交或上传 benchmark 原件。
