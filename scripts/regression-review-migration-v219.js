const assert = require('assert');
const fs = require('fs');
const path = require('path');

const source = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
const start = source.indexOf('function migrateReviewArtifact(value) {');
const end = source.indexOf('\nfunction pathSetting(', start);
assert(start > 0 && end > start);
const migrateReviewArtifact = new Function(`${source.slice(start, end)}\nreturn migrateReviewArtifact;`)();

const legacy = {
  version: '1.3', task_id: 'task-r', outcome: 'partially_handled',
  metrics: { candidateCards: 4, hardRejected: 1 },
  documentWarnings: [{ code: 'DOCUMENT_QUANTITY_ANOMALY' }],
  handled: [{ atom_id: 'a1', action: 'approve', reason: '人工核对原文' }],
  rejected: [{ atom_id: 'a4', reason_codes: ['GROUNDING_DEFECT'], non_overridable: true }],
  manual_requests: [{ atom_id: 'a2', reason: '补标签' }],
  regeneration_requests: [{ point_ids: ['p3'], mode: 'whole_atom' }],
  extension_audit: { operator: 'local' },
  items: [{
    atom_id: 'a2', status: 'pending', reasons: ['可信度偏低'], reason_codes: ['SOFT_CONFIDENCE'],
    atom: { title: '条目', content: { statement: '内容', point_ids: ['p2'] }, source: {
      evidence_quote: '内容', source_locator: 'block:b2', source_provenance: { block_id: 'b2' }
    } },
    validationReport: { evidenceFound: true, numberConsistency: true, schemaValid: true, routeValid: true, tagsValid: true, duplicateScore: 0 }
  }]
};

const once = migrateReviewArtifact(legacy);
const twice = migrateReviewArtifact(JSON.parse(JSON.stringify(once)));
assert.strictEqual(once.version, '2.0');
assert.deepStrictEqual(twice, once, 'review migration must be idempotent');
for (const key of ['outcome', 'metrics', 'documentWarnings', 'handled', 'rejected', 'manual_requests', 'regeneration_requests', 'extension_audit']) {
  assert.deepStrictEqual(once[key], legacy[key], `${key} must be lossless`);
}
assert.strictEqual(once.rejected[0].non_overridable, true);
assert.deepStrictEqual(once.rejected[0].reason_codes, ['GROUNDING_DEFECT']);
assert.strictEqual(migrateReviewArtifact({ version: '2.0', items: [], handled: [{ action: 'approve' }] }).version, '2.0');

assert(source.includes("artifact.version = '2.0'"));
assert(source.includes('isApprovalEligible'));
assert(source.includes('reviewer_reason'));
console.log('regression-review-migration-v219: ok');
