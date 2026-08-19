'use strict';

const crypto = require('crypto');
const FIXTURE_SCHEMA = 'eks-retrieval-eval/1.0';
const QUESTION_SCHEMA = 'eks-real-card-question-set/1.0';
const REPORT_SCHEMA = 'eks-real-card-evaluation/1.0';
const FAILURE_TYPES = Object.freeze(['not_retrieved', 'wrong_topic', 'evidence_missing', 'evidence_locator_missing', 'duplicate_only', 'ambiguous_ground_truth', 'nondeterministic', 'no_answer_false_positive']);
const digest = (value) => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const terms = (value) => new Set(String(value || '').normalize('NFKC').toLocaleLowerCase('en-US').match(/[\p{L}\p{N}]+/gu) || []);
function jaccard(left, right) {
  const a = terms(left); const b = terms(right); const common = [...a].filter((term) => b.has(term)).length;
  return common / Math.max(1, a.size + b.size - common);
}

function questionsFrom(input) {
  if (input?.schema === FIXTURE_SCHEMA) return input.questions;
  if (input?.schema !== QUESTION_SCHEMA || !Array.isArray(input.questions)) throw new Error('问题集版本或结构无效');
  return input.questions;
}
function validateQuestions(input, recordIds = null) {
  const questions = questionsFrom(input);
  if (!questions.length) throw new Error('问题集不能为空');
  const questionIds = new Set();
  for (const question of questions) {
    if (!question.id || questionIds.has(question.id) || !String(question.query || '').trim() || !Array.isArray(question.expected_ids)) throw new Error('问题合同无效或 ID 重复');
    questionIds.add(question.id);
    if (question.answerable !== false && !question.expected_ids.length) throw new Error(`问题 ${question.id} 的正例 ground truth 为空`);
    if (question.answerable === false && question.expected_ids.length) throw new Error(`问题 ${question.id} 的无答案 ground truth 非空`);
    if (question.expected_ids.length && (!question.expected_evidence || !question.require_locator)) throw new Error(`问题 ${question.id} 缺少证据或 locator ground truth`);
    if (recordIds && question.expected_ids.some((id) => !recordIds.has(id))) throw new Error(`问题 ${question.id} 引用了未知记录`);
  }
  return questions;
}
function validateFixture(fixture) {
  if (fixture?.schema !== FIXTURE_SCHEMA || !Array.isArray(fixture.records)) throw new Error('检索评测 fixture 版本或结构无效');
  const ids = new Set(fixture.records.map((record) => record.id || record.record_id));
  if (ids.size !== fixture.records.length) throw new Error('检索评测记录 ID 重复');
  // Phase 1 compatibility: its positive questions predate require_locator.
  for (const q of fixture.questions || []) {
    if (q.expected_ids?.length && q.require_locator === undefined) q.require_locator = true;
    if (!q.expected_ids?.length && q.answerable === undefined) q.answerable = false;
  }
  validateQuestions(fixture, ids); return fixture;
}
const locatorPresent = (value) => Boolean(value && (typeof value !== 'object' || Object.keys(value).length));
const includes = (value, needle) => String(value || '').normalize('NFKC').includes(String(needle || '').normalize('NFKC'));
function duplicateFindings(records) {
  const exact = new Map();
  for (const record of records) {
    const key = digest(record.evidence.map((e) => [e.text, e.locator]));
    if (!exact.has(key)) exact.set(key, []); exact.get(key).push(record.id);
  }
  const findings = [...exact.values()].filter((ids) => ids.length > 1).map((ids) => ({ kind: 'exact_evidence', record_ids: ids.sort() }));
  for (let left = 0; left < records.length; left += 1) for (let right = left + 1; right < records.length; right += 1) {
    const score = jaccard(`${records[left].title} ${records[left].body}`, `${records[right].title} ${records[right].body}`);
    if (score >= 0.85 && digest(records[left].evidence) !== digest(records[right].evidence)) findings.push({ kind: 'near_duplicate', record_ids: [records[left].id, records[right].id].sort(), similarity: Number(score.toFixed(6)) });
  }
  return findings.sort((a, b) => `${a.kind}:${a.record_ids.join(':')}`.localeCompare(`${b.kind}:${b.record_ids.join(':')}`));
}

