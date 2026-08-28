'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const bundlePath = path.join(root, 'main.js');
const START = '/** STRUCTURED_PHASE_MODULES_START */';
const OLD_START = '/* STRUCTURED_PHASE_MODULES_START */';
const END = '/* STRUCTURED_PHASE_MODULES_END */';
const modules = [
  ['vendor/pdfjs.js', 'node_modules/pdfjs-dist/legacy/build/pdf.js'],
  ['vendor/pdf.worker.js', 'node_modules/pdfjs-dist/legacy/build/pdf.worker.js'],
  ['src/pdf-text-extractor.js', 'src/pdf-text-extractor.js'],
  ['src/content-integrity.js', 'src/content-integrity.js'],
  ['src/production-flow-contract.js', 'src/production-flow-contract.js'],
  ['src/production-state-machine.js', 'src/production-state-machine.js'],
  ['src/production-commit-service.js', 'src/production-commit-service.js'],
  ['src/production-evolution.js', 'src/production-evolution.js'],
  ['src/plugin-activation.js', 'src/plugin-activation.js'],
  ['src/phase1-foundation.js', 'src/phase1-foundation.js'],
  ['src/phase2-candidate-pipeline.js', 'src/phase2-candidate-pipeline.js'],
  ['src/phase3-review-gate.js', 'src/phase3-review-gate.js'],
  ['src/structure-context.js', 'src/structure-context.js'],
  ['src/pre-generation-structure.js', 'src/pre-generation-structure.js'],
  ['src/useful-card-contract.js', 'src/useful-card-contract.js'],
  ['src/semantic-text.js', 'src/semantic-text.js'],
  ['src/useful-card-generation.js', 'src/useful-card-generation.js'],
  ['src/universal-knowledge-pipeline.js', 'src/universal-knowledge-pipeline.js'],
  ['src/knowledge-write-port.js', 'src/knowledge-write-port.js'],
  ['src/structured-writer.js', 'src/structured-writer.js']
];
function factory(id, sourcePath) {
  const source = fs.readFileSync(path.join(root, sourcePath), 'utf8')
    .replace(/^'use strict';\s*/, '')
    .replace(/require\('\.\/phase1-foundation\.js'\)/g, 'require("src/phase1-foundation.js")')
    .replace(/require\('\.\/production-flow-contract\.js'\)/g, 'require("src/production-flow-contract.js")')
    .replace(/require\('\.\/knowledge-write-port\.js'\)/g, 'require("src/knowledge-write-port.js")')
    .replace(/require\('\.\/content-integrity\.js'\)/g, 'require("src/content-integrity.js")')
    .replace(/require\('\.\/production-evolution\.js'\)/g, 'require("src/production-evolution.js")')
    .replace(/require\('\.\/v3\/evolution-contract\.js'\)/g, 'require("src/v3/evolution-contract.js")')
    .replace(/require\('\.\/structure-context\.js'\)/g, 'require("src/structure-context.js")')
    .replace(/require\('\.\/pre-generation-structure\.js'\)/g, 'require("src/pre-generation-structure.js")')
    .replace(/require\('\.\/useful-card-contract\.js'\)/g, 'require("src/useful-card-contract.js")')
    .replace(/require\('\.\/useful-card-generation\.js'\)/g, 'require("src/useful-card-generation.js")');
  const normalizedSource = source
    .replace(/require\('\.\/semantic-text\.js'\)/g, 'require("src/semantic-text.js")');
  const bundledSource = normalizedSource
    .replace(/require\(["']\.\/pdf\.worker\.js["']\)/g, 'require("vendor/pdf.worker.js")')
    .replace(/require\(["']\.\/content-integrity\.js["']\)/g, 'require("src/content-integrity.js")');
  return `"${id}": function(require, module, exports) {\n${bundledSource.trim()}\n},`;
}
const generated = `${START}\n${modules.map(([id, file]) => factory(id, file)).join('\n')}\n${END}`;
const current = fs.readFileSync(bundlePath, 'utf8');
let expected;
const presentStart = current.includes(START) ? START : current.includes(OLD_START) ? OLD_START : '';
if (presentStart) {
  expected = current.slice(0, current.indexOf(presentStart)) + generated
    + current.slice(current.indexOf(END) + END.length);
} else {
  const anchor = '/**\n * @module src/core/task';
  const offset = current.indexOf(anchor);
  assert(offset >= 0, '找不到结构化模块插入锚点');
  expected = `${current.slice(0, offset)}${generated}\n${current.slice(offset)}`;
}
const oldImport = 'const { runUniversalPipelineMultilingual } = require("src/universal-knowledge-pipeline.js");';
const priorImport = 'const { runUniversalPipelineMultilingual, isReusableUniversalArtifact } = require("src/universal-knowledge-pipeline.js");';
const newImport = 'const { runUniversalPipelineMultilingual, isReusableUniversalArtifact, reusableTranslationCache } = require("src/universal-knowledge-pipeline.js");';
if (expected.includes(oldImport)) expected = expected.replace(oldImport, newImport);
if (expected.includes(priorImport)) expected = expected.replace(priorImport, newImport);
const oldPredicate = `let universal = priorUniversal?.document?.source_hash === document.source_hash
      && priorUniversal?.pipeline_version === '5.0-structure-aware-useful-card'
      && priorUniversal?.document?.structure?.schema_version === 'structure-context/2.0'
      && Array.isArray(priorUniversal?.knowledge_units)
      && Array.isArray(priorUniversal?.knowledge_events)
      && priorUniversal.knowledge_events.every((event) => event?.schema_version === 'useful-card/2.0/knowledge-event')
      && Array.isArray(priorUniversal?.card_plans)
      && priorUniversal.card_plans.every((plan) => plan?.schema_version === 'useful-card/2.0/card-plan') ? priorUniversal : null;`;
const newPredicate = 'let universal = isReusableUniversalArtifact(priorUniversal, document.source_hash) ? priorUniversal : null;';
if (expected.includes(oldPredicate)) expected = expected.replace(oldPredicate, newPredicate);
const oldTranslationCache = 'translation_cache: translationCheckpoint?.cache || priorUniversal?.translation_cache || {},';
const newTranslationCache = 'translation_cache: reusableTranslationCache(translationCheckpoint, priorUniversal, document.source_hash),';
if (expected.includes(oldTranslationCache)) expected = expected.replace(oldTranslationCache, newTranslationCache);
const oldGateJapaneseFixture = "['ck-gate-ja', 'company_knowledge', `${businessBase}/日本語/品質 基準.md`, '品質基準'],";
const newGateJapaneseFixture = "['ck-gate-ja', 'company_knowledge', `${businessBase}/日本語/品質 基準.md`, '品質 基準'],";
if (expected.includes(oldGateJapaneseFixture)) expected = expected.replace(oldGateJapaneseFixture, newGateJapaneseFixture);
const oldGateFrontmatter = 'const content = `---\\nrecord_id: "${record_id}"\\nrecord_kind: "${record_kind}"\\nsource_document_ids: ["src-real-gate"]\\n---';
const newGateFrontmatter = 'const content = `---\\nrecord_id: "${record_id}"\\nrecord_kind: "${record_kind}"\\ntitle: "${title}"\\nsearch_title: "${title}"\\naliases: []\\nsource_document_ids: ["src-real-gate"]\\n---';
if (expected.includes(oldGateFrontmatter)) expected = expected.replace(oldGateFrontmatter, newGateFrontmatter);
assert(expected.includes(newImport), '找不到 universal pipeline 运行时导入锚点');
assert(expected.includes(newPredicate), '找不到 universal canonical 复用谓词锚点');
assert(expected.includes(newTranslationCache), '找不到安全 translation cache 复用锚点');
assert(expected.includes(newGateJapaneseFixture), '找不到真实 Obsidian 日文标题契约锚点');
assert(expected.includes(newGateFrontmatter), '找不到真实 Obsidian 卡片 frontmatter 契约锚点');
if (process.argv.includes('--check')) {
  assert.strictEqual(current, expected, 'main.js 内嵌结构化模块与 src 源文件不同步');
  console.log('structured phase embed: synchronized');
} else {
  fs.writeFileSync(bundlePath, expected);
  console.log('structured phase embed: updated');
}
