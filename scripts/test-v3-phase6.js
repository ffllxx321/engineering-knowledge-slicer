'use strict';
const assert = require('assert');
const crypto = require('crypto');
const { ProductionCommitService } = require('../src/production-commit-service.js');
const { commitPlan, emptyIndex, hash } = require('../src/structured-writer.js');
const { markdownRecord, HybridRetriever } = require('../src/retrieval-core.js');
class File { constructor(path) { this.path = path; } }
class Vault {
  constructor() { this.files = new Map(); this.failEvolution = false; }
  getAbstractFileByPath(p) { return this.files.has(p) || [...this.files.keys()].some(x=>x.startsWith(`${p}/`)) ? new File(p) : null; }
  async read(f) { return this.files.get(f.path); } async create(p,c) { if(this.failEvolution&&p.includes('production-index'))throw Error('injected index failure'); this.files.set(p,String(c)); }
  async modify(f,c) { if(this.failEvolution&&f.path.includes('production-index'))throw Error('injected index failure'); this.files.set(f.path,String(c)); }
  async createFolder(p) { this.files.set(p, null); } async rename(f,p) { this.files.set(p,this.files.get(f.path));this.files.delete(f.path); }
}
const digest = v => crypto.createHash('sha256').update(v).digest('hex');
const lock = { acquire: async () => () => {} };
function action(id, source, text, extra={}) {
  const path=`business/${id}.md`; const content=`---\nrecord_id: "${id}"\nrecord_kind: "company_knowledge"\nsource_document_ids: ["${source}"]\n---\n# ${extra.title||text}\n\n- 归属来源：${source}\n`;
  return { action:'create',record_id:id,record_kind:'company_knowledge',path,content,content_hash:hash(content),prior_hash:null,prior_content:null,owner_source_id:source,source_hash:digest(source),source_version:extra.revision||'',record_snapshot:{record_kind:'company_knowledge',title:extra.title||text,search_title:extra.title||text,summary:text,semantic_kind:'requirement',subject:extra.subject||'curing',predicate:extra.predicate||text,predicate_signature:extra.signature||'',numbers:extra.numbers||[],standard:extra.standard||'',clause:extra.clause||'',revision:extra.revision||'',effective_date:extra.effective_date||'',scope:extra.scope||{kind:'general'},replaces:extra.replaces||[],evidence:{block_id:`b-${id}`,locator:{page:extra.page||1},verbatim:text}}};
}
async function run() {
  const vault=new Vault(); let index=emptyIndex(); const state='state';
  const commit=async(actions,runId)=>{ for(const a of actions){const old=vault.files.get(a.path);a.prior_content=old??null;a.prior_hash=old==null?null:hash(old);a.action=old==null?'create':old===a.content?'noop':'update';}
    const plan={mode:'structured-write',blocked:false,plan_id:`p-${runId}`,source_document_id:actions[0].owner_source_id,source_hash:actions[0].source_hash,source_version:'',actions};
    return new ProductionCommitService(vault,commitPlan).commit(plan,{lock,stateRoot:state,index,saveIndex:async n=>{index=n;},logicalTime:'2026-08-21T00:00:00Z',asOf:'2026-08-21',runId,taskId:`t-${runId}`,targetRoots:{business:'business',active_tender:'tender'}}).then(r=>(index=r.index,r)); };
  await commit([action('old','src-a','Curing shall last 7 days',{revision:'A',standard:'STD',clause:'8.4',effective_date:'2024-01-01'}),action('unrelated','src-a','Unrelated crane inspection survives',{subject:'crane'})],'one');
  const second=await commit([action('copy','src-b','Curing shall last 7 days',{revision:'A',standard:'STD',clause:'8.4',effective_date:'2024-01-01'}),action('new','src-b','Curing shall last 14 days',{revision:'B',standard:'STD',clause:'8.4',effective_date:'2026-01-01',replaces:['old']}),action('conflict7','src-b','Wet curing minimum 7 days',{subject:'wet curing',predicate:'minimum duration',numbers:[{value:7,unit:'days'}]}),action('conflict14','src-b','Wet curing minimum 14 days',{subject:'wet curing',predicate:'minimum duration',numbers:[{value:14,unit:'days'}]}),action('red','src-b','Anchor spacing 450 mm',{subject:'anchor',predicate:'spacing',numbers:[{value:450,unit:'mm'}],scope:{kind:'project',project_ids:['red']}}),action('blue','src-b','Anchor spacing 900 mm',{subject:'anchor',predicate:'spacing',numbers:[{value:900,unit:'mm'}],scope:{kind:'project',project_ids:['blue']}}),action('bad-date','src-b','Malformed date remains undated',{subject:'date',effective_date:'2026-99-40'})],'two');
  const sidecar=JSON.parse(vault.files.get('state/evolution/production-index-v1.json')); assert(sidecar.graph.facts.some(f=>f.unit_ids.includes('unrelated'))); assert(sidecar.graph.diagnostics.some(d=>d.code==='MALFORMED_EFFECTIVE_DATE'));
  assert(sidecar.graph.relations.some(r=>r.type==='contradicts')); assert(!sidecar.graph.relations.some(r=>['red','blue'].includes(r.from_id)&&['red','blue'].includes(r.target_id)));
  assert(second.authoritativeManifest.evolution.required); assert.deepStrictEqual(second.authoritativeManifest.path_sets.committed,second.authoritativeManifest.path_sets.visible_verified);
  const records=[...index.records&&Object.values(index.records)].filter(r=>['company_knowledge','business_item'].includes(r.record_kind)).map(r=>markdownRecord(vault.files.get(r.path),r.path));
  const retriever=new HybridRetriever(records); const current=await retriever.search('Curing 14 days Rev B',{as_of:'2026-08-21',limit:5}); assert(current.some(x=>x.record.revision==='B'));
  const historical=await retriever.search('Curing 7 days Rev A',{as_of:'2026-08-21',historical:true,limit:5}); assert(historical.some(x=>x.record.revision==='A'));
  const before=new Map(vault.files); const beforeIndex=JSON.stringify(index); vault.failEvolution=true;
  await assert.rejects(()=>commit([action('fail','src-c','Rollback proof')],'fail'),/injected index failure/); vault.failEvolution=false;
  assert.strictEqual(JSON.stringify(index),beforeIndex); assert(!vault.files.has('business/fail.md')); assert(vault.files.has('business/unrelated.md'));
  const repeated=JSON.stringify(sidecar); const rebuilt=JSON.stringify(JSON.parse(vault.files.get('state/evolution/production-index-v1.json'))); assert.strictEqual(rebuilt,repeated);
  console.log(JSON.stringify({schema:'eks/v3/phase6-metrics/1',documents:3,cards:Object.keys(index.records).length,evolution_facts:sidecar.graph.facts.length,rollback:true,restart_deterministic:true,provider_real:'not_run'}));
}
run().catch(e=>{console.error(e);process.exitCode=1;});
