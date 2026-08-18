'use strict';

const pdfjs = require('vendor/pdfjs.js');
const pdfjsWorker = require('vendor/pdf.worker.js');
const { analyzeText } = require('src/content-integrity.js');

// Electron renderer environments expose browser globals, so PDF.js does not
// automatically select its Node fake worker. Supplying the embedded worker
// handler avoids a URL fetch and keeps the three-file Obsidian install closed.
if (!globalThis.pdfjsWorker) globalThis.pdfjsWorker = pdfjsWorker;

async function extractPdfText(buffer, options = {}) {
  const data = new Uint8Array(Buffer.from(buffer || []));
  const loadingTask = pdfjs.getDocument({
    data,
    disableFontFace: true,
    useSystemFonts: false,
    isEvalSupported: false,
    stopAtErrors: false
  });
  const timeoutMs = Math.max(1000, Number(options.timeoutMs) || 120000);
  let timer;
  try {
    const document = await Promise.race([
      loadingTask.promise,
      new Promise((_, reject) => { timer = setTimeout(() => reject(typed('PDF_JS_TIMEOUT', 'PDF.js 文本提取超时。')), timeoutMs); })
    ]);
    const pages = [];
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const content = await page.getTextContent({ includeMarkedContent: false, disableNormalization: false });
      let line = ''; const lines = []; let lastY = null;
      for (const item of content.items || []) {
        if (!item || typeof item.str !== 'string') continue;
        const y = Number(item.transform?.[5]);
        if (lastY != null && Number.isFinite(y) && Math.abs(y - lastY) > 2 && line.trim()) {
          lines.push(line.trim()); line = '';
        }
        line += `${line && !/^\s|[，。；：、,.!?;:)]/.test(item.str) ? ' ' : ''}${item.str}`;
        if (item.hasEOL && line.trim()) { lines.push(line.trim()); line = ''; }
        if (Number.isFinite(y)) lastY = y;
      }
      if (line.trim()) lines.push(line.trim());
      pages.push({ page: pageNumber, text: lines.join('\n').trim() });
      page.cleanup();
    }
    await document.destroy();
    const text = pages.map((page) => page.text).filter(Boolean).join('\n\n');
    const integrity = analyzeText(text);
    if (!integrity.ok) throw typed('PDF_TEXT_INTEGRITY_FAILED',
      `PDF.js 提取文本不可作为证据：${integrity.reasons.join(',')}。`);
    return { text, pages };
  } finally {
    clearTimeout(timer);
    if (typeof loadingTask.destroy === 'function') await loadingTask.destroy().catch(() => {});
  }
}

function typed(code, message) { const error = new Error(message); error.code = code; return error; }

module.exports = { extractPdfText };
