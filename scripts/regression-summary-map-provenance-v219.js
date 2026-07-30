'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { loadAiPipeline } = require('./load-ai-pipeline.js');
const { loadBundleModule } = require('./load-bundle-module.js');

const { api: ai } = loadAiPipeline({
  schemaValidator: loadBundleModule('src/core/schema-validator.js')
});
const schema = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '组件包/schemas/structured-summary.schema.json'), 'utf8'));
const classification = { library: 'business', folder_type: '06-风险库', document_type: '工程记录' };

function parsePackage() {
  const a = `泵送压力不得超过 5 MPa。\n发生报警时应立即停机检查。\n${'设备运行记录应完整保存。'.repeat(8)}`;
  const b = `验收合格后方可投入使用。\n记录编号为Ａ１２３。\n${'检查结果应由负责人确认。'.repeat(8)}`;
  return {
    parser: 'local-text',
    source_name: '回归文档',
    markdown: `${a}\n\n${b}`,
    block_packs: [
      { pack_id: 'pack-a', text: a, block_ids: ['block-a'], token_count: 20 },
      { pack_id: 'pack-b', text: b, block_ids: ['block-b'], token_count: 20 }
    ],
    blocks: [
      { block_id: 'block-a', raw: { text: a }, locator: { scheme: 'page', value: '1', page: 1 } },
      { block_id: 'block-b', raw: { text: b }, locator: { scheme: 'row', value: '验收!7' } }
    ],
    evidence_index: {
      'block-a': { block_id: 'block-a', raw_text: a, locator: { scheme: 'page', value: '1', page: 1 }, card_eligible: true },
      'block-b': { block_id: 'block-b', raw_text: b, locator: { scheme: 'row', value: '验收!7' }, card_eligible: true }
    },
    provenance: { spans: [] }
  };
}

function summary(chunkId, items) {
  return {
    document_title: '回归文档',
    library: 'business',
    folder_type: '06-风险库',
    document_type: '工程记录',
    executive_summary: '经过逐字验证的总结',
    entities: [],
    key_points: items.map((item, index) => ({
      point_id: `P${index + 1}`, kind: 'requirement', content: item.content, evidence_ids: [`EV${index + 1}`]
    })),
    evidence: items.map((item, index) => ({
      evidence_id: `EV${index + 1}`, block_id: item.block_id, locator: item.locator || '', quote: item.quote
    })),
    suggested_links: [],
    coverage: { chunk_ids: [chunkId], complete: true },
    model_confidence: 0.8,
    schema_version: '1.1'
  };
}

function options(pkg, requestJson, extra = {}) {
  return Object.assign({
    parsePackage: pkg,
    classification,
    basePrompt: '旧组件基础提示词（没有 block_id 契约）',
    typePrompt: '旧类型提示词',
    summarySchema: schema,
    requestJson,
    maxRepairAttempts: 1,
    summaryConcurrency: 1,
    reduceBatchSize: 8,
    maxChunkChars: 100
  }, extra);
}

async function mixedAndEmpty() {
  const pkg = parsePackage();
  let mapRequests = 0;
  const prompts = [];
  const result = await ai.summarizeDocument(options(pkg, async (prompt, context) => {
    prompts.push(prompt);
    if (context.stage === 'summary-reduce') {
      return {
        ...summary('unused', []),
        key_points: context.chunkIds.includes('block-pack-002') ? [{
          point_id: 'P-valid', kind: 'requirement', content: '验收合格后方可投入使用。',
          evidence_ids: ['EV-valid']
        }] : [],
        evidence: [{
          evidence_id: 'EV-valid', block_id: 'block-b', locator: '伪造定位',
          quote: '验收合格后方可投入使用。'
        }],
        coverage: { chunk_ids: context.chunkIds, complete: true }
      };
    }
    mapRequests += 1;
    if (context.chunk.chunk_id === 'block-pack-001') {
      return summary(context.chunk.chunk_id, Array.from({ length: 12 }, (_, index) => ({
        block_id: 'block-a', quote: `模型改写且来源不存在 ${index}`, content: `无依据点 ${index}`
      })));
    }
    return summary(context.chunk.chunk_id, [
      { block_id: 'block-b', quote: '投入使用前需要完成验收。', content: '无依据改写' },
      { block_id: 'block-b', quote: '验收合格后方可投入使用。', content: '验收合格后方可投入使用。' }
    ]);
  }));
  assert.strictEqual(mapRequests, 2, 'unsupported evidence must not retry whole map chunks');
  assert(result.key_points.length >= 1);
  assert(result.evidence.every((item) => item.provenance.block_id === 'block-b'));
  assert(result.evidence.every((item) => item.locator === 'row:验收!7'));
  assert(prompts.some((prompt) => prompt.includes('运行时逐字证据契约') &&
    prompt.includes('"block_id": "block-a"') && prompt.includes('"scheme": "page"')));
}

