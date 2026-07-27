const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { loadAiPipeline } = require('./load-ai-pipeline.js');
const { loadBundleModule } = require('./load-bundle-module.js');

const schemaValidator = loadBundleModule('src/core/schema-validator.js');
const schema = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '组件包/schemas/knowledge-atoms.schema.json'), 'utf8'));

function fixtureSummary(count = 6) {
  return {
    document_title: '生产故障回归',
    key_points: Array.from({ length: count }, (_, i) => ({ point_id: `P${i + 1}`, content: `知识点 ${i + 1}`, evidence_ids: [`E${i + 1}`] })),
    evidence: Array.from({ length: count }, (_, i) => ({ evidence_id: `E${i + 1}`, locator: `第 ${i + 1} 页`, quote: `知识点 ${i + 1}` }))
  };
}

function atom(id, pointId) {
  return {
    atom_id: `A${id}`, title: `原子 ${id}`, card_kind: 'static', library: 'business', folder_type: 'project',
    content: { core_knowledge: `知识 ${id}`, point_ids: [pointId] },
    source: { source_link: '[[source]]', source_locator: '页', evidence_quote: '证据', parent_summary: '[[summary]]' },
    model_confidence: 0.9, validation_issues: [], related_candidates: []
  };
}

function batch(pointIds) {
  return { atoms: pointIds.map((id, index) => atom(`${id}-${index}`, id)), coverage: { point_ids: pointIds, complete: true }, schema_version: '1.1' };
}

async function exactSchemaRepair() {
  const { api } = loadAiPipeline({ schemaValidator });
  const summary = fixtureSummary(3);
  let calls = 0;
  const result = await api.atomizeSummary({
    summary, atomPrompt: 'atoms', typeMapping: 'map', tagLibrary: 'tags', linkCandidates: [],
    atomSchema: schema, maxPointsPerRequest: 3, atomizationConcurrency: 1, maxRepairAttempts: 1,
    requestJson: async (_prompt, context) => {
      calls += 1;
      if (context.attempt === 1) {
        const invalid = batch(context.pointIds);
        delete invalid.atoms[2].model_confidence;
        delete invalid.atoms[2].validation_issues;
        invalid.atoms[2].related_candidates = 'not-an-array';
        return invalid;
      }
      return batch(context.pointIds);
    }
  });
  assert.strictEqual(calls, 2, 'substantive schema failure gets one bounded targeted repair');
  assert.strictEqual(result.atoms.length, 3);
  assert.strictEqual(result.atoms[2].model_confidence, 0.9);
  assert(Array.isArray(result.atoms[2].validation_issues));
  assert(Array.isArray(result.atoms[2].related_candidates));
}

async function coordinatedSettlement() {
  const { api } = loadAiPipeline({ schemaValidator });
  const summary = fixtureSummary(6);
  const events = [];
  let active = 0;
  let lateSuccesses = 0;
  await assert.rejects(api.atomizeSummary({
    summary, atomPrompt: 'atoms', typeMapping: 'map', tagLibrary: 'tags', linkCandidates: [],
    atomSchema: schema, maxPointsPerRequest: 1, atomizationConcurrency: 3, maxRepairAttempts: 0,
    requestJson: (_prompt, context) => new Promise((resolve, reject) => {
      active += 1;
      const finish = () => { active -= 1; };
      if (context.pointIds[0] === 'P2') {
        setTimeout(() => {
          finish();
          const error = new Error('atom[2] schema invalid');
          error.code = 'AI_SCHEMA_OUTPUT_INVALID';
          reject(error);
        }, 5);
        return;
      }
      const timer = setTimeout(() => { finish(); lateSuccesses += 1; resolve(batch(context.pointIds)); }, 40);
      context.signal.addEventListener('abort', () => {
        clearTimeout(timer); finish();
        const error = new Error('aborted'); error.name = 'AbortError'; reject(error);
      }, { once: true });
    }),
    onProgress: (event) => events.push(event)
  }), /schema invalid/);
  assert.strictEqual(active, 0, 'all in-flight batch calls settle before terminal rejection');
  assert.strictEqual(lateSuccesses, 0, 'cancelled siblings cannot emit late successful batch logs');
  assert(!events.some((event) => event.batchIndex === event.batchTotal), 'failed run never reports complete progress');
}

async function checkpointResumeAndAggregationGate() {
  const { api } = loadAiPipeline({ schemaValidator });
  const summary = fixtureSummary(4);
  const checkpoints = new Map();
  let calls = [];
  const options = {
    summary, atomPrompt: 'atoms', typeMapping: 'map', tagLibrary: 'tags', linkCandidates: [],
    atomSchema: schema, maxPointsPerRequest: 1, atomizationConcurrency: 1, maxRepairAttempts: 0,
    loadAtomBatch: ({ stableBatchId }) => checkpoints.get(stableBatchId),
    saveAtomBatch: ({ stableBatchId }, value) => checkpoints.set(stableBatchId, value),
    requestJson: async (_prompt, context) => {
      const id = context.pointIds[0];
      calls.push(id);
      if (id === 'P4') throw new Error('terminal P4 failure');
      return batch(context.pointIds);
    }
  };
  await assert.rejects(api.atomizeSummary(options), /terminal P4 failure/);
  assert.strictEqual(checkpoints.size, 3, 'each valid batch is checkpointed before later failure');
  assert.strictEqual(checkpoints.has(undefined), false, 'checkpoint key is deterministic');
  calls = [];
  let aggregateArtifacts = 0;
  const resumed = await api.atomizeSummary(Object.assign({}, options, {
    requestJson: async (_prompt, context) => { calls.push(context.pointIds[0]); return batch(context.pointIds); }
  }));
  if (resumed.coverage.complete) aggregateArtifacts += 1;
  assert.deepStrictEqual(calls, ['P4'], 'resume calls only the failed/missing batch');
  assert.strictEqual(resumed.atoms.length, 4);
  assert.strictEqual(aggregateArtifacts, 1, 'aggregate becomes eligible only after exact full valid completion');
}

function uiProductionSemantics() {
  const source = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
  const css = fs.readFileSync(path.join(__dirname, '..', 'styles.css'), 'utf8');
  assert(source.includes("const state = activeTask ? 'running'"), 'running state has priority over stale errors');
  assert.strictEqual((source.match(/eks-primary-button/g) || []).length, 1, 'dashboard defines one primary action slot');
  for (const token of ["role: 'tablist'", "role', 'tab'", "role: 'tabpanel'", "'aria-selected'", 'handleTabKey']) assert(source.includes(token), `progressive disclosure semantics: ${token}`);
  assert(source.includes(".filter((task) => task.status === 'failed')"), 'error center excludes old errors on running tasks');
  assert(source.includes("value === undefined || value === null || value === ''")
    && source.includes('safeDisplayText'), 'undefined values are suppressed');
  assert(css.includes('@media (max-width: 420px)') && css.includes('overflow-x: hidden') && css.includes('min-width: 0'), 'narrow layout prevents horizontal overflow');
  assert(css.includes(':focus-visible') && source.includes("'aria-live': 'polite'"), 'focus and live-region support remain present');
}

async function main() {
  await exactSchemaRepair();
  await coordinatedSettlement();
  await checkpointResumeAndAggregationGate();
  uiProductionSemantics();
  console.log('production repair regressions: 23 assertions passed');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
