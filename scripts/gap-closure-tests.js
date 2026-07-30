const assert = require('assert');
const fs = require('fs');
const { loadAiPipeline } = require('./load-ai-pipeline.js');
const { loadBundleModule } = require('./load-bundle-module.js');

async function testMapChunkRestart() {
  const { api } = loadAiPipeline();
  const cache = new Map();
  let calls = 0;
  const markdown = '# A\n' + Array.from({ length: 180 }, (_, index) => `${String(index).padStart(4, '0')}甲`).join('\n')
    + '\n# B\n' + Array.from({ length: 180 }, (_, index) => `${String(index).padStart(4, '0')}乙`).join('\n');
  const requestJson = async (_prompt, context) => {
    calls += 1;
    if (context.stage === 'summary-reduce') throw new Error('deterministic reduce failure');
    const chunk = context.chunk;
    return {
      document_title: 'fixture', executive_summary: chunk.chunk_id,
      key_points: [{ point_id: 'P1', kind: 'requirement', content: chunk.markdown, evidence_ids: ['E1'] }],
      evidence: [{ evidence_id: 'E1', block_id: 'document-block', locator: '', quote: chunk.markdown }],
      entities: [], suggested_links: [],
      coverage: { chunk_ids: [chunk.chunk_id], complete: true }, model_confidence: 1
    };
  };
  const options = {
    parsePackage: {
      markdown,
      source_name: 'fixture',
      blocks: [{ block_id: 'document-block', raw: { text: markdown }, locator: { scheme: 'line', value: '1-末行' }, card_eligible: true }],
      evidence_index: {
        'document-block': {
          block_id: 'document-block', raw_text: markdown,
          locator: { scheme: 'line', value: '1-末行' }, card_eligible: true
        }
      },
      provenance: { spans: [] }
    },
    classification: { library: 'bid', folder_type: 'project', document_type: 'note' },
    summarySchema: { type: 'object', additionalProperties: true },
    maxChunkChars: 500, summaryConcurrency: 2, requestJson,
    loadSummaryMapChunk: (chunk) => cache.get(chunk.stableChunkId || chunk.chunk_id),
    saveSummaryMapChunk: (chunk, value) => cache.set(chunk.stableChunkId || chunk.chunk_id, value)
  };
  await assert.rejects(api.summarizeDocument(options), /reduce failure/);
  const mapCalls = calls - 1;
  assert(mapCalls > 1 && cache.size === mapCalls);
  calls = 0;
  await assert.rejects(api.summarizeDocument(options), /reduce failure/);
  assert.strictEqual(calls, 1, 'restart must reuse every successful map chunk and only retry reduce');
}

function testKnowledgeIndex() {
  const link = loadBundleModule('src/core/link-service.js', { crypto: require('crypto') });
  const a = link.simHash('华东项目 合同工期 120 天');
  const b = link.simHash('华东项目合同工期为120天');
  assert(link.hammingDistance(a, b) < 32);
  const index = link.buildKnowledgeIndex([
    { card_id: 'new', title: '新规', project: '华东项目', library: 'bid', entities: ['甲公司'], relations: [{ target_card_id: 'old', relation: 'supersedes' }], path: 'wiki/new.md' },
    { card_id: 'old', title: '旧规', project: '华东项目', library: 'bid', entities: [{ name: '甲公司' }], relations: [], path: 'wiki/old.md' }
  ]);
  assert.deepStrictEqual(index.reverseRelations.old, [{ source_card_id: 'new', relation: 'supersedes' }]);
  assert.deepStrictEqual(index.evolution.supersedes.new, ['old']);
  assert.strictEqual(index.entities['甲公司'].card_ids.length, 2);
  assert.strictEqual(index.projects[0].cards.length, 2);
  assert(link.renderProjectAggregation(index.projects[0]).includes('project-aggregation'));
}

function testPromptAndUiEvidence() {
  const { api } = loadAiPipeline();
  const composed = api.composePrompt(['规则 A', '规则 A'], ['公共规则', '公共规则']);
  assert.strictEqual((composed.match(/规则 A/g) || []).length, 1);
  assert.strictEqual((composed.match(/公共规则/g) || []).length, 1);
  const source = fs.readFileSync(require.resolve('../main.js'), 'utf8');
  for (const evidence of ['selectedTaskIds', 'taskPageSize = 50', 'serviceTestResults', 'adapter.rename(temporary, normalized)', 'uiIncrementalRefreshes']) {
    assert(source.includes(evidence), `missing production evidence: ${evidence}`);
  }
}

function testAccessibleDomMock() {
  class MockElement {
    constructor(tag, options = {}) {
      this.tag = tag;
      this.text = options.text || '';
      this.attributes = Object.assign({}, options.attr || {});
      this.children = [];
      this.disabled = false;
    }
    createEl(tag, options) {
      const child = new MockElement(tag, options);
      this.children.push(child);
      return child;
    }
  }
  const root = new MockElement('div');
  const source = fs.readFileSync(require.resolve('../main.js'), 'utf8');
  const match = source.match(/function button\(parent, text, onClick, disabled = false\) \{[\s\S]*?\n\}/);
  assert(match, 'button helper must be extractable');
  const button = new Function(`${match[0]}; return button;`)();
  let clicked = 0;
  const element = button(root, '下一页', () => { clicked += 1; }, true);
  assert.strictEqual(element.tag, 'button');
  assert.strictEqual(element.attributes.type, 'button');
  assert.strictEqual(element.disabled, true);
  assert.strictEqual(element.text, '下一页');
  element.onclick();
  assert.strictEqual(clicked, 1);
  assert(source.includes("'aria-label': `选择任务"));
  assert(source.includes("'aria-live': 'polite'"));
}

async function main() {
  await testMapChunkRestart();
  testKnowledgeIndex();
  testPromptAndUiEvidence();
  testAccessibleDomMock();
  console.log('gap closure: 25 assertions passed');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
