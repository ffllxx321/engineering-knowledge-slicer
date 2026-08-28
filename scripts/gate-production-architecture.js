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
assert(processTask.includes('this.runStructuredWriterPhase(current, parsePackage)'), 'processTask 必须进入统一结构化生成路径');
assert(productionCommit.includes('runUniversalPipelineMultilingual'), '生产结构化阶段必须进入统一语义管线');
assert(productionCommit.includes('isReusableUniversalArtifact(priorUniversal, document.source_hash)'),
  '生产 universal 缓存必须通过集中复用谓词');
assert(productionCommit.includes('reusableTranslationCache(translationCheckpoint, priorUniversal, document.source_hash)'),
  '旧 universal 中的 translation cache 仅能在来源 hash 一致时复用');
const universalModuleStart = main.indexOf('"src/universal-knowledge-pipeline.js": function');
const universalModule = main.slice(universalModuleStart, main.indexOf('"src/knowledge-write-port.js": function', universalModuleStart));
assert(universalModule.includes('planUsefulKnowledgeUnits(document, profile'), '生产 bundle 必须实际调用 useful-card planner');
assert(universalModule.includes('knowledge_events: planned.useful_card.events'), '生产产物必须携带版本化知识事件');
assert(universalModule.includes('buildStructureContext(source, blocks)'), '生产 canonicalizeDocument 必须构建结构上下文');
assert(universalModule.includes('generateUsefulCards(document, regions'), '生产 planner 必须消费携带结构的 canonical document');
assert(universalModule.includes("artifact?.pipeline_version === PIPELINE_VERSION"), '旧 universal/useful-card 缓存必须失效');
assert(universalModule.includes("artifact?.document?.structure?.schema_version === STRUCTURE_VERSION"), '生产缓存必须携带结构契约');
assert(universalModule.includes('pre_generation_semantic_contract?.fingerprint === PRE_GENERATION_SEMANTIC_CONTRACT_FINGERPRINT'),
  '生产缓存必须携带预生成语义指纹');
assert(main.includes("const DEFAULT_ORDER = ['mineru-api'];"), '生产外部解析只能保留 MinerU');
assert(main.includes('LEGACY_PADDLEOCR_REMOVED'), 'PaddleOCR 兼容入口必须显式拒绝生产调用');
assert(main.includes("EKS_ENABLE_DEVELOPMENT_SHADOW === '1'"), '影子评估必须受开发环境变量隔离');
assert(main.includes("knowledgeTenderRoot: '06-知识库/招投标库'") && main.includes("knowledgeBusinessRoot: '06-知识库/业务库'"), '权威两库必须位于 06-知识库 下');

const completion = main.slice(main.indexOf('const verifiedStructured ='), main.indexOf("diag('performance.task'"));
assert(completion.includes("transitionProductionState(current, 'stored'"));
assert(!/status\s*=\s*[^;]*(cardsGenerated|generatedCount|plan\?\.actions|writtenFiles)/.test(completion));

console.log(JSON.stringify({ gate: contract.schema, states: contract.user_states, writer: contract.knowledge_write_entrypoint, authority: contract.authority.success }, null, 2));
