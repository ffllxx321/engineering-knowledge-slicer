'use strict';
const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { AutoDocumentParser } = require('../src/auto-document-parser.js');
const { assertManifest, transitionProductionState, visibleFacts } = require('../src/production-state-machine.js');
const { KnowledgeWritePort, applyVerifiedFacts, normalizeTaskForPersistence, assertTaskInvariant } = require('../src/knowledge-write-port.js');
const hash = (value) => crypto.createHash('sha256').update(String(value)).digest('hex');
const record = (run, index, root = '06-知识库/业务库') => ({ record_id: `record-${index}`, record_kind: 'business_item', run_id: run,
  final_path: `${root}/card-${index}.md`, path: `${root}/card-${index}.md`, state: 'visible_verified', vault_file_type: 'markdown',
  target_library: 'business', content_hash: hash(`card-${index}`), transaction_id: 'tx-1', source_association: 'source-1' });
const manifest = (task, records) => ({ schema: 'eks/authoritative-visible-manifest/3.0', run_id: task.run_id, task_id: task.task_id,
  transaction_id: 'tx-1', target_roots: { business: '06-知识库/业务库', active_tender: '06-知识库/招投标库' },
  path_sets: { planned: records.map((r) => r.final_path), committed: records.map((r) => r.final_path), visible_verified: records.map((r) => r.final_path) }, records });
const ok = (engine) => ({ status: 'ok', text: '足够长的确定性知识正文内容用于质量验证。', parsePackage: {
  markdown: '足够长的确定性知识正文内容用于质量验证。', quality: { corruptRatio: 0 }, parser: engine,
  blocks: [{ card_eligible: true, raw: { text: '可核验证据' } }] } });

async function main() {
  const task = { task_id: 'task-22', run_id: 'run-22', production_state: 'processing', result_counts: {} };
  const records = Array.from({ length: 22 }, (_, i) => record(task.run_id, i)); task.current_run_manifest = manifest(task, records);
  assert.throws(() => transitionProductionState(task, 'stored', { manifest: task.current_run_manifest, overallPercent: 0 }), /100%/);
  const emptyPaths = manifest(task, records); emptyPaths.path_sets.visible_verified = [];
  assert.strictEqual(assertManifest(task, emptyPaths), false, 'cardsWritten=22 but final paths=0 must fail');
  assert.strictEqual(assertManifest(task, manifest(task, [record(task.run_id, 1, '长期业务库')])), false, 'top-level legacy root must fail');
  assert.deepStrictEqual(JSON.parse(JSON.stringify(task)).current_run_manifest, task.current_run_manifest, 'manifest save/load must be lossless');
  applyVerifiedFacts(task, records); transitionProductionState(task, 'stored', { manifest: task.current_run_manifest, overallPercent: 100 });
  assert.deepStrictEqual({ performance: visibleFacts(task).count, diagnostic: task.result_counts.written, ui: task.output_paths.length }, { performance: 22, diagnostic: 22, ui: 22 });
  task.result_counts.written = 21; assert.strictEqual(assertTaskInvariant(task).ok, false); normalizeTaskForPersistence(task); assert.strictEqual(task.result_counts.written, 22);
  const files = new Map(); const vault = { getAbstractFileByPath: (p) => files.get(p) || null, read: async (f) => f.content,
    create: async (p, content) => { files.set(p, { path: p, content }); }, modify: async (f, content) => { f.content = content; },
    rename: async (f, p) => { files.delete(f.path); f.path = p; files.set(p, f); }, createFolder: async (p) => { files.set(p, { path: p, folder: true }); } };
  const port = new KnowledgeWritePort(vault);
  await assert.rejects(() => port.verify({ record_id: 'missing', record_kind: 'business_item', path: '06-知识库/业务库/missing.md', content_hash: hash('') }, 'tx', '', { runId: 'run', targetRoots: { business: '06-知识库/业务库' } }), /校验失败/);
  const calls = []; const parser = new AutoDocumentParser({ local: async () => { calls.push('local'); return ok('local'); },
    probePdf: (_buffer, context) => context.probe, localPdf: async () => { calls.push('localPdf'); return ok('localPdf'); },
    mineru: async (_p, _b, context) => { calls.push('mineru'); return context.failMineru ? { status: 'failed' } : ok('mineru'); },
    localOcr: async (_p, _b, context) => { calls.push('localOcr'); return context.failOcr ? { status: 'failed' } : ok('localOcr'); } });
  for (const ext of ['docx', 'xlsx', 'pptx', 'msg', 'eml', 'txt', 'md']) { calls.length = 0; await parser.parse(`a.${ext}`, Buffer.from('x')); assert.deepStrictEqual(calls, ['local']); }
  calls.length = 0; await parser.parse('native.pdf', Buffer.from('x'), { probe: { reliableLocal: true } }); assert.deepStrictEqual(calls, ['localPdf']);
  calls.length = 0; await parser.parse('scan.pdf', Buffer.from('x'), { probe: { reliableLocal: false }, mineruConfigured: true, allowNecessaryCloud: true }); assert.deepStrictEqual(calls, ['mineru']);
  calls.length = 0; await parser.parse('fallback.pdf', Buffer.from('x'), { probe: { reliableLocal: false }, mineruConfigured: true, allowNecessaryCloud: true, failMineru: true }); assert.deepStrictEqual(calls, ['mineru', 'localOcr']);
  await assert.rejects(() => parser.parse('bad.pdf', Buffer.from('x'), { probe: { reliableLocal: false }, failOcr: true }), /未产生可核验知识证据/);
  const bundle = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
  assert(bundle.includes("knowledgeTenderRoot: '06-知识库/招投标库'")); assert(bundle.includes("knowledgeBusinessRoot: '06-知识库/业务库'"));
  console.log('single-auto-path + real-ingest regressions: PASS');
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
