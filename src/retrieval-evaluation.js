'use strict';

const FIXTURE_SCHEMA = 'eks-retrieval-eval/1.0';

function validateFixture(fixture) {
  if (fixture?.schema !== FIXTURE_SCHEMA || !Array.isArray(fixture.records) || !Array.isArray(fixture.questions)) throw new Error('检索评测 fixture 版本或结构无效');
  const ids = new Set(fixture.records.map((record) => record.id || record.record_id));
  if (ids.size !== fixture.records.length) throw new Error('检索评测记录 ID 重复');
  for (const question of fixture.questions) {
    if (!question.id || !question.query || !Array.isArray(question.expected_ids)) throw new Error('检索问题合同无效');
    if (question.expected_ids.some((id) => !ids.has(id))) throw new Error(`问题 ${question.id} 引用了未知记录`);
    if (question.expected_ids.length && !question.expected_evidence) throw new Error(`问题 ${question.id} 缺少 expected_evidence`);
  }
  return fixture;
}

async function evaluate(retriever, fixture, options = {}) {
  validateFixture(fixture); const runs = []; const failures = []; const repeats = options.repeats || 2;
  for (const question of fixture.questions) {
    const attempts = [];
    for (let i = 0; i < repeats; i += 1) attempts.push(await retriever.search(question.query, { limit: 5, filters: question.filters }));
    const ids = attempts[0].map((item) => item.record.id); const expected = new Set(question.expected_ids);
    const deterministic = attempts.every((items) => JSON.stringify(items.map((item) => [item.record.id, item.fusion_score])) === JSON.stringify(attempts[0].map((item) => [item.record.id, item.fusion_score])));
    const rank = ids.findIndex((id) => expected.has(id)) + 1; const falsePositive = !expected.size && ids.length > 0;
    const evidenceHit = !expected.size || attempts[0].some((item) => expected.has(item.record.id) && item.evidence_locators.some((e) =>
      `${e.text} ${typeof e.locator === 'string' ? e.locator : JSON.stringify(e.locator)}`.includes(question.expected_evidence)));
    const expectedHits = ids.filter((id) => expected.has(id)); const duplicateOnly = expected.size > 1 && new Set(expectedHits).size < Math.min(expected.size, 2);
    const result = { id: question.id, ids, rank, recall_1: rank === 1 ? 1 : 0, recall_3: rank && rank <= 3 ? 1 : 0, recall_5: rank && rank <= 5 ? 1 : 0, reciprocal_rank: rank ? 1 / rank : 0, expected_hit: Boolean(rank), evidence_hit: evidenceHit, zero_result: ids.length === 0, deterministic };
    if (falsePositive) failures.push(`${question.id}: false-positive fixture returned ${ids.join(', ')}`);
    if (expected.size && (!rank || !evidenceHit)) failures.push(`${question.id}: expected evidence was not retrieved`);
    if (duplicateOnly) failures.push(`${question.id}: retrieval returned duplicate-only evidence`);
    if (!deterministic) failures.push(`${question.id}: result order or scores were not repeatable`);
    runs.push(result);
  }
  const positive = runs.filter((_run, index) => fixture.questions[index].expected_ids.length); const mean = (key) => positive.reduce((sum, run) => sum + Number(run[key]), 0) / Math.max(1, positive.length);
  return { schema: FIXTURE_SCHEMA, metrics: { recall_at_1: mean('recall_1'), recall_at_3: mean('recall_3'), recall_at_5: mean('recall_5'), mrr: mean('reciprocal_rank'), expected_hit_rate: mean('expected_hit'), evidence_hit_rate: mean('evidence_hit'), zero_result_rate: runs.filter((run) => run.zero_result).length / Math.max(1, runs.length), deterministic_repeatability: runs.filter((run) => run.deterministic).length / Math.max(1, runs.length) }, failures, runs };
}

module.exports = { FIXTURE_SCHEMA, validateFixture, evaluate };
