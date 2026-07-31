'use strict';

/**
 * Format-independent semantic pipeline.
 * Adapters end at canonical blocks. Everything below operates only on their
 * content, order, provenance and structural hints.
 */
const crypto = require('crypto');

const PIPELINE_VERSION = '3.0';
const SEMANTIC_KINDS = Object.freeze([
  'fact', 'requirement', 'decision', 'action', 'process', 'method', 'parameter',
  'risk', 'issue', 'experience', 'commercial_term', 'schedule', 'entity_profile',
  'correspondence'
]);
const REGION_KINDS = Object.freeze([...SEMANTIC_KINDS, 'evidence_only', 'noise']);
const ACTIVE_STATES = new Set(['lead', 'approved', 'bidding', 'submitted', 'evaluating', 'won', 'contracted', 'active']);
const HISTORICAL_STATES = new Set(['lost', 'paused', 'terminated', 'archived', 'completed', 'cancelled', 'suspended']);
const BLOCK_KINDS = new Set([
  'heading', 'paragraph', 'list', 'list_item', 'table', 'table_row', 'key_value',
  'figure', 'caption', 'header', 'footer', 'email_envelope', 'email_body',
  'email_thread', 'sheet', 'page', 'attachment', 'text'
]);
const TAG_SYNONYMS = Object.freeze({
  '质量管理': '质量', '品质': '质量', '安全管理': '安全', '工期': '时间',
  '进度': '时间', '造价': '成本', '报价': '成本', '供应商': '供应链',
  '分包商': '供应链', '施工工艺': '工艺', '技术方法': '工艺',
  '合同条款': '合同', '规范': '标准', '标准规范': '标准'
});
const KIND_TAG = Object.freeze({
  fact: '事实', requirement: '要求', decision: '决策', action: '行动',
  process: '流程', method: '方法', parameter: '参数', risk: '风险',
  issue: '问题', experience: '经验', commercial_term: '商务条款',
  schedule: '计划', entity_profile: '实体', correspondence: '往来'
});
const BUSINESS_CATEGORY = Object.freeze({
  requirement: 'standards_specifications', method: 'technical_methods_workmanship',
  process: 'company_systems_processes', risk: 'risks_issues', issue: 'risks_issues',
  experience: 'failures_terminated_lessons', commercial_term: 'contracts_legal',
  schedule: 'construction_organization_schedules', entity_profile: 'customers',
  correspondence: 'correspondence_important_decisions', parameter: 'materials_equipment',
  fact: 'terminology_general_knowledge', decision: 'correspondence_important_decisions',
  action: 'company_systems_processes'
});
const ACTIVE_CATEGORY = Object.freeze({
  requirement: 'tender_documents_interpretation', method: 'technical_solution',
  process: 'bid_strategy_responsibilities', risk: 'risk_deviation_compliance',
  issue: 'risk_deviation_compliance', experience: 'review_knowledge_candidates',
  commercial_term: 'commercial_quotation_cost', schedule: 'construction_organization_schedule',
  entity_profile: 'opportunity_customer', correspondence: 'project_correspondence',
  parameter: 'procurement_subcontracting', fact: 'project_overview',
  decision: 'internal_review_decision', action: 'meeting_minutes_decisions'
});

const clean = (value, max = 8000) => typeof value === 'string'
  ? value.normalize('NFKC').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, max) : '';
const stableJson = (value) => {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort()
    .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
};
const digest = (value) => crypto.createHash('sha256').update(typeof value === 'string' ? value : stableJson(value)).digest('hex');
const uniq = (items) => [...new Set((items || []).filter((item) => item !== undefined && item !== null)
  .map((item) => clean(String(item), 160)).filter(Boolean))];
const score = (text, patterns) => patterns.reduce((total, pattern) => total + (pattern.test(text) ? 1 : 0), 0);

