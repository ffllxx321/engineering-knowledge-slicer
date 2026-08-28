'use strict';

const CONTRACT_VERSION = 'useful-card/2.0';
const EVENT_TYPES = Object.freeze([
  'requirement', 'guideline', 'procedure', 'method', 'parameter', 'acceptance', 'risk',
  'decision', 'action', 'commitment', 'commercial_term', 'schedule', 'term_definition',
  'checklist_item', 'section_overview', 'document_metadata', 'correspondence', 'reference',
  'entity_profile', 'lesson', 'observation', 'unknown'
]);
const CARD_TYPES = Object.freeze([
  'requirement', 'guideline', 'procedure', 'method', 'parameter', 'acceptance', 'risk',
  'decision', 'action', 'commercial_term', 'schedule', 'definition', 'check', 'overview',
  'metadata', 'correspondence', 'reference', 'profile', 'lesson', 'observation', 'unknown'
]);

function fail(message, code = 'USEFUL_CARD_CONTRACT_INVALID') {
  throw Object.assign(new Error(message), { code });
}
function strings(value) { return Array.isArray(value) && value.every((item) => typeof item === 'string'); }
function validateKnowledgeEvent(event) {
  if (!event || event.schema_version !== `${CONTRACT_VERSION}/knowledge-event`) fail('KnowledgeEvent 版本无效');
  if (!EVENT_TYPES.includes(event.semantic_type)) fail('KnowledgeEvent 类型无效；不得回退为通用事实', 'KNOWLEDGE_EVENT_TYPE_INVALID');
  for (const key of ['event_id', 'subject', 'predicate']) if (typeof event[key] !== 'string' || !event[key].trim()) fail(`KnowledgeEvent 缺少 ${key}`);
  if (event.subject === '未明确主题') fail('占位主题不得自动存储', 'KNOWLEDGE_EVENT_SUBJECT_UNCERTAIN');
  for (const key of ['conditions', 'exceptions', 'parameters', 'evidence_ids', 'uncertainty']) if (!strings(event[key])) fail(`KnowledgeEvent ${key} 必须是字符串数组`);
  if (!event.source_context || !strings(event.source_context.heading_path)) fail('KnowledgeEvent 缺少结构上下文');
  if (!Number.isFinite(event.confidence) || event.confidence < 0 || event.confidence > 1) fail('KnowledgeEvent 置信度无效');
  if (event.semantic_type === 'unknown' && !event.uncertainty.length) fail('unknown 类型必须显式说明不确定性');
  return event;
}
function validateCardPlan(plan, eventIds = new Set()) {
  if (!plan || plan.schema_version !== `${CONTRACT_VERSION}/card-plan`) fail('CardPlan 版本无效');
  if (!CARD_TYPES.includes(plan.card_type)) fail('CardPlan 类型无效');
  for (const key of ['plan_id', 'retrieval_intent', 'title', 'search_title', 'body']) if (typeof plan[key] !== 'string' || !plan[key].trim()) fail(`CardPlan 缺少 ${key}`);
  for (const key of ['included_event_ids', 'related_but_not_merged_event_ids', 'evidence_ids']) if (!strings(plan[key])) fail(`CardPlan ${key} 必须是字符串数组`);
  if (!plan.included_event_ids.length || plan.included_event_ids.some((id) => eventIds.size && !eventIds.has(id))) fail('CardPlan 引用了未知事件');
  if (plan.aliases?.some((item) => item === plan.search_title || item === plan.title)) fail('别名不得与展示标题或检索标题相同');
  if (!plan.decision || !['split_independent', 'combine_dependent'].includes(plan.decision.mode)) fail('CardPlan 缺少原子性决策');
  return plan;
}

module.exports = { CONTRACT_VERSION, EVENT_TYPES, CARD_TYPES, validateKnowledgeEvent, validateCardPlan };
