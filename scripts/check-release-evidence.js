'use strict';
const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const cp = require('child_process');
const root = path.join(__dirname, '..');
const evidence = JSON.parse(fs.readFileSync(path.join(root, 'test-artifacts/real-obsidian-release-evidence.json')));
const bundle = crypto.createHash('sha256').update(fs.readFileSync(path.join(root, 'main.js'))).digest('hex');
const commit = cp.execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
assert.strictEqual(evidence.passed, true);
assert.strictEqual(evidence.commit, commit, 'release evidence belongs to a different commit');
assert.strictEqual(evidence.bundle_sha256, bundle, 'release evidence belongs to a different bundle');
assert.strictEqual(evidence.plugin_version, require(path.join(root, 'manifest.json')).version);
assert.strictEqual(evidence.first_launch?.cdp_load?.pluginId, 'engineering-knowledge-slicer');
assert.strictEqual(evidence.first_launch?.cdp_load?.pluginVersion, evidence.plugin_version);
assert.strictEqual(evidence.restart?.cdp_load?.pluginId, 'engineering-knowledge-slicer');
for (const run of [evidence.first_launch, evidence.restart]) {
  assert.strictEqual(run.ok, true);
  assert.strictEqual(run.real_host, true);
  assert.strictEqual(run.host_api, 'Obsidian Vault');
  assert.strictEqual(run.visible_openable?.length, 3);
  assert.deepStrictEqual(run.opened_paths, run.visible_openable);
  assert.strictEqual(run.idempotent_rerun_count, 3);
  assert.strictEqual(run.deletion_invalidated, true);
  assert.strictEqual(run.injected_partial_failure_observed, true);
  assert.strictEqual(run.partial_failure_rollback_clean, true);
}
console.log('release evidence: current commit and bundle verified');
