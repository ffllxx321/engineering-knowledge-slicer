'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { runUniversalPipeline } = require('../src/universal-knowledge-pipeline.js');
const { buildPlan, emptyIndex, pathSafe, validateIndex } = require('../src/structured-writer.js');
const { loadBundleModule } = require('./load-bundle-module.js');

const root = path.join(__dirname, '..');
const production = fs.readFileSync(path.join(root, 'main.js'), 'utf8');
const hostRoot = "C:\\工作\\OneDrive - SHIMIZU CORPORATION\\团队 O'Brien\\知识库";
const poisonedPath = `${hostRoot}\\在办投标库\\src-poisoned.md`;

assert.strictEqual(pathSafe(poisonedPath), false, 'Windows host paths must never be vault paths');
const poisonedIndex = emptyIndex();
poisonedIndex.records['src-poisoned'] = {
  record_id: 'src-poisoned', record_kind: 'source_document', path: poisonedPath
};
const checked = validateIndex(poisonedIndex);
assert.deepStrictEqual(checked.index.records, {}, 'invalid host paths must be removed at the persisted-index boundary');
assert.strictEqual(checked.discarded[0].cause, 'malformed_index');

const document = {
  source_identity: 'resume-with-empty-source-path',
  source_document_id: 'resume-with-empty-source-path',
  source_path: '',
  source_hash: 'a'.repeat(64),
  source_type: 'pdf',
  media_type: 'pdf',
  title: "Unicode 空格与 apostrophe 的恢复",
  ingested_at: '2026-07-31T00:00:00.000Z',
  metadata: { document_role: 'source_record' },
  blocks: [{
    schema_version: 'block_v0', block_id: 'block-root-boundary-01',
    source_hash: 'a'.repeat(64), order: 0, parent_id: null, kind: 'paragraph',
    locator: { scheme: 'page', value: '1', page: 1 },
    provenance: [{ scheme: 'page', value: '1', page: 1 }],
    raw: { text: '施工前必须完成安全检查。', fields: {} }, inferred: {},
    parse: { method: 'pdf', quality: 1, status: 'present' },
    card_eligible: true, exclusion_reason: null, metadata: {}
  }]
};
const universalResult = runUniversalPipeline({ document });
const settings = {
  controlledWriterEnabled: true, structuredWriterMode: 'structured-pilot',
  structuredActiveRoot: "在办投标库/日本 O'Brien", structuredBusinessRoot: '长期业务库/工程 知识',
  artifactsPath: '系统/产物', structuredMaxRecords: 100, structuredMaxActions: 300,
  structuredMaxLinkFanout: 20
};
for (const index of [emptyIndex(), poisonedIndex]) {
  const plan = buildPlan({
    settings, document, universalResult, projectRegistry: [],
    index: validateIndex(index).index, existingFiles: {}, logicalTime: document.ingested_at
  });
  assert(plan.actions.length > 0, 'clean and resumed plans must remain productive');
  assert(!JSON.stringify(plan).includes(hostRoot), 'a host root must not contaminate a plan or source path');
}

const reliability = loadBundleModule('src/core/reliability.js');
assert.notStrictEqual(reliability.classifyFailure({ code: 'VAULT_PATH_INVALID', message: `ENOENT ${poisonedPath}` }).code,
  'FILE_NOT_FOUND', 'path-contract failures must not claim that the source file disappeared');
assert.strictEqual(reliability.classifyFailure({ code: 'COMPONENT_NOT_FOUND' }).category, 'component_config',
  'missing components must retain component-specific classification');

const processStart = production.indexOf('  async processTask(task) {');
const processEnd = production.indexOf('\n  async loadComponentText(', processStart);
const processTask = production.slice(processStart, processEnd);
assert(processTask.includes("stage: universalProduction ? 'universal-writer' : 'component-contracts'"),
  'universal production must not retain a stale component-contract checkpoint');
assert(processTask.includes("let parsePackage = await this.loadArtifact(current, 'parsed');"),
  'resume must load parsed before deciding whether a source file is required');
assert(processTask.includes('if (!current.source_path && !parsePackage)'),
  'empty sourcePath is allowed only when a parsed checkpoint is reusable');

const writerStart = production.indexOf('  async runStructuredWriterPhase(task, parsePackage) {');
const writerEnd = production.indexOf('\n  async writeAcceptedCard(', writerStart);
const writer = production.slice(writerStart, writerEnd);
assert(writer.includes('validateStructuredIndex(rawIndex)'), 'runtime must sanitize persisted index paths');
assert(writer.includes("vaultRelativePath(entry.path, 'structured index record')"),
  'index reads must cross the canonical vault-relative boundary');
assert(writer.includes('priorUniversal?.document?.source_hash === document.source_hash'),
  'resume must reuse the universal checkpoint without provider calls');
assert(!writer.includes('adapter.getBasePath'), 'writer must never reconstruct host paths from the vault base path');

const componentStart = production.indexOf('  async loadComponentText(relativePath) {');
const componentEnd = production.indexOf('\n  async loadComponentJson(', componentStart);
const componentLoader = production.slice(componentStart, componentEnd);
assert(componentLoader.includes('this.app.vault.read(file)'));
assert(!componentLoader.includes("require('fs')"), 'component files must be read only through vault APIs');
assert(componentLoader.includes('builtInInfrastructureSchema(normalizedRelative)'),
  'cache misses must retain the intended built-in schema fallback');

console.log('production vault-root boundary regression: clean/resume, Windows Unicode paths, empty sourcePath, fallback and classification passed');
