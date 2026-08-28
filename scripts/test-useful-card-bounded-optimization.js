'use strict';

const assert = require('assert');
const path = require('path');
const { runUniversalPipeline } = require('../src/universal-knowledge-pipeline.js');
const { buildPlan, emptyIndex, coalesceCanonicalUnits } = require('../src/structured-writer.js');
const { normalizeSemanticText } = require('../src/semantic-text.js');
const { markdownRecord, HybridRetriever } = require('../src/retrieval-core.js');

const loc = (value, page = 1) => ({ scheme: 'fixture', value, page });
const block = (block_id, text, kind = 'paragraph', metadata = {}, hierarchy = []) => ({ block_id, text, kind, metadata, hierarchy, locator: loc(block_id), raw_verbatim: text });
const document = { source_identity: 'bounded-audit-v1', source_document_id: 'bounded-audit-v1', source_hash: 'b'.repeat(64),
  source_path: 'fixtures/sanitized-bounded-audit.md', filename: 'sanitized-bounded-audit.md', title: '脱敏工程卡片审计', media_type: 'text/markdown', metadata: { library: 'business' }, blocks: [
    block('condition-method', '当环境温度低于 5 °C 时，养护应采用保温覆盖方法。', 'paragraph', {}, ['冬期养护']),
    block('numeric-siblings', '泵压力不得低于 0.25 MPa。泵压力不得高于 0.60 MPa。', 'paragraph', {}, ['泵运行']),
    block('scope', '以下要求适用于 A 区室内管线。', 'paragraph', {}, ['管线安装']),
    block('scope-a', '施工方必须检查支架间距。', 'list_item', { parent_clause_id: 'scope', scope_id: 'A区室内管线' }, ['管线安装']),
    block('scope-b', '施工方必须记录阀门编号。', 'list_item', { parent_clause_id: 'scope', scope_id: 'A区室内管线' }, ['管线安装']),
    block('procedure-1', '1. 关闭入口阀。', 'list_item', { list_id: 'shutdown', sequence: 1, knowledge_event_type: 'procedure' }, ['循环泵停机']),
    block('procedure-2', '2. 停止电机。', 'list_item', { list_id: 'shutdown', sequence: 2, knowledge_event_type: 'procedure' }, ['循环泵停机']),
    block('table-row', '风机 B | 不超过 75 | 不超过 3.5', 'table_row', { table_headers: ['设备', '轴承温度 (°C)', '振动速度 (mm/s)'] }, ['风机参数']),
    block('duplicate-table-headers', '泵A | 1.0 | 2.0', 'table_row', { table_headers: ['设备', '压力 (MPa)', '压力 (MPa)'] }, ['泵参数']),
    block('already-unitized-table-row', '风机 C | 75°C | 3.5mm/s', 'table_row', { table_headers: ['设备', '轴承温度 (°C)', '振动速度 (mm/s)'] }, ['风机参数']),
    block('alias', '变频驱动器（Variable Frequency Drive，VFD）是指调节电机转速的装置。', 'paragraph', {}, ['术语']),
    block('condition-exception', '如果液位低于下限，操作员必须停止水泵；但消防模式除外。', 'paragraph', {}, ['水泵保护'])
    ,block('markdown-heading', '# - [ ] 安全/检查:*?', 'heading')
    ,block('heading-child', '- [ ] 检查员必须复核防护网固定。', 'list_item', {}, ['# - [ ] 安全/检查:*?'])
  ] };
const settings = { controlledWriterEnabled: true, structuredWriterMode: 'structured-write', knowledgeTenderRoot: '知识/项目', knowledgeBusinessRoot: '知识/业务', artifactsPath: '状态' };

function produce(existingFiles = {}, index = emptyIndex()) {
  const result = runUniversalPipeline({ document });
  const plan = buildPlan({ settings, document, universalResult: result, projectRegistry: [], index, existingFiles, logicalTime: '2026-08-25T00:00:00.000Z' });
  return { result, plan, cards: plan.actions.filter((action) => ['business_item', 'company_knowledge'].includes(action.record_kind)) };
}

