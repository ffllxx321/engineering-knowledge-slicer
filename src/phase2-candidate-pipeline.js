'use strict';

/**
 * Phase 2 shadow candidate pipeline.
 * Pure computation only: no filesystem, vault, project-state, or release mutations.
 */

const crypto = require('crypto');
const {
  ACTIVE_TENDER_CATEGORIES,
  ACTIVE_TENDER_REFERENCE_CATEGORIES,
  BUSINESS_CATEGORIES,
  BUSINESS_ITEM_TYPES
} = require('./phase1-foundation.js');

const SCHEMA_VERSION = '2.0';
const LIBRARIES = Object.freeze(['active_tender', 'business']);
const ITEM_TYPES = Object.freeze(BUSINESS_ITEM_TYPES.map(({ key }) => key));
const CATEGORY_BY_LIBRARY = Object.freeze({
  active_tender: Object.freeze(
    [...ACTIVE_TENDER_CATEGORIES, ...ACTIVE_TENDER_REFERENCE_CATEGORIES].map(({ key }) => key)
  ),
  business: Object.freeze(BUSINESS_CATEGORIES.map(({ key }) => key))
});
const DOCUMENT_ROLES = Object.freeze([
  'source_record', 'instruction', 'submission', 'correspondence', 'meeting_record',
  'commercial_record', 'technical_record', 'contract_record', 'reference', 'unknown'
]);
const REVIEW_REASONS = Object.freeze([
  'ambiguous_project', 'ambiguous_category', 'conflicting_facts', 'missing_evidence',
  'unsupported_invented_facts', 'reuse_promotion'
]);
const DEFAULT_LIMITS = Object.freeze({
  max_blocks_per_batch: 12,
  max_extraction_requests: 8,
  max_text_per_block: 6000,
  max_evidence_text: 2000,
  max_items_per_batch: 40,
  max_reasons: 8,
  max_reason_text: 300
});

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function cleanText(value, max = 1000) {
  return typeof value === 'string' ? value.trim().replace(/\s+/g, ' ').slice(0, max) : '';
}

function verbatimText(value, max = 2000) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function normalizeIdentity(value) {
  return cleanText(value, 500).normalize('NFKC').toLocaleLowerCase()
    .replace(/[\s\-_.:/\\()[\]{}]+/g, '');
}

function stableId(prefix, parts) {
  const material = parts.map((part) => typeof part === 'string' ? part : JSON.stringify(part)).join('\u241f');
  return `${prefix}-${crypto.createHash('sha256').update(material).digest('hex').slice(0, 24)}`;
}

function uniqueTexts(value, maxItems, maxText) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((item) => cleanText(item, maxText)).filter(Boolean))].slice(0, maxItems);
}

function locatorKey(locator) {
  if (!isObject(locator)) return '';
  return `${cleanText(locator.scheme, 80)}:${cleanText(locator.value, 500)}`;
}

function normalizeLocator(locator) {
  if (!isObject(locator)) return null;
  const scheme = cleanText(locator.scheme, 80);
  const value = cleanText(locator.value, 500);
  if (!scheme || !value) return null;
  const output = { scheme, value };
  for (const key of ['page', 'sheet', 'range', 'row', 'message_id', 'attachment_id', 'heading_path']) {
    if (typeof locator[key] === 'number' && Number.isFinite(locator[key])) output[key] = locator[key];
    else if (typeof locator[key] === 'string' && locator[key].trim()) output[key] = cleanText(locator[key], 500);
    else if (Array.isArray(locator[key])) output[key] = uniqueTexts(locator[key], 20, 200);
  }
  return output;
}

function blockBoundary(block) {
  const locator = normalizeLocator(block && block.locator);
  const metadata = isObject(block && block.metadata) ? block.metadata : {};
  return {
    locator,
    locator_key: locatorKey(locator),
    table_row_id: cleanText(metadata.table_row_id || metadata.row_id, 200),
    email_message_id: cleanText(metadata.email_message_id || metadata.message_id, 300),
    explicit_same_item_id: cleanText(metadata.same_item_id, 200)
  };
}

