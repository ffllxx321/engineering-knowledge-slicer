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
    key_points: [{ point_id: 'P1', kind: 'requirement', content: '唯一证据', evidence_ids: ['E1'] }],
    evidence: [{ evidence_id: 'E1', block_id: 'document-block', locator: '', quote: '唯一证据' }],
    suggested_links: [],
    coverage: { chunk_ids: chunkIds, complete: true },
    model_confidence: 1,
    schema_version: '1.1'
  }, overrides);
}

function mapSummary(context, overrides = {}) {
  const quote = context.chunk.markdown;
  return summary([context.chunk.chunk_id], Object.assign({
    executive_summary: context.chunk.chunk_id,
    key_points: [{ point_id: 'P1', kind: 'requirement', content: quote, evidence_ids: ['E1'] }],
    evidence: [{ evidence_id: 'E1', block_id: 'document-block', locator: '', quote }]
  }, overrides));
}

function options(requestJson, cache = new Map()) {
  const markdown = '# A 唯一证据\n' + '甲'.repeat(700) + '\n# B\n' + '乙'.repeat(700);
  return {
    parsePackage: {
      source_name: '大型 PDF',
      markdown,
      blocks: [{ block_id: 'document-block', raw: { text: markdown }, locator: { scheme: 'line', value: '1-末行' }, card_eligible: true }],
      evidence_index: {
        'document-block': {
          block_id: 'document-block', raw_text: markdown,
          locator: { scheme: 'line', value: '1-末行' }, card_eligible: true
        }
      },
      provenance: { spans: [] }
    },
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
      return mapSummary(context);
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
    if (context.stage === 'summary-map') return mapSummary(context);
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
      return mapSummary(context);
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

async function testProduction8192HierarchyAndReduceCheckpointResume() {
  const { api, diagCalls } = loadAiPipeline();
  const cache = new Map();
  const reduceCache = new Map();
  const markdown = Array.from({ length: 26 }, (_, index) =>
    `# 第 ${index + 1} 节${index === 0 ? ' 唯一证据' : ''}\n${String.fromCharCode(0x4e00 + index).repeat(520)}`
  ).join('\n');
  let mapCalls = 0;
  const mappedChunkIds = new Set();
  let reduceCalls = 0;
  let failAfter = 3;
  const base = options(async (_prompt, context) => {
    if (context.stage === 'summary-map') {
      mapCalls += 1;
      mappedChunkIds.add(context.chunk.chunk_id);
      return mapSummary(context, { executive_summary: `分块 ${context.chunk.chunk_id}` });
    }
    reduceCalls += 1;
    if (reduceCalls === failAfter) throw new Error('deterministic interrupted reduce');
    return summary(context.chunkIds);
  }, cache);
  Object.assign(base, {
    parsePackage: {
      source_name: '生产 8192 故障',
      markdown,
      blocks: [{ block_id: 'document-block', raw: { text: markdown }, locator: { scheme: 'line', value: '1-末行' }, card_eligible: true }],
      evidence_index: {
        'document-block': {
          block_id: 'document-block', raw_text: markdown,
          locator: { scheme: 'line', value: '1-末行' }, card_eligible: true
        }
      },
      provenance: { spans: [] }
    },
    maxChunkChars: 600,
    reduceInputBudgetChars: 7000,
    reduceBatchSize: 8,
    loadSummaryReduceChunk: ({ stableReduceId }) => reduceCache.get(stableReduceId),
    saveSummaryReduceChunk: ({ stableReduceId }, value) => reduceCache.set(stableReduceId, value)
  });
  await assert.rejects(api.summarizeDocument(base), /interrupted reduce/);
  assert.strictEqual(mappedChunkIds.size, 26, 'fixture reproduces the production 26-map reduce shape');
  assert(reduceCache.size > 0, 'completed reduce groups are checkpointed before a later group fails');
  const mapsAfterFailure = mapCalls;
  const checkpointsAfterFailure = reduceCache.size;
  reduceCalls = 0;
  failAfter = -1;
  base.requestJson = async (_prompt, context) => {
    assert.strictEqual(context.stage, 'summary-reduce', 'all 26 successful maps must be reused');
    reduceCalls += 1;
    const error = new Error('MiniMax output exactly reached 8192 tokens');
    error.code = 'AI_OUTPUT_TRUNCATED';
    throw error;
  };
  const recovered = await api.summarizeDocument(base);
  assert.strictEqual(mapCalls, mapsAfterFailure);
  assert(reduceCache.size >= checkpointsAfterFailure);
  assert.strictEqual(recovered.coverage.complete, true);
  assert.strictEqual(recovered.coverage.chunk_ids.length, mappedChunkIds.size, 'lossless fallback preserves exact complete source coverage');
  assert.deepStrictEqual(new Set(recovered.coverage.chunk_ids), mappedChunkIds);
  assert(diagCalls.some(({ scope }) => scope === 'summary.reduce.plan'));
  assert(diagCalls.some(({ scope }) => scope === 'summary.reduce.truncationRecovered'));
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
  await testProduction8192HierarchyAndReduceCheckpointResume();
  testErrorClassificationAndCounters();
  console.log('summary reduce recovery: 15 assertions passed');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
