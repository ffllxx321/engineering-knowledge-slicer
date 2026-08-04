// @ts-nocheck -- Obsidian Vault behavior is verified by unit and official-host gates.
'use strict';

const { sha256 } = require('./contracts');
const { ARTIFACT_SCHEMA, validateCandidate } = require('./candidate-contract');
const { PHASE2_MANIFEST_PATH, V3Phase2CandidateOrchestrator } = require('./candidate-orchestrator');
const { INDEX_SCHEMA, LIBRARIES, PLAN_SCHEMA, RECORD_SCHEMA, ROUTING_SCHEMA, localRoute, safeFilename, stableRecordId, validateIndex, validateProviderRoute } = require('./write-contract');

const PHASE3_ROOT = 'Engineering Knowledge Slicer/v3-phase3';
const PHASE3_STATE_ROOT = `${PHASE3_ROOT}/state/v1`;
const PHASE3_STAGING_ROOT = `${PHASE3_STATE_ROOT}/staging`;
const PHASE3_MANIFEST_PATH = `${PHASE3_STATE_ROOT}/manifests/current-run.json`;
const PHASE3_INDEX_PATH = `${PHASE3_STATE_ROOT}/id-path-index.json`;
const ACTIVE_LIBRARY_ROOT = `${PHASE3_ROOT}/experimental-libraries/v1/active-tender`;
const BUSINESS_LIBRARY_ROOT = `${PHASE3_ROOT}/experimental-libraries/v1/reusable-business`;
const ROOTS = { active_tender: ACTIVE_LIBRARY_ROOT, reusable_business: BUSINESS_LIBRARY_ROOT };
const ROUTE_PROMPT = '仅判断给定候选属于当前在办投标/项目资料，还是可复用业务/历史知识。只返回 JSON：{"library":"active_tender|reusable_business","reason_zh":"简短中文依据"}。不得生成内容、目录或关系。';

const quote = (v) => JSON.stringify(String(v ?? ''));
const yamlList = (values) => `[${[...new Set(values || [])].sort().map(quote).join(', ')}]`;
const kindZh = { project: '项目', source_document: '来源文档', business_item: '业务事项', company_knowledge: '公司知识' };

function recordPath(record) {
  const statusFolder = record.record_kind === 'project' && record.status !== 'active' ? `归档/${{ completed: '已完成', suspended: '已暂停', cancelled: '已取消' }[record.status]}` : '在库';
  return `${ROOTS[record.library]}/${statusFolder}/${kindZh[record.record_kind]}/${safeFilename(record.title, record.record_id)}`;
}

function renderRecord(record, index) {
  const resolved = []; const pending = [];
  for (const relation of record.relations || []) {
    const target = index.records[relation.target_id];
    if (target && !relation.ambiguous) resolved.push(`- ${relation.label_zh}：[[${target.path.replace(/\.md$/, '')}|${relation.title_zh || relation.target_id}]]（ID：${relation.target_id}）`);
    else pending.push(`- ${relation.label_zh || '相关记录'}：${relation.target_id || '未提供ID'}（${relation.ambiguous ? '存在多个可能目标' : '尚未找到唯一目标'}）`);
  }
  const evidence = (record.evidence || []).map((e) => `- 块 ID：${e.block_id}\n  - 定位：${quote(JSON.stringify(e.locator))}\n  - 原文：${quote(e.original)}`).join('\n') || '- 无';
  return `---\neks_schema: ${RECORD_SCHEMA}\nrecord_id: ${quote(record.record_id)}\nrecord_kind: ${record.record_kind}\ntitle: ${quote(record.title)}\nlibrary: ${record.library}\nstatus: ${record.status}\ntags: ${yamlList(record.tags)}\nsource_sha256: ${quote(record.source_sha256)}\nphase2_candidate_ids: ${yamlList(record.candidate_ids)}\nrouting_contract: ${ROUTING_SCHEMA}\nrouting_basis: ${record.routing_basis}\n---\n\n# ${record.title}\n\n${record.body}\n\n## 关系\n\n${resolved.join('\n') || '- 无已确认关系'}\n\n## 待处理关系\n\n${pending.join('\n') || '- 无'}\n\n## 来源与证据\n\n- 来源路径：${quote(record.source_path)}\n- 来源 SHA-256：${record.source_sha256}\n${evidence}\n\n## 溯源\n\n- Phase 2 清单：${PHASE2_MANIFEST_PATH}\n- 候选 ID：${(record.candidate_ids || []).join('、') || '不适用'}\n- 路由依据：${record.routing_reason}\n`;
}

