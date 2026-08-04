// @ts-nocheck -- Runtime contract is exercised by the Phase 3 adversarial gate.
'use strict';

const { canonical } = require('./candidate-contract');
const { sha256 } = require('./contracts');

const ROUTING_SCHEMA = 'eks/v3/two-library-routing/1';
const PLAN_SCHEMA = 'eks/v3/write-plan/1';
const INDEX_SCHEMA = 'eks/v3/id-path-index/1';
const RECORD_SCHEMA = 'eks/v3/markdown-record/1';
const RECORD_KINDS = Object.freeze(['project', 'source_document', 'business_item', 'company_knowledge']);
const LIBRARIES = Object.freeze(['active_tender', 'reusable_business']);
const STATUS = Object.freeze(['active', 'completed', 'suspended', 'cancelled', 'reference']);

function stableRecordId(kind, identity) {
  if (!RECORD_KINDS.includes(kind)) throw new Error(`未知记录类型：${kind}`);
  const prefix = { project: 'prj', source_document: 'src', business_item: 'bi', company_knowledge: 'ck' }[kind];
  return `${prefix}-${sha256(JSON.stringify(canonical(identity))).slice(0, 24)}`;
}

function localRoute(candidate, source) {
  const text = `${source?.path || ''}\n${source?.name || ''}\n${candidate.title_zh || ''}\n${candidate.body_zh || ''}`;
  const active = [/投标|招标|标书|tender|bid\b/i, /项目|工程|合同|现场|进度|验收/i, /reusable_scope[=: ]*project/i]
    .reduce((n, rule) => n + (rule.test(text) ? 1 : 0), candidate.reusable_scope === 'project' ? 2 : 0);
  const reusable = [/经验|教训|复盘|方法|标准|规范|通用|历史|知识/i, /lesson|method|definition|reference/i]
    .reduce((n, rule) => n + (rule.test(text) ? 1 : 0), ['trade', 'organization', 'general'].includes(candidate.reusable_scope) ? 2 : 0);
  if (active > reusable) return { library: 'active_tender', basis: 'local', signals: { active, reusable } };
  if (reusable > active) return { library: 'reusable_business', basis: 'local', signals: { active, reusable } };
  return { library: null, basis: 'ambiguous', signals: { active, reusable } };
}

function validateProviderRoute(value) {
  const parsed = typeof value === 'string' ? JSON.parse(value) : value;
  if (!parsed || !LIBRARIES.includes(parsed.library) || Object.keys(parsed).some((key) => !['library', 'reason_zh'].includes(key))
    || !String(parsed.reason_zh || '').trim()) throw new Error('Phase 3 路由 provider 输出合同无效');
  return { library: parsed.library, reason_zh: String(parsed.reason_zh).slice(0, 160) };
}

function safeFilename(title, id) {
  const base = String(title || '未命名').normalize('NFKC').replace(/[\\/:*?"<>|#^[\]]/g, '_').replace(/\s+/g, ' ').trim().slice(0, 72) || '未命名';
  return `${base}--${id}.md`;
}

function validateIndex(index) {
  if (!index || index.schema !== INDEX_SCHEMA || typeof index.records !== 'object' || Array.isArray(index.records)) throw new Error('Phase 3 ID 索引无效');
  const paths = new Map();
  for (const [id, item] of Object.entries(index.records)) {
    if (item.record_id !== id || !RECORD_KINDS.includes(item.record_kind) || !LIBRARIES.includes(item.library) || !String(item.path).endsWith('.md')) throw new Error('Phase 3 ID 索引条目无效');
    if (paths.has(item.path) && paths.get(item.path) !== id) throw new Error(`Phase 3 路径碰撞：${item.path}`);
    paths.set(item.path, id);
  }
  return index;
}

module.exports = { INDEX_SCHEMA, LIBRARIES, PLAN_SCHEMA, RECORD_KINDS, RECORD_SCHEMA, ROUTING_SCHEMA, STATUS,
  localRoute, safeFilename, stableRecordId, validateIndex, validateProviderRoute };
