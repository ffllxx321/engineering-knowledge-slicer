'use strict';

const { PRODUCTION_FLOW_CONTRACT } = require('./production-flow-contract.js');

const LABELS = Object.freeze({
  waiting: '等待', processing: '处理中', pending_confirmation: '待确认', stored: '已入库', failed: '失败'
});

function assertManifest(task, manifest) {
  if (!manifest || manifest.schema !== 'eks/authoritative-visible-manifest/3.0') return false;
  if (!task?.run_id || manifest.run_id !== task.run_id || manifest.task_id !== task.task_id) return false;
  const sets = manifest.path_sets || {};
  const planned = [...new Set(sets.planned || [])].sort();
  const committed = [...new Set(sets.committed || [])].sort();
  const verified = [...new Set(sets.visible_verified || [])].sort();
  if (!planned.length || JSON.stringify(planned) !== JSON.stringify(committed)
    || JSON.stringify(planned) !== JSON.stringify(verified)) return false;
  const records = Array.isArray(manifest.records) ? manifest.records : [];
  const roots = manifest.target_roots || {};
  return records.length === verified.length && records.every((record) => record.run_id === task.run_id
    && record.state === 'visible_verified' && verified.includes(record.final_path)
    && String(record.final_path || '').toLowerCase().endsWith('.md')
    && ['business', 'active_tender'].includes(record.target_library)
    && normalizedUnderRoot(record.final_path, roots[record.target_library])
    && /^[a-f0-9]{64}$/.test(String(record.content_hash || '')));
}

function normalizedUnderRoot(path, root) {
  const clean = (value) => String(value || '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
  const candidate = clean(path); const target = clean(root);
  return Boolean(target && candidate.startsWith(`${target}/`));
}

function transitionProductionState(task, next, context = {}) {
  const current = PRODUCTION_FLOW_CONTRACT.user_states.includes(task?.production_state)
    ? task.production_state : 'waiting';
  if (!PRODUCTION_FLOW_CONTRACT.user_states.includes(next)) throw new Error(`未知生产状态：${next}`);
  if (current !== next && !(PRODUCTION_FLOW_CONTRACT.transitions[current] || []).includes(next)) {
    const error = new Error(`不允许从“${LABELS[current]}”转为“${LABELS[next]}”`);
    error.code = 'PRODUCTION_STATE_TRANSITION_REJECTED';
    throw error;
  }
  if (next === 'stored' && !assertManifest(task, context.manifest || task.current_run_manifest)) {
    const error = new Error('当前运行的计划、提交、最终可见文件不完全一致，不能标记为已入库。');
    error.code = 'AUTHORITATIVE_MANIFEST_REQUIRED';
    throw error;
  }
  task.production_state = next;
  task.status = next;
  task.internal_stage = String(context.stage || task.internal_stage || (next === 'stored' ? 'complete' : next));
  task.updated_at = context.at || new Date().toISOString();
  if (context.message) task.progress = { ...(task.progress || {}), stage: task.internal_stage, message: context.message, at: task.updated_at };
  if (next !== 'stored') task.terminal_outcome = next === 'failed' ? 'failed' : null;
  else task.terminal_outcome = 'completed_with_output';
  return task;
}

function invalidateProductionSuccess(task, message) {
  task.current_run_manifest = null;
  return transitionProductionState(task, 'waiting', { stage: 'visible_verify', message });
}

function visibleFacts(task) {
  if (!assertManifest(task, task?.current_run_manifest)) return { count: 0, paths: [], records: [] };
  const records = task.current_run_manifest.records;
  return { count: records.length, paths: records.map((item) => item.final_path), records };
}

module.exports = { LABELS, assertManifest, transitionProductionState, invalidateProductionSuccess, visibleFacts };
