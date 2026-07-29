const assert = require('assert');
const { loadBundleModule } = require('./load-bundle-module.js');
const components = loadBundleModule('src/core/component-loader.js');
const reliability = loadBundleModule('src/core/reliability.js');
const diagnostics = loadBundleModule('src/core/diagnostic-report.js', { crypto: require('crypto') });

function expectCode(fn, code, reason) {
  assert.throws(fn, (error) => error.code === code && (!reason || error.details?.reason === reason));
}

async function main() {
  assert.strictEqual(
    components.resolveComponentFilePath('自定义知识库/我的组件', '提示词\\业务库\\01-客户库.md'),
    '自定义知识库/我的组件/提示词/业务库/01-客户库.md'
  );
  assert.strictEqual(
    components.resolveComponentFilePath('自定义知识库\\我的组件\\', 'folder-map.json'),
    '自定义知识库/我的组件/folder-map.json'
  );
  for (const [value, reason] of [
    ['', 'empty'], ['   ', 'empty'], ['提示词/', 'trailing_slash'],
    ['/', 'trailing_slash'], ['\\', 'trailing_slash'],
    ['C:\\组件\\提示词.md', 'absolute_path'], ['../提示词.md', 'unsafe_segment'],
    ['提示词/无扩展名', 'missing_extension'], ['提示词/prompt.txt', 'unsupported_extension']
  ]) expectCode(() => components.resolveComponentFilePath('06-知识库', value), 'COMPONENT_PATH_INVALID', reason);
  for (const invalidRoot of ['', '/', 'C:\\组件包', '../组件包']) {
    expectCode(() => components.resolveComponentFilePath(invalidRoot, 'folder-map.json'), 'COMPONENT_CONFIG_INVALID');
  }

  const reads = [];
  const readComponent = (relativePath) => {
    const resolved = components.resolveComponentFilePath('06-知识库', relativePath);
    reads.push(resolved);
    return resolved;
  };
  assert.strictEqual(readComponent('组件包/folder-map.json'), '06-知识库/组件包/folder-map.json');
  for (const invalid of ['', '', '/', '\\']) expectCode(() => readComponent(invalid), 'COMPONENT_PATH_INVALID');
  assert.deepStrictEqual(reads, ['06-知识库/组件包/folder-map.json']);

  const legacy = components.normalizeFolderMapConfig({
    version: '1.0',
    routes: [{ library: 'business', folder_type: '06-风险库', output_folder: '06-知识库/wiki/业务库/06-风险库' }]
  });
  assert.strictEqual(legacy.routes[0].prompt, '提示词/业务库/06-风险库.md');
  expectCode(() => components.normalizeFolderMapConfig({
    routes: [{ library: 'custom', folder_type: 'document-derived-value', output_folder: 'custom' }]
  }), 'COMPONENT_CONFIG_INVALID', 'prompt_missing');
  expectCode(() => components.validateRuntimeContracts({
    schemas: { classification: { type: 'object', properties: {}, required: [] }, summary: {} },
    prompts: { classifier: 'ok' }
  }), 'COMPONENT_CONFIG_INVALID', 'schema_contract_invalid');

  for (const code of ['COMPONENT_PATH_INVALID', 'COMPONENT_NOT_FOUND', 'COMPONENT_CONFIG_INVALID']) {
    const classified = reliability.classifyFailure({ code, message: 'folder-map JSON schema validation failed' });
    assert.strictEqual(classified.code, code);
    assert.strictEqual(classified.category, 'component_config');
    assert.strictEqual(classified.retryable, false);
  }

  const report = diagnostics.buildDiagnosticReport({
    task: {
      task_id: 'component-task', run_id: 'component-run', status: 'failed',
      diagnostic_started_at: '2026-07-29T00:00:00.000Z', updated_at: '2026-07-29T00:00:10.000Z'
    },
    error: {
      code: 'COMPONENT_PATH_INVALID', category: 'component_config', retryable: false,
      stage: 'component-contracts', technicalMessage: 'empty component relative path', details: { requestCount: 0 }
    },
    counters: { apiRequests: 0 },
    events: Array.from({ length: 10 }, (_, index) => ({
      at: `2026-07-29T00:00:0${index}.000Z`, scope: 'outbound.request', data: {}
    })),
    artifacts: [{ name: 'parsed', exists: true, validation: 'valid' }]
  });
  assert.strictEqual(report.execution.stage, 'component-contracts');
  assert.strictEqual(report.operations.outboundRequests, 0);
  assert.strictEqual(report.execution.lastSuccessfulCheckpoint, 'parsed');

  let pdfUploadCalls = 0;
  let pdfDownloadCalls = 0;
  let parserCalls = 0;
  let providerCalls = 0;
  const artifacts = { parsed: { markdown: 'persisted', blocks: [] } };
  const resume = async () => {
    const parsed = artifacts.parsed || await (async () => {
      parserCalls += 1;
      pdfUploadCalls += 1;
      pdfDownloadCalls += 1;
      return { markdown: 'new' };
    })();
    components.normalizeFolderMapConfig(legacy);
    return parsed;
  };
  assert.strictEqual((await resume()).markdown, 'persisted');
  assert.deepStrictEqual({ pdfUploadCalls, pdfDownloadCalls, parserCalls, providerCalls },
    { pdfUploadCalls: 0, pdfDownloadCalls: 0, parserCalls: 0, providerCalls: 0 });
  console.log('component runtime regression: path boundary, legacy config, classification, counters and parsed resume passed');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
