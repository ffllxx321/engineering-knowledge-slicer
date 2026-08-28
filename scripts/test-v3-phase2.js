'use strict';
const assert = require('assert'); const path = require('path');
const { V3Phase1Orchestrator, V3Phase2CandidateOrchestrator, PHASE2_MANIFEST_PATH, cacheKey, eligible, extractFacts,
  stableCandidateId, consolidate } = require('../src/v3');
class Vault { constructor(initial = {}) { this.files = new Map(Object.entries(initial)); this.folders = new Set(); this.fail = {}; }
  file(p) { return { path: p, name: path.basename(p), basename: path.basename(p, path.extname(p)), extension: path.extname(p).slice(1) }; }
  getAbstractFileByPath(p) { return this.files.has(p) ? this.file(p) : this.folders.has(p) ? { path: p, children: [] } : null; }
  async readBinary(f) { return Buffer.from(this.files.get(f.path)); } async read(f) { if (this.fail.reopen && f.path.endsWith('.preview.md')) throw new Error('reopen'); return String(this.files.get(f.path)); }
  async createFolder(p) { this.folders.add(p); } async create(p, v) { if (this.fail.write && p.includes('v3-phase2')) throw new Error('write failure'); this.files.set(p, v); return this.file(p); }
  async modify(f, v) { if (this.fail.write && f.path.includes('v3-phase2')) throw new Error('write failure'); this.files.set(f.path, v); }
  async rename(f, p) { const v = this.files.get(f.path); this.files.delete(f.path); this.files.set(p, v); } async delete(f) { this.files.delete(f.path); } }
const proposal = (block, title = '施工要求') => ({ title_zh: title, body_zh: `应遵守原文要求：${block.content}`, knowledge_kind: 'requirement', reusable_scope: 'general', block_ids: [block.id], evidence: { [block.id]: block.content },
  translation_status: /[A-Za-z]/.test(block.content) ? 'translated' : 'original_zh', confidence: { evidence: 1, completeness: .9, translation: .8 }, warnings: [] });
class Fake { constructor(mode = 'ok') { this.mode = mode; this.calls = 0; } async request(input) { this.calls++; if (this.mode === 'timeout') throw new Error('timeout'); if (this.mode === 'malformed') return '{';
  const data = JSON.parse(input.slice(input.indexOf('\n\n') + 2)); if (this.mode === 'fabricated') return { proposals: [{ ...proposal(data.blocks[0]), block_ids: ['fake'] }], rejections: [] };
  if (this.mode === 'drift') { const p = proposal(data.blocks[0]); p.body_zh = '厚度应为 99mm'; p.evidence[data.blocks[0].id] = '厚度应为 99mm'; return { proposals: [p], rejections: [] }; }
  return { proposals: data.blocks.map((b) => proposal(b)), rejections: [] }; } }
async function setup(text = '# 安全要求\n\n混凝土保护层厚度必须为 35mm，验收日期为 2026-08-04。\n\nPage 2\n\nWorkers must inspect scaffolds every 7 days.\n\n日本語の安全帯は2回点検する。') {
  const v = new Vault({ 'fixtures/mixed.md': text }); await new V3Phase1Orchestrator(v).process(v.file('fixtures/mixed.md'), 'p1'); return v; }
