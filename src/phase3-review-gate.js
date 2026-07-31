'use strict';

/**
 * Phase 3 shadow review gate.
 * Pure computation: it never writes, deletes, moves files, or changes project state.
 */

const crypto = require('crypto');

const PHASE3_SCHEMA_VERSION = '3.0';
const PHASE3_SETTINGS_DEFAULTS = Object.freeze({
  phase3_shadow_enabled: false,
  phase3_pilot_enabled: false,
  phase3_write_enabled: false
});
const OUTCOMES = Object.freeze({
  PASS: 'automatic_pass',
  NOTICE: 'automatic_pass_with_notice',
  MANUAL: 'mandatory_human_handling'
});
const HARD_RISKS = Object.freeze([
  'project_ownership_conflict',
  'critical_fact_conflict',
  'missing_or_unverifiable_evidence',
  'unsupported_model_fact',
  'company_reuse_promotion'
]);
const NOTICE_REASONS = Object.freeze([
  'category_unresolved',
  'noncritical_difference',
  'route_incomplete'
]);

const text = (value, max = 500) =>
  typeof value === 'string' ? value.trim().replace(/\s+/g, ' ').slice(0, max) : '';
const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const sortedUnique = (values) => [...new Set(values.filter(Boolean))].sort();
const digest = (value) => crypto.createHash('sha256')
  .update(JSON.stringify(value)).digest('hex');
const id = (prefix, value) => `${prefix}-${digest(value).slice(0, 24)}`;

function evidenceIsVerifiable(candidate) {
  if (!object(candidate.evidence)) return false;
  const evidence = candidate.evidence;
  const quote = text(evidence.verbatim, 4000);
  const blockId = text(evidence.block_id || candidate.block_id, 300);
  const locator = object(evidence.locator) &&
    text(evidence.locator.scheme, 80) && text(evidence.locator.value, 500);
  return Boolean(quote && blockId && locator);
}

function conflictSignature(candidate) {
  const facts = object(candidate.facts) ? candidate.facts : {};
  const critical = {};
  for (const field of ['amounts', 'numbers', 'dates', 'units', 'statuses', 'status']) {
    const value = facts[field];
    if (Array.isArray(value) && value.length) critical[field] = sortedUnique(value.map(String));
    else if (value !== undefined && value !== null && text(String(value))) critical[field] = text(String(value));
  }
  const explicit = text(candidate.conflict_id || candidate.conflict_signature, 300);
  return explicit || (Object.keys(critical).length ? digest(critical).slice(0, 20) : '');
}

function classifyCandidate(candidate, route = {}) {
  const reasons = new Set(Array.isArray(candidate.review_reasons) ? candidate.review_reasons : []);
  const hardRisks = [];
  const notices = [];

  if (reasons.has('ambiguous_project') || reasons.has('conflicting_project_ownership')
      || (Array.isArray(route.review_reasons) && route.review_reasons.includes('ambiguous_project'))) {
    hardRisks.push('project_ownership_conflict');
  }
  if (reasons.has('missing_evidence') || !evidenceIsVerifiable(candidate)) {
    hardRisks.push('missing_or_unverifiable_evidence');
  }
  if (reasons.has('unsupported_invented_facts') || reasons.has('unsupported_model_fact')) {
    hardRisks.push('unsupported_model_fact');
  }
  if (candidate.reusable_knowledge_candidate === true || reasons.has('reuse_promotion')) {
    hardRisks.push('company_reuse_promotion');
  }
  const differenceStatus = text(candidate.material_difference_status
    || candidate.material_differences?.status, 80);
  const blockingDifference = ['missing_in_evidence', 'unsupported_addition', 'conflict',
    'ambiguous_conversion', 'strengthened_obligation', 'weakened_obligation',
    'changed_obligation', 'invented_condition', 'removed_condition_or_exception'].includes(differenceStatus);
  if (reasons.has('critical_fact_conflict') || blockingDifference) {
    hardRisks.push('critical_fact_conflict');
  } else if (reasons.has('conflicting_facts')) {
    notices.push('noncritical_difference');
  }
  if (reasons.has('ambiguous_category')) notices.push('category_unresolved');
  if (!route.library || !route.directory_category || !route.document_role
      || route.document_role === 'unknown') notices.push('route_incomplete');

  const hard = sortedUnique(hardRisks);
  const note = sortedUnique(notices);
  return {
    candidate_id: text(candidate.candidate_id, 300),
    source_document_id: text(candidate.source_document_id, 300),
    outcome: hard.length ? OUTCOMES.MANUAL : note.length ? OUTCOMES.NOTICE : OUTCOMES.PASS,
    hard_risks: hard,
    notices: note,
    conflict_signature: hard.includes('critical_fact_conflict') ? conflictSignature(candidate) : ''
  };
}

function actionFor(reason) {
  return {
    project_ownership_conflict: '请选择该资料实际所属的项目；如证据互相冲突，请分别处理。',
    critical_fact_conflict: '请对照原文确认金额、日期、单位或状态，并选择正确事实。',
    missing_or_unverifiable_evidence: '请补充可定位的原文证据，或退回该条目。',
    unsupported_model_fact: '请删除来源没有写明的内容，或提供支持它的原文证据。',
    company_reuse_promotion: '请确认是否把这条项目资料提升为公司可复用知识。'
  }[reason];
}

