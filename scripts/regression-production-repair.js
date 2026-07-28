const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { loadAiPipeline } = require('./load-ai-pipeline.js');
const { loadBundleModule } = require('./load-bundle-module.js');

const schemaValidator = loadBundleModule('src/core/schema-validator.js');
const schema = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '组件包/schemas/knowledge-atoms.schema.json'), 'utf8'));

function loadProductionRateLimiter() {
  const source = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
  const start = source.indexOf('class RateLimiter {');
  const end = source.indexOf('\nfunction abortError()', start);
  assert(start >= 0 && end > start, 'production RateLimiter source is discoverable');
  const diagnostics = [];
  const factory = new Function('diag', 'sleepWithSignal', 'abortError',
    `${source.slice(start, end)}\nreturn RateLimiter;`);
  const RateLimiter = factory(
    (scope, payload) => diagnostics.push({ scope, payload }),
    async () => {},
    () => Object.assign(new Error('cancelled'), { name: 'AbortError', code: 'TASK_CANCELLED' })
  );
  return { RateLimiter, diagnostics };
}

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

async function rejectsError(promise, pattern) {
  try {
    await promise;
  } catch (error) {
    assert(pattern.test(String(error?.message || error)), `expected ${pattern}, received ${error?.message || error}`);
    return error;
  }
  assert.fail(`expected rejection matching ${pattern}`);
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
  const saved = new Set();
  const failure = await rejectsError(api.atomizeSummary({
    summary, atomPrompt: 'atoms', typeMapping: 'map', tagLibrary: 'tags', linkCandidates: [],
    atomSchema: schema, maxPointsPerRequest: 1, atomizationConcurrency: 3, maxRepairAttempts: 0,
    requestJson: (_prompt, context) => new Promise((resolve, reject) => {
      if (context.pointIds[0] === 'P2') {
        setTimeout(() => {
          const error = new Error('atom[2] schema invalid');
          error.code = 'AI_SCHEMA_OUTPUT_INVALID';
          reject(error);
        }, 5);
        return;
      }
      setTimeout(() => resolve(batch(context.pointIds)), 10);
    }),
    saveAtomBatch: ({ pointIds }) => saved.add(pointIds[0]),
    onProgress: (event) => events.push(event)
  }), /仅完成 5\/6 批/);
  assert.strictEqual(failure.code, 'ATOMIZATION_BATCH_INCOMPLETE');
  assert.strictEqual(failure.retryable, true);
  assert.deepStrictEqual([...saved].sort(), ['P1', 'P3', 'P4', 'P5', 'P6'],
    'one rejected request does not poison workers; every other success is durable');
  assert(!events.some((event) => event.batchComplete && event.batchIndex === event.batchTotal),
    'failed run never reports complete validated progress');
}

async function checkpointReadFailureDoesNotKillWorker() {
  const { api, diagCalls } = loadAiPipeline({ schemaValidator });
  const summary = fixtureSummary(8);
  const cached = new Map(Array.from({ length: 8 }, (_, index) => [`P${index + 1}`, batch([`P${index + 1}`])]));
  const error = await rejectsError(api.atomizeSummary({
    summary, atomPrompt: 'atoms', typeMapping: 'map', tagLibrary: 'tags', linkCandidates: [],
    atomSchema: schema, maxPointsPerRequest: 1, atomizationConcurrency: 2, maxRepairAttempts: 0,
    loadAtomBatch: ({ pointIds }) => {
      if (pointIds[0] === 'P2') throw new Error('transient vault read failure');
      return cached.get(pointIds[0]);
    },
    requestJson: async () => { throw new Error('cache-backed batches must not call provider'); }
  }), /仅完成 7\/8 批/);
  assert.strictEqual(error.details.failedBatches[0].code, 'ATOMIZATION_CHECKPOINT_READ_FAILED');
  assert.strictEqual(diagCalls.filter((entry) => entry.scope === 'atomization.batch.cacheHit').length, 7,
    'the surviving worker drains every other cached batch');
}

