'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { binary, fixtures, launch, obsidianVersion, root, safeSources, shaFile, sourceTree } = require('./acceptance-real.js');

function writeReport(report) {
  const out = path.join(root, 'test-artifacts'); fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(path.join(out, 'acceptance-provider-real.json'), JSON.stringify(report, null, 2));
  fs.writeFileSync(path.join(out, 'acceptance-provider-real.md'), `# Provider-real acceptance\n\n- Result: **${report.provider.status.toUpperCase()}**\n- Provider requests: ${report.metrics?.provider_requests || 0}\n- Failures: ${(report.failures || []).join(', ') || 'none'}\n`);
}

async function main() {
  const key = process.env.EKS_ACCEPTANCE_MINIMAX_API_KEY;
  if (!key) {
    writeReport({ schema: 'eks/acceptance-provider-real/1', passed: false, generated_at: new Date().toISOString(),
      source_tree: sourceTree(), provider: { mode: 'provider-real', status: 'not_run' },
      checks: {}, failures: ['provider_secret_absent'], metrics: { provider_requests: 0 }, sources: [] });
    console.log('provider-real: NOT_RUN (secret absent)');
    return;
  }
  assert(fs.existsSync(binary), `Official Obsidian AppImage missing: ${binary}`);
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'eks-provider-real-'));
  const vault = path.join(temporary, 'vault');
  const config = path.join(temporary, 'config');
  const plugin = path.join(vault, '.obsidian/plugins/engineering-knowledge-slicer');
  const intake = path.join(vault, '06-知识库/源文件/业务库');
  fs.mkdirSync(plugin, { recursive: true }); fs.mkdirSync(intake, { recursive: true }); fs.mkdirSync(config, { recursive: true });
  for (const file of ['main.js', 'manifest.json', 'styles.css']) fs.copyFileSync(path.join(root, file), path.join(plugin, file));
  fs.writeFileSync(path.join(intake, 'provider-real.eml'), fixtures()['network-recovery.eml']);
  fs.writeFileSync(path.join(vault, '.obsidian/community-plugins.json'), JSON.stringify(['engineering-knowledge-slicer']));
  fs.writeFileSync(path.join(config, 'obsidian.json'), JSON.stringify({ vaults: { acceptance: { path: vault, ts: Date.now(), open: true } } }));
  const resultPath = path.join(vault, 'EKS Acceptance/result.json');
  const started = Date.now();
  const host = await launch(vault, config, resultPath, {
    EKS_ACCEPTANCE_PROVIDER_MODE: 'provider-real',
    EKS_ACCEPTANCE_MINIMAX_API_KEY: key,
    EKS_ACCEPTANCE_MINIMAX_ENDPOINT: process.env.EKS_ACCEPTANCE_MINIMAX_ENDPOINT || 'https://api.minimaxi.com/anthropic/v1/messages'
  });
  const checks = { host_real: host.real_host === true, provider_mode: host.provider_mode === 'provider-real',
    provider_called: host.operation_counters.apiRequests > 0, fixture_gold: host.gold?.passed === true,
    terminal: host.terminal_count === host.task_count, false_success: host.false_success_count === 0,
    cards_openable: host.openable_count > 0 && host.openable_count === host.nonempty_count };
  const failures = Object.entries(checks).filter(([, ok]) => !ok).map(([name]) => name);
  const report = { schema: 'eks/acceptance-provider-real/1', passed: host.ok && failures.length === 0,
    generated_at: new Date().toISOString(), source_tree: sourceTree(),
    bundle_sha256: shaFile(path.join(root, 'main.js')), plugin_version: require(path.join(root, 'manifest.json')).version,
    obsidian_appimage_sha256: shaFile(binary),
    obsidian_version: obsidianVersion(host.obsidian_version),
    provider: { mode: 'provider-real', status: host.ok && failures.length === 0 ? 'passed' : 'failed' },
    corpus: [{ type: 'eml', size_bucket: 'lt_1KiB', sha256: shaFile(path.join(intake, 'provider-real.eml')) }],
    sources: safeSources(host.tasks), duration_ms: Date.now() - started, checks, failures,
    metrics: { tasks: host.task_count, cards: host.openable_count, provider_requests: host.operation_counters.apiRequests } };
  writeReport(report);
  assert(report.passed, `provider-real acceptance failed: ${failures.join(', ')}`);
}
if (require.main === module) main().catch((error) => { console.error(error); process.exitCode = 1; });
module.exports = { main, writeReport };
