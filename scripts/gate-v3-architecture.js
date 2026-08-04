'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..', 'src', 'v3');
const files = fs.readdirSync(root).filter((name) => name.endsWith('.js'));
const source = files.map((name) => fs.readFileSync(path.join(root, name), 'utf8')).join('\n');
const forbidden = ['core/workflow', 'phase2-candidate-pipeline', 'review-service', 'atomization', 'knowledge-card', 'phase1-foundation', 'completion-ui', 'core/routing', 'core/cache'];
for (const term of forbidden) assert(!new RegExp(`require\\([^)]*${term}`, 'i').test(source), `v3 imports forbidden legacy module: ${term}`);
assert.strictEqual((source.match(/class V3Phase1Orchestrator/g) || []).length, 1, 'exactly one v3 orchestrator required');
assert.strictEqual((source.match(/class V3Phase2CandidateOrchestrator/g) || []).length, 1, 'exactly one Phase 2 candidate orchestrator required');
assert.strictEqual((source.match(/static async completionFromManifest/g) || []).length, 2, 'exactly one completion authority per phase required');
assert(!/result_counts|success_count|processed_count/.test(source), 'independent completion counter found');
assert(/Engineering Knowledge Slicer\/v3-phase1\/state/.test(source));
assert(/v3-phase1\/verified-output/.test(source));
assert(/v3-phase2/.test(source) && /experimental-output\/v1/.test(source));
assert.strictEqual((source.match(/class V3Phase2CandidateOrchestrator/g) || []).length, 1);
console.log('v3 architecture gate: PASS');
