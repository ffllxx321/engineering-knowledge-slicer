'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  RECORD_KINDS,
  DIRECTORY_PLAN,
  normalizeRecord,
  validateRecord,
  migrateRecord,
  validateProjectTransition,
  planLegacyMigration
} = require('../src/phase1-foundation.js');

const now = '2026-07-30T00:00:00.000Z';
const fixtures = [
  {
    record_kind: 'project', record_id: 'p-1', title: '项目甲', library: 'active_tender',
    state: 'bidding', created_at: now, updated_at: now
  },
  {
    record_kind: 'source_document', record_id: 's-1', title: '招标文件', library: 'active_tender',
    source_path: '投标/甲.pdf', project_ids: ['p-1'], business_item_ids: ['b-1'],
    company_knowledge_ids: ['k-1'], created_at: now, updated_at: now
  },
  {
    record_kind: 'business_item', record_id: 'b-1', title: '钢材报价', library: 'business',
    category: 'costs', source_document_ids: ['s-1'], related_item_ids: ['b-2'],
    derived_from_ids: ['s-1'], created_at: now, updated_at: now
  },
  {
    record_kind: 'company_knowledge', record_id: 'k-1', title: '报价检查表', library: 'business',
    category: '投标模板', reuse_status: 'approved', source_document_ids: ['s-1'],
    supersedes_id: 'k-0', replaces_id: 'template-old', created_at: now, updated_at: now
  }
];

assert.deepStrictEqual(RECORD_KINDS, fixtures.map((item) => item.record_kind));
for (const fixture of fixtures) {
  const first = migrateRecord(fixture);
  const second = migrateRecord(JSON.parse(JSON.stringify(first)));
  assert.deepStrictEqual(second, first, `${fixture.record_kind} migration must be idempotent`);
  assert(validateRecord(first).valid, `${fixture.record_kind} must round trip`);
}

const unknown = migrateRecord({
  ...fixtures[2],
  future_flag: { enabled: true, levels: [2, 1] },
  extensions: { existing_extension: '保留' }
});
assert.deepStrictEqual(unknown.extensions, {
  existing_extension: '保留',
  future_flag: { enabled: true, levels: [2, 1] }
});
assert.deepStrictEqual(migrateRecord(unknown), unknown, 'safe unknown fields must survive repeated migrations');

assert.strictEqual(validateProjectTransition('lead', 'submitted').allowed, false);
assert.strictEqual(validateProjectTransition('paused', 'archived', {
  archive_outcome: 'paused_by_decision'
}).allowed, false, 'paused archive requires an explicit decision');
assert.strictEqual(validateProjectTransition('paused', 'archived', {
  archive_outcome: 'paused_by_decision', explicit_decision: true
}).allowed, true);
for (const [state, outcome] of [
  ['won', 'won_completed'], ['lost', 'lost'], ['terminated', 'terminated']
]) {
  assert.strictEqual(validateProjectTransition(state, 'archived', {
    archive_outcome: outcome
  }).allowed, true, `${state} archive outcome must be supported`);
}
assert.strictEqual(validateProjectTransition('lost', 'archived', {
  archive_outcome: 'terminated'
}).allowed, false);

const source = migrateRecord(fixtures[1]);
assert.strictEqual(source.record_id, 's-1', 'one source record must retain one identity');
assert.deepStrictEqual(source.project_ids, ['p-1']);
assert.deepStrictEqual(source.business_item_ids, ['b-1']);
assert.deepStrictEqual(source.company_knowledge_ids, ['k-1']);

const active = DIRECTORY_PLAN.roots.find((item) => item.library === 'active_tender');
for (const key of ['common_knowledge', 'templates']) {
  const category = active.categories.find((item) => item.key === key);
  assert.strictEqual(category.storage, 'reference');
  assert.strictEqual(category.target_library, 'business');
}
assert.strictEqual(DIRECTORY_PLAN.mode, 'definitions_only');

const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'eks-phase1-'));
const sentinel = path.join(sandbox, 'untouched.txt');
fs.writeFileSync(sentinel, '不应改变');
const before = fs.readdirSync(sandbox).sort();
let providerCalls = 0;
const report = planLegacyMigration({
  cards: [{ card_id: 'c-1', title: '旧经验', project: '项目甲' }],
  tasks: [{ task_id: 't-1', source_path: '旧资料/甲.pdf' }],
  projects: [
    { project_id: 'p-won', state: 'won', archive_outcome: 'won_completed' },
    { project_id: 'p-paused', state: 'paused', archive_outcome: 'paused_by_decision' }
  ],
  requestJson: () => { providerCalls += 1; }
});
assert.deepStrictEqual(fs.readdirSync(sandbox).sort(), before, 'dry run must not write');
assert.strictEqual(fs.readFileSync(sentinel, 'utf8'), '不应改变');
assert.strictEqual(report.writes_performed, 0);
assert.strictEqual(report.deletes_performed, 0);
assert.strictEqual(report.provider_calls, 0);
assert.strictEqual(providerCalls, 0, 'planning must never invoke a provided provider callback');
assert(report.actions.some((item) => item.action === 'archive_complete_project'));
assert(report.actions.some((item) => item.action === 'extract_reusable_knowledge'));
assert(report.actions.every((item) => item.preserves_source));
assert.strictEqual(
  report.actions.find((item) => item.source_ref === 'legacy-project:p-paused').ready,
  false,
  'legacy paused projects cannot be archived without an explicit decision'
);
fs.rmSync(sandbox, { recursive: true, force: true });

for (const file of [
  'project-v1.schema.json', 'source-document-v1.schema.json',
  'business-item-v1.schema.json', 'company-knowledge-v1.schema.json'
]) {
  JSON.parse(fs.readFileSync(path.join(__dirname, '..', '组件包', 'schemas', file), 'utf8'));
}

console.log('phase1-foundation: ok');
