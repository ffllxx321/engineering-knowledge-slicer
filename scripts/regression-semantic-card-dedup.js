'use strict';

const assert = require('assert');
const { normalizeSemanticText } = require('../src/semantic-text.js');
const { generateUsefulCards } = require('../src/useful-card-generation.js');
const { normalizeKnowledgeUnit } = require('../src/universal-knowledge-pipeline.js');
const { buildPlan, emptyIndex, coalesceCanonicalUnits } = require('../src/structured-writer.js');

const sentence = '施工缝处必须设置止水钢板，厚度不得小于 3 mm。';
const variants = ['• 施工缝处必须设置止水钢板，厚度不得小于 3 mm。',
  '（1） 施工缝处必须设置止水钢板, 厚度不得小于 3 ｍｍ'];
assert.strictEqual(normalizeSemanticText(variants[0]), normalizeSemanticText(variants[1]));
assert.notStrictEqual(normalizeSemanticText(sentence), normalizeSemanticText(sentence.replace('3 mm', '4 mm')));
assert.notStrictEqual(normalizeSemanticText(sentence), normalizeSemanticText(sentence.replace('不得', '应')));
assert.notStrictEqual(normalizeSemanticText(sentence), normalizeSemanticText(sentence.replace('mm', 'cm')));

const locator = (page) => ({ scheme: 'page', value: String(page), page });
const block = (page, text = sentence) => ({ block_id: `page-${page}`, kind: 'paragraph', text,
  raw_verbatim: text, locator: locator(page), provenance: [locator(page)], hierarchy: ['防水施工'],
  card_eligible: true, metadata: {}, order: page });
const document = { source_identity: 'semantic-regression', source_document_id: 'semantic-doc',
  source_path: 'fixtures/representative.pdf', source_hash: 'a'.repeat(64), title: '代表性离线夹具',
  media_type: 'application/pdf', ingested_at: '2026-08-25T00:00:00.000Z', blocks: [block(1, variants[0]), block(2, variants[1])],
  structure: { schema_version: 'structure/1.0', adapter: 'fixture', nodes: [], edges: [] } };
const generated = generateUsefulCards(document, []);
assert.strictEqual(generated.plans.length, 1, 'cross-page semantic duplicate must produce one plan');
assert.strictEqual((generated.plans[0].body.match(/止水钢板/g) || []).length, 1, 'body must contain one semantic statement');

const route = { library: 'business', category: 'technical_methods_workmanship' };
const rawUnit = (id, page, statement = sentence, title = '施工缝止水要求') => ({ unit_id: id,
  fingerprint: `legacy-${id}`, title, subject: '施工缝止水', statement, original_statement: statement,
  translated_statement: statement, semantic_kind: 'requirement', scope: 'general', route, reusable: false,
  evidence: [{ block_id: `legacy-${page}`, locator: locator(page), provenance: [locator(page)], verbatim: page === 2 ? variants[1] : variants[0] }],
  source_language: 'zh', output_language: 'zh-CN', project_ids: [], tags: [], applicable_conditions: [], exceptions: [], uncertainty: [] });
const legacy = coalesceCanonicalUnits([rawUnit('old-page-1', 1), rawUnit('old-page-2', 2)]);
assert.strictEqual(legacy.length, 1, 'legacy canonical duplicate state must normalize on reuse');
assert.strictEqual(legacy[0].evidence.length, 1, 'same evidence excerpt must aggregate internally');
assert.strictEqual(legacy[0].evidence[0].locators.length, 2, 'all provenance locators must remain');

const settings = { controlledWriterEnabled: true, structuredWriterMode: 'structured-write',
  knowledgeTenderRoot: '知识/项目', knowledgeBusinessRoot: '知识/业务', artifactsPath: '状态' };
const result = { document, knowledge_units: [rawUnit('old-page-1', 1), rawUnit('old-page-2', 2)], relations: [], review_decisions: [] };
const writerInput = { settings, document, universalResult: result, phase3Result: { handling_groups: [] },
  projectRegistry: [], index: emptyIndex(), existingFiles: {}, logicalTime: '2026-08-25T00:00:00.000Z' };
const first = buildPlan(writerInput);
const knowledge = first.actions.filter((action) => action.record_kind === 'business_item');
assert.strictEqual(knowledge.length, 1);
assert(!knowledge[0].path.includes('（2）'), 'semantic duplicate must not allocate a suffixed path');
assert(knowledge[0].content.includes('第 1、2 页'), 'rendered excerpt must combine page locators');
assert.strictEqual((knowledge[0].content.match(/### 原文摘录/g) || []).length, 1, 'Markdown must render one excerpt');
assert.strictEqual((knowledge[0].content.match(/止水钢板/g) || []).length, 2, 'Markdown has one body statement and one excerpt');
const repeated = buildPlan(writerInput);
assert.deepStrictEqual(repeated.actions.map((item) => [item.record_id, item.path, item.content_hash]),
  first.actions.map((item) => [item.record_id, item.path, item.content_hash]), 'repeated runs must be deterministic');

const collisionResult = { ...result, knowledge_units: [
  { ...rawUnit('a', 1, '厚度不得小于 3 mm。', '同名要求'), subject: '止水钢板厚度' },
  { ...rawUnit('b', 2, '厚度不得小于 4 mm。', '同名要求'), subject: '保护层厚度' }
] };
const collision = buildPlan({ ...writerInput, universalResult: collisionResult });
const collisionPaths = collision.actions.filter((item) => item.record_kind === 'business_item').map((item) => item.path);
assert.strictEqual(collisionPaths.length, 2);
assert(collisionPaths.some((path) => path.includes('（2）')), 'true same-title collision must remain safely disambiguated');

const conditional = generateUsefulCards({ ...document, blocks: [block(1,
  '如果地下水位高于基础底面时，施工单位必须采用降水措施。')], structure: document.structure }, []);
assert(!conditional.plans[0].title.endsWith('时，施工单位方法'));
assert(!/^如果.{20,}方法$/.test(conditional.plans[0].title), 'conditional sentence must not become a long 方法 title');

const normalizedA = normalizeKnowledgeUnit(rawUnit('x', 1));
const normalizedB = normalizeKnowledgeUnit(rawUnit('y', 2));
assert.strictEqual(normalizedA.fingerprint, normalizedB.fingerprint, 'provenance must not affect semantic unit identity');

console.log('cross-page semantic card dedup regression: ok');
