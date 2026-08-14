'use strict';

const crypto = require('crypto');
const { CONTRACT_VERSION, validateKnowledgeEvent, validateCardPlan } = require('./useful-card-contract.js');
const hash = (value) => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const clean = (value, max = 8000) => String(value || '').normalize('NFKC').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, max);
const uniq = (items) => [...new Set((items || []).map((x) => clean(x, 300)).filter(Boolean))];

const TYPE_RULES = [
  ['term_definition', /(?:是指|定义为|系指|means|refers to|definition)/i],
  ['acceptance', /(?:验收|合格|允许偏差|acceptance|pass criteria)/i],
  ['commercial_term', /(?:付款|报价|合同价|保函|违约|payment|price)/i],
  ['schedule', /(?:工期|里程碑|开工|完工|截止|schedule|deadline)/i],
  ['risk', /(?:风险|隐患|可能导致|risk|hazard)/i],
  ['requirement', /(?:必须|应当|应|不得|须|shall|must|required)/i],
  ['decision', /(?:决定|决议|批准|同意|approved|resolved)/i],
  ['action', /(?:行动项|待办|负责人|完成日期|action item)/i],
  ['procedure', /(?:步骤|流程|程序|依次|procedure|process)/i],
  ['method', /(?:方法|工艺|做法|method|technique)/i],
  ['guideline', /(?:宜|建议|推荐|should|recommended)/i],
  ['parameter', /(?:参数|规格|阈值|不少于|不超过|至少|至多|\d+(?:\.\d+)?\s*(?:mm|cm|m|kg|MPa|%|天|日|小时))/i],
  ['reference', /(?:参见|依据|引用|reference|see clause)/i],
  ['correspondence', /(?:发件人|收件人|主题|回复|from:|to:|subject:)/i],
  ['entity_profile', /(?:客户|业主|供应商|联系人|client|supplier)/i],
  ['lesson', /(?:经验|教训|复盘|lesson learned)/i],
  ['observation', /(?:发现|观察|现状|记录|observed)/i]
];
const CARD_TYPE = { term_definition: 'definition', checklist_item: 'check', section_overview: 'overview', document_metadata: 'metadata', entity_profile: 'profile', commitment: 'requirement' };
const SEMANTIC_KIND = { guideline: 'requirement', procedure: 'process', acceptance: 'requirement', commitment: 'requirement', term_definition: 'fact', checklist_item: 'action', section_overview: 'fact', document_metadata: 'fact', reference: 'fact', lesson: 'experience', observation: 'fact', unknown: 'fact' };

function inferType(text, block) {
  const explicit = clean(block.metadata?.knowledge_event_type, 60);
  if (explicit) return TYPE_RULES.some(([type]) => type === explicit) || ['commitment', 'checklist_item', 'section_overview', 'document_metadata', 'unknown'].includes(explicit) ? explicit : 'unknown';
  if (block.kind === 'heading') return 'section_overview';
  if (block.metadata?.document_metadata) return 'document_metadata';
  if (block.kind === 'list_item' && /^(?:☐|\[ ?\]|检查|核查)/.test(text)) return 'checklist_item';
  return TYPE_RULES.find(([, pattern]) => pattern.test(text))?.[0] || 'unknown';
}
function clauses(text) {
  return clean(text, 30000).split(/(?<=[。！？；;])\s*|\n+(?=(?:[-*•]|\d+[.)、]|[（(]?[一二三四五六七八九十]+[)）、]))/u).map((x) => clean(x)).filter(Boolean);
}
function isDependent(text) { return /^(?:其中|并且|以及|且|同时|但|但是|除非|除外|在.+(?:时|情况下)|若|如果|当|否则|前述|上述|其|该)/.test(text); }
function modality(text) { return clean(text.match(/不得|必须|应当|须|宜|可以|shall not|must not|shall|must|should|may/i)?.[0], 30) || '陈述'; }
function conditions(text) { return uniq([...text.matchAll(/(?:如果|若|当|在)([^，。；]{2,80})(?:时|情况下)?[,，]/g)].map((m) => m[0])); }
function exceptions(text) { return uniq([...text.matchAll(/(?:除非|除外|但|但是)([^。；]{2,100})/g)].map((m) => m[0])); }
function parameters(text) { return uniq([...text.matchAll(/-?\d+(?:\.\d+)?\s*(?:mm|cm|m|kg|t|MPa|%|元|万元|天|日|小时|次)?/gi)].map((m) => m[0])); }
function actor(text) { return clean(text.match(/^([^，。；:：]{2,30}?)(?=必须|应当|不得|须|宜|负责|应在)/)?.[1], 80); }
function subjectFor(text, context) {
  const stripped = clean(text.replace(/^(?:[-*•]|\d+[.)、]|[（(]?[一二三四五六七八九十]+[)）、])\s*/u, ''), 300);
  return clean(stripped.split(/必须|应当|不得|须|宜|可以|是指|定义为|：|:/)[0], 120) || clean(context.at(-1), 120) || '未明确主题';
}
function evidence(block) { return { block_id: block.block_id, locator: block.locator, verbatim: block.text, provenance: block.provenance || [] }; }