function normalizeLocator(raw, fallback) {
  const locator = raw && typeof raw === 'object' ? raw : {};
  const result = {};
  for (const key of ['scheme', 'value', 'page', 'sheet', 'range', 'row', 'column', 'message_id', 'attachment_id', 'heading_path']) {
    if (locator[key] !== undefined && locator[key] !== null && String(locator[key]).trim()) result[key] = locator[key];
  }
  if (!result.scheme) result.scheme = 'block';
  if (!result.value) result.value = fallback;
  return result;
}

function canonicalizeDocument(input = {}) {
  const source = input.document || input;
  const rawBlocks = Array.isArray(source.blocks) ? source.blocks
    : Array.isArray(source.normalized_blocks) ? source.normalized_blocks
      : clean(source.text || source.markdown) ? [{ kind: 'text', raw: { text: source.text || source.markdown } }] : [];
  const blocks = rawBlocks.map((raw, order) => {
    const rawText = clean(raw?.raw?.text || raw?.text || raw?.content || raw?.markdown, 30000);
    const kind = BLOCK_KINDS.has(clean(raw?.kind, 80)) ? clean(raw.kind, 80) : 'text';
    const metadata = raw?.metadata && typeof raw.metadata === 'object' ? { ...raw.metadata } : {};
    const hierarchy = uniq([
      ...(Array.isArray(raw?.hierarchy) ? raw.hierarchy : []),
      ...(Array.isArray(raw?.inferred?.heading_path) ? raw.inferred.heading_path : []),
      clean(raw?.inferred?.heading, 300)
    ]);
    const blockId = clean(raw?.block_id, 160) || `blk-${digest([source.source_document_id || source.source_hash || 'source', order, rawText]).slice(0, 20)}`;
    return {
      block_id: blockId, order, kind, text: rawText,
      hierarchy, locator: normalizeLocator(raw?.locator, blockId),
      parse_status: clean(raw?.parse?.status, 40) || (rawText ? 'present' : 'missing'),
      metadata, provenance: Array.isArray(raw?.provenance) ? raw.provenance : []
    };
  }).filter((block) => block.text || ['figure', 'attachment', 'page', 'sheet'].includes(block.kind));
  const sourceId = clean(source.source_document_id || source.source_identity, 300)
    || `src-${digest([source.source_hash, source.source_path, blocks.map((block) => block.text)]).slice(0, 24)}`;
  return {
    schema_version: 'canonical-document/1.0', pipeline_version: PIPELINE_VERSION,
    source_document_id: sourceId, source_identity: clean(source.source_identity, 300) || sourceId,
    source_hash: clean(source.source_hash, 128), source_path: clean(source.source_path, 1000),
    title: clean(source.title || source.filename, 400) || '未命名资料',
    media_type: clean(source.media_type || source.source_type, 120) || 'unknown',
    metadata: source.metadata && typeof source.metadata === 'object' ? { ...source.metadata } : {},
    blocks, fingerprint: digest(blocks.map(({ kind, text, hierarchy }) => ({ kind, text, hierarchy })))
  };
}

function semanticSignals(text) {
  const patterns = {
    requirement: [/必须|应当|不得|须|shall|must|required/i],
    decision: [/决定|决议|批准|同意|确定|adopted|approved/i],
    action: [/责任人|负责人|待办|完成日期|行动项|follow[- ]?up|action/i],
    process: [/流程|程序|步骤|审批|process|procedure/i],
    method: [/方法|工艺|做法|施工方案|method|technique/i],
    parameter: [/\d+(?:\.\d+)?\s*(?:mm|cm|m|kg|t|mpa|%|元|万元|天|日|小时)\b/i, /型号|规格|参数|阈值|允许偏差/i],
    risk: [/风险|隐患|可能导致|应急|risk|hazard/i],
    issue: [/问题|缺陷|争议|未解决|issue|defect/i],
    experience: [/经验|教训|复盘|建议|lesson|retrospective/i],
    commercial_term: [/报价|付款|合同价|税率|保函|索赔|违约|payment|price|contract/i],
    schedule: [/进度|工期|里程碑|开工|完工|计划日期|schedule|milestone/i],
    entity_profile: [/客户|业主|供应商|分包商|公司|联系人|client|supplier/i],
    correspondence: [/发件人|收件人|主题|抄送|函|回复|from:|to:|subject:/i]
  };
  return Object.fromEntries(Object.entries(patterns).map(([key, values]) => [key, score(text, values)]));
}

