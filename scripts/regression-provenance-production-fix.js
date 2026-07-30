const assert = require('assert');
const crypto = require('crypto');
const { loadBundleModule } = require('./load-bundle-module');

const block = loadBundleModule('src/core/block-v0.js', { crypto });
const provenance = loadBundleModule('src/core/provenance.js', { crypto });
const parser = loadBundleModule('src/core/document-parser.js', {
  crypto,
  'src/core/block-v0.js': block,
  'src/core/provenance.js': provenance
});

const buffer = Buffer.from('markdown-only-production-regression');
const lines = Array.from({ length: 42 }, (_, index) => `逐字来源条目 ${index + 1}：参数 ${1000 + index} mm。`);
const markdown = lines.join('\n');
const markdownOnly = parser.createParsePackage({
  sourcePath: 'fixture.pdf', buffer, sourceType: 'pdf', parser: 'mineru-api', markdown
});
assert.strictEqual(markdownOnly.blocks.length, 1);
assert.strictEqual(Object.keys(markdownOnly.evidence_index).length, 1);
assert.strictEqual(markdownOnly.blocks[0].locator.scheme, 'parsed-text-span');
assert.strictEqual(markdownOnly.blocks[0].locator.page, undefined, 'must not invent a page');

const blockId = markdownOnly.blocks[0].block_id;
const points = Array.from({ length: 41 }, (_, index) => ({
  point_id: `p-${index + 1}`,
  evidence_quote: lines[index],
  block_id: blockId
}));
const atoms = points.map((point, index) => ({
  atom_id: `a-${index + 1}`, point_ids: [point.point_id],
  evidence_quote: point.evidence_quote, block_id: point.block_id
}));
atoms.push({
  atom_id: 'a-42', point_ids: ['p-41'],
  evidence_quote: lines[41], block_id: blockId
});
const outcomes = atoms.map((atom) => provenance.reconcileEvidence(
  markdownOnly, atom.evidence_quote, { block_id: atom.block_id }
));
assert.strictEqual(points.length, 41);
assert.strictEqual(atoms.length, 42);
assert.strictEqual(outcomes.filter((item) => item.ok).length, 42);
assert.strictEqual(outcomes.filter((item) => item.reason === 'locator_missing').length, 0);
assert(outcomes.every((item) => markdown.includes(item.quote)));

const paged = parser.createParsePackage({
  sourcePath: 'ocr.pdf', buffer: Buffer.from('paged'), sourceType: 'pdf', parser: 'paddleocr-api',
  markdown: '第一页逐字内容\n第二页逐字内容',
  pages: [{ page: 1, text: '第一页逐字内容' }, { page: 2, text: '第二页逐字内容' }]
});
assert.strictEqual(paged.blocks.length, 2);
assert.deepStrictEqual(paged.blocks.map((item) => item.locator.page), [1, 2]);

const normalized = parser.createParsePackage({
  sourcePath: 'ocr.txt', buffer: Buffer.from('normalized'), sourceType: 'text',
  parser: 'text-block-v0', markdown: 'ＡＢＣ\n  １２３ mm'
});
const repaired = provenance.reconcileEvidence(normalized, 'ABC 123 mm');
assert.strictEqual(repaired.ok, true);
assert.strictEqual(repaired.quote, 'ＡＢＣ\n  １２３ mm');
assert.strictEqual(repaired.method, 'normalized-contiguous');

const duplicateBlocks = ['相同逐字证据', '相同逐字证据'].map((text, order) => block.createBlock({
  source_hash: crypto.createHash('sha256').update('duplicate').digest('hex'),
  order, raw_text: text, locator: { scheme: 'row', value: String(order + 1), row: order + 1 }
}));
const duplicatePackage = parser.createParsePackage({
  sourcePath: 'dup.xlsx', buffer: Buffer.from('duplicate'), sourceType: 'xlsx',
  parser: 'xlsx-ooxml-local', markdown: duplicateBlocks.map((item) => item.raw.text).join('\n'),
  blocks: duplicateBlocks
});
assert.strictEqual(provenance.reconcileEvidence(duplicatePackage, '相同逐字证据').reason, 'ambiguous_quote');
assert.strictEqual(provenance.reconcileEvidence(
  duplicatePackage, '相同逐字证据', { block_id: duplicateBlocks[0].block_id }
).ok, true);

const splitBlocks = ['禁止跨块', '拼接证据'].map((text, order) => block.createBlock({
  source_hash: crypto.createHash('sha256').update('split').digest('hex'),
  order, raw_text: text, locator: { scheme: 'message', value: String(order + 1), message: order + 1 }
}));
const splitPackage = parser.createParsePackage({
  sourcePath: 'thread.eml', buffer: Buffer.from('split'), sourceType: 'email',
  parser: 'eml-block-v0', markdown: '禁止跨块\n拼接证据', blocks: splitBlocks
});
assert.strictEqual(provenance.reconcileEvidence(splitPackage, '禁止跨块拼接证据').reason, 'quote_not_found');

console.log('production provenance fix: 41 points -> 42 atoms -> 42 resolved, 0 locator_missing');
