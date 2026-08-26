'use strict';
const assert = require('assert');
const { expandInlineEnumerations, PRE_GENERATION_SEMANTIC_CONTRACT_VERSION,
  PRE_GENERATION_SEMANTIC_CONTRACT_FINGERPRINT } = require('../src/pre-generation-structure.js');
const { runUniversalPipeline, isReusableUniversalArtifact,
  reusableTranslationCache } = require('../src/universal-knowledge-pipeline.js');
const { buildPlan, emptyIndex } = require('../src/structured-writer.js');
const { markdownRecord, HybridRetriever } = require('../src/retrieval-core.js');

const settings = { controlledWriterEnabled: true, structuredWriterMode: 'structured-pilot', knowledgeBusinessRoot: '06-知识库/业务库', artifactsPath: '06-知识库/源文件/_slicer_artifacts', structuredMaxRecords: 100, structuredMaxActions: 300, structuredMaxLinkFanout: 20 };
const sourceTexts = new Map();
const block = (id, text) => {
  sourceTexts.set(id, text);
  return { block_id: id, kind: 'paragraph', raw: { text }, locator: { scheme: 'line', value: id }, parse: { method: 'local-text-blocks', quality: 1 } };
};
const positives = [
  block('zh-modalities', '  安全规则： （1）作业人员应检查接地； （2）作业人员不应拆除护罩；（3）现场禁止吸烟；(4)仓内严禁明火；5、主管可以批准停机；六、业主允许承包人延期。  '),
  block('en-normative', 'The following requirements apply: (1) The contractor must isolate power; (2) The owner may approve an extension.'),
  block('no-space-mixed', '检查要求：(1)操作员必须验电;(2)操作员不得送电；三、监护人应签字。')
];
const counterexamples = [
  ['decimals', 'Values are 1.6 MPa and 2.4 MPa.'],
  ['versions', 'Versions 1.2 and 2.3 remain supported.'],
  ['dates', 'Dates 2026.08.26 and 2027.01.01 are examples.'],
  ['clause-refs', '参见 1.2、2.3 和第 4.1 条。'],
  ['ips', 'Servers use 192.168.1.2 and 10.0.0.8.'],
  ['citations', 'Prior findings [1] and [2] explain the result.'],
  ['epistemic-may', 'Findings: (1) Corrosion may cause leakage; (2) Temperature may vary by season.'],
  ['zh-explanatory-can', '分析如下：（1）结果可以表明强度变化；（2）数据可以说明季节差异。']
].map(([id, text]) => block(id, text));

const expanded = expandInlineEnumerations([...positives, ...counterexamples]);
assert.deepStrictEqual(expanded.diagnostics, { paragraphs_expanded: 3, derived_list_items: 11 });
for (const [id] of counterexamples.map((item) => [item.block_id])) {
  assert(expanded.blocks.some((item) => item.block_id === id && item.kind === 'paragraph'), `${id} must remain flat`);
}
for (const derived of expanded.blocks.filter((item) => item.metadata?.inline_enumeration || item.metadata?.inline_enumeration_preamble)) {
  const original = sourceTexts.get(derived.metadata.original_source_block_id);
  const [, start, end] = /^chars=(\d+)-(\d+)$/.exec(derived.locator.fragment).map(Number);
  assert.strictEqual(original.slice(start, end), derived.raw.text, `${derived.block_id} exact source span`);
  assert.strictEqual(derived.raw.text, derived.raw.text.trim(), `${derived.block_id} span is trimmed`);
}

const document = { source_document_id: 'pre-generation-final-review', source_hash: 'f'.repeat(64), filename: 'normative.txt', blocks: [...positives, ...counterexamples] };
const result = runUniversalPipeline({ document });
assert.deepStrictEqual(result.document.pre_generation_semantic_contract, {
  version: PRE_GENERATION_SEMANTIC_CONTRACT_VERSION,
  fingerprint: PRE_GENERATION_SEMANTIC_CONTRACT_FINGERPRINT
});
assert(isReusableUniversalArtifact(result, document.source_hash));
const legacy = structuredClone(result);
delete legacy.document.pre_generation_semantic_contract;
assert.strictEqual(isReusableUniversalArtifact(legacy, document.source_hash), false, '737d6e0-style canonical must be rejected');
assert.strictEqual(isReusableUniversalArtifact(result, 'different-source'), false);
const wrongSourceLegacy = structuredClone(legacy);
wrongSourceLegacy.document.source_hash = '0'.repeat(64);
wrongSourceLegacy.translation_cache = { unsafe: { translated_text: '不得复用' } };
legacy.translation_cache = { safe: { translated_text: '可以复用' } };
assert.deepStrictEqual(reusableTranslationCache(null, legacy, document.source_hash), legacy.translation_cache);
assert.deepStrictEqual(reusableTranslationCache(null, wrongSourceLegacy, document.source_hash), {},
  'cross-source translation caches must not survive selective regeneration');

