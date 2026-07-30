const assert = require('assert');
const crypto = require('crypto');
const path = require('path');
const { loadBundleModule } = require('./load-bundle-module');

const { migrateTaskLedgerV3 } = loadBundleModule('src/core/migration.js', { crypto });
const taskModule = loadBundleModule('src/core/task.js', { crypto, path });
const versions = { pipelineVersion: '2.18.1', promptBundleVersion: '2.18', schemaVersion: '1.1' };
const original = {
  task_id: 'task-current', run_id: 'run-current', schema_version: '1.1',
  source_path: 'Inbox\\mail.eml#attachment.pdf', source_hash: 'abc', source_type: 'pdf',
  library: 'business', status: 'needs_review', source_aliases: [], remote_jobs: [],
  retry_counts: { parsed: 2, atoms: 1 }, artifacts: {}, written_card_ids: [], writtenFiles: [],
  review_atom_ids: ['atom-1'], errors: [], progress: {}, lease: { owner: 'old' },
  created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-02T00:00:00.000Z',
  regeneration_mode: 'whole_atom', parent_task_id: 'mail-parent',
  parent_source_path: 'Inbox/mail.eml', queue_run_id: 'queue-7',
  queue_order: 3, queue_total: 9, review_outcome: { handled: ['atom-1'] },
  retry_count: 4, extension_future: { nested: ['preserved', 7] }
};

let value = original;
for (let round = 0; round < 3; round += 1) {
  value = JSON.parse(JSON.stringify(migrateTaskLedgerV3([value], versions)[0]));
}
for (const field of [
  'regeneration_mode', 'parent_task_id', 'parent_source_path', 'queue_run_id',
  'queue_order', 'queue_total', 'review_outcome', 'retry_count', 'extension_future'
]) assert.deepStrictEqual(value[field], original[field], `${field} must survive repeated round trips`);
assert.strictEqual(value.source_path, 'Inbox/mail.eml#attachment.pdf');
assert.strictEqual(value.lease, null, 'known lease field remains normalized');
assert.deepStrictEqual(value.retry_counts, { parsed: 2, atoms: 1 });
assert.deepStrictEqual(value.review_atom_ids, ['atom-1']);

const legacy = migrateTaskLedgerV3([{
  taskId: 'legacy', sourcePath: 'Old\\file.pdf', sourceHash: 'def',
  status: 'parsing', unknown_legacy_payload: 'must-not-cross-boundary'
}], versions)[0];
assert.strictEqual(legacy.task_id, 'legacy');
assert.strictEqual(legacy.source_path, 'Old/file.pdf');
assert.strictEqual(legacy.status, 'failed');
assert.strictEqual(legacy.unknown_legacy_payload, undefined);
assert(legacy.errors.some((item) => item.stage === 'migration'));

assert.strictEqual(taskModule.migrateSettings({ pdfExtractionOrder: 'paddleocr-api,mineru-api' }).pdfExtractionOrder, 'paddleocr-api,mineru-api');
assert.strictEqual(taskModule.migrateSettings({ pdfExtractionOrder: 'unknown' }).pdfExtractionOrder, taskModule.DEFAULT_SETTINGS.pdfExtractionOrder);

console.log('regression-task-ledger-lossless: ok');
