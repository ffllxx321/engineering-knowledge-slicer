const assert = require('assert');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { loadBundleModule } = require('./load-bundle-module.js');
const { loadAiPipeline } = require('./load-ai-pipeline.js');

const block = loadBundleModule('src/core/block-v0.js', { crypto });
const provenance = loadBundleModule('src/core/provenance.js', { crypto });
const parser = loadBundleModule('src/core/document-parser.js', {
  crypto,
  'src/core/provenance.js': provenance,
  'src/core/block-v0.js': block
});
const reliability = loadBundleModule('src/core/reliability.js');
const { api, diagCalls } = loadAiPipeline();

function textOfLength(length) {
  let value = '';
  for (let index = 0; value.length < length; index += 1) {
    value += `第${String(index).padStart(6, '0')}段：验收结论必须逐字追溯，编号${index.toString(36).padStart(6, '0')}。\n`;
  }
  return value.slice(0, length);
}

function summarySchema() {
  return {
    type: 'object',
    required: ['document_title', 'overview', 'key_points', 'evidence', 'coverage'],
    properties: {
      document_title: { type: 'string' }, overview: { type: 'string' },
      key_points: { type: 'array', items: { type: 'object' } },
      evidence: { type: 'array', items: { type: 'object', required: ['evidence_id', 'quote'],
        properties: { evidence_id: { type: 'string' }, quote: { type: 'string' }, block_id: { type: 'string' } } } },
      coverage: { type: 'object' }
    }
  };
}

function mapResult(chunk, quote) {
  return {
    document_title: '迁移回归', overview: '可追溯',
    key_points: [{ point_id: `p-${chunk.chunk_id}`, content: quote, evidence_ids: [`e-${chunk.chunk_id}`] }],
    evidence: [{ evidence_id: `e-${chunk.chunk_id}`, block_id: chunk.block_ids[0], quote }],
    coverage: { chunk_ids: [chunk.chunk_id], complete: true }
  };
}

async function summarizeLegacy(length, expectedChunks) {
  const legacy = {
    source_path: 'legacy.pdf', source_hash: 'a'.repeat(64), source_type: 'pdf',
    parser: 'mineru-api', markdown: textOfLength(length), pages: [], blocks: [], evidence_index: {}
  };
  const upgraded = parser.upgradeParsePackage(legacy);
  assert.strictEqual(upgraded.markdown.length, length);
  assert.strictEqual(upgraded.blocks.length, 1);
  assert.strictEqual(upgraded.blocks[0].locator.scheme, 'parsed-text-span');
  assert(!Object.hasOwn(upgraded.blocks[0].locator, 'page'), '不得伪造页码');
  assert.strictEqual(Object.keys(upgraded.evidence_index).length, 1);
  assert.strictEqual(upgraded.provenance.spans[0].start, 0);
  assert.strictEqual(upgraded.provenance.spans[0].end, length);
  const calls = [];
  const saved = new Map();
  const result = await api.summarizeDocument({
    parsePackage: upgraded, classification: {}, basePrompt: '', typePrompt: '',
    summarySchema: summarySchema(), maxChunkChars: 6000, summaryConcurrency: 1, maxRepairAttempts: 0,
    loadSummaryMapChunk: async (chunk) => saved.get(chunk.chunk_id),
    saveSummaryMapChunk: async (chunk, value) => saved.set(chunk.chunk_id, value),
    requestJson: async (_prompt, context) => {
      if (context.stage === 'summary-reduce') {
        return { ...mapResult({ chunk_id: context.chunkIds[0], block_ids: [upgraded.blocks[0].block_id] },
          calls[0].quote), coverage: { chunk_ids: context.chunkIds, complete: true } };
      }
      const source = context.chunk.sourceBlocks[0];
      assert(source && source.text.length > 0);
      assert(source.text.length <= context.chunk.markdown.length);
      const quote = source.text.slice(0, Math.min(42, source.text.length));
      calls.push({ id: context.chunk.chunk_id, quote, span: source.text.length });
      return mapResult(context.chunk, quote);
    }
  });
  assert.strictEqual(calls.length, expectedChunks);
  assert(calls.every((item) => item.span > 0));
  assert(result.key_points.length > 0);
  assert(result.evidence.every((item) => item.provenance_resolution?.ok));
  return { upgraded, saved };
}

