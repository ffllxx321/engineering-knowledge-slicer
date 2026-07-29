'use strict';
const crypto = require('crypto');
const { performance } = require('perf_hooks');
const { loadBundleModule } = require('./load-bundle-module');
const { ExactCosineIndex } = loadBundleModule('src/core/semantic-embedding.js', { crypto });
const count = Math.max(100, Number(process.env.EKS_SEMANTIC_BENCH_CARDS || 5000));
const dimensions = Math.max(8, Number(process.env.EKS_SEMANTIC_BENCH_DIMENSIONS || 1024));
const maxCandidates = 500;
const vector = Array.from({ length: dimensions }, (_, i) => ((i * 17) % 101) / 101);
const state = { schema: 1, signature: 'bench', entries: {}, tombstones: {} };
const index = new ExactCosineIndex(state, { maxCandidates });
for (let i = 0; i < count; i += 1) index.upsert(`c${i}`, vector, { library: 'business', category: '施工', tagL1: '质量' }, `h${i}`);
const started = performance.now();
for (let i = 0; i < 100; i += 1) index.search(vector, { library: 'business', category: '施工', tagL1: '质量' }, 8);
const elapsed = performance.now() - started;
console.log(JSON.stringify({
  kind: 'local-orchestration-exact-cosine', cards: count, dimensions, queries: 100,
  maxCandidates, comparisonsPerQuery: index.comparisons,
  elapsedMs: Number(elapsed.toFixed(2)), avgQueryMs: Number((elapsed / 100).toFixed(3)),
  limitation: 'fake deterministic vectors; excludes provider/network/model latency; exact bounded scan is an ANN-ready baseline'
}));
