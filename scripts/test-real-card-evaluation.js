'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { serializeRecord } = require('../src/structured-writer');
const { markdownRecord, loadMarkdownCorpus, HybridRetriever } = require('../src/retrieval-core');
const { evaluate, validateQuestions, FAILURE_TYPES } = require('../src/retrieval-evaluation');

const time = '2026-08-19T00:00:00.000Z';
function record(overrides) { return { schema_version: '1.0', record_kind: 'business_item', record_id: 'bi-pressure', title: '管道压力试验步骤', search_title: '管道水压试验如何升压稳压检查', aliases: ['hydrostatic test procedure'], keywords: ['稳压', '泄漏检查'], library: 'business', category: 'technical_methods_workmanship', item_type: 'process', created_at: time, updated_at: time, semantic_kind: 'procedure', tags: ['管道', '试验'], owner_source_id: 'src-manual', source_document_ids: ['src-manual'], summary: '先注水排气，再缓慢升压；稳压后检查接口。', evidence_list: [{ verbatim: '升至1.0 MPa后稳压30 min，所有接口不得渗漏。', locator: { heading_path: ['调试', '压力试验'], page: 12 } }], ...overrides }; }
function question(id, query, expectedIds, evidence = '原文', extra = {}) { return { schema: 'eks-real-card-question-set/1.0', questions: [{ id, query, answerable: expectedIds.length > 0, expected_ids: expectedIds, ...(expectedIds.length ? { expected_evidence: evidence, require_locator: true } : {}), ...extra }] }; }

async function main() {
  assert(FAILURE_TYPES.includes('evidence_locator_missing'));
  const markdown = serializeRecord(record({}));
  const parsed = markdownRecord(markdown, 'cards/pressure.md');
  assert.equal(parsed.id, 'bi-pressure'); assert.equal(parsed.search_title, '管道水压试验如何升压稳压检查');
  assert(parsed.aliases.includes('hydrostatic test procedure')); assert(parsed.keywords.includes('泄漏检查'));
  assert.equal(parsed.semantic_kind, 'procedure'); assert.equal(parsed.category, 'technical_methods_workmanship'); assert.equal(parsed.library, 'business');
  assert.equal(parsed.source_id, 'src-manual'); assert.deepEqual(parsed.evidence[0].locator, { heading_path: ['调试', '压力试验'], page: 12 });

  const cards = [record({}), record({ record_id: 'dist-pressure-meeting', title: '压力试验协调会', search_title: '压力试验参会安排', aliases: [], keywords: ['压力试验'], semantic_kind: 'schedule', summary: '协调施工人员参加压力试验会议。', evidence_list: [{ verbatim: '压力试验协调会周五召开。', locator: { page: 3 } }] }), record({ record_id: 'ck-coating', record_kind: 'company_knowledge', title: '外墙涂层性能', search_title: '外墙真石漆耐候年限', aliases: [], keywords: ['真石漆', '耐候年限'], category: 'materials_equipment', item_type: undefined, reuse_status: 'auto_supported', semantic_kind: 'parameter', summary: '材料性能参数来自饰面材料表。', evidence_list: [{ verbatim: '真石漆 | 使用部位：外墙 | 耐候年限：≥10年', locator: { sheet: '饰面材料表', range: 'A6:C6' } }] })];
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'eks-real-cards-'));
  for (const card of cards) fs.writeFileSync(path.join(temp, `${card.record_id}.md`), serializeRecord(card));
  const corpus = loadMarkdownCorpus(temp); const retriever = new HybridRetriever(corpus);
  const fixture = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/real-card-questions-v1.json'), 'utf8'));
  validateQuestions(fixture, new Set(corpus.map((item) => item.id)));
  const report = await evaluate(retriever, fixture, { repeats: 3 });
  assert.deepEqual(report.failures, []); assert.equal(report.metrics.recall_at_1, 1); assert.equal(report.metrics.evidence_hit_rate, 1); assert.equal(report.metrics.no_answer_false_positive_rate, 0); assert.equal(report.metrics.deterministic_repeatability, 1);
  assert.equal(report.runs[0].ranked[0].record_id, 'bi-pressure'); assert(report.runs[0].ranked[0].evidence_match);

  assert.throws(() => markdownRecord(Buffer.from([0, 1, 2, 3]), 'binary.md'), /二进制/);
  assert.throws(() => markdownRecord('# Ã© Ã©\n', 'mojibake.md'), /编码损坏/);
  assert.throws(() => validateQuestions({ schema: fixture.schema, questions: [] }), /不能为空/);

  const missingEvidence = await evaluate(new HybridRetriever([{ id: 'x', title: '目标卡', body: '目标词', evidence: [{ text: '别的原文', locator: { page: 1 } }] }]), question('missing-evidence', '目标词', ['x'], '要求原文'));
  assert(missingEvidence.failures.some((f) => f.type === 'evidence_missing'));
  const missingLocator = await evaluate(new HybridRetriever([{ id: 'x', title: '目标卡', body: '目标词', evidence: [{ text: '要求原文', locator: '' }] }]), question('missing-locator', '目标词', ['x'], '要求原文'));
  assert(missingLocator.failures.some((f) => f.type === 'evidence_locator_missing'));
  const duplicate = record({ record_id: 'dup-a' });
  const duplicateReport = await evaluate(new HybridRetriever([duplicate, { ...duplicate, record_id: 'dup-b' }]), question('duplicate-only', '管道水压稳压', ['dup-a', 'dup-b'], '稳压30 min'));
  assert(duplicateReport.failures.some((f) => f.type === 'duplicate_only'));
  assert(duplicateReport.duplicate_findings.some((item) => item.kind === 'exact_evidence'));
  const falsePositive = await evaluate(new HybridRetriever([record({})]), question('false-positive', '管道试验', [], '', { answerable: false }));
  assert(falsePositive.failures.some((f) => f.type === 'no_answer_false_positive'));

  const restartMarkdown = serializeRecord(record({}));
  assert.equal(restartMarkdown, markdown); assert.equal(markdownRecord(restartMarkdown).id, parsed.id);
  const restarted = await evaluate(new HybridRetriever(loadMarkdownCorpus(temp)), fixture, { repeats: 3 });
  assert.equal(restarted.report_sha256, report.report_sha256); assert.deepEqual(restarted.runs, report.runs);
  console.log(JSON.stringify({ real_card_evaluation: 'ok', corpus: report.corpus, metrics: report.metrics }, null, 2));
}
main().catch((error) => { console.error(error.stack || error); process.exitCode = 1; });
