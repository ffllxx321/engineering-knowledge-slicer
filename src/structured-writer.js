'use strict';

/**
 * Phase 2/3 controlled structured writer.
 * All planning is deterministic and local. Vault mutation is isolated in
 * commitPlan/rollbackTransaction and guarded by an injected adapter.
 */
const crypto = require('crypto');
const { normalizeSemanticText, semanticTextSignature, dedupeSemanticTexts, distinctSemanticTexts, cleanTitleBoundary } = require('./semantic-text.js');
const {
  ACTIVE_TENDER_CATEGORIES,
  BUSINESS_CATEGORIES,
  validateRecord,
  validateProjectTransition
} = require('./phase1-foundation.js');

const WRITER_VERSION = '1.0';
const INDEX_VERSION = '1.0';
const PLAN_LIMITS = Object.freeze({
  max_records: 250, max_actions: 600, max_links_per_record: 40,
  // Per-source ceilings are deliberately separate from the transaction knobs
  // above. They prevent pathological/corrupt inputs without making an ordinary
  // large document one enormous transaction.
  max_source_records: 10000, max_source_actions: 20000
});
const MODES = Object.freeze(['legacy', 'structured-pilot', 'structured-write']);
const KIND_PREFIX = Object.freeze({
  project: 'prj', source_document: 'src', business_item: 'bi', company_knowledge: 'ck'
});
const KIND_FOLDER = Object.freeze({
  project: '项目', source_document: '来源', business_item: '业务事项', company_knowledge: '公司知识'
});
const RELATION_TYPES = Object.freeze({
  derived_from: { from: ['business_item', 'company_knowledge'], to: ['source_document'] },
  belongs_to: { from: ['source_document', 'business_item'], to: ['project'] },
  contains: { from: ['project', 'source_document'], to: ['source_document', 'business_item'] },
  related: { from: ['project', 'source_document', 'business_item', 'company_knowledge'], to: ['project', 'source_document', 'business_item', 'company_knowledge'] },
  supersedes: { from: ['source_document', 'business_item', 'company_knowledge'], to: ['source_document', 'business_item', 'company_knowledge'] },
  replaces: { from: ['source_document', 'business_item', 'company_knowledge'], to: ['source_document', 'business_item', 'company_knowledge'] }
});

const clean = (value, max = 500) => typeof value === 'string'
  ? value.trim().replace(/[\u0000-\u001f\u007f]/g, '').slice(0, max) : '';
const stableJson = (value) => {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort()
    .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
};
const hash = (value) => crypto.createHash('sha256')
  .update(typeof value === 'string' ? value : stableJson(value)).digest('hex');
