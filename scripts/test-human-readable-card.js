'use strict';

const assert = require('assert');
const { runUniversalPipeline } = require('../src/universal-knowledge-pipeline');
const { buildPlan, emptyIndex, hash, commitPlan, rollbackTransaction } = require('../src/structured-writer');
const { markdownRecord } = require('../src/retrieval-core');
const { prepareProductionEvolution, verifyProductionEvolution } = require('../src/production-evolution');

const sourceName = '城市居家适老化改造指导手册.pdf';
const raw = '（2）沙发倾斜角度不宜过大，座面不宜过软过深，茶几高度应略高于沙发，以便老人起身支撑。';
const document = { source_identity: 'real-card-fixture-v1', source_document_id: 'real-card-fixture-v1',
  source_hash: 'a'.repeat(64), source_path: `资料/${sourceName}`, filename: sourceName, title: '城市居家适老化改造指导手册', media_type: 'application/pdf', metadata: { library: 'business' }, blocks: [
    { block_id: 'living-room-2', kind: 'list_item', text: '（2）沙发倾斜角度不宜过大，座面不宜过软过深，茶几高度应略高于沙发，以便老人起身支撑。', raw_verbatim: raw,
      metadata: { list_id: 'living-room' }, hierarchy: ['起居厅改造要求'], locator: { scheme: 'page', page: 18, heading_path: ['起居厅改造要求'] } }
  ] };
const settings = { controlledWriterEnabled: true, structuredWriterMode: 'structured-write', knowledgeBusinessRoot: '06-知识库/业务库', artifactsPath: '状态' };
class Vault { constructor(files = {}) { this.files = new Map(Object.entries(files)); } async readIfExists(p) { return this.files.has(p) ? this.files.get(p) : null; } async write(p,c) { this.files.set(p,c); } async rename(a,b) { assert(this.files.has(a)); this.files.set(b,this.files.get(a)); this.files.delete(a); } async mkdirp() {} }
const lock = () => ({ acquire: async () => () => {} });

async function main() {
  const result = runUniversalPipeline({ document });
  const event = result.knowledge_events[0]; const card = result.card_plans[0];
  assert.strictEqual(event.subject, '沙发倾斜角度'); assert.deepStrictEqual(event.parameters, []); assert.strictEqual(event.modality, '不宜');
  assert(card.title.includes('沙发倾斜角度') && card.title !== card.search_title); assert.deepStrictEqual(card.aliases, []);
  const plan = buildPlan({ settings, document, universalResult: result, index: emptyIndex(), existingFiles: {}, logicalTime: '2026-08-24T02:47:02.504Z' });
  const knowledge = plan.actions.find(a => ['business_item','company_knowledge'].includes(a.record_kind)); const source = plan.actions.find(a => a.record_kind === 'source_document');
  assert(!knowledge.path.includes(knowledge.record_id)); assert(!source.path.includes(source.record_id)); assert(source.path.endsWith(`${sourceName}.md`), source.path);
  assert(knowledge.content.includes('2026-08-24T10:47:02.504+08:00')); assert(knowledge.content.includes(`|${sourceName}]]`));
  assert(!knowledge.content.includes('归属来源：') && knowledge.content.indexOf('记录编号：') > knowledge.content.indexOf('<details>'));
  const contentSection = knowledge.content.match(/## 内容\n\n([\s\S]*?)(?=\n## )/)?.[1] || '';
  const sourceSection = knowledge.content.match(/## 来源\n\n([\s\S]*?)(?=\n## |\n<details>)/)?.[1] || '';
  const relationSection = knowledge.content.match(/## 关系\n\n([\s\S]*?)(?=\n## |\n<details>)/)?.[1] || '';
  const traceSection = knowledge.content.match(/<details>\n<summary>技术追溯<\/summary>\n\n([\s\S]*?)\n<\/details>/)?.[1] || '';
  assert(/^\- \*\*要求：\*\* 沙发倾斜角度/.test(contentSection), knowledge.content);
  assert(!contentSection.includes('(2)') && !contentSection.includes('（2）'));
  assert(sourceSection.includes(`- 来源文件：[[`) && sourceSection.includes('### 原文摘录'));
  assert(sourceSection.includes(`> ${raw}`), knowledge.content);
  assert(!relationSection.includes('derived_from'), knowledge.content);
  assert(traceSection.split('\n').filter(Boolean).every((line) => line.startsWith('- ')), knowledge.content);
  assert(/^- 定位数据：base64url:/m.test(traceSection), knowledge.content);
  const parsed = markdownRecord(knowledge.content, knowledge.path); assert.strictEqual(parsed.id, knowledge.record_id); assert.strictEqual(parsed.evidence[0].text, raw.normalize('NFKC'));
  const legacyTrace = knowledge.content.replace('- 定位数据：base64url:', '定位数据：base64url:');
  assert.deepStrictEqual(markdownRecord(legacyTrace, knowledge.path).evidence[0].locator, parsed.evidence[0].locator);
  const legacy = knowledge.path.replace(/[^/]+$/, `${knowledge.record_id}.md`); const oldContent = knowledge.content;
  const index = emptyIndex(); index.records[knowledge.record_id] = { record_id: knowledge.record_id, record_kind: knowledge.record_kind, path: legacy, content_hash: hash(oldContent) };
  const retry = buildPlan({ settings, document, universalResult: result, index, existingFiles: { [legacy]: oldContent }, logicalTime: '2026-08-24T02:47:02.504Z' });
  const moving = retry.actions.find(a => a.record_id === knowledge.record_id); assert.strictEqual(moving.from_path, legacy); assert(/move/.test(moving.action));
  const collision = buildPlan({ settings, document, universalResult: result, index: emptyIndex(), existingFiles: { [knowledge.path]: '---\nrecord_id: "other"\n---\n' }, logicalTime: '2026-08-24T02:47:02.504Z' });
  assert(collision.actions.some(a => /（2）\.md$/.test(a.path)));
  const evolution = prepareProductionEvolution(retry, { as_of: '2026-08-24' }); const evolved = evolution.index.records.map(r => ({ record_id:r.record_id, content_hash:r.content_hash }));
  assert(verifyProductionEvolution(evolution.index, evolved)); assert(evolution.index.graph.facts.some(f => f.evidence.some(e => e.raw_verbatim === raw)));
  const vault = new Vault({ [legacy]: oldContent }); let saved = index;
  const committed = await commitPlan(retry, { vault, lock: lock(), stateRoot: '状态', index, logicalTime: '2026-08-24T02:47:02.504Z', runId: 'human-card', saveIndex: async x => { saved=x; } });
  assert(vault.files.has(moving.path) && !vault.files.has(legacy));
  await rollbackTransaction(committed.manifest, { vault, lock: lock(), stateRoot: '状态', saveIndex: async x => { saved=x; } });
  assert(vault.files.has(legacy) && !vault.files.has(moving.path) && saved.records[knowledge.record_id].path === legacy);
  const legacyMarkdown = `---\nrecord_id: "legacy-card"\ntitle: "旧卡标题"\n---\n# 旧卡标题\n\n> 旧证据`;
  assert.strictEqual(markdownRecord(legacyMarkdown, 'ck-old.md').title, '旧卡标题');
  console.log('human-readable real card golden: ok');
}
main().catch(e => { console.error(e.stack || e); process.exitCode=1; });
