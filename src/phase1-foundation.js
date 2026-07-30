'use strict';

/**
 * Phase 1 的纯本地并行基础。
 * 本模块不接入生产切片流程、不访问文件系统，也不包含网络或供应商调用。
 */

/** @typedef {Record<string, any>} AnyRecord */

const SCHEMA_VERSION = '1.0';
const RECORD_KINDS = Object.freeze(['project', 'source_document', 'business_item', 'company_knowledge']);
const LIBRARIES = Object.freeze(['active_tender', 'business']);
const PROJECT_STATES = Object.freeze([
  'lead', 'approved', 'bidding', 'submitted', 'evaluating', 'won', 'lost',
  'paused', 'terminated', 'contracted', 'archived'
]);
const ARCHIVE_OUTCOMES = Object.freeze(['won_completed', 'lost', 'terminated', 'paused_by_decision']);

/** @type {Readonly<Record<string, string>>} */
const STATE_LABELS = Object.freeze({
  lead: '线索', approved: '已批准', bidding: '投标准备中', submitted: '已提交',
  evaluating: '评审中', won: '已中标', lost: '未中标', paused: '已暂停',
  terminated: '已终止', contracted: '已签约', archived: '已归档'
});

/** @type {Readonly<Record<string, string[]>>} */
const ALLOWED_TRANSITIONS = Object.freeze({
  lead: ['approved', 'lost', 'paused', 'terminated'],
  approved: ['bidding', 'paused', 'terminated'],
  bidding: ['submitted', 'paused', 'terminated'],
  submitted: ['evaluating', 'won', 'lost', 'paused', 'terminated'],
  evaluating: ['won', 'lost', 'paused', 'terminated'],
  won: ['contracted', 'archived'],
  lost: ['archived'],
  paused: ['approved', 'bidding', 'submitted', 'evaluating', 'terminated', 'archived'],
  terminated: ['archived'],
  contracted: ['archived'],
  archived: []
});

const ACTIVE_TENDER_CATEGORIES = Object.freeze([
  ['project_overview', '项目概览'],
  ['opportunity_customer', '商机与客户'],
  ['tender_documents_interpretation', '招标文件与解读'],
  ['site_survey_original_materials', '现场踏勘与原始资料'],
  ['bid_strategy_responsibilities', '投标策略与职责分工'],
  ['technical_solution', '技术方案'],
  ['design_optimization', '设计与优化'],
  ['construction_organization_schedule', '施工组织与进度计划'],
  ['technical_bid', '技术标'],
  ['commercial_quotation_cost', '商务报价与成本'],
  ['procurement_subcontracting', '采购与分包'],
  ['risk_deviation_compliance', '风险、偏差与合规'],
  ['internal_review_decision', '内部评审与决策'],
  ['qa_addenda', '答疑与补遗'],
  ['bid_document_submission_history', '投标文件与提交历史'],
  ['opening_evaluation_award_tracking', '开标、评标与中标跟踪'],
  ['contract_negotiation_signing', '合同谈判与签约'],
  ['review_knowledge_candidates', '复盘与知识候选'],
  ['project_correspondence', '项目往来函件'],
  ['meeting_minutes_decisions', '会议纪要与决议'],
  ['project_material_index', '项目资料索引']
].map(([key, label]) => Object.freeze({ key, label, storage: 'owned' })));

const ACTIVE_TENDER_REFERENCE_CATEGORIES = Object.freeze([
  Object.freeze({
    key: 'business_common_knowledge_refs',
    label: '引用业务库通用知识',
    storage: 'reference',
    target_library: 'business',
    target_category: 'terminology_general_knowledge'
  }),
  Object.freeze({
    key: 'business_templates_tools_refs',
    label: '引用业务库模板与工具',
    storage: 'reference',
    target_library: 'business',
    target_category: 'templates_tools'
  })
]);