async function resumedRunWith104Batches() {
  const { api } = loadAiPipeline({ schemaValidator });
  const { RateLimiter, diagnostics } = loadProductionRateLimiter();
  const limiter = new RateLimiter({ intervalMs: 1000, maxConcurrent: 1, backoffMaxMs: 1000 });
  limiter.recordFailure(); // Simulate the preceding real provider failure in the production log.
  const summary = fixtureSummary(312);
  const checkpoints = new Map();
  for (let index = 0; index < 104; index += 1) {
    const pointIds = [`P${index * 3 + 1}`, `P${index * 3 + 2}`, `P${index * 3 + 3}`];
    if (index !== 26) checkpoints.set(pointIds.join('|'), batch(pointIds));
  }
  const providerCalls = [];
  const result = await api.atomizeSummary({
    summary, atomPrompt: 'atoms', typeMapping: 'map', tagLibrary: 'tags', linkCandidates: [],
    atomSchema: schema, maxPointsPerRequest: 3, atomizationConcurrency: 3, maxRepairAttempts: 0,
    loadAtomBatch: ({ pointIds }) => checkpoints.get(pointIds.join('|')),
    saveAtomBatch: ({ pointIds }, value) => checkpoints.set(pointIds.join('|'), value),
    requestJson: (_prompt, context) => limiter.run(async () => {
      providerCalls.push(context.pointIds.join('|'));
      return batch(context.pointIds);
    })
  });
  assert.deepStrictEqual(providerCalls, ['P79|P80|P81'], '104-batch resume calls only missing batch 27');
  assert.strictEqual(diagnostics.filter((entry) => entry.scope === 'ratelimit.backoff').length, 1,
    '103 cache hits bypass limiter accounting; only the real outbound request consumes prior cooldown');
  assert.strictEqual(limiter.failures, 0, 'the outbound success clears prior failure state');
  assert.strictEqual(result.atoms.length, 312);
  assert.strictEqual(result.coverage.complete, true);
  assert.strictEqual(checkpoints.size, 104);
}

async function limiterCancellationAndStaleFailureAccounting() {
  const { RateLimiter } = loadProductionRateLimiter();
  const limiter = new RateLimiter({ intervalMs: 100, maxConcurrent: 2, backoffMaxMs: 1000 });
  const originalNow = Date.now;
  let now = 10_000;
  Date.now = () => now;
  try {
    limiter.recordFailure();
    assert.strictEqual(limiter.backoffMs(), 100);
    now += 101;
    assert.strictEqual(limiter.backoffMs(), 0, 'expired failure cooldown cannot contaminate later cache-only recovery');
    const cancelled = Object.assign(new Error('cancelled sibling'), { name: 'AbortError', code: 'TASK_CANCELLED' });
    await assert.rejects(limiter.run(async () => { throw cancelled; }), /cancelled sibling/);
    assert.strictEqual(limiter.failures, 0, 'local cancellation is not a provider failure');
    await assert.rejects(limiter.run(async () => { throw new Error('real outbound failure'); }), /real outbound failure/);
    assert.strictEqual(limiter.failures, 1, 'real outbound failure is counted');
  } finally {
    Date.now = originalNow;
  }
}

function retryableDiagnosticsAndAggregateValidation() {
  const reliability = loadBundleModule('src/core/reliability.js');
  const error = Object.assign(new Error('知识原子化仅完成 103/104 批'), {
    code: 'ATOMIZATION_BATCH_INCOMPLETE',
    stage: 'atomization',
    category: 'ai_provider',
    retryable: true,
    details: { completedBatches: 103, batchTotal: 104, failedBatches: [{ batchIndex: 27, stableBatchId: '27-fixture' }] }
  });
  const appError = reliability.toAppError(error, { stage: 'writing' });
  assert.strictEqual(appError.stage, 'atomization');
  assert.strictEqual(appError.category, 'ai_provider');
  assert.strictEqual(appError.retryable, true);
  assert.strictEqual(appError.code, 'ATOMIZATION_BATCH_INCOMPLETE');
  assert.strictEqual(appError.details.failedBatches[0].batchIndex, 27);

  const { api } = loadAiPipeline({ schemaValidator });
  const invalidAggregate = batch(['P1']);
  invalidAggregate.coverage = { point_ids: ['P1'], complete: false };
  const validation = api.validateAtomizationResult(invalidAggregate, fixtureSummary(2), schema);
  assert(validation.errors.length > 0, 'partial aggregate cache is rejected before card generation');
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
  const firstFailure = await rejectsError(api.atomizeSummary(options), /仅完成 3\/4 批/);
  assert.strictEqual(firstFailure.details.failedBatches[0].message, 'terminal P4 failure');
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
  await checkpointReadFailureDoesNotKillWorker();
  await resumedRunWith104Batches();
  await limiterCancellationAndStaleFailureAccounting();
  retryableDiagnosticsAndAggregateValidation();
  await checkpointResumeAndAggregationGate();
  uiProductionSemantics();
  console.log('production repair regressions: batch settlement, cache recovery, 104-batch resume and aggregation gates passed');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
