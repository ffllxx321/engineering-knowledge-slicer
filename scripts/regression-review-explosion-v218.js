const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { loadBundleModule } = require('./load-bundle-module.js');
const provenance = loadBundleModule('src/core/provenance.js', { crypto });
const review = loadBundleModule('src/core/review-service.js');
function fixture(blocks) {
  let markdown = ''; const spans = [], evidence_index = {};
  for (const block of blocks) {
    const start = markdown.length; markdown += `${block.text}\n`;
    spans.push({ span_id: block.id, block_id: block.id, page: block.page, start, end: start + block.text.length, text: block.text });
    evidence_index[block.id] = { block_id: block.id, raw_text: block.text, card_eligible: block.eligible !== false,
      locator: { scheme: 'pdf-page', value: String(block.page), page: block.page } };
  }
  return { markdown, evidence_index, provenance: { spans }, blocks: blocks.map((block) => ({
    block_id: block.id, card_eligible: block.eligible !== false, exclusion_reason: block.eligible === false ? 'marketing' : '',
    raw: { text: block.text }, locator: evidence_index[block.id].locator })) };
}
const parsed = fixture([
  { id: 'cn', page: 2, text: '卫生间扶手安装高度应为 850 mm，安装后应进行牢固性检查。' },
  { id: 'jp', page: 3, text: '廊下の有効幅員は 900 mm 以上とし、手すりを連続して設置する。' },
  { id: 'table', page: 4, text: '房间 | 部件 | 最小尺寸\n厨房 | 通道 | 1200 mm\n卧室 | 通道 | 900 mm' },
  { id: 'amb1', page: 5, text: '门口应设置连续扶手，便于老人通行。' },
  { id: 'amb2', page: 6, text: '入口应设置连续扶手，便于老人通行。' },
  { id: 'footer', page: 9, text: '营销邮件 退订 unsubscribe', eligible: false }
]);
const chinese = provenance.reconcileEvidence(parsed, '卫生间扶手安装高度为850 mm，安装后进行牢固性检查。');
assert(chinese.ok && chinese.repaired && chinese.locator.block_id === 'cn' && chinese.locator.page === 2);
assert.strictEqual(chinese.quote, '卫生间扶手安装高度应为 850 mm，安装后应进行牢固性检查。');
assert(provenance.reconcileEvidence(parsed, '廊下の有効幅員は900 mm以上とし、手すりを連続設置する。').ok);
assert(provenance.reconcileEvidence(parsed, '厨房 | 通道 | 1200mm').ok);
assert.strictEqual(provenance.reconcileEvidence(parsed, '入口位置需要连续扶手方便老人通行').ok, false);
const workflow = loadBundleModule('src/core/workflow.js', {
  'src/core/ai-pipeline.js': { classifyDocument: async () => { throw Error('external'); }, summarizeDocument: async () => { throw Error('external'); },
    atomizeSummary: async () => { throw Error('external'); }, validateAtomizationResult: (value) => ({ value, errors: [] }) },
  'src/core/confidence.js': { calculateConfidence: ({ atom }) => ({ score: atom.source.provenance_verified ? .95 : .5,
    decision: atom.source.provenance_verified ? 'auto_ingest' : 'review', components: { evidence: atom.source.provenance_verified ? 1 : 0, atom_quality: 1 },
    hard_rules: atom.source.provenance_verified ? [] : ['逐字证据无法在解析文本中定位'], auto_approve_threshold: .9 }) },
  'src/core/identity.js': { atomFingerprint: (atom) => atom.atom_id },
  'src/core/markdown-renderer.js': { buildCardRecord: ({ atom }) => ({ card_id: `c-${atom.atom_id}` }) },
  'src/core/routing.js': { resolveFixedRoute: () => ({ library: 'business', folder_type: 'guide', output_folder: 'safe' }) },
  'src/core/link-service.js': { findLinkCandidates: () => [], validateRelations: () => ({ valid: [] }) },
  'src/core/reliability.js': loadBundleModule('src/core/reliability.js'), 'src/core/provenance.js': provenance
});
(async () => {
  const exact = '卫生间扶手安装高度应为 850 mm，安装后应进行牢固性检查。';
  const atoms = Array.from({ length: 47 }, (_, i) => ({ atom_id: `a${i}`, title: `要求 ${i}`, library: 'business', folder_type: 'guide',
    content: { statement: i < 13 ? exact : `无法安全匹配的要求 ${i}`, point_ids: [`p${i}`] },
    source: { evidence_quote: i < 13 ? exact : `无法安全匹配的要求 ${i}`, source_locator: i < 13 ? '第2页' : '' }, related_candidates: [] }));
  let calls = 0;
  const result = await workflow.runKnowledgeWorkflow({ parsePackage: Object.assign({ source_path: 'manual.pdf', source_type: 'pdf', quality: { score: 1 }, pages: [{}, {}, {}, {}] }, parsed),
    folderMap: {}, schemas: {}, prompts: {}, classification: { library: 'business', folder_type: 'guide' },
    summary: { document_title: 'fixture', key_points: atoms.map((_, i) => ({ point_id: `p${i}` })) }, atomResult: { atoms },
    sourceHash: 'hash', versions: {}, existingCards: [], validateLabels: () => true, requestJson: async () => { calls++; throw Error('external'); } });
  assert.strictEqual(calls, 0); assert.deepStrictEqual([result.accepted.length, result.review.length], [13, 34]);
  assert.deepStrictEqual(
    [result.metrics.candidateCards, result.metrics.autoApproved, result.metrics.reviewPending, result.metrics.hardRejected, result.metrics.merged],
    [47, 13, 34, 0, 0]
  );
  assert(result.accepted.every((card) => !JSON.stringify(card).includes('marketing')));
  const consolidation = workflow.consolidateAtoms([
    { atom_id: 'd1', title: '卫生间扶手高度', content: { statement: '卫生间扶手高度 850 mm', point_ids: ['p1'] }, source: { source_locator: 'p2' } },
    { atom_id: 'd2', title: '卫生间扶手高度', content: { statement: '卫生间扶手高度 850 mm', point_ids: ['p2'] }, source: { source_locator: 'p2' } },
    { atom_id: 'room', title: '厨房通道宽度', content: { statement: '厨房通道宽度 1200 mm', point_ids: ['p3'] }, source: { source_locator: 'p2' } },
    { atom_id: 'number', title: '卫生间扶手高度', content: { statement: '卫生间扶手高度 900 mm', point_ids: ['p4'] }, source: { source_locator: 'p2' } }]);
  assert.strictEqual(consolidation.metrics.merged, 1); assert.deepStrictEqual(consolidation.atoms[0].content.point_ids, ['p1', 'p2']);
  assert.strictEqual(consolidation.atoms.length, 3);
  const formatted = { Category: '　施工　计划  ', TagL1: ' 适老化 ' };
  workflow.normalizePresentationFields(formatted);
  assert.deepStrictEqual([formatted.Category, formatted.TagL1, formatted.presentation_repairs.length], ['施工 计划', '适老化', 2]);
  assert(review.isApprovalEligible({ status: 'pending', reasons: ['可信度偏低'], validationReport: { hardGateFailures: [] } }));
  assert(!review.isApprovalEligible({ status: 'pending', reasons: ['证据缺失'], validationReport: { hardGateFailures: ['EVIDENCE'], nonOverridableFailures: ['EVIDENCE'] } }));
  const main = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8'), css = fs.readFileSync(path.join(__dirname, '..', 'styles.css'), 'utf8');
  for (const expected of ['reviewer_reason', 'original_failed_soft_gates', '开发诊断', '生成内容', '原文依据', '自动检查', 'migrateReviewArtifact']) assert(main.includes(expected));
  assert(css.includes('.eks-evidence-comparison')); console.log('review explosion regressions passed');
})().catch((error) => { console.error(error); process.exitCode = 1; });
