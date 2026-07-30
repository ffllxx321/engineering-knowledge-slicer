const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { loadBundleModule } = require('./load-bundle-module.js');

const provenance = loadBundleModule('src/core/provenance.js', { crypto });
const reliability = loadBundleModule('src/core/reliability.js');
const review = loadBundleModule('src/core/review-service.js');
const workflow = loadBundleModule('src/core/workflow.js', {
  'src/core/ai-pipeline.js': {
    classifyDocument: async () => { throw new Error('PROVIDER_FORBIDDEN'); },
    summarizeDocument: async () => { throw new Error('PROVIDER_FORBIDDEN'); },
    atomizeSummary: async () => { throw new Error('PROVIDER_FORBIDDEN'); },
    validateAtomizationResult: (value) => ({ value, errors: [] })
  },
  'src/core/confidence.js': {
    calculateConfidence: ({ atom }) => ({
      score: atom.source.provenance_verified ? 0.95 : 0.5,
      decision: atom.source.provenance_verified ? 'auto_ingest' : 'review',
      components: { evidence: atom.source.provenance_verified ? 1 : 0, atom_quality: 1 },
      hard_rules: atom.source.provenance_verified ? [] : ['逐字证据无法在解析文本中定位'],
      auto_approve_threshold: 0.9
    })
  },
  'src/core/identity.js': { atomFingerprint: (atom) => atom.atom_id },
  'src/core/markdown-renderer.js': { buildCardRecord: ({ atom }) => ({ card_id: `card-${atom.atom_id}`, title: atom.title }) },
  'src/core/routing.js': { resolveFixedRoute: () => ({ library: 'business', folder_type: 'record', output_folder: 'safe' }) },
  'src/core/link-service.js': { findLinkCandidates: () => [], validateRelations: () => ({ valid: [] }) },
  'src/core/reliability.js': reliability,
  'src/core/provenance.js': provenance
});

function parsedFixture(blocks) {
  let markdown = '';
  const spans = [];
  const evidence_index = {};
  for (const block of blocks) {
    const start = markdown.length;
    markdown += `${block.text}\n`;
    const locator = Object.assign({ scheme: 'line', value: String(spans.length + 1) }, block.locator || {});
    spans.push({ span_id: block.id, block_id: block.id, start, end: start + block.text.length, text: block.text });
    evidence_index[block.id] = {
      block_id: block.id, raw_text: block.text, locator, metadata: block.metadata,
      card_eligible: block.eligible !== false
    };
  }
  return {
    source_path: 'heterogeneous-source', source_type: 'text', markdown, evidence_index,
    provenance: { spans }, pages: [{}],
    blocks: blocks.map((block) => ({
      block_id: block.id, raw: { text: block.text }, locator: block.locator || {},
      metadata: block.metadata || {}, card_eligible: block.eligible !== false
    }))
  };
}

const parsed = parsedFixture([
  { id: 'manual', text: 'If pressure exceeds 2.5 MPa, stop the pump unless the bypass valve is open.' },
  { id: 'ocr', text: '検査間隔は 30 日 とする。', metadata: { section: '保守' } },
  { id: 'table', text: 'A-17 | 6.0 kg | 2026-07-20', metadata: { sheet: 'Inventory', range: 'A2:C2', headers: ['Item', 'Mass', 'Received'] } },
  { id: 'email', text: 'Please submit the signed record by 17:00 UTC.', metadata: { thread_id: 't1', message_id: 'm2', subject: 'Audit follow-up', from: 'ops@example.invalid' } },
  { id: 'footer', text: 'unsubscribe · tracking pixel', eligible: false }
]);

const manual = provenance.reconcileEvidence(parsed, 'If pressure exceeds 2.5MPa, stop the pump unless the bypass valve is open.');
assert(manual.ok && manual.quote === parsed.evidence_index.manual.raw_text);
assert(provenance.reconcileEvidence(parsed, '検査間隔は30日とする。').ok);
const table = provenance.reconcileEvidence(parsed, 'A-17 | 6.0kg | 2026-07-20');
assert(table.ok && table.context.table.headers.includes('Mass'));
const email = provenance.reconcileEvidence(parsed, 'Please submit the signed record by 17:00UTC.');
assert(email.ok && email.context.message.thread_id === 't1');
assert.strictEqual(provenance.reconcileEvidence(parsed, 'tracking pixel policy').ok, false);

