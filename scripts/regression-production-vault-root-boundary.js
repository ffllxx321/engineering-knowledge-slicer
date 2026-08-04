'use strict';

const assert = require('assert');
const Module = require('module');
const path = require('path');

class HostBase {}
class Plugin extends HostBase {}
class TFile extends HostBase {
  constructor(filePath, text = '') {
    super();
    this.path = filePath;
    this.name = filePath.split('/').pop();
    this.extension = this.name.includes('.') ? this.name.split('.').pop() : '';
    this.text = text;
    this.stat = { mtime: 1, size: Buffer.byteLength(text) };
  }
}
class TFolder extends HostBase {}

function loadProductionPlugin() {
  const originalLoad = Module._load;
  const obsidian = new Proxy({
    Plugin,
    TFile,
    TFolder,
    Notice: class Notice {},
    normalizePath: (value) => String(value || '').replace(/\\/g, '/').replace(/\/+/g, '/'),
    requestUrl: async () => {
      throw new Error('PROVIDER_CALL_FORBIDDEN');
    }
  }, {
    get(target, property) {
      if (Object.hasOwn(target, property)) return target[property];
      return HostBase;
    }
  });
  try {
    Module._load = function load(request, parent, isMain) {
      if (request === 'obsidian' || request === 'electron') return obsidian;
      return originalLoad.call(this, request, parent, isMain);
    };
    delete require.cache[require.resolve('../main.js')];
    return require('../main.js');
  } finally {
    Module._load = originalLoad;
  }
}

const hostRoot = "C:\\工作\\OneDrive - SHIMIZU CORPORATION\\团队 O'Brien\\知识库";
const poisonedPath = `${hostRoot}\\在办投标库\\src-poisoned.md`;
const forbiddenFragments = [
  'C:', '工作', 'OneDrive - SHIMIZU CORPORATION', "团队 O'Brien", '知识库\\'
];

function assertVaultPath(rawPath, operation) {
  const value = String(rawPath || '');
  assert(value, `${operation} received an empty path`);
  assert(!path.win32.isAbsolute(value), `${operation} leaked a Windows host path: ${value}`);
  assert(!path.posix.isAbsolute(value), `${operation} leaked a POSIX host path: ${value}`);
  assert(!value.includes('\\'), `${operation} received a non-canonical vault path: ${value}`);
  for (const fragment of forbiddenFragments) {
    assert(!value.includes(fragment), `${operation} leaked a host-path fragment: ${value}`);
  }
  assert(!value.split('/').includes('..'), `${operation} escaped the vault: ${value}`);
  return value;
}

function createVault(initialFiles) {
  const files = new Map(Object.entries(initialFiles));
  const folders = new Set();
  const calls = [];
  const record = (operation, ...rawPaths) => {
    const paths = rawPaths.map((value) => assertVaultPath(value, operation));
    calls.push({ operation, paths });
    return paths;
  };
  const adapter = {
    exists: async (rawPath) => {
      const [filePath] = record('exists', rawPath);
      return files.has(filePath) || folders.has(filePath);
    },
    read: async (rawPath) => {
      const [filePath] = record('read', rawPath);
      if (!files.has(filePath)) {
        const error = new Error(`ENOENT ${filePath}`);
        error.code = 'ENOENT';
        throw error;
      }
      return files.get(filePath);
    },
    write: async (rawPath, content) => {
      const [filePath] = record('write', rawPath);
      files.set(filePath, String(content));
    },
    rename: async (rawFrom, rawTo) => {
      const [from, to] = record('rename', rawFrom, rawTo);
      assert(files.has(from), `rename source does not exist: ${from}`);
      files.set(to, files.get(from));
      files.delete(from);
    },
    remove: async (rawPath) => {
      const [filePath] = record('remove', rawPath);
      files.delete(filePath);
    },
    mkdir: async (rawPath) => {
      const [folderPath] = record('mkdir', rawPath);
      folders.add(folderPath);
    }
  };
  const vault = {
    adapter,
    getAbstractFileByPath(rawPath) {
      const filePath = assertVaultPath(rawPath, 'getAbstractFileByPath');
      return files.has(filePath) ? new TFile(filePath, files.get(filePath)) : null;
    },
    getMarkdownFiles() {
      return [...files.entries()]
        .filter(([filePath]) => filePath.endsWith('.md'))
        .map(([filePath, text]) => new TFile(filePath, text));
    },
    read: async (file) => adapter.read(file.path),
    createFolder: async (rawPath) => adapter.mkdir(rawPath),
    create: async (rawPath, content) => adapter.write(rawPath, content),
    modify: async (file, content) => adapter.write(file.path, content),
    rename: async (file, target) => adapter.rename(file.path, target)
  };
  return { vault, files, calls };
}