function extractKnowledgeEvents(document, regions = []) {
  const translation = new Map(regions.flatMap((r) => r.blocks.map((b) => [b.block_id, r.translated_text && r.blocks.length === 1 ? r.translated_text : b.text])));
  const events = []; const coverage = {}; let pending = null; let priorEvent = null;
  for (const block of document.blocks) {
    if (!block.text || ['header', 'footer', 'page'].includes(block.kind) || block.metadata?.noise) { coverage[block.block_id] = { status: 'dropped', reason: '结构噪声或空内容' }; continue; }
    if (block.kind === 'heading') { pending = { heading: block.text, hierarchy: [...block.hierarchy, block.text] }; priorEvent = null; coverage[block.block_id] = { status: 'context', reason: '标题作为继承上下文' }; continue; }
    const headingPath = uniq([...(block.hierarchy || []), pending?.heading]);
    const parts = clauses(translation.get(block.block_id) || block.text);
    let last = priorEvent;
    for (const part of parts) {
      if (last && isDependent(part) && (!block.metadata?.parent_clause_id || !last.source_context.parent_clause_id || block.metadata.parent_clause_id === last.source_context.parent_clause_id)) {
        last.predicate += ` ${part}`; last.conditions = uniq([...last.conditions, ...conditions(part)]);
        last.exceptions = uniq([...last.exceptions, ...exceptions(part)]); last.parameters = uniq([...last.parameters, ...parameters(part)]);
        last.evidence_ids = uniq([...last.evidence_ids, block.block_id]);
        continue;
      }
      const type = inferType(part, block); const subject = subjectFor(part, headingPath);
      const identity = [type, subject, part, headingPath, block.metadata?.scope_id || '', block.metadata?.parent_clause_id || ''];
      const event = validateKnowledgeEvent({
        schema_version: `${CONTRACT_VERSION}/knowledge-event`, event_id: `evt-${hash(identity).slice(0, 24)}`,
        semantic_type: type, subject, predicate: part, actor: actor(part), object: subject,
        modality: modality(part), conditions: conditions(part), exceptions: exceptions(part), parameters: parameters(part),
        temporal_scope: clean(block.metadata?.temporal_scope, 160), applicability_scope: clean(block.metadata?.scope_id, 160),
        source_context: { heading_path: headingPath, parent_clause_id: clean(block.metadata?.parent_clause_id, 160), list_id: clean(block.metadata?.list_id, 160), table_headers: uniq(block.metadata?.table_headers), unit: clean(block.metadata?.unit, 40) },
        evidence_ids: [block.block_id], confidence: type === 'unknown' ? 0.45 : 0.9,
        uncertainty: type === 'unknown' ? ['语义类型无法由显式结构或通用语言信号确定'] : []
      });
      events.push(event); last = event;
    }
    priorEvent = last;
    coverage[block.block_id] = { status: 'covered', event_ids: events.filter((e) => e.evidence_ids.includes(block.block_id)).map((e) => e.event_id) };
  }
  return { events, coverage };
}
function titleFor(event) {
  const intent = { requirement: '要求', guideline: '建议', procedure: '流程', method: '方法', parameter: '参数', acceptance: '验收检查', risk: '风险应对', decision: '决策', action: '行动项', commitment: '承诺', commercial_term: '商务条款', schedule: '时间要求', term_definition: '定义', checklist_item: '检查项', reference: '引用依据', entity_profile: '实体信息', lesson: '经验', observation: '观察', unknown: '待确认知识' }[event.semantic_type] || '概览';
  const detail = event.parameters[0] || event.conditions[0] || event.modality;
  return clean(`${event.subject}：${intent}${detail && detail !== '陈述' ? `（${detail}）` : ''}`, 160);
}
function bodyFor(event) {
  const lead = { requirement: '要求', guideline: '建议', procedure: '步骤', method: '做法', parameter: '参数', acceptance: '验收标准', risk: '风险', decision: '决定', action: '行动', commitment: '承诺', commercial_term: '条款', schedule: '时间安排', term_definition: '定义', checklist_item: '检查项', lesson: '经验', unknown: '待确认内容' }[event.semantic_type] || '内容';
  const lines = [`${lead}：${event.predicate}`];
  if (event.actor) lines.push(`执行主体：${event.actor}`);
  if (event.conditions.length) lines.push(`适用条件：${event.conditions.join('；')}`);
  if (event.exceptions.length) lines.push(`例外：${event.exceptions.join('；')}`);
  if (event.parameters.length) lines.push(`关键参数：${event.parameters.join('；')}`);
  if (event.source_context.table_headers.length) lines.push(`表格语境：${event.source_context.table_headers.join(' / ')}${event.source_context.unit ? `（${event.source_context.unit}）` : ''}`);
  return lines.join('\n');
}
function planUsefulCards(events) {
  const ids = new Set(events.map((e) => e.event_id));
  return events.map((event) => {
    const related = events.filter((other) => other.event_id !== event.event_id && (other.source_context.heading_path.join('/') === event.source_context.heading_path.join('/') || other.subject === event.subject)).map((e) => e.event_id);
    return validateCardPlan({
      schema_version: `${CONTRACT_VERSION}/card-plan`, plan_id: `plan-${hash(event.event_id).slice(0, 24)}`,
      user_question: `关于“${event.subject}”，需要知道什么${event.semantic_type === 'term_definition' ? '定义' : '要求或做法'}？`,
      retrieval_intent: `${event.subject}/${event.semantic_type}`, search_title: titleFor(event), aliases: [],
      card_type: CARD_TYPE[event.semantic_type] || event.semantic_type, included_event_ids: [event.event_id],
      necessary_inherited_context: { heading_path: event.source_context.heading_path, table_headers: event.source_context.table_headers, unit: event.source_context.unit },
      related_but_not_merged_event_ids: related, evidence_ids: event.evidence_ids, body: bodyFor(event),
      decision: event.conditions.length || event.exceptions.length || event.evidence_ids.length > 1
        ? { mode: 'combine_dependent', reasons: ['条件、例外或跨块续文依赖治理事件'], differing_fields: [] }
        : { mode: 'split_independent', reasons: ['每个事件回答一个可独立检索的问题'], differing_fields: [] }
    }, ids);
  });
}
function generateUsefulCards(document, regions, options = {}) {
  const extracted = extractKnowledgeEvents(document, regions);
  const plans = planUsefulCards(extracted.events);
  const inherited = plans.reduce((n, p) => n + JSON.stringify(p.necessary_inherited_context).length, 0);
  return { ...extracted, plans, diagnostics: {
    events_detected: extracted.events.length, cards_planned: plans.length,
    events_per_card: plans.map((p) => p.included_event_ids.length), independent_siblings_merged: 0,
    orphan_conditions: 0, inherited_context_characters: inherited, title_body_scope_mismatch: 0,
    unknown_types: extracted.events.filter((e) => e.semantic_type === 'unknown').length,
    planner_split_reasons: { independent_retrieval_intent: plans.filter((p) => p.decision.mode === 'split_independent').length },
    planner_combine_reasons: { dependent_context: plans.filter((p) => p.decision.mode === 'combine_dependent').length },
    model_batches: Number(options.model_batches) || 0, semantic_boundaries_depend_on_batch_size: false
  }};
}

module.exports = { extractKnowledgeEvents, planUsefulCards, generateUsefulCards, inferType, clauses, SEMANTIC_KIND };