const merged = workflow.consolidateAtoms([
  { atom_id: 'a', title: 'Pump shutdown', content: { statement: 'If pressure exceeds 2.5 MPa, stop the pump unless bypass is open.', point_ids: ['p1'] }, source: { source_locator: 'manual' } },
  { atom_id: 'b', title: 'Pump shutdown', content: { statement: 'If pressure exceeds 2.5 MPa, stop the pump unless bypass is open.', point_ids: ['p2'] }, source: { source_locator: 'manual' } },
  { atom_id: 'c', title: 'Pump shutdown', content: { statement: 'If pressure exceeds 3.0 MPa, stop the pump unless bypass is open.', point_ids: ['p3'] }, source: { source_locator: 'manual' } },
  { atom_id: 'd', title: 'Pump permission', content: { statement: 'If pressure exceeds 2.5 MPa, the pump may continue when bypass is open.', point_ids: ['p4'] }, source: { source_locator: 'manual' } },
  { atom_id: 'footer', title: 'unsubscribe', content: { statement: '' }, source: { source_locator: 'footer' } }
]);
assert.strictEqual(merged.metrics.merged, 1, 'compatible paraphrases should merge');
assert.deepStrictEqual(merged.atoms[0].content.point_ids, ['p1', 'p2'], 'many points must map to one card');
assert(merged.atoms.some((atom) => atom.atom_id === 'c'), 'conflicting numbers must remain separate');
assert(merged.atoms.some((atom) => atom.atom_id === 'd'), 'different modality must remain separate');
assert.strictEqual(merged.metrics.dropped_no_knowledge, 1, 'isolated footer noise must be rejected');

(async () => {
  const exact = parsed.evidence_index.manual.raw_text;
  const atoms = Array.from({ length: 25 }, (_, index) => ({
    atom_id: `quantity-${index}`, title: `Independent record ${index}`,
    library: 'business', folder_type: 'record',
    content: { statement: `${exact} Record ${index}.`, point_ids: [`p${index}`] },
    source: { evidence_quote: exact, source_locator: 'manual' }, related_candidates: []
  }));
  let providerCalls = 0;
  const result = await workflow.runKnowledgeWorkflow({
    parsePackage: parsed, folderMap: {}, schemas: {}, prompts: {},
    classification: { library: 'business', folder_type: 'record' },
    summary: { document_title: 'generic', key_points: atoms.map((_, index) => ({ point_id: `p${index}` })) },
    atomResult: { atoms }, sourceHash: 'hash', versions: {}, existingCards: [],
    shortDocumentMaxCards: 20, validateLabels: () => true,
    requestJson: async () => { providerCalls += 1; throw new Error('PROVIDER_FORBIDDEN'); }
  });
  assert.strictEqual(providerCalls, 0, 'cached local reroute/revalidation must make zero provider calls');
  assert.strictEqual(result.review.length, 0, 'quantity alone must not send every good card to review');
  assert.strictEqual(result.accepted.length, 25);
  assert.strictEqual(result.documentWarnings[0].code, 'DOCUMENT_QUANTITY_ANOMALY');
  assert.strictEqual(result.documentWarnings[0].sample_atom_ids.length, 3);
  assert(review.isApprovalEligible({ status: 'pending', reasons: ['可信度偏低'], reason_codes: ['SOFT_CONFIDENCE'], validationReport: { hardGateFailures: [] } }));
  assert(!review.isApprovalEligible({ status: 'pending', reasons: ['证据缺失'], reason_codes: ['GROUNDING_DEFECT'], validationReport: { hardGateFailures: ['EVIDENCE'] } }));
  const source = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
  assert(source.includes('LOCAL_REVALIDATION_PROVIDER_CALL_FORBIDDEN'));
  assert(!/function atomSubjects/.test(source), 'domain-specific consolidation vocabulary must be removed');
  console.log('generic card architecture regressions passed');
})().catch((error) => { console.error(error); process.exitCode = 1; });
