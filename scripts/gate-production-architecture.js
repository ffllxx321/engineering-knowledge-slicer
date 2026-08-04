'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const main = fs.readFileSync(path.join(root, 'main.js'), 'utf8');
const contract = require('../src/production-flow-contract.js').PRODUCTION_FLOW_CONTRACT;

assert.deepStrictEqual(contract.user_states, ['waiting', 'processing', 'pending_confirmation', 'stored', 'failed']);
for (const marker of [
  'new ProductionCommitService(vault, commitStructuredPlan)',
  "transitionProductionState(current, 'stored'",
  'current.current_run_manifest = structured.transaction?.authoritativeManifest',
  'LEGACY_KNOWLEDGE_WRITE_REMOVED',
  'LEGACY_RECOVERY_REMOVED'
]) assert(main.includes(marker), `生产 bundle 缺少架构边界：${marker}`);

const productionCommit = main.slice(main.indexOf('async runStructuredWriterPhase('), main.indexOf('async writeAcceptedCard('));
assert(productionCommit.includes('ProductionCommitService'));
assert(!/this\.app\.vault\.(create|modify|rename)\(/.test(productionCommit), '生产提交不得直写 Vault');
assert(!/settings\.(businessOutputPath|bidOutputPath|structuredBusinessRoot|structuredActiveRoot)/.test(productionCommit), '生产提交不得读取旧输出根');

const completion = main.slice(main.indexOf('const verifiedStructured ='), main.indexOf("diag('performance.task'"));
assert(completion.includes("transitionProductionState(current, 'stored'"));
assert(!/status\s*=\s*[^;]*(cardsGenerated|generatedCount|plan\?\.actions|writtenFiles)/.test(completion));

console.log(JSON.stringify({ gate: contract.schema, states: contract.user_states, writer: contract.knowledge_write_entrypoint, authority: contract.authority.success }, null, 2));
