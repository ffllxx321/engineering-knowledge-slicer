'use strict';
const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { loadBundleModule } = require('./load-bundle-module');
const sem = loadBundleModule('src/core/semantic-embedding.js', { crypto });

function settings(overrides = {}) {
  return Object.assign({
    semanticConsent: true, semanticEnabled: true, semanticMode: 'shadow',
    embeddingProvider: 'aliyun-bailian-qwen37', embeddingProtocol: 'dashscope-native-v1',
    embeddingApiKey: 'unit-test-secret-never-log', embeddingTimeoutMs: 30,
    embeddingMaxAttempts: 1, embeddingRetryBaseMs: 1, embeddingRateLimitMs: 0,
    embeddingBatchSize: 2, embeddingConcurrency: 2,
    semanticRelatedThreshold: 0.82, semanticDuplicateThreshold: 0.92,
    semanticMaxCandidates: 2, semanticTopK: 2
  }, overrides);
}
function card(id, title, summary, extra = {}) {
  return Object.assign({ card_id: id, Title: title, Category: '施工', TagL1: '质量', library: 'business', claim_summary: summary }, extra);
}
function memoryStore(initial = {}) {
  const values = JSON.parse(JSON.stringify(initial));
  return {
    values,
    read: async (name) => values[name] ? JSON.parse(JSON.stringify(values[name])) : null,
    write: async (name, value) => { values[name] = JSON.parse(JSON.stringify(value)); }
  };
}
function fakeProvider(vector = [1, 0, 0]) {
  return { calls: 0, async embed(payloads) { this.calls += 1; return payloads.map(() => vector); } };
}

