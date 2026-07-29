const assert = require('assert');
const { loadBundleModule } = require('./load-bundle-module.js');

const api = loadBundleModule('src/core/diagnostic-report.js', { crypto: require('crypto') });
const SECRET = 'sk-abcdefghijklmnopqrstuvwxyz1234567890';
const SOURCE = '/Users/customer/Confidential/Project-X/full-source-document.md';
const events = Array.from({ length: 27 }, (_, offset) => ({
  at: `2026-07-29T00:00:${String(offset + 1).padStart(2, '0')}.000Z`,
  scope: 'atomization.batch.cacheHit',
  data: { batchIndex: offset + 1, batchTotal: 104, stableBatchId: `batch-stable-${offset + 1}` }
}));
events.push({
  at: '2026-07-29T00:01:00.000Z', scope: 'atomization.batch.failed',
  data: { batchIndex: 28, batchTotal: 104, stableBatchId: 'batch-stable-28', code: 'AI_SCHEMA_OUTPUT_INVALID', message: `Bearer ${SECRET} ${SOURCE}` }
});

function fixture(overrides = {}) {
  return api.buildDiagnosticReport(Object.assign({
    generatedAt: '2026-07-29T00:02:00.000Z',
    manifest: { id: 'engineering-knowledge-slicer', version: '2.9.3' },
    task: {
      task_id: 'task-safe', run_id: 'run-safe', source_path: SOURCE,
      source_hash: 'abcdef0123456789abcdef0123456789', source_type: 'markdown',
      status: 'failed', diagnostic_started_at: '2026-07-29T00:00:00.000Z',
      updated_at: '2026-07-29T00:02:00.000Z', artifacts: { error: 'artifact/error.json' }
    },
    error: {
      code: 'ATOMIZATION_BATCH_INCOMPLETE', category: 'ai_provider', retryable: true,
      stage: 'atomization', technicalMessage: `failed ${SECRET} ${SOURCE}`,
      details: { completedBatches: 27, batchTotal: 104, failedBatches: [
        { batchIndex: 28, stableBatchId: 'batch-stable-28', code: 'AI_SCHEMA_OUTPUT_INVALID', message: SECRET }
      ] }
    },
    settings: { minimaxApiKey: SECRET, minimaxModel: 'MiniMax-M3', aiChunkSize: 8000 },
    platform: { os: 'darwin', arch: 'arm64' },
    counters: { apiRequests: 31, aiRetries: 3 },
    events,
    artifacts: [{ name: 'error', pathHash: 'safe-hash', exists: true, validation: 'valid' }]
  }, overrides));
}

const report = fixture();
assert.strictEqual(report.reportVersion, '1.2');
assert.strictEqual(report.schemaVersion, 'eks-diagnostic-report/1.2');
assert.strictEqual(report.identity.sourceHash, 'abcdef0123456789abcdef01');
assert.strictEqual(report.work.atomBatches.expected, 104);
assert.strictEqual(report.work.atomBatches.completed, 27);
assert.strictEqual(report.work.atomBatches.completedIds.length, 27);
assert.deepStrictEqual(report.work.atomBatches.failed.map((item) => item.id), ['batch-stable-28']);
assert(report.work.atomBatches.missing.includes('batch-index-29'));
assert.strictEqual(report.work.atomBatches.missing.length, 76);
assert.strictEqual(report.timeline.filter((event) => event.code === 'atomization.batch.cacheHit.range').length, 1);
assert.strictEqual(report.timeline.find((event) => event.code.endsWith('.range')).count, 27);

const json = api.boundedDiagnosticJson(report);
const markdown = api.renderDiagnosticMarkdown(report);
assert(Buffer.byteLength(json) <= api.MAX_JSON_BYTES);
assert(Buffer.byteLength(markdown) <= api.MAX_MARKDOWN_BYTES);
for (const output of [json, markdown]) {
  assert(!output.includes(SECRET), 'API key leaked');
  assert(!output.includes(SOURCE), 'source path leaked');
  assert(!output.includes('full-source-document'), 'source filename leaked');
}

const oversized = fixture({
  events: Array.from({ length: 1000 }, (_, index) => ({
    at: new Date(1_700_000_000_000 + index).toISOString(), scope: `failure.event.${index}`,
    data: { message: 'x'.repeat(1000), token: SECRET }
  })),
  artifacts: Array.from({ length: 300 }, (_, index) => ({
    name: `atom-batch-${index}`, pathHash: String(index), exists: true, validation: 'valid'
  }))
});
const bounded = api.boundedDiagnosticJson(oversized);
assert(Buffer.byteLength(bounded) <= api.MAX_JSON_BYTES);
assert.doesNotThrow(() => JSON.parse(bounded));
console.log('diagnostic report regression: 16 assertions passed');