class V3Phase3WriteOrchestrator {
  constructor(vault, options = {}) { this.vault = vault; this.provider = options.provider; this.model = String(options.model || 'configured-provider'); this.projectStatus = options.projectStatus || 'active'; }

  async processLatest(runId = `v3-p3-${Date.now().toString(36)}`) {
    const binding = await this.loadPhase2();
    const manifest = { schema: 'eks/v3/phase3-manifest/1', run_id: runId, state: 'planning', source_phase2: binding.bound,
      routing_schema: ROUTING_SCHEMA, plan_schema: PLAN_SCHEMA, counts: { planned: 0, created: 0, updated: 0, unchanged: 0, rolled_back: 0, failed: 0 }, actual_paths: [], index: null, records: [], error: null };
    let snapshots = new Map(); let touched = [];
    try {
      const oldIndex = await this.readIndex(); const records = await this.buildRecords(binding.artifact); const index = this.buildIndex(oldIndex, records);
      for (const record of records) record.path = index.records[record.record_id].path;
      const actions = [];
      for (const record of records.sort((a, b) => a.record_id.localeCompare(b.record_id))) {
        const content = renderRecord(record, index); const existing = this.vault.getAbstractFileByPath(record.path); const prior = existing ? await this.vault.read(existing) : null;
        actions.push({ record, path: record.path, content, sha256: sha256(content), decision: prior === null ? 'create' : sha256(prior) === sha256(content) ? 'unchanged' : 'update' });
      }
      manifest.counts.planned = actions.length; manifest.plan_sha256 = sha256(JSON.stringify(actions.map((a) => ({ id: a.record.record_id, path: a.path, sha256: a.sha256, decision: a.decision }))));
      const moves = records.map((record) => ({ from: oldIndex.records[record.record_id]?.path, to: index.records[record.record_id].path })).filter((move) => move.from && move.from !== move.to);
      const indexText = `${JSON.stringify(index, null, 2)}\n`; const writes = [...actions.filter((a) => a.decision !== 'unchanged'), { path: PHASE3_INDEX_PATH, content: indexText, sha256: sha256(indexText), decision: this.vault.getAbstractFileByPath(PHASE3_INDEX_PATH) ? 'update' : 'create', index: true }];
      manifest.state = 'staging';
      for (const [i, item] of writes.entries()) { const staging = `${PHASE3_STAGING_ROOT}/${runId}/${String(i).padStart(4, '0')}-${sha256(item.path).slice(0, 12)}.stage`; await this.write(staging, item.content); await this.verify(staging, item.sha256); item.staging = staging; }
      manifest.state = 'committing';
      for (const item of writes) {
        const existing = this.vault.getAbstractFileByPath(item.path); snapshots.set(item.path, existing ? await this.vault.read(existing) : null);
        if (existing) await this.vault.modify(existing, item.content);
        else { const staged = this.vault.getAbstractFileByPath(item.staging); if (!staged) throw new Error(`暂存文件丢失：${item.staging}`); await this.ensureParent(item.path); await this.vault.rename(staged, item.path); }
        touched.push(item.path); await this.verify(item.path, item.sha256);
      }
      for (const move of moves) { const old = this.vault.getAbstractFileByPath(move.from); if (old) { snapshots.set(move.from, await this.vault.read(old)); touched.push(move.from); await this.vault.delete(old, true); } }
      for (const item of writes) { const staged = this.vault.getAbstractFileByPath(item.staging); if (staged) await this.vault.delete(staged, true); }
      for (const action of actions) manifest.counts[action.decision === 'create' ? 'created' : action.decision === 'update' ? 'updated' : 'unchanged'] += 1;
      manifest.actual_paths = actions.map((a) => a.path); manifest.index = { path: PHASE3_INDEX_PATH, sha256: sha256(indexText) };
      manifest.records = actions.map((a) => ({ record_id: a.record.record_id, path: a.path, sha256: a.sha256, decision: a.decision })); manifest.state = 'committed';
      const manifestText = `${JSON.stringify(manifest, null, 2)}\n`; await this.write(PHASE3_MANIFEST_PATH, manifestText);
      if (!(await V3Phase3WriteOrchestrator.completionFromManifest(this.vault))) throw new Error('Phase 3 完成权威校验失败');
      return { manifest, plan: actions };
    } catch (error) {
      for (const path of [...touched].reverse()) { try { const current = this.vault.getAbstractFileByPath(path); const prior = snapshots.get(path); if (prior === null && current) await this.vault.delete(current, true); else if (prior !== undefined) current ? await this.vault.modify(current, prior) : await this.write(path, prior); manifest.counts.rolled_back += 1; } catch (_) { manifest.rollback_incomplete = true; } }
      manifest.counts.created = 0; manifest.counts.updated = 0; manifest.counts.failed = 1; manifest.state = 'failed'; manifest.error = { message: String(error?.message || error).slice(0, 300) };
      await this.write(PHASE3_MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`).catch(() => {}); throw Object.assign(error, { manifest });
    }
  }

  async loadPhase2() {
    if (!(await V3Phase2CandidateOrchestrator.completionFromManifest(this.vault))) throw new Error('Phase 2 候选清单未提交、不可重开或哈希无效');
    const manifestText = await this.vault.read(this.vault.getAbstractFileByPath(PHASE2_MANIFEST_PATH)); const manifest = JSON.parse(manifestText);
    const artifactText = await this.vault.read(this.vault.getAbstractFileByPath(manifest.final.artifact.path)); const artifact = JSON.parse(artifactText);
    if (artifact.schema !== ARTIFACT_SCHEMA || sha256(artifactText) !== manifest.final.artifact.sha256) throw new Error('Phase 2 候选产物哈希无效');
    return { artifact, bound: { manifest_path: PHASE2_MANIFEST_PATH, manifest_sha256: sha256(manifestText), artifact_path: manifest.final.artifact.path, artifact_sha256: manifest.final.artifact.sha256 } };
  }

  async buildRecords(artifact) {
    const source = artifact.candidates[0].source; const projectId = stableRecordId('project', { source_sha256: source.sha256 }); const sourceId = stableRecordId('source_document', { source_sha256: source.sha256, path: source.path });
    const routes = [];
    for (const candidate of artifact.candidates) {
      const local = localRoute(candidate, source); if (local.library) routes.push({ candidate, ...local, reason_zh: `确定性本地信号：在办=${local.signals.active}，复用=${local.signals.reusable}` });
      else { if (!this.provider?.request) throw new Error(`路由歧义且未配置 provider：${candidate.id}`); const raw = await this.provider.request(`${ROUTE_PROMPT}\n\n${JSON.stringify({ candidate_id: candidate.id, title_zh: candidate.title_zh, body_zh: candidate.body_zh, reusable_scope: candidate.reusable_scope })}`, { model: this.model, contract: ROUTING_SCHEMA }); routes.push({ candidate, ...validateProviderRoute(raw), basis: 'provider' }); }
    }
    const projectLibrary = routes.some((r) => r.library === 'active_tender') ? 'active_tender' : 'reusable_business'; const common = { source_path: source.path, source_sha256: source.sha256, status: 'reference', tags: ['eks-v3', '实验性'], evidence: [], candidate_ids: [], routing_basis: 'local', routing_reason: '由来源与候选路由汇总' };
    const records = [
      { ...common, record_id: projectId, record_kind: 'project', title: `项目记录：${source.name}`, body: '本记录汇总该来源对应的项目或资料集合。', library: projectLibrary, status: this.projectStatus, tags: [...common.tags, '项目'], relations: [{ label_zh: '包含来源', target_id: sourceId, title_zh: source.name }] },
      { ...common, record_id: sourceId, record_kind: 'source_document', title: `来源文档：${source.name}`, body: '本记录保存来源身份与精确证据入口。', library: projectLibrary, tags: [...common.tags, '来源文档'], relations: [{ label_zh: '所属项目', target_id: projectId, title_zh: `项目记录：${source.name}` }] }
    ];
    for (const route of routes) { const c = route.candidate; const kind = route.library === 'reusable_business' ? 'company_knowledge' : 'business_item'; records.push({ ...common, record_id: stableRecordId(kind, { candidate_id: c.id }), record_kind: kind, title: c.title_zh, body: c.body_zh, library: route.library, tags: [...common.tags, kind === 'company_knowledge' ? '公司知识' : '业务事项', c.knowledge_kind], evidence: c.evidence, candidate_ids: [c.id], routing_basis: route.basis, routing_reason: route.reason_zh, relations: [{ label_zh: '来源于', target_id: sourceId, title_zh: source.name }, ...(c.relationships || [])] }); }
    return records;
  }

  buildIndex(oldIndex, records) {
    const index = JSON.parse(JSON.stringify(oldIndex)); const occupied = new Map(Object.entries(index.records).map(([id, item]) => [item.path, id]));
    for (const record of records) { let path = recordPath(record); const current = index.records[record.record_id]; if (current && current.record_kind !== record.record_kind) throw new Error(`记录 ID 类型冲突：${record.record_id}`);
      if (current && record.record_kind !== 'project') path = current.path; if (occupied.has(path) && occupied.get(path) !== record.record_id) path = path.replace(/\.md$/, `--${sha256(record.record_id).slice(0, 8)}.md`);
      index.records[record.record_id] = { record_id: record.record_id, record_kind: record.record_kind, library: record.library, path }; occupied.set(path, record.record_id); }
    return validateIndex(index);
  }
  async readIndex() { const file = this.vault.getAbstractFileByPath(PHASE3_INDEX_PATH); if (!file) return { schema: INDEX_SCHEMA, records: {} }; return validateIndex(JSON.parse(await this.vault.read(file))); }
  async verify(path, hash) { const file = this.vault.getAbstractFileByPath(path); if (!file) throw new Error(`无法重开：${path}`); if (sha256(await this.vault.read(file)) !== hash) throw new Error(`哈希不匹配：${path}`); }
  async ensureParent(path) { let current = ''; for (const part of path.split('/').slice(0, -1)) { current = current ? `${current}/${part}` : part; if (!this.vault.getAbstractFileByPath(current)) try { await this.vault.createFolder(current); } catch (e) { if (!/already exists/i.test(String(e?.message || e))) throw e; } } }
  async write(path, content) { await this.ensureParent(path); const file = this.vault.getAbstractFileByPath(path); return file ? this.vault.modify(file, content) : this.vault.create(path, content); }

  static async completionFromManifest(vault) {
    try { const file = vault.getAbstractFileByPath(PHASE3_MANIFEST_PATH); if (!file) return false; const manifestText = await vault.read(file); const manifest = JSON.parse(manifestText);
      if (manifest.schema !== 'eks/v3/phase3-manifest/1' || manifest.state !== 'committed' || !manifest.index || !manifest.records?.length || manifest.counts.created + manifest.counts.updated + manifest.counts.unchanged !== manifest.counts.planned) return false;
      if (!(await V3Phase2CandidateOrchestrator.completionFromManifest(vault))) return false; const p2Text = await vault.read(vault.getAbstractFileByPath(PHASE2_MANIFEST_PATH)); if (sha256(p2Text) !== manifest.source_phase2.manifest_sha256) return false;
      const indexText = await vault.read(vault.getAbstractFileByPath(manifest.index.path)); const index = validateIndex(JSON.parse(indexText)); if (sha256(indexText) !== manifest.index.sha256) return false;
      for (const item of manifest.records) { if (index.records[item.record_id]?.path !== item.path || sha256(await vault.read(vault.getAbstractFileByPath(item.path))) !== item.sha256) return false; } return true;
    } catch (_) { return false; }
  }
}

module.exports = { ACTIVE_LIBRARY_ROOT, BUSINESS_LIBRARY_ROOT, PHASE3_INDEX_PATH, PHASE3_MANIFEST_PATH, PHASE3_ROOT, PHASE3_STAGING_ROOT, PHASE3_STATE_ROOT,
  ROOTS, ROUTE_PROMPT, V3Phase3WriteOrchestrator, recordPath, renderRecord };
