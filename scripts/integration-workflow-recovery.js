const assert = require('assert');
const { loadBundleModule } = require('./load-bundle-module.js');
const { loadAiPipeline } = require('./load-ai-pipeline.js');

const reliability = loadBundleModule('src/core/reliability.js');
const linkService = loadBundleModule('src/core/link-service.js');

function fingerprint(atom) {
  return JSON.stringify([atom.title, atom.content?.statement || atom.content?.core_knowledge || '']);
}

const ai = {
  classifyDocument: async () => { throw new Error('classification provider must not be called'); },
  summarizeDocument: async () => { throw new Error('summary provider must not be called'); },
  atomizeSummary: async () => { throw new Error('atomization provider must not be called'); },
  validateAtomizationResult: (value) => ({ value, errors: [] })
};
const workflow = loadBundleModule('src/core/workflow.js', {
  'src/core/ai-pipeline.js': ai,
  'src/core/confidence.js': {
    calculateConfidence: ({ duplicate }) => ({
      score: duplicate ? 0.5 : 0.99,
      decision: duplicate ? 'review' : 'auto_ingest',
      components: { evidence: 1, atom_quality: 1 },
      hard_rules: duplicate ? ['与已有知识卡片重复'] : []
    })
  },
  'src/core/identity.js': { atomFingerprint: fingerprint },
  'src/core/markdown-renderer.js': {
    buildCardRecord: ({ atom, sourceHash, confidence }) => ({
      title: atom.title,
      card_id: `card-${sourceHash}-${fingerprint(atom).length}`,
      atom_fingerprint: fingerprint(atom),
      confidence: confidence.score
    })
  },
  'src/core/routing.js': {
    resolveFixedRoute: (_map, classification) => ({
      library: classification.library,
      folder_type: classification.folder_type,
      output_folder: 'wiki/fixed'
    })
  },
  'src/core/link-service.js': linkService,
  'src/core/reliability.js': reliability,
  'src/core/provenance.js': { verifyLocator: () => ({ ok: true, locator: {}, label: '' }) }
});

const classification = {
  library: 'business',
  folder_type: 'project',
  document_type: 'project-note',
  model_confidence: 0.99
};
const summary = {
  document_title: '恢复测试',
  key_points: [{ point_id: 'p1', content: '同一个事实', evidence_ids: ['e1'] }],
  evidence: [{ evidence_id: 'e1', locator: '第1页', quote: '同一个事实' }]
};
const duplicateAtom = {
  atom_id: 'a1',
  title: '稳定事实',
  library: 'business',
  folder_type: 'project',
  content: { statement: '同一个事实' },
  source: { source_locator: '第1页', evidence_quote: '同一个事实' },
  related_candidates: []
};
const atomResult = { atoms: [duplicateAtom, { ...duplicateAtom, atom_id: 'a2' }] };

async function main() {
  let providerCalls = 0;
  const artifacts = [];
  const result = await workflow.runKnowledgeWorkflow({
    parsePackage: { source_path: 'source/test.md', markdown: '同一个事实', quality: { score: 1 }, pages: [{}] },
    folderMap: {},
    schemas: {},
    prompts: {},
    classification,
    summary,
    atomResult,
    sourceHash: 'source-hash',
    versions: { schemaVersion: '1.1', pipelineVersion: '1.1.1', promptBundleVersion: '1.1' },
    existingCards: [],
    existingFingerprints: [],
    validateLabels: () => true,
    requestJson: async () => { providerCalls += 1; throw new Error('provider should not run'); },
    onArtifact: async (name) => artifacts.push(name)
  });

  assert.strictEqual(providerCalls, 0, 'restart with valid checkpoints must not repeat provider calls');
  assert.deepStrictEqual(artifacts, ['classification', 'summary', 'atoms']);
  assert.strictEqual(result.accepted.length, 1, 'first unique card is accepted once');
  assert.strictEqual(result.review.length, 0, 'exact intra-batch copy is consolidated before review');
  assert.strictEqual(result.atomResult.consolidation.merged, 1);
  assert.deepStrictEqual(result.atomResult.atoms[0].merged_atom_ids, ['a1', 'a2']);
  assert.strictEqual(result.accepted.length, 1);

  const mineru = loadBundleModule('src/core/mineru-api.js', {
    'src/core/zip.js': { extractZipEntryEndingWith: () => '' },
    'src/core/provenance.js': { normalizeOcrArtifact: () => ({ spans: [] }) }
  });
  const controller = new AbortController();
  let parserCalls = 0;
  const response = (payload) => ({ ok: true, status: 200, json: async () => payload });
  const parserResult = await mineru.runMineruApi(Buffer.from('fixture'), {
    apiKey: 'test-only',
    signal: controller.signal,
    pollIntervalMs: 500,
    timeoutMs: 5000,
    requestImpl: async (_url, init) => {
      parserCalls += 1;
      if (init.method === 'POST') return response({ code: 0, data: { batch_id: 'b1', file_urls: ['https://upload.invalid'] } });
      if (init.method === 'PUT') return response({});
      return response({ code: 0, data: { extract_result: [{ state: 'running', extract_progress: {} }] } });
    },
    onProgress: async ({ stage }) => {
      if (stage === 'mineru-api-poll') controller.abort();
    }
  });
  assert.strictEqual(parserResult.status, 'failed');
  assert.strictEqual(parserCalls, 3, 'AbortSignal must stop polling before another provider call');
  const { api: pipeline } = loadAiPipeline();
  assert.strictEqual(pipeline.parseRetryAfterMs('2'), 2000);

  console.log('workflow integration: 8 passed, 0 failed');
  console.log('  ok - valid restart checkpoints make zero expensive provider calls');
  console.log('  ok - duplicate atoms in one provider response merge into one accepted card');
  console.log('  ok - merged atom preserves both source atom ids');
  console.log('  ok - artifact stages remain observable on recovery');
  console.log('  ok - stable fingerprint cardinality remains one');
  console.log('  ok - parser polling accepts AbortSignal');
  console.log('  ok - cancellation prevents subsequent expensive polling calls');
  console.log('  ok - Retry-After seconds are honored deterministically');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
