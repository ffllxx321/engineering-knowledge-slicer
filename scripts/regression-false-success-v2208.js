'use strict';
const assert = require('assert');
const Module = require('module');
const { loadBundleModule } = require('./load-bundle-module');
class Host {}
class Plugin extends Host {}
class TFile extends Host { constructor(path) { super(); this.path = path; this.name = path.split('/').pop(); } }
function loadPlugin() {
  const original = Module._load;
  const obsidian = new Proxy({ Plugin, TFile, TFolder: class extends Host {}, Notice: class {} }, { get: (t, k) => Object.hasOwn(t, k) ? t[k] : Host });
  try { Module._load = (r, p, m) => r === 'obsidian' || r === 'electron' ? obsidian : original.call(Module, r, p, m); delete require.cache[require.resolve('../main.js')]; return require('../main.js'); }
  finally { Module._load = original; }
}
const writer = loadBundleModule('src/structured-writer.js', { crypto: require('crypto'), 'src/phase1-foundation.js': require('../src/phase1-foundation.js') });
function markdown(id, kind) { return `---\nrecord_id: "${id}"\nrecord_kind: "${kind}"\n---\n\n# 卡片\n\n- 归属来源：src-v2208\n`; }
function plan22() {
  const languages = ['中文 空格', '日本語 フォルダ', 'English Folder'];
  const actions = Array.from({ length: 22 }, (_, index) => {
    const record_id = `ck-v2208-${String(index).padStart(2, '0')}`;
    const record_kind = index % 2 ? 'company_knowledge' : 'business_item';
    const content = markdown(record_id, record_kind);
    return { action: 'create', record_id, record_kind, owner_source_id: 'src-v2208', path: `长期业务库/${languages[index % 3]}/知识 卡片/${record_id}.md`, prior_hash: null, content, content_hash: writer.hash(content) };
  });
  return { mode: 'structured-write', blocked: false, plan_id: 'plan-v2208', source_document_id: 'src-v2208', actions };
}
class Vault {
  constructor(limit = Infinity) { this.files = new Map(); this.recordWrites = 0; this.limit = limit; }
  async readIfExists(path) { return this.files.has(path) ? this.files.get(path) : null; }
  async write(path, content) { if (path.endsWith('.md') && ++this.recordWrites > this.limit) return; this.files.set(path, String(content)); }
  async rename(from, to) { if (!this.files.has(from)) throw new Error(`missing ${from}`); this.files.set(to, this.files.get(from)); this.files.delete(from); }
  async mkdirp() {}
}
const lock = { acquire: async () => () => {} };
async function commit(vault, index = writer.emptyIndex()) { return writer.commitPlan(plan22(), { vault, lock, stateRoot: '系统 状态', index, logicalTime: '2026-08-03T00:00:00.000Z', saveIndex: async (next) => { vault.index = next; } }); }
async function main() {
  globalThis.__eksDiag = { state: { buffer: [], events: [] } };
  for (const limit of [0, 7]) {
    const vault = new Vault(limit);
    await assert.rejects(() => commit(vault), (error) => { assert.strictEqual(error.code, 'STRUCTURED_WRITE_NOT_PERSISTED'); assert.strictEqual(error.details.planned, 22); assert(error.details.verified < 22); assert.strictEqual(error.transactionManifest.status, 'rolled_back'); return true; });
    assert.strictEqual([...vault.files.keys()].filter((path) => path.startsWith('长期业务库/') && path.endsWith('.md')).length, 0);
    assert.strictEqual(vault.index, undefined);
  }
  const vault = new Vault();
  const first = await commit(vault);
  assert.strictEqual(first.verified.counts.knowledge_records, 22);
  assert.strictEqual(new Set(first.verified.knowledge_paths).size, 22);
  for (const outputPath of first.verified.knowledge_paths) assert(String(await vault.readIfExists(outputPath)).trim());
  const rerunPlan = plan22();
  rerunPlan.actions = rerunPlan.actions.map((action) => ({ ...action, action: 'noop', prior_hash: action.content_hash }));
  const rerun = await writer.commitPlan(rerunPlan, { vault, lock, stateRoot: '系统 状态', index: first.index, logicalTime: '2026-08-03T00:00:01.000Z', saveIndex: async () => {} });
  assert.strictEqual(rerun.verified.counts.knowledge_records, 22);
  assert.strictEqual(rerun.verified.counts.knowledge_unchanged, 22);
  assert.strictEqual([...vault.files.keys()].filter((path) => path.startsWith('长期业务库/') && path.endsWith('.md')).length, 22);
  const PluginClass = loadPlugin();
  const fakeContent = markdown('ck-old', 'company_knowledge');
  const manifestPath = '系统 状态/structured-writer/transactions/txn-old.json';
  const manifest = { status: 'committed', transaction_id: 'txn-old', plan_id: 'plan-old', steps: [{ action: 'create', record_id: 'ck-old', record_kind: 'company_knowledge', path: '长期业务库/中文 空格/ck-old.md', content_hash: writer.hash(fakeContent) }] };
  const adapterFiles = new Map([[manifestPath, JSON.stringify(manifest)]]);
  const stale = { task_id: 'old-v2207', semantic_path: 'universal', status: 'written', structured_transaction_id: 'txn-old', output_paths: ['长期业务库/中文 空格/ck-old.md'], result_counts: { written: 1, knowledge_records: 1 }, artifacts: { knowledge_records: ['fake'] } };
  const plugin = Object.create(PluginClass.prototype); plugin.settings = { artifactsPath: '系统 状态' };
  plugin.app = { vault: { adapter: { exists: async (path) => path.endsWith('/transactions') || adapterFiles.has(path), list: async () => ({ files: [manifestPath] }), read: async (path) => adapterFiles.get(path) }, getAbstractFileByPath: () => null, read: async () => { throw new Error('must not read missing TFile'); } } };
  plugin.loadArtifact = async () => ({ plan_id: 'plan-old', actions: manifest.steps }); plugin.saveTasks = async (tasks) => { plugin.saved = tasks; }; plugin.flushSaveTasksImmediate = async () => {};
  const recovered = await plugin.recoverCommittedStructuredTasks([stale]);
  assert.strictEqual(recovered[0].status, 'queued'); assert.strictEqual(recovered[0].result_counts.knowledge_records, 0); assert.deepStrictEqual(recovered[0].output_paths, []); assert.strictEqual(recovered[0].structured_transaction_id, null);
  const tfileVault = { getAbstractFileByPath: (path) => vault.files.has(path) ? new TFile(path) : null, read: async (file) => vault.files.get(file.path) };
  for (const outputPath of first.verified.knowledge_paths) { const file = tfileVault.getAbstractFileByPath(outputPath); assert(file instanceof TFile); assert(String(await tfileVault.read(file)).trim()); }
  console.log(JSON.stringify({ gate: 'real bundled false-success v2.20.8', planned: 22, zero: 'failed+rolled_back', partial: 'failed+rolled_back', verified: 22, rerunMarkdownFiles: 22, staleV2207: 'invalidated+queued', tfileOpenable: 22, paths: ['中文 空格', '日本語 フォルダ', 'English Folder'] }, null, 2));
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
