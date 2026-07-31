'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { runUniversalPipeline } = require('../src/universal-knowledge-pipeline.js');
const { buildPlan, emptyIndex } = require('../src/structured-writer.js');

const main = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
const methodStart = main.indexOf('  async runStructuredWriterPhase(task, parsePackage) {');
const methodEnd = main.indexOf('\n  async writeAcceptedCard(', methodStart);
assert(methodStart > 0 && methodEnd > methodStart, 'universal writer production boundary must exist');
const writer = main.slice(methodStart, methodEnd);

assert(!writer.includes('runPhase2CandidatePipeline('), 'universal writer must never call Phase 2');
assert(!writer.includes('evaluatePhase3('), 'universal writer must never evaluate Phase 3');
assert(!writer.includes('workflow.accepted'), 'universal writer must not rebuild accepted cards');
assert(!writer.includes('workflow.review'), 'universal writer must not rebuild review cards');
assert(!writer.includes('requestJson'), 'universal writer must add zero provider requests');
assert(!writer.includes("'phase2-structured'"), 'universal writer must not persist Phase 2 artifacts');
assert(!writer.includes("'phase3-structured'"), 'universal writer must not persist Phase 3 artifacts');

const outerStart = main.indexOf('      const universalProduction = ');
const outerEnd = main.indexOf("      diag('performance.counters'", outerStart);
const outer = main.slice(outerStart, outerEnd);
assert(outer.includes('if (!universalProduction) workflow = await runKnowledgeWorkflow({'),
  'legacy card workflow must be bypassed in universal production');
assert(outer.includes("semantic_path: universalProduction ? 'universal' : 'legacy'"),
  'review artifact must declare its semantic decision path');
assert(outer.includes('items: universalProduction ? [] : legacyReview'),
  'legacy reviews must not leak into universal review UI');
assert(outer.includes('rejected: universalProduction ? [] : legacyRejected'),
  'legacy rejections must not leak into universal review UI');

const document = {
  source_identity: 'universal-regression', source_document_id: 'doc-universal',
  source_path: '资料/安全要求.md', source_hash: 'a'.repeat(64), title: '安全要求',
  source_type: 'markdown', media_type: 'text/markdown', ingested_at: '2026-07-31T00:00:00.000Z',
  metadata: { library: 'business' },
  blocks: [{
    schema_version: 'block_v0', block_id: 'block-universal-0001', source_hash: 'a'.repeat(64),
    order: 1, parent_id: null, kind: 'paragraph',
    locator: { scheme: 'line', value: '1' }, provenance: [{ scheme: 'line', value: '1' }],
    raw: { text: '施工前必须完成安全检查并保存记录。', fields: {} }, inferred: {},
    parse: { method: 'local', quality: 1, status: 'present' }, card_eligible: true,
    exclusion_reason: null, metadata: {}
  }]
};
const universalResult = runUniversalPipeline({ document });
assert.strictEqual(universalResult.telemetry.llm_calls, 0);
assert.strictEqual(universalResult.telemetry.llm_tokens, 0);
const legacyPoison = {
  handling_groups: [{ cause: 'LEGACY_REVIEW_MUST_NOT_LEAK', items: [{ atom_id: 'old-review' }] }]
};
for (const mode of ['structured-pilot', 'structured-write']) {
  const plan = buildPlan({
    settings: {
      controlledWriterEnabled: true, structuredWriterMode: mode,
      structuredActiveRoot: '在办投标库', structuredBusinessRoot: '长期业务库',
      artifactsPath: '状态', structuredMaxRecords: 100, structuredMaxActions: 300,
      structuredMaxLinkFanout: 20
    },
    document, universalResult, phase3Result: legacyPoison, projectRegistry: [],
    index: emptyIndex(), existingFiles: {}, logicalTime: document.ingested_at
  });
  assert(!JSON.stringify(plan).includes('LEGACY_REVIEW_MUST_NOT_LEAK'),
    `${mode} must ignore legacy Phase 3 review state`);
  assert(plan.actions.length > 0, `${mode} must produce a universal plan`);
}

console.log('universal production path regression: ok');
