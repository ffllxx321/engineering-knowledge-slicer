'use strict';

const assert = require('assert');
const { assertManifest, transitionProductionState, visibleFacts } = require('../src/production-state-machine.js');

const record = (path, run = 'run-current') => ({ record_id: `id-${path}`, record_kind: 'company_knowledge', run_id: run,
  final_path: path, state: 'visible_verified', target_library: 'business', content_hash: 'a'.repeat(64) });
const manifest = (sets, records = [], run = 'run-current') => ({ schema: 'eks/authoritative-visible-manifest/3.0', run_id: run,
  task_id: 'task', transaction_id: 'txn', target_roots: { business: '长期业务库', active_tender: '在办投标库' }, path_sets: sets, records });
const task = () => ({ task_id: 'task', run_id: 'run-current', production_state: 'processing' });
const paths = Array.from({ length: 22 }, (_, index) => `长期业务库/知识-${index}.md`);

for (const scenario of [
  ['generated=22/final=0', manifest({ planned: [], committed: [], visible_verified: [] })],
  ['planned=22/final=0', manifest({ planned: paths, committed: [], visible_verified: [] })],
  ['committed=22/final=0', manifest({ planned: paths, committed: paths, visible_verified: [] })],
  ['old-run=22/current=0', manifest({ planned: paths, committed: paths, visible_verified: paths }, paths.map((p) => record(p, 'run-old')), 'run-old')],
  ['temporary=22/final=0', manifest({ planned: paths, committed: paths, visible_verified: paths.map((p) => `tmp/${p}`) })],
  ['moved-old-path', manifest({ planned: paths, committed: paths, visible_verified: paths.map((p) => `archive/${p}`) })],
  ['wrong-root/non-md/hash-mismatch', manifest({ planned: ['源文件/a.txt'], committed: ['源文件/a.txt'], visible_verified: ['源文件/a.txt'] }, [record('源文件/a.txt')])]
]) {
  const value = task(); value.current_run_manifest = scenario[1];
  assert.strictEqual(assertManifest(value, scenario[1]), false, scenario[0]);
  assert.throws(() => transitionProductionState(value, 'stored', { manifest: scenario[1] }), /不能标记为已入库|当前运行/);
  assert.strictEqual(visibleFacts(value).count, 0);
}

const goodRecords = paths.map((p) => record(p));
const good = task(); good.current_run_manifest = manifest({ planned: paths, committed: paths, visible_verified: paths }, goodRecords);
transitionProductionState(good, 'stored', { manifest: good.current_run_manifest });
assert.strictEqual(visibleFacts(good).count, 22);
console.log('production state machine counterexamples: 8 rejected, authoritative equality accepted');
