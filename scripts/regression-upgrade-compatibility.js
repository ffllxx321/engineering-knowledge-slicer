'use strict';
const assert = require('assert');
const crypto = require('crypto');
const childProcess = require('child_process');
const bundled = process.env.EKS_UPGRADE_BUNDLE === '1';
const load = bundled ? require('./load-bundle-module.js').loadBundleModule : (name) => require(`../${name}`);
const { ProductionCommitService } = load('src/production-commit-service.js');
const { commitPlan, emptyIndex, hash } = load('src/structured-writer.js');

class File { constructor(path) { this.path = path; } }
class Vault {
  constructor(files = {}) { this.files = new Map(Object.entries(files)); }
  getAbstractFileByPath(path) { return this.files.has(path) || [...this.files.keys()].some((item) => item.startsWith(`${path}/`)) ? new File(path) : null; }
  async read(file) { return this.files.get(file.path); }
  async create(path, content) { this.files.set(path, String(content)); }
  async modify(file, content) { this.files.set(file.path, String(content)); }
  async createFolder(path) { this.files.set(path, null); }
  async rename(file, path) { this.files.set(path, this.files.get(file.path)); this.files.delete(file.path); }
}

const digest = (value) => crypto.createHash('sha256').update(value).digest('hex');
const lock = { acquire: async () => () => {} };
const legacyContent = '---\nrecord_id: "ck-old"\nrecord_kind: "company_knowledge"\nsource_document_ids: ["src-old"]\n---\n\n# 旧版知识卡\n\n- 归属来源：src-old\n';
function newAction() {
  const content = '---\nrecord_id: "ck-new"\nrecord_kind: "company_knowledge"\nsource_document_ids: ["src-new"]\n---\n\n# 新知识卡\n\n- 归属来源：src-new\n';
  return { action: 'create', record_id: 'ck-new', record_kind: 'company_knowledge', path: 'business/新知识卡.md',
    content, content_hash: hash(content), prior_hash: null, prior_content: null, owner_source_id: 'src-new',
    source_hash: digest('new'), source_version: 'v2', record_snapshot: { record_kind: 'company_knowledge',
      title: '新知识卡', search_title: '新知识卡', summary: '新要求', semantic_kind: 'requirement', subject: '新要求',
      predicate: '必须执行新要求', evidence: { block_id: 'b-new', locator: { page: 1 }, verbatim: '必须执行新要求。' } } };
}
function oldIndex() {
  const index = emptyIndex(); index.revision = 7;
  index.records['ck-old'] = { record_id: 'ck-old', record_kind: 'company_knowledge', path: 'business/ck-old.md',
    content_hash: hash(legacyContent), owner_source_id: 'src-old', source_hash: digest('old') };
  return index;
}
async function scenario(sidecar) {
  const files = { 'business/ck-old.md': legacyContent };
  if (sidecar) files['state/evolution/production-index-v1.json'] = JSON.stringify(sidecar);
  const vault = new Vault(files); let index = oldIndex(); const action = newAction();
  const plan = { mode: 'structured-write', blocked: false, plan_id: `upgrade-${sidecar ? 'stale' : 'missing'}`,
    source_document_id: 'src-new', source_hash: digest('new'), source_version: 'v2', actions: [action] };
  const result = await new ProductionCommitService(vault, commitPlan).commit(plan, { lock, stateRoot: 'state', index,
    saveIndex: async (next) => { index = next; }, logicalTime: '2026-08-25T00:00:00Z', asOf: '2026-08-25',
    runId: `run-${sidecar ? 'stale' : 'missing'}`, taskId: 'task-upgrade', targetRoots: { business: 'business', active_tender: 'tender' } });
  const evolution = JSON.parse(vault.files.get('state/evolution/production-index-v1.json'));
  assert.deepStrictEqual(evolution.records.map((item) => item.record_id), ['ck-new', 'ck-old'],
    'automatic rebuild must preserve valid legacy indexed records when adding current records');
  assert(evolution.graph.facts.some((fact) => fact.unit_ids.includes('ck-old')),
    'legacy record receives an explicit undated evolution fact instead of disappearing');
  assert(result.authoritativeManifest.evolution.required);
}
async function unsafeOwnershipEvidenceStaysBlocked() {
  const vault = new Vault({ 'business/ck-old.md': `${legacyContent}\n用户修改` });
  const action = newAction();
  const plan = { mode: 'structured-write', blocked: false, plan_id: 'upgrade-conflict', source_document_id: 'src-new',
    source_hash: digest('new'), source_version: 'v2', actions: [action] };
  await assert.rejects(() => new ProductionCommitService(vault, commitPlan).commit(plan, { lock, stateRoot: 'state',
    index: oldIndex(), saveIndex: async () => {}, logicalTime: '2026-08-25T00:00:00Z', asOf: '2026-08-25',
    runId: 'run-conflict', taskId: 'task-upgrade', targetRoots: { business: 'business', active_tender: 'tender' } }),
  (error) => error.code === 'EVOLUTION_REBUILD_CONTENT_MISMATCH');
  assert(!vault.files.has(action.path), 'unsafe rebuild evidence must fail before production writes');
}

(async () => {
  await scenario(null);
  await scenario({ schema: 'eks/production-evolution-index/1', pipeline: 'eks/stable-production/phase6',
    binding_sha256: 'stale', records: [], graph: { facts: [] } });
  await unsafeOwnershipEvidenceStaysBlocked();
  if (!bundled) {
    const packaged = childProcess.spawnSync(process.execPath, [__filename], {
      env: { ...process.env, EKS_UPGRADE_BUNDLE: '1' }, encoding: 'utf8'
    });
    assert.strictEqual(packaged.status, 0, packaged.stderr || packaged.stdout);
  }
  console.log(`Upgrade compatibility regression (${bundled ? 'packaged main.js' : 'source'}): PASS`);
})().catch((error) => { console.error(error); process.exitCode = 1; });
