'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..', 'src', 'v3');
const files = fs.readdirSync(root).filter((name) => name.endsWith('.js'));
const source = files.map((name) => fs.readFileSync(path.join(root, name), 'utf8')).join('\n');
const forbidden = ['workflow', 'cache', 'review', 'atomization', 'knowledge-card', 'phase1-foundation', 'phase2', 'phase3'];
for (const term of forbidden) assert(!new RegExp(`require\\([^)]*${term}`, 'i').test(source), `v3 imports forbidden legacy module: ${term}`);
assert.strictEqual((source.match(/class V3Phase1Orchestrator/g) || []).length, 1, 'exactly one v3 orchestrator required');
assert.strictEqual((source.match(/static async completionFromManifest/g) || []).length, 1, 'exactly one completion authority required');
assert(!/result_counts|success_count|processed_count/.test(source), 'independent completion counter found');
assert(/Engineering Knowledge Slicer\/v3-phase1\/state/.test(source));
assert(/v3-phase1\/verified-output/.test(source));
console.log('v3 architecture gate: PASS');
