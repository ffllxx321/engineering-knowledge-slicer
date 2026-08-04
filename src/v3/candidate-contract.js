// @ts-nocheck -- Runtime validation is covered by the v3 Phase 2 contract gate.
'use strict';

const { detectLanguages, sha256 } = require('./contracts');

const CANDIDATE_SCHEMA = 'eks/v3/candidate/1';
const ARTIFACT_SCHEMA = 'eks/v3/candidate-artifact/1';
const PROMPT_VERSION = 'eks-v3-candidate-prompt/1';
const KINDS = Object.freeze(['requirement', 'procedure', 'acceptance', 'risk', 'method', 'definition', 'reference', 'lesson']);
const SCOPES = Object.freeze(['project', 'trade', 'organization', 'general']);
const TRANSLATION = Object.freeze(['original_zh', 'translated', 'uncertain_literal', 'mixed_normalized']);

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  return value;
}
function stableCandidateId(candidate) {
  const identity = canonical({ source_sha256: candidate.source?.sha256, block_ids: [...(candidate.evidence || [])].map((e) => e.block_id).sort(),
    title_zh: candidate.title_zh, body_zh: candidate.body_zh, facts: candidate.facts || [] });
  return `cand-${sha256(JSON.stringify(identity)).slice(0, 24)}`;
}
function extractFacts(text) {
  const value = String(text || ''); const facts = [];
  const patterns = [
    ['number_unit', /(?:\d+(?:\.\d+)?|[一二三四五六七八九十百千万]+)\s*(?:mm|cm|m|km|kg|t|MPa|kPa|℃|°C|%|天|日|小时|h|层|次)/giu],
    ['date', /\b\d{4}[-/.年]\d{1,2}[-/.月]\d{1,2}日?\b/gu],
    ['version', /\b(?:v|version)\s*\d+(?:\.\d+){1,3}\b/giu],
    ['standard_clause', /(?:GB|JGJ|ISO|EN|ASTM)\s*[A-Z0-9./-]+(?:\s*第?\d+(?:\.\d+)*条)?/giu]
  ];
  for (const [type, regex] of patterns) for (const match of value.match(regex) || []) facts.push({ type, value: match.trim() });
  return facts.filter((item, index) => facts.findIndex((other) => other.type === item.type && other.value === item.value) === index);
}
function factSignature(facts) { return JSON.stringify((facts || []).map((f) => `${f.type}:${f.value}`).sort()); }
function validateCandidate(candidate, source, blockMap) {
  if (!candidate || candidate.schema !== CANDIDATE_SCHEMA || !KINDS.includes(candidate.knowledge_kind) || !SCOPES.includes(candidate.reusable_scope)) throw new Error('候选合同无效');
  if (!String(candidate.title_zh || '').trim() || !String(candidate.body_zh || '').trim() || !/[\u3400-\u9fff]/u.test(`${candidate.title_zh}${candidate.body_zh}`)) throw new Error('候选标题和正文必须为中文');
  if (candidate.source?.sha256 !== source.sha256 || candidate.source?.path !== source.path) throw new Error('候选来源绑定不匹配');
  if (!Array.isArray(candidate.evidence) || !candidate.evidence.length) throw new Error('缺少原文证据');
  for (const evidence of candidate.evidence) {
    const block = blockMap.get(evidence.block_id);
    if (!block || JSON.stringify(block.locator) !== JSON.stringify(evidence.locator) || !String(evidence.original || '').trim() || !block.content.includes(evidence.original)) throw new Error('证据不存在或定位不准确');
  }
  if (!TRANSLATION.includes(candidate.translation_status) || !Array.isArray(candidate.source_language) || !candidate.source_language.length) throw new Error('翻译状态无效');
  for (const key of ['evidence', 'completeness', 'translation']) if (!(Number(candidate.confidence?.[key]) >= 0 && Number(candidate.confidence[key]) <= 1)) throw new Error('置信度无效');
  const originalFacts = extractFacts(candidate.evidence.map((item) => item.original).join('\n'));
  if (factSignature(candidate.facts) !== factSignature(originalFacts)) throw new Error('数字、单位、日期、版本或标准条款发生漂移');
  candidate.id = stableCandidateId(candidate);
  if ('final_folder_path' in candidate || 'approval' in candidate || 'backlinks' in candidate) throw new Error('候选包含越界字段');
  return candidate;
}

function normalizeProposal(raw, source, blocks) {
  const evidence = (raw.block_ids || []).map((id) => blocks.get(id)).filter(Boolean).map((block) => ({ block_id: block.id, locator: block.locator,
    original: String(raw.evidence?.[block.id] || block.content).slice(0, 500) }));
  const languages = [...new Set(evidence.flatMap((item) => detectLanguages(item.original)))];
  const candidate = { schema: CANDIDATE_SCHEMA, id: '', title_zh: String(raw.title_zh || '').trim(), body_zh: String(raw.body_zh || '').trim(),
    knowledge_kind: raw.knowledge_kind, reusable_scope: raw.reusable_scope, source: { path: source.path, name: source.name, sha256: source.sha256 }, evidence,
    source_language: languages, translation_status: raw.translation_status || (languages.length === 1 && languages[0] === 'zh' ? 'original_zh' : 'translated'),
    facts: extractFacts(evidence.map((item) => item.original).join('\n')), confidence: { evidence: Number(raw.confidence?.evidence), completeness: Number(raw.confidence?.completeness), translation: Number(raw.confidence?.translation) },
    warnings: (raw.warnings || []).map(String) };
  return validateCandidate(candidate, source, blocks);
}

module.exports = { ARTIFACT_SCHEMA, CANDIDATE_SCHEMA, KINDS, PROMPT_VERSION, SCOPES, TRANSLATION, canonical, extractFacts, factSignature,
  normalizeProposal, stableCandidateId, validateCandidate };