const BUSINESS_CATEGORIES = Object.freeze([
  ['customers', '客户'],
  ['complete_historical_projects', '完整历史项目'],
  ['proposals_cases', '提案与案例'],
  ['quotation_cost', '报价与成本'],
  ['construction_organization_schedules', '施工组织与进度计划'],
  ['risks_issues', '风险与问题'],
  ['failures_terminated_lessons', '失败与终止项目教训'],
  ['talent_experts', '人才与专家'],
  ['suppliers_subcontractors', '供应商与分包商'],
  ['materials_equipment', '材料与设备'],
  ['standards_specifications', '标准与规范'],
  ['contracts_legal', '合同与法务'],
  ['technical_methods_workmanship', '技术方法与工艺'],
  ['quality_acceptance', '质量与验收'],
  ['safety_civilized_construction', '安全与文明施工'],
  ['correspondence_important_decisions', '往来函件与重要决策'],
  ['company_systems_processes', '公司制度与流程'],
  ['market_competition_intelligence', '市场与竞争情报'],
  ['templates_tools', '模板与工具'],
  ['terminology_general_knowledge', '术语与通用知识']
].map(([key, label]) => Object.freeze({ key, label })));

const BUSINESS_ITEM_TYPES = Object.freeze([
  ['requirement', '要求'],
  ['decision', '决策'],
  ['commitment', '承诺'],
  ['risk', '风险'],
  ['issue', '问题'],
  ['change', '变更'],
  ['action', '行动'],
  ['quotation', '报价'],
  ['material', '材料'],
  ['method', '方法'],
  ['acceptance_criterion', '验收标准'],
  ['clarification', '澄清'],
  ['contract_obligation', '合同义务'],
  ['project_lesson', '项目教训']
].map(([key, label]) => Object.freeze({ key, label })));

const DIRECTORY_PLAN = Object.freeze({
  version: SCHEMA_VERSION,
  mode: 'definitions_only',
  auto_create_or_move: false,
  libraries: Object.freeze([
    Object.freeze({
      key: 'active_tender',
      label: '在办投标库',
      suggested_path: '在办投标库',
      categories: Object.freeze([...ACTIVE_TENDER_CATEGORIES, ...ACTIVE_TENDER_REFERENCE_CATEGORIES])
    }),
    Object.freeze({
      key: 'business',
      label: '长期业务库',
      suggested_path: '长期业务库',
      categories: BUSINESS_CATEGORIES
    })
  ])
});

const COMMON_FIELDS = new Set([
  'schema_version', 'record_kind', 'record_id', 'title', 'library', 'created_at', 'updated_at',
  'project_ids', 'source_document_ids', 'business_item_ids', 'company_knowledge_ids',
  'supersedes_id', 'replaces_id', 'derived_from_ids', 'related_item_ids', 'extensions'
]);

/** @type {Readonly<Record<string, Set<string>>>} */
const KIND_FIELDS = Object.freeze({
  project: new Set(['state', 'archive_outcome', 'archive_decided_at']),
  source_document: new Set(['source_path', 'source_hash', 'media_type']),
  business_item: new Set(['category', 'item_type', 'summary']),
  company_knowledge: new Set(['category', 'summary', 'reuse_status'])
});

/** @param {unknown} value */
function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** @param {any} value */
function cloneJson(value) {
  if (value === undefined) return undefined;
  return JSON.parse(JSON.stringify(value));
}

/** @param {any} value */
function text(value) {
  return typeof value === 'string' ? value.trim() : '';
}

/** @param {any} value */
function uniqueStrings(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map(text).filter(Boolean))].sort();
}

/** @param {AnyRecord} input @param {Set<string>} known */
function normalizeExtensions(input, known) {
  const extensions = isPlainObject(input.extensions) ? cloneJson(input.extensions) : {};
  for (const key of Object.keys(input).sort()) {
    if (!known.has(key)) extensions[key] = cloneJson(input[key]);
  }
  return extensions;
}

