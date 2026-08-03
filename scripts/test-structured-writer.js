'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {
  stableId, emptyIndex, serializeRecord, buildPlan, commitPlan, rollbackTransaction,
  pathSafe, hash
} = require('../src/structured-writer.js');
const { runPhase2CandidatePipeline } = require('../src/phase2-candidate-pipeline.js');
const { evaluatePhase3 } = require('../src/phase3-review-gate.js');

const TIME = '2026-01-02T03:04:05.000Z';
const registry = [{ project_id: 'P-001', name: '精确项目', aliases: ['P001'], state: 'bidding' }];

function block(kind, id, text, locator) {
  return {
    schema_version: 'block_v0', block_id: id, source_hash: 'a'.repeat(64), order: 1,
    parent_id: null, kind, locator, provenance: [locator],
    raw: { text, fields: {} }, inferred: {}, parse: { method: 'synthetic', quality: 1, status: 'present' },
    card_eligible: true, exclusion_reason: null, metadata: {}
  };
}

function document(overrides = {}) {
  return {
    source_identity: 'ingestion-immutable-1', source_document_id: 'input-doc-1',
    source_path: '源文件/报价单.docx', source_hash: '1'.repeat(64), source_version: 'v1',
    filename: '报价单.docx', title: '报价单', source_type: 'docx', media_type: 'application/docx',
    ingested_at: TIME,
    metadata: { library: 'business', directory_category: 'risks_issues', document_role: 'source_record' },
    blocks: [block('paragraph', 'block-000000000000000000000001', '必须在十日内提交。',
      { scheme: 'paragraph', value: 'p1' })],
    ...overrides
  };
}

function candidate(id = 'bic-111111111111111111111111', extra = {}) {
  return {
    schema_version: '2.0', candidate_id: id, source_document_id: 'input-doc-1',
    item_type: 'requirement', summary: '十日内提交',
    evidence: {
      block_id: 'block-000000000000000000000001',
      locator: { scheme: 'paragraph', value: 'p1' },
      provenance: [{ scheme: 'paragraph', value: 'p1' }],
      verbatim: '必须在十日内提交。'
    },
    applicable_conditions: [], reusable_knowledge_candidate: false,
    reuse_reasons: [], review_reasons: [], ...extra
  };
}

function phase(route = {}, items = [candidate()]) {
  const phase2 = {
    schema_version: '2.0',
    route: {
      source_document_id: 'input-doc-1', library: 'business',
      directory_category: 'risks_issues', document_role: 'source_record',
      confidence: 1, reasons: [], review_reasons: [], resolved: true, ...route
    },
    business_item_batch: { schema_version: '2.0', batch_id: 'bib-111111111111111111111111', source_document_id: 'input-doc-1', items }
  };
  return { phase2, phase3: evaluatePhase3(phase2) };
}

function input(overrides = {}) {
  const { phase2, phase3 } = phase();
  return {
    settings: {
      controlledWriterEnabled: true, structuredWriterMode: 'structured-pilot',
      structuredActiveRoot: '在办投标库', structuredBusinessRoot: '长期业务库',
      artifactsPath: '状态', structuredMaxRecords: 100, structuredMaxActions: 300,
      structuredMaxLinkFanout: 20
    },
    document: document(), projectRegistry: registry, phase2Result: phase2, phase3Result: phase3,
    index: emptyIndex(), existingFiles: {}, logicalTime: TIME, ...overrides
  };
}

class MemoryVault {
  constructor(files = {}, failAt = 0) {
    this.files = new Map(Object.entries(files));
    this.calls = 0;
    this.failAt = failAt;
  }
  hit() {
    this.calls += 1;
    if (this.failAt && this.calls === this.failAt) throw new Error(`injected-${this.failAt}`);
  }
  async readIfExists(path) { this.hit(); return this.files.has(path) ? this.files.get(path) : null; }
  async write(path, content) { this.hit(); this.files.set(path, content); }
  async rename(from, to) {
    this.hit();
    if (!this.files.has(from)) throw new Error(`missing:${from}`);
    this.files.set(to, this.files.get(from)); this.files.delete(from);
  }
  async mkdirp() { this.hit(); }
}