function inferProfile(document) {
  const text = document.blocks.map((block) => block.text).join('\n').slice(0, 100000);
  const signals = semanticSignals(text);
  const purposes = Object.entries(signals).filter(([, value]) => value > 0)
    .sort((a, b) => b[1] - a[1]).slice(0, 6).map(([key]) => key);
  const domains = [];
  for (const [tag, pattern] of [
    ['质量', /质量|验收|quality/i], ['安全', /安全|事故|safety/i],
    ['成本', /报价|成本|造价|price|cost/i], ['时间', /进度|工期|schedule/i],
    ['合同', /合同|索赔|contract/i], ['采购', /采购|供应商|procurement|supplier/i],
    ['技术', /技术|施工|设计|工艺|technical|design/i]
  ]) if (pattern.test(text)) domains.push(tag);
  const metadata = document.metadata || {};
  const lifecycle = clean(metadata.project_state || metadata.lifecycle || metadata.status, 80)
    || (/(已完成|竣工|归档|终止|取消|completed|archived|cancelled)/i.test(text) ? 'completed'
      : /(投标|询价|澄清|报价|施工中|bidding|tender|active)/i.test(text) ? 'active' : 'unknown');
  const authority = /(签发|批准|合同|法定|正式|approved|executed)/i.test(text) ? 'formal'
    : /(会议纪要|确认|confirmed)/i.test(text) ? 'confirmed' : 'informational';
  const confidentiality = /(机密|保密|内部使用|confidential)/i.test(text) ? 'restricted' : 'normal';
  const projectIds = uniq([metadata.project_id, metadata.project_name, metadata.project_reference]);
  return {
    schema_version: 'semantic-profile/1.0', purposes: purposes.length ? purposes : ['fact'],
    business_domains: domains, lifecycle, project_scope: projectIds,
    entity_scope: uniq([metadata.entity_id, metadata.client, metadata.supplier]),
    temporal_validity: clean(metadata.valid_until || metadata.effective_date || metadata.version, 160),
    authority, confidentiality,
    dominant_patterns: purposes.slice(0, 3),
    structural_confidence: document.blocks.some((block) => block.hierarchy.length || block.kind === 'heading' || block.kind === 'table') ? 0.9 : 0.65,
    confidence: { purpose: purposes.length ? 0.82 : 0.55, lifecycle: lifecycle === 'unknown' ? 0.45 : 0.85, authority: 0.75 },
    uncertainty: lifecycle === 'unknown' ? ['项目生命周期未从显式元数据或正文确定'] : []
  };
}

function noiseReason(block, occurrence) {
  if (!block.text) return '空内容';
  if (block.metadata.noise === true || block.metadata.structural_noise === true) return '适配器标记为结构噪声';
  if (/^(第\s*\d+\s*页|page\s+\d+|目录|table of contents)$/i.test(block.text)) return '页码或目录';
  if (block.kind === 'footer' || block.kind === 'header') {
    if (occurrence > 1) return '重复页眉页脚';
  }
  if (/^(签字|签名|signature|免责声明|disclaimer)\s*[:：]?$/i.test(block.text)) return '无义务内容的签名或声明';
  return '';
}

function dominantKind(text) {
  const signals = semanticSignals(text);
  const ranked = Object.entries(signals).sort((a, b) => b[1] - a[1]);
  return ranked[0]?.[1] > 0 ? ranked[0][0] : 'fact';
}

