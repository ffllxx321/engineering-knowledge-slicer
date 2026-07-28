const assert = require('assert');
const crypto = require('crypto');
const { loadBundleModule } = require('./load-bundle-module.js');
const { loadAiPipeline } = require('./load-ai-pipeline.js');

const provenance = loadBundleModule('src/core/provenance.js', { crypto });
const confidence = loadBundleModule('src/core/confidence.js');

const miner = provenance.normalizeOcrArtifact([
  { page_idx: 0, block_id: 'title', text: '施工方案', bbox: [10, 20, 100, 40] },
  { page_idx: 0, block_id: 'b7', line_id: 'l2', text: '混凝土强度为 C30。', bbox: [10, 50, 200, 75] }
], 'mineru');
assert.strictEqual(miner.pages[0].page, 1);
assert.strictEqual(miner.spans[1].block_id, 'b7');
assert.deepStrictEqual(miner.spans[1].bbox, [10, 50, 200, 75]);

const paddle = provenance.normalizeOcrArtifact([
  { page: 2, rec_texts: ['钢筋保护层 35 mm'], rec_boxes: [[1, 2, 30, 8]] }
], 'paddle');
assert.strictEqual(paddle.spans[0].page, 2);
assert.deepStrictEqual(paddle.spans[0].bbox, [1, 2, 30, 8]);

function pkg(artifact, parser = 'mineru-api') {
  return {
    parser,
    markdown: artifact.markdown,
    pages: artifact.pages,
    provenance: { version: '1.0', spans: artifact.spans }
  };
}

let resolved = provenance.resolveEvidence(pkg(miner), '混凝土强度为 C30。');
assert(resolved.ok);
assert.strictEqual(resolved.locator.page, 1);
assert.strictEqual(resolved.locator.block_id, 'b7');
assert.strictEqual(resolved.locator.precision, 'region');
assert(provenance.verifyLocator(pkg(miner), '混凝土强度为 C30。', resolved.locator).ok);

const textOnly = provenance.normalizeLegacyArtifact('OCR 纯文本证据：允许回溯。', [], 'paddleocr-api');
resolved = provenance.resolveEvidence(pkg(textOnly, 'paddleocr-api'), 'OCR 纯文本证据：允许回溯。');
assert(resolved.ok);
assert.strictEqual(resolved.locator.precision, 'parsed-text');
assert(!Object.hasOwn(resolved.locator, 'page'), 'text-only OCR must not invent a page');
assert(resolved.label.includes('解析文本级'));

const repeated = provenance.normalizeLegacyArtifact('重复证据。\n中间。\n重复证据。', [], 'paddleocr-api');
assert.strictEqual(provenance.resolveEvidence(pkg(repeated), '重复证据。').reason, 'ambiguous_quote');
const second = provenance.resolveEvidence(pkg(repeated), '重复证据。', { occurrence: 2 });
assert(second.ok && second.locator.occurrence === 2);
assert(second.locator.text_start > 0);

const normalized = provenance.normalizeLegacyArtifact('全角ＡＢＣ　 施工', [], 'paddleocr-api');
assert(provenance.resolveEvidence(pkg(normalized), '全角ABC 施工').ok, 'NFKC and whitespace differences must resolve');
const exact = provenance.resolveEvidence(pkg(normalized), '全角ABC 施工');
assert.strictEqual(normalized.markdown.slice(exact.locator.text_start, exact.locator.text_end), '全角ＡＢＣ　 施工',
  'resolved offsets retain the exact extractive OCR spelling');

const twoPages = provenance.normalizeOcrArtifact([
  { page: 1, blocks: [{ block_id: 'p1', text: '甲'.repeat(120) }] },
  { page: 2, blocks: [{ block_id: 'p2', text: '乙'.repeat(120) }] }
], 'mineru');
const chunks = loadAiPipeline().api.splitMarkdownSections(twoPages.markdown, {
  maxChars: 130,
  coalesceTiny: false,
  provenance: { spans: twoPages.spans }
});
assert(chunks.some((chunk) => chunk.pageStart === 1));
assert(chunks.some((chunk) => chunk.pageStart === 2));
assert(chunks.every((chunk) => Number.isInteger(chunk.sourceStart) && Number.isInteger(chunk.sourceEnd)));

const legacy = provenance.normalizeLegacyArtifact('旧数据仍可精确匹配。', undefined, 'paddleocr-api');
assert.strictEqual(legacy.pages.length, 0);
assert(provenance.resolveEvidence(pkg(legacy), '旧数据仍可精确匹配。').ok);

const nativePackage = {
  markdown: '# 原生 Markdown\n原生证据保持有效。',
  quality: { score: 1 }
};
const nativeConfidence = confidence.calculateConfidence({
  parsePackage: nativePackage,
  classification: { model_confidence: 1, alternatives: [] },
  atom: {
    title: '原生证据',
    content: { statement: '原生证据保持有效。' },
    source: {
      source_link: '[[native.md]]',
      source_locator: '原生章节',
      evidence_quote: '原生证据保持有效。',
      parent_summary: '[[summary]]'
    }
  },
  routeValid: true,
  labelsValid: true,
  schemaValid: true,
  duplicate: false
});
assert(!nativeConfidence.hard_rules.includes('逐字证据无法在解析文本中定位'));

assert.strictEqual(provenance.resolveEvidence(pkg(textOnly), '确实不存在的证据').reason, 'quote_not_found');
const tampered = Object.assign({}, resolved.locator, { quote_hash: '0000000000000000' });
assert.strictEqual(provenance.verifyLocator(pkg(textOnly), 'OCR 纯文本证据：允许回溯。', tampered).reason, 'quote_hash_mismatch');

console.log('OCR provenance regressions passed');