/** @param {AnyRecord} input @returns {AnyRecord} */
function normalizeRecord(input) {
  if (!isPlainObject(input)) throw new TypeError('记录必须是对象');
  const kind = text(input.record_kind);
  if (!RECORD_KINDS.includes(kind)) throw new Error(`不支持的记录类型：${kind || '空'}`);
  const known = new Set([...COMMON_FIELDS, ...KIND_FIELDS[kind]]);
  /** @type {AnyRecord} */
  const output = {
    schema_version: SCHEMA_VERSION,
    record_kind: kind,
    record_id: text(input.record_id),
    title: text(input.title),
    library: text(input.library),
    created_at: text(input.created_at),
    updated_at: text(input.updated_at)
  };
  for (const field of [
    'project_ids', 'source_document_ids', 'business_item_ids', 'company_knowledge_ids',
    'derived_from_ids', 'related_item_ids'
  ]) {
    const values = uniqueStrings(input[field]);
    if (values.length) output[field] = values;
  }
  for (const field of ['supersedes_id', 'replaces_id']) {
    const value = text(input[field]);
    if (value) output[field] = value;
  }
  for (const field of KIND_FIELDS[kind]) {
    if (field === 'state' || field === 'archive_outcome' || field === 'category' || field === 'item_type' || field === 'summary'
      || field === 'reuse_status' || field === 'source_path' || field === 'source_hash'
      || field === 'media_type' || field === 'archive_decided_at') {
      const value = text(input[field]);
      if (value) output[field] = value;
    }
  }
  const extensions = normalizeExtensions(input, known);
  if (Object.keys(extensions).length) output.extensions = extensions;
  return output;
}

/** @param {AnyRecord} input */
function validateRecord(input) {
  let record;
  try {
    record = normalizeRecord(input);
  } catch (error) {
    return { valid: false, errors: [error instanceof Error ? error.message : String(error)] };
  }
  const errors = [];
  if (!record.record_id) errors.push('record_id 不能为空');
  if (!record.title) errors.push('title 不能为空');
  if (!LIBRARIES.includes(record.library)) errors.push('library 必须是在办投标库或长期业务库');
  if (!record.created_at) errors.push('created_at 不能为空');
  if (!record.updated_at) errors.push('updated_at 不能为空');
  if (record.record_kind === 'project') {
    if (!PROJECT_STATES.includes(record.state)) errors.push('state 不是有效项目状态');
    if (record.state === 'archived' && !ARCHIVE_OUTCOMES.includes(record.archive_outcome)) {
      errors.push('归档项目必须说明 archive_outcome');
    }
    if (record.state !== 'archived' && record.archive_outcome) {
      errors.push('未归档项目不能设置 archive_outcome');
    }
  }
  if (record.record_kind === 'source_document' && !record.source_path && !record.source_hash) {
    errors.push('来源文档至少需要 source_path 或 source_hash');
  }
  if (record.record_kind === 'business_item' && record.category) {
    const categories = record.library === 'active_tender'
      ? [...ACTIVE_TENDER_CATEGORIES, ...ACTIVE_TENDER_REFERENCE_CATEGORIES]
      : BUSINESS_CATEGORIES;
    if (!categories.some((item) => item.key === record.category)) {
      errors.push('category 不是所属库的有效目录分类');
    }
  }
  if (record.record_kind === 'business_item' && record.item_type
    && !BUSINESS_ITEM_TYPES.some((item) => item.key === record.item_type)) {
    errors.push('item_type 不是有效业务条目类型');
  }
  if (record.record_kind === 'company_knowledge' && record.library !== 'business') {
    errors.push('公司知识只能存放在长期业务库');
  }
  return { valid: errors.length === 0, errors, value: record };
}

/** @param {AnyRecord} input */
function migrateRecord(input) {
  const migrated = normalizeRecord(input);
  const result = validateRecord(migrated);
  if (!result.valid) throw new Error(result.errors.join('；'));
  return result.value;
}

/** @param {string} fromState */
function expectedArchiveOutcome(fromState) {
  if (fromState === 'won' || fromState === 'contracted') return 'won_completed';
  if (fromState === 'lost') return 'lost';
  if (fromState === 'terminated') return 'terminated';
  if (fromState === 'paused') return 'paused_by_decision';
  return '';
}

/**
 * @param {string} fromState
 * @param {string} toState
 * @param {{archive_outcome?: string, explicit_decision?: boolean}} options
 */
