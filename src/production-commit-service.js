'use strict';

const crypto = require('crypto');
const { KnowledgeWritePort } = require('./knowledge-write-port.js');
const { assertKnowledgeActions } = require('./content-integrity.js');
const { prepareProductionEvolution, verifyProductionEvolution, rebuildProductionEvolution } = require('./production-evolution.js');

const normalized = (value) => String(value || '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
const uniqueSorted = (values) => [...new Set(values.map(normalized).filter(Boolean))].sort();
const hash = (value) => crypto.createHash('sha256').update(String(value)).digest('hex');

class ProductionCommitService {
  constructor(obsidianVault, commitPlan) {
    this.port = obsidianVault instanceof KnowledgeWritePort ? obsidianVault : new KnowledgeWritePort(obsidianVault);
    this.commitPlan = commitPlan;
  }

  async commit(plan, options) {
    if (!options?.runId || !options?.taskId) throw Object.assign(new Error('生产提交必须绑定当前 run_id 和 task_id。'), { code: 'CURRENT_RUN_REQUIRED' });
    assertKnowledgeActions(plan?.actions);
    const asOf = options.asOf || options.as_of;
    if (!asOf) throw Object.assign(new Error('生产演化提交必须显式注入 as_of。'), { code: 'PRODUCTION_AS_OF_REQUIRED' });
    const evolutionPath = `${normalized(options.stateRoot)}/evolution/production-index-v1.json`;
    let previous = null; const previousText = await this.port.readIfExists(evolutionPath);
    if (previousText) {
      try { previous = JSON.parse(previousText); } catch (_) { previous = null; }
    }
    const authoritativeRecords = Object.values(options.index?.records || {});
    const hasExistingKnowledge = authoritativeRecords.some((record) => ['business_item', 'company_knowledge'].includes(record.record_kind));
    if (hasExistingKnowledge && !verifyProductionEvolution(previous, authoritativeRecords)) {
      const rebuilt = await rebuildProductionEvolution(this.port, options.index, {
        as_of: asOf, path: evolutionPath, dry_run: true
      });
      previous = rebuilt.index;
    }
    const evolution = prepareProductionEvolution(plan, { as_of: asOf, previous });
    const result = await this.commitPlan(plan, { ...options, vault: this.port, requiredArtifacts: [
      { id: 'production-evolution-index', path: evolutionPath, content: evolution.content }
    ], verifyRequiredArtifacts: ({ index }) => {
      if (!verifyProductionEvolution(evolution.index, Object.values(index?.records || {}))) throw Object.assign(new Error('生产演化索引与权威记录绑定校验失败。'), { code: 'EVOLUTION_BINDING_INVALID' });
    } });
    const planned = uniqueSorted((plan.actions || []).filter((item) => ['business_item', 'company_knowledge'].includes(item.record_kind)).map((item) => item.path));
    const records = result?.verified?.knowledge_records || [];
    const committed = uniqueSorted(records.map((item) => item.final_path || item.path));
    const visible = [];
    for (const record of records) {
      const action = (plan.actions || []).find((item) => item.record_id === record.record_id);
      const verified = await this.port.verify(action, result.transactionId, new Date().toISOString(), {
        runId: options.runId, targetRoots: options.targetRoots
      });
      visible.push(verified.final_path);
    }
    const visibleVerified = uniqueSorted(visible);
    if (!planned.length || JSON.stringify(planned) !== JSON.stringify(committed)
      || JSON.stringify(planned) !== JSON.stringify(visibleVerified)) {
      const error = new Error('生产提交集合不一致：planned、committed、visible_verified 必须完全相同。');
      error.code = 'PRODUCTION_COMMIT_SET_MISMATCH';
      error.details = { planned: planned.map(hash), committed: committed.map(hash), visible_verified: visibleVerified.map(hash) };
      throw error;
    }
    if (!verifyProductionEvolution(evolution.index, Object.values(result.index?.records || {}))) throw Object.assign(new Error('生产演化索引与权威记录绑定校验失败。'), { code: 'EVOLUTION_BINDING_INVALID' });
    return { ...result, authoritativeManifest: {
      schema: 'eks/authoritative-visible-manifest/3.0', run_id: options.runId, task_id: options.taskId,
      transaction_id: result.transactionId, created_at: new Date().toISOString(),
      target_roots: options.targetRoots,
      path_sets: { planned, committed, visible_verified: visibleVerified }, records,
      evolution: { required: true, path: evolutionPath, schema: evolution.index.schema, binding_sha256: evolution.binding, content_hash: hash(evolution.content) }
    } };
  }
}

module.exports = { ProductionCommitService };