function groupMandatory(classifications) {
  const groups = new Map();
  for (const item of classifications) {
    for (const reason of item.hard_risks) {
      const conflictPart = reason === 'critical_fact_conflict'
        ? `:${item.conflict_signature || item.candidate_id}` : '';
      const key = `${item.source_document_id}:${reason}${conflictPart}`;
      if (!groups.has(key)) groups.set(key, {
        group_id: id('review', key),
        source_document_id: item.source_document_id,
        root_cause: reason,
        action: actionFor(reason),
        candidate_ids: []
      });
      groups.get(key).candidate_ids.push(item.candidate_id);
    }
  }
  return [...groups.values()].map((group) => ({
    ...group,
    candidate_ids: sortedUnique(group.candidate_ids)
  })).sort((a, b) => a.group_id.localeCompare(b.group_id));
}

function plainSummary(counters, groups) {
  const first = `本次生成 ${counters.generated} 条：自动通过 ${counters.auto_passed} 条，`
    + `通过并提示 ${counters.notices} 条，需要处理 ${counters.needs_handling} 条。`;
  if (!groups.length) return `${first} 无需逐条确认。`;
  return `${first} 请按 ${groups.length} 个问题组处理：确认正确内容、补充证据，或退回有问题的条目。`;
}

function evaluatePhase3(phase2Result) {
  const route = object(phase2Result && phase2Result.route) ? phase2Result.route : {};
  const candidates = phase2Result && phase2Result.business_item_batch
    && Array.isArray(phase2Result.business_item_batch.items)
    ? phase2Result.business_item_batch.items : [];
  const classifications = candidates.map((candidate) => classifyCandidate(candidate, route));
  const groups = groupMandatory(classifications);
  const counters = {
    generated: classifications.length,
    auto_passed: classifications.filter((item) => item.outcome === OUTCOMES.PASS).length,
    notices: classifications.filter((item) => item.outcome === OUTCOMES.NOTICE).length,
    needs_handling: classifications.filter((item) => item.outcome === OUTCOMES.MANUAL).length,
    handling_groups: groups.length
  };
  return {
    schema_version: PHASE3_SCHEMA_VERSION,
    mode: 'shadow_review',
    classifications,
    handling_groups: groups,
    summary: plainSummary(counters, groups),
    counters,
    diagnostics: {
      rules: { hard_risks: HARD_RISKS, notice_reasons: NOTICE_REASONS },
      phase2_schema_version: phase2Result && phase2Result.schema_version
    },
    writes_performed: 0,
    deletes_performed: 0,
    state_transitions_performed: 0
  };
}

function runPhase3Shadow(phase2Result, settings = {}) {
  const effective = { ...PHASE3_SETTINGS_DEFAULTS, ...(object(settings) ? settings : {}) };
  if (effective.phase3_shadow_enabled !== true) {
    return {
      schema_version: PHASE3_SCHEMA_VERSION,
      mode: 'feature_off',
      summary: '第三阶段试运行未开启。',
      classifications: [],
      handling_groups: [],
      counters: { generated: 0, auto_passed: 0, notices: 0, needs_handling: 0, handling_groups: 0 },
      writes_performed: 0, deletes_performed: 0, state_transitions_performed: 0
    };
  }
  return evaluatePhase3(phase2Result);
}

function createDecisionEntry(input, previousEntry = null) {
  const candidateIds = Object.freeze(sortedUnique(
    Array.isArray(input.candidate_ids) ? input.candidate_ids.map(String) : []
  ));
  const payload = {
    schema_version: PHASE3_SCHEMA_VERSION,
    decision_id: text(input.decision_id, 300) || id('decision', input),
    decided_at: text(input.decided_at, 80),
    decided_by: text(input.decided_by, 200),
    source_document_id: text(input.source_document_id, 300),
    group_id: text(input.group_id, 300),
    decision: text(input.decision, 80),
    candidate_ids: candidateIds,
    reason: text(input.reason, 1000),
    previous_entry_hash: previousEntry ? previousEntry.entry_hash : null
  };
  return Object.freeze({ ...payload, entry_hash: digest(payload) });
}

function verifyDecisionLedger(entries) {
  if (!Array.isArray(entries)) return false;
  let previous = null;
  for (const entry of entries) {
    const { entry_hash: entryHash, ...payload } = entry;
    if (payload.previous_entry_hash !== (previous ? previous.entry_hash : null)) return false;
    if (digest(payload) !== entryHash) return false;
    previous = entry;
  }
  return true;
}

function planDocumentWithdrawal(sourceDocumentId, affectedRecordIds = []) {
  const documentId = text(sourceDocumentId, 300);
  if (!documentId) throw new Error('缺少来源文档编号');
  const recordIds = Object.freeze(sortedUnique(affectedRecordIds.map(String)));
  return Object.freeze({
    schema_version: PHASE3_SCHEMA_VERSION,
    plan_id: id('withdraw', [documentId, recordIds]),
    source_document_id: documentId,
    affected_record_ids: recordIds,
    status: 'planned_not_executed',
    steps: Object.freeze([
      '标记该来源文档产生的记录为待撤回',
      '在受控写入阶段反向应用该文档的写入清单',
      '保留原文件、项目状态和完整决策记录'
    ]),
    deletes_user_files: false,
    changes_project_status: false,
    writes_performed: 0
  });
}

module.exports = {
  PHASE3_SCHEMA_VERSION,
  PHASE3_SETTINGS_DEFAULTS,
  OUTCOMES,
  HARD_RISKS,
  NOTICE_REASONS,
  evidenceIsVerifiable,
  conflictSignature,
  classifyCandidate,
  groupMandatory,
  evaluatePhase3,
  runPhase3Shadow,
  createDecisionEntry,
  verifyDecisionLedger,
  planDocumentWithdrawal
};
