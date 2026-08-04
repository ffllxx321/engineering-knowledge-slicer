'use strict';

const LOCAL_EXTENSIONS = new Set(['docx', 'xlsx', 'pptx', 'msg', 'eml', 'txt', 'md']);

function extensionOf(filePath) {
  return String(filePath || '').toLowerCase().split('.').pop();
}

function pdfQualityProbe(buffer) {
  const raw = Buffer.from(buffer || []).toString('latin1');
  const pages = Math.max(1, (raw.match(/\/Type\s*\/Page(?!s)\b/g) || []).length);
  const textOperators = (raw.match(/\b(?:BT|Tj|TJ)\b/g) || []).length;
  const images = (raw.match(/\/Subtype\s*\/Image\b/g) || []).length;
  const fonts = (raw.match(/\/(?:Font|ToUnicode)\b/g) || []).length;
  const rotations = (raw.match(/\/Rotate\s+-?\d+/g) || []).length;
  const nativeText = textOperators >= pages && fonts > 0;
  const complexLayout = images > Math.max(2, pages * 2) || rotations > 0;
  return { pages, nativeText, complexLayout, reliableLocal: nativeText && !complexLayout };
}

function qualityOk(result) {
  if (!result || result.status !== 'ok' || !result.parsePackage) return false;
  const markdown = String(result.parsePackage.markdown || result.text || '').trim();
  const eligible = (result.parsePackage.blocks || []).filter((block) => block?.card_eligible !== false && String(block?.raw?.text || '').trim());
  return markdown.length >= 20 && eligible.length > 0 && result.parsePackage.quality?.corruptRatio <= 0.02;
}

class AutoDocumentParser {
  constructor(adapters = {}) { this.adapters = adapters; }

  async parse(filePath, buffer, context = {}) {
    const ext = extensionOf(filePath);
    if (LOCAL_EXTENSIONS.has(ext)) return this.requireQuality(await this.call('local', filePath, buffer, context), 'LOCAL_DOCUMENT_QUALITY_FAILED');
    if (ext !== 'pdf') throw typed('AUTO_PARSER_UNSUPPORTED', `自动识别暂不支持：${ext || 'unknown'}`);

    const probe = (this.adapters.probePdf || pdfQualityProbe)(buffer, context);
    if (probe.reliableLocal) {
      const local = await this.call('localPdf', filePath, buffer, { ...context, probe });
      if (qualityOk(local)) return local;
    }

    let mineruError = null;
    if (context.mineruConfigured === true && context.allowNecessaryCloud === true) {
      try {
        if (typeof context.confirmNecessaryUpload === 'function') {
          const accepted = await context.confirmNecessaryUpload({ filePath, sizeBytes: Number(buffer?.length || 0), reason: 'PDF 文本不足、扫描件或复杂版式' });
          if (!accepted) throw typed('NECESSARY_UPLOAD_DECLINED', '用户未允许本次必要云端识别。');
        }
        const remote = await this.call('mineru', filePath, buffer, { ...context, probe });
        if (qualityOk(remote)) return remote;
        mineruError = typed('MINERU_QUALITY_FAILED', 'MinerU 结果未达到知识生成质量门。');
      } catch (error) { mineruError = error; }
    }

    try {
      const ocr = await this.call('localOcr', filePath, buffer, { ...context, probe, mineruError });
      if (qualityOk(ocr)) return ocr;
    } catch (error) {
      if (!mineruError) mineruError = error;
    }
    throw typed('DOCUMENT_QUALITY_GATE_FAILED', `自动识别失败：MinerU 与本地 OCR 均未产生可核验知识证据。${mineruError ? ` ${mineruError.message}` : ''}`);
  }

  async call(name, filePath, buffer, context) {
    if (typeof this.adapters[name] !== 'function') throw typed('AUTO_PARSER_ADAPTER_UNAVAILABLE', `自动解析适配器不可用：${name}`);
    return this.adapters[name](filePath, buffer, context);
  }

  requireQuality(result, code) {
    if (!qualityOk(result)) throw typed(code, '本地确定性解析结果未达到知识生成质量门。');
    return result;
  }
}

function removedLegacyPdfDispatcher() {
  throw typed('REMOVED_LEGACY_PDF_DISPATCHER', '旧 PDF 引擎顺序/PaddleOCR 生产分支已移除；请使用 AutoDocumentParser。');
}

function typed(code, message) { const error = new Error(message); error.code = code; return error; }

module.exports = { AutoDocumentParser, LOCAL_EXTENSIONS, pdfQualityProbe, qualityOk, removedLegacyPdfDispatcher };
