'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { loadAiPipeline } = require('./load-ai-pipeline.js');
const { loadBundleModule } = require('./load-bundle-module.js');

const root = path.join(__dirname, '..');
const schemaValidator = loadBundleModule('src/core/schema-validator.js');
const { api } = loadAiPipeline({ schemaValidator });
const summarySchema = JSON.parse(fs.readFileSync(path.join(root, '组件包/schemas/structured-summary.schema.json'), 'utf8'));
const classification = { library: 'business', folder_type: '90-通用知识库', document_type: '工程记录' };
const taskModule = loadBundleModule('src/core/task.js', { crypto, path });
const completion = loadBundleModule('src/core/completion-ui.js', { 'src/core/task.js': taskModule });
const { migrateTaskLedgerV3 } = loadBundleModule('src/core/migration.js', { crypto });

function exactLengthText(length) {
  const lead = '结构安全要求：施工前必须完成专项检查并记录结果。\n';
  const fill = '设备检查记录应完整保存，异常情况必须立即处置。\n';
  return (lead + fill.repeat(Math.ceil(length / fill.length))).slice(0, length);
}

function pkgFor(text, id = 'source-block-001') {
  return {
    parser: 'local-text',
    source_name: '生产回归',
    markdown: text,
    blocks: [{ block_id: id, raw: { text }, locator: { scheme: 'line', value: '1-末行' }, card_eligible: true }],
    evidence_index: {
      [id]: { block_id: id, raw_text: text, locator: { scheme: 'line', value: '1-末行' }, card_eligible: true }
    },
    provenance: { spans: [] }
  };
}

function summary(chunkId, blockId, quote) {
  const valid = Boolean(quote);
  return {
    document_title: '生产回归',
    library: classification.library,
    folder_type: classification.folder_type,
    document_type: classification.document_type,
    executive_summary: valid ? quote : '',
    entities: [],
    key_points: valid ? [{ point_id: `P-${chunkId}`, kind: 'requirement', content: quote, evidence_ids: [`E-${chunkId}`] }] : [],
    evidence: valid ? [{ evidence_id: `E-${chunkId}`, block_id: blockId, locator: '', quote }] : [],
    suggested_links: [],
    coverage: { chunk_ids: [chunkId], complete: true },
    model_confidence: valid ? 0.9 : 0,
    schema_version: '1.1'
  };
}

function options(parsePackage, requestJson, extra = {}) {
  return Object.assign({
    parsePackage,
    classification,
    basePrompt: '基础总结',
    typePrompt: '工程记录',
    summarySchema,
    requestJson,
    maxRepairAttempts: 0,
    summaryConcurrency: 1,
    maxChunkChars: 6000,
    reduceBatchSize: 8
  }, extra);
}

async function boundedMarkdown(length, expectedChunks) {
  const parsePackage = pkgFor(exactLengthText(length));
  const seen = [];
  const result = await api.summarizeDocument(options(parsePackage, async (prompt, context) => {
    if (context.stage === 'summary-reduce') {
      const quote = context.chunkIds.length ? seen[0].quote : '';
      return {
        ...summary(context.chunkIds[0], parsePackage.blocks[0].block_id, quote),
        coverage: { chunk_ids: context.chunkIds, complete: true }
      };
    }
    const chunk = context.chunk;
    assert.strictEqual(context.chunkId, chunk.chunk_id);
    assert.strictEqual(chunk.chunk_id, chunk.stableChunkId);
    assert.strictEqual(chunk.sourceBlocks.length, 1);
    const source = chunk.sourceBlocks[0];
    assert(source.text.length > 0 && source.text.length <= chunk.markdown.length);
    assert.strictEqual(source.block_id, 'source-block-001');
    assert.strictEqual(source.locator.scheme, 'line');
    assert.strictEqual(source.locator.source_span.bounded, expectedChunks > 1);
    assert(prompt.includes(`coverage.chunk_ids 必须且只能包含 ["${chunk.chunk_id}"]`));
    assert(prompt.includes('"source_span"'));
    const quote = source.text.slice(0, Math.min(24, source.text.length));
    seen.push({ id: chunk.chunk_id, quote, source: source.text });
    return summary(chunk.chunk_id, source.block_id, quote);
  }));
  assert.strictEqual(seen.length, expectedChunks);
  assert.strictEqual(new Set(seen.map((item) => item.id)).size, expectedChunks);
  assert(seen.every((item) => item.source.includes(item.quote)));
  assert.deepStrictEqual(new Set(result.coverage.chunk_ids), new Set(seen.map((item) => item.id)));
}