const zhEvents = result.knowledge_events.filter((event) => event.source_context.parent_clause_text === '安全规则:');
assert.deepStrictEqual(zhEvents.map((event) => event.modality), ['应', '不应', '禁止', '严禁', '可以', '允许']);
assert(zhEvents.every((event) => event.semantic_type === 'requirement'));
assert.strictEqual(zhEvents[1].predicate, '(2)作业人员不应拆除护罩;');
assert.strictEqual(zhEvents[3].predicate, '(4)仓内严禁明火;');
const english = result.knowledge_events.filter((event) => event.source_context.parent_clause_text === 'The following requirements apply:');
assert.deepStrictEqual(english.map((event) => [event.semantic_type, event.modality]), [['requirement', 'must'], ['requirement', 'may']]);
assert(!result.document.blocks.some((item) => item.block_id.startsWith('epistemic-may:inline-')));

const plans = result.card_plans;
assert(plans.some((plan) => plan.title === '作业人员不应拆除护罩要求'
  && plan.body === '要求：作业人员不应拆除护罩;\n适用范围：安全规则:'));
assert(plans.some((plan) => plan.body === '要求：The owner may approve an extension.\n适用范围：The following requirements apply:'));
assert(plans.some((plan) => plan.search_title === '主管可以批准停机'));

const plan = buildPlan({ settings, document, universalResult: result, index: emptyIndex(), existingFiles: {}, logicalTime: '2026-08-26T00:00:00.000Z' });
assert(!plan.blocked);
const records = plan.actions.filter((action) => ['business_item', 'company_knowledge'].includes(action.record_kind))
  .map((action, index) => markdownRecord(action.content, `final-review-${index}.md`));
for (const evidence of records.flatMap((record) => record.evidence).filter((item) => /^chars=/.test(item.locator?.fragment || ''))) {
  const canonical = result.document.blocks.find((item) => item.raw_verbatim === evidence.raw_verbatim
    && item.locator.fragment === evidence.locator.fragment);
  assert(canonical, `canonical evidence for ${evidence.raw_verbatim}`);
  const original = sourceTexts.get(canonical.metadata.original_source_block_id);
  const [, start, end] = /^chars=(\d+)-(\d+)$/.exec(evidence.locator.fragment).map(Number);
  assert.strictEqual(original.slice(start, end), evidence.raw_verbatim);
  assert.strictEqual(evidence.raw_verbatim, canonical.raw_verbatim);
}
assert(records.some((record) => record.title === '主管要求' && record.body.includes('主管可以批准停机')));
const retriever = new HybridRetriever(records);
Promise.all([
  retriever.search('谁可以批准停机', { limit: 3 }),
  retriever.search('业主是否允许承包人延期', { limit: 3 }),
  retriever.search('操作员不得送电', { limit: 3 })
]).then(([approval, extension, energize]) => {
  assert(approval.some((hit) => hit.record.title === '主管要求' && hit.record.evidence.some((item) => item.raw_verbatim === '5、主管可以批准停机；')));
  assert(extension.some((hit) => hit.record.title === '业主允许承包人延期要求' && hit.record.body.includes('安全规则')));
  assert(energize.some((hit) => hit.record.title === '操作员要求'
    && hit.record.search_title === '操作员不得送电'
    && hit.record.evidence.some((item) => item.raw_verbatim === '(2)操作员不得送电；')));
  console.log('pre-generation final-review regression: contract reuse, modalities, exact spans, Markdown reload, natural facts, and counterexamples passed');
}).catch((error) => { console.error(error.stack || error); process.exitCode = 1; });
