'use strict';

const crypto = require('crypto');
const { buildEvolutionGraph } = require('./v3/evolution-contract.js');

const SCHEMA = 'eks/production-evolution-index/1';
const PIPELINE = 'eks/stable-production/phase6';
const hash = (v) => crypto.createHash('sha256').update(String(v)).digest('hex');
const stable = (v) => JSON.stringify(v, Object.keys(v || {}).sort());
const encode = (v) => Buffer.from(JSON.stringify(v), 'utf8').toString('base64url');
const replaceFrontmatter = (text, key, value) => {
  const line = `${key}: "${value}"`; const re = new RegExp(`^${key}:.*$`, 'm');
  return re.test(text) ? text.replace(re, line) : text.replace(/^---\n/, `---\n${line}\n`);
};
function unitOf(action) {
  const r = action.record_snapshot || {}; const evidence = (r.evidence_list?.length ? r.evidence_list : [r.evidence]).filter((e) => e?.verbatim);
  if (!evidence.length) return null;
  return { unit_id: action.record_id, title: r.title, body: r.summary, semantic_type: r.semantic_kind || r.item_type || r.record_kind,
    subject: r.subject || r.search_title || r.title, entity: r.entity || '', predicate: r.predicate || r.summary || '',
    predicate_signature: r.predicate_signature || r.signature || '', parameters: r.parameters || {}, numbers: r.numbers || [],
    standard: r.standard || '', clause: r.clause || '', revision: r.revision || action.source_version || '', version: r.version || '',
    dates: r.dates || [], effective_date: r.effective_date || '', expires_date: r.expires_date || '',
    scope: r.scope && Object.keys(r.scope).length ? r.scope : (r.project_ids?.length ? { kind: 'project', project_ids: r.project_ids } : { kind: 'general' }),
    replaces: r.replaces || [], evidence: evidence.map((e, i) => ({ evidence_id: e.evidence_id || `ev-${hash(`${action.owner_source_id}|${e.block_id}|${JSON.stringify(e.locator)}|${e.verbatim}`).slice(0,24)}`,
      source_id: action.owner_source_id, block_id: String(e.block_id || `record-${action.record_id}-${i}`), locator: e.locator || {}, raw_verbatim: String(e.verbatim) })) };
}
function prepareProductionEvolution(plan, options = {}) {
  const actions = (plan.actions || []).filter((a) => ['business_item','company_knowledge'].includes(a.record_kind));
  const priorFacts = options.previous?.graph?.facts || [];
  const priorUnits = priorFacts.map(f => ({ ...f, unit_id: f.unit_ids?.[0] || f.fact_id, semantic_type: f.semantic_type,
    evidence: f.evidence, scope: f.scope, replaces: f.explicit_replaces || [] }));
  const replaced = new Set(actions.map(a => a.record_id));
  const units = [...priorUnits.filter(u => !(u.unit_ids || [u.unit_id]).some(id => replaced.has(id))), ...actions.map(unitOf).filter(Boolean)]; const documents = new Map();
  for (const unit of units) for (const e of unit.evidence) {
    if (!documents.has(e.source_id)) documents.set(e.source_id, { source_id: e.source_id, source_hash: actions.find(a => a.owner_source_id === e.source_id)?.source_hash || '', blocks: [] });
    const d = documents.get(e.source_id); if (!d.blocks.some(b => b.block_id === e.block_id)) d.blocks.push({ block_id: e.block_id, locator: e.locator, raw_verbatim: e.raw_verbatim });
  }
  const graph = buildEvolutionGraph({ documents: [...documents.values()], units }, { as_of: options.as_of });
  const factByUnit = new Map(graph.facts.flatMap(f => f.unit_ids.map(id => [id, f])));
  for (const action of actions) { const fact = factByUnit.get(action.record_id); if (!fact) continue; action.content = replaceFrontmatter(action.content, 'evolution_schema', SCHEMA); action.content = replaceFrontmatter(action.content, 'evolution_payload', `base64url:${encode(fact)}`); action.content_hash = hash(action.content);
    action.action = action.from_path
      ? (action.prior_hash === action.content_hash ? 'move' : 'update_and_move')
      : action.prior_hash === action.content_hash ? 'noop' : action.prior_content == null ? 'create' : 'update'; }
  const currentRecords = actions.map(a => ({ record_id: a.record_id, path: a.path, content_hash: a.content_hash, source_id: a.owner_source_id,
    source_hash: a.source_hash || '', evidence_hashes: (unitOf(a)?.evidence || []).map(e => hash(`${e.source_id}|${e.block_id}|${JSON.stringify(e.locator)}|${e.raw_verbatim}`)).sort() })).sort((a,b)=>a.record_id.localeCompare(b.record_id));
  const records = [...(options.previous?.records || []).filter(r => !replaced.has(r.record_id)), ...currentRecords].sort((a,b)=>a.record_id.localeCompare(b.record_id));
  const binding = hash(JSON.stringify({ schema: SCHEMA, pipeline: PIPELINE, records }));
  const index = { schema: SCHEMA, pipeline: PIPELINE, as_of: options.as_of, binding_sha256: binding, records, graph };
  return { index, content: `${JSON.stringify(index, null, 2)}\n`, binding };
}
function verifyProductionEvolution(index, records) {
  if (index?.schema !== SCHEMA || index.pipeline !== PIPELINE) return false;
  const actual = hash(JSON.stringify({ schema: SCHEMA, pipeline: PIPELINE, records: index.records }));
  const ids = new Set(index.graph?.facts?.flatMap(f => f.unit_ids) || []);
  return actual === index.binding_sha256 && index.records.every(r => records.some(x => x.record_id === r.record_id && x.content_hash === r.content_hash) && ids.has(r.record_id));
}
async function rebuildProductionEvolution(vault, idPathIndex, options = {}) {
  const records=[]; const facts=[]; let legacy=0;
  for (const entry of Object.values(idPathIndex?.records || {}).filter(r=>['business_item','company_knowledge'].includes(r.record_kind)).sort((a,b)=>a.record_id.localeCompare(b.record_id))) {
    const text=await vault.readIfExists(entry.path); if(text==null) throw Object.assign(new Error(`演化重建目标缺失：${entry.record_id}`),{code:'EVOLUTION_REBUILD_TARGET_MISSING'});
    if(entry.content_hash&&hash(text)!==entry.content_hash) throw Object.assign(new Error(`演化重建内容哈希不一致：${entry.record_id}`),{code:'EVOLUTION_REBUILD_CONTENT_MISMATCH'});
    const encoded=String(text).match(/^evolution_payload:\s*["']?base64url:([^"'\n]+)/m)?.[1]; let fact=null;
    if(encoded) try { fact=JSON.parse(Buffer.from(encoded,'base64url').toString('utf8')); } catch(_){ throw Object.assign(new Error(`演化 payload 损坏：${entry.record_id}`),{code:'EVOLUTION_REBUILD_PAYLOAD_INVALID'}); }
    if(!fact){legacy+=1;fact={schema:'eks/v3/evolution-fact/1',fact_id:`legacy-${entry.record_id}`,unit_ids:[entry.record_id],title:'',body:'',semantic_type:'',subject:'',predicate:'',revision:'',version:'',effective_date:'',expires_date:'',scope:{kind:'general'},source_ids:[],evidence:[],relations:[],superseded_by:[],diagnostics:[{code:'LEGACY_UNDATED_UNRELATED'}],lifecycle:'undated'};}
    facts.push(fact); records.push({record_id:entry.record_id,path:entry.path,content_hash:hash(text),source_id:entry.owner_source_id||'',source_hash:entry.source_hash||'',evidence_hashes:(fact.evidence||[]).map(e=>hash(`${e.source_id}|${e.block_id}|${JSON.stringify(e.locator)}|${e.raw_verbatim}`)).sort()});
  }
  const sorted=records.sort((a,b)=>a.record_id.localeCompare(b.record_id)); const binding=hash(JSON.stringify({schema:SCHEMA,pipeline:PIPELINE,records:sorted}));
  const index={schema:SCHEMA,pipeline:PIPELINE,as_of:options.as_of,binding_sha256:binding,records:sorted,graph:{schema:'eks/v3/evolution-graph/1',as_of:options.as_of,facts,relations:facts.flatMap(f=>f.relations||[]),diagnostics:[]}};
  const preview={managed_records:records.length,payload_records:records.length-legacy,legacy_undated_unrelated:legacy,path:options.path};
  if(!options.dry_run) await vault.write(options.path,`${JSON.stringify(index,null,2)}\n`);
  return {preview,index};
}
module.exports = { SCHEMA, PIPELINE, prepareProductionEvolution, verifyProductionEvolution, rebuildProductionEvolution };