function validateProjectTransition(fromState, toState, options = {}) {
  if (!PROJECT_STATES.includes(fromState) || !PROJECT_STATES.includes(toState)) {
    return { allowed: false, reason: '项目状态无效' };
  }
  if (!ALLOWED_TRANSITIONS[fromState].includes(toState)) {
    return { allowed: false, reason: `不允许从“${STATE_LABELS[fromState]}”转为“${STATE_LABELS[toState]}”` };
  }
  if (toState !== 'archived') return { allowed: true };
  const expected = expectedArchiveOutcome(fromState);
  if (!expected || options.archive_outcome !== expected) {
    return { allowed: false, reason: '归档结果与当前项目状态不匹配' };
  }
  if (fromState === 'paused' && options.explicit_decision !== true) {
    return { allowed: false, reason: '暂停项目只能在明确作出归档决定后归档' };
  }
  return { allowed: true, archive_outcome: expected };
}

/** @param {string} prefix @param {any} value @param {number} index */
function legacyId(prefix, value, index) {
  const candidate = text(value).replace(/[^A-Za-z0-9._:-]+/g, '-').replace(/^-+|-+$/g, '');
  return `${prefix}:${candidate || String(index + 1)}`;
}

/**
 * 只读迁移规划：仅消费调用方提供的旧卡片和任务快照，返回计划，不写文件。
 */
/** @param {AnyRecord} legacy */
function planLegacyMigration(legacy = {}) {
  const cards = Array.isArray(legacy.cards) ? legacy.cards : [];
  const tasks = Array.isArray(legacy.tasks) ? legacy.tasks : [];
  /** @type {AnyRecord[]} */
  const actions = [];
  cards.forEach((card, index) => {
    const projectName = text(card.project);
    const cardId = legacyId('legacy-card', card.card_id || card.title, index);
    actions.push({
      action: 'extract_reusable_knowledge',
      source_ref: cardId,
      target_kind: 'company_knowledge',
      project_ref: projectName || undefined,
      preserves_source: true,
      reason: '旧卡片先作为可复用知识候选审阅，不等同于完整项目归档'
    });
  });
  tasks.forEach((task, index) => {
    const taskId = legacyId('legacy-task', task.task_id || task.taskId || task.source_path || task.sourcePath, index);
    actions.push({
      action: 'register_source_once',
      source_ref: taskId,
      target_kind: 'source_document',
      source_path: text(task.source_path || task.sourcePath),
      preserves_source: true
    });
  });
  const projects = Array.isArray(legacy.projects) ? legacy.projects : [];
  projects.forEach((project, index) => {
    const state = text(project.state || project.status);
    const outcome = text(project.archive_outcome);
    const check = validateProjectTransition(state, 'archived', {
      archive_outcome: outcome,
      explicit_decision: project.explicit_archival_decision === true
    });
    actions.push({
      action: 'archive_complete_project',
      source_ref: legacyId('legacy-project', project.record_id || project.project_id || project.title, index),
      target_kind: 'project',
      archive_outcome: outcome || undefined,
      ready: check.allowed,
      reason: check.allowed ? '完整项目资料可整体进入历史项目' : check.reason,
      preserves_source: true
    });
  });
  return {
    plan_version: SCHEMA_VERSION,
    mode: 'dry_run',
    writes_performed: 0,
    deletes_performed: 0,
    provider_calls: 0,
    input_counts: { cards: cards.length, tasks: tasks.length, projects: projects.length },
    actions
  };
}

module.exports = {
  SCHEMA_VERSION,
  RECORD_KINDS,
  LIBRARIES,
  PROJECT_STATES,
  ARCHIVE_OUTCOMES,
  STATE_LABELS,
  ALLOWED_TRANSITIONS,
  ACTIVE_TENDER_CATEGORIES,
  ACTIVE_TENDER_REFERENCE_CATEGORIES,
  BUSINESS_CATEGORIES,
  BUSINESS_ITEM_TYPES,
  DIRECTORY_PLAN,
  normalizeRecord,
  validateRecord,
  migrateRecord,
  validateProjectTransition,
  planLegacyMigration
};