async function evaluate(retriever, questionSet, options = {}) {
  const ids = new Set(retriever.records.map((record) => record.id));
  const questions = questionSet?.records ? validateFixture(questionSet).questions : validateQuestions(questionSet, ids);
  const repeats = Math.max(2, Number(options.repeats) || 2); const runs = []; const failures = [];
  for (const question of questions) {
    const attempts = [];
    for (let i = 0; i < repeats; i += 1) attempts.push(await retriever.search(question.query, { limit: 5, filters: question.filters, min_lexical_score: question.min_lexical_score || options.min_lexical_score }));
    const ranked = attempts[0]; const rankedIds = ranked.map((item) => item.record.id); const expected = new Set(question.expected_ids);
    const snapshots = attempts.map((items) => items.map((item) => [item.record.id, item.fusion_score, item.lexical_score, item.dense_score]));
    const deterministic = snapshots.every((snapshot) => JSON.stringify(snapshot) === JSON.stringify(snapshots[0]));
    const rank = rankedIds.findIndex((id) => expected.has(id)) + 1;
    const expectedItems = ranked.filter((item) => expected.has(item.record.id));
    const evidenceMatches = (e) => includes(`${e.text} ${typeof e.locator === 'string' ? e.locator : JSON.stringify(e.locator)}`, question.expected_evidence);
    const evidenceHit = !expected.size || expectedItems.some((item) => item.record.evidence.some(evidenceMatches));
    const locatorHit = !expected.size || expectedItems.some((item) => item.record.evidence.some((e) => evidenceMatches(e) && locatorPresent(e.locator)));
    const duplicateOnly = expected.size > 1 && expectedItems.length && expectedItems.every((item) => item.duplicate_ids?.some((id) => expected.has(id)));
    const types = [];
    if (question.ambiguous_ground_truth === true) types.push('ambiguous_ground_truth');
    if (expected.size && !rank) types.push('not_retrieved');
    if (expected.size && ranked.length && !expected.has(ranked[0].record.id)) types.push('wrong_topic');
    if (rank && !evidenceHit) types.push('evidence_missing');
    if (rank && evidenceHit && !locatorHit) types.push('evidence_locator_missing');
    if (duplicateOnly) types.push('duplicate_only');
    if (!deterministic) types.push('nondeterministic');
    if (!expected.size && ranked.length) types.push('no_answer_false_positive');
    for (const type of types) failures.push({ question_id: question.id, type });
    runs.push({ id: question.id, answerable: expected.size > 0, expected_ids: [...expected], ranked: ranked.map((item, index) => ({ rank: index + 1, record_id: item.record.id, fusion_score: item.fusion_score, lexical_score: item.lexical_score, dense_score: item.dense_score, matched_terms: item.matched_terms, duplicate_ids: item.duplicate_ids, evidence_match: item.record.evidence.some(evidenceMatches), locator_present: item.record.evidence.some((e) => locatorPresent(e.locator)) })), rank, recall_1: rank === 1 ? 1 : 0, recall_3: rank > 0 && rank <= 3 ? 1 : 0, recall_5: rank > 0 && rank <= 5 ? 1 : 0, reciprocal_rank: rank ? 1 / rank : 0, expected_hit: Boolean(rank), evidence_hit: evidenceHit, locator_hit: locatorHit, zero_result: ranked.length === 0, deterministic, failure_types: types });
  }
  const positives = runs.filter((run) => run.answerable); const negatives = runs.filter((run) => !run.answerable);
  const mean = (items, key) => items.reduce((sum, run) => sum + Number(run[key]), 0) / Math.max(1, items.length);
  const report = { schema: REPORT_SCHEMA, question_set_schema: questionSet.schema, corpus: { cards: retriever.records.length, evidence_items: retriever.records.reduce((n, r) => n + r.evidence.length, 0), with_locator: retriever.records.filter((r) => r.evidence.some((e) => locatorPresent(e.locator))).length, sources: new Set(retriever.records.map((r) => r.source_id).filter(Boolean)).size }, metrics: { recall_at_1: mean(positives, 'recall_1'), recall_at_3: mean(positives, 'recall_3'), recall_at_5: mean(positives, 'recall_5'), mrr: mean(positives, 'reciprocal_rank'), expected_card_hit_rate: mean(positives, 'expected_hit'), expected_hit_rate: mean(positives, 'expected_hit'), evidence_hit_rate: mean(positives, 'evidence_hit'), positive_zero_result_rate: positives.filter((r) => r.zero_result).length / Math.max(1, positives.length), no_answer_false_positive_rate: negatives.filter((r) => !r.zero_result).length / Math.max(1, negatives.length), deterministic_repeatability: mean(runs, 'deterministic') }, duplicate_findings: duplicateFindings(retriever.records), failures, runs };
  report.report_sha256 = digest(report); return report;
}

module.exports = { FIXTURE_SCHEMA, QUESTION_SCHEMA, REPORT_SCHEMA, FAILURE_TYPES, validateQuestions, validateFixture, evaluate, duplicateFindings };
