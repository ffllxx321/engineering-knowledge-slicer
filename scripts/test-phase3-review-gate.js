'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {
  PHASE3_SETTINGS_DEFAULTS, OUTCOMES, evaluatePhase3, runPhase3Shadow,
  createDecisionEntry, verifyDecisionLedger, planDocumentWithdrawal
} = require('../src/phase3-review-gate.js');

const evidence = (suffix) => ({
  block_id: `block-${suffix}`, verbatim: `neutral evidence ${suffix}`,
  locator: { scheme: 'synthetic', value: suffix }
});
const candidate = (suffix, extra = {}) => ({
  candidate_id: `candidate-${suffix}`,
  source_document_id: extra.source_document_id || 'document-a',
  evidence: evidence(suffix),
  review_reasons: [],
  reusable_knowledge_candidate: false,
  ...extra
});
const phase2 = (items, route = {
  library: 'business', directory_category: 'risks_issues', document_role: 'source_record'
}) => ({
  schema_version: '2.0', route,
  business_item_batch: { source_document_id: 'document-a', items }
});

function main() {
  JSON.parse(fs.readFileSync(path.join(
    __dirname, '..', '组件包', 'schemas', 'phase3-review-result-v3.schema.json'
  ), 'utf8'));
  assert.deepStrictEqual(PHASE3_SETTINGS_DEFAULTS, {
    phase3_shadow_enabled: false, phase3_pilot_enabled: false, phase3_write_enabled: false
  });
  const off = runPhase3Shadow(phase2([candidate('off')]));
  assert.strictEqual(off.counters.generated, 0);
  assert.strictEqual(off.writes_performed, 0);

  const cases = [
    candidate('normal', { confidence: 0.01 }),
    candidate('notice', { review_reasons: ['ambiguous_category'] }),
    candidate('owner', { review_reasons: ['ambiguous_project'] }),
    candidate('amount', { review_reasons: ['conflicting_facts'], material_difference_status: 'conflict', facts: { amounts: ['10', '11'] } }),
    candidate('date', { review_reasons: ['critical_fact_conflict'], facts: { dates: ['A', 'B'] } }),
    candidate('unit', { review_reasons: ['conflicting_facts'], material_difference_status: 'ambiguous_conversion', facts: { units: ['x', 'y'] } }),
    candidate('status', { review_reasons: ['critical_fact_conflict'], facts: { statuses: ['m', 'n'] } }),
    candidate('missing', { evidence: null }),
    candidate('unsupported', { review_reasons: ['unsupported_invented_facts'] }),
    candidate('reuse', { reusable_knowledge_candidate: true })
  ];
  const result = evaluatePhase3(phase2(cases));
  assert.strictEqual(result.classifications[0].outcome, OUTCOMES.PASS);
  assert.strictEqual(result.classifications[1].outcome, OUTCOMES.NOTICE);
  for (const item of result.classifications.slice(2)) assert.strictEqual(item.outcome, OUTCOMES.MANUAL);
  assert(result.summary.includes('本次生成 10 条'));
  assert(!result.summary.includes('{'));
  assert.strictEqual(result.writes_performed, 0);

  const grouped = evaluatePhase3(phase2([
    candidate('m1', { evidence: null }), candidate('m2', { evidence: null }),
    candidate('c1', { review_reasons: ['critical_fact_conflict'], conflict_id: 'conflict-one' }),
    candidate('c2', { review_reasons: ['critical_fact_conflict'], conflict_id: 'conflict-two' })
  ]));
  assert.strictEqual(grouped.handling_groups.filter((g) =>
    g.root_cause === 'missing_or_unverifiable_evidence').length, 1);
  assert.strictEqual(grouped.handling_groups.filter((g) =>
    g.root_cause === 'critical_fact_conflict').length, 2);

  const withdrawal = planDocumentWithdrawal('document-a', ['record-b', 'record-a']);
  assert.strictEqual(withdrawal.status, 'planned_not_executed');
  assert.strictEqual(withdrawal.deletes_user_files, false);
  assert.strictEqual(withdrawal.changes_project_status, false);
  assert(Object.isFrozen(withdrawal.affected_record_ids));
  const first = createDecisionEntry({
    decision_id: 'd1', decided_at: '2026-01-01T00:00:00Z', decided_by: 'reviewer',
    source_document_id: 'document-a', group_id: 'g1', decision: 'approve', candidate_ids: ['a']
  });
  const second = createDecisionEntry({
    decision_id: 'd2', decided_at: '2026-01-01T00:01:00Z', decided_by: 'reviewer',
    source_document_id: 'document-a', group_id: 'g2', decision: 'return', candidate_ids: ['b']
  }, first);
  assert(verifyDecisionLedger([first, second]));
  assert(Object.isFrozen(first.candidate_ids));
  assert(!verifyDecisionLedger([first, { ...second, decision: 'approve' }]));

  const many = Array.from({ length: 500 }, (_, index) => candidate(`normal-${index}`));
  const regression = evaluatePhase3(phase2(many));
  assert.strictEqual(regression.counters.auto_passed, 500);
  assert.strictEqual(regression.counters.needs_handling, 0);
  assert.strictEqual(regression.counters.handling_groups, 0);

  const legacy = evaluatePhase3(phase2([candidate('legacy')]));
  assert.strictEqual(legacy.counters.generated, 1);
  console.log(`phase3-review-gate: ok; synthetic actual pass=${regression.counters.auto_passed}/500`);
}

main();
