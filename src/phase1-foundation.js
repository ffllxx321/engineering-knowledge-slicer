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

const BUSINESS_CATEGORIES = Object.freeze([
  ['historical_projects', '历史项目'],
  ['standards', '标准规范'],
  ['correspondence', '往来函件'],
  ['materials', '材料'],
  ['suppliers', '供应商'],
  ['costs', '成本'],
  ['methods', '方法做法'],
  ['risks', '风险'],
  ['company_knowledge', '公司知识']
].map(([key, label]) => Object.freeze({ key, label })));

const DIRECTORY_PLAN = Object.freeze({
  version: SCHEMA_VERSION,
  mode: 'definitions_only',
  roots: Object.freeze([
    Object.freeze({
      library: 'active_tender',
      label: '在办投标库',
      suggested_path: '在办投标库',
      categories: Object.freeze([
        Object.freeze({ key: 'projects', label: '在办项目', storage: 'owned' }),
        Object.freeze({
          key: 'common_knowledge',
          label: '通用知识',
          storage: 'reference',
          target_library: 'business',
          target_category: 'company_knowledge'
        }),
        Object.freeze({
          key: 'templates',
          label: '模板',
          storage: 'reference',
          target_library: 'business',
          target_category: 'company_knowledge'
        })
      ])
    }),
    Object.freeze({
      library: 'business',
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
  business_item: new Set(['category', 'summary']),
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
    if (field === 'state' || field === 'archive_outcome' || field === 'category' || field === 'summary'
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
  if (record.record_kind === 'business_item'
    && !BUSINESS_CATEGORIES.some((item) => item.key === record.category)) {
    errors.push('category 不是有效业务分类');
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
  BUSINESS_CATEGORIES,
  DIRECTORY_PLAN,
  normalizeRecord,
  validateRecord,
  migrateRecord,
  validateProjectTransition,
  planLegacyMigration
};
