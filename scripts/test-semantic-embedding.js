'use strict';
const assert = require('assert');
const crypto = require('crypto');
const { loadBundleModule } = require('./load-bundle-module');
const sem = loadBundleModule('src/core/semantic-embedding.js', { crypto });

function settings(overrides = {}) {
  return Object.assign({
    semanticConsent: true, semanticEnabled: true, semanticMode: 'shadow',
    embeddingEndpoint: 'https://fake.invalid/v1/embeddings',
    embeddingModel: 'Qwen3-Embedding-0.6B', embeddingDimensions: 3,
    embeddingApiKeyEnv: 'TEST_EMBED_KEY', embeddingTimeoutMs: 30,
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

  const changed = new sem.SemanticPostProcessor({ settings: settings({ embeddingModel: 'other' }), provider: fakeProvider(), readState: store.read, writeState: store.write });
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

  const migrated = sem.semanticSettingsSnapshot({ semanticEnabled: true, semanticConsent: false, embeddingApiKey: 'secret' });
  assert.strictEqual(migrated.consent, false);
  assert(!JSON.stringify(migrated).includes('secret'));
  assert(!JSON.stringify(sem.redactDiagnostic({ payload: 'private', vector: [1], apiKey: 'secret', code: 'SEM_AUTH' })).includes('secret'));
  console.log('semantic embedding unit/in-memory Vault integration: ok');
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
