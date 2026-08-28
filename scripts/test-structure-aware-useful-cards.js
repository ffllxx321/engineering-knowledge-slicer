'use strict';
const assert = require('assert');
const { canonicalizeDocument, runUniversalPipeline } = require('../src/universal-knowledge-pipeline.js');
const { STRUCTURE_VERSION, validateStructureContext } = require('../src/structure-context.js');
const block = (id, kind, text, metadata = {}, extra = {}) => ({ block_id: id, kind, text, metadata, locator: { scheme: 'fixture', value: id, ...(extra.locator || {}) }, parse: { method: extra.parser || 'docx-ooxml-local', quality: extra.quality ?? 1 }, card_eligible: extra.eligible !== false });
const document = (blocks, extra = {}) => ({ source_document_id: 'neutral-structure-source', source_hash: 'a'.repeat(64), parser: extra.parser || 'docx-ooxml-local', filename: extra.filename || 'neutral.docx', blocks });
const run = (blocks, extra) => runUniversalPipeline({ document: document(blocks, extra), request_chunk_chars: extra?.chunk });
function contractValidation() {
  const source = document([block('h', 'heading', '安装要求', { outline_level: 0 }), block('p', 'paragraph', '以下要求适用于室内设备。'), block('a', 'list_item', '施工方必须检查接地。', { list: { num_id: '7', level: 0, template: '%1.' }, parent_clause_id: 'p' }), block('b', 'list_item', '施工方必须记录电阻值。', { list: { num_id: '7', level: 0, template: '%1.' }, parent_clause_id: 'p' })]);
  const canonical = canonicalizeDocument(source); assert.equal(canonical.structure.schema_version, STRUCTURE_VERSION); assert.equal(canonical.structure.nodes.filter((n) => n.kind === 'list_item').length, 2);
  const plans = run(source.blocks).card_plans.filter((p) => /施工方/.test(p.body)); assert.equal(plans.length, 2); assert(plans.every((p) => /室内设备/.test(p.body)));
  assert.throws(() => validateStructureContext({ ...canonical.structure, nodes: canonical.structure.nodes.map((n, i) => i ? n : { ...n, parent_id: n.node_id }) }), /无效|环/);
}
function markdownEquivalentAndTables() {
  const md = document([block('md', 'parsed-markdown', '# 安装要求\n\n以下要求适用于室内设备。\n\n1. 施工方必须检查接地。\n2. 施工方必须记录电阻值。\n\n| 设备 | 压力 (MPa) |\n| --- | --- |\n| A | 不得超过 2 MPa。 |\n| B | 不得超过 3 MPa。 |', {}, { parser: 'mineru-api' })], { parser: 'mineru-api' });
  const result = runUniversalPipeline({ document: md }); assert.equal(result.card_plans.filter((p) => /接地|电阻/.test(p.body)).length, 2);
  const rows = result.card_plans.filter((p) => /不得超过 [23] MPa/.test(p.body)); assert.equal(rows.length, 2); assert(rows.every((p) => /设备 \/ 压力/.test(p.body))); assert(!rows[0].body.includes('3 MPa'));
}
function pagesAndContinuation() {
  const unrelated = run([block('a', 'paragraph', '操作员必须佩戴护目镜。', { page: 1 }, { locator: { page: 1 }, parser: 'local-ocr:tesseract', quality: 0.55 }), block('b', 'paragraph', '车辆不得进入仓库。', { page: 2 }, { locator: { page: 2 }, parser: 'local-ocr:tesseract', quality: 0.55 })]); assert.equal(unrelated.card_plans.length, 2);
  const joined = run([block('c1', 'paragraph', '操作员必须在启动前检查设备。', {}, { locator: { page: 1 } }), block('c2', 'paragraph', '如果护罩松动，应先加固。', { continuation_of: 'c1', continuation_confidence: 0.91 }, { locator: { page: 2 } })]); assert.equal(joined.card_plans.length, 1); assert.deepStrictEqual(joined.card_plans[0].evidence_ids.sort(), ['c1', 'c2']);
  const ambiguous = run([block('u1', 'paragraph', '操作员必须在启动前检查设备。', {}, { locator: { page: 1 } }), block('u2', 'paragraph', '如果护罩松动，应先加固。', { continuation_of: 'u1', continuation_confidence: 0.6 }, { locator: { page: 2 } })]); assert.equal(ambiguous.card_plans.length, 2); assert.equal(ambiguous.generation_diagnostics.ambiguous_continuations, 1);
}
function modalityAndStability() {
  const base = [block('x', 'list_item', '甲方必须在 3 天内提交报告。', { list_id: 'n' }), block('y', 'list_item', '乙方宜在 5 天内提交报告。', { list_id: 'n' })]; const a = run(base, { filename: 'a.docx', chunk: 20 }); const b = run(base, { filename: 'renamed.docx', chunk: 9000 }); assert.equal(a.card_plans.length, 2); assert.deepStrictEqual(a.card_plans.map((p) => [p.plan_id, p.body]), b.card_plans.map((p) => [p.plan_id, p.body])); const inserted = run([...base, block('z', 'paragraph', '仓库存在积水风险。')]); assert.deepStrictEqual(a.card_plans.map((p) => p.plan_id), inserted.card_plans.slice(0, 2).map((p) => p.plan_id));
}
for (const test of [contractValidation, markdownEquivalentAndTables, pagesAndContinuation, modalityAndStability]) test();
console.log('structure-aware useful-card phase: ok');
