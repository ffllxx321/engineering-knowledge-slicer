'use strict';
const assert = require('assert');
const {
  canonicalizeDocument, inferProfile, segmentDocument, normalizeKnowledgeUnit,
  normalizeTags, routeUnit, planKnowledgeUnits, repairCoverage, relationEvidence,
  groupedReview, runUniversalPipeline
} = require('../src/universal-knowledge-pipeline.js');
const { buildPlan, emptyIndex, hash } = require('../src/structured-writer.js');

const base = {
  source_identity: 'logical-source-1', source_document_id: 'doc-1',
  source_path: '收件箱/资料.txt', source_hash: 'abc', title: '综合资料',
  metadata: { project_id: 'P-100', project_state: 'bidding' }
};
const block = (text, kind = 'paragraph', order = 0, extra = {}) => ({
  block_id: `b${order}`, kind, raw: { text }, parse: { status: 'present' },
  locator: { scheme: 'test', value: `b${order}` }, metadata: extra
});

function testCanonicalAndProfile() {
  const canonical = canonicalizeDocument({ ...base, source_type: 'future/x-unknown', blocks: [
    { kind: 'alien-layout', text: '必须在 2026年8月1日前完成。', locator: { page: 2 } }
  ] });
  assert.strictEqual(canonical.blocks[0].kind, 'text');
  assert.strictEqual(canonical.blocks[0].locator.page, 2);
  const profile = inferProfile(canonical);
  assert(profile.purposes.includes('requirement'));
  assert.strictEqual(profile.lifecycle, 'bidding');
  assert(profile.project_scope.includes('P-100'));
}

function testMixedSegmentationAndPlanning() {
  const result = runUniversalPipeline({ document: { ...base, blocks: [
    block('项目要求', 'heading', 0),
    block('本项目必须在 2026年8月1日前完成，责任人为李工。', 'paragraph', 1),
    block('通用施工方法', 'heading', 2),
    block('混凝土养护应覆盖保湿材料，持续时间不少于 7 天。', 'paragraph', 3),
    block('第 1 页', 'footer', 4),
    block('第 1 页', 'footer', 5)
  ] } });
  assert(result.regions.length >= 3);
  assert(result.knowledge_units.some((unit) => unit.route.library === 'active_tender'));
  assert(result.knowledge_units.some((unit) => unit.reusable && unit.route.library === 'business'));
  assert.strictEqual(result.telemetry.semantic_coverage, 1);
  assert(result.telemetry.llm_calls === 0);
  assert(Object.values(result.coverage).every((entry) => ['covered', 'merged', 'dropped'].includes(entry.status)));
}

function testBoundariesTagsRoutingRelations() {
  const unit = normalizeKnowledgeUnit({
    item_type: 'contract_obligation', summary: '承包人必须提交履约保函。',
    project_id: 'P-100', evidence: { block_id: 'b1', locator: { page: 1 }, verbatim: '承包人必须提交履约保函。' }
  }, { source_document_id: 'doc', lifecycle: 'bidding', authority: 'formal' });
  assert.strictEqual(unit.semantic_kind, 'commercial_term');
  assert.deepStrictEqual(normalizeTags(['质量管理', '品质', '进度', '工期']), ['质量', '时间']);
  assert.strictEqual(routeUnit(unit, { lifecycle: 'archived' }).library, 'business');
  const second = { ...unit, unit_id: 'other', entity_ids: ['E-1'], project_ids: [] };
  unit.entity_ids = ['E-1'];
  assert.strictEqual(relationEvidence([unit, second]).length, 1);
  const ambiguous = { ...unit, route: { ambiguous: true } };
  assert.strictEqual(groupedReview([ambiguous, { ...ambiguous, unit_id: '2' }]).length, 1);
}

function testCoverageRepair() {
  const document = canonicalizeDocument({ ...base, blocks: [block('必须检验钢筋。', 'paragraph', 0), block('风险：雨季延误。', 'paragraph', 1)] });
  const profile = inferProfile(document);
  const regions = segmentDocument(document);
  const partial = planKnowledgeUnits(document, profile, regions.slice(0, 1));
  const repaired = repairCoverage(document, profile, regions, partial);
  assert.strictEqual(repaired.repaired_region_ids.length, 1);
  assert.strictEqual(repaired.units.length, 2);
}

function semanticsFor(blocks, mediaType) {
  const result = runUniversalPipeline({ document: { ...base, media_type: mediaType, blocks } });
  return [...new Set(result.knowledge_units.map((unit) => `${unit.semantic_kind}:${unit.route.library}`))].sort();
}