async function fails(p, pattern) { let e; try { await p; } catch (x) { e = x; } assert(e); assert.match(e.message, pattern); return e; }
(async () => {
  assert.strictEqual(eligible({ content: 'unsubscribe now' }), '营销退订或跟踪噪声不可作为知识');
  assert.deepStrictEqual(extractFacts('35mm，2026-08-04，GB 50010 第3.2条').map((x) => x.value), ['35mm', '2026-08-04', 'GB 50010 第3.2条']);
  assert.strictEqual(cacheKey('a', 'b', 'c', 'd'), cacheKey('a', 'b', 'c', 'd')); assert.notStrictEqual(cacheKey('a', 'b', 'c', 'd'), cacheKey('x', 'b', 'c', 'd'));
  const c = { source: { sha256: 'x' }, evidence: [{ block_id: 'b' }], title_zh: '标题', body_zh: '正文', facts: [] }; assert.strictEqual(stableCandidateId(c), stableCandidateId(c));
  const conflict = consolidate([{ ...c, schema: 'eks/v3/candidate/1', id: '1', knowledge_kind: 'requirement', reusable_scope: 'general', evidence: [{ block_id: 'b' }], facts: [{ type: 'number_unit', value: '1mm' }], warnings: [] },
    { ...c, schema: 'eks/v3/candidate/1', id: '2', knowledge_kind: 'requirement', reusable_scope: 'general', evidence: [{ block_id: 'b' }], facts: [{ type: 'number_unit', value: '2mm' }], warnings: [] }]); assert.strictEqual(conflict.length, 2);
  const vault = await setup(); const fake = new Fake(); const run = await new V3Phase2CandidateOrchestrator(vault, { provider: fake, model: 'fake-v1', batchSize: 2 }).processLatest('p2');
  assert.strictEqual(run.manifest.state, 'committed'); assert(run.artifact.candidates.length >= 3); assert(run.artifact.rejected.some((r) => /页眉页脚/.test(r.reason_zh)));
  assert(run.artifact.candidates.every((item) => /[\u3400-\u9fff]/u.test(item.title_zh + item.body_zh) && item.evidence.length));
  assert.strictEqual(await V3Phase2CandidateOrchestrator.completionFromManifest(vault), true); const calls = fake.calls;
  const duplicate = await new V3Phase2CandidateOrchestrator(vault, { provider: fake, model: 'fake-v1', batchSize: 2 }).processLatest('p2-repeat'); assert.strictEqual(fake.calls, calls); assert.deepStrictEqual(duplicate.artifact.candidates.map((x) => x.id), run.artifact.candidates.map((x) => x.id));
  const restart = new V3Phase2CandidateOrchestrator(vault); assert.strictEqual(await V3Phase2CandidateOrchestrator.completionFromManifest(restart.vault), true);
  const manifest = JSON.parse(vault.files.get(PHASE2_MANIFEST_PATH)); vault.files.set(manifest.final.preview.path, `${vault.files.get(manifest.final.preview.path)}tamper`); assert.strictEqual(await V3Phase2CandidateOrchestrator.completionFromManifest(vault), false);
  for (const mode of ['malformed', 'timeout', 'fabricated', 'drift']) { const bad = await setup(); await fails(new V3Phase2CandidateOrchestrator(bad, { provider: new Fake(mode), model: `fake-${mode}` }).processLatest(), /JSON|timeout|虚构证据|没有通过质量门/); assert.strictEqual(await V3Phase2CandidateOrchestrator.completionFromManifest(bad), false); }
  const invalid = await setup(); const p1 = [...invalid.files.keys()].find((p) => p.endsWith('.json') && p.includes('verified-artifacts')); invalid.files.set(p1, `${invalid.files.get(p1)}changed`); await fails(new V3Phase2CandidateOrchestrator(invalid, { provider: new Fake() }).processLatest(), /Phase 1/);
  const partial = await setup('第一项必须为 5mm。\n\n第二项必须为 6mm。'); let n = 0; await fails(new V3Phase2CandidateOrchestrator(partial, { model: 'partial', batchSize: 1, provider: { request: async (input) => { n++; if (n === 2) throw new Error('partial failure'); return new Fake().request(input); } } }).processLatest(), /partial failure/);
  const resumed = await new V3Phase2CandidateOrchestrator(partial, { model: 'partial', batchSize: 1, provider: new Fake() }).processLatest('resume'); assert.strictEqual(resumed.manifest.state, 'committed'); assert(resumed.manifest.attempts.some((a) => a.status === 'skipped'));
  const write = await setup(); write.fail.write = true; await fails(new V3Phase2CandidateOrchestrator(write, { provider: new Fake() }).processLatest(), /write failure/);
  console.log('v3 Phase 2 contracts and counterexamples: PASS');
})().catch((e) => { console.error(e); process.exitCode = 1; });