async function main() {
  const production = await summarizeLegacy(11371, 2);
  await summarizeLegacy(780, 1);

  const pageBlock = block.createBlock({
    source_hash: 'b'.repeat(64), order: 0, raw_text: 'OCR 页内容',
    locator: { scheme: 'page', value: '7', page: 7, bbox: [1, 2, 3, 4] }, parse_method: 'ocr'
  });
  const xlsxBlock = block.createBlock({
    source_hash: 'b'.repeat(64), order: 1, raw_text: '表格行内容',
    locator: { scheme: 'xlsx-row', value: '验收!7', sheet: '验收', row: 7 }, parse_method: 'xlsx'
  });
  const emailBlock = block.createBlock({
    source_hash: 'b'.repeat(64), order: 2, raw_text: '邮件正文',
    locator: { scheme: 'email-message', value: 'm-1', message_id: 'm-1', thread_id: 't-1' }, parse_method: 'email'
  });
  const partial = parser.upgradeParsePackage({
    source_hash: 'b'.repeat(64), markdown: 'OCR 页内容\n表格行内容\n邮件正文',
    blocks: [pageBlock, xlsxBlock, emailBlock]
  });
  assert.deepStrictEqual(partial.blocks.map((item) => item.locator), [pageBlock.locator, xlsxBlock.locator, emailBlock.locator]);
  assert.strictEqual(partial.provenance.spans[0].page, 7);
  assert.strictEqual(partial.evidence_index[pageBlock.block_id].locator.bbox[0], 1);
  assert.strictEqual(partial.evidence_index[xlsxBlock.block_id].locator.row, 7);
  assert.strictEqual(partial.evidence_index[emailBlock.block_id].locator.message_id, 'm-1');

  const stale = parser.upgradeParsePackage({
    source_hash: 'b'.repeat(64), markdown: 'OCR 页内容', blocks: [pageBlock],
    evidence_index: { missing: { block_id: 'missing', raw_text: '伪造内容' } }
  });
  assert.deepStrictEqual(Object.keys(stale.evidence_index), [pageBlock.block_id]);
  assert.strictEqual(stale.evidence_index[pageBlock.block_id].raw_text, 'OCR 页内容');

  const again = parser.upgradeParsePackage(production.upgraded);
  assert.strictEqual(JSON.stringify(again), JSON.stringify(production.upgraded), '重复升级必须字节稳定');
  assert.strictEqual(new Set(again.blocks.map((item) => item.block_id)).size, again.blocks.length);
  const persisted = JSON.parse(JSON.stringify({ payload: production.upgraded })).payload;
  assert.strictEqual(JSON.stringify(parser.upgradeParsePackage(persisted)), JSON.stringify(production.upgraded));

  let oldEmptyProviderCalls = 0;
  const oldEmpty = {
    document_title: '旧空缓存', overview: '', key_points: [], evidence: [],
    coverage: { chunk_ids: ['ignored'], complete: true }
  };
  await api.summarizeDocument({
    parsePackage: production.upgraded, classification: {}, basePrompt: '', typePrompt: '',
    summarySchema: summarySchema(), maxChunkChars: 6000, summaryConcurrency: 1, maxRepairAttempts: 0,
    loadSummaryMapChunk: async () => oldEmpty,
    requestJson: async (_prompt, context) => {
      if (context.stage === 'summary-reduce') {
        return { ...mapResult({ chunk_id: context.chunkIds[0], block_ids: [production.upgraded.blocks[0].block_id] },
          '验收合格'), coverage: { chunk_ids: context.chunkIds, complete: true } };
      }
      oldEmptyProviderCalls += 1;
      return mapResult(context.chunk, context.chunk.sourceBlocks[0].text.slice(0, 12));
    }
  });
  assert.strictEqual(oldEmptyProviderCalls, 2, '旧空 map checkpoint 必须失效');
  assert(diagCalls.some((item) => item.scope === 'summary.map.cacheMiss'
    && item.payload.reason === 'parse_contract_changed'));

  let providerCalls = 0;
  await assert.rejects(() => api.summarizeDocument({
    parsePackage: {
      markdown: '非空但无法定位', blocks: [], evidence_index: {},
      provenance: { spans: [] }, parse_contract: { fingerprint: 'broken' }
    },
    classification: {}, basePrompt: '', typePrompt: '', summarySchema: summarySchema(),
    maxChunkChars: 6000, requestJson: async () => { providerCalls += 1; return {}; }
  }), (error) => error.name === 'ParseContractError'
    && error.code === 'PARSE_CONTRACT_SOURCE_BLOCKS_MISSING'
    && error.details.provider_calls === 0);
  assert.strictEqual(providerCalls, 0);
  const classified = reliability.classifyFailure({ code: 'PARSE_CONTRACT_SOURCE_BLOCKS_MISSING' });
  assert.strictEqual(classified.category, 'internal_parse_contract');
  assert.notStrictEqual(classified.category, 'unsupported_knowledge');
  assert(classified.suggestedAction.includes('模型尚未被调用'));

  const source = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
  assert(source.includes("let parsePackage = await this.loadArtifact(current, 'parsed');"));
  assert(source.includes("await this.persistArtifact(task, 'parsed', upgraded);"));
  assert(source.includes("parsePackage = upgradeParsePackage(extracted.parsePackage"));
  assert(source.includes("parsePackage: upgradeParsePackage(options.parsePackage"));
  assert(source.includes("loadArtifactPayloadUnchecked(task, 'parsed')"));
  assert(source.includes("const parsePackage = await this.loadArtifact(task, 'parsed');"));

  console.log('parsed-artifact upgrade regression: 11371/2 chunks, 780/1 chunk, partial/stale locators, idempotence, persistence/resume, cache invalidation, and zero-token typed guard passed');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
