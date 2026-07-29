const assert = require('assert');
const crypto = require('crypto');
const { loadBundleModule } = require('./load-bundle-module');
const { loadAiPipeline } = require('./load-ai-pipeline');
const confidence = loadBundleModule('src/core/confidence.js');
const task = loadBundleModule('src/core/task.js', { crypto, path: require('path') });
const blocks = loadBundleModule('src/core/block-v0.js', { crypto });
const { api: ai } = loadAiPipeline();
const quote = '结构设计要求采用可靠连接方式并完成复核。';
const input = (threshold) => ({
  parsePackage: { markdown: quote, quality: { score: 0.8 } },
  classification: { model_confidence: 1, alternatives: [] },
  atom: { title: '结构设计连接要求', content: { statement: quote }, source: {
    source_link: '[[source]]', source_locator: 'paragraph:1', parent_summary: '[[summary]]', evidence_quote: quote
  }},
  schemaValid: true, routeValid: true, labelsValid: true, duplicate: false,
  autoApproveConfidenceThreshold: threshold
});
assert.equal(confidence.calculateConfidence(input(0.85)).decision, 'auto_ingest');
assert.equal(confidence.calculateConfidence(input(0.90)).decision, 'auto_ingest');
assert.equal(confidence.calculateConfidence(input(0.96)).decision, 'review');
assert.equal(confidence.normalizeAutoApproveThreshold(-1), 0.7);
assert.equal(confidence.normalizeAutoApproveThreshold(9), 1);
assert.equal(confidence.normalizeAutoApproveThreshold('bad'), 0.9);
assert.equal(task.migrateSettings({ autoApproveConfidenceThreshold: 0.85 }).autoApproveConfidenceThreshold, 0.85);
assert.equal(task.migrateSettings({ autoApproveConfidenceThreshold: 1.7 }).autoApproveConfidenceThreshold, 1);

const sourceHash = crypto.createHash('sha256').update('cross-layer-fixture').digest('hex');
for (const [sourceType, kind] of [['docx', 'paragraph'], ['xlsx', 'table_cell'], ['pptx', 'slide_title'], ['outlook-msg', 'message_body'], ['pdf', 'ocr_text']]) {
  const raw = `${sourceType} 结构证据用于质量闭环验证。`;
  const block = blocks.createBlock({ source_hash: sourceHash, order: 0, kind, raw_text: raw, locator: { scheme: sourceType, value: 'fixture:1' } });
  const packed = blocks.packBlocks([block], { hardBudget: 1000 });
  assert.deepStrictEqual(packed.packs[0].block_ids, [block.block_id]);
  const parsePackage = { source_type: sourceType, parser: `${sourceType}-fixture`, markdown: raw, blocks: [block], block_packs: packed.packs,
    evidence_index: { [block.block_id]: { block_id: block.block_id, locator: block.locator, raw_text: raw, card_eligible: true } } };
  const summary = ai.normalizeSummaryReduce({ evidence: [{ evidence_id: 'e1', quote: raw, block_id: block.block_id }], coverage: { chunk_ids: ['c1'], complete: true } }, ['c1'], parsePackage);
  assert.equal(summary.evidence[0].provenance.block_id, block.block_id);
  const unverifiable = ai.normalizeSummaryReduce({ evidence: [{ evidence_id: 'bad', quote: '来源中不存在的证据', block_id: block.block_id }],
    coverage: { chunk_ids: ['c1'], complete: true } }, ['c1'], parsePackage);
  assert.equal(unverifiable.evidence[0].provenance_resolution.reason, 'BLOCK_EVIDENCE_UNVERIFIED');
  assert.equal(unverifiable.evidence[0].locator, '');
  const atoms = ai.normalizeAtomBatch({ atoms: [{ atom_id: `a-${sourceType}`, title: `${sourceType} 证据`, library: 'business', folder_type: 'project',
    content: { statement: raw, point_ids: ['p1'] }, source: {}, model_confidence: 1 }], coverage: { point_ids: ['p1'], complete: true } },
  { key_points: [{ point_id: 'p1', content: raw, evidence_ids: ['e1'] }], evidence: summary.evidence }, ['p1']);
  assert.equal(atoms.atoms[0].source.source_provenance.block_id, block.block_id);
}
const structured = ai.classificationSample({ markdown: 'fallback', blocks: [
  blocks.createBlock({ source_hash: sourceHash, order: 2, kind: 'body', raw_text: '正文代表块', locator: { scheme: 'docx', value: 'p2' } }),
  blocks.createBlock({ source_hash: sourceHash, order: 1, kind: 'heading', raw_text: '关键标题', locator: { scheme: 'docx', value: 'h1' } }),
  blocks.createBlock({ source_hash: sourceHash, order: 3, kind: 'table_header', raw_text: '列A | 列B', locator: { scheme: 'xlsx', value: 'r1' } })
]}, 1000);
assert(structured.indexOf('关键标题') < structured.indexOf('列A | 列B'));
assert(structured.includes('正文代表块'));
const main = require('fs').readFileSync(require('path').join(__dirname, '..', 'main.js'), 'utf8');
assert(main.includes("extracted.status === 'review_required' && extracted.parsePackage"));
assert(main.includes("kind: 'review_required'"));
assert(main.includes("fingerprintVersion: 'parsed-input-v1'"));
assert(main.includes("isPageOcrCheckpoint ? { checkpointContract: 'local-ocr-v1' }"));
assert(main.includes("parsedInputFingerprint: name === 'parsed' || isPageOcrCheckpoint ? ''"));
console.log('block-native quality closure regression passed');