function eligibleBlocks(blocks, limits = DEFAULT_LIMITS) {
  if (!Array.isArray(blocks)) return [];
  return blocks.filter((block) => {
    if (!isObject(block) || block.card_eligible !== true) return false;
    if (!isObject(block.parse) || block.parse.status !== 'present') return false;
    if (block.metadata && (block.metadata.noise === true || block.metadata.structural_noise === true)) return false;
    return Boolean(cleanText(block.raw && block.raw.text, limits.max_text_per_block));
  });
}

function normalizeRegistry(registry) {
  if (!Array.isArray(registry)) return [];
  return registry.map((entry) => {
    if (!isObject(entry)) return null;
    const projectId = cleanText(entry.project_id, 200);
    if (!projectId) return null;
    const identities = [
      entry.name,
      ...(Array.isArray(entry.aliases) ? entry.aliases : []),
      ...(Array.isArray(entry.references) ? entry.references : [])
    ].map(normalizeIdentity).filter(Boolean);
    return { project_id: projectId, identities: [...new Set(identities)] };
  }).filter(Boolean);
}

function explicitProjectEvidence(document, blocks) {
  const values = [];
  const metadata = isObject(document.metadata) ? document.metadata : {};
  for (const key of ['project_id', 'project_name', 'project_reference']) {
    if (metadata[key]) values.push({ value: metadata[key], source: `document.metadata.${key}` });
  }
  if (document.filename) {
    const filename = cleanText(document.filename, 500);
    values.push({ value: filename.replace(/\.[^.]+$/, ''), source: 'filename' });
    filename.replace(/\.[^.]+$/, '').split(/[\s\-_.:/\\()[\]{}]+/)
      .filter(Boolean).forEach((value) => values.push({ value, source: 'filename_token' }));
  }
  for (const block of blocks) {
    const meta = isObject(block.metadata) ? block.metadata : {};
    for (const key of ['project_id', 'project_name', 'project_reference']) {
      if (meta[key]) values.push({
        value: meta[key],
        source: `${cleanText(block.block_id, 100) || 'block'}.metadata.${key}`
      });
    }
  }
  return values.map((item) => ({ ...item, normalized: normalizeIdentity(item.value) }))
    .filter((item) => item.normalized);
}

function matchProjects(document, blocks, projectRegistry) {
  const registry = normalizeRegistry(projectRegistry);
  const evidence = explicitProjectEvidence(document, blocks);
  const matches = [];
  for (const project of registry) {
    const hits = evidence.filter(({ normalized }) =>
      project.identities.some((identity) => normalized === identity));
    if (hits.length) matches.push({ project_id: project.project_id, hits });
  }
  return matches;
}

function validCategory(library, category) {
  return LIBRARIES.includes(library) && CATEGORY_BY_LIBRARY[library].includes(category);
}

function localRoute(document, blocks, projectRegistry) {
  const metadata = isObject(document.metadata) ? document.metadata : {};
  const matches = matchProjects(document, blocks, projectRegistry);
  const route = {
    schema_version: SCHEMA_VERSION,
    source_document_id: cleanText(document.source_document_id, 200),
    confidence: 0,
    reasons: [],
    review_reasons: []
  };
  if (matches.length === 1) {
    route.project_id = matches[0].project_id;
    route.confidence = 1;
    route.reasons.push('项目仅由注入登记表中的精确名称、别名或编号证据匹配');
  } else if (matches.length > 1) {
    route.review_reasons.push('ambiguous_project');
    route.reasons.push('显式项目证据同时匹配多个登记项目');
  }
  const library = cleanText(metadata.library, 80);
  const category = cleanText(metadata.directory_category || metadata.category, 120);
  if (LIBRARIES.includes(library)) {
    route.library = library;
    route.confidence = Math.max(route.confidence, 1);
    route.reasons.push('采用来源适配器提供的显式库元数据');
  }
  if (route.library && validCategory(route.library, category)) {
    route.directory_category = category;
    route.reasons.push('采用 Phase 1 定义内的显式目录分类元数据');
  } else if (category) {
    route.review_reasons.push('ambiguous_category');
  }
  const role = cleanText(metadata.document_role, 120);
  if (DOCUMENT_ROLES.includes(role) && role !== 'unknown') {
    route.document_role = role;
    route.reasons.push('采用来源适配器提供的显式文档角色');
  }
  for (const field of ['supersedes_document_id', 'replaces_document_id', 'version_label']) {
    const value = cleanText(metadata[field], 300);
    if (value) route[field] = value;
  }
  route.resolved = Boolean(route.library && route.directory_category && route.document_role)
    && !route.review_reasons.length;
  return route;
}