const stableId = (kind, identity) => `${KIND_PREFIX[kind]}-${hash(identity).slice(0, 24)}`;
const uniq = (values) => [...new Set((values || []).filter(Boolean))].sort();
const safeSegment = (value) => clean(value, 120).normalize('NFC')
  .replace(/[\\/:*?"<>|#[\]^]/g, '-').replace(/\.\./g, '-').replace(/\s+/g, ' ').replace(/^[. ]+|[. ]+$/g, '') || '未命名';
const pathSafe = (value) => {
  const raw = clean(value, 1000).replace(/\\/g, '/');
  if (!raw || raw.startsWith('/') || /^[A-Za-z]:\//.test(raw)) return false;
  const path = raw.replace(/\/+$/g, '');
  return Boolean(path && !path.split('/').some((part) => !part || part === '.' || part === '..')
    && !/[\u0000-\u001f\u007f:*?"<>|]/.test(path));
};
const joinPath = (...parts) => parts.map((part) => String(part || '').replace(/^\/+|\/+$/g, ''))
  .filter(Boolean).join('/');

function chinaTime(value) {
  const instant = new Date(String(value || ''));
  if (!Number.isFinite(instant.valueOf())) throw Object.assign(new Error('结构化写入时间无效；必须是可解析的 ISO 8601 instant'), { code: 'STRUCTURED_TIME_INVALID' });
  const shifted = new Date(instant.valueOf() + 8 * 60 * 60 * 1000);
  return `${shifted.toISOString().slice(0, -1)}+08:00`;
}

function normalizeSettings(settings = {}) {
  const mode = MODES.includes(settings.structuredWriterMode) ? settings.structuredWriterMode : 'legacy';
  const enabled = settings.controlledWriterEnabled === true;
  return {
    enabled,
    mode: enabled ? mode : 'legacy',
    activeRoot: clean(settings.knowledgeTenderRoot || '06-知识库/招投标库', 400),
    businessRoot: clean(settings.knowledgeBusinessRoot || '06-知识库/业务库', 400),
    stateRoot: clean(settings.artifactsPath || '06-知识库/源文件/_slicer_artifacts', 600),
    limits: {
      max_records: Math.max(1, Math.min(PLAN_LIMITS.max_records, Number(settings.structuredMaxRecords) || 100)),
      max_actions: Math.max(1, Math.min(PLAN_LIMITS.max_actions, Number(settings.structuredMaxActions) || 300)),
      max_links_per_record: Math.max(1, Math.min(PLAN_LIMITS.max_links_per_record, Number(settings.structuredMaxLinkFanout) || 20))
    }
  };
}

function sourceIdentity(document) {
  const explicit = clean(document.source_identity || document.source_document_id, 300);
  if (explicit) return `explicit:${explicit}`;
  const ingestion = clean(document.ingestion_id || document.metadata?.ingestion_id, 300);
  if (ingestion) return `ingestion:${ingestion}`;
  const immutable = clean(document.metadata?.message_id || document.metadata?.file_id, 500);
  if (immutable) return `provider:${immutable}`;
  const initialHash = clean(document.initial_source_hash || document.source_hash, 128);
  if (initialHash) return `initial-hash:${initialHash}`;
  throw new Error('来源缺少稳定身份；不能用可变标题或路径生成 ID');
}

function sourceFilename(document) {
  const fromPath = clean(document.source_path, 800).replace(/\\/g, '/').split('/').at(-1);
  return clean(fromPath || document.filename || document.title || '来源文档', 300);
}

function projectIdentity(entry) {
  const id = clean(entry?.project_id || entry?.registry_id, 300);
  if (!id) throw new Error('项目必须来自精确登记表且包含稳定 project_id');
  return `registry:${id}`;
}

function candidateIdentity(candidate, sourceId) {
  const evidence = candidate?.evidence || {};
  const locator = evidence.locator || {};
  const explicit = clean(candidate?.stable_item_key || candidate?.candidate_id, 300);
  return explicit
    ? `${sourceId}:candidate:${explicit}`
    : `${sourceId}:evidence:${clean(evidence.block_id || candidate?.block_id, 200)}:${stableJson(locator)}:${hash(clean(evidence.verbatim, 4000))}`;
}

function emptyIndex() {
  return { version: INDEX_VERSION, revision: 0, records: {}, source_versions: {}, updated_at: '' };
}

function validateIndex(raw) {
  const candidate = raw && typeof raw === 'object' ? raw : emptyIndex();
  const index = {
    version: candidate.version || INDEX_VERSION,
    revision: Number(candidate.revision || 0),
    records: {},
    source_versions: candidate.source_versions && typeof candidate.source_versions === 'object'
      ? JSON.parse(JSON.stringify(candidate.source_versions)) : {},
    updated_at: clean(candidate.updated_at, 100)
  };
  const conflicts = [];
  const discarded = [];
  const paths = new Map();
  for (const [id, entry] of Object.entries(candidate.records || {})) {
    if (!entry || !pathSafe(entry.path) || entry.record_id !== id) {
      discarded.push({ cause: 'malformed_index', record_id: id });
      continue;
    }
    index.records[id] = JSON.parse(JSON.stringify(entry));
    if (!paths.has(entry.path)) paths.set(entry.path, []);
    paths.get(entry.path).push(id);
  }
  for (const [path, ids] of paths) {
    if (ids.length > 1) conflicts.push({ cause: 'path_indexed_by_multiple_ids', path, record_ids: ids.sort() });
  }
  return { index, conflicts, discarded };
}

function yamlScalar(value) {
  return JSON.stringify(String(value ?? ''), null, 0);
}

function yamlArray(values) {
  return `[${uniq(values).map(yamlScalar).join(', ')}]`;
}

function relationLink(relation) {
  return `[[${relation.target_path}|${relation.target_title}]]`;
}

function humanLocator(locator = {}) {
  if (Array.isArray(locator.locators)) return combinedHumanLocators(locator.locators);
  return [
    locator.page !== undefined ? `第 ${locator.page} 页` : '',
    locator.sheet ? `工作表“${clean(String(locator.sheet), 120)}”` : '',
    locator.range ? `区域 ${clean(String(locator.range), 80)}` : '',
    locator.row !== undefined ? `第 ${locator.row} 行` : '',
    locator.message_id ? `邮件 ${clean(String(locator.message_id), 120)}` : '',
    locator.heading_path ? `章节 ${Array.isArray(locator.heading_path) ? locator.heading_path.join(' / ') : locator.heading_path}` : '',
    !locator.page && !locator.sheet && !locator.range && locator.value ? clean(String(locator.value), 160) : ''
  ].filter(Boolean).join('，') || '来源原文';
}

function combinedHumanLocators(locators = []) {
  const unique = [...new Map(locators.map((item) => [stableJson(item || {}), item || {}])).values()];
  const pages = [...new Set(unique.map((item) => Number(item.page)).filter(Number.isFinite))].sort((a, b) => a - b);
  const rest = unique.filter((item) => !Number.isFinite(Number(item.page))).map(humanLocator);
  return [...(pages.length ? [`第 ${pages.join('、')} 页`] : []), ...new Set(rest)].join('，') || '来源原文';
}

function mergeEvidence(items = []) {
  const groups = new Map();
  for (const item of items.filter(Boolean)) {
    const key = semanticTextSignature(item.verbatim || '');
    if (!normalizeSemanticText(item.verbatim) || !groups.has(key)) groups.set(key, { ...item,
      provenance: [...(item.provenance || [])], locators: [item.locator || {}, ...(item.locators || [])] });
    else {
      const target = groups.get(key);
      target.provenance.push(...(item.provenance || []));
      target.locators.push(item.locator || {}, ...(item.locators || []));
      for (const id of [item.block_id, ...(item.block_ids || [])].filter(Boolean)) {
        target.block_ids = uniq([...(target.block_ids || []), target.block_id, id]);
      }
    }
  }
  return [...groups.values()].map((item) => ({ ...item,
    provenance: [...new Map(item.provenance.map((value) => [stableJson(value), value])).values()],
    locators: [...new Map(item.locators.map((value) => [stableJson(value), value])).values()] }));
}

function searchKeywords(record) {
  return uniq([...(record.keywords || []), ...(record.tags || []), record.semantic_kind, record.category]);
}

function encodedLocator(locator) {
  return Buffer.from(stableJson(locator || {}), 'utf8').toString('base64url');
}

function displayEvidence(value) {
  return String(value ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim().slice(0, 12000)
    .replace(/\s*(?=(?:[（(]\d+[)）]|\d+[.、])\s*)/g, '\n')
    .replace(/\s*(?=(?:第[一二三四五六七八九十\d]+[章节条]|[一二三四五六七八九十]+、))/g, '\n')
    .replace(/\n{3,}/g, '\n\n').trim();
}

function readableSummary(value) {
  const formatted = clean(value, 12000).replace(/([。；;])(?=(?:要求|建议|步骤|做法|执行主体|适用条件|例外|关键参数|表格语境)[:：])/g, '$1\n');
  return formatted.split(/\n+/).map((line) => line.trim()).filter(Boolean)
    .map((line) => `- ${line.replace(/^([^：:]{1,20})[:：]\s*/, '**$1：** ')}`).join('\n');
}

function serializeRecord(record) {
  record.title = cleanTitleBoundary(record.title, 160) || '知识单元';
  record.search_title = cleanTitleBoundary(record.search_title || record.title, 240) || record.title;
  record.aliases = distinctSemanticTexts((record.aliases || []).map((item) => cleanTitleBoundary(item, 160)), [record.title, record.search_title]);
  const check = validateRecord(record);
  if (!check.valid) throw new Error(`记录 ${record.record_id} 不符合 schema：${check.errors.join('；')}`);
  const relations = (record.relations || []).slice().sort((a, b) =>
    `${a.type}:${a.target_id}`.localeCompare(`${b.type}:${b.target_id}`));
  const frontmatter = [
    '---',
    `schema_version: ${yamlScalar(record.schema_version || '1.0')}`,
    `record_kind: ${yamlScalar(record.record_kind)}`,
    `record_id: ${yamlScalar(record.record_id)}`,
    `title: ${yamlScalar(record.title)}`,
    `search_title: ${yamlScalar(record.search_title || record.title)}`,
    `aliases: ${yamlArray((record.aliases || []).filter((item) => item !== record.title && item !== (record.search_title || record.title)))}`,
    `keywords: ${yamlArray(searchKeywords(record))}`,
    `library: ${yamlScalar(record.library)}`,
    `created_at: ${yamlScalar(record.created_at)}`,
    `updated_at: ${yamlScalar(record.updated_at)}`
  ];
  for (const key of ['state', 'archive_outcome', 'source_path', 'source_hash', 'source_version', 'media_type', 'category', 'item_type', 'reuse_status']) {
    if (record[key]) frontmatter.push(`${key}: ${yamlScalar(record[key])}`);
  }
  if (record.semantic_kind) frontmatter.push(`semantic_kind: ${yamlScalar(record.semantic_kind)}`);
  if (record.source_language) frontmatter.push(`source_language: ${yamlScalar(record.source_language)}`);
  if (record.source_file) frontmatter.push(`source_file: ${yamlScalar(record.source_file)}`);
  if (record.source_document_names?.length) frontmatter.push(`source_document_names: ${yamlArray(record.source_document_names)}`);
  frontmatter.push(`output_language: ${yamlScalar(record.output_language || 'zh-CN')}`);
  if (record.tags?.length) frontmatter.push(`tags: ${yamlArray(record.tags)}`);
  for (const key of ['project_ids', 'source_document_ids', 'business_item_ids', 'company_knowledge_ids']) {
    if (record[key]?.length) frontmatter.push(`${key}: ${yamlArray(record[key])}`);
  }
  frontmatter.push('---', '', `# ${record.title}`, '');
  const body = [];
  if (record.summary) body.push('## 内容', '', readableSummary(record.summary), '');
  const evidenceList = mergeEvidence(record.evidence_list?.length ? record.evidence_list : [record.evidence]);
  if (evidenceList.length) {
    body.push('## 来源', '');
    const sourceRelation = relations.find((relation) => relation.type === 'derived_from');
    if (sourceRelation) body.push(`- 来源文件：${relationLink(sourceRelation)}`);
    for (const evidence of evidenceList) body.push(
      `- 原文位置：${combinedHumanLocators(evidence.locators || [evidence.locator || {}])}`, '',
      '### 原文摘录', '',
      `> ${displayEvidence(evidence.verbatim).replace(/\n/g, '\n> ')}`, '');
    if (record.evidence_translation && record.evidence_translation !== record.evidence.verbatim) {
      body.push('### 证据中文译文', '', `> ${clean(record.evidence_translation, 4000).replace(/\n/g, '\n> ')}`, '');
    }
  }
  const visibleRelations = evidenceList.length
    ? relations.filter((relation) => relation.type !== 'derived_from') : relations;
  if (visibleRelations.length) body.push('## 关系', '', ...visibleRelations.map((relation) =>
    `- ${relation.type}：${relationLink(relation)}`), '');
  if (record.unresolved_relations?.length) body.push('## 待处理关系', '',
    ...record.unresolved_relations.map((item) =>
      `- ${item.type || 'related'}：${item.source_candidate || '未命名'}（${item.reason}；定位 ${stableJson(item.evidence_locator || {})}）`), '');
  body.push('<details>', '<summary>技术追溯</summary>', '', `- 记录编号：${record.record_id}`);
  for (const evidence of evidenceList) for (const locator of evidence.locators || [evidence.locator || {}]) body.push(`- 定位数据：base64url:${encodedLocator(locator)}`);
  if (record.source_hash) body.push(`- 来源哈希：${record.source_hash}`);
  body.push('', '</details>');
  return `${frontmatter.concat(body).join('\n')}\n`;
}

function routeRecord(record, route, registryEntry, settings) {
  const categoryValue = record.category || route.directory_category;
  if (!categoryValue) throw new Error('结构化路由分类未确定，禁止使用默认目录');
  const category = safeSegment(categoryValue);
  if (record.library === 'active_tender') {
    if (!registryEntry) throw new Error('在办库记录缺少唯一项目登记');
    return joinPath(settings.activeRoot, safeSegment(registryEntry.project_id), category,
      KIND_FOLDER[record.record_kind], `${safeSegment(record.title)}.md`);
  }
  return joinPath(settings.businessRoot, category, KIND_FOLDER[record.record_kind], `${safeSegment(record.title)}.md`);
}

function resolveRelations(records, index, limits) {
  const byId = new Map(records.map((record) => [record.record_id, record]));
  const pathEntries = Object.values(index.records || {});
  for (const entry of pathEntries) if (!byId.has(entry.record_id)) byId.set(entry.record_id, entry);
  const unresolved = [];
  for (const record of records) {
    const resolved = [];
    const seen = new Set();
    for (const relation of record.requested_relations || []) {
      const type = clean(relation.type, 40);
      const rule = RELATION_TYPES[type];
      const candidates = uniq(relation.target_ids || (relation.target_id ? [relation.target_id] : []));
      const compatible = candidates.map((id) => byId.get(id)).filter((target) =>
        target && rule && rule.from.includes(record.record_kind) && rule.to.includes(target.record_kind));
      let reason = '';
      if (!rule) reason = 'unsupported_relation_type';
      else if (!candidates.length) reason = 'unresolved_target';
      else if (compatible.length !== 1) reason = compatible.length ? 'ambiguous_target' : 'type_mismatch_or_missing';
      if (reason) {
        const issue = {
          source_document_id: record.owner_source_id,
          source_record_id: record.record_id,
          type,
          source_candidate: clean(relation.source_candidate, 300),
          candidate_ids: candidates,
          evidence_locator: relation.evidence_locator || {},
          reason
        };
        record.unresolved_relations = [...(record.unresolved_relations || []), issue];
        unresolved.push(issue);
        continue;
      }
      const target = compatible[0];
      const key = `${type}:${target.record_id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      resolved.push({
        type, target_id: target.record_id, target_title: target.title,
        target_path: target.path || index.records?.[target.record_id]?.path
      });
      if (resolved.length >= limits.max_links_per_record) break;
    }
    record.relations = resolved.filter((relation) => relation.target_path);
  }
  const groups = new Map();
  for (const issue of unresolved) {
    const key = `${issue.source_document_id}:${issue.reason}`;
    if (!groups.has(key)) groups.set(key, { source_document_id: issue.source_document_id, cause: issue.reason, issues: [] });
    groups.get(key).issues.push(issue);
  }
  return [...groups.values()].sort((a, b) => `${a.source_document_id}:${a.cause}`.localeCompare(`${b.source_document_id}:${b.cause}`));
}

function buildRecords(input, settings) {
  if (input.universalResult?.knowledge_units) return buildCanonicalRecords(input, settings);
  const phase2 = input.phase2Result || {};
  const phase3 = input.phase3Result || {};
  const document = input.document || {};
  const route = phase2.route || {};
  const categories = route.library === 'active_tender' ? ACTIVE_TENDER_CATEGORIES
    : route.library === 'business' ? BUSINESS_CATEGORIES : null;
  if (!categories || !categories.some((entry) => entry.key === route.directory_category)) {
    throw Object.assign(new Error('结构化路由缺少明确且类型兼容的两库分类'), { code: 'STRUCTURED_ROUTE_UNRESOLVED' });
  }
  const registryMatches = (input.projectRegistry || []).filter((entry) => entry.project_id === route.project_id);
  if (route.project_id && registryMatches.length !== 1) throw new Error('项目路由不是登记表中的唯一精确匹配');
  const registry = registryMatches[0];
  const now = chinaTime(input.logicalTime || document.ingested_at || '1970-01-01T00:00:00.000Z');
  const sourceId = stableId('source_document', sourceIdentity(document));
  const sourceHash = clean(document.source_hash, 128);
  const source = {
    schema_version: '1.0', record_kind: 'source_document', record_id: sourceId,
    title: sourceFilename(document),
    library: route.library, created_at: now, updated_at: now,
    source_path: clean(document.source_path, 800), source_hash: sourceHash,
    source_version: clean(document.source_version || document.metadata?.version_label, 100),
    media_type: clean(document.media_type || document.source_type, 100),
    owner_source_id: sourceId, summary: '原始资料的结构化来源记录。'
  };
  const records = [];
  let project = null;
  if (registry) {
    const projectId = stableId('project', projectIdentity(registry));
    project = {
      schema_version: '1.0', record_kind: 'project', record_id: projectId,
      title: clean(registry.name || registry.project_id, 300), library: 'active_tender',
      created_at: now, updated_at: now, state: clean(registry.state || 'lead', 40),
      owner_source_id: sourceId, source_document_ids: [sourceId]
    };
    source.project_ids = [projectId];
    source.requested_relations = [{ type: 'belongs_to', target_id: projectId }];
    records.push(project);
  }
  records.push(source);
  const decisions = new Map((phase3.classifications || []).map((item) => [item.candidate_id, item]));
  const seen = new Set();
  for (const candidate of phase2.business_item_batch?.items || []) {
    const decision = decisions.get(candidate.candidate_id);
    if (!decision || decision.outcome === 'mandatory_human_handling') continue;
    const itemId = stableId('business_item', candidateIdentity(candidate, sourceId));
    const fingerprint = hash({
      type: candidate.item_type, summary: clean(candidate.summary, 4000),
      evidence: candidate.evidence
    });
    if (seen.has(fingerprint)) continue;
    seen.add(fingerprint);
    const item = {
      schema_version: '1.0', record_kind: 'business_item', record_id: itemId,
      title: clean(candidate.title || candidate.summary, 120) || '业务事项',
      library: route.library, created_at: now, updated_at: now,
      category: route.directory_category, item_type: candidate.item_type,
      summary: clean(candidate.summary, 8000), evidence: candidate.evidence,
      owner_source_id: sourceId, source_document_ids: [sourceId],
      project_ids: project ? [project.record_id] : [],
      requested_relations: [
        { type: 'derived_from', target_id: sourceId },
        ...(project ? [{ type: 'belongs_to', target_id: project.record_id }] : []),
        ...(candidate.relations || [])
      ]
    };
    records.push(item);
  }
  const approvedPromotions = new Set(input.approvedCompanyKnowledgeCandidateIds || []);
  for (const candidate of phase2.business_item_batch?.items || []) {
    if (!candidate.reusable_knowledge_candidate || !approvedPromotions.has(candidate.candidate_id)) continue;
    const knowledgeId = stableId('company_knowledge', `approved:${candidateIdentity(candidate, sourceId)}`);
    records.push({
      schema_version: '1.0', record_kind: 'company_knowledge', record_id: knowledgeId,
      title: clean(candidate.title || candidate.summary, 120) || '公司知识',
      library: 'business', created_at: now, updated_at: now,
      category: input.companyKnowledgeCategory || route.directory_category,
      summary: clean(candidate.summary, 8000), evidence: candidate.evidence,
      reuse_status: 'approved', owner_source_id: sourceId, source_document_ids: [sourceId],
      requested_relations: [{ type: 'derived_from', target_id: sourceId }]
    });
  }
  assertSourceRecordLimit(records, settings, sourceId);
  return { records, registry, route, sourceId };
}

function buildCanonicalRecords(input, settings) {
  const result = input.universalResult;
  const document = result.document || input.document || {};
  const eligibleUnits = (result.knowledge_units || []).filter((unit) =>
    !(result.review_decisions || []).some((review) => review.unit_ids?.includes(unit.unit_id)));
  const units = coalesceCanonicalUnits(eligibleUnits);
  const now = chinaTime(input.logicalTime || document.ingested_at || '1970-01-01T00:00:00.000Z');
  const sourceId = stableId('source_document', sourceIdentity(document));
  const registryMatches = (input.projectRegistry || []).filter((entry) =>
    units.some((unit) => unit.project_ids?.includes(entry.project_id)));
  if (units.some((unit) => unit.route?.library === 'active_tender') && registryMatches.length !== 1) {
    throw Object.assign(new Error('在办知识单元必须唯一匹配项目登记表'), { code: 'STRUCTURED_ROUTE_UNRESOLVED' });
  }
  const registry = registryMatches[0] || null;
  const sourceLibrary = units.some((unit) => unit.route?.library === 'active_tender') ? 'active_tender' : 'business';
  const source = {
    schema_version: '1.0', record_kind: 'source_document', record_id: sourceId,
    title: sourceFilename(document), library: sourceLibrary,
    created_at: now, updated_at: now, source_path: clean(document.source_path, 800),
    source_hash: clean(document.source_hash, 128), media_type: clean(document.media_type, 100),
    owner_source_id: sourceId, summary: `统一语义管线来源记录；共形成 ${units.length} 个知识单元。`,
    category: sourceLibrary === 'active_tender' ? 'project_material_index' : 'terminology_general_knowledge'
  };
  const records = [source];
  let project = null;
  if (registry) {
    const projectId = stableId('project', projectIdentity(registry));
    project = {
      schema_version: '1.0', record_kind: 'project', record_id: projectId,
      title: clean(registry.name || registry.project_id, 300), library: 'active_tender',
      created_at: now, updated_at: now, state: clean(registry.state || 'lead', 40),
      owner_source_id: sourceId, source_document_ids: [sourceId], category: 'project_overview'
    };
    source.project_ids = [projectId];
    source.requested_relations = [{ type: 'belongs_to', target_id: projectId }];
    records.unshift(project);
  }
  const unitToRecord = new Map();
  const recordsById = new Map(records.map((record) => [record.record_id, record]));
  for (const unit of units) {
    const recordKind = unit.route.library === 'business' && unit.reusable === true
      ? 'company_knowledge' : 'business_item';
    const recordId = stableId(recordKind, `${sourceId}:unit:${unit.fingerprint || unit.unit_id}`);
    unitToRecord.set(unit.unit_id, recordId);
    for (const memberId of unit.member_unit_ids || []) unitToRecord.set(memberId, recordId);
    if (recordsById.has(recordId)) {
      const existing = recordsById.get(recordId);
      const evidence = [...(existing.evidence_list || []), ...(unit.evidence || [])];
      existing.evidence_list = [...new Map(evidence.map((item) => [hash(item), item])).values()];
      continue;
    }
    const record = {
      schema_version: '1.0', record_kind: recordKind, record_id: recordId,
      title: clean(unit.title, 160) || '知识单元', library: unit.route.library,
      created_at: now, updated_at: now, category: unit.route.category,
      item_type: recordKind === 'business_item' ? unit.semantic_kind : undefined,
      reuse_status: recordKind === 'company_knowledge' ? 'auto_supported' : undefined,
      summary: clean(unit.statement, 8000), evidence: unit.evidence?.[0],
      evidence_translation: unit.source_language === 'zh' ? '' : clean(unit.translated_statement, 8000),
      evidence_list: unit.evidence, tags: unit.tags, semantic_kind: unit.semantic_kind,
      search_title: unit.search_title || unit.title, aliases: unit.aliases || [],
      keywords: uniq([...(unit.keywords || []), ...(unit.tags || []), unit.subject]),
      source_language: unit.source_language, output_language: unit.output_language || 'zh-CN',
      original_statement: unit.original_statement, translated_statement: unit.translated_statement,
      translation: unit.translation,
      conditions: unit.applicable_conditions, exceptions: unit.exceptions,
      structured_facts: unit.structured_facts, confidence: unit.confidence,
      uncertainty: unit.uncertainty, owner_source_id: sourceId,
      source_file: source.title, source_document_names: [source.title],
      source_document_ids: [sourceId], project_ids: project ? [project.record_id] : [],
      requested_relations: [{ type: 'derived_from', target_id: sourceId }]
    };
    records.push(record);
    recordsById.set(recordId, record);
  }
  for (const relation of result.relations || []) {
    const from = records.find((record) => record.record_id === unitToRecord.get(relation.from_unit_id));
    const toId = unitToRecord.get(relation.to_unit_id);
    if (!from || !toId) continue;
    from.requested_relations.push({ type: relation.type, target_id: toId, evidence_locator: relation.evidence });
    const to = records.find((record) => record.record_id === toId);
    if (to) to.requested_relations.push({ type: relation.type, target_id: from.record_id, evidence_locator: relation.evidence });
  }
  assertSourceRecordLimit(records, settings, sourceId);
  return {
    records, registry, sourceId,
    route: { library: sourceLibrary, directory_category: source.category },
    reviewDecisions: result.review_decisions || []
  };
}

function assertSourceRecordLimit(records, settings, sourceId) {
  const knowledgeRecords = records.filter((record) => KNOWLEDGE_RECORD_KINDS.has(record.record_kind)).length;
  if (knowledgeRecords <= PLAN_LIMITS.max_source_records) return;
  const partitionSize = settings.limits.max_records;
  const partitionCount = Math.ceil(knowledgeRecords / partitionSize);
  const error = new Error(`单来源结构化记录 ${knowledgeRecords} 条，超过全局安全上限 ${PLAN_LIMITS.max_source_records} 条。`);
  error.code = 'STRUCTURED_KNOWLEDGE_LIMIT_EXCEEDED';
  error.details = {
    actual_records: knowledgeRecords, global_safe_limit: PLAN_LIMITS.max_source_records,
    transaction_record_limit: partitionSize, required_partitions: partitionCount,
    source_document_id: sourceId,
    recovery: '保留 canonical 与 translation checkpoint；检查异常重复单元后从 structured writer 重试。'
  };
  throw error;
}

function normalizeCanonicalPresentation(rawUnit) {
  const title = cleanTitleBoundary(clean(rawUnit.title, 160).replace(/^(?:标题|名称)[：:]\s*/, '').replace(/([要求方法流程参数定义])(?:要求|方法|流程|参数|定义)$/u, '$1'), 160) || '知识单元';
  const statement = dedupeSemanticTexts(String(rawUnit.statement || '').split(/\n+/)
    .map((line) => clean(line).replace(/^(?:标题|名称)[：:]\s*/, ''))).join('\n');
  let searchTitle = cleanTitleBoundary(rawUnit.search_title || title, 240);
  if (normalizeSemanticText(searchTitle) === normalizeSemanticText(title)) {
    const retrieval = distinctSemanticTexts([rawUnit.subject, ...(rawUnit.keywords || [])], [title])[0];
    if (retrieval) searchTitle = `${title} ${retrieval}`;
  }
  return { ...rawUnit, title, search_title: searchTitle,
    aliases: distinctSemanticTexts(rawUnit.aliases || [], [title, searchTitle]), statement };
}

function coalesceCanonicalUnits(units, options = {}) {
  const maxChars = Math.max(1000, Number(options.max_chars) || 12000);
  const output = [];
  for (const rawUnit of units) {
    const presented = normalizeCanonicalPresentation(rawUnit);
    const unit = { ...presented, statement: dedupeSemanticTexts(String(presented.statement || '').split(/\n+/)).join('\n'),
      evidence: mergeEvidence(rawUnit.evidence || []) };
    const semanticFingerprint = `semantic:${hash([unit.semantic_kind, normalizeSemanticText(unit.subject || unit.title),
      normalizeSemanticText(unit.statement), unit.scope || '', unit.route?.library || '', unit.route?.category || '',
      [...(unit.project_ids || [])].sort()])}`;
    const exact = output.find((candidate) => candidate.semantic_kind === unit.semantic_kind
      && normalizeSemanticText(candidate.subject || candidate.title) === normalizeSemanticText(unit.subject || unit.title)
      && semanticTextSignature(candidate.statement) === semanticTextSignature(unit.statement)
      && candidate.scope === unit.scope && candidate.route?.library === unit.route?.library
      && candidate.route?.category === unit.route?.category);
    if (exact) {
      exact.member_unit_ids = uniq([...(exact.member_unit_ids || [exact.unit_id]), ...(unit.member_unit_ids || [unit.unit_id])]);
      exact.evidence = mergeEvidence([...(exact.evidence || []), ...(unit.evidence || [])]);
      exact.fingerprint = semanticFingerprint;
      continue;
    }
    const previous = unit.card_plan?.plan_id
      ? output.find((candidate) => candidate.card_plan?.plan_id === unit.card_plan.plan_id) : null;
    if (!previous
      || String(previous.statement || '').length + String(unit.statement || '').length > maxChars) {
      output.push({ ...unit, member_unit_ids: [...(unit.member_unit_ids || [unit.unit_id])] });
      continue;
    }
    const members = [...previous.member_unit_ids, ...(unit.member_unit_ids || [unit.unit_id])];
    previous.member_unit_ids = uniq(members);
    previous.unit_id = `coalesced-${hash(previous.member_unit_ids).slice(0, 24)}`;
    previous.fingerprint = `coalesced:${hash(previous.member_unit_ids.map((id) => String(id)))}`;
    previous.statement = dedupeSemanticTexts([previous.statement, unit.statement]).join('\n');
    previous.evidence = mergeEvidence([...(previous.evidence || []), ...(unit.evidence || [])]);
    previous.tags = uniq([...(previous.tags || []), ...(unit.tags || [])]);
    previous.applicable_conditions = uniq([...(previous.applicable_conditions || []), ...(unit.applicable_conditions || [])]);
    previous.exceptions = uniq([...(previous.exceptions || []), ...(unit.exceptions || [])]);
    previous.uncertainty = uniq([...(previous.uncertainty || []), ...(unit.uncertainty || [])]);
  }
  return output;
}

function sameStructuralTopic(left, right) {
  // useful-card/2.0 already made an explicit split/combine decision. Never
  // undo an independent split in the writer merely because headings match.
  if (left?.card_plan || right?.card_plan) return left?.card_plan?.plan_id === right?.card_plan?.plan_id;
  const a = stableJson(left?.structure_context?.heading_path || []);
  const b = stableJson(right?.structure_context?.heading_path || []);
  return a !== '[]' && a === b && semanticTopic(left) && semanticTopic(left) === semanticTopic(right)
    && left.route?.library === right.route?.library
    && left.route?.category === right.route?.category && left.semantic_kind === right.semantic_kind
    && left.scope === right.scope;
}

function semanticTopic(unit) {
  return clean(unit.subject || unit.title, 200).toLocaleLowerCase().replace(/[\s\p{P}\p{S}]+/gu, '');
}

function locatorOrdinal(unit) {
  const value = unit.evidence?.[0]?.locator?.value ?? unit.evidence?.[0]?.locator?.paragraph
    ?? unit.evidence?.[0]?.locator?.row ?? '';
  const match = String(value).match(/\d+/); return match ? Number(match[0]) : null;
}

function locatorSection(unit) {
  const locator = unit.evidence?.[0]?.locator || {};
  const value = String(locator.value ?? '');
  return `${locator.scheme || ''}:${value.replace(/(?:[\/#]p(?:aragraph)?=?)\d+.*$/i, '')}`;
}

function semanticallyAdjacent(left, right) {
  if (left?.card_plan || right?.card_plan) return left?.card_plan?.plan_id === right?.card_plan?.plan_id;
  if (!left?.route || !right?.route) return false;
  if (left.route.library !== right.route.library || left.route.category !== right.route.category
    || left.semantic_kind !== right.semantic_kind || left.scope !== right.scope) return false;
  const a = locatorOrdinal(left); const b = locatorOrdinal(right);
  const leftHeading = stableJson(left.structure_context?.heading_path || []);
  const rightHeading = stableJson(right.structure_context?.heading_path || []);
  const sameHeading = leftHeading !== '[]' && leftHeading === rightHeading;
  const adjacent = a == null || b == null || (b >= a && b - a <= (sameHeading ? 10 : 2));
  const sameTopic = semanticTopic(left) && semanticTopic(left) === semanticTopic(right);
  return adjacent && sameTopic && (sameHeading || (a != null && b != null
    && (left.evidence?.[0]?.locator?.scheme === right.evidence?.[0]?.locator?.scheme
      || (locatorSection(left) && locatorSection(left) === locatorSection(right)))));
}

function buildPlan(input) {
  const settings = normalizeSettings(input.settings);
  if (!settings.enabled || settings.mode === 'legacy') return {
    version: WRITER_VERSION, mode: 'feature_off', actions: [], conflicts: [], review_groups: [],
    summary: '结构化写入未开启。', writes_performed: 0
  };
  for (const root of [settings.activeRoot, settings.businessRoot, settings.stateRoot]) {
    if (!pathSafe(root)) throw new Error(`未通过 vault 路径安全校验：${root}`);
  }
  const roots = [settings.activeRoot, settings.businessRoot];
  if (roots[0] === roots[1] || roots.some((a) => roots.some((b) => a !== b
    && (a.startsWith(`${b}/`) || b.startsWith(`${a}/`))))) {
    throw new Error('两库根目录不能相同或互相嵌套');
  }
  for (const protectedRoot of [
    settings.stateRoot, clean(input.settings?.intakePath, 600),
    clean(input.settings?.bidIntakePath, 600), clean(input.settings?.businessIntakePath, 600)
  ].filter(Boolean)) {
    if (roots.some((root) => root === protectedRoot || root.startsWith(`${protectedRoot}/`)
      || protectedRoot.startsWith(`${root}/`))) {
      throw new Error('结构化输出根目录不得与来源或插件状态目录重叠');
    }
  }
  const { index, conflicts: indexConflicts } = validateIndex(input.index);
  const { records, registry, route, sourceId, reviewDecisions = [] } = buildRecords(input, settings);
  const conflicts = [...indexConflicts];
  const physicalIds = new Map();
  for (const [path, content] of Object.entries(input.existingFiles || {})) {
    if (typeof content !== 'string') continue;
    const id = clean((content.match(/^record_id:\s*["']?([^"'\n]+)/m) || [])[1], 300);
    if (!id) continue;
    if (!physicalIds.has(id)) physicalIds.set(id, []);
    physicalIds.get(id).push(path);
  }
  for (const [recordId, paths] of physicalIds) {
    if (new Set(paths).size > 1) conflicts.push({
      cause: 'same_id_multiple_paths', record_id: recordId, paths: uniq(paths)
    });
  }
  if (route.library === 'active_tender' && !registry) {
    conflicts.push({ cause: 'active_project_unresolved', source_document_id: sourceId });
    return {
      version: WRITER_VERSION, mode: settings.mode, source_document_id: sourceId,
      generator: 'structured-writer', actions: [], conflicts, review_groups: [],
      phase3_handling_groups: reviewDecisions,
      counts: {}, source_hash: clean(input.document?.source_hash, 128),
      source_version: clean(input.document?.source_version || input.document?.metadata?.version_label, 100),
      index_revision: Number(index.revision || 0), blocked: true, writes_performed: 0,
      plan_id: `plan-${hash([sourceId, 'active_project_unresolved']).slice(0, 24)}`,
      summary: '新建 0，更新 0，不变 0，移动 0，需要处理 1。'
    };
  }
  const reserved = new Map(Object.keys(input.existingFiles || {}).map((path) => [path, frontmatterValue(input.existingFiles[path], 'record_id')]));
  const allocated = new Map();
  for (const record of records.sort((a, b) => a.record_id.localeCompare(b.record_id))) {
    const desired = routeRecord(record, { ...route, directory_category: record.category || route.directory_category }, registry, settings);
    const existingIndex = index.records?.[record.record_id];
    const oldPath = existingIndex?.path;
    const managedTechnical = oldPath && oldPath.split('/').at(-1) === `${record.record_id}.md`
      && input.existingFiles?.[oldPath] !== undefined && Boolean(existingIndex.content_hash);
    const priorTitle = cleanTitleBoundary(frontmatterValue(input.existingFiles?.[oldPath], 'title'), 160);
    const priorGeneratedPath = priorTitle ? routeRecord({ ...record, title: priorTitle },
      { ...route, directory_category: record.category || route.directory_category }, registry, settings) : '';
    const managedHumanPath = Boolean(oldPath && oldPath === priorGeneratedPath
      && input.existingFiles?.[oldPath] !== undefined && existingIndex?.content_hash);
    const mayMigrate = managedTechnical || managedHumanPath;
    let candidate = existingIndex && !mayMigrate && input.archiveTransition !== true ? oldPath : desired;
    const ext = '.md'; const stem = candidate.slice(0, -ext.length);
    let ordinal = 1;
    while ((allocated.has(candidate) && allocated.get(candidate) !== record.record_id)
      || (reserved.has(candidate) && reserved.get(candidate) !== record.record_id && candidate !== oldPath)) {
      ordinal += 1; candidate = `${stem}（${ordinal}）${ext}`;
    }
    record.path = candidate; allocated.set(candidate, record.record_id);
    if (mayMigrate && oldPath !== candidate && input.archiveTransition !== true) record.migrate_from_path = oldPath;
  }
  const reviewGroups = resolveRelations(records, index, settings.limits);
  const byPath = input.existingFiles || {};
  const actions = [];
  for (const record of records.sort((a, b) => a.record_id.localeCompare(b.record_id))) {
    const indexed = index.records?.[record.record_id];
    const occupied = byPath[record.path];
    if (occupied !== undefined) {
      const occupiedId = clean((occupied.match(/^record_id:\s*["']?([^"'\n]+)/m) || [])[1], 300);
      if (occupiedId && occupiedId !== record.record_id) {
        conflicts.push({ cause: 'path_occupied_by_different_id', path: record.path, record_id: record.record_id, occupied_id: occupiedId });
        continue;
      }
    }
    const content = serializeRecord(record);
    const contentHash = hash(content);
    const fromPath = record.migrate_from_path;
    const prior = fromPath ? byPath[fromPath] : byPath[record.path];
    const priorHash = prior === undefined ? null : hash(prior);
    const indexedHash = indexed?.content_hash || null;
    if (prior !== undefined && indexedHash && priorHash !== indexedHash) {
      conflicts.push({ cause: 'optimistic_hash_mismatch', record_id: record.record_id, path: record.path, expected: indexedHash, actual: priorHash });
      continue;
    }
    const action = fromPath ? (priorHash === contentHash ? 'move' : 'update_and_move')
      : priorHash === contentHash ? 'noop' : prior === undefined ? 'create' : 'update';
    actions.push({
      action, record_id: record.record_id, record_kind: record.record_kind, path: record.path,
      ...(fromPath ? { from_path: fromPath } : {}),
      content, content_hash: contentHash, prior_hash: priorHash, prior_content: prior,
      owner_source_id: sourceId, source_hash: clean(input.document?.source_hash, 128),
      source_version: clean(input.document?.source_version || input.document?.metadata?.version_label, 100),
      record_snapshot: JSON.parse(JSON.stringify(record))
    });
  }
  if (input.archiveTransition) {
    const transition = validateProjectTransition(input.archiveTransition.from, 'archived', input.archiveTransition);
    if (!transition.allowed) conflicts.push({ cause: 'archive_transition_blocked', reason: transition.reason });
    else {
      for (const action of actions) {
        if (!action.path.startsWith(`${settings.activeRoot}/`)) continue;
        const to = joinPath(settings.businessRoot, 'complete_historical_projects', action.path.slice(settings.activeRoot.length + 1));
        if (action.prior_hash === null) {
          action.action = 'create';
        } else {
          action.action = action.action === 'noop' ? 'move' : `${action.action}_and_move`;
          action.from_path = action.path;
        }
        action.path = to;
      }
      const movedLinks = new Map(actions.filter((action) => action.from_path).map((action) => [action.from_path, action.path]));
      for (const action of actions) {
        for (const [from, to] of movedLinks) action.content = action.content.split(`[[${from}|`).join(`[[${to}|`);
        action.content_hash = hash(action.content);
      }
    }
  }
  if (actions.length > PLAN_LIMITS.max_source_actions) {
    const error = new Error(`单来源写入动作 ${actions.length} 个，超过全局安全上限 ${PLAN_LIMITS.max_source_actions} 个。`);
    error.code = 'STRUCTURED_ACTION_LIMIT_EXCEEDED';
    error.details = { actual_actions: actions.length, global_safe_limit: PLAN_LIMITS.max_source_actions,
      transaction_action_limit: settings.limits.max_actions, source_document_id: sourceId };
    throw error;
  }
  const counts = {};
  for (const action of actions) counts[action.action] = (counts[action.action] || 0) + 1;
  const universalMode = Boolean(input.universalResult?.knowledge_units);
  const phase3HandlingGroups = universalMode ? reviewDecisions
    : [...(input.phase3Result?.handling_groups || []), ...reviewDecisions];
  // Phase-3 decisions refer to units already excluded by buildCanonicalRecords.
  // They remain durable review evidence, but must not block an atomic commit of
  // the independent, verified knowledge set.
  const blocked = conflicts.length > 0 || reviewGroups.length > 0;
  const planCore = {
    version: WRITER_VERSION, mode: settings.mode, source_document_id: sourceId,
    generator: 'structured-writer', actions, conflicts, review_groups: reviewGroups,
    phase3_handling_groups: phase3HandlingGroups, counts,
    source_hash: clean(input.document?.source_hash, 128),
    source_version: clean(input.document?.source_version || input.document?.metadata?.version_label, 100),
    index_revision: Number(index.revision || 0), blocked,
    writes_performed: 0,
    transaction_limits: { max_records: settings.limits.max_records, max_actions: settings.limits.max_actions }
  };
  planCore.plan_id = `plan-${hash({ ...planCore, actions: actions.map(({ prior_content, ...item }) => item) }).slice(0, 24)}`;
  planCore.summary = `新建 ${counts.create || 0}，更新 ${counts.update || 0}，不变 ${counts.noop || 0}，移动 ${counts.move || 0}，需要处理 ${conflicts.length + reviewGroups.length + planCore.phase3_handling_groups.length}。`;
  return planCore;
}

function partitionPlan(plan) {
  if (!plan?.actions || plan.mode === 'feature_off') return [plan];
  const maxRecords = Math.max(1, Number(plan.transaction_limits?.max_records) || 100);
  const maxActions = Math.max(1, Number(plan.transaction_limits?.max_actions) || 300);
  const support = plan.actions.filter((action) => !KNOWLEDGE_RECORD_KINDS.has(action.record_kind));
  const knowledge = plan.actions.filter((action) => KNOWLEDGE_RECORD_KINDS.has(action.record_kind));
  if (support.length > maxActions) {
    const error = new Error(`来源支撑记录 ${support.length} 个，无法放入上限 ${maxActions} 的有界事务。`);
    error.code = 'STRUCTURED_PARTITION_UNSAFE';
    error.details = { actual_support_actions: support.length, transaction_action_limit: maxActions,
      actual_records: knowledge.length, recovery: '保留已有检查点，调整单事务 action 上限后重试。' };
    throw error;
  }
  const partitions = [];
  let offset = 0;
  while (offset < knowledge.length || (!partitions.length && support.length)) {
    const prefix = partitions.length ? [] : support;
    const capacity = Math.min(maxRecords, maxActions - prefix.length);
    if (knowledge.length > offset && capacity < 1) {
      const error = new Error(`事务 action 上限 ${maxActions} 无法同时容纳来源支撑记录和知识记录。`);
      error.code = 'STRUCTURED_PARTITION_UNSAFE';
      error.details = { actual_support_actions: support.length, transaction_action_limit: maxActions,
        actual_records: knowledge.length, recovery: '保留已有检查点，调整单事务 action 上限后重试。' };
      throw error;
    }
    const actions = [...prefix, ...knowledge.slice(offset, offset + capacity)];
    offset += Math.max(0, actions.length - prefix.length);
    partitions.push(actions);
  }
  const total = partitions.length;
  return partitions.map((actions, index) => {
    const partition = { ...plan, actions, partition: { schema_version: 'structured-partition/1.0',
      index: index + 1, total, knowledge_offset: index === 0 ? 0 : partitions.slice(0, index)
        .reduce((sum, rows) => sum + rows.filter((a) => KNOWLEDGE_RECORD_KINDS.has(a.record_kind)).length, 0),
      knowledge_count: actions.filter((a) => KNOWLEDGE_RECORD_KINDS.has(a.record_kind)).length } };
    partition.plan_id = `plan-${hash({ parent_plan_id: plan.plan_id, partition: partition.partition,
      actions: actions.map(({ prior_content, ...item }) => item) }).slice(0, 24)}`;
    return partition;
  });
}

async function ensureParent(vault, path) {
  const parent = path.split('/').slice(0, -1).join('/');
  if (parent) await vault.mkdirp(parent);
}

const KNOWLEDGE_RECORD_KINDS = new Set(['business_item', 'company_knowledge']);

function frontmatterValue(content, key) {
  const match = String(content || '').match(new RegExp(`^${key}:\\s*["']?([^"'\\n]+)`, 'm'));
  return clean(match?.[1], 300);
}

function hasSourceAssociation(content, sourceId) {
  const value = String(content || '');
  return value.includes(`- 归属来源：${sourceId}`)
    || new RegExp(`^source_document_ids:\\s*\\[[^\\n]*["']?${sourceId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}["']?`, 'm').test(value);
}

async function verifyCommittedRecords(plan, vault, context = {}) {
  const records = [];
  const failures = [];
  for (const action of plan.actions) {
    let content = null;
    try { content = await vault.readIfExists(action.path); } catch (error) {
      failures.push({ record_id: action.record_id, record_kind: action.record_kind,
        path: action.path, reason: 'unreadable_file', error: String(error?.message || error) });
      continue;
    }
    const actualId = frontmatterValue(content, 'record_id');
    const actualKind = frontmatterValue(content, 'record_kind');
    if (content === null || !String(content).trim() || !action.path.endsWith('.md') || actualId !== action.record_id
      || actualKind !== action.record_kind
      || (KNOWLEDGE_RECORD_KINDS.has(action.record_kind)
        && !hasSourceAssociation(content, action.owner_source_id))) {
      failures.push({
        record_id: action.record_id, record_kind: action.record_kind, path: action.path,
        reason: content === null ? 'missing_file' : !String(content).trim() ? 'empty_file' : 'identity_or_source_mismatch'
      });
      continue;
    }
    let authoritative = null;
    try {
      authoritative = typeof vault.verify === 'function'
        ? await vault.verify(action, context.transactionId || '', context.verifiedAt || '', context) : null;
    } catch (error) {
      failures.push({ record_id: action.record_id, record_kind: action.record_kind,
        path: action.path, reason: 'public_vault_verification_failed', error: String(error?.message || error) });
      continue;
    }
    records.push({
      record_id: action.record_id, record_kind: action.record_kind, final_path: action.path, path: action.path,
      disposition: action.action === 'noop' ? 'unchanged' : action.action,
      bytes: Buffer.byteLength(content), knowledge_record: KNOWLEDGE_RECORD_KINDS.has(action.record_kind),
      content_hash: action.content_hash, verified_at: context.verifiedAt || '',
      transaction_id: context.transactionId || '', state: 'visible_verified', ...(authoritative || {})
    });
  }
  if (failures.length) {
    const plannedKnowledge = plan.actions.filter((item) => KNOWLEDGE_RECORD_KINDS.has(item.record_kind));
    const verifiedKnowledge = records.filter((item) => item.knowledge_record);
    const error = new Error(`结构化提交未持久化：计划 ${plannedKnowledge.length} 个知识文件，仅验证 ${verifiedKnowledge.length} 个。`);
    error.code = 'STRUCTURED_WRITE_NOT_PERSISTED';
    error.stage = 'structured-post-commit-verification';
    error.details = {
      planned: plannedKnowledge.length, attempted: plannedKnowledge.filter((item) => item.action !== 'noop').length,
      committed: verifiedKnowledge.length, verified: verifiedKnowledge.length, failures
    };
    throw error;
  }
  const knowledgeRecords = records.filter((record) => record.knowledge_record);
  return {
    records,
    knowledge_records: knowledgeRecords,
    knowledge_paths: knowledgeRecords.map((record) => record.path),
    counts: {
      created: records.filter((record) => record.disposition === 'create').length,
      updated: records.filter((record) => record.disposition.includes('update')).length,
      unchanged: records.filter((record) => record.disposition === 'unchanged').length,
      moved: records.filter((record) => record.disposition.includes('move')).length,
      source_records: records.filter((record) => record.record_kind === 'source_document').length,
      project_records: records.filter((record) => record.record_kind === 'project').length,
      knowledge_records: knowledgeRecords.length,
      knowledge_created: knowledgeRecords.filter((record) => record.disposition === 'create').length,
      knowledge_updated: knowledgeRecords.filter((record) => record.disposition.includes('update')).length,
      knowledge_unchanged: knowledgeRecords.filter((record) => record.disposition === 'unchanged').length
    },
    bytes_written: records
      .filter((record) => record.disposition !== 'unchanged')
      .reduce((sum, record) => sum + record.bytes, 0)
  };
}

async function commitPlan(plan, options) {
  if (!plan || plan.mode !== 'structured-write') throw new Error('只有 structured-write 计划可提交');
  if (plan.blocked) throw new Error('计划包含冲突或待处理项，禁止提交');
  const vault = options.vault;
  const release = await options.lock.acquire('structured-writer');
  if (!options.runId) throw Object.assign(new Error('结构化提交缺少当前 run_id'), { code: 'CURRENT_RUN_REQUIRED' });
  const transactionId = `txn-${hash([plan.plan_id, options.runId, options.logicalTime || '']).slice(0, 24)}`;
  const quarantine = joinPath(options.stateRoot, 'structured-writer', 'quarantine', transactionId);
  const manifestPath = joinPath(options.stateRoot, 'structured-writer', 'transactions', `${transactionId}.json`);
  const manifest = {
    version: WRITER_VERSION, transaction_id: transactionId, plan_id: plan.plan_id,
    source_document_id: plan.source_document_id, run_id: options.runId, task_id: options.taskId || '',
    status: 'staging', steps: [], created_at: options.logicalTime || ''
  };
  manifest.previous_index = JSON.parse(JSON.stringify(options.index || emptyIndex()));
  manifest.required_artifacts = [];
  let indexSaved = false;
  try {
    await ensureParent(vault, manifestPath);
    await vault.write(manifestPath, JSON.stringify(manifest, null, 2));
    for (const action of plan.actions.filter((item) => item.action !== 'noop')) {
      const current = await vault.readIfExists(action.from_path || action.path);
      if ((current === null ? null : hash(current)) !== action.prior_hash) throw new Error(`提交前内容已变化：${action.record_id}`);
      const step = { ...action, prior_content: current, status: 'started' };
      manifest.steps.push(step);
      await vault.write(manifestPath, JSON.stringify(manifest, null, 2));
      if (action.from_path && action.from_path !== action.path) {
        await ensureParent(vault, action.path);
        await vault.rename(action.from_path, action.path);
        step.moved = true;
      }
      await ensureParent(vault, action.path);
      await vault.write(action.path, action.content);
      step.status = 'committed';
      await vault.write(manifestPath, JSON.stringify(manifest, null, 2));
    }
    const index = JSON.parse(JSON.stringify(options.index || emptyIndex()));
    index.version = INDEX_VERSION;
    index.revision = Number(index.revision || 0) + 1;
    index.updated_at = options.logicalTime || '';
    for (const action of plan.actions) index.records[action.record_id] = {
      record_id: action.record_id, record_kind: action.record_kind, path: action.path,
      content_hash: action.content_hash, owner_source_id: action.owner_source_id,
      source_hash: action.source_hash, source_version: action.source_version
    };
    index.source_versions[plan.source_document_id] = { source_hash: plan.source_hash, source_version: plan.source_version };
    await options.saveIndex(index);
    indexSaved = true;
    for (const artifact of (options.requiredArtifacts || [])) {
      const prior = await vault.readIfExists(artifact.path);
      const step = { action: 'required_artifact', record_id: artifact.id, record_kind: 'production_state',
        path: artifact.path, prior_content: prior, content_hash: hash(artifact.content), status: 'started' };
      manifest.steps.push(step); manifest.required_artifacts.push({ id: artifact.id, path: artifact.path, content_hash: step.content_hash });
      await vault.write(manifestPath, JSON.stringify(manifest, null, 2));
      await vault.write(artifact.path, artifact.content); step.status = 'committed';
      if (hash(await vault.readIfExists(artifact.path)) !== step.content_hash) throw new Error(`必需生产产物最终校验失败：${artifact.id}`);
      await vault.write(manifestPath, JSON.stringify(manifest, null, 2));
    }
    manifest.status = 'files_committed';
    manifest.index_revision = index.revision;
    await vault.write(manifestPath, JSON.stringify(manifest, null, 2));
    const targetRoots = options.targetRoots || { active_tender: '06-知识库/招投标库', business: '06-知识库/业务库' };
    const verified = await verifyCommittedRecords(plan, vault, {
      transactionId, verifiedAt: new Date().toISOString(), runId: options.runId, targetRoots
    });
    if (typeof options.verifyRequiredArtifacts === 'function') await options.verifyRequiredArtifacts({ index, verified, manifest });
    const plannedPaths = plan.actions.filter((item) => KNOWLEDGE_RECORD_KINDS.has(item.record_kind)).map((item) => item.path);
    const committedPaths = plan.actions.filter((item) => KNOWLEDGE_RECORD_KINDS.has(item.record_kind)
      && (item.action === 'noop' || manifest.steps.some((step) => step.record_id === item.record_id && step.status === 'committed'))).map((item) => item.path);
    const visiblePaths = verified.knowledge_records.map((item) => item.final_path);
    const sortedUnique = (rows) => [...new Set(rows)].sort();
    const sets = { planned: sortedUnique(plannedPaths), committed: sortedUnique(committedPaths), visible_verified: sortedUnique(visiblePaths) };
    const pathSetHashes = Object.fromEntries(Object.entries(sets).map(([key, rows]) => [key, rows.map((path) => hash(path))]));
    if (JSON.stringify(sets.planned) !== JSON.stringify(sets.committed)
      || JSON.stringify(sets.planned) !== JSON.stringify(sets.visible_verified)) {
      const mismatch = new Error('最终知识文件集合不一致，禁止完成任务');
      mismatch.code = 'AUTHORITATIVE_MANIFEST_SET_MISMATCH'; mismatch.details = { path_set_hashes: pathSetHashes,
        missing_from_committed: sets.planned.filter((path) => !sets.committed.includes(path)).map(hash),
        missing_from_visible: sets.planned.filter((path) => !sets.visible_verified.includes(path)).map(hash) }; throw mismatch;
    }
    manifest.status = 'committed';
    manifest.authoritative_manifest_schema = 'eks/authoritative-visible-manifest/2.0';
    manifest.authoritative_manifest = verified.knowledge_records;
    manifest.path_sets = sets;
    manifest.path_set_hashes = pathSetHashes;
    await vault.write(manifestPath, JSON.stringify(manifest, null, 2));
    return { transactionId, manifestPath, manifest, index, verified };
  } catch (error) {
    manifest.status = 'recovering';
    manifest.error = String(error?.message || error);
    for (const step of manifest.steps.slice().reverse()) {
      try {
        if (step.prior_content === null) {
          const current = await vault.readIfExists(step.path);
          if (current !== null && hash(current) === step.content_hash) {
            await ensureParent(vault, joinPath(quarantine, step.path));
            await vault.rename(step.path, joinPath(quarantine, step.path));
          }
        } else {
          if (step.moved && step.from_path) {
            await ensureParent(vault, step.from_path);
            if (await vault.readIfExists(step.path) !== null) await vault.rename(step.path, step.from_path);
            await vault.write(step.from_path, step.prior_content);
          } else {
            await vault.write(step.path, step.prior_content);
          }
        }
        step.rollback_status = 'restored';
      } catch (rollbackError) {
        step.rollback_status = 'failed';
        step.rollback_error = String(rollbackError?.message || rollbackError);
      }
    }
    if (indexSaved) {
      try { await options.saveIndex(manifest.previous_index); manifest.index_rollback_status = 'restored'; }
      catch (indexError) {
        manifest.index_rollback_status = 'failed';
        manifest.index_rollback_error = String(indexError?.message || indexError);
      }
    }
    manifest.status = manifest.steps.every((step) => step.rollback_status === 'restored') ? 'rolled_back' : 'recovery_required';
    try { await vault.write(manifestPath, JSON.stringify(manifest, null, 2)); } catch (_) {}
    error.transactionManifest = manifest;
    throw error;
  } finally {
    release();
  }
}

async function rollbackTransaction(manifest, options) {
  if (!manifest || manifest.status !== 'committed') throw new Error('只能回滚已提交的结构化事务');
  const release = await options.lock.acquire('structured-writer');
  try {
    for (const step of (manifest.steps || []).slice().reverse()) {
      const current = await options.vault.readIfExists(step.path);
      if (current !== null && hash(current) !== step.content_hash) throw new Error(`文件已被后续修改，停止回滚：${step.path}`);
      if (step.prior_content === null) {
        const target = joinPath(options.stateRoot, 'structured-writer', 'quarantine', `rollback-${manifest.transaction_id}`, step.path);
        await ensureParent(options.vault, target);
        if (current !== null) await options.vault.rename(step.path, target);
      } else if (step.from_path && step.from_path !== step.path) {
        await ensureParent(options.vault, step.from_path);
        if (current !== null) await options.vault.rename(step.path, step.from_path);
        await options.vault.write(step.from_path, step.prior_content);
      } else {
        await options.vault.write(step.path, step.prior_content);
      }
    }
    if (typeof options.saveIndex === 'function' && manifest.previous_index) {
      await options.saveIndex(manifest.previous_index);
    }
    return { status: 'rolled_back', transaction_id: manifest.transaction_id };
  } finally {
    release();
  }
}

module.exports = {
  WRITER_VERSION, INDEX_VERSION, PLAN_LIMITS, MODES, RELATION_TYPES,
  stableJson, hash, stableId, pathSafe, normalizeSettings, sourceIdentity,
  candidateIdentity, emptyIndex, validateIndex, serializeRecord, resolveRelations,
  buildPlan, partitionPlan, commitPlan, rollbackTransaction, verifyCommittedRecords, coalesceCanonicalUnits, normalizeCanonicalPresentation
};