async function allEmptyFailsOnce() {
  const pkg = parsePackage();
  let requests = 0;
  await assert.rejects(() => ai.summarizeDocument(options(pkg, async (_prompt, context) => {
    requests += 1;
    return summary(context.chunk.chunk_id, Array.from({ length: 9 }, (_, index) => ({
      block_id: context.chunk.block_ids[0], quote: `不存在的释义 ${index}`, content: `释义 ${index}`
    })));
  })), (error) => error.code === 'SUMMARY_ALL_CHUNKS_UNSUPPORTED' &&
    error.details.empty_verified_chunks === 2);
  assert.strictEqual(requests, 2);
}

async function cacheAndAtomization() {
  const pkg = parsePackage();
  const cached = summary('block-pack-002', [{
    block_id: 'block-b', quote: '验收合格后方可投入使用。', content: '验收合格后方可投入使用。'
  }]);
  cached.evidence = cached.evidence.map((item) => ai.reconcileBlockEvidence(pkg, item, new Set(['block-b'])));
  const sanitized = ai.sanitizeSummaryEvidence(cached);
  let requests = 0;
  const result = await ai.summarizeDocument(options(pkg, async (_prompt, context) => {
    if (context.stage === 'summary-map') {
      requests += 1;
      throw new Error('cache should prevent provider call');
    }
    return {
      ...sanitized,
      coverage: { chunk_ids: context.chunkIds, complete: true }
    };
  }, {
    loadSummaryMapChunk: async (chunk) => chunk.chunk_id === 'block-pack-002'
      ? sanitized
      : {
        ...summary('block-pack-001', []),
        map_status: 'unsupported',
        evidence_sanitization: { dropped_evidence: 0, dropped_points: 0, reasons: {} }
      }
  }));
  assert.strictEqual(requests, 0);
  const atoms = ai.normalizeAtomBatch({
    atoms: [{
      atom_id: 'A1', title: '验收要求', card_kind: 'static', library: 'business',
      folder_type: '06-风险库', content: { point_ids: [result.key_points[0].point_id] },
      source: {}, model_confidence: 0.8, validation_issues: [], related_candidates: []
    }],
    coverage: { point_ids: [result.key_points[0].point_id], complete: true },
    schema_version: '1.1'
  }, result, [result.key_points[0].point_id]);
  assert.strictEqual(atoms.atoms[0].source.source_provenance.block_id, 'block-b');
  assert.strictEqual(atoms.atoms[0].source.source_locator, 'row:验收!7');
}

function deterministicReconciliation() {
  const pkg = parsePackage();
  const normalized = ai.reconcileBlockEvidence(pkg, {
    evidence_id: 'nfkc', block_id: 'block-b', quote: '记录编号为A123。'
  }, new Set(['block-b']));
  assert.strictEqual(normalized.provenance_resolution.ok, true);
  assert.strictEqual(normalized.quote, '记录编号为Ａ１２３。');
  const lineBreak = ai.reconcileBlockEvidence(pkg, {
    evidence_id: 'ocr', block_id: 'block-a', quote: '泵送压力不得超过 5 MPa。 发生报警时应立即停机检查。'
  }, new Set(['block-a']));
  assert.strictEqual(lineBreak.provenance_resolution.ok, true);
  assert.strictEqual(ai.reconcileBlockEvidence(pkg, {
    evidence_id: 'cross', block_id: 'block-a', quote: '验收合格后方可投入使用。'
  }, new Set(['block-a'])).provenance_resolution.ok, false);
  assert.strictEqual(ai.reconcileBlockEvidence(pkg, {
    evidence_id: 'fuzzy', block_id: 'block-a', quote: '泵送压力最高允许 5 MPa。'
  }, new Set(['block-a'])).provenance_resolution.ok, false);
}

async function main() {
  deterministicReconciliation();
  await mixedAndEmpty();
  await allEmptyFailsOnce();
  await cacheAndAtomization();
  console.log('summary-map provenance regression: 4 scenarios, 2 chunks, mixed sanitize, typed empty, cache/atom provenance, NFKC/OCR exactness and no fuzzy/cross-block acceptance passed');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
