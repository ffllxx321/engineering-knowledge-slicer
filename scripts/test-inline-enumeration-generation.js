'use strict';
const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { runUniversalPipeline } = require('../src/universal-knowledge-pipeline.js');
const { buildPlan, emptyIndex } = require('../src/structured-writer.js');
const { markdownRecord, HybridRetriever } = require('../src/retrieval-core.js');
const { evaluate } = require('../src/retrieval-evaluation.js');
const { normalizeSemanticText } = require('../src/semantic-text.js');

const fixture = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/inline-enumeration-generation-v1.json'), 'utf8'));
const settings = { controlledWriterEnabled: true, structuredWriterMode: 'structured-pilot', knowledgeBusinessRoot: '06-知识库/业务库', artifactsPath: '06-知识库/源文件/_slicer_artifacts', structuredMaxRecords: 100, structuredMaxActions: 300, structuredMaxLinkFanout: 20 };
const digest = (value) => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');

function produce() {
  const result = runUniversalPipeline({ document: fixture.document });
  const plan = buildPlan({ settings, document: fixture.document, universalResult: result, index: emptyIndex(), existingFiles: {}, logicalTime: '2026-08-26T00:00:00.000Z' });
  assert(!plan.blocked);
  const markdown = plan.actions.filter((action) => ['business_item', 'company_knowledge'].includes(action.record_kind)).map((action) => action.content);
  return { result, markdown, records: markdown.map((value, index) => markdownRecord(value, `inline-${index}.md`)) };
}

function verifyStructure(run) {
  const diagnostics = run.result.document.metadata.pre_generation_diagnostics.inline_enumerations;
  assert.deepStrictEqual(diagnostics, { paragraphs_expanded: 3, derived_list_items: 6 });
  const derived = run.result.document.blocks.filter((block) => block.metadata.inline_enumeration);
  assert.strictEqual(derived.length, 6);
  assert(derived.every((block) => block.kind === 'list_item' && block.metadata.parent_clause_id));
  assert.deepStrictEqual(derived.map((block) => block.locator.fragment), ['chars=12-25', 'chars=25-52', 'chars=9-24', 'chars=24-44', 'chars=7-34', 'chars=34-47']);
  assert.strictEqual(run.result.document.blocks.find((block) => block.block_id === 'numeric-prose').kind, 'paragraph');
  assert.strictEqual(run.result.document.blocks.find((block) => block.block_id === 'clause-references').kind, 'paragraph');
  assert.strictEqual(run.result.document.blocks.filter((block) => block.block_id.startsWith('native-')).length, 2);
  const inlinePlans = run.result.card_plans.filter((card) => card.evidence_ids.some((id) => id.includes(':inline-item-')));
  assert.strictEqual(inlinePlans.length, 6, 'each explicit sibling requirement remains independently retrievable');
  assert(inlinePlans.every((card) => /适用范围：/.test(card.body)));
  const exception = inlinePlans.find((card) => /绝缘电阻/.test(card.body));
  assert(exception && /除外/.test(exception.body) && !/检查接地/.test(exception.body));
  const conditional = inlinePlans.find((card) => /护罩锁定/.test(card.body));
  assert(conditional && /如果锁扣松动[,，]应先加固/.test(conditional.body));
  assert(!inlinePlans.some((card) => /旁路联锁/.test(card.body) && /护罩锁定/.test(card.body)));
  assert(run.result.knowledge_units.flatMap((unit) => unit.evidence).some((evidence) => evidence.verbatim === '（1）操作员必须检查接地；' && evidence.locator.fragment === 'chars=12-25'));
  assert(run.markdown.some((value) => value.includes('> （1）操作员必须检查接地；')));
}

async function main() {
  const first = produce(); verifyStructure(first);
  const questions = { schema: 'eks-real-card-question-set/1.0', questions: fixture.questions.map((question) => {
    const record = first.records.find((item) => item.evidence.some((evidence) => normalizeSemanticText(evidence.text) === normalizeSemanticText(question.quote)));
    assert(record, `missing exact evidence for ${question.id}`);
    const expectedEvidence = record.evidence.find((evidence) => normalizeSemanticText(evidence.text) === normalizeSemanticText(question.quote)).text;
    return { id: question.id, query: question.query, answerable: true, expected_ids: [record.id], expected_evidence: expectedEvidence, require_locator: true, min_lexical_score: 0.01 };
  }) };
  const report = await evaluate(new HybridRetriever(first.records), questions, { repeats: 3 });
  assert.deepStrictEqual(report.failures, []);
  const restart = produce(); verifyStructure(restart);
  const restartReport = await evaluate(new HybridRetriever(restart.records), questions, { repeats: 3 });
  assert.deepStrictEqual(restart.markdown, first.markdown);
  assert.deepStrictEqual(restart.records.map((record) => record.id), first.records.map((record) => record.id));
  assert.strictEqual(restartReport.report_sha256, report.report_sha256);
  const hashes = { markdown: digest(first.markdown), plans: digest(first.result.card_plans), retrieval: report.report_sha256 };
  assert.deepStrictEqual(hashes, {
    markdown: 'd12bf9cf5e2bb0327d870acfe216a1d4efc1dbd03d2c470b212bafcd7d7f64ce',
    plans: '58a8155d27143582bb1784bf9537ff1dbb3a8974010692d0e9fbbe774296f3b6',
    retrieval: '1e3ddc44e9960285df9db1f440e88c46abcea77b6c89e806ede33d5c66481fa5'
  });
  console.log(JSON.stringify({ cards: first.records.length, inline_cards: 6, metrics: report.metrics, hashes }, null, 2));
}
main().catch((error) => { console.error(error.stack || error); process.exitCode = 1; });