function segmentDocument(document) {
  const occurrences = new Map();
  for (const block of document.blocks) occurrences.set(block.text, (occurrences.get(block.text) || 0) + 1);
  const regions = [];
  let current = null;
  const flush = () => {
    if (!current) return;
    current.text = current.blocks.map((block) => block.text).filter(Boolean).join('\n');
    current.region_id = `reg-${digest([document.source_document_id, current.blocks.map((block) => block.block_id), current.semantic_kind]).slice(0, 24)}`;
    current.fingerprint = digest([current.semantic_kind, current.subject, current.text]);
    regions.push(current); current = null;
  };
  for (const block of document.blocks) {
    const reason = noiseReason(block, occurrences.get(block.text));
    const kind = reason ? 'noise' : dominantKind(block.text);
    const heading = block.kind === 'heading' || block.hierarchy.length
      ? clean(block.text || block.hierarchy.at(-1), 300) : '';
    const subject = heading || clean(block.hierarchy.at(-1), 300) || clean(block.text.split(/[。；;\n]/)[0], 160);
    const boundary = !current || kind === 'noise' || current.semantic_kind === 'noise'
      || heading || kind !== current.semantic_kind
      || (block.metadata.scope_id && block.metadata.scope_id !== current.scope_id)
      || (block.metadata.temporal_scope && block.metadata.temporal_scope !== current.temporal_scope)
      || current.blocks.length >= 8;
    if (boundary) {
      flush();
      current = {
        semantic_kind: REGION_KINDS.includes(kind) ? kind : 'fact', subject,
        scope_id: clean(block.metadata.scope_id, 160), temporal_scope: clean(block.metadata.temporal_scope, 160),
        parent_region_id: null, child_region_ids: [], cross_references: [],
        blocks: [], dropped_reason: reason || ''
      };
    }
    current.blocks.push(block);
  }
  flush();
  const stack = [];
  for (const region of regions) {
    const level = Math.max(0, region.blocks[0]?.hierarchy?.length || 0);
    while (stack.length > level) stack.pop();
    if (stack.length) {
      region.parent_region_id = stack.at(-1).region_id;
      stack.at(-1).child_region_ids.push(region.region_id);
    }
    stack[level] = region;
    stack.length = level + 1;
  }
  return regions;
}

function extractFacts(text) {
  const numbers = [...text.matchAll(/-?\d+(?:\.\d+)?\s*(?:mm|cm|m|kg|t|mpa|%|元|万元|天|日|小时)?/gi)]
    .map((match) => match[0]).slice(0, 20);
  const dates = [...text.matchAll(/\b(?:20\d{2}[-/.年]\d{1,2}(?:[-/.月]\d{1,2}日?)?|\d{1,2}月\d{1,2}日)\b/g)]
    .map((match) => match[0]).slice(0, 10);
  const models = [...text.matchAll(/\b[A-Z]{1,5}[-_/]?\d{2,}[A-Z0-9-]*\b/g)].map((match) => match[0]).slice(0, 10);
  return { numbers: uniq(numbers), dates: uniq(dates), models: uniq(models) };
}

function routeUnit(unit, profile, options = {}) {
  const state = clean(profile.lifecycle || unit.status, 80).toLowerCase();
  const projectSpecific = unit.project_ids.length > 0 || unit.scope === 'project';
  const reusable = unit.reusable === true;
  let library = 'business';
  let ambiguous = false;
  if (HISTORICAL_STATES.has(state)) library = 'business';
  else if (projectSpecific && ACTIVE_STATES.has(state)) library = reusable ? 'business' : 'active_tender';
  else if (projectSpecific && state === 'unknown') ambiguous = true;
  else if (projectSpecific) library = 'active_tender';
  if (options.explicit_library === 'active_tender' || options.explicit_library === 'business') {
    library = options.explicit_library; ambiguous = false;
  }
  return {
    library, category: library === 'active_tender' ? ACTIVE_CATEGORY[unit.semantic_kind] : BUSINESS_CATEGORY[unit.semantic_kind],
    confidence: ambiguous ? 0.45 : 0.9, ambiguous,
    reason: ambiguous ? '存在项目范围，但未确定项目是否仍在进行' : library === 'active_tender'
      ? '在办项目事实或行动按知识单元进入在办库' : '可复用知识或历史项目材料进入业务库'
  };
}

