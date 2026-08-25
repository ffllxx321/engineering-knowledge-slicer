'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { HybridRetriever, canonicalRecord, markdownRecord, tokenize } = require('../src/retrieval-core');
const { evaluate, validateFixture } = require('../src/retrieval-evaluation');

async function main() {
  const fixture = validateFixture(JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/retrieval-eval-v1.json'), 'utf8')));
  assert(tokenize('防火门 Fire-door 1.50h').includes('防火'));
  const canonical = canonicalRecord({ record_id: 'x', title: '测试', evidence: { verbatim: '原文', locator: { page: 1 } } });
  assert.equal(canonical.schema, 'eks-search-record/1.0'); assert.equal(canonical.evidence[0].text, '原文');
  const parsed = markdownRecord('---\nrecord_id: "m1"\ntitle: "试验记录"\ntags: ["压力", "验收"]\nlibrary: "business"\n---\n\n# 试验记录\n\n## 内容\n\n完成水压试验。\n\n## 来源证据（原文）\n\n> 稳压30 min。\n\n定位：第 2 页\n', 'cards/m1.md');
  assert.equal(parsed.id, 'm1'); assert(parsed.keywords.includes('压力')); assert.equal(parsed.evidence[0].locator, '第 2 页');

  const retriever = new HybridRetriever(fixture.records);
  const report = await evaluate(retriever, fixture);
  if (report.failures.length) {
    for (const run of report.runs) console.error(`${run.id}: ${run.ids.join(', ') || '<zero>'}`);
    throw new Error(report.failures.join('\n'));
  }
  assert.equal(retriever.observability.mode, 'lexical-only');
  assert.equal(report.metrics.recall_at_1, 1); assert.equal(report.metrics.deterministic_repeatability, 1);

  const embedding = { async embed(texts, options) { return texts.map((text) => options.textType === 'query' || text.includes('管道压力') ? [1, 0] : [0, 1]); } };
  const hybrid = new HybridRetriever(fixture.records, { embedding });
  const results = await hybrid.search('hydrostatic test procedure', { filters: { category: '机电' } });
  assert.equal(results[0].record.id, 'proc-pressure'); assert(results[0].dense_score > 0 && results[0].lexical_score > 0);
  assert(results[0].evidence_locators[0].text.includes('1.0 MPa'));

  const fallback = new HybridRetriever(fixture.records, { embedding: { embed: async () => { throw Object.assign(new Error('offline'), { code: 'EMBED_OFFLINE' }); } } });
  assert.equal((await fallback.search('防火门耐火完整性'))[0].record.id, 'req-fire-door'); assert.equal(fallback.observability.dense_error, 'EMBED_OFFLINE');

  const duplicates = new HybridRetriever([fixture.records[0], { ...fixture.records[0], id: 'req-fire-door-copy' }]);
  const deduped = await duplicates.search('防火门耐火完整性'); assert.equal(deduped.length, 1); assert.deepEqual(deduped[0].duplicate_ids, ['req-fire-door-copy']);
  const distinct = new HybridRetriever([fixture.records[0], { ...fixture.records[0], id: 'different-evidence', evidence: [{ text: '乙级防火门耐火完整性不得低于1.00 h。', locator: { page: 13 } }] }]);
  assert.equal((await distinct.search('防火门耐火完整性')).length, 2);

  const materiallyDifferent = new HybridRetriever([
    { id: 'weak', title: 'pump parameters', body: 'pressure', evidence: [{ text: 'pressure', locator: { value: 'z-locator' } }, { text: 'note', locator: { value: 'a-locator' } }] },
    { id: 'strong', title: 'pump parameters', body: 'critical pressure', keywords: ['critical pressure'], evidence: [{ text: 'pressure', locator: { value: 'y-locator' } }] }
  ]);
  const materialRanking = materiallyDifferent.lexical('pump critical pressure');
  assert(materialRanking[0].score > 4 && materialRanking[0].score < 4.6 && materialRanking[1].score > 1.7 && materialRanking[1].score < 2,
    'counterexample retains the reviewed approximately 4.0 versus 1.9 BM25 scores');
  assert.equal(materialRanking[0].record.id, 'strong', 'materially better BM25 wins regardless of locator order');
  const reorderedEvidence = new HybridRetriever([
    { id: 'weak', title: 'pump parameters', body: 'pressure', evidence: [{ text: 'note', locator: { value: 'a-locator' } }, { text: 'pressure', locator: { value: 'z-locator' } }] },
    { id: 'strong', title: 'pump parameters', body: 'critical pressure', keywords: ['critical pressure'], evidence: [{ text: 'pressure', locator: { value: 'y-locator' } }] }
  ]).lexical('pump critical pressure');
  assert.deepEqual(reorderedEvidence.map((item) => item.record.id), materialRanking.map((item) => item.record.id), 'source tie-break is independent of evidence array order');

  const falsePositiveFixture = { schema: fixture.schema, records: [fixture.records[0]], questions: [{ id: 'negative', query: '防火门', expected_ids: [] }] };
  assert((await evaluate(new HybridRetriever(falsePositiveFixture.records), falsePositiveFixture)).failures.some((item) => item.type === 'no_answer_false_positive'));
  const missingEvidenceFixture = { schema: fixture.schema, records: [{ id: 'empty', title: '空证据记录', body: '只有声明' }], questions: [{ id: 'missing', query: '空证据记录', expected_ids: ['empty'], expected_evidence: '不存在的原文' }] };
  assert((await evaluate(new HybridRetriever(missingEvidenceFixture.records), missingEvidenceFixture)).failures.some((item) => item.type === 'evidence_missing'));
  const duplicateOnlyFixture = { schema: fixture.schema, records: [fixture.records[0], { ...fixture.records[0], id: 'req-fire-door-copy' }], questions: [{ id: 'duplicates', query: '防火门耐火完整性', expected_ids: ['req-fire-door', 'req-fire-door-copy'], expected_evidence: '1.50 h' }] };
  assert((await evaluate(new HybridRetriever(duplicateOnlyFixture.records), duplicateOnlyFixture)).failures.some((item) => item.type === 'duplicate_only'));
  console.log(JSON.stringify({ retrieval_phase1: 'ok', metrics: report.metrics }, null, 2));
}

main().catch((error) => { console.error(error.stack || error); process.exitCode = 1; });