async function main() {
  const task = loadBundleModule('src/core/task.js', { crypto, path });
  const migrated = task.migrateSettings({
    settingsVersion: 28,
    semanticConsent: true,
    semanticEnabled: true,
    embeddingEndpoint: 'https://legacy.invalid/v1/embeddings',
    embeddingModel: 'legacy-model',
    embeddingDimensions: 768,
    embeddingBatchSize: 64,
    bidIntakePath: 'custom/bid',
    artifactsPath: 'custom/artifacts'
  });
  assert.strictEqual(migrated.settingsVersion, 30);
  assert.strictEqual(migrated.embeddingProvider, 'aliyun-bailian-qwen37');
  assert.strictEqual(migrated.embeddingProtocol, 'dashscope-native-v1');
  assert.strictEqual(migrated.embeddingModel, 'qwen3.7-text-embedding');
  assert.strictEqual(migrated.embeddingDimensions, 1024);
  assert.strictEqual(migrated.embeddingBatchSize, 20);
  assert.strictEqual(migrated.bidIntakePath, 'custom/bid');
  assert.strictEqual(migrated.artifactsPath, 'custom/artifacts');
  assert.strictEqual(migrated.semanticConsent, true);
  assert.strictEqual(migrated.semanticEnabled, true);
  const source = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
  const semanticUi = source.slice(source.indexOf("text: '语义嵌入（可选 · 影子模式）'"), source.indexOf("text: '生产影子评估（本地优先）'"));
  assert(source.includes("name: '阿里云百炼密钥'"));
  assert(!semanticUi.includes("'embeddingApiKey'"), 'advanced controls must reuse the canonical credential editor');
  for (const hidden of ["'embeddingEndpoint'", "'embeddingModel'", "'embeddingApiKeyEnv'", "'embeddingDimensions'"]) assert(!semanticUi.includes(hidden));
  assert(source.includes("['Engineering knowledge connection probe.']"));
  assert(!source.includes('provider.embed([privacyReducedPayload'));

  const vectors = (count, dimensions = 1024) => Array.from({ length: count }, (_, index) => ({
    text_index: count - index - 1,
    embedding: Array.from({ length: dimensions }, (_x, dimension) => dimension === index ? 1 : 0)
  }));
  let captured;
  const native = new sem.AliyunBailianQwen37EmbeddingProvider({
    env: {},
    fetch: async (url, request) => {
      captured = { url, request };
      return { ok: true, status: 200, json: async () => ({ output: { embeddings: vectors(2) }, usage: { total_tokens: 7 }, request_id: 'safe-id' }) };
    }
  });
  const nativeResult = await native.embed(['probe-a', 'probe-b'], settings(), undefined, { textType: 'document' });
  assert.strictEqual(captured.url, sem.ALIYUN_BAILIAN_ENDPOINT);
  assert.strictEqual(captured.request.headers.authorization, 'Bearer unit-test-secret-never-log');
  const nativeBody = JSON.parse(captured.request.body);
  assert.deepStrictEqual(nativeBody, {
    model: 'qwen3.7-text-embedding',
    input: { texts: ['probe-a', 'probe-b'] },
    parameters: { dimension: 1024, output_type: 'dense', text_type: 'document' }
  });
  assert.strictEqual(nativeResult[0][1], 1, 'text_index order must be restored');
  assert.strictEqual(nativeResult.usage.inputTokens, 7);
  assert(!JSON.stringify(nativeResult).includes('unit-test-secret'));
  await assert.rejects(() => native.embed(Array(21).fill('x'), settings()), (error) => error.code === 'SEM_BATCH_LIMIT');

  for (const scenario of [
    { status: 401, code: 'SEM_AUTH' },
    { status: 429, code: 'SEM_RATE_LIMIT' },
    { status: 200, json: { output: { embeddings: [] } }, code: 'SEM_COUNT' },
    { status: 200, json: { output: { embeddings: vectors(1, 3) } }, code: 'SEM_DIMENSION' },
    { status: 200, json: { output: { embeddings: [{ text_index: 0, embedding: [...Array(1023).fill(0), NaN] }] } }, code: 'SEM_NONFINITE' }
  ]) {
    const provider = new sem.AliyunBailianQwen37EmbeddingProvider({
      fetch: async () => ({
        ok: scenario.status === 200, status: scenario.status,
        json: async () => scenario.json || {}
      })
    });
    await assert.rejects(() => provider.embed(['fixed privacy neutral probe'], settings({ embeddingMaxAttempts: 1 })), (error) => error.code === scenario.code);
  }
  const timeoutProvider = new sem.AliyunBailianQwen37EmbeddingProvider({
    fetch: async (_url, request) => new Promise((_resolve, reject) => request.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))))
  });
  await assert.rejects(() => timeoutProvider.embed(['fixed privacy neutral probe'], settings({ embeddingTimeoutMs: 1, embeddingMaxAttempts: 1 })), (error) => error.code === 'SEM_TIMEOUT');

  const privateCard = card('c1', ' 混凝土  ', '强度 C30', {
    path: '秘密/项目.md', raw_evidence: '原始证据', diagnostics: { token: 'secret' },
    secret: 'sk-never', tags: ['b', 'a']
  });
  const payload = sem.privacyReducedPayload(privateCard);
  assert.match(payload, /title: 混凝土/);
  for (const forbidden of ['秘密/', '原始证据', 'sk-never', 'diagnostics']) assert(!payload.includes(forbidden));
  const reduced = sem.privacyReducedCard(privateCard);
  assert.deepStrictEqual(Object.keys(reduced).sort(), ['Category', 'TagL1', 'TagL2', 'Title', 'atom_fingerprint', 'card_id', 'claim_summary', 'evidence_id', 'library', 'tags'].sort());

  assert.strictEqual(sem.cosine([1, 0], [1, 0]), 1);
  assert.strictEqual(sem.cosine([1, 0], [0, 1]), 0);
  const state = { schema: 1, signature: 'x', entries: {}, tombstones: {} };
  const index = new sem.ExactCosineIndex(state, { maxCandidates: 2 });
  index.upsert('a', [1, 0], { library: 'business', category: 'A', tagL1: 'T' }, 'h1');
  index.upsert('b', [0.9, 0.1], { library: 'business', category: 'A', tagL1: 'T' }, 'h2');
  index.upsert('c', [1, 0], { library: 'bid', category: 'A', tagL1: 'T' }, 'h3');
  assert.deepStrictEqual(index.search([1, 0], { library: 'business', category: 'A', tagL1: 'T' }, 1).map((x) => x.id), ['a']);
  assert(index.comparisons <= 2);
  index.tombstone('a');
  assert(!state.entries.a && state.tombstones.a);

  assert.strictEqual(sem.deterministicGuard(card('a', 'x', '压力 10 MPa'), card('b', 'x', '压力 12 MPa')).compatible, false);
  assert.strictEqual(sem.deterministicGuard(card('a', 'x', '版本 v2.1'), card('b', 'x', '版本 v2.2')).compatible, false);
  assert.strictEqual(sem.inferRelation(card('a', 'x', '新规取代旧规'), card('b', 'y', '旧规'), { compatible: true }), 'supersedes');
  assert.strictEqual(sem.inferRelation(card('a', 'x', '冲突'), card('b', 'y', '冲突'), { compatible: false }), 'related');

  const store = memoryStore();
  const provider = fakeProvider();
  const diagnostics = [];
  const engine = new sem.SemanticPostProcessor({
    settings: settings(), provider, readState: store.read, writeState: store.write,
    diagnostics: (stage, event) => diagnostics.push({ stage, event })
  });
  await engine.load();
  const result = await engine.run([card('a', '规范', '厚度 10 mm'), card('b', '规范副本', '厚度 10 mm')]);
  assert.strictEqual(result.processed, 2);
  assert.strictEqual(provider.calls, 1);
  assert.strictEqual(store.values['semantic-shadow.v1.json'].items.length, 1);
  assert.strictEqual(store.values['semantic-shadow.v1.json'].items[0].status, 'review_suggestion');
  assert(!JSON.stringify(store.values['semantic-shadow.v1.json']).includes('规范副本'));
  assert(!store.values['vector-index.v1.json'].items);

  const provider2 = fakeProvider();
  const resumed = new sem.SemanticPostProcessor({ settings: settings(), provider: provider2, readState: store.read, writeState: store.write });
  await resumed.load();
  await resumed.run([card('a', '规范', '厚度 10 mm')]);
  assert.strictEqual(provider2.calls, 0, 'cold start must reuse persisted cache');

  const changed = new sem.SemanticPostProcessor({ settings: settings({ embeddingProtocol: 'changed' }), provider: fakeProvider(), readState: store.read, writeState: store.write });
  await changed.load();
  assert.strictEqual(Object.keys(changed.cache.entries).length, 0, 'model change invalidates semantic cache only');

  for (const failure of [
    Object.assign(new Error('timeout with sk-secret'), { code: 'SEM_TIMEOUT' }),
    Object.assign(new Error('auth'), { code: 'SEM_AUTH' }),
    Object.assign(new Error('schema'), { code: 'SEM_SCHEMA' })
  ]) {
    const failing = new sem.SemanticPostProcessor({
      settings: settings(), provider: { embed: async () => { throw failure; } },
      readState: memoryStore().read, writeState: memoryStore().write, diagnostics: (_s, event) => {
        assert(!JSON.stringify(event).includes('sk-secret'));
      }
    });
    await failing.load();
    const failed = await failing.processBatch([privateCard]);
    assert.strictEqual(failed.failed, 1);
  }

  let aborted = false;
  const slow = new sem.SemanticPostProcessor({
    settings: settings(), provider: { embed: (_p, _s, signal) => new Promise((_r, reject) => signal.addEventListener('abort', () => {
      aborted = true; reject(Object.assign(new Error('aborted'), { code: 'SEM_ABORTED' }));
    })) }, readState: memoryStore().read, writeState: memoryStore().write
  });
  await slow.load();
  const pending = slow.processBatch([card('z', 'z', 'z')]);
  slow.abort();
  await pending;
  assert(aborted);

  const snapshot = sem.semanticSettingsSnapshot({ semanticEnabled: true, semanticConsent: false, embeddingApiKey: 'secret' });
  assert.strictEqual(snapshot.consent, false);
  assert(!JSON.stringify(snapshot).includes('secret'));
  assert(!JSON.stringify(sem.redactDiagnostic({ payload: 'private', vector: [1], apiKey: 'secret', code: 'SEM_AUTH' })).includes('secret'));
  console.log('semantic embedding unit/in-memory Vault integration: ok');
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
