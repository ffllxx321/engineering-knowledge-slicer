'use strict';
const assert = require('assert');
const Module = require('module');
const { loadBundleModule } = require('./load-bundle-module');
class Host {}
class Plugin extends Host {}
class TFile extends Host { constructor(path) { super(); this.path = path; this.name = path.split('/').pop(); } }
function loadPlugin() {
  const original = Module._load;
  const obsidian = new Proxy({ Plugin, TFile, TFolder: class extends Host {}, Notice: class {}, requestUrl: async () => { throw new Error('provider forbidden'); } }, { get: (t, k) => Object.hasOwn(t, k) ? t[k] : Host });
  try { Module._load = (r, p, m) => r === 'obsidian' || r === 'electron' ? obsidian : original.call(Module, r, p, m); delete require.cache[require.resolve('../main.js')]; return require('../main.js'); }
  finally { Module._load = original; }
}
function reviewPlugin(PluginClass, group) {
  const task = { task_id: 'u1', status: 'needs_review', semantic_path: 'universal', artifacts: { review: 'review.json' }, review_atom_ids: ['g1'], result_counts: { review: 1 } };
  const artifact = { version: '2.1', semantic_path: 'universal', structured_handling_groups: [group], decisions: [] };
  const plugin = Object.create(PluginClass.prototype);
  plugin.loadTasks = async () => [task]; plugin.saveTasks = async (v) => { plugin.saved = JSON.parse(JSON.stringify(v)); };
  plugin.loadArtifact = async () => artifact; plugin.persistArtifact = async (_t, _n, v) => { plugin.persisted = JSON.parse(JSON.stringify(v)); };
  plugin.refreshViews = async () => {}; plugin.processTask = async (queued) => ({ queued: queued.status });
  return plugin;
}
async function main() {
  globalThis.__eksDiag = { state: { buffer: [], events: [] } };
  const PluginClass = loadPlugin();
  const verified = loadBundleModule('src/knowledge-write-port.js', { crypto: require('crypto') });
  const taskModule = loadBundleModule('src/core/task.js', { crypto: require('crypto'), path: require('path'), 'src/knowledge-write-port.js': verified });
  const completion = loadBundleModule('src/core/completion-ui.js', { 'src/core/task.js': taskModule, 'src/knowledge-write-port.js': verified });
  for (const stored of [{ controlledWriterEnabled: false, structuredWriterMode: 'legacy' }, { structuredWriterMode: 'structured-pilot' }, { structuredWriterMode: 'disabled' }]) {
    const migrated = taskModule.migrateSettings(stored); assert.strictEqual(migrated.controlledWriterEnabled, true); assert.strictEqual(migrated.structuredWriterMode, 'structured-write'); assert.strictEqual(taskModule.migrateSettings(migrated).structuredWriterMode, 'structured-write');
  }
  const safe = reviewPlugin(PluginClass, { decision_id: 'g1', __kind: 'phase3', reason: '建议调整分类' });
  await safe.applyReviewGroup('u1', 'g1', 'accept_suggestion'); assert.strictEqual(safe.persisted.decisions[0].action, 'accept_suggestion'); assert.strictEqual(safe.saved[0].status, 'queued');
  const hard = reviewPlugin(PluginClass, { conflict_id: 'g1', __kind: 'conflict', blocking: true, cause: 'path_occupied_by_different_id' });
  await assert.rejects(() => hard.applyReviewGroup('u1', 'g1', 'approve_group'), /硬冲突不能强制批准/); await hard.applyReviewGroup('u1', 'g1', 'manual_group'); assert.strictEqual(hard.persisted.structured_handling_groups[0].manual.status, 'pending_human');
  const rerun = reviewPlugin(PluginClass, { group_id: 'g1', __kind: 'review', reason: 'route' });
  await rerun.applyReviewGroup('u1', 'g1', 'apply_correction', { category: '风险' }); assert.deepStrictEqual(rerun.persisted.decisions[0].correction, { category: '风险' });
  const tasks = [0, 1, 22].map((count) => ({ task_id: `n${count}`, run_id: `run-${count}`, semantic_path: 'universal', status: count ? 'written' : 'completed_no_output', output_paths: Array.from({ length: count }, (_, i) => `长期业务库/知识/${i}.md`), verified_records: Array.from({ length: count }, (_, i) => ({ state: 'visible_verified', record_id: `bi-${i}`, record_kind: 'business_item', run_id: `run-${count}`, final_path: `长期业务库/知识/${i}.md`, path: `长期业务库/知识/${i}.md`, vault_file_type: 'markdown', target_library: 'business', content_hash: 'a'.repeat(64), transaction_id: `txn-${count}` })), written_card_ids: ['legacy-poison'], result_counts: { knowledge_records: count, verified: count, written: count, review: 0 } }));
  assert.strictEqual(taskModule.statusCounts(tasks).written, 23); assert.strictEqual(completion.completionUiSnapshot(tasks, 'n22').counts.written, 23);
  const files = new Map(); const manifestPath = 'state/structured-writer/transactions/txn.json'; const content = 'record_id: k1\nrecord_kind: company_knowledge\n'; const structured = require('../src/structured-writer.js');
  files.set(manifestPath, JSON.stringify({ status: 'committed', transaction_id: 'txn1', plan_id: 'plan1', steps: [{ action: 'create', record_id: 'k1', record_kind: 'company_knowledge', path: '长期业务库/k1.md', content_hash: structured.hash(content) }] })); files.set('长期业务库/k1.md', content);
  const recovering = Object.create(PluginClass.prototype); recovering.settings = { artifactsPath: 'state' }; recovering.app = { vault: { adapter: { exists: async (p) => p === 'state/structured-writer/transactions' || files.has(p), list: async () => ({ files: [manifestPath] }), read: async (p) => files.get(p) } } }; recovering.loadArtifact = async () => ({ plan_id: 'plan1', counts: {} }); recovering.saveTasks = async (v) => { recovering.saved = v; }; recovering.flushSaveTasksImmediate = async () => {};
  const recovered = await recovering.recoverCommittedStructuredTasks([{ task_id: 'crash', run_id: 'run-current', status: 'writing', artifacts: {} }]); assert.strictEqual(recovered[0].status, 'writing'); assert.strictEqual(recovered[0].structured_transaction_id, undefined); assert.deepStrictEqual(recovered[0].output_paths || [], []);
  const rollbackTask = { task_id: 'review-txn', status: 'needs_review', structured_transaction_id: 'txn-review', output_paths: ['长期业务库/k.md'], result_counts: { knowledge_records: 1, written: 1 }, artifacts: {} };
  const rollbackManifestPath = 'state/structured-writer/transactions/txn-review.json'; const rollbackFiles = new Map([[rollbackManifestPath, JSON.stringify({ status: 'committed', transaction_id: 'txn-review', steps: [], previous_index: { version: '1.0', revision: 0, records: {}, source_versions: {} } })]]);
  const rollback = Object.create(PluginClass.prototype); rollback.settings = { artifactsPath: 'state' }; rollback.structuredWriterLock = { acquire: async () => () => {} }; rollback.loadTasks = async () => [rollbackTask]; rollback.loadArtifact = async () => ({ manifest_path: rollbackManifestPath }); rollback.saveTasks = async (v) => { rollback.saved = v; }; rollback.flushSaveTasksImmediate = async () => {}; rollback.refreshViews = async () => {}; rollback.app = { vault: { adapter: { exists: async (p) => rollbackFiles.has(p), read: async (p) => rollbackFiles.get(p), write: async (p, v) => rollbackFiles.set(p, String(v)), rename: async () => {}, mkdir: async () => {} }, getAbstractFileByPath: (p) => rollbackFiles.has(p) ? new TFile(p) : null, read: async (file) => rollbackFiles.get(file.path), modify: async (file, v) => rollbackFiles.set(file.path, String(v)), create: async (p, v) => rollbackFiles.set(p, String(v)), rename: async (file, target) => { rollbackFiles.set(target, rollbackFiles.get(file.path)); rollbackFiles.delete(file.path); }, createFolder: async () => {} } };
  await rollback.rollbackLastBatch(); assert.strictEqual(rollback.saved[0].status, 'rolled_back'); assert.strictEqual(rollback.saved[0].structured_transaction_id, null); assert.deepStrictEqual(rollback.saved[0].output_paths, []); assert.strictEqual(rollback.saved[0].result_counts.knowledge_records, 0);
  console.log(JSON.stringify({ gate: 'real bundled workflow consistency v2.20.7', reviewActions: 4, hardConflictForced: 0, needsReviewRollback: 1, recoveredWithoutDuplicate: 1, structuredCounts: [0, 1, 22] }, null, 2));
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
