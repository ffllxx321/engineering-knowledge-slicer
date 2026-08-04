// @ts-nocheck
'use strict';
const { canonical } = require('./candidate-contract'); const { sha256 } = require('./contracts');
const IDENTITY_SCHEMA='eks/v3/project-identity/1', ENTITY_SCHEMA='eks/v3/entity/1', ENTITY_INDEX_SCHEMA='eks/v3/entity-index/1', LEDGER_SCHEMA='eks/v3/lifecycle-ledger/1', BATCH_SCHEMA='eks/v3/phase4-batch/1';
const ENTITY_KINDS=Object.freeze(['project','organization','person','standard_specification','contract_package','material_equipment']);
const LIFECYCLE=Object.freeze(['active','completed','suspended','cancelled']); const LIFECYCLE_TRANSITIONS=Object.freeze({active:['completed','suspended','cancelled'],suspended:['active','cancelled'],completed:['active'],cancelled:['active']});
function normalizedAlias(v){return String(v||'').normalize('NFKC').toLocaleLowerCase('en-US').replace(/[株式会社有限责任公司有限公司股份公司\s\p{P}\p{S}]/gu,'').replace(/[ヶケ]/g,'ケ');}
function stableEntityId(kind,identity){if(!ENTITY_KINDS.includes(kind))throw new Error(`Phase 4 未知实体类型：${kind}`);return `ent-${kind.replace(/_/g,'-').slice(0,8)}-${sha256(JSON.stringify(canonical(identity))).slice(0,24)}`;}
function exactEvidence(e,docs){const d=docs.find(x=>x.document_id===e.document_id);return !!d&&typeof e.quote==='string'&&e.quote.length>0&&d.text.includes(e.quote)&&(!e.source_sha256||e.source_sha256===d.source_sha256);}
function validateIdentityDecision(raw,candidates,docs){const v=typeof raw==='string'?JSON.parse(raw):raw;if(!v||Object.keys(v).some(k=>!['candidate_id','reason_zh','evidence'].includes(k))||!candidates.some(c=>c.candidate_id===v.candidate_id)||!String(v.reason_zh||'').trim()||!Array.isArray(v.evidence)||!v.evidence.length||v.evidence.some(e=>!exactEvidence(e,docs)))throw new Error('Phase 4 身份 provider 决策无效或包含虚构证据');return v;}
function assertTransition(from,to){if(!LIFECYCLE.includes(from)||!LIFECYCLE.includes(to)||from===to||!LIFECYCLE_TRANSITIONS[from].includes(to))throw new Error(`Phase 4 不允许生命周期转换：${from}->${to}`);}
module.exports={BATCH_SCHEMA,ENTITY_INDEX_SCHEMA,ENTITY_KINDS,ENTITY_SCHEMA,IDENTITY_SCHEMA,LEDGER_SCHEMA,LIFECYCLE,LIFECYCLE_TRANSITIONS,assertTransition,exactEvidence,normalizedAlias,stableEntityId,validateIdentityDecision};
