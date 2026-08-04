'use strict';

const crypto = require('crypto');
const { KnowledgeWritePort } = require('./knowledge-write-port.js');

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
    const result = await this.commitPlan(plan, { ...options, vault: this.port });
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
    return { ...result, authoritativeManifest: {
      schema: 'eks/authoritative-visible-manifest/3.0', run_id: options.runId, task_id: options.taskId,
      transaction_id: result.transactionId, created_at: new Date().toISOString(),
      target_roots: options.targetRoots,
      path_sets: { planned, committed, visible_verified: visibleVerified }, records
    } };
  }
}

module.exports = { ProductionCommitService };
