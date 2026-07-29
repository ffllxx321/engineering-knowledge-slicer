'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { loadBundleModule } = require('./load-bundle-module');
const {
  LocalOcrError, normalizeOcrResult, probeLocalOcr, runLocalPdfOcr, settingsFingerprint
} = loadBundleModule('src/core/local-ocr.js', {
  crypto: require('crypto'),
  fs: require('fs'),
  os: require('os'),
  path: require('path'),
  child_process: require('child_process')
});
const localOcr = {
  LocalOcrError, normalizeOcrResult, probeLocalOcr, runLocalPdfOcr, settingsFingerprint
};

const fake = path.join(__dirname, 'fixtures', 'fake-local-ocr.js');
const sourceHash = crypto.createHash('sha256').update('synthetic-pdf').digest('hex');
const basePages = [
  { page: 1, classification: 'native', rotation: 0, image_locators: [] },
  { page: 2, classification: 'blank', rotation: 0, image_locators: [] },
  { page: 3, classification: 'scanned', rotation: 90, image_locators: [{ scheme: 'pdf-image', value: 'p3' }] }
];
const rendered = { path: '/tmp/fake page.png', bytes: 1024, width: 100, height: 200 };

async function expectCode(code, fn) {
  try { await fn(); } catch (error) {
    assert(error instanceof LocalOcrError, `expected LocalOcrError, got ${error}`);
    assert.strictEqual(error.code, code);
    return error;
  }
  assert.fail(`expected ${code}`);
}

async function run(settings = {}, extra = {}) {
  return runLocalPdfOcr({
    pdfBuffer: Buffer.from('%PDF synthetic'),
    pages: basePages,
    sourceHash,
    settings: Object.assign({
      enabled: true, provider: 'executable', executable: fake,
      languages: 'chi_sim+eng', concurrency: 2, timeoutMs: 2000, qualityThreshold: 0.72
    }, settings),
    ...extra
  }, { renderPage: async () => rendered });
}

