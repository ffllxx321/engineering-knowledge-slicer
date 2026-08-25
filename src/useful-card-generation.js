'use strict';

const crypto = require('crypto');
const { CONTRACT_VERSION, validateKnowledgeEvent, validateCardPlan } = require('./useful-card-contract.js');
const { normalizeSemanticText, dedupeSemanticTexts } = require('./semantic-text.js');
const hash = (value) => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const clean = (value, max = 8000) => String(value || '').normalize('NFKC').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, max);
const uniq = (items) => [...new Set((items || []).map((x) => clean(x, 300)).filter(Boolean))];

const TYPE_RULES = [
  ['term_definition', /(?:是指|定义为|系指|means|refers to|definition)/i],
  ['acceptance', /(?:验收|合格|允许偏差|acceptance|pass criteria)/i],
  ['commercial_term', /(?:付款|报价|合同价|保函|违约|payment|price)/i],
  ['schedule', /(?:工期|里程碑|开工|完工|截止|schedule|deadline)/i],
  ['risk', /(?:风险|隐患|可能导致|risk|hazard)/i],
  ['requirement', /(?:必须|应当|(?<!不)应|不得|须|shall|must|required)/i],
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
const LIST_MARKER = /^(?:[-*•]\s*|[（(]\s*\d+\s*[)）]\s*|\d+\s*[.)、]\s*|[（(]?[一二三四五六七八九十]+[)）、]\s*)/u;
function stripListMarker(text) { return clean(String(text || '').replace(LIST_MARKER, '')); }
function modality(text) { return clean(text.match(/不得|不宜|必须|应当|须|宜|可以|shall not|must not|shall|must|should|may/i)?.[0], 30) || '陈述'; }
function conditions(text) { return uniq([...text.matchAll(/(?:如果|若|当|在)([^，。；]{2,80})(?:时|情况下)?[,，]/g)].map((m) => m[0])); }
function exceptions(text) { return uniq([...text.matchAll(/(?:除非|除外|但|但是)([^。；]{2,100})/g)].map((m) => m[0])); }
function parameters(text) { return uniq([...stripListMarker(text).matchAll(/-?\d+(?:\.\d+)?\s*(?:MPa|mm\/s|mm|cm|kg|万元|小时|m|t|%|元|天|日|次|°C)/gi)].map((m) => m[0])); }
function actor(text) { return clean(stripListMarker(text).match(/^([^，。；:：]{2,30}?)(?=必须|应当|不得|须|负责|应在)/)?.[1], 80); }
function subjectFor(text, context) {
  const stripped = stripListMarker(text).slice(0, 300);
  return clean(stripped.split(/必须|应当|不得|不宜|须|宜|可以|是指|定义为|：|:/)[0], 120) || clean(context.at(-1), 120);
}
function evidence(block) { return { block_id: block.block_id, locator: block.locator, verbatim: block.raw_verbatim ?? block.text, provenance: block.provenance || [] }; }
function definitionAliases(event) {
  if (event.semantic_type !== 'term_definition') return [];
  const prefix = event.predicate.split(/是指|定义为|系指|means|refers to/i)[0];
  const parenthetical = [...prefix.matchAll(/[（(]([^）)]+)[）)]/g)].flatMap((match) => match[1].split(/[，,、/]/));
  const abbreviation = [...prefix.matchAll(/\b[A-Z][A-Z0-9-]{1,12}\b/g)].map((match) => match[0]);
  const english = parenthetical.filter((item) => /[A-Za-z]{3}/.test(item));
  return uniq([...english, ...abbreviation]).filter((item) => item !== event.subject);
}