function routingInput(document, blocks, registry) {
  return {
    source_document_id: cleanText(document.source_document_id, 200),
    filename: cleanText(document.filename || document.source_path, 500),
    source_type: cleanText(document.source_type, 100),
    metadata: isObject(document.metadata) ? document.metadata : {},
    project_registry: normalizeRegistry(registry),
    blocks: blocks.slice(0, 30).map((block) => ({
      block_id: cleanText(block.block_id, 100),
      kind: cleanText(block.kind, 100),
      locator: normalizeLocator(block.locator),
      heading: block.inferred && cleanText(block.inferred.heading, 500),
      metadata: isObject(block.metadata) ? block.metadata : {}
    })),
    allowed: { libraries: LIBRARIES, categories: CATEGORY_BY_LIBRARY, document_roles: DOCUMENT_ROLES }
  };
}

function normalizeRoute(raw, document, local, projectRegistry) {
  const candidate = isObject(raw) ? raw : {};
  const route = {
    schema_version: SCHEMA_VERSION,
    source_document_id: cleanText(document.source_document_id, 200),
    confidence: Math.max(0, Math.min(1, Number(candidate.confidence) || local.confidence || 0)),
    reasons: uniqueTexts([...(local.reasons || []), ...(candidate.reasons || [])],
      DEFAULT_LIMITS.max_reasons, DEFAULT_LIMITS.max_reason_text),
    review_reasons: uniqueTexts(local.review_reasons, 8, 80)
  };
  const registryIds = new Set(normalizeRegistry(projectRegistry).map(({ project_id }) => project_id));
  const proposedProject = cleanText(candidate.project_id || local.project_id, 200);
  const evidencedProjectIds = new Set(
    matchProjects(document, Array.isArray(document.blocks) ? document.blocks : [], projectRegistry)
      .map(({ project_id }) => project_id)
  );
  if (proposedProject && registryIds.has(proposedProject) && evidencedProjectIds.has(proposedProject)) {
    route.project_id = proposedProject;
  }
  else if (proposedProject) route.review_reasons.push('unsupported_invented_facts');
  const library = cleanText(candidate.library || local.library, 80);
  if (LIBRARIES.includes(library)) route.library = library;
  const category = cleanText(candidate.directory_category || local.directory_category, 120);
  if (route.library && validCategory(route.library, category)) route.directory_category = category;
  else if (category) route.review_reasons.push('ambiguous_category');
  const role = cleanText(candidate.document_role || local.document_role, 120);
  route.document_role = DOCUMENT_ROLES.includes(role) ? role : 'unknown';
  for (const field of ['supersedes_document_id', 'replaces_document_id', 'version_label']) {
    const value = cleanText(candidate[field] || local[field], 300);
    if (value) route[field] = value;
  }
  route.review_reasons = [...new Set(route.review_reasons)];
  route.resolved = Boolean(route.library && route.directory_category && route.document_role !== 'unknown')
    && !route.review_reasons.length;
  return route;
}

function extractionInput(document, route, batch, limits) {
  return {
    source_document_id: cleanText(document.source_document_id, 200),
    route: {
      project_id: route.project_id,
      library: route.library,
      directory_category: route.directory_category,
      document_role: route.document_role
    },
    allowed_item_types: ITEM_TYPES,
    blocks: batch.map((block) => ({
      block_id: cleanText(block.block_id, 100),
      kind: cleanText(block.kind, 100),
      locator: normalizeLocator(block.locator),
      provenance: Array.isArray(block.provenance)
        ? block.provenance.map(normalizeLocator).filter(Boolean).slice(0, 20) : [],
      boundary: blockBoundary(block),
      text: cleanText(block.raw && block.raw.text, limits.max_text_per_block),
      fields: isObject(block.raw && block.raw.fields) ? block.raw.fields : {},
      inferred: isObject(block.inferred) ? block.inferred : {},
      metadata: isObject(block.metadata) ? block.metadata : {}
    }))
  };
}

function evidenceWithinBlock(evidence, sourceBlock, limits) {
  const text = verbatimText(evidence && evidence.verbatim, limits.max_evidence_text);
  const sourceText = verbatimText(
    sourceBlock.text || (sourceBlock.raw && sourceBlock.raw.text),
    limits.max_text_per_block
  );
  return Boolean(text && sourceText.includes(text));
}