const first = produce();
const byEvidence = (id) => first.result.card_plans.filter((card) => card.evidence_ids.includes(id));
assert.strictEqual(byEvidence('condition-method').length, 1, 'condition sentence and governed method stay together');
assert(!/^当.{20,}(?:方法|要求)$/.test(byEvidence('condition-method')[0].title), 'title is concise object plus intent');
assert.strictEqual(byEvidence('numeric-siblings').length, 2, 'independent same-heading numeric requirements do not merge');
assert.strictEqual(byEvidence('scope-a').length, 1); assert.strictEqual(byEvidence('scope-b').length, 1);
assert.notStrictEqual(byEvidence('scope-a')[0].plan_id, byEvidence('scope-b')[0].plan_id, 'governing scope does not merge siblings');
assert(byEvidence('scope-a')[0].body.includes('A 区室内管线') || byEvidence('scope-a')[0].body.includes('以下要求适用'));
const procedure = byEvidence('procedure-1')[0]; assert.strictEqual(procedure.plan_id, byEvidence('procedure-2')[0].plan_id);
assert(procedure.body.indexOf('关闭入口阀') < procedure.body.indexOf('停止电机'), 'ordered procedure order is retained');
const table = byEvidence('table-row'); assert.strictEqual(table.length, 2, 'each table value column is atomic');
assert(table.some((card) => /风机 B.*轴承温度.*75 °C/s.test(`${card.search_title}\n${card.body}`)));
assert(table.some((card) => /风机 B.*振动速度.*3.5 mm\/s/s.test(`${card.search_title}\n${card.body}`)));
assert(table.every((card) => !/[\/()（）]|参数参数/.test(card.title)), 'table display titles are natural and unit-free');
const duplicateHeaders = byEvidence('duplicate-table-headers');
assert.strictEqual(duplicateHeaders.length, 2, 'repeated positional headers still produce one atomic card per value column');
assert(duplicateHeaders.every((card) => card.semantic_type !== 'unknown' && /泵A.*压力.*(?:1\.0|2\.0) MPa/s.test(`${card.search_title}\n${card.body}`)));
const alreadyUnitized = byEvidence('already-unitized-table-row');
assert.strictEqual(alreadyUnitized.length, 2);
const unitizedText = alreadyUnitized.map((card) => `${card.search_title}\n${card.body}`).join('\n');
assert(/75°C/.test(unitizedText) && !/75°C\s+°C/.test(unitizedText), 'attached temperature unit is preserved exactly once');
assert(/3\.5mm\/s/.test(unitizedText) && !/3\.5mm\/s\s+mm\/s/.test(unitizedText), 'attached vibration unit is preserved exactly once');
const alias = byEvidence('alias')[0]; assert.deepStrictEqual(alias.aliases, ['Variable Frequency Drive', 'VFD']);
assert(alias.aliases.every((item) => ![alias.title, alias.search_title].some((value) => normalizeSemanticText(value) === normalizeSemanticText(item))));
for (const card of first.result.card_plans) {
  assert.notStrictEqual(normalizeSemanticText(card.title), normalizeSemanticText(card.search_title), 'search title adds normalized-distinct retrieval text');
  assert.strictEqual(new Set(card.aliases.map(normalizeSemanticText)).size, card.aliases.length, 'aliases have no normalized collision');
  assert(!/(要求：要求：|方法：方法：|参数：参数：)/.test(card.body), 'body has no repeated label prefix');
  assert(!/原文|证据|fixture/.test(card.body), 'body is evidence-free');
}
const governed = byEvidence('condition-exception')[0]; assert.strictEqual(byEvidence('condition-exception').length, 1);
assert(/如果液位低于下限/.test(governed.body) && /消防模式除外/.test(governed.body));
assert.strictEqual((governed.body.match(/如果液位低于下限/g) || []).length, 1, 'condition is not repeated');
assert.strictEqual((governed.body.match(/消防模式除外/g) || []).length, 1, 'exception is not repeated');
const headingChild = byEvidence('heading-child')[0];
assert(headingChild && !/^(?:#|[-*•]|\[[ xX]\])/.test(headingChild.title), 'Markdown/list/task boundaries never enter canonical title');
assert(!headingChild.title.includes('安全/检查'), 'section heading is inherited context, not the child canonical title');

assert(first.cards.length > 0); for (const action of first.cards) {
  assert(action.path.endsWith('.md') && !/[<>:"|?*]/.test(action.path.split('/').at(-1)));
  assert(action.content.startsWith('---\n') && action.content.includes('\n---\n\n# '));
  const record = markdownRecord(action.content, action.path); assert(record.title && record.search_title);
  assert(record.evidence.some((item) => item.locator?.value), 'serialized card retains a locator');
}
const retrieved = new HybridRetriever(first.cards.map((action) => markdownRecord(action.content, action.path))).lexical('风机 B 振动速度 3.5 mm/s').slice(0, 1);
assert(retrieved[0] && /振动速度/.test(`${retrieved[0].record.search_title}\n${retrieved[0].record.body}`), 'normalized-distinct retrieval terms find the atomic column');

const variants = ['厚度不得小于 3 mm。', '厚度不得小于 4 mm。', '厚度应小于 3 mm。', '厚度不得小于 3 cm。'];
const legacy = variants.map((statement, index) => ({ unit_id: `legacy-${index}`, fingerprint: `legacy-${index}`, title: '标题：止水要求要求', search_title: index ? '止水要求' : '止水要求。', aliases: ['止水要求。', 'WATERSTOP'], subject: '止水板', statement,
  semantic_kind: 'requirement', scope: index === 3 ? 'B区' : 'A区', route: { library: 'business', category: 'technical_methods_workmanship' }, evidence: [{ locator: loc(`legacy-${index}`), verbatim: statement }], project_ids: [] }));
const reused = coalesceCanonicalUnits(legacy); assert.strictEqual(reused.length, 4, 'number, negation/modality, unit, and scope remain negative non-merges');
assert(reused.every((unit) => unit.title === '止水要求' && unit.aliases.length === 1), 'legacy canonical reuse receives presentation normalization');
const tableColumns = new Set(table.map((card) => normalizeSemanticText(card.search_title))); assert.strictEqual(tableColumns.size, 2, 'table columns remain negative non-merges');

const repeated = produce(); assert.deepStrictEqual(repeated.cards.map((a) => [a.path, a.content_hash]), first.cards.map((a) => [a.path, a.content_hash]), 'deterministic rerun');
const restartIndex = emptyIndex(); for (const action of first.plan.actions) restartIndex.records[action.record_id] = { record_id: action.record_id, record_kind: action.record_kind, path: action.path, content_hash: action.content_hash, owner_source_id: action.owner_source_id };
const restart = produce(Object.fromEntries(first.plan.actions.filter((a) => a.content).map((a) => [a.path, a.content])), restartIndex);
assert(restart.plan.actions.filter((action) => ['business_item', 'company_knowledge'].includes(action.record_kind)).every((action) => action.action === 'noop'), 'restart/cache reuse does not rewrite canonical cards');
const renamedResult = structuredClone(first.result); const renamedUnit = renamedResult.knowledge_units.find((unit) => unit.card_plan?.evidence_ids.includes('heading-child'));
renamedUnit.title = '# - [ ] 防护网/固定:*?复核'; renamedUnit.search_title = '检查员如何复核防护网固定'; renamedUnit.aliases = ['防护网固定复核', '检查员如何复核防护网固定'];
const renamedPlan = buildPlan({ settings, document, universalResult: renamedResult, projectRegistry: [], index: restartIndex,
  existingFiles: Object.fromEntries(first.plan.actions.map((action) => [action.path, action.content])), logicalTime: '2026-08-25T00:00:00.000Z' });
const renamedAction = renamedPlan.actions.find((action) => /防护网/.test(action.record_snapshot?.title || ''));
assert(renamedAction && renamedAction.from_path && /move/.test(renamedAction.action), 'canonical title update safely renames the indexed file on rerun');
assert(!/[<>:"|?*#]/.test(path.basename(renamedAction.path)) && !path.basename(renamedAction.path).startsWith('-'), 'renamed path is boundary and filename safe');
assert(!renamedAction.content.includes('aliases: ["检查员如何复核防护网固定"'), 'aliases do not duplicate search_title');
const manuallyMovedPath = `知识/业务/用户整理/${path.basename(first.plan.actions.find((action) => action.record_id === renamedAction.record_id).path)}`;
const manuallyMovedIndex = structuredClone(restartIndex); manuallyMovedIndex.records[renamedAction.record_id].path = manuallyMovedPath;
const manuallyMovedFiles = Object.fromEntries(first.plan.actions.map((action) => [
  action.record_id === renamedAction.record_id ? manuallyMovedPath : action.path, action.content]));
const manualPlan = buildPlan({ settings, document, universalResult: renamedResult, projectRegistry: [], index: manuallyMovedIndex,
  existingFiles: manuallyMovedFiles, logicalTime: '2026-08-25T00:00:00.000Z' });
const manualAction = manualPlan.actions.find((action) => action.record_id === renamedAction.record_id);
assert(manualAction && manualAction.path === manuallyMovedPath && !manualAction.from_path && manualAction.action === 'update',
  'a user-manually-moved generated card is updated in place instead of unexpectedly renamed');
console.log('bounded useful-card ten-case production audit: ok');