async function allEmptyStopsBeforeDownstream() {
  const parsePackage = pkgFor(exactLengthText(11371));
  let mapCalls = 0;
  let reduceCalls = 0;
  const error = await api.summarizeDocument(options(parsePackage, async (_prompt, context) => {
    if (context.stage === 'summary-reduce') reduceCalls += 1;
    else mapCalls += 1;
    return summary(context.chunk?.chunk_id || context.chunkIds?.[0], 'source-block-001', '');
  })).then(() => null, (value) => value);
  assert.strictEqual(error.code, 'SUMMARY_ALL_CHUNKS_UNSUPPORTED');
  assert.strictEqual(error.details.outcome, 'no_verified_knowledge');
  assert.strictEqual(mapCalls, 2);
  assert.strictEqual(reduceCalls, 0);

  let atomProviderCalls = 0;
  const atomError = await api.atomizeSummary({
    summary: { key_points: [] },
    requestJson: async () => { atomProviderCalls += 1; return {}; }
  }).then(() => null, (value) => value);
  assert.strictEqual(atomError.code, 'SUMMARY_ALL_CHUNKS_UNSUPPORTED');
  assert.strictEqual(atomError.details.requestedPoints, 0);
  assert.strictEqual(atomProviderCalls, 0);
}

async function mixedLegacyCacheResume() {
  const parsePackage = pkgFor(exactLengthText(11371));
  const planned = api.splitMarkdownSections(parsePackage.markdown, { maxChars: 6000 });
  assert.strictEqual(planned.length, 2);
  const firstQuote = planned[0].markdown.slice(0, 24);
  const legacyCached = summary('chunk-001', 'source-block-001', firstQuote);
  legacyCached.evidence = legacyCached.evidence.map((item) =>
    api.reconcileBlockEvidence(parsePackage, item, new Set(['source-block-001'])));
  const cached = api.sanitizeSummaryEvidence(legacyCached);
  let mapCalls = 0;
  let reduceCalls = 0;
  const result = await api.summarizeDocument(options(parsePackage, async (_prompt, context) => {
    if (context.stage === 'summary-reduce') {
      reduceCalls += 1;
      return { ...cached, coverage: { chunk_ids: context.chunkIds, complete: true } };
    }
    mapCalls += 1;
    return summary(context.chunk.chunk_id, 'source-block-001', '');
  }, {
    loadSummaryMapChunk: async (chunk) => chunk.legacyChunkId === 'chunk-001' ? cached : null
  }));
  assert.strictEqual(mapCalls, 1, 'valid legacy-id checkpoint must not be requested again');
  assert.strictEqual(reduceCalls, 1);
  assert(result.key_points.length > 0);
  assert(result.coverage.chunk_ids.every((id) => id.startsWith('chunk-') && id.length > 'chunk-001'.length));
}

function reviewAndMigration() {
  const zero = {
    task_id: 'zero', run_id: 'run-zero', schema_version: '1.1', status: 'completed_no_output',
    review_atom_ids: [], artifacts: { review: 'review.json' },
    result_counts: { generated: 0, written: 0, review: 0 },
    progress: { stage: 'complete', message: '所有分块均无可核验知识。' }
  };
  let snapshot = completion.completionUiSnapshot([zero], 'zero');
  assert.strictEqual(snapshot.reviewCount, 0);
  assert.strictEqual(snapshot.persistedReviewItemCount, 0);

  const real = { ...zero, task_id: 'real', status: 'needs_review', review_atom_ids: ['atom-1'] };
  snapshot = completion.completionUiSnapshot([real], 'real');
  assert.strictEqual(snapshot.reviewCount, 1);
  assert.strictEqual(snapshot.persistedReviewItemCount, 1);
  snapshot = completion.completionUiSnapshot([{ ...real, status: 'completed_no_output' }], 'real');
  assert.strictEqual(snapshot.reviewCount, 1, 'a concrete persisted item remains actionable even under a stale zero-output status');

  const [migratedPhantom, migratedReal] = migrateTaskLedgerV3([
    { ...zero, task_id: 'phantom', status: 'needs_review', terminal_outcome: 'needs_attention' },
    real
  ]);
  assert.strictEqual(migratedPhantom.status, 'completed_no_output');
  assert.strictEqual(migratedPhantom.terminal_outcome, 'completed_no_output');
  assert.deepStrictEqual(migratedPhantom.review_atom_ids, []);
  assert.strictEqual(migratedReal.status, 'needs_review');
  assert.deepStrictEqual(migratedReal.review_atom_ids, ['atom-1']);

  const main = fs.readFileSync(path.join(root, 'main.js'), 'utf8');
  assert(main.includes("if (snapshot.reviewCount > 0) view.activeSection = 'review';"));
  assert(main.includes("['needs_review', 'completed_no_output'].includes(task.status)") && main.includes('task.review_atom_ids.length > 0'));
  assert(main.includes('未生成可入库结果：生成 ${Number(counts.generated) || 0}，写入 ${Number(counts.written) || 0}'));
}

async function main() {
  await boundedMarkdown(11371, 2);
  await boundedMarkdown(780, 1);
  await allEmptyStopsBeforeDownstream();
  await mixedLegacyCacheResume();
  reviewAndMigration();
  console.log('production canonical-boundary regressions: 7 scenarios passed');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