function normalizeFacts(value) {
  if (!isObject(value)) return undefined;
  const output = {};
  for (const key of ['actors', 'status', 'dates', 'units', 'numbers', 'modality']) {
    const values = uniqueTexts(Array.isArray(value[key]) ? value[key] : [value[key]], 20, 300);
    if (values.length) output[key] = values;
  }
  return Object.keys(output).length ? output : undefined;
}

function validateCandidate(raw, context, index, limits) {
  if (!isObject(raw)) return { error: '候选不是对象' };
  const itemType = cleanText(raw.item_type, 80);
  if (!ITEM_TYPES.includes(itemType)) return { error: '业务条目类型不在 Phase 1 定义中' };
  const blockId = cleanText(raw.block_id || (raw.evidence && raw.evidence.block_id), 100);
  const sourceBlock = context.blocks.find((block) => block.block_id === blockId);
  if (!sourceBlock) return { error: '证据块不在当前批次' };
  if (!normalizeLocator(sourceBlock.locator)) return { error: '证据块缺少有效定位' };
  if (!evidenceWithinBlock(raw.evidence, sourceBlock, limits)) return { error: '逐字证据不在指定块中' };
  const boundary = blockBoundary(sourceBlock);
  const verbatim = verbatimText(raw.evidence.verbatim, limits.max_evidence_text);
  const applicableConditions = uniqueTexts(raw.applicable_conditions, 20, 500);
  const candidate = {
    schema_version: SCHEMA_VERSION,
    candidate_id: stableId('bic', [
      context.source_document_id, blockId, boundary.locator_key, itemType,
      normalizeIdentity(verbatim), applicableConditions
    ]),
    source_document_id: context.source_document_id,
    item_type: itemType,
    summary: cleanText(raw.summary, 1000) || verbatim,
    evidence: {
      block_id: blockId,
      locator: boundary.locator,
      provenance: Array.isArray(sourceBlock.provenance)
        ? sourceBlock.provenance.map(normalizeLocator).filter(Boolean).slice(0, 20) : [],
      verbatim
    },
    applicable_conditions: applicableConditions,
    reusable_knowledge_candidate: raw.reusable_knowledge_candidate === true,
    reuse_reasons: uniqueTexts(raw.reuse_reasons, 5, 300),
    review_reasons: []
  };
  if (context.route.project_id) candidate.project_id = context.route.project_id;
  if (context.route.directory_category) candidate.directory_category = context.route.directory_category;
  const facts = normalizeFacts(raw.facts);
  if (facts) candidate.facts = facts;
  if (candidate.reusable_knowledge_candidate) candidate.review_reasons.push('reuse_promotion');
  if (raw.project_id && raw.project_id !== candidate.project_id) {
    candidate.review_reasons.push('unsupported_invented_facts');
  }
  if (raw.directory_category && raw.directory_category !== candidate.directory_category) {
    candidate.review_reasons.push('unsupported_invented_facts');
  }
  candidate._boundary = boundary;
  candidate._index = index;
  return { candidate };
}

function validateBatch(raw, context, limits) {
  if (!isObject(raw) || !Array.isArray(raw.items) || raw.items.length > limits.max_items_per_batch) {
    return { valid: false, errors: ['批次必须包含有界 items 数组'], candidates: [] };
  }
  const candidates = [];
  const errors = [];
  raw.items.forEach((item, index) => {
    const result = validateCandidate(item, context, index, limits);
    if (result.error) errors.push(`items[${index}]: ${result.error}`);
    else candidates.push(result.candidate);
  });
  return { valid: errors.length === 0, errors, candidates };
}

function sameBoundary(a, b) {
  if (a._boundary.explicit_same_item_id && b._boundary.explicit_same_item_id) {
    return a._boundary.explicit_same_item_id === b._boundary.explicit_same_item_id;
  }
  if (a._boundary.table_row_id || b._boundary.table_row_id) {
    return a._boundary.table_row_id === b._boundary.table_row_id && a._boundary.locator_key === b._boundary.locator_key;
  }
  if (a._boundary.email_message_id || b._boundary.email_message_id) {
    return a._boundary.email_message_id === b._boundary.email_message_id;
  }
  return a.evidence.block_id === b.evidence.block_id;
}

