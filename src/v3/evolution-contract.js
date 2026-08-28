// @ts-nocheck -- Runtime contract is exercised by the deterministic Phase 5 gate.
'use strict';

const { sha256 } = require('./contracts');

const EVOLUTION_SCHEMA = 'eks/v3/evolution-graph/1';
const FACT_SCHEMA = 'eks/v3/evolution-fact/1';
const MARKDOWN_SCHEMA = 'eks/v3/evolution-markdown/1';
const RELATION_TYPES = Object.freeze(['exact_duplicate', 'equivalent', 'related', 'contradicts', 'supersedes']);
const LIFECYCLES = Object.freeze(['current', 'historical', 'future', 'expired', 'undated', 'conflicted']);

function norm(value) { return String(value ?? '').normalize('NFKC').toLocaleLowerCase('en-US').replace(/[\s\p{P}\p{S}]+/gu, ' ').trim(); }
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  return typeof value === 'string' ? norm(value) : value;
}
function stable(prefix, value) { return `${prefix}-${sha256(JSON.stringify(canonical(value))).slice(0, 24)}`; }
function same(left, right) { return JSON.stringify(canonical(left)) === JSON.stringify(canonical(right)); }
function validDate(value) {
  if (value === undefined || value === null || value === '') return { value: null, malformed: false };
  const text = String(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return { value: null, malformed: true };
  const date = new Date(`${text}T00:00:00Z`);
  return Number.isFinite(date.valueOf()) && date.toISOString().slice(0, 10) === text ? { value: text, malformed: false } : { value: null, malformed: true };
}
function normalizeScope(scope) { return canonical(scope || { kind: 'general' }); }
function normalizeNumbers(values) {
  return (values || []).map((item) => typeof item === 'object' ? { value: String(item.value ?? ''), unit: norm(item.unit) } : { value: String(item), unit: '' })
    .sort((a, b) => `${a.value}|${a.unit}`.localeCompare(`${b.value}|${b.unit}`));
}
function semanticCore(unit, aliases = {}) {
  const alias = (kind, value) => {
    const key = norm(value); const table = aliases[kind] || {};
    for (const [canonicalName, names] of Object.entries(table)) if ([canonicalName, ...(names || [])].map(norm).includes(key)) return norm(canonicalName);
    return key;
  };
  return {
    semantic_type: norm(unit.semantic_type), subject: alias('subjects', unit.subject), entity: alias('entities', unit.entity),
    predicate: norm(unit.predicate), standard: alias('standards', unit.standard), clause: norm(unit.clause), scope: normalizeScope(unit.scope)
  };
}
function signature(unit) {
  return canonical({ predicate_signature: unit.predicate_signature || unit.signature || '', parameters: unit.parameters || {}, numbers: normalizeNumbers(unit.numbers) });
}
function validateEvidence(unit, documentMap) {
  if (!Array.isArray(unit.evidence) || !unit.evidence.length) throw new Error(`事实缺少证据：${unit.unit_id || 'unknown'}`);
  return unit.evidence.map((item) => {
    const document = documentMap.get(item.source_id); const block = document?.blocks?.find((entry) => entry.block_id === item.block_id);
    if (!document || !block || item.locator === undefined || String(item.raw_verbatim ?? '') !== String(block.raw_verbatim ?? block.text ?? '')) throw new Error(`证据身份、块、定位或原文不精确：${unit.unit_id || 'unknown'}`);
    const evidence = { evidence_id: item.evidence_id || stable('ev', { source_id: item.source_id, block_id: item.block_id, locator: item.locator, raw_verbatim: item.raw_verbatim }),
      source_id: String(item.source_id), block_id: String(item.block_id), locator: structuredClone(item.locator), raw_verbatim: String(item.raw_verbatim) };
    return evidence;
  });
}
function lifecycleFor(fact, asOf, diagnostics, conflicted = false) {
  if (conflicted) return 'conflicted';
  const effective = validDate(fact.effective_date); const expires = validDate(fact.expires_date);
  if (effective.malformed) diagnostics.push({ code: 'MALFORMED_EFFECTIVE_DATE', fact_id: fact.fact_id, value: String(fact.effective_date) });
  if (expires.malformed) diagnostics.push({ code: 'MALFORMED_EXPIRES_DATE', fact_id: fact.fact_id, value: String(fact.expires_date) });
  if (effective.malformed || expires.malformed) return 'undated';
  if (fact.superseded_by?.length) return 'historical';
  if (effective.value && effective.value > asOf) return 'future';
  if (expires.value && expires.value < asOf) return 'expired';
  return effective.value || expires.value ? 'current' : 'undated';
}
function relation(type, from, to, reason, origin = 'deterministic_rule', confidence = 1) {
  return { relation_id: stable('rel', { type, from: from.fact_id, to: to.fact_id, reason }), type, from_id: from.fact_id, target_id: to.fact_id,
    reason, confidence, origin, source_evidence: [...from.evidence, ...to.evidence].map((e) => ({ evidence_id: e.evidence_id, source_id: e.source_id, block_id: e.block_id, locator: structuredClone(e.locator) })) };
}
function buildEvolutionGraph(input, options = {}) {
  if (!input || !Array.isArray(input.documents) || !Array.isArray(input.units)) throw new Error('Phase 5 输入合同无效');
  const asOf = String(options.as_of || input.as_of || ''); if (!validDate(asOf).value) throw new Error('Phase 5 必须注入有效 as_of (YYYY-MM-DD)');
  const documents = new Map(input.documents.map((doc) => [String(doc.source_id), doc]));
  if (documents.size !== input.documents.length) throw new Error('来源 ID 重复');
  const diagnostics = []; const rawFacts = input.units.map((unit) => {
    const evidence = validateEvidence(unit, documents); const core = semanticCore(unit, input.aliases); const sig = signature(unit);
    const sourceIdentity = [...new Set(evidence.map((e) => e.source_id))].sort();
    const fact = { schema: FACT_SCHEMA, fact_id: '', unit_ids: [String(unit.unit_id)], title: String(unit.title || ''), body: String(unit.body || ''), semantic_type: String(unit.semantic_type || ''),
      subject: String(unit.subject || ''), entity: String(unit.entity || ''), predicate: String(unit.predicate || ''), predicate_signature: structuredClone(unit.predicate_signature || unit.signature || ''),
      parameters: structuredClone(unit.parameters || {}), numbers: structuredClone(unit.numbers || []), standard: String(unit.standard || ''), clause: String(unit.clause || ''), revision: String(unit.revision || ''), version: String(unit.version || ''), dates: structuredClone(unit.dates || []),
      effective_date: unit.effective_date == null ? '' : String(unit.effective_date), expires_date: unit.expires_date == null ? '' : String(unit.expires_date), scope: structuredClone(unit.scope || { kind: 'general' }),
      source_ids: sourceIdentity, evidence, core, signature: sig, explicit_replaces: structuredClone(unit.replaces || []), relations: [], superseded_by: [], diagnostics: [] };
    fact.fact_id = stable('fact', { core, signature: sig, revision: norm(unit.revision || unit.version), source_identity: sourceIdentity, evidence: evidence.map((e) => [e.evidence_id, e.block_id]) });
    return fact;
  });
  // Collapse only literal copies with identical semantic identity, signature, revision and scope. Preserve every evidence item and source.
  const facts = [];
  for (const item of rawFacts) {
    const rawKey = item.evidence.map((e) => norm(e.raw_verbatim)).sort();
    const existing = facts.find((prior) => same(prior.core, item.core) && same(prior.signature, item.signature) && norm(prior.revision || prior.version) === norm(item.revision || item.version)
      && same(prior.evidence.map((e) => norm(e.raw_verbatim)).sort(), rawKey));
    if (!existing) { facts.push(item); continue; }
    const oldId = existing.fact_id; existing.unit_ids.push(...item.unit_ids); existing.source_ids = [...new Set([...existing.source_ids, ...item.source_ids])].sort();
    existing.evidence = [...existing.evidence, ...item.evidence].filter((e, i, all) => all.findIndex((x) => x.evidence_id === e.evidence_id) === i);
    existing.fact_id = stable('fact', { core: existing.core, signature: existing.signature, revision: norm(existing.revision || existing.version), exact_verbatim: rawKey });
    existing.relations.push({ relation_id: stable('rel', { type: 'exact_duplicate', target: existing.fact_id, unit: item.unit_ids }), type: 'exact_duplicate', from_id: existing.fact_id, target_id: existing.fact_id,
      reason: 'identical normalized verbatim, semantic identity, signature, revision, and scope; evidence retained', confidence: 1, origin: 'deterministic_rule',
      source_evidence: existing.evidence.map((e) => ({ evidence_id: e.evidence_id, source_id: e.source_id, block_id: e.block_id, locator: structuredClone(e.locator) })), collapsed_fact_id: oldId } );
  }
  const pairs = facts.flatMap((fact) => fact.relations.filter((item) => item.type === 'exact_duplicate'));
  for (let i = 0; i < facts.length; i += 1) for (let j = i + 1; j < facts.length; j += 1) {
    const left = facts[i]; const right = facts[j]; if (!same(left.core.scope, right.core.scope)) continue;
    const sameCore = same(left.core, right.core); if (!sameCore) continue;
    const explicit = (from, to) => (from.explicit_replaces || []).some((value) => [to.fact_id, ...to.unit_ids, to.revision, to.version].map(norm).includes(norm(value)));
    const leftDate = validDate(left.effective_date); const rightDate = validDate(right.effective_date);
    const between = leftDate.value && rightDate.value && facts.some((candidate) => candidate !== left && candidate !== right && same(candidate.core, left.core)
      && validDate(candidate.effective_date).value > [leftDate.value, rightDate.value].sort()[0] && validDate(candidate.effective_date).value < [leftDate.value, rightDate.value].sort()[1]);
    const revisionOrdered = left.core.standard && left.core.clause && norm(left.revision || left.version) && norm(right.revision || right.version) && norm(left.revision || left.version) !== norm(right.revision || right.version) && leftDate.value && rightDate.value && leftDate.value !== rightDate.value && !between;
    let newer; let older;
    if (explicit(left, right)) { newer = left; older = right; }
    else if (explicit(right, left)) { newer = right; older = left; }
    else if (revisionOrdered) { [newer, older] = leftDate.value > rightDate.value ? [left, right] : [right, left]; }
    if (newer) { const rel = relation('supersedes', newer, older, explicit(newer, older) ? 'explicit replacement evidence names the replaced fact or revision' : 'same standard and clause, identical scope, distinct revisions, and unambiguous effective-date order'); newer.relations.push(rel); older.superseded_by.push(newer.fact_id); pairs.push(rel); continue; }
    if (between && left.core.standard && left.core.clause && norm(left.revision || left.version) && norm(right.revision || right.version)) continue;
    if (same(left.signature, right.signature)) { const cluster = stable('eq', { core: left.core, signature: left.signature, revision: norm(left.revision || left.version) || norm(right.revision || right.version) }); left.equivalence_cluster_id = cluster; right.equivalence_cluster_id = cluster;
      const rel = relation('equivalent', left, right, 'same normalized semantic identity and explicit fact signature with separate evidence'); left.relations.push(rel); right.relations.push(relation('equivalent', right, left, rel.reason)); pairs.push(rel); continue; }
    const hasComparableSignature = Boolean(norm(left.predicate_signature) || norm(right.predicate_signature) || left.numbers.length || right.numbers.length);
    const type = hasComparableSignature ? 'contradicts' : 'related'; const reason = type === 'contradicts' ? 'same semantic subject, predicate, clause, and scope but incompatible explicit signatures' : 'same semantic identity and scope without an equivalent signature';
    const rel = relation(type, left, right, reason); left.relations.push(rel); right.relations.push(relation(type, right, left, reason)); pairs.push(rel);
  }
  const ids = new Set(facts.map((fact) => fact.fact_id));
  for (const fact of facts) {
    fact.relations = fact.relations.filter((rel) => rel.type === 'exact_duplicate' || ids.has(rel.target_id)).sort((a, b) => a.relation_id.localeCompare(b.relation_id));
    const conflicted = fact.relations.some((rel) => rel.type === 'contradicts'); fact.lifecycle = lifecycleFor(fact, asOf, diagnostics, conflicted); fact.diagnostics = diagnostics.filter((d) => d.fact_id === fact.fact_id);
    delete fact.core; delete fact.signature; delete fact.explicit_replaces;
  }
  return { schema: EVOLUTION_SCHEMA, as_of: asOf, facts: facts.sort((a, b) => a.fact_id.localeCompare(b.fact_id)), relations: pairs.sort((a, b) => a.relation_id.localeCompare(b.relation_id)), diagnostics };
}

function base64(value) { return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url'); }
function renderEvolutionMarkdown(fact, graph) {
  if (!fact || fact.schema !== FACT_SCHEMA) throw new Error('Phase 5 事实合同无效');
  const payload = { ...fact, graph_schema: graph?.schema || EVOLUTION_SCHEMA, as_of: graph?.as_of || '' };
  return `---\neks_schema: ${MARKDOWN_SCHEMA}\nrecord_id: ${JSON.stringify(fact.fact_id)}\ntitle: ${JSON.stringify(fact.title)}\nsemantic_kind: ${JSON.stringify(fact.semantic_type)}\nlifecycle: ${fact.lifecycle}\nevolution_payload: base64url:${base64(payload)}\n---\n\n# ${fact.title}\n\n${fact.body}\n\n## Evidence\n\n${fact.evidence.map((e) => `Evidence-ID: ${e.evidence_id}\nBlock-ID: ${e.block_id}\nLocator-Data: base64url:${base64(e.locator)}\nRaw-Verbatim: base64url:${Buffer.from(e.raw_verbatim, 'utf8').toString('base64url')}`).join('\n\n')}\n\n## Typed relations\n\n${fact.relations.map((r) => `- ${r.type} -> ${r.target_id}: ${r.reason}`).join('\n') || '- none'}\n`;
}

module.exports = { EVOLUTION_SCHEMA, FACT_SCHEMA, LIFECYCLES, MARKDOWN_SCHEMA, RELATION_TYPES, buildEvolutionGraph, lifecycleFor, renderEvolutionMarkdown };