const sourceHash = 'a'.repeat(64);
const parsed = {
  schema_version: 'parse-package/1.1',
  source_path: '',
  source_hash: sourceHash,
  source_type: 'pdf',
  title: "Unicode 空格与 apostrophe 的恢复",
  metadata: { document_role: 'source_record' },
  blocks: [{
    schema_version: 'block_v0',
    block_id: 'block-root-boundary-01',
    source_hash: sourceHash,
    order: 0,
    parent_id: null,
    kind: 'paragraph',
    locator: { scheme: 'page', value: '1', page: 1 },
    provenance: [{ scheme: 'page', value: '1', page: 1 }],
    raw: { text: '施工前必须完成安全检查。', fields: {} },
    inferred: {},
    parse: { method: 'pdf', quality: 1, status: 'present' },
    card_eligible: true,
    exclusion_reason: null,
    metadata: {}
  }]
};

function createPlugin(PluginClass, vaultHarness, task, artifacts, counters) {
  const plugin = Object.create(PluginClass.prototype);
  plugin.app = { vault: vaultHarness.vault };
  plugin.settings = {
    controlledWriterEnabled: true,
    structuredWriterMode: 'structured-write',
    structuredActiveRoot: "在办投标库/日本 O'Brien",
    structuredBusinessRoot: '长期业务库/工程 知识',
    artifactsPath: '系统/产物',
    componentPackPath: '组件包',
    structuredMaxRecords: 100,
    structuredMaxActions: 300,
    structuredMaxLinkFanout: 20,
    minimaxModel: 'provider-must-not-run',
    businessTimeZone: 'Asia/Shanghai'
  };
  plugin.operationCounters = {
    apiRequests: 0, aiRetries: 0, summaryReduceRequests: 0,
    promptCharacters: 0, outputCharacters: 0, bytesRead: 0,
    bytesWritten: 0, ledgerWrites: 0, artifactWrites: 0
  };
  plugin.sessionStats = {
    scanned: 0, processed: 0, written: 0, review: 0,
    failed: 0, skipped: 0, current: '', lastMessage: ''
  };
  plugin.taskControllers = new Map();
  plugin._terminalTaskIds = new Set();
  plugin.pauseRequested = false;
  plugin.cancelRequestedTaskId = '';
  plugin.structuredWriterLock = {
    tail: Promise.resolve(),
    acquire: async () => () => {}
  };
  plugin.componentCache = new Map();
  plugin.loadTasks = async () => [task];
  plugin.saveTasks = async () => {};
  plugin.flushSaveTasksImmediate = async () => {};
  plugin.refreshViews = async () => {};
  plugin.refreshProgressOnly = () => {};
  plugin.transitionCompletionUi = async () => {};
  plugin.writeTaskLog = async () => {};
  plugin.setTaskProgress = async (current, message, details) => {
    counters.progress.push({ message, ...details });
    current.progress = { message, ...details };
  };
  plugin.loadArtifact = async (_current, name) => {
    counters.artifactLoads[name] = (counters.artifactLoads[name] || 0) + 1;
    return artifacts[name] || null;
  };
  plugin.persistArtifact = async (current, name, value) => {
    artifacts[name] = value;
    current.artifacts = Object.assign({}, current.artifacts, {
      [name]: `系统/产物/${current.run_id}/${name}.json`
    });
  };
  return plugin;
}