function testCrossFormatEquivalence() {
  const sentence = '供应商必须在 2026年8月1日前提交材料合格证。';
  const variants = [
    ['application/pdf', [block(sentence)]],
    ['application/vnd.openxmlformats-officedocument.wordprocessingml.document', [block(sentence, 'paragraph')]],
    ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', [block(sentence, 'table_row', 0, { sheet: '要求' })]],
    ['message/rfc822', [block(sentence, 'email_body')]],
    ['text/plain', [block(sentence, 'text')]]
  ];
  const outputs = variants.map(([type, blocks]) => semanticsFor(blocks, type));
  outputs.slice(1).forEach((output) => assert.deepStrictEqual(output, outputs[0]));
}

function writerInput(result, index = emptyIndex(), existingFiles = {}, archiveTransition) {
  return {
    settings: {
      controlledWriterEnabled: true, structuredWriterMode: 'structured-write',
      structuredActiveRoot: '在办投标库', structuredBusinessRoot: '长期业务库',
      artifactsPath: '状态', structuredMaxRecords: 100, structuredMaxActions: 300
    },
    document: result.document, universalResult: result, phase3Result: { handling_groups: [] },
    projectRegistry: [{ project_id: 'P-100', name: '项目一', state: 'bidding' }],
    index, existingFiles, logicalTime: '2026-07-31T00:00:00.000Z', archiveTransition
  };
}

function testWriterEndToEndIdempotenceArchiveAndMarkdown() {
  const result = runUniversalPipeline({ document: { ...base, blocks: [block('本项目必须提交施工计划。')] } });
  const first = buildPlan(writerInput(result));
  assert(!first.blocked);
  assert(first.actions.length >= 3);
  const existing = Object.fromEntries(first.actions.map((action) => [action.path, action.content]));
  const index = emptyIndex();
  for (const action of first.actions) index.records[action.record_id] = {
    record_id: action.record_id, record_kind: action.record_kind, path: action.path,
    content_hash: action.content_hash
  };
  const second = buildPlan(writerInput(result, index, existing));
  assert(second.actions.every((action) => action.action === 'noop'));
  const item = first.actions.find((action) => action.record_kind === 'business_item');
  assert(item.content.includes('## 来源证据'));
  assert(!item.content.includes('{"scheme"'));
  const archived = buildPlan(writerInput(result, index, existing, {
    from: 'terminated', archive_outcome: 'terminated', archive_decided_at: '2026-07-31'
  }));
  assert(archived.actions.some((action) => action.path.startsWith('长期业务库/complete_historical_projects/')));
  assert(archived.actions.every((action) => existing[action.from_path] === undefined || action.record_id.includes(action.path.split('/').at(-1).replace('.md', ''))));
}

function testLegacyMigrationNoiseLongDenseAndCost() {
  const legacy = normalizeKnowledgeUnit({
    candidate_id: 'legacy-1', item_type: 'quotation', summary: '报价为 120 万元。',
    evidence: { block_id: 'old', locator: { scheme: 'legacy', value: 'old' }, verbatim: '报价为 120 万元。' }
  }, { source_document_id: 'legacy-doc' });
  assert.strictEqual(legacy.semantic_kind, 'commercial_term');
  const noise = runUniversalPipeline({ document: { ...base, blocks: [block('第 1 页', 'footer'), block('签名', 'paragraph', 1)] } });
  assert(noise.knowledge_units.length <= 1);
  const blocks = Array.from({ length: 180 }, (_, i) =>
    block(i % 3 === 0 ? `风险 R${i}：工期可能延误 ${i} 天。`
      : i % 3 === 1 ? `要求 Q${i}：必须检查材料型号 M-${100 + i}。`
        : `行动 A${i}：负责人应在 2026年8月${(i % 28) + 1}日完成。`, 'paragraph', i));
  const started = Date.now();
  const dense = runUniversalPipeline({ document: { ...base, blocks } });
  assert(dense.telemetry.llm_calls === 0);
  assert(dense.telemetry.planned_units <= dense.telemetry.semantic_regions);
  assert(Date.now() - started < 3000);
  assert.strictEqual(dense.cache_key, runUniversalPipeline({ document: { ...base, blocks } }).cache_key);
}

for (const test of [
  testCanonicalAndProfile, testMixedSegmentationAndPlanning, testBoundariesTagsRoutingRelations,
  testCoverageRepair, testCrossFormatEquivalence, testWriterEndToEndIdempotenceArchiveAndMarkdown,
  testLegacyMigrationNoiseLongDenseAndCost
]) test();
console.log('universal enterprise knowledge pipeline: ok');