function extractKnowledgeEvents(document, regions = []) {
  const translation = new Map(regions.flatMap((r) => r.blocks.map((b) => [b.block_id, r.translated_text && r.blocks.length === 1 ? r.translated_text : b.text])));
  const events = []; const coverage = {}; let pending = null;
  const nodes = new Map((document.structure?.nodes || []).map((node) => [node.source_identity.block_id, node]));
  const blocksById = new Map(document.blocks.map((block) => [block.block_id, block]));
  const continuation = new Map((document.structure?.edges || []).filter((edge) => edge.kind === 'continuation_of' && edge.confidence >= 0.8).map((edge) => [edge.from, edge.to]));
  const eventByNode = new Map(); let activeContainer = '';
  const tableHeaders = new Map(); const tableGroups = new Map();
  for (const block of document.blocks) if (['table_cell', 'spreadsheet_cell'].includes(block.kind) && block.metadata?.row) {
    const key = [block.metadata.part || '', block.metadata.sheet || '', block.metadata.slide || '', block.metadata.table || 'table', block.metadata.row].join(':');
    if (!tableGroups.has(key)) tableGroups.set(key, []); tableGroups.get(key).push(block);
  }
  const occurrences = new Map();
  for (const block of document.blocks) occurrences.set(block.text, (occurrences.get(block.text) || 0) + 1);
  const seenRows = new Set(); const eventBlocks = [];
  for (const block of document.blocks) {
    if (!['table_cell', 'spreadsheet_cell'].includes(block.kind) || !block.metadata?.row) { eventBlocks.push(block); continue; }
    if (block.metadata?.reconstructed_table_fact) { eventBlocks.push(block); continue; }
    const tableId = [block.metadata.part || '', block.metadata.sheet || '', block.metadata.slide || '', block.metadata.table || 'table'].join(':'); const rowKey = `${tableId}:${block.metadata.row}`;
    if (seenRows.has(rowKey)) continue; seenRows.add(rowKey);
    const cells = tableGroups.get(rowKey).sort((a, b) => Number(a.metadata.cell || a.metadata.column || 0) - Number(b.metadata.cell || b.metadata.column || 0)); const values = cells.map((cell) => cell.text); const headers = tableHeaders.get(tableId);
    if (!headers) tableHeaders.set(tableId, values);
    eventBlocks.push({ ...block, kind: 'table_row', text: values.join(' | '), metadata: { ...block.metadata, table_id: tableId, row_id: `row-${block.metadata.row}`, table_header: !headers, table_headers: headers || [], source_block_ids: cells.map((cell) => cell.block_id) } });
  }
  for (const block of eventBlocks) {
    const node = nodes.get(block.block_id);
    const container = clean(block.locator?.attachment_id || block.metadata?.attachment_id || block.locator?.message_id || block.metadata?.message_id || block.locator?.slide || block.metadata?.slide || block.locator?.sheet || block.metadata?.sheet, 160);
    if (container && activeContainer && container !== activeContainer) pending = null;
    if (container) activeContainer = container;
    const repeatedBoilerplate = occurrences.get(block.text) > 1 && (block.metadata?.repeated_marginalia === true
      || /(?:受控副本|技术文件|confidential|controlled copy|版权所有|copyright)/i.test(block.text));
    if (!block.card_eligible || !block.text || block.metadata?.table_header || repeatedBoilerplate || ['header', 'footer', 'page', 'signature', 'quote', 'email_thread'].includes(block.kind) || block.metadata?.noise) { coverage[block.block_id] = { status: block.metadata?.table_header ? 'context' : 'dropped', reason: block.metadata?.table_header ? '表头作为行上下文' : repeatedBoilerplate ? '重复页边栏或受控文件样板' : ['quote', 'email_thread'].includes(block.kind) ? 'quoted_history' : block.kind === 'signature' ? 'signature' : '结构噪声、非当前消息或空内容' }; continue; }
    if (block.kind === 'heading') { pending = { heading: block.text, hierarchy: [...block.hierarchy, block.text], node }; coverage[block.block_id] = { status: 'context', reason: '标题作为继承上下文' }; continue; }
    const headingPath = uniq([...(block.hierarchy || []), pending?.heading]);
    const parts = clauses(translation.get(block.block_id) || block.text);
    let last = null;
    const continuedTarget = node && continuation.get(node.node_id);
    if (continuedTarget) last = eventByNode.get(continuedTarget) || null;
    for (const part of parts) {
      if (last && isDependent(part)) {
        last.predicate += ` ${part}`; last.conditions = uniq([...last.conditions, ...conditions(part)]);
        last.exceptions = uniq([...last.exceptions, ...exceptions(part)]); last.parameters = uniq([...last.parameters, ...parameters(part)]);
        last.evidence_ids = uniq([...last.evidence_ids, block.block_id]);
        continue;
      }
      const type = inferType(part, block);
      const subject = type === 'procedure' && (block.metadata?.list_id || block.metadata?.list?.num_id)
        ? clean(headingPath.at(-1), 120) || subjectFor(part, headingPath) : subjectFor(part, headingPath);
      const uncertainty = [];
      if (!subject) uncertainty.push('无法从对象、主题或结构上下文确定检索主题');
      const identity = [type, subject, part, headingPath, block.metadata?.scope_id || '', block.metadata?.parent_clause_id || ''];
      const event = validateKnowledgeEvent({
        schema_version: `${CONTRACT_VERSION}/knowledge-event`, event_id: `evt-${hash(identity).slice(0, 24)}`,
        semantic_type: subject ? type : 'unknown', subject: subject || '待确认主题', predicate: part, actor: actor(part), object: subject,
        modality: modality(part), conditions: conditions(part), exceptions: exceptions(part), parameters: parameters(part),
        temporal_scope: clean(block.metadata?.temporal_scope, 160), applicability_scope: clean(block.metadata?.scope_id, 160),
        source_context: { heading_path: headingPath, structure_node_id: node?.node_id || '', parent_node_id: node?.parent_id || '', parent_clause_id: clean(block.metadata?.parent_clause_id, 160), parent_clause_text: clean(blocksById.get(block.metadata?.parent_clause_id)?.text, 500), list_id: clean(block.metadata?.list_id || block.metadata?.list?.num_id, 160), sequence: Number(block.metadata?.sequence) || 0, table_headers: uniq(block.metadata?.table_headers || node?.fields?.header_paths), unit: clean(block.metadata?.unit || node?.fields?.units?.[0], 40) },
        evidence_ids: uniq(block.metadata?.source_block_ids?.length ? block.metadata.source_block_ids : [block.block_id]), confidence: type === 'unknown' ? 0.45 : 0.9,
        uncertainty: uniq([...uncertainty, ...(type === 'unknown' ? ['语义类型无法由显式结构或通用语言信号确定'] : [])])
      });
      events.push(event); last = event; if (node) eventByNode.set(node.node_id, event);
    }
    coverage[block.block_id] = { status: 'covered', event_ids: events.filter((e) => e.evidence_ids.includes(block.block_id)).map((e) => e.event_id) };
  }
  for (const block of document.blocks) if (!coverage[block.block_id]) {
    const eventIds = events.filter((event) => event.evidence_ids.includes(block.block_id)).map((event) => event.event_id);
    coverage[block.block_id] = eventIds.length ? { status: 'covered', event_ids: eventIds } : { status: 'context', reason: '结构上下文' };
  }
  return { events, coverage };
}
function displayTitleFor(event) {
  const intent = { requirement: '要求', guideline: '建议', procedure: '流程', method: '方法', parameter: '参数', acceptance: '验收检查', risk: '风险应对', decision: '决策', action: '行动项', commitment: '承诺', commercial_term: '商务条款', schedule: '时间要求', term_definition: '定义', checklist_item: '检查项', reference: '引用依据', entity_profile: '实体信息', lesson: '经验', observation: '观察', unknown: '待确认知识' }[event.semantic_type] || '概览';
  const rawSubject = stripListMarker(event.subject);
  const sentenceLike = rawSubject.length > 36 || /^(?:如果|若|当|在.+(?:时|情况下)|除非)/.test(rawSubject)
    || /[，,；;。！？!?]/.test(rawSubject);
  const subject = sentenceLike
    ? clean(event.source_context?.heading_path?.at(-1), 48) || clean(rawSubject.split(/[，,；;。]/)[0], 32)
    : rawSubject;
  return clean(`${subject || '相关内容'}${intent}`, 80).replace(/[：:]|(?:要求){2,}$/g, '要求');
}
function searchTitleFor(event) {
  const predicate = stripListMarker(event.predicate).replace(/[。；;]+$/g, '');
  const subject = stripListMarker(event.subject);
  const complete = predicate.includes(subject) ? predicate : `${subject}：${predicate}`;
  return clean(complete.length <= 160 ? complete : `${displayTitleFor(event)}：${predicate.slice(0, 100)}`, 160);
}
function bodyFor(event) {
  const lead = { requirement: '要求', guideline: '建议', procedure: '步骤', method: '做法', parameter: '参数', acceptance: '验收标准', risk: '风险', decision: '决定', action: '行动', commitment: '承诺', commercial_term: '条款', schedule: '时间安排', term_definition: '定义', checklist_item: '检查项', lesson: '经验', unknown: '待确认内容' }[event.semantic_type] || '内容';
  const lines = [`${lead}：${stripListMarker(event.predicate)}`];
  if (event.source_context.parent_clause_text && !event.predicate.includes(event.source_context.parent_clause_text)) lines.push(`适用范围：${event.source_context.parent_clause_text}`);
  if (event.actor) lines.push(`执行主体：${event.actor}`);
  if (event.conditions.length) lines.push(`适用条件：${event.conditions.join('；')}`);
  if (event.exceptions.length) lines.push(`例外：${event.exceptions.join('；')}`);
  if (event.parameters.length) lines.push(`关键参数：${event.parameters.join('；')}`);
  if (event.source_context.table_headers.length) lines.push(`表格语境：${event.source_context.table_headers.join(' / ')}${event.source_context.unit ? `（${event.source_context.unit}）` : ''}`);
  return lines.join('\n');
}
function planUsefulCards(events) {
  const semanticEvents = [];
  const bySemanticIdentity = new Map();
  for (const event of events) {
    const key = [event.semantic_type, normalizeSemanticText(event.subject), normalizeSemanticText(event.predicate)].join('|');
    const existing = bySemanticIdentity.get(key);
    if (existing) {
      existing.evidence_ids = uniq([...existing.evidence_ids, ...event.evidence_ids]);
      existing.conditions = uniq([...existing.conditions, ...event.conditions]);
      existing.exceptions = uniq([...existing.exceptions, ...event.exceptions]);
      existing.parameters = uniq([...existing.parameters, ...event.parameters]);
      continue;
    }
    const copy = { ...event, evidence_ids: [...event.evidence_ids] };
    bySemanticIdentity.set(key, copy); semanticEvents.push(copy);
  }
  const ids = new Set(semanticEvents.map((e) => e.event_id));
  const groups = [];
  for (const event of semanticEvents) {
    const previous = groups.at(-1); const blockId = event.evidence_ids[0];
    const sameProcedure = previous && event.semantic_type === 'procedure'
      && previous[0].semantic_type === 'procedure' && event.source_context.list_id
      && previous[0].source_context.list_id === event.source_context.list_id
      && previous[0].source_context.heading_path.join('/') === event.source_context.heading_path.join('/');
    if (previous && previous[0].semantic_type === event.semantic_type
      && (previous[0].evidence_ids[0] === blockId || sameProcedure)
      && previous[0].subject === event.subject
      && previous.reduce((n, item) => n + item.predicate.length, 0) + event.predicate.length <= 8000) previous.push(event);
    else groups.push([event]);
  }
  return groups.map((group) => {
    const event = group[0];
    const related = semanticEvents.filter((other) => other.event_id !== event.event_id && (other.source_context.heading_path.join('/') === event.source_context.heading_path.join('/') || other.subject === event.subject)).map((e) => e.event_id);
    const evidenceIds = uniq(group.flatMap((item) => item.evidence_ids));
    return validateCardPlan({
      schema_version: `${CONTRACT_VERSION}/card-plan`, plan_id: `plan-${hash(group.map((item) => item.event_id)).slice(0, 24)}`,
      user_question: `关于“${event.subject}”，需要知道什么${event.semantic_type === 'term_definition' ? '定义' : '要求或做法'}？`,
      retrieval_intent: `${event.subject}/${event.semantic_type}`, title: displayTitleFor(event), search_title: searchTitleFor(event), aliases: definitionAliases(event).filter((item) => ![displayTitleFor(event), searchTitleFor(event)].includes(item)),
      keywords: uniq([event.subject, ...definitionAliases(event), ...group.flatMap((item) => item.parameters), ...event.source_context.table_headers]),
      card_type: CARD_TYPE[event.semantic_type] || event.semantic_type, included_event_ids: group.map((item) => item.event_id),
      necessary_inherited_context: { heading_path: event.source_context.heading_path, table_headers: event.source_context.table_headers, unit: event.source_context.unit },
      related_but_not_merged_event_ids: related.filter((id) => !group.some((item) => item.event_id === id)), evidence_ids: evidenceIds,
      body: dedupeSemanticTexts(group.flatMap((item) => bodyFor(item).split('\n'))).join('\n'),
      decision: group.length > 1 || event.conditions.length || event.exceptions.length || event.evidence_ids.length > 1
        ? { mode: 'combine_dependent', reasons: [group.length > 1 && event.semantic_type === 'procedure' ? '同一主题和列表中的有序步骤构成一个完整过程' : group.length > 1 ? '同一来源块内相邻且语义类型一致的从属条款' : '条件、例外或跨块续文依赖治理事件'], differing_fields: [] }
        : { mode: 'split_independent', reasons: ['每个事件回答一个可独立检索的问题'], differing_fields: [] }
    }, ids);
  });
}
function generateUsefulCards(document, regions, options = {}) {
  const extracted = extractKnowledgeEvents(document, regions);
  const plans = planUsefulCards(extracted.events);
  const inherited = plans.reduce((n, p) => n + JSON.stringify(p.necessary_inherited_context).length, 0);
  const graph = document.structure || { nodes: [], edges: [] };
  const count = (items, key) => items.reduce((out, item) => { const value = item[key] || 'unknown'; out[value] = (out[value] || 0) + 1; return out; }, {});
  const inferred = graph.edges.filter((e) => e.origin === 'inferred').map((e) => e.confidence);
  return { ...extracted, plans, diagnostics: {
    events_detected: extracted.events.length, cards_planned: plans.length,
    events_per_card: plans.map((p) => p.included_event_ids.length), independent_siblings_merged: 0,
    orphan_conditions: 0, inherited_context_characters: inherited, title_body_scope_mismatch: 0,
    unknown_types: extracted.events.filter((e) => e.semantic_type === 'unknown').length,
    planner_split_reasons: { independent_retrieval_intent: plans.filter((p) => p.decision.mode === 'split_independent').length },
    planner_combine_reasons: { dependent_context: plans.filter((p) => p.decision.mode === 'combine_dependent').length },
    model_batches: Number(options.model_batches) || 0, semantic_boundaries_depend_on_batch_size: false,
    strong_boundary_violations: 0, sibling_merges: 0, page_only_merge_attempts: 0,
    orphan_list_items: graph.nodes.filter((n) => n.kind === 'list_item' && !n.parent_id).length,
    unresolved_table_headers: graph.nodes.filter((n) => n.kind === 'table_row' && !n.fields?.header_paths?.length).length,
    ambiguous_continuations: graph.edges.filter((e) => e.kind === 'continuation_of' && e.confidence < 0.8).length,
    inherited_context: plans.map((p) => ({ plan_id: p.plan_id, reasons: ['nearest_heading', ...(p.necessary_inherited_context.table_headers.length ? ['table_header'] : [])], characters: JSON.stringify(p.necessary_inherited_context).length })),
    email_dispositions: { current: graph.nodes.filter((n) => n.kind === 'email_message').length, quoted: graph.nodes.filter((n) => n.kind === 'quote').length, signature: graph.nodes.filter((n) => n.kind === 'signature').length },
    structure: { version: graph.schema_version, adapter: graph.adapter, nodes_by_kind: count(graph.nodes, 'kind'), nodes_by_origin: count(graph.nodes, 'origin'), edges_by_kind: count(graph.edges, 'kind'), edges_by_origin: count(graph.edges, 'origin'), inferred_confidence: { count: inferred.length, low: inferred.filter((x) => x < 0.6).length, medium: inferred.filter((x) => x >= 0.6 && x < 0.8).length, high: inferred.filter((x) => x >= 0.8).length } }
  }};
}

module.exports = { extractKnowledgeEvents, planUsefulCards, generateUsefulCards, inferType, clauses, SEMANTIC_KIND };
