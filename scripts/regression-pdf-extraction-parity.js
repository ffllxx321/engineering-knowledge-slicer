'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { nativePdfText, selectAndParse } = require('../src/v3/adapters.js');
const { loadBundleModule } = require('./load-bundle-module.js');

const source = (bytes) => ({ path: 'fixtures/screenshot-regression.pdf', name: 'screenshot-regression.pdf',
  extension: 'pdf', bytes: Buffer.from(bytes) });

async function rejected(promise) {
  try { await promise; } catch (error) { return error; }
  throw new Error('expected PDF parse to fail closed');
}

(async () => {
  const screenshotPayload = `%PDF-1.7\n/Type /Page\n/Subtype /Image\nstream\n(${Buffer.alloc(240, 0x41).toString('base64')}) Tj\nendstream\nendobj\nxref\nstartxref`;
  assert.throws(() => nativePdfText(Buffer.from(screenshotPayload)), (error) => error.code === 'V3_UNSAFE_PDF_RAW_TEXT_DISABLED');

  const closed = await rejected(selectAndParse(source(screenshotPayload)));
  assert.strictEqual(closed.code, 'V3_PARSE_FAILED');
  assert(closed.attempts.some((item) => item.adapter === 'pdf-native-probe' && item.status === 'skipped'));
  assert(!closed.attempts.some((item) => item.adapter === 'pdf-native-probe' && item.status === 'succeeded'));

  const bundledPdf = loadBundleModule('src/pdf-text-extractor.js', {
    'vendor/pdfjs.js': require('../node_modules/pdfjs-dist/legacy/build/pdf.js'),
    'vendor/pdf.worker.js': require('../node_modules/pdfjs-dist/legacy/build/pdf.worker.js')
  });
  const { nativeChinesePdf } = require('./acceptance-real.js');
  const valid = await bundledPdf.extractPdfText(nativeChinesePdf());
  assert.match(valid.text, /施工验收要求/);
  assert.match(valid.text, /VAV-50/);

  const restored = await selectAndParse(source(screenshotPayload), {
    cloud: { configured: true, authorized: true, parse: async () => '施工图要求：防水层厚度不得小于 1.5 mm，并按检验批验收。' },
    ocr: { available: true, parse: async () => { throw new Error('cloud result should win'); } }
  });
  assert.strictEqual(restored.result.parser_provenance.selected_parser, 'pdf-cloud');
  assert.match(restored.result.markdown, /1\.5 mm/);

  const fallback = await selectAndParse(source(screenshotPayload), {
    cloud: { configured: true, authorized: true, parse: async () => '%PDF-1.7 stream /Filter /DCTDecode endstream xref' },
    ocr: { available: true, parse: async () => 'OCR 证据：安全检查每周至少执行 1 次。' }
  });
  assert.strictEqual(fallback.result.parser_provenance.selected_parser, 'pdf-local-ocr');
  assert(fallback.attempts.some((item) => item.adapter === 'pdf-cloud' && item.status === 'failed'));
  assert(fallback.attempts.some((item) => item.adapter === 'pdf-local-ocr' && item.status === 'succeeded'));

  const main = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
  const start = main.indexOf('extractReliableLocalPdf(filePath, buffer)');
  const end = main.indexOf('\n  async getPluginFilePath', start);
  const productionPdfShortcut = main.slice(start, end);
  assert(start >= 0 && end > start, 'production PDF gate must remain inspectable');
  assert(productionPdfShortcut.includes('extractPdfText(buffer'),
    'production must use the bundled cross-platform PDF.js extractor before cloud/OCR fallback');
  assert(!productionPdfShortcut.includes('pdftotext') && !productionPdfShortcut.includes('child_process'),
    'production PDF extraction must not depend on a system executable');
  assert(productionPdfShortcut.includes('createParsePackage({'),
    'native PDF text must cross the same parse-package/evidence boundary');
  assert(productionPdfShortcut.includes('PDF_NATIVE_TEXT_UNAVAILABLE'),
    'empty native extraction must retain a typed fallback outcome');
  assert(!productionPdfShortcut.includes('matchAll('), 'production must not scrape raw PDF Tj/TJ operands');
  assert(main.includes('PDF_TEXT_INTEGRITY_FAILED'),
    'the bundled extractor must reject corrupt native text before returning a parse package');
  assert(main.includes('vendor/pdfjs.js') && main.includes('src/pdf-text-extractor.js') && main.includes('"vendor/pdf.worker.js"'),
    'the shipped single-file plugin must embed PDF.js, its fake-worker runtime, and its adapter');
  const realGateStart = main.indexOf('async runV3RealObsidianGateProbe()');
  const realGateEnd = main.indexOf('\n  async v3GateWrite', realGateStart);
  const realGate = main.slice(realGateStart, realGateEnd);
  assert(realGate.includes("path.endsWith('.pdf') ? { ocr:"), 'real-host gate must exercise the OCR fallback');
  assert(!realGate.includes('deterministic local extraction'), 'real-host gate must not bless raw PDF object scraping');

  console.log('PDF extraction parity and screenshot regression: PASS');
})().catch((error) => { console.error(error); process.exitCode = 1; });
