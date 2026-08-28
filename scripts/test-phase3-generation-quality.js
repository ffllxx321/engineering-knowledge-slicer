'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { runUniversalPipeline } = require('../src/universal-knowledge-pipeline');
const { buildPlan, emptyIndex } = require('../src/structured-writer');
const { markdownRecord, HybridRetriever } = require('../src/retrieval-core');
const { evaluate } = require('../src/retrieval-evaluation');

const fixture = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/phase3-generation-corpus-v1.json'), 'utf8'));
const time = '2026-08-20T00:00:00.000Z';
const settings = { controlledWriterEnabled: true, structuredWriterMode: 'structured-pilot', knowledgeBusinessRoot: '06-知识库/业务库', artifactsPath: '06-知识库/源文件/_slicer_artifacts', structuredMaxRecords: 100, structuredMaxActions: 300, structuredMaxLinkFanout: 20 };

function produce() {
  const result = runUniversalPipeline({ document: fixture.document });
  const plan = buildPlan({ settings, document: fixture.document, universalResult: result, index: emptyIndex(), existingFiles: {}, logicalTime: time });
  assert.strictEqual(plan.blocked, false);
  const markdown = plan.actions.filter((action) => ['business_item', 'company_knowledge'].includes(action.record_kind)).map((action) => action.content);
  const records = markdown.map((content, index) => markdownRecord(content, `card-${index}.md`));
  return { result, plan, markdown, records };
}

function questionSet(run) {
  const questions = fixture.questions.map((question) => {
    if (question.answerable === false) return { schema: undefined, id: question.id, query: question.query, answerable: false, expected_ids: [], min_lexical_score: question.min_lexical_score };
    const record = run.records.find((item) => item.evidence.some((e) => e.locator?.value === fixture.document.blocks.find((b) => b.block_id === question.evidence_block).locator.value));
    assert(record, `missing serialized record for ${question.id}`);
    return { id: question.id, query: question.query, answerable: true, expected_ids: [record.id], expected_evidence: question.expected_evidence, require_locator: true, min_lexical_score: 0.01 };
  });
  return { schema: 'eks-real-card-question-set/1.0', questions };
}

async function main() {
  const first = produce();
  const procedure = first.result.card_plans.find((card) => /循环泵启动/.test(`${card.search_title}\n${card.body}`));
  assert(procedure && procedure.included_event_ids.length === 3, 'ordered procedure must be one coherent card');
  assert(procedure.body.indexOf('打开入口阀') < procedure.body.indexOf('确认旋向') && procedure.body.indexOf('确认旋向') < procedure.body.indexOf('开启出口阀'));
  assert(!procedure.body.includes('仓库通道'));
  const table = first.result.card_plans.filter((card) => card.evidence_ids.includes('table-a'));
  assert.strictEqual(table.length, 2, 'each table parameter column must produce one atomic card');
  assert(table.some((card) => /送风机 A.*轴承温度.*80 °C/s.test(`${card.search_title}\n${card.body}`)), 'temperature header, row subject, unit, and value must survive');
  assert(table.some((card) => /送风机 A.*振动速度.*4\.5 mm\/s/s.test(`${card.search_title}\n${card.body}`)), 'vibration header, row subject, unit, and value must survive');
  const definition = first.records.find((record) => record.evidence.some((e) => e.locator?.value === '5.1'));
  assert(definition.aliases.includes('Variable Frequency Drive') && definition.aliases.includes('VFD'));
  const pressurePlans = first.result.card_plans.filter((card) => card.evidence_ids.includes('water-pressure') || card.evidence_ids.includes('air-pressure'));
  assert.strictEqual(pressurePlans.length, 2); assert(pressurePlans.every((card) => card.included_event_ids.length === 1));
  const requirementRecords = ['1.1', '1.2'].map((value) => first.records.find((record) => record.evidence.some((e) => e.locator?.value === value)));
  assert(requirementRecords.every(Boolean)); assert.notStrictEqual(requirementRecords[0].id, requirementRecords[1].id, 'independent numbered requirements must remain separate through writer serialization');
  assert.strictEqual(first.result.card_plans.filter((card) => /受控副本/.test(card.body)).length, fixture.expectation.boilerplate_cards);
  assert.strictEqual(first.result.knowledge_events.filter((event) => event.evidence_ids.some((id) => id.startsWith('boiler-'))).length, 0);
  const report = await evaluate(new HybridRetriever(first.records), questionSet(first), { repeats: 3 });
  assert.deepStrictEqual(report.failures, []); assert.strictEqual(report.metrics.recall_at_1, fixture.expectation.recall_at_1);
  assert.strictEqual(report.metrics.evidence_hit_rate, fixture.expectation.evidence_hit_rate);
  assert.strictEqual(report.metrics.no_answer_false_positive_rate, fixture.expectation.no_answer_false_positive_rate);
  assert.strictEqual(report.report_sha256, fixture.expectation.report_sha256);
  const restarted = produce(); const restartReport = await evaluate(new HybridRetriever(restarted.records), questionSet(restarted), { repeats: 3 });
  assert.deepStrictEqual(restarted.markdown, first.markdown); assert.deepStrictEqual(restarted.records.map((r) => r.id), first.records.map((r) => r.id));
  assert.deepStrictEqual(restartReport.runs, report.runs); assert.strictEqual(restartReport.report_sha256, report.report_sha256);
  assert.throws(() => markdownRecord('', 'empty.md'), /空 Markdown/); assert.throws(() => markdownRecord(Buffer.from([0, 1, 2]), 'corrupt.md'), /二进制/);
  console.log(JSON.stringify({ phase3_generation_quality: 'ok', corpus: report.corpus, metrics: report.metrics, report_sha256: report.report_sha256 }, null, 2));
}

main().catch((error) => { console.error(error.stack || error); process.exitCode = 1; });