async function main() {
  fs.chmodSync(fake, 0o755);

  const disabled = await probeLocalOcr({ enabled: false, provider: 'auto' });
  assert.strictEqual(disabled.available, false, 'disabled provider must be unavailable');
  const missing = await probeLocalOcr({ enabled: true, provider: 'executable', executable: '/definitely/missing/ocr' });
  assert.strictEqual(missing.available, false, 'missing executable must be unavailable');

  const probe = await probeLocalOcr({ enabled: true, provider: 'executable', executable: fake });
  assert.strictEqual(probe.available, true);
  assert.strictEqual(probe.provider, 'executable');
  assert(path.isAbsolute(probe.executable));

  const result = await run();
  assert.strictEqual(result.status, 'ok');
  assert.strictEqual(result.metrics.pages_requested, 1);
  assert.strictEqual(result.metrics.pages_skipped_native, 1);
  assert.strictEqual(result.metrics.pages_skipped_blank, 1);
  assert.strictEqual(result.pages[0].rotation, 90);
  assert.deepStrictEqual(result.pages[0].blocks[0].locator.image_locator, { scheme: 'pdf-image', value: 'p3' });
  assert.strictEqual(result.pages[0].blocks[0].card_eligible, true, 'high-confidence OCR text is eligible');
  assert.strictEqual(result.pages[0].blocks[1].visual_type, 'stamp');
  assert.strictEqual(result.pages[0].blocks[1].card_eligible, false, 'stamp visibility never proves approval');
  assert.strictEqual(result.pages[0].blocks[1].exclusion_reason, 'unverified_stamp');
  assert.strictEqual(result.pages[0].blocks[2].card_eligible, false, 'low-confidence text is excluded');
  assert.strictEqual(result.pages[0].blocks[2].exclusion_reason, 'low_confidence_ocr');

  const injectionMarker = '/tmp/eks-local-ocr-shell-injection';
  fs.rmSync(injectionMarker, { force: true });
  await run({ languages: `eng;touch${injectionMarker}` });
  assert.strictEqual(fs.existsSync(injectionMarker), false, 'arguments must never be shell-interpolated');

  await expectCode('OCR_TIMEOUT', () => run({ languages: 'timeout', timeoutMs: 1000 }));
  await expectCode('OCR_MALFORMED_OUTPUT', () => run({ languages: 'malformed' }));
  await expectCode('OCR_LIMITS_EXCEEDED', () => run({ limits: { maxPixelsPerPage: 10000 } }));

  const controller = new AbortController();
  const cancelled = run({ languages: 'timeout', timeoutMs: 10000 }, { signal: controller.signal });
  setTimeout(() => controller.abort(), 50);
  await expectCode('OCR_CANCELLED', () => cancelled);

  const checkpoints = new Map();
  let renderCalls = 0;
  const deps = { renderPage: async () => { renderCalls += 1; return rendered; } };
  const checkpointInput = {
    pdfBuffer: Buffer.from('%PDF synthetic'), pages: basePages, sourceHash,
    settings: { enabled: true, provider: 'executable', executable: fake, languages: 'eng', timeoutMs: 2000 },
    loadCheckpoint: async (key) => checkpoints.get(key),
    saveCheckpoint: async (key, value) => checkpoints.set(key, value)
  };
  await runLocalPdfOcr(checkpointInput, deps);
  assert.strictEqual(renderCalls, 1);
  const resumed = await runLocalPdfOcr(checkpointInput, deps);
  assert.strictEqual(renderCalls, 1, 'valid checkpoint must avoid page work');
  assert.strictEqual(resumed.metrics.cache_hits, 1);

  const corruptKey = [...checkpoints.keys()][0];
  checkpoints.set(corruptKey, { contract: 'corrupt' });
  await runLocalPdfOcr(checkpointInput, deps);
  assert.strictEqual(renderCalls, 2, 'corrupt checkpoint must be rejected');

  const changedSettings = Object.assign({}, checkpointInput, {
    settings: Object.assign({}, checkpointInput.settings, { qualityThreshold: 0.9 })
  });
  await runLocalPdfOcr(changedSettings, deps);
  assert.strictEqual(renderCalls, 3, 'settings fingerprint change must invalidate checkpoint');
  assert.notStrictEqual(settingsFingerprint(checkpointInput.settings), settingsFingerprint(changedSettings.settings));

  assert.throws(() => normalizeOcrResult({ nope: true }, basePages[2], { languages: 'eng', qualityThreshold: 0.7 }), /blocks/);

  const block = loadBundleModule('src/core/block-v0.js', { crypto });
  const provenance = loadBundleModule('src/core/provenance.js', { crypto });
  const parser = loadBundleModule('src/core/document-parser.js', {
    crypto, 'src/core/provenance.js': provenance
  });
  let externalCalls = 0;
  const extractor = loadBundleModule('src/core/extractors.js', {
    'src/core/document-parser.js': parser,
    'src/core/block-v0.js': block,
    'src/core/local-ocr.js': localOcr,
    'src/core/external-pdf.js': {
      extractDocumentWithApis: async () => {
        externalCalls += 1;
        return { status: 'failed', message: 'external upload disabled' };
      }
    }
  });
  const scanPdf = Buffer.from('%PDF-1.7\n1 0 obj <</Type /Page /Rotate 90 /Resources <</XObject <</Im0 2 0 R>>>>>>\n2 0 obj <</Subtype /Image /Width 1 /Height 1>>');
  const localExtracted = await extractor.extractTextFromBuffer('scan.pdf', scanPdf, {
    pdfExtractor: { allowExternalUpload: false },
    localOcr: { enabled: true, provider: 'executable', executable: fake, languages: 'eng', qualityThreshold: 0.72 },
    localOcrDependencies: { renderPage: async () => rendered },
    blockPacking: { hardBudget: 100 }
  });
  assert.strictEqual(localExtracted.status, 'ok', 'pure scan must continue locally when OCR is available');
  assert.strictEqual(externalCalls, 0, 'local scan success must not upload or call remote provider');
  assert(localExtracted.parsePackage.blocks.some((item) => item.kind === 'ocr_text' && item.card_eligible));
  assert(localExtracted.parsePackage.blocks.some((item) => item.kind === 'stamp' && !item.card_eligible));
  assert(localExtracted.parsePackage.block_packs.length > 0, 'structure-first packs must be created');
  assert(localExtracted.parsePackage.provenance.spans.length > 0, 'OCR quote locators must remain resolvable');

  const gated = await extractor.extractTextFromBuffer('scan.pdf', scanPdf, {
    pdfExtractor: { allowExternalUpload: false },
    localOcr: { enabled: false },
    blockPacking: { hardBudget: 100 }
  });
  assert.strictEqual(gated.status, 'ocr_required');
  assert.strictEqual(gated.actionable.code, 'PDF_OCR_PROVIDER_REQUIRED');
  assert.strictEqual(externalCalls, 1, 'unavailable local OCR preserves existing remote gate evaluation');
  console.log('Local OCR regressions passed');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