function conflictSignature(candidate) {
  const facts = candidate.facts || {};
  return JSON.stringify({
    numbers: facts.numbers || [], dates: facts.dates || [], units: facts.units || [],
    modality: facts.modality || [], conditions: candidate.applicable_conditions || [],
    item_type: candidate.item_type
  });
}

function consolidateCandidates(candidates) {
  const output = [];
  for (const candidate of candidates) {
    const contentKey = normalizeIdentity(candidate.evidence.verbatim || candidate.summary);
    const existing = output.find((item) =>
      item.source_document_id === candidate.source_document_id
      && item.item_type === candidate.item_type
      && sameBoundary(item, candidate)
      && normalizeIdentity(item.evidence.verbatim || item.summary) === contentKey
      && conflictSignature(item) === conflictSignature(candidate));
    if (!existing) {
      output.push(candidate);
      continue;
    }
    existing.reuse_reasons = [...new Set([...existing.reuse_reasons, ...candidate.reuse_reasons])];
    existing.review_reasons = [...new Set([...existing.review_reasons, ...candidate.review_reasons])];
  }
  const groups = new Map();
  for (const candidate of output) {
    const key = `${candidate.source_document_id}|${candidate.item_type}|${normalizeIdentity(candidate.summary)}`;
    const group = groups.get(key) || [];
    group.push(candidate);
    groups.set(key, group);
  }
  for (const group of groups.values()) {
    if (group.length > 1 && new Set(group.map(conflictSignature)).size > 1) {
      group.forEach((candidate) => candidate.review_reasons.push('conflicting_facts'));
    }
  }
  return output.map((candidate) => {
    const clean = { ...candidate, review_reasons: [...new Set(candidate.review_reasons)] };
    delete clean._boundary;
    delete clean._index;
    return clean;
  });
}

function buildReviewSummary(route, candidates, extraReviewReasons = []) {
  const lines = [];
  const reviewItems = candidates.filter((item) => item.review_reasons.length);
  lines.push(`发现 ${candidates.length} 条可审阅业务候选。`);
  if (route.project_id) lines.push(`文档关联到登记项目“${route.project_id}”。`);
  else lines.push('项目关联尚未确定。');
  if (route.library && route.directory_category) {
    lines.push(`建议目录为 ${route.library} / ${route.directory_category}。`);
  } else {
    lines.push('建议目录尚未确定。');
  }
  for (const item of candidates.slice(0, 8)) {
    const place = item.evidence.locator
      ? `${item.evidence.locator.scheme} ${item.evidence.locator.value}` : `块 ${item.evidence.block_id}`;
    lines.push(`- ${item.summary}（来源：${place}）`);
  }
  const reasons = new Set([
    ...route.review_reasons,
    ...reviewItems.flatMap((item) => item.review_reasons),
    ...extraReviewReasons
  ]);
  if (reasons.size) {
    const labels = {
      ambiguous_project: '项目证据有歧义',
      ambiguous_category: '目录判断有歧义',
      conflicting_facts: '数字、日期、单位、语气或适用条件存在冲突',
      missing_evidence: '缺少可核对的原文证据',
      unsupported_invented_facts: '候选包含来源不支持的补充事实',
      reuse_promotion: '标记为可复用知识仍需人工批准'
    };
    lines.push(`需要复核：${[...reasons].map((reason) => labels[reason]).filter(Boolean).join('；')}。`);
  } else {
    lines.push('当前候选没有触发人工复核条件。');
  }
  lines.push('可选操作：确认候选；修改项目或目录；退回并保留来源不入库。');
  return lines.join('\n');
}

async function callJson(requestJson, request, counters, kind) {
  counters.total_provider_requests += 1;
  counters[`${kind}_requests`] += 1;
  return requestJson(request);
}