function normalizeTags(candidates, existing = [], limit = 10) {
  const existingMap = new Map(existing.map((tag) => [clean(tag, 80).toLocaleLowerCase(), clean(tag, 80)]));
  const output = [];
  for (const raw of candidates.flatMap((value) => String(value || '').split(/[,，/]/))) {
    let tag = clean(raw, 40).replace(/^#+/, '');
    tag = TAG_SYNONYMS[tag] || tag;
    if (!tag || tag.length > 20 || /[\n[\]{}]/.test(tag)) continue;
    tag = existingMap.get(tag.toLocaleLowerCase()) || tag;
    if (!output.includes(tag)) output.push(tag);
    if (output.length >= limit) break;
  }
  return output;
}

function normalizeKnowledgeUnit(raw, context = {}) {
  const evidence = Array.isArray(raw.evidence) ? raw.evidence : raw.evidence ? [raw.evidence] : [];
  const kind = SEMANTIC_KINDS.includes(raw.semantic_kind) ? raw.semantic_kind
    : ({ commitment: 'requirement', quotation: 'commercial_term', material: 'parameter',
      acceptance_criterion: 'requirement', clarification: 'correspondence',
      contract_obligation: 'commercial_term', project_lesson: 'experience' }[raw.item_type] || 'fact');
  const statement = clean(raw.statement || raw.summary || raw.content || raw.title, 8000);
  const sourceId = clean(raw.source_document_id || context.source_document_id, 300);
  const projectIds = uniq(raw.project_ids || (raw.project_id ? [raw.project_id] : context.project_ids || []));
  const fingerprint = digest({ kind, statement: statement.toLocaleLowerCase().replace(/\s+/g, ''), projectIds,
    evidence: evidence.map((item) => [item.block_id, item.locator]) });
  return {
    schema_version: 'knowledge-unit/1.0', unit_id: clean(raw.unit_id || raw.candidate_id || raw.card_id, 300) || `ku-${fingerprint.slice(0, 24)}`,
    fingerprint, title: clean(raw.title, 180) || clean(statement.split(/[。；;\n]/)[0], 120) || '知识单元',
    statement, semantic_kind: kind, subject: clean(raw.subject, 300) || clean(raw.title, 300),
    scope: clean(raw.scope, 120) || (projectIds.length ? 'project' : 'general'),
    applicable_conditions: uniq(raw.applicable_conditions || raw.conditions),
    exceptions: uniq(raw.exceptions), project_ids: projectIds, entity_ids: uniq(raw.entity_ids),
    time: clean(raw.time || raw.effective_date, 160), version: clean(raw.version, 100),
    status: clean(raw.status || context.lifecycle, 80), authority: clean(raw.authority || context.authority, 80),
    responsibilities: uniq(raw.responsibilities), parties: uniq(raw.parties),
    structured_facts: raw.structured_facts || extractFacts(statement), evidence,
    reusable: raw.reusable === true || raw.reusable_knowledge_candidate === true,
    confidence: raw.confidence && typeof raw.confidence === 'object' ? raw.confidence
      : { semantics: Number(raw.confidence) || 0.8, evidence: evidence.length ? 0.95 : 0.3, route: 0.8 },
    uncertainty: uniq(raw.uncertainty), tags: uniq(raw.tags), relations: Array.isArray(raw.relations) ? raw.relations : [],
    source_document_id: sourceId, source_region_ids: uniq(raw.source_region_ids)
  };
}

function planKnowledgeUnits(document, profile, regions, options = {}) {
  const units = [];
  const coverage = {};
  for (const region of regions) {
    if (region.semantic_kind === 'noise') {
      coverage[region.region_id] = { status: 'dropped', reason: region.dropped_reason || '非可复用噪声' };
      continue;
    }
    const evidence = region.blocks.filter((block) => block.text).map((block) => ({
      block_id: block.block_id, locator: block.locator, verbatim: block.text,
      provenance: [block.locator, ...block.provenance]
    }));
    if (!evidence.length) {
      coverage[region.region_id] = { status: 'dropped', reason: '没有可核验原文' };
      continue;
    }
    const projectIds = uniq([
      ...profile.project_scope,
      ...region.blocks.flatMap((block) => [block.metadata.project_id, block.metadata.project_name])
    ]);
    const raw = {
      semantic_kind: region.semantic_kind, title: region.subject, subject: region.subject,
      statement: region.text, evidence, project_ids: projectIds,
      source_document_id: document.source_document_id, source_region_ids: [region.region_id],
      scope: projectIds.length ? 'project' : 'general', status: profile.lifecycle,
      authority: profile.authority,
      reusable: ['method', 'process', 'experience', 'requirement'].includes(region.semantic_kind)
        && !/(本项目|本工程|this\s+project)/i.test(region.text)
    };
    const unit = normalizeKnowledgeUnit(raw, profile);
    const previous = units.at(-1);
    if (previous && previous.semantic_kind === unit.semantic_kind && previous.subject === unit.subject
      && previous.scope === unit.scope && previous.status === unit.status
      && previous.statement.length + unit.statement.length < 10000) {
      previous.statement += `\n${unit.statement}`;
      previous.evidence.push(...unit.evidence);
      previous.source_region_ids.push(region.region_id);
      previous.structured_facts = extractFacts(previous.statement);
      previous.fingerprint = digest([previous.semantic_kind, previous.statement, previous.project_ids]);
      coverage[region.region_id] = { status: 'merged', unit_id: previous.unit_id, reason: '相邻且主题、范围、责任和语义类型兼容' };
    } else {
      units.push(unit);
      coverage[region.region_id] = { status: 'covered', unit_id: unit.unit_id };
    }
  }
  const deduped = [];
  for (const unit of units) {
    const duplicate = deduped.find((item) => item.fingerprint === unit.fingerprint);
    if (duplicate) {
      duplicate.evidence.push(...unit.evidence);
      duplicate.source_region_ids.push(...unit.source_region_ids);
      for (const regionId of unit.source_region_ids) coverage[regionId] = { status: 'merged', unit_id: duplicate.unit_id, reason: '确定性指纹重复' };
    } else deduped.push(unit);
  }
  for (const unit of deduped) {
    unit.route = routeUnit(unit, profile, { explicit_library: options.explicit_library });
    unit.tags = normalizeTags([
      KIND_TAG[unit.semantic_kind], ...profile.business_domains, ...unit.project_ids,
      unit.route.library === 'active_tender' ? '在办' : '业务知识',
      ...unit.tags
    ], options.existing_tags || []);
    unit.confidence.route = unit.route.confidence;
  }
  return { units: deduped, coverage };
}

function repairCoverage(document, profile, regions, planned, options = {}) {
  const missing = regions.filter((region) => !planned.coverage[region.region_id]
    || !['covered', 'merged', 'dropped'].includes(planned.coverage[region.region_id].status));
  if (!missing.length) return { ...planned, repaired_region_ids: [] };
  const repair = planKnowledgeUnits(document, profile, missing, options);
  return {
    units: [...planned.units, ...repair.units],
    coverage: { ...planned.coverage, ...repair.coverage },
    repaired_region_ids: missing.map((region) => region.region_id)
  };
}

function relationEvidence(units) {
  const identity = new Map();
  for (const unit of units) {
    for (const id of [...unit.project_ids, ...unit.entity_ids]) {
      if (!identity.has(id)) identity.set(id, []);
      identity.get(id).push(unit);
    }
  }
  const relations = [];
  for (const [sharedIdentity, matches] of identity) {
    for (let i = 0; i < matches.length; i += 1) for (let j = i + 1; j < matches.length; j += 1) {
      if (matches[i].unit_id === matches[j].unit_id) continue;
      relations.push({
        from_unit_id: matches[i].unit_id, to_unit_id: matches[j].unit_id, type: 'related',
        confidence: 1, evidence: { kind: 'shared_explicit_identity', value: sharedIdentity }
      });
    }
  }
  return relations;
}

function groupedReview(units) {
  const byCause = new Map();
  for (const unit of units) {
    const causes = [];
    if (unit.route.ambiguous) causes.push('ambiguous_library_route');
    if (unit.uncertainty.includes('material_conflict')) causes.push('material_conflict');
    for (const cause of causes) {
      if (!byCause.has(cause)) byCause.set(cause, []);
      byCause.get(cause).push(unit.unit_id);
    }
  }
  return [...byCause].map(([cause, unitIds]) => ({
    review_id: `review-${digest([units[0]?.source_document_id, cause]).slice(0, 20)}`,
    cause, unit_ids: unitIds,
    reason: cause === 'ambiguous_library_route' ? '资料涉及项目，但无法确认项目当前是否在办。'
      : '同一关键事项出现实质冲突，需要确认采用哪一项。',
    action: cause === 'ambiguous_library_route' ? '请选择整份资料的在办库或业务库归属。' : '查看原文差异并选择有效内容。'
  }));
}

function runUniversalPipeline(input = {}) {
  const document = canonicalizeDocument(input.document || input);
  const profile = inferProfile(document);
  const regions = segmentDocument(document);
  let planned = planKnowledgeUnits(document, profile, regions, input);
  planned = repairCoverage(document, profile, regions, planned, input);
  const relations = relationEvidence(planned.units);
  for (const relation of relations) {
    const source = planned.units.find((unit) => unit.unit_id === relation.from_unit_id);
    if (source) source.relations.push(relation);
  }
  const meaningful = regions.filter((region) => region.semantic_kind !== 'noise').length;
  const covered = Object.values(planned.coverage).filter((entry) => ['covered', 'merged'].includes(entry.status)).length;
  const telemetry = {
    parse_blocks: document.blocks.length, semantic_regions: regions.length,
    planned_units: planned.units.length, semantic_coverage: meaningful ? covered / meaningful : 1,
    compression_ratio: meaningful ? planned.units.length / meaningful : 0,
    llm_calls: 0, llm_tokens: 0, cache_hits: Number(input.cache_hits) || 0,
    accepted: planned.units.length - groupedReview(planned.units).flatMap((group) => group.unit_ids).length,
    review: groupedReview(planned.units).length, rejected: regions.filter((region) => region.semantic_kind === 'noise').length,
    relations: relations.length, writes: 0
  };
  return {
    schema_version: 'universal-pipeline/1.0', pipeline_version: PIPELINE_VERSION,
    document, profile, regions, knowledge_units: planned.units, coverage: planned.coverage,
    repaired_region_ids: planned.repaired_region_ids, relations,
    review_decisions: groupedReview(planned.units), telemetry,
    cache_key: digest([document.fingerprint, PIPELINE_VERSION, input.prompt_version || 'local-v1', input.model_version || 'none'])
  };
}

module.exports = {
  PIPELINE_VERSION, SEMANTIC_KINDS, REGION_KINDS, TAG_SYNONYMS,
  canonicalizeDocument, inferProfile, segmentDocument, normalizeKnowledgeUnit,
  normalizeTags, routeUnit, planKnowledgeUnits, repairCoverage, relationEvidence,
  groupedReview, runUniversalPipeline, digest, stableJson
};