async function main() {
  globalThis.__eksDiag = { state: { buffer: [], events: [] } };
  const PluginClass = loadProductionPlugin();
  assert.strictEqual(typeof PluginClass.prototype.runStructuredWriterPhase, 'function');
  assert.strictEqual(typeof PluginClass.prototype.processTask, 'function');

  const poisonedIndex = {
    schema_version: 'id-path-index/1.0',
    revision: 0,
    records: {
      'src-poisoned': {
        record_id: 'src-poisoned',
        record_kind: 'source_document',
        path: poisonedPath
      }
    }
  };
  const indexPath = '系统/产物/structured-writer/id-path-index.v1.json';
  const registryPath = '系统/产物/structured-writer/project-registry.v1.json';
  const vaultHarness = createVault({
    [indexPath]: JSON.stringify(poisonedIndex),
    [registryPath]: '[]'
  });
  const task = {
    task_id: 'resume-with-empty-source-path',
    run_id: 'run-production-executable-gate',
    source_identity: 'resume-with-empty-source-path',
    source_path: '',
    source_hash: sourceHash,
    source_type: 'pdf',
    created_at: '2026-07-31T00:00:00.000Z',
    discovered_at: '2026-07-31T00:00:00.000Z',
    status: 'queued',
    errors: [],
    artifacts: {
      parsed: '系统/产物/run-production-executable-gate/parsed.json',
      'universal-canonical': '系统/产物/run-production-executable-gate/universal-canonical.json'
    },
    written_card_ids: [],
    review_atom_ids: []
  };
  const canonical = require('../src/universal-knowledge-pipeline.js')
    .runUniversalPipeline({ document: {
      source_identity: task.source_identity,
      source_document_id: task.task_id,
      source_path: '',
      source_hash: sourceHash,
      source_type: 'pdf',
      media_type: 'pdf',
      title: parsed.title,
      ingested_at: task.created_at,
      metadata: parsed.metadata,
      blocks: parsed.blocks
    } });
  const artifacts = { parsed, 'universal-canonical': canonical };
  const counters = { artifactLoads: {}, progress: [], parser: 0, upload: 0, provider: 0 };
  const plugin = createPlugin(PluginClass, vaultHarness, task, artifacts, counters);

  const direct = await PluginClass.prototype.runStructuredWriterPhase.call(plugin, task, parsed);
  assert.strictEqual(direct.mode, 'structured-write');
  assert(direct.plan && direct.plan.actions.length > 0, 'actual bundled writer must produce a plan');
  assert(direct.transaction, 'actual bundled writer must commit its plan');
  assert.strictEqual(direct.transaction.verified.counts.knowledge_records, 1);
  assert.strictEqual(direct.transaction.verified.knowledge_paths.length, 1);
  assert.strictEqual(direct.universalResult, canonical, 'the valid universal checkpoint must be reused');
  assert.strictEqual(counters.artifactLoads['universal-canonical'], 1);
  assert.strictEqual(plugin.operationCounters.apiRequests, 0);
  assert(!JSON.stringify(direct.plan).includes(hostRoot), 'poisoned host paths must not enter the plan');
  const persistedIndex = JSON.parse(vaultHarness.files.get(indexPath));
  assert(!JSON.stringify(persistedIndex).includes(hostRoot), 'the committed index must discard poisoned host paths');

  // Exercise the actual processTask resume boundary as well. The parsed and
  // universal checkpoints are supplied by loadArtifact, so any parser/upload or
  // provider access is a hard test failure.
  await PluginClass.prototype.processTask.call(plugin, task);
  assert.strictEqual(counters.parser, 0);
  assert.strictEqual(counters.upload, 0);
  assert.strictEqual(counters.provider, 0);
  assert.strictEqual(plugin.operationCounters.apiRequests, 0);
  assert(counters.artifactLoads.parsed >= 1, 'processTask must load the parsed checkpoint');
  assert(counters.artifactLoads['universal-canonical'] >= 2,
    'processTask must pass through the bundled writer and reuse the universal checkpoint');
  assert(counters.progress.some((entry) => entry.stage === 'universal-writer'));
  assert(counters.progress.some((entry) => entry.stage === 'writing'));
  assert(!counters.progress.some((entry) => entry.stage === 'component-contracts'),
    'universal resume must never enter component-contracts');
  assert(['stored', 'pending_confirmation', 'failed'].includes(task.status),
    `unexpected final status: ${task.status}`);
  assert.strictEqual(task.status, 'stored');
  assert.strictEqual(task.result_counts.knowledge_records, 1);
  assert.strictEqual(task.result_counts.unchanged, 1);
  assert.strictEqual(task.output_paths.length, 1);
  assert.strictEqual(task.artifacts.knowledge_records, undefined);
  assert.strictEqual(task.verified_records.length, 1);

  await assert.rejects(
    () => PluginClass.prototype.loadComponentText.call(plugin, '提示词/业务库/刻意缺失.md'),
    (error) => error.code === 'COMPONENT_NOT_FOUND'
      && error.code !== 'FILE_NOT_FOUND'
  );
  for (const operation of ['exists', 'read', 'write']) {
    assert(vaultHarness.calls.some((call) => call.operation === operation),
      `mock adapter did not observe production ${operation}`);
  }

  console.log(JSON.stringify({
    gate: 'production vault-root boundary executable',
    bundledMethods: ['runStructuredWriterPhase', 'processTask'],
    sourcePath: task.source_path,
    checkpointReuse: { parsed: true, universalCanonical: true },
    calls: {
      parser: counters.parser,
      upload: counters.upload,
      provider: counters.provider,
      adapter: vaultHarness.calls.reduce((counts, call) => {
        counts[call.operation] = (counts[call.operation] || 0) + 1;
        return counts;
      }, {})
    },
    finalStage: counters.progress.findLast((entry) => entry.stage)?.stage,
    finalStatus: task.status,
    committedActions: direct.plan.actions.length,
    verifiedKnowledgeRecords: direct.transaction.verified.counts.knowledge_records,
    rerunUnchanged: task.result_counts.unchanged,
    outputPaths: task.output_paths,
    componentMissingCode: 'COMPONENT_NOT_FOUND'
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
