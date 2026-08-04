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
  'new AutoDocumentParser',
  'revalidatePersistedCompletion(current.task_id, current.run_id)',
  "diag('ingest.finalVisibility'",
  'LEGACY_KNOWLEDGE_WRITE_REMOVED',
  'LEGACY_RECOVERY_REMOVED'
]) assert(main.includes(marker), `生产 bundle 缺少架构边界：${marker}`);

const productionCommit = main.slice(main.indexOf('async runStructuredWriterPhase('), main.indexOf('async writeAcceptedCard('));
assert(productionCommit.includes('ProductionCommitService'));
assert(!/this\.app\.vault\.(create|modify|rename)\(/.test(productionCommit), '生产提交不得直写 Vault');
assert(!/settings\.(businessOutputPath|bidOutputPath|structuredBusinessRoot|structuredActiveRoot)/.test(productionCommit), '生产提交不得读取旧输出根');

const processTask = main.slice(main.indexOf('async _processTaskOwned('), main.indexOf('async requestMiniMaxProduction('));
assert.strictEqual((processTask.match(/parseDocumentAutomatically\(current, buffer/g) || []).length, 1, 'processTask 必须且只能调用一次统一自动解析入口');
assert(!processTask.includes('pdfExtractionOrder'), '生产任务不得读取旧 PDF 引擎顺序');
assert(main.includes("const DEFAULT_ORDER = ['mineru-api'];"), '生产外部解析只能保留 MinerU');
assert(main.includes('LEGACY_PADDLEOCR_REMOVED'), 'PaddleOCR 兼容入口必须显式拒绝生产调用');
assert(main.includes("EKS_ENABLE_DEVELOPMENT_SHADOW === '1'"), '影子评估必须受开发环境变量隔离');
assert(main.includes("knowledgeTenderRoot: '06-知识库/招投标库'") && main.includes("knowledgeBusinessRoot: '06-知识库/业务库'"), '权威两库必须位于 06-知识库 下');

const completion = main.slice(main.indexOf('const verifiedStructured ='), main.indexOf("diag('performance.task'"));
assert(completion.includes("transitionProductionState(current, 'stored'"));
assert(!/status\s*=\s*[^;]*(cardsGenerated|generatedCount|plan\?\.actions|writtenFiles)/.test(completion));

console.log(JSON.stringify({ gate: contract.schema, states: contract.user_states, writer: contract.knowledge_write_entrypoint, authority: contract.authority.success }, null, 2));
