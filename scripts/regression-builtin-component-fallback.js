'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const Module = require('module');

class HostBase {}
class Plugin extends HostBase {}
class TFile extends HostBase {
  constructor(filePath, text) {
    super();
    this.path = filePath;
    this.text = text;
    this.stat = { mtime: 1, size: Buffer.byteLength(text) };
  }
}
class TFolder extends HostBase {}

function loadPlugin() {
  const originalLoad = Module._load;
  const obsidian = new Proxy({ Plugin, TFile, TFolder, requestUrl: async () => ({}) }, {
    get(target, property) {
      if (Object.hasOwn(target, property)) return target[property];
      return HostBase;
    }
  });
  try {
    Module._load = function(request, parent, isMain) {
      if (request === 'obsidian' || request === 'electron') return obsidian;
      return originalLoad.call(this, request, parent, isMain);
    };
    delete require.cache[require.resolve('../main.js')];
    return require('../main.js');
  } finally {
    Module._load = originalLoad;
  }
}

const root = path.join(__dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');
const genericSchema = JSON.stringify({ type: 'object', properties: {}, required: [] });
const folderMap = JSON.stringify({
  version: 'legacy',
  routes: [{
    library: 'business',
    folder_type: '06-风险库',
    output_folder: '06-知识库/wiki/业务库/06-风险库',
    prompt: '提示词/业务库/06-风险库.md'
  }]
});

function oldPack(overrides = {}) {
  return Object.assign({
    'legacy/pack/folder-map.json': folderMap,
    'legacy/pack/schemas/classification.schema.json': genericSchema,
    'legacy/pack/schemas/structured-summary.schema.json': genericSchema,
    'legacy/pack/schemas/knowledge-atoms.schema.json': genericSchema,
    'legacy/pack/提示词/00-类型判定.md': 'classifier',
    'legacy/pack/提示词/01-结构化总结-基础.md': 'summary',
    'legacy/pack/提示词/99-知识原子生成.md': 'atoms',
    'legacy/pack/模板/Type Mapping.md': 'mapping',
    'legacy/pack/Tag_Library.md': 'tags'
  }, overrides);
}

function runtime(files) {
  const entries = new Map(Object.entries(files).map(([filePath, text]) => [filePath, new TFile(filePath, text)]));
  const plugin = Object.create(loadPlugin().prototype);
  plugin.settings = {
    componentPackPath: 'legacy\\pack\\',
    artifactsPath: 'artifacts',
    aiChunkSize: 8000
  };
  plugin.componentCache = new Map();
  plugin.app = {
    vault: {
      getAbstractFileByPath: (filePath) => entries.get(filePath) || null,
      read: async (file) => file.text
    }
  };
  return { plugin, entries };
}

function contractHash(contracts) {
  return crypto.createHash('sha256').update(JSON.stringify({
    folderMap: contracts.folderMap, schemas: contracts.schemas, prompts: contracts.prompts
  })).digest('hex');
}

async function main() {
  globalThis.__eksDiag = { state: { buffer: [], events: [] } };
  let harness = runtime(oldPack());
  const contracts = await harness.plugin.loadRuntimeContracts();
  assert.strictEqual(contracts.schemas.blockV0.$id,
    'https://engineering-knowledge-slicer.local/schemas/block-v0.schema.json');
  assert.strictEqual(contracts.schemas.parsePackage.$id,
    'engineering-knowledge-slicer://schema/parse-package-1.1');
  assert.strictEqual(contracts.contractHash, contractHash(contracts));

  const fallbacks = globalThis.__eksDiag.state.events
    .filter((event) => event.scope === 'component.builtinFallback')
    .map((event) => event.data);
  assert.deepStrictEqual(fallbacks.map((event) => event.relativePath), [
    'schemas/block-v0.schema.json', 'schemas/parse-package.schema.json'
  ]);
  for (const event of fallbacks) {
    assert.deepStrictEqual(Object.keys(event).sort(),
      ['builtInVersion', 'hash', 'reason', 'relativePath']);
    assert.strictEqual(event.reason, 'missing');
    assert.match(event.hash, /^[a-f0-9]{64}$/);
    assert(!JSON.stringify(event).includes('"properties"'));
  }

  const customBlock = JSON.stringify({
    type: 'object', properties: { custom_wins: { type: 'boolean' } }, required: [], custom_wins: true
  });
  harness = runtime(oldPack({ 'legacy/pack/schemas/block-v0.schema.json': customBlock }));
  const customContracts = await harness.plugin.loadRuntimeContracts();
  assert.strictEqual(customContracts.schemas.blockV0.custom_wins, true);
  const difference = globalThis.__eksDiag.state.events
    .map((event) => event.data)
    .find((event) => event.relativePath === 'schemas/block-v0.schema.json' && event.effectiveSource);
  assert.strictEqual(difference.differs, true);
  assert.strictEqual(difference.replacementApplied, false);
  assert.match(difference.effectiveHash, /^[a-f0-9]{64}$/);

  harness = runtime(oldPack({ 'legacy/pack/schemas/block-v0.schema.json': '{malformed' }));
  await assert.rejects(() => harness.plugin.loadRuntimeContracts(),
    (error) => error.code === 'COMPONENT_CONFIG_INVALID'
      && error.details.reason === 'invalid_json'
      && error.details.builtInFallbackAvailable === true
      && error.details.builtInFallbackApplied === false);

  harness = runtime(oldPack());
  await assert.rejects(() => harness.plugin.loadComponentText('提示词/业务库/不存在.md'),
    (error) => error.code === 'COMPONENT_NOT_FOUND'
      && error.details.builtInFallbackAvailable === false);

  const parsedTask = {
    task_id: 'source-cache-hit',
    run_id: 'run-cache-hit',
    source_hash: 'a'.repeat(64),
    component_contract_hash: contracts.contractHash,
    artifacts: { parsed: 'artifacts/run-cache-hit/parsed.json' }
  };
  harness = runtime(oldPack());
  const parsedPayload = { parser: 'mineru-api', markdown: 'cached', blocks: [] };
  const envelope = {
    artifactVersion: 3,
    stage: 'parsed',
    inputFingerprint: harness.plugin.artifactInputFingerprint(parsedTask, 'parsed'),
    completedAt: '2026-07-29T00:00:00.000Z',
    validationState: 'valid',
    payload: parsedPayload
  };
  harness.entries.set(parsedTask.artifacts.parsed,
    new TFile(parsedTask.artifacts.parsed, JSON.stringify(envelope)));
  let migratedParsed = null;
  harness.plugin.persistArtifact = async (_task, name, value) => {
    if (name === 'parsed') migratedParsed = value;
  };
  let outboundRequests = 0;
  const loaded = await harness.plugin.loadArtifact(parsedTask, 'parsed');
  assert.strictEqual(loaded.markdown, parsedPayload.markdown);
  assert.strictEqual(loaded.blocks.length, 1);
  assert.strictEqual(loaded.blocks[0].locator.scheme, 'parsed-text-span');
  assert.strictEqual(Object.keys(loaded.evidence_index).length, 1);
  assert.deepStrictEqual(migratedParsed, loaded);
  assert.strictEqual(outboundRequests, 0);
  parsedTask.component_contract_hash = 'changed-downstream-contract';
  assert.deepStrictEqual(await harness.plugin.loadArtifact(parsedTask, 'parsed'), loaded,
    'parsed fingerprint must stay independent of downstream component contracts');
  const baseFingerprint = harness.plugin.artifactInputFingerprint(parsedTask, 'parsed');
  for (const [key, value] of [
    ['pdfMineruApiModel', 'different-mineru-model'],
    ['pdfMineruApiLanguage', 'en'],
    ['pdfExtractionOrder', 'paddleocr-api,mineru-api'],
    ['pdfPaddleOcrApiModel', 'different-paddle-model']
  ]) {
    const previous = harness.plugin.settings[key];
    harness.plugin.settings[key] = value;
    assert.notStrictEqual(harness.plugin.artifactInputFingerprint(parsedTask, 'parsed'), baseFingerprint, `${key} must invalidate parsed`);
    harness.plugin.settings[key] = previous;
  }
  for (const [key, value] of [
    ['pdfMineruApiKey', 'secret-change'],
    ['pdfExternalTimeoutMs', 1234],
    ['summaryConcurrency', 99]
  ]) {
    const previous = harness.plugin.settings[key];
    harness.plugin.settings[key] = value;
    assert.strictEqual(harness.plugin.artifactInputFingerprint(parsedTask, 'parsed'), baseFingerprint, `${key} must not invalidate parsed`);
    harness.plugin.settings[key] = previous;
  }
  harness.plugin.settings.pdfExtractionOrder = 'paddleocr-api,mineru-api';
  harness.plugin.providerLimiters = { paddleocr: { run: () => {} }, mineru: { run: () => {} } };
  assert.strictEqual((await harness.plugin.getPdfExtractorConfig()).order, 'paddleocr-api,mineru-api');

  const legacyTask = {
    task_id: 'legacy-selective', run_id: 'legacy-selective', source_hash: 'b'.repeat(64),
    artifacts: { parsed: 'artifacts/legacy/parsed.json', classification: 'artifacts/legacy/classification.json' }
  };
  const rawParsed = {
    parser: 'local-text', markdown: '可验证正文', blocks: [{
      block_id: 'b1', block_type: 'paragraph', raw: { text: '可验证正文' },
      locator: { scheme: 'line', value: '1' }, card_eligible: true
    }],
    evidence_index: { b1: { block_id: 'b1', raw_text: '可验证正文', locator: { scheme: 'line', value: '1' } } }
  };
  harness.entries.set(legacyTask.artifacts.parsed, new TFile(legacyTask.artifacts.parsed, JSON.stringify(rawParsed)));
  harness.entries.set(legacyTask.artifacts.classification, new TFile(legacyTask.artifacts.classification,
    JSON.stringify({ library: 'business', folder_type: '06-风险库', confidence: 1 })));
  const migratedStages = [];
  harness.plugin.persistArtifact = async (_task, stage, payload) => migratedStages.push({ stage, payload });
  const migratedLegacy = await harness.plugin.loadArtifact(legacyTask, 'parsed');
  assert.strictEqual(migratedLegacy.markdown, rawParsed.markdown);
  assert.strictEqual(migratedLegacy.blocks[0].block_id, 'b1');
  assert.deepStrictEqual(migratedLegacy.blocks[0].locator, rawParsed.blocks[0].locator);
  assert.strictEqual(migratedLegacy.evidence_index.b1.raw_text, '可验证正文');
  assert(migratedLegacy.parse_contract.fingerprint);
  assert.deepStrictEqual(migratedStages.map((item) => item.stage), ['parsed'],
    'verified legacy parsed migrates once and can prevent repeated OCR');
  assert.strictEqual(await harness.plugin.loadArtifact(legacyTask, 'classification'), null,
    'raw legacy AI downstream must not bypass current fingerprints');

  const changedCanonical = JSON.parse(JSON.stringify(contracts));
  changedCanonical.schemas.parsePackage.title = 'canonical-content-change';
  assert.notStrictEqual(contractHash(changedCanonical), contracts.contractHash,
    'built-in canonical schema content must participate in the component contract hash');

  const canonicalPaths = {
    'schemas/block-v0.schema.json': '组件包/schemas/block-v0.schema.json',
    'schemas/parse-package.schema.json': '组件包/schemas/parse-package.schema.json'
  };
  const components = require('./load-bundle-module.js').loadBundleModule('src/core/component-loader.js', {
    crypto
  });
  const reliability = require('./load-bundle-module.js').loadBundleModule('src/core/reliability.js');
  assert.match(reliability.classifyFailure({ code: 'COMPONENT_NOT_FOUND' }).suggestedAction,
    /没有可用的内置兼容回退/);
  assert.match(reliability.classifyFailure({ code: 'COMPONENT_CONFIG_INVALID' }).suggestedAction,
    /不会替换已存在但无效的自定义内容/);
  for (const [relativePath, canonicalPath] of Object.entries(canonicalPaths)) {
    const builtIn = components.builtInInfrastructureSchema(relativePath.replace(/\//g, '\\'));
    assert.strictEqual(builtIn.text, read(canonicalPath), `${relativePath} must exactly match canonical bytes`);
    assert.strictEqual(builtIn.hash, crypto.createHash('sha256').update(read(canonicalPath)).digest('hex'));
  }
  assert.deepStrictEqual([...components.BUILTIN_INFRASTRUCTURE_SCHEMA_PATHS], Object.keys(canonicalPaths));

  console.log('built-in component fallback regression: legacy vault, precedence, invalid/missing boundaries, diagnostics, Windows paths, selective fingerprints and hashes passed');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
