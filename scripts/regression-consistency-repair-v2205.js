'use strict';

const assert = require('assert');
const Module = require('module');

class Host {}
class Plugin extends Host {}
class TFile extends Host {
  constructor(path, text = '') { super(); this.path = path; this.name = path.split('/').pop(); this.text = text; }
}

let providerCalls = 0;
function loadPlugin() {
  const original = Module._load;
  const obsidian = new Proxy({
    Plugin, TFile, TFolder: class TFolder extends Host {}, Notice: class Notice {},
    normalizePath: (value) => String(value || '').replace(/\\/g, '/').replace(/\/+/g, '/'),
    requestUrl: async (request) => {
      providerCalls += 1;
      const body = JSON.parse(request.body);
      const prompt = body.messages?.find((row) => row.role === 'user')?.content || '';
      const ids = [...new Set([...prompt.matchAll(/"region_id":"([^"]+)"/g)].map((match) => match[1]))];
      return {
        status: 200,
        json: {
          content: [{
            type: 'tool_use', name: 'return_structured_result',
            input: { translations: ids.map((region_id) => ({
              region_id, translated_text: '承包商必须在施工前完成安全检查，并保留记录。'
            })) }
          }]
        }
      };
    }
  }, { get: (target, key) => Object.hasOwn(target, key) ? target[key] : Host });
  try {
    Module._load = (request, parent, isMain) =>
      request === 'obsidian' || request === 'electron' ? obsidian : original.call(Module, request, parent, isMain);
    delete require.cache[require.resolve('../main.js')];
    return require('../main.js');
  } finally {
    Module._load = original;
  }
}

function vault(initial = {}) {
  const files = new Map(Object.entries(initial));
  const folders = new Set();
  const adapter = {
    exists: async (path) => files.has(path) || folders.has(path),
    read: async (path) => files.get(path),
    write: async (path, value) => files.set(path, String(value)),
    rename: async (from, to) => { files.set(to, files.get(from)); files.delete(from); },
    remove: async (path) => files.delete(path),
    mkdir: async (path) => folders.add(path)
  };
  return {
    files,
    vault: {
      adapter,
      getAbstractFileByPath: (path) => files.has(path) ? new TFile(path, files.get(path)) : null,
      getMarkdownFiles: () => [...files].filter(([path]) => path.endsWith('.md')).map(([path, text]) => new TFile(path, text)),
      read: async (file) => files.get(file.path),
      createFolder: adapter.mkdir,
      create: adapter.write,
      modify: async (file, value) => adapter.write(file.path, value)
    }
  };
}

function plugin(PluginClass, harness, artifacts = {}) {
  const value = Object.create(PluginClass.prototype);
  value.app = { vault: harness.vault };
  value.settings = {
    controlledWriterEnabled: true, structuredWriterMode: 'structured-write',
    structuredActiveRoot: "在办投标库/日本 O'Brien", structuredBusinessRoot: '长期业务库/中文 名称',
    artifactsPath: '系统/产物', componentPackPath: '组件包', minimaxApiKey: 'test-key',
    minimaxEndpoint: 'https://api.minimaxi.com/anthropic/v1/messages', minimaxModel: 'MiniMax-M3',
    structuredMaxRecords: 100, structuredMaxActions: 100, structuredMaxLinkFanout: 20,
    aiRequestTimeoutMs: 10000, aiRequestMaxAttempts: 1
  };
  value.operationCounters = { apiRequests: 0, aiRetries: 0, summaryReduceRequests: 0, promptCharacters: 0, outputCharacters: 0, bytesRead: 0, bytesWritten: 0, ledgerWrites: 0, artifactWrites: 0 };
  value.sessionStats = { processed: 0, failed: 0, written: 0, review: 0, skipped: 0, current: '', lastMessage: '' };
  value.taskControllers = new Map();
  value._terminalTaskIds = new Set();
  value.activeTaskRuns = new Map();
  value.taskLeaseOwner = 'test-session';
  value.providerLimiters = { minimax: { run: async (fn, options) => { value.limiterCalls += 1; assert(options && 'signal' in options); return fn(); } } };
  value.limiterCalls = 0;
  value.structuredWriterLock = { tail: Promise.resolve(), acquire: async () => () => {} };
  value.loadArtifact = async (_task, name) => artifacts[name] || null;
  value.persistArtifact = async (_task, name, data) => { artifacts[name] = data; };
  value.refreshViews = async () => {};
  value.refreshProgressOnly = () => {};
  return value;
}

async function translationAndState(PluginClass) {
  const indexPath = '系统/产物/structured-writer/id-path-index.v1.json';
  const registryPath = '系统/产物/structured-writer/project-registry.v1.json';
  const harness = vault({ [indexPath]: JSON.stringify({ schema_version: 'id-path-index/1.0', revision: 0, records: {} }), [registryPath]: '[]' });
  const artifacts = {};
  const p = plugin(PluginClass, harness, artifacts);
  const task = { task_id: 'english-task', run_id: 'english-run', source_path: "资料/O'Brien 安全.txt", source_hash: 'b'.repeat(64), source_type: 'txt', created_at: '2026-07-31T00:00:00.000Z' };
  const parsed = { title: 'Safety requirement', metadata: { document_role: 'source_record' }, blocks: [{
    block_id: 'english-block', kind: 'paragraph', order: 0, locator: { scheme: 'line', value: '1' },
    provenance: [{ scheme: 'line', value: '1' }], raw: { text: 'The contractor must complete a safety inspection before work and retain the record.', fields: {} },
    inferred: {}, parse: { method: 'text', quality: 1, status: 'present' }, card_eligible: true, metadata: {}
  }] };
  const first = await p.runStructuredWriterPhase(task, parsed);
  assert(first.universalResult.knowledge_units.length > 0);
  assert.strictEqual(providerCalls, 1);
  assert.strictEqual(p.limiterCalls, 1);
  assert.strictEqual(p.operationCounters.apiRequests, 1);
  assert(p.operationCounters.promptCharacters > 0 && p.operationCounters.outputCharacters > 0);

  const before = providerCalls;
  const second = await p.runStructuredWriterPhase(task, parsed);
  assert.strictEqual(providerCalls, before, 'valid universal checkpoint must make zero provider calls');
  assert.strictEqual(second.universalResult.document.source_hash, task.source_hash);

  const corruptIndex = vault({ [indexPath]: '{broken', [registryPath]: '[]' });
  const corruptPlugin = plugin(PluginClass, corruptIndex, { 'universal-canonical': artifacts['universal-canonical'] });
  await assert.rejects(() => corruptPlugin.runStructuredWriterPhase(task, parsed),
    (error) => error.code === 'STRUCTURED_INDEX_CORRUPT' && error.stage === 'structured-state-index-read');
  assert.strictEqual(corruptIndex.files.get(indexPath), '{broken');

  const corruptRegistry = vault({ [indexPath]: JSON.stringify({ schema_version: 'id-path-index/1.0', revision: 0, records: {} }), [registryPath]: '{broken' });
  const registryPlugin = plugin(PluginClass, corruptRegistry, { 'universal-canonical': artifacts['universal-canonical'] });
  await assert.rejects(() => registryPlugin.runStructuredWriterPhase(task, parsed),
    (error) => error.code === 'PROJECT_REGISTRY_CORRUPT' && error.stage === 'structured-state-registry-read');
  assert.strictEqual(corruptRegistry.files.get(registryPath), '{broken');
}

async function mutualExclusion(PluginClass) {
  const p = Object.create(PluginClass.prototype);
  p.activeTaskRuns = new Map();
  p.taskLeaseOwner = 'test';
  p.sessionStats = {};
  p._processTaskOwned = async () => {
    p.executions = (p.executions || 0) + 1;
    await new Promise((resolve) => setTimeout(resolve, 20));
    return { processed: true };
  };
  const task = { task_id: 'same-task', source_path: '资料/同一任务.md' };
  const [first, second] = await Promise.all([p.processTask(task), p.processTask(task)]);
  assert.strictEqual(p.executions, 1);
  assert([first, second].some((result) => result.alreadyProcessing === true));
}

async function ledgerRecovery(PluginClass) {
  const ledgerPath = '系统/日志/tasks.json';
  const corrupt = vault({ [ledgerPath]: '{broken' });
  const reader = Object.create(PluginClass.prototype);
  reader.app = { vault: corrupt.vault };
  reader.settings = { logPath: '系统/日志', tasksFileName: 'tasks.json' };
  await assert.rejects(() => reader.loadTasks(),
    (error) => error.code === 'TASK_LEDGER_CORRUPT' && error.stage === 'task-ledger-read');
  assert.strictEqual(corrupt.files.get(ledgerPath), '{broken');

  const durable = vault();
  const writer = Object.create(PluginClass.prototype);
  writer.app = { vault: durable.vault };
  writer.settings = { logPath: '系统/日志', tasksFileName: 'tasks.json', backupTasksOnSave: false };
  writer.operationCounters = { ledgerWrites: 0, bytesWritten: 0 };
  writer.ensureFolders = async () => {};
  const first = { task_id: 'progress-task', run_id: 'r1', schema_version: '1.1', source_path: '资料/进度.md', status: 'slicing' };
  const second = { task_id: 'terminal-task', run_id: 'r2', schema_version: '1.1', source_path: "资料/O'Brien 完成.md", status: 'written' };
  const scheduled = await writer.saveTasks([first]);
  assert.deepStrictEqual(scheduled, { scheduled: true, durable: false });
  const overlay = await writer.loadTasks();
  overlay.push(second);
  await Promise.all([writer.saveTasks(overlay), writer.flushSaveTasksImmediate()]);
  await writer.flushSaveTasksImmediate();
  const persisted = JSON.parse(durable.files.get(ledgerPath));
  assert.deepStrictEqual(new Set(persisted.map((task) => task.task_id)), new Set(['progress-task', 'terminal-task']));
}

async function main() {
  globalThis.__eksDiag = { state: { buffer: [], events: [] } };
  const PluginClass = loadPlugin();
  await translationAndState(PluginClass);
  await mutualExclusion(PluginClass);
  await ledgerRecovery(PluginClass);
  console.log(JSON.stringify({
    gate: 'bundled consistency repair v2.20.5',
    translation: { cacheMissProviderCalls: 1, limiterCalls: 1, apiRequests: 1, cacheHitProviderCalls: 0 },
    taskExecution: { concurrentEntries: 2, ownedExecutions: 1, statusOverwrite: 0 },
    structuredState: ['STRUCTURED_INDEX_CORRUPT', 'PROJECT_REGISTRY_CORRUPT'],
    taskLedger: { corruptCode: 'TASK_LEDGER_CORRUPT', overlappingRecordsPreserved: 2 },
    destructiveOverwrites: 0
  }, null, 2));
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
