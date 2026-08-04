'use strict';

const PRODUCTION_FLOW_CONTRACT = Object.freeze({
  schema: 'eks/production-flow-contract/1.0',
  entrypoint: 'EngineeringKnowledgeSlicerPlugin.processTask',
  stages: Object.freeze([
    'intake', 'parse_normalize', 'understand', 'quality_check', 'confirmation',
    'write_plan', 'atomic_commit', 'visible_verify', 'complete'
  ]),
  user_states: Object.freeze(['waiting', 'processing', 'pending_confirmation', 'stored', 'failed']),
  transitions: Object.freeze({
    waiting: Object.freeze(['processing', 'failed']),
    processing: Object.freeze(['pending_confirmation', 'stored', 'failed']),
    pending_confirmation: Object.freeze(['processing', 'failed']),
    stored: Object.freeze(['waiting', 'failed']),
    failed: Object.freeze(['waiting', 'processing'])
  }),
  authority: Object.freeze({
    success: 'task.current_run_manifest',
    count: 'task.current_run_manifest.path_sets.visible_verified.length',
    paths: 'task.current_run_manifest.records[].final_path',
    equality: 'planned == committed == visible_verified',
    run_binding: 'manifest.run_id == task.run_id'
  }),
  knowledge_write_entrypoint: 'ProductionCommitService.commit',
  knowledge_write_port: 'KnowledgeWritePort',
  auxiliary_writes: Object.freeze(['task_ledger', 'diagnostics', 'intermediate_cache', 'transaction_manifest', 'index']),
  legacy_policy: 'reject_in_production',
  forbidden_success_evidence: Object.freeze([
    'cardsGenerated', 'cardsWritten', 'plan.actions.length', 'writtenFiles',
    'written_card_ids', 'result_counts.written', 'prior_run_manifest', 'source_hash', 'plan_id'
  ])
});

module.exports = { PRODUCTION_FLOW_CONTRACT };
