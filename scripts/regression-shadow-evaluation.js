const assert = require('assert');
const fs = require('fs');
const { loadBundleModule } = require('./load-bundle-module.js');
const api = loadBundleModule('src/core/shadow-evaluation.js', { crypto: require('crypto') });
const tasks = [
  { task_id: '1', source_hash: 'a', source_type: 'pdf', shadow_metadata: { parser: 'pdf', size_bytes: 10, language: 'zh' } },
  { task_id: '2', source_hash: 'b', source_type: 'pdf', shadow_metadata: { parser: 'ocr', size_bytes: 9e6, language: 'en' } },
  { task_id: '3', source_hash: 'c', source_type: 'docx', shadow_metadata: { parser: 'docx', size_bytes: 2e5, language: 'zh' } },
  { task_id: '4', source_hash: 'd', source_type: 'xlsx', shadow_metadata: { parser: 'xlsx', size_bytes: 2e5, language: 'unknown' } }
];
assert.deepStrictEqual(api.selectShadowCohort(tasks, { limit: 3, seed: 'fixed' }).map((task) => task.task_id),
  api.selectShadowCohort([...tasks].reverse(), { limit: 3, seed: 'fixed' }).map((task) => task.task_id));
const secret = ['sk', 'abcdefghijklmnopqrstuvwxyz1234567890'].join('-');
const sourcePath = '/Users/private/Confidential Proposal.pdf';
const metric = api.buildShadowDocumentMetric({
  runId: 'run-safe', sourceHash: 'raw-hash-never-exported', salt: 'salt', sourceType: 'pdf', sizeBytes: 1234, language: 'zh',
  parsePackage: { parser: 'pdf-local', markdown: `${sourcePath} ${secret}`, blocks: [{ text: 'private raw quote' }, { text: '' }] },
  workflow: {
    classification: { folder_type: 'proposal', confidence: 0.91 }, route: { folder_type: 'proposal' },
    summary: { key_points: [{ point_id: 'p1' }, { point_id: 'p2' }] },
    atomResult: { atoms: [{ source_point_ids: ['p1'] }] },
    accepted: [{ validation_report: { sourceLinkValid: true, evidenceFound: true } }],
    review: [{ reasons: ['EVIDENCE_UNVERIFIED'], validation_report: { sourceLinkValid: true, evidenceFound: false } }]
  },
  cache: { parseHit: true, checkpointHits: 3 }, timings: { parsing: 12 },
  counters: { apiRequests: 0, promptCharacters: 0 }, providerBudget: 0
});
assert.strictEqual(metric.provider.requests, 0);
assert.strictEqual(metric.quality.locator_evidence_verification_rate, 0.5);
assert.strictEqual(metric.quality.summary_coverage_rate, 0.5);
assert.strictEqual(metric.source_pseudonym, api.shadowPseudonym('raw-hash-never-exported', 'salt'));
for (const forbidden of [secret, sourcePath, 'Confidential Proposal', 'private raw quote', 'raw-hash-never-exported']) {
  assert(!JSON.stringify(metric).includes(forbidden), `privacy leak: ${forbidden}`);
}
const migrated = api.migrateShadowStore({ documents: [metric] });
assert.strictEqual(migrated.schema_version, 'eks-shadow-store/1.0');
assert.strictEqual(migrated.runs.length, 1);
const bounded = api.boundedShadowStore({
  schema_version: 'eks-shadow-store/1.0',
  runs: Array.from({ length: 10 }, (_, index) => Object.assign({}, metric, {
    run_id: String(index), completed_at: new Date(Date.now() - index * 1000).toISOString()
  })), baselines: []
}, { maxDocuments: 3, retentionDays: 30 });
assert.strictEqual(bounded.runs.length, 3);
const aggregate = api.aggregateShadowRuns([metric]);
assert.strictEqual(aggregate.documents, 1);
assert.strictEqual(aggregate.provider.requests, 0);
const comparison = api.compareShadowAggregates(aggregate, Object.assign({}, aggregate, {
  baseline_id: 'base', provider: Object.assign({}, aggregate.provider, { requests: 2 })
}));
assert.strictEqual(comparison.deltas['provider.requests'], -2);
assert(api.renderShadowMarkdown({ aggregate }).includes('Provider requests: 0'));
const bundle = fs.readFileSync(require.resolve('../main.js'), 'utf8');
const shadowBody = bundle.slice(bundle.indexOf('async evaluateShadowTask'), bundle.indexOf('async shadowReport'));
for (const forbiddenCall of ['writeAcceptedCard(', 'rebuildKnowledgeIndexes(', 'saveTasks(']) assert(!shadowBody.includes(forbiddenCall));
assert(shadowBody.includes('allowExternalUpload: false'));
assert(shadowBody.includes('PROVIDER_BUDGET_EXHAUSTED'));
assert(shadowBody.includes('this.loadArtifact(task, name)'));
assert(shadowBody.includes('this.loadArtifact(shadowTask, `shadow-${name}`)'));
assert(bundle.includes('shadowEvaluationEnabled: false'));
console.log('shadow evaluation regression: passed');
