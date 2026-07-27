const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { loadAiPipeline } = require('./load-ai-pipeline.js');
const { loadBundleModule } = require('./load-bundle-module.js');

const schema = JSON.parse(fs.readFileSync(
  path.join(__dirname, '..', '组件包', 'schemas', 'structured-summary.schema.json'),
  'utf8'
));

function summary(chunkIds, overrides = {}) {
  return Object.assign({
    document_title: '大型 PDF',
    library: 'business',
    folder_type: 'project',
    document_type: 'report',
    executive_summary: '合并结果',
    entities: [],
    key_points: [],
    evidence: [],
    suggested_links: [],
    coverage: { chunk_ids: chunkIds, complete: true },
    model_confidence: 1,
    schema_version: '1.1'
  }, overrides);
}

function options(requestJson, cache = new Map()) {
  const markdown = '# A\n' + '甲'.repeat(700) + '\n# B\n' + '乙'.repeat(700);
  return {
    parsePackage: { source_name: '大型 PDF', markdown },
    classification: { library: 'business', folder_type: 'project', document_type: 'report' },
    basePrompt: 'summary',
    typePrompt: '',
    summarySchema: schema,
    maxChunkChars: 500,
    coalesceTinyChunks: false,
    summaryConcurrency: 2,
    maxRepairAttempts: 1,
    requestJson,
    loadSummaryMapChunk: (chunk) => cache.get(chunk.stableChunkId),
    saveSummaryMapChunk: (chunk, value) => cache.set(chunk.stableChunkId, value)
  };
}

async function testExactProductionWrapperSignature() {
  const { api } = loadAiPipeline();
  let reduceCalls = 0;
  let requested = [];
  const result = await api.summarizeDocument(options(async (_prompt, context) => {
    if (context.stage === 'summary-map') {
      return summary([context.chunk.chunk_id], { executive_summary: context.chunk.chunk_id });
    }
    reduceCalls += 1;
    requested = context.chunkIds;
    // Before the fix this yields exactly:
    // $.coverage is required；$.item is not allowed；总结分块覆盖不完整
    return { item: summary(context.chunkIds, { coverage: undefined }) };
  }));
  assert.strictEqual(reduceCalls, 1);
  assert.deepStrictEqual(result.coverage.chunk_ids, requested);
  assert.strictEqual(result.coverage.complete, true);
}

async function testIncompleteCoverageReconstructedFromRequestedMaps() {
  const { api } = loadAiPipeline();
  let requested = [];
  const result = await api.summarizeDocument(options(async (_prompt, context) => {
    if (context.stage === 'summary-map') return summary([context.chunk.chunk_id]);
    requested = context.chunkIds;
    return summary([context.chunkIds[0]], {
      coverage: { chunk_ids: [context.chunkIds[0]], complete: false }
    });
  }));
  assert.deepStrictEqual(result.coverage.chunk_ids, requested);
  assert.strictEqual(result.coverage.complete, true);
}

async function testUnsafeCoverageGetsOneBoundedRepairAndResumeSkipsMaps() {
  const { api } = loadAiPipeline();
  const cache = new Map();
  let mapCalls = 0;
  let reduceCalls = 0;
  let requested = [];
  const requestJson = async (_prompt, context) => {
    if (context.stage === 'summary-map') {
      mapCalls += 1;
      return summary([context.chunk.chunk_id]);
    }
    reduceCalls += 1;
    requested = context.chunkIds;
    if (reduceCalls === 1) return summary(['provider-invented-chunk']);
    return summary(context.chunkIds);
  };
  const first = await api.summarizeDocument(options(requestJson, cache));
  assert.strictEqual(reduceCalls, 2, 'unsafe coverage must receive exactly one schema-repair retry');
  assert.deepStrictEqual(first.coverage.chunk_ids, requested);
  const persistedMapCalls = mapCalls;
  reduceCalls = 0;
  await api.summarizeDocument(options(async (_prompt, context) => {
    assert.strictEqual(context.stage, 'summary-reduce', 'resume must not repeat persisted map calls');
    reduceCalls += 1;
    return summary(context.chunkIds);
  }, cache));
  assert.strictEqual(mapCalls, persistedMapCalls);
  assert.strictEqual(reduceCalls, 1);
}

function testErrorClassificationAndCounters() {
  const reliability = loadBundleModule('src/core/reliability.js');
  const classified = reliability.classifyFailure({
    message: '$.coverage is required；$.item is not allowed；总结分块覆盖不完整'
  });
  assert.strictEqual(classified.code, 'SCHEMA_OUTPUT_INVALID');
  assert.strictEqual(classified.category, 'schema');
  const main = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
  assert(main.includes('summaryReduceRequests: 0'));
  assert.strictEqual(
    (main.match(/summaryReduceRequests \+= 1/g) || []).length,
    2,
    'JSON and SSE provider calls must both count summary-reduce requests'
  );
}

async function main() {
  await testExactProductionWrapperSignature();
  await testIncompleteCoverageReconstructedFromRequestedMaps();
  await testUnsafeCoverageGetsOneBoundedRepairAndResumeSkipsMaps();
  testErrorClassificationAndCounters();
  console.log('summary reduce recovery: 15 assertions passed');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