async function runPhase2CandidatePipeline(options = {}) {
  const document = isObject(options.document) ? options.document : {};
  const limits = {
    ...DEFAULT_LIMITS,
    ...(isObject(options.limits) ? options.limits : {})
  };
  limits.max_blocks_per_batch = Math.max(1, Math.min(50, Number(limits.max_blocks_per_batch) || 12));
  limits.max_extraction_requests = Math.max(0, Math.min(100, Number(limits.max_extraction_requests) || 0));
  const requestJson = typeof options.requestJson === 'function' ? options.requestJson : null;
  const counters = {
    routing_requests: 0,
    extraction_requests: 0,
    repair_requests: 0,
    total_provider_requests: 0,
    eligible_blocks: 0,
    skipped_blocks: 0,
    planned_batches: 0,
    processed_batches: 0
  };
  const blocks = Array.isArray(document.blocks) ? document.blocks : [];
  const eligible = eligibleBlocks(blocks, limits);
  counters.eligible_blocks = eligible.length;
  counters.skipped_blocks = blocks.length - eligible.length;
  const local = localRoute(document, blocks, options.projectRegistry);
  let route = normalizeRoute({}, document, local, options.projectRegistry);
  if (requestJson && !local.resolved) {
    const rawRoute = await callJson(requestJson, {
      kind: 'phase2_document_route',
      prompt: 'phase2/document-router-v1',
      input: routingInput(document, blocks, options.projectRegistry)
    }, counters, 'routing');
    route = normalizeRoute(rawRoute, document, local, options.projectRegistry);
  }
  const batches = [];
  for (let index = 0; index < eligible.length; index += limits.max_blocks_per_batch) {
    batches.push(eligible.slice(index, index + limits.max_blocks_per_batch));
  }
  counters.planned_batches = batches.length;
  const allCandidates = [];
  const diagnostics = [];
  if (requestJson) {
    const startBatch = Math.max(0, Number(options.resumeFromBatch) || 0);
    const allowedBatches = Math.min(batches.length - startBatch, limits.max_extraction_requests);
    for (let offset = 0; offset < allowedBatches; offset += 1) {
      const batchIndex = startBatch + offset;
      const input = extractionInput(document, route, batches[batchIndex], limits);
      let raw = await callJson(requestJson, {
        kind: 'phase2_business_item_extract',
        prompt: 'phase2/business-item-extractor-v1',
        batch_index: batchIndex,
        input
      }, counters, 'extraction');
      let checked = validateBatch(raw, { ...input, route }, limits);
      if (!checked.valid) {
        diagnostics.push({ batch_index: batchIndex, errors: checked.errors });
        raw = await callJson(requestJson, {
          kind: 'phase2_quality_repair',
          prompt: 'phase2/quality-repair-v1',
          batch_index: batchIndex,
          invalid_output: raw,
          validation_errors: checked.errors,
          input
        }, counters, 'repair');
        checked = validateBatch(raw, { ...input, route }, limits);
      }
      if (checked.valid) allCandidates.push(...checked.candidates);
      else diagnostics.push({ batch_index: batchIndex, errors: checked.errors, repair_failed: true });
      counters.processed_batches += 1;
    }
  }
  const candidates = consolidateCandidates(allCandidates);
  const diagnosticReviewReasons = [];
  for (const diagnostic of diagnostics) {
    const joined = (diagnostic.errors || []).join(' ');
    if (joined.includes('证据')) diagnosticReviewReasons.push('missing_evidence');
    if (joined.includes('类型') || joined.includes('批次')) {
      diagnosticReviewReasons.push('unsupported_invented_facts');
    }
  }
  return {
    schema_version: SCHEMA_VERSION,
    mode: 'shadow_candidate',
    provider_enabled: Boolean(requestJson),
    writes_performed: 0,
    deletes_performed: 0,
    state_transitions_performed: 0,
    route,
    business_item_batch: {
      schema_version: SCHEMA_VERSION,
      batch_id: stableId('bib', [cleanText(document.source_document_id, 200), candidates.map((item) => item.candidate_id)]),
      source_document_id: cleanText(document.source_document_id, 200),
      items: candidates
    },
    review_summary: buildReviewSummary(route, candidates, [...new Set(diagnosticReviewReasons)]),
    counters,
    diagnostics
  };
}

module.exports = {
  SCHEMA_VERSION,
  LIBRARIES,
  ITEM_TYPES,
  CATEGORY_BY_LIBRARY,
  DOCUMENT_ROLES,
  REVIEW_REASONS,
  DEFAULT_LIMITS,
  normalizeIdentity,
  normalizeLocator,
  eligibleBlocks,
  localRoute,
  normalizeRoute,
  validateBatch,
  consolidateCandidates,
  buildReviewSummary,
  runPhase2CandidatePipeline
};
