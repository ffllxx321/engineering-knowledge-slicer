'use strict';

/**
 * Phase 2/3 controlled structured writer.
 * All planning is deterministic and local. Vault mutation is isolated in
 * commitPlan/rollbackTransaction and guarded by an injected adapter.
 */
const crypto = require('crypto');
const {
  ACTIVE_TENDER_CATEGORIES,
  BUSINESS_CATEGORIES,
  validateRecord,
  validateProjectTransition
} = require('./phase1-foundation.js');

const WRITER_VERSION = '1.0';
const INDEX_VERSION = '1.0';
const PLAN_LIMITS = Object.freeze({ max_records: 250, max_actions: 600, max_links_per_record: 40 });
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

function normalizeSettings(settings = {}) {
  const mode = MODES.includes(settings.structuredWriterMode) ? settings.structuredWriterMode : 'legacy';
  const enabled = settings.controlledWriterEnabled === true;
  return {
    enabled,
    mode: enabled ? mode : 'legacy',
    activeRoot: clean(settings.structuredActiveRoot || '在办投标库', 400),
    businessRoot: clean(settings.structuredBusinessRoot || '长期业务库', 400),
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
  // Generated filenames are globally unique stable IDs. Basename links survive
  // archive moves without rewriting user-facing titles or depending on aliases.
  return `[[${relation.target_id}|${relation.target_title || relation.target_id}]]`;
}

function humanLocator(locator = {}) {
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

function serializeRecord(record) {
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
    `aliases: ${yamlArray([record.title])}`,
    `library: ${yamlScalar(record.library)}`,
    `created_at: ${yamlScalar(record.created_at)}`,
    `updated_at: ${yamlScalar(record.updated_at)}`
  ];
  for (const key of ['state', 'archive_outcome', 'source_path', 'source_hash', 'source_version', 'media_type', 'category', 'item_type', 'reuse_status']) {
    if (record[key]) frontmatter.push(`${key}: ${yamlScalar(record[key])}`);
  }
  if (record.semantic_kind) frontmatter.push(`semantic_kind: ${yamlScalar(record.semantic_kind)}`);
  if (record.source_language) frontmatter.push(`source_language: ${yamlScalar(record.source_language)}`);
  frontmatter.push(`output_language: ${yamlScalar(record.output_language || 'zh-CN')}`);
  if (record.tags?.length) frontmatter.push(`tags: ${yamlArray(record.tags)}`);
  for (const key of ['project_ids', 'source_document_ids', 'business_item_ids', 'company_knowledge_ids']) {
    if (record[key]?.length) frontmatter.push(`${key}: ${yamlArray(record[key])}`);
  }
  frontmatter.push('---', '', `# ${record.title}`, '');
  const body = [];
  if (record.summary) body.push('## 内容', '', record.summary, '');
  if (record.evidence?.verbatim) {
    body.push('## 来源证据（原文）', '', `> ${clean(record.evidence.verbatim, 4000).replace(/\n/g, '\n> ')}`, '',
      `定位：${humanLocator(record.evidence.locator || {})}`, '');
    if (record.evidence_translation && record.evidence_translation !== record.evidence.verbatim) {
      body.push('### 证据中文译文', '', `> ${clean(record.evidence_translation, 4000).replace(/\n/g, '\n> ')}`, '');
    }
  }
  if (relations.length) body.push('## 关系', '', ...relations.map((relation) =>
    `- ${relation.type}：${relationLink(relation)}`), '');
  if (record.unresolved_relations?.length) body.push('## 待处理关系', '',
    ...record.unresolved_relations.map((item) =>
      `- ${item.type || 'related'}：${item.source_candidate || '未命名'}（${item.reason}；定位 ${stableJson(item.evidence_locator || {})}）`), '');
  body.push('## 追溯', '', `- 记录编号：${record.record_id}`);
  if (record.owner_source_id) body.push(`- 归属来源：${record.owner_source_id}`);
  if (record.source_hash) body.push(`- 来源哈希：${record.source_hash}`);
  return `${frontmatter.concat(body).join('\n')}\n`;
}

function routeRecord(record, route, registryEntry, settings) {
  const categoryValue = record.category || route.directory_category;
  if (!categoryValue) throw new Error('结构化路由分类未确定，禁止使用默认目录');
  const category = safeSegment(categoryValue);
  if (record.library === 'active_tender') {
    if (!registryEntry) throw new Error('在办库记录缺少唯一项目登记');
    return joinPath(settings.activeRoot, safeSegment(registryEntry.project_id), category,
      KIND_FOLDER[record.record_kind], `${record.record_id}.md`);
  }
  return joinPath(settings.businessRoot, category, KIND_FOLDER[record.record_kind], `${record.record_id}.md`);
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
  const now = clean(input.logicalTime || document.ingested_at || '1970-01-01T00:00:00.000Z', 80);
  const sourceId = stableId('source_document', sourceIdentity(document));
  const sourceHash = clean(document.source_hash, 128);
  const source = {
    schema_version: '1.0', record_kind: 'source_document', record_id: sourceId,
    title: clean(document.title || document.filename || '来源文档', 300),
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
  if (records.length > settings.limits.max_records) throw new Error('结构化记录数量超过安全上限');
  return { records, registry, route, sourceId };
}

function buildCanonicalRecords(input, settings) {
  const result = input.universalResult;
  const document = result.document || input.document || {};
  const units = (result.knowledge_units || []).filter((unit) =>
    !(result.review_decisions || []).some((review) => review.unit_ids?.includes(unit.unit_id)));
  const now = clean(input.logicalTime || document.ingested_at || '1970-01-01T00:00:00.000Z', 80);
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
    title: clean(document.title || '来源文档', 300), library: sourceLibrary,
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
  for (const unit of units) {
    const recordKind = unit.route.library === 'business' && unit.reusable === true
      ? 'company_knowledge' : 'business_item';
    const recordId = stableId(recordKind, `${sourceId}:unit:${unit.fingerprint || unit.unit_id}`);
    unitToRecord.set(unit.unit_id, recordId);
    records.push({
      schema_version: '1.0', record_kind: recordKind, record_id: recordId,
      title: clean(unit.title, 160) || '知识单元', library: unit.route.library,
      created_at: now, updated_at: now, category: unit.route.category,
      item_type: recordKind === 'business_item' ? unit.semantic_kind : undefined,
      reuse_status: recordKind === 'company_knowledge' ? 'auto_supported' : undefined,
      summary: clean(unit.statement, 8000), evidence: unit.evidence?.[0],
      evidence_translation: unit.source_language === 'zh' ? '' : clean(unit.translated_statement, 8000),
      evidence_list: unit.evidence, tags: unit.tags, semantic_kind: unit.semantic_kind,
      source_language: unit.source_language, output_language: unit.output_language || 'zh-CN',
      original_statement: unit.original_statement, translated_statement: unit.translated_statement,
      translation: unit.translation,
      conditions: unit.applicable_conditions, exceptions: unit.exceptions,
      structured_facts: unit.structured_facts, confidence: unit.confidence,
      uncertainty: unit.uncertainty, owner_source_id: sourceId,
      source_document_ids: [sourceId], project_ids: project ? [project.record_id] : [],
      requested_relations: [{ type: 'derived_from', target_id: sourceId }]
    });
  }
  for (const relation of result.relations || []) {
    const from = records.find((record) => record.record_id === unitToRecord.get(relation.from_unit_id));
    const toId = unitToRecord.get(relation.to_unit_id);
    if (!from || !toId) continue;
    from.requested_relations.push({ type: relation.type, target_id: toId, evidence_locator: relation.evidence });
    const to = records.find((record) => record.record_id === toId);
    if (to) to.requested_relations.push({ type: relation.type, target_id: from.record_id, evidence_locator: relation.evidence });
  }
  if (records.length > settings.limits.max_records) throw new Error('结构化记录数量超过安全上限');
  return {
    records, registry, sourceId,
    route: { library: sourceLibrary, directory_category: source.category },
    reviewDecisions: result.review_decisions || []
  };
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
  for (const record of records) {
    record.path = routeRecord(record, { ...route, directory_category: record.category || route.directory_category }, registry, settings);
    const existingIndex = index.records?.[record.record_id];
    if (existingIndex && existingIndex.path !== record.path && input.archiveTransition !== true) {
      record.path = existingIndex.path; // rename/title changes never move identity
    }
  }
  const reviewGroups = resolveRelations(records, index, settings.limits);
  const byPath = input.existingFiles || {};
  const actions = [];
  for (const record of records.sort((a, b) => a.record_id.localeCompare(b.record_id))) {
    const indexed = index.records?.[record.record_id];
    const occupied = byPath[record.path];
    if (indexed && indexed.path !== record.path && byPath[indexed.path] !== undefined) {
      conflicts.push({ cause: 'same_id_multiple_paths', record_id: record.record_id, paths: uniq([indexed.path, record.path]) });
      continue;
    }
    if (occupied !== undefined) {
      const occupiedId = clean((occupied.match(/^record_id:\s*["']?([^"'\n]+)/m) || [])[1], 300);
      if (occupiedId && occupiedId !== record.record_id) {
        conflicts.push({ cause: 'path_occupied_by_different_id', path: record.path, record_id: record.record_id, occupied_id: occupiedId });
        continue;
      }
    }
    const content = serializeRecord(record);
    const contentHash = hash(content);
    const prior = byPath[record.path];
    const priorHash = prior === undefined ? null : hash(prior);
    const indexedHash = indexed?.content_hash || null;
    if (prior !== undefined && indexedHash && priorHash !== indexedHash) {
      conflicts.push({ cause: 'optimistic_hash_mismatch', record_id: record.record_id, path: record.path, expected: indexedHash, actual: priorHash });
      continue;
    }
    const action = priorHash === contentHash ? 'noop' : prior === undefined ? 'create' : 'update';
    actions.push({
      action, record_id: record.record_id, record_kind: record.record_kind, path: record.path,
      content, content_hash: contentHash, prior_hash: priorHash, prior_content: prior,
      owner_source_id: sourceId, source_hash: clean(input.document?.source_hash, 128),
      source_version: clean(input.document?.source_version || input.document?.metadata?.version_label, 100)
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
    }
  }
  if (actions.length > settings.limits.max_actions) throw new Error('写入计划超过安全上限');
  const counts = {};
  for (const action of actions) counts[action.action] = (counts[action.action] || 0) + 1;
  const universalMode = Boolean(input.universalResult?.knowledge_units);
  const phase3HandlingGroups = universalMode ? reviewDecisions
    : [...(input.phase3Result?.handling_groups || []), ...reviewDecisions];
  const blocked = conflicts.length > 0 || reviewGroups.length > 0 || phase3HandlingGroups.length > 0;
  const planCore = {
    version: WRITER_VERSION, mode: settings.mode, source_document_id: sourceId,
    generator: 'structured-writer', actions, conflicts, review_groups: reviewGroups,
    phase3_handling_groups: phase3HandlingGroups, counts,
    source_hash: clean(input.document?.source_hash, 128),
    source_version: clean(input.document?.source_version || input.document?.metadata?.version_label, 100),
    index_revision: Number(index.revision || 0), blocked,
    writes_performed: 0
  };
  planCore.plan_id = `plan-${hash({ ...planCore, actions: actions.map(({ prior_content, ...item }) => item) }).slice(0, 24)}`;
  planCore.summary = `新建 ${counts.create || 0}，更新 ${counts.update || 0}，不变 ${counts.noop || 0}，移动 ${counts.move || 0}，需要处理 ${conflicts.length + reviewGroups.length + planCore.phase3_handling_groups.length}。`;
  return planCore;
}

async function ensureParent(vault, path) {
  const parent = path.split('/').slice(0, -1).join('/');
  if (parent) await vault.mkdirp(parent);
}

async function commitPlan(plan, options) {
  if (!plan || plan.mode !== 'structured-write') throw new Error('只有 structured-write 计划可提交');
  if (plan.blocked) throw new Error('计划包含冲突或待处理项，禁止提交');
  const vault = options.vault;
  const release = await options.lock.acquire('structured-writer');
  const transactionId = `txn-${hash([plan.plan_id, options.logicalTime || '']).slice(0, 24)}`;
  const quarantine = joinPath(options.stateRoot, 'structured-writer', 'quarantine', transactionId);
  const manifestPath = joinPath(options.stateRoot, 'structured-writer', 'transactions', `${transactionId}.json`);
  const manifest = {
    version: WRITER_VERSION, transaction_id: transactionId, plan_id: plan.plan_id,
    source_document_id: plan.source_document_id, status: 'staging', steps: [], created_at: options.logicalTime || ''
  };
  manifest.previous_index = JSON.parse(JSON.stringify(options.index || emptyIndex()));
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
    manifest.status = 'committed';
    manifest.index_revision = index.revision;
    await vault.write(manifestPath, JSON.stringify(manifest, null, 2));
    return { transactionId, manifestPath, manifest, index };
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
  buildPlan, commitPlan, rollbackTransaction
};