class NoopRecordVault extends MemoryVault {
  async write(path, content) {
    this.hit();
    if (!path.endsWith('.md')) this.files.set(path, content);
  }
}

function universalResult(count) {
  const doc = document();
  return {
    document: doc,
    knowledge_units: Array.from({ length: count }, (_, index) => ({
      unit_id: `ku-${String(index).padStart(24, '0')}`,
      fingerprint: `fingerprint-${index}`,
      title: `通用知识 ${index + 1}`,
      statement: `第 ${index + 1} 项要求必须执行并留存记录。`,
      semantic_kind: 'requirement',
      reusable: false,
      route: { library: 'business', category: 'risks_issues' },
      evidence: [{
        block_id: doc.blocks[0].block_id,
        locator: doc.blocks[0].locator,
        verbatim: doc.blocks[0].raw.text
      }],
      source_language: 'zh',
      output_language: 'zh-CN',
      applicable_conditions: [],
      exceptions: [],
      structured_facts: {},
      confidence: 1,
      uncertainty: [],
      tags: []
    })),
    relations: [],
    review_decisions: []
  };
}

function lock() {
  let busy = false;
  return {
    acquire: async () => {
      assert.strictEqual(busy, false, 'structured writes must serialize');
      busy = true;
      return () => { busy = false; };
    }
  };
}

async function realPhasePath() {
  const formats = [
    ['pdf', 'paragraph', { scheme: 'page', value: '1', page: 1 }],
    ['docx', 'paragraph', { scheme: 'paragraph', value: 'word/p1' }],
    ['xlsx', 'spreadsheet_row', { scheme: 'sheet-range', value: '报价!A2:D2', sheet: '报价', row: 2 }],
    ['ocr', 'paragraph', { scheme: 'ocr-line', value: 'page-1-line-2', page: 1 }],
    ['email', 'email_message', { scheme: 'email-message', value: 'msg-1', message_id: 'msg-1' }]
  ];
  for (const [sourceType, kind, locator] of formats) {
    const doc = document({
      source_identity: `ingestion-${sourceType}`, source_document_id: `doc-${sourceType}`,
      source_type: sourceType, media_type: sourceType,
      blocks: [block(kind, `block-${sourceType.padEnd(24, '0')}`.slice(0, 30), '必须在十日内提交。', locator)]
    });
    const calls = [];
    const phase2 = await runPhase2CandidatePipeline({
      document: doc, projectRegistry: registry,
      requestJson: async (request) => {
        calls.push(request.kind);
        if (request.kind === 'phase2_business_item_extract') {
          return { items: request.input.blocks.map((source) => ({
            item_type: 'requirement', summary: '十日内提交', block_id: source.block_id,
            evidence: { block_id: source.block_id, verbatim: source.text },
            applicable_conditions: [], reusable_knowledge_candidate: false, reuse_reasons: []
          })) };
        }
        return {};
      },
      limits: { max_extraction_requests: 1 }
    });
    assert.deepStrictEqual(calls, ['phase2_business_item_extract']);
    const phase3 = evaluatePhase3(phase2);
    const plan = buildPlan({ ...input(), document: doc, phase2Result: phase2, phase3Result: phase3 });
    assert.strictEqual(plan.blocked, false, sourceType);
    assert(plan.actions.some((item) => item.record_kind === 'business_item'));
  }
}

async function main() {
  assert.strictEqual(pathSafe('../逃逸'), false);
  assert.strictEqual(pathSafe('/绝对'), false);
  assert.strictEqual(buildPlan({ settings: {}, document: {} }).mode, 'feature_off');

  const base = input();
  const plan = buildPlan(base);
  assert.strictEqual(plan.mode, 'structured-pilot');
  assert.strictEqual(plan.writes_performed, 0);
  assert.strictEqual(plan.blocked, false);
  assert.deepStrictEqual(plan.counts, { create: 2 });
  assert(plan.summary.includes('新建 2'));
  assert(plan.actions.every((item) => item.path.startsWith('长期业务库/')));
  assert(plan.actions.some((item) => item.content.includes('[[src-')));

  const idsByKind = Object.fromEntries(plan.actions.map((item) => [item.record_kind, item.record_id]));
  const renamed = buildPlan({ ...base, document: document({ title: '改名后的报价单', filename: '改名.docx' }) });
  assert.strictEqual(renamed.actions.find((item) => item.record_kind === 'source_document').record_id,
    idsByKind.source_document, 'title rename must not change stable ID');

  const files = Object.fromEntries(plan.actions.map((item) => [item.path, item.content]));
  const index = emptyIndex();
  for (const action of plan.actions) index.records[action.record_id] = {
    record_id: action.record_id, record_kind: action.record_kind, path: action.path,
    content_hash: action.content_hash, owner_source_id: action.owner_source_id
  };
  const noop = buildPlan({ ...base, index, existingFiles: files });
  assert(noop.actions.every((item) => item.action === 'noop'), 'identical rerun must be no-op');

  const changedDoc = document({ source_hash: '2'.repeat(64), source_version: 'v2' });
  const changed = buildPlan({ ...base, document: changedDoc, index, existingFiles: files });
  assert(changed.actions.some((item) => item.action === 'update'));
  assert(changed.actions.every((item) => item.action !== 'create'));

  const occupiedPath = plan.actions[0].path;
  const occupied = buildPlan({
    ...base, existingFiles: { [occupiedPath]: '---\nrecord_id: \"other-id\"\n---\n' }
  });
  assert(occupied.conflicts.some((item) => item.cause === 'path_occupied_by_different_id'));

  const dirty = { ...files, [occupiedPath]: `${files[occupiedPath]}\n用户修改` };
  const optimistic = buildPlan({ ...base, index, existingFiles: dirty });
  assert(optimistic.conflicts.some((item) => item.cause === 'optimistic_hash_mismatch'));

  const duplicateIndex = JSON.parse(JSON.stringify(index));
  const firstId = Object.keys(duplicateIndex.records)[0];
  duplicateIndex.records.other = {
    record_id: 'other', record_kind: 'business_item', path: duplicateIndex.records[firstId].path
  };
  assert(buildPlan({ ...base, index: duplicateIndex, existingFiles: files }).conflicts
    .some((item) => item.cause === 'path_indexed_by_multiple_ids'));
  const duplicatePhysical = buildPlan({
    ...base,
    existingFiles: {
      '长期业务库/a.md': plan.actions[0].content,
      '长期业务库/b.md': plan.actions[0].content
    }
  });
  assert(duplicatePhysical.conflicts.some((item) => item.cause === 'same_id_multiple_paths'));

  const activeDoc = document({
    metadata: {
      project_id: 'P-001', library: 'active_tender',
      directory_category: 'technical_bid', document_role: 'technical_record'
    }
  });
  const activePhase = phase({ project_id: 'P-001', library: 'active_tender', directory_category: 'technical_bid' });
  const active = buildPlan({
    ...base, document: activeDoc, phase2Result: activePhase.phase2,
    phase3Result: activePhase.phase3
  });
  assert(active.actions.some((item) => item.record_kind === 'project'));
  assert(active.actions.every((item) => item.path.startsWith('在办投标库/P-001/')));
  const activeIndex = emptyIndex();
  const activeFiles = {};
  for (const action of active.actions) {
    activeIndex.records[action.record_id] = {
      record_id: action.record_id, record_kind: action.record_kind, path: action.path,
      content_hash: action.content_hash, owner_source_id: action.owner_source_id
    };
    activeFiles[action.path] = action.content;
  }
  const archived = buildPlan({
    ...base, document: activeDoc, phase2Result: activePhase.phase2, phase3Result: activePhase.phase3,
    index: activeIndex, existingFiles: activeFiles,
    archiveTransition: { from: 'lost', archive_outcome: 'lost' }
  });
  assert(archived.actions.every((item) => item.from_path?.startsWith('在办投标库/P-001/')));
  assert(archived.actions.every((item) => item.path.startsWith('长期业务库/complete_historical_projects/')));
  assert(archived.actions.some((item) => item.content.includes('[[src-')),
    'stable basename links survive archive moves');

  const ambiguous = buildPlan({
    ...base, document: activeDoc,
    phase2Result: { ...activePhase.phase2, route: { ...activePhase.phase2.route, project_id: undefined } }
  });
  assert(ambiguous.conflicts.some((item) => item.cause === 'active_project_unresolved'));

  const paused = buildPlan({
    ...base, document: activeDoc, phase2Result: activePhase.phase2, phase3Result: activePhase.phase3,
    archiveTransition: { from: 'paused', archive_outcome: 'paused_by_decision', explicit_decision: false }
  });
  assert(paused.conflicts.some((item) => item.cause === 'archive_transition_blocked'));

  const reusable = candidate('bic-222222222222222222222222', {
    reusable_knowledge_candidate: true, review_reasons: ['reuse_promotion']
  });
  const reusePhase = phase({}, [reusable]);
  const notPromoted = buildPlan({
    ...base, phase2Result: reusePhase.phase2, phase3Result: reusePhase.phase3
  });
  assert(!notPromoted.actions.some((item) => item.record_kind === 'company_knowledge'));
  const approvedPhase3 = {
    ...reusePhase.phase3, classifications: [{
      candidate_id: reusable.candidate_id, outcome: 'automatic_pass', hard_risks: [], notices: []
    }], handling_groups: []
  };
  const promoted = buildPlan({
    ...base, phase2Result: reusePhase.phase2, phase3Result: approvedPhase3,
    approvedCompanyKnowledgeCandidateIds: [reusable.candidate_id]
  });
  assert(promoted.actions.some((item) => item.record_kind === 'company_knowledge'));

  const unresolvedCandidate = candidate('bic-333333333333333333333333', {
    relations: [{
      type: 'related', target_ids: ['missing-a', 'missing-b'],
      source_candidate: '同名目标', evidence_locator: { scheme: 'paragraph', value: 'p1' }
    }]
  });
  const unresolvedPhase = phase({}, [unresolvedCandidate]);
  const unresolved = buildPlan({
    ...base, phase2Result: unresolvedPhase.phase2, phase3Result: unresolvedPhase.phase3
  });
  assert.strictEqual(unresolved.review_groups.length, 1);
  assert.strictEqual(unresolved.review_groups[0].cause, 'type_mismatch_or_missing');

  const common = {
    schema_version: '1.0', title: '示例', library: 'business',
    created_at: TIME, updated_at: TIME
  };
  for (const record of [
    { ...common, record_kind: 'project', record_id: stableId('project', 'p'), state: 'lead' },
    { ...common, record_kind: 'source_document', record_id: stableId('source_document', 's'), source_hash: 'a' },
    { ...common, record_kind: 'business_item', record_id: stableId('business_item', 'b'), item_type: 'risk', category: 'risks_issues', summary: '风险' },
    { ...common, record_kind: 'company_knowledge', record_id: stableId('company_knowledge', 'c'), category: 'terminology_general_knowledge', reuse_status: 'approved', summary: '知识' }
  ]) {
    const markdown = serializeRecord(record);
    assert(markdown.includes(`record_kind: "${record.record_kind}"`));
    assert(markdown.includes('# 示例'));
  }

  const writePlan = { ...plan, mode: 'structured-write' };
  const vault = new MemoryVault();
  let savedIndex;
  const committed = await commitPlan(writePlan, {
    vault, lock: lock(), stateRoot: '状态', index: emptyIndex(), logicalTime: TIME,
    saveIndex: async (value) => { savedIndex = value; }
  });
  assert.strictEqual(committed.manifest.status, 'committed');
  assert.strictEqual(committed.verified.counts.knowledge_records, 1);
  assert.strictEqual(committed.verified.counts.source_records, 1);
  assert.strictEqual(committed.verified.knowledge_paths.length, 1);
  assert.strictEqual(savedIndex.revision, 1);
  const rolled = await rollbackTransaction(committed.manifest, {
    vault, lock: lock(), stateRoot: '状态'
  });
  assert.strictEqual(rolled.status, 'rolled_back');
  assert(plan.actions.every((item) => !vault.files.has(item.path)));

  for (let failAt = 2; failAt <= 12; failAt += 1) {
    const failedVault = new MemoryVault({}, failAt);
    try {
      await commitPlan(writePlan, {
        vault: failedVault, lock: lock(), stateRoot: '状态', index: emptyIndex(),
        logicalTime: TIME, saveIndex: async () => {}
      });
    } catch (error) {
      assert(error.transactionManifest);
      for (const action of plan.actions) {
        const content = failedVault.files.get(action.path);
        assert(content === undefined || hash(content) !== action.content_hash,
          `failure ${failAt} left a committed generated record`);
      }
    }
  }

  const universal22 = universalResult(22);
  const plan22 = buildPlan({
    ...input(), document: universal22.document, universalResult: universal22,
    phase2Result: undefined, phase3Result: undefined
  });
  assert.strictEqual(plan22.actions.filter((item) =>
    ['business_item', 'company_knowledge'].includes(item.record_kind)).length, 22);
  const vault22 = new MemoryVault();
  const first22 = await commitPlan({ ...plan22, mode: 'structured-write' }, {
    vault: vault22, lock: lock(), stateRoot: '状态', index: emptyIndex(),
    logicalTime: TIME, saveIndex: async () => {}
  });
  assert.strictEqual(first22.verified.counts.knowledge_records, 22);
  assert.strictEqual(first22.verified.counts.knowledge_created, 22);
  assert.strictEqual(first22.verified.counts.source_records, 1);
  assert.strictEqual(first22.verified.counts.project_records, 0);
  const existingFiles22 = Object.fromEntries([...vault22.files].filter(([filePath]) => filePath.endsWith('.md')));
  const rerun22 = buildPlan({
    ...input(), document: universal22.document, universalResult: universal22,
    phase2Result: undefined, phase3Result: undefined,
    index: first22.index, existingFiles: existingFiles22
  });
  const second22 = await commitPlan({ ...rerun22, mode: 'structured-write' }, {
    vault: vault22, lock: lock(), stateRoot: '状态', index: first22.index,
    logicalTime: TIME, saveIndex: async () => {}
  });
  assert.strictEqual(second22.verified.counts.knowledge_records, 22);
  assert.strictEqual(second22.verified.counts.knowledge_unchanged, 22);
  assert.strictEqual(new Set(second22.verified.knowledge_paths).size, 22);

  const noopVault = new NoopRecordVault();
  await assert.rejects(() => commitPlan({ ...plan22, mode: 'structured-write' }, {
    vault: noopVault, lock: lock(), stateRoot: '状态', index: emptyIndex(),
    logicalTime: TIME, saveIndex: async () => {}
  }), (error) => error.code === 'STRUCTURED_RECORD_VERIFICATION_FAILED'
    && error.details.reason === 'missing_file');

  await realPhasePath();
  const production = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
  assert(production.includes('await this.runStructuredWriterPhase(current, parsePackage)'));
  assert(production.includes('if (!universalProduction) workflow = await runKnowledgeWorkflow({'),
    'universal production must bypass the legacy card workflow');
  assert(production.includes("if (!structuredWriteMode) {"), 'cutover must suppress legacy writes');
  const writerStart = production.indexOf('  async runStructuredWriterPhase(task, parsePackage) {');
  const writerEnd = production.indexOf('\n  async writeAcceptedCard(', writerStart);
  const writerProduction = production.slice(writerStart, writerEnd);
  assert(!writerProduction.includes('runPhase2CandidatePipeline('),
    'production adapter must add zero Phase 2 calls');
  assert(!writerProduction.includes('evaluatePhase3('),
    'production adapter must add zero Phase 3 evaluations');
  assert(production.includes("if (mode === 'structured-pilot') return { mode, plan, universalResult: universal };"),
    'pilot must return before commit');
  assert(production.includes("process?.env?.EKS_ENABLE_NONPRODUCTION_LEGACY === '1'"),
    'legacy workflow must be reachable only through an explicit nonproduction environment gate');
  assert(production.includes("process?.env?.EKS_ENABLE_NONPRODUCTION_PILOT === '1'"),
    'pilot mode must be reachable only through an explicit nonproduction environment gate');
  console.log('structured writer production tests: ok');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
