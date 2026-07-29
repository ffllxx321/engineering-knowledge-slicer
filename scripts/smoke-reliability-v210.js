const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { loadBundleModule } = require('./load-bundle-module.js');

const api = loadBundleModule('src/core/reliability.js');
let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
  console.log(`  ok - ${name}`);
}

console.log('v2.10 可靠性、安全与检查点回归:');

test('设置持久化不包含任何运行时密钥', () => {
  const value = api.sanitizeSettingsForPersistence({
    theme: 'native',
    minimaxApiKey: 'secret-value',
    pdfMineruApiKey: 'secret-value',
    pdfPaddleOcrApiKey: 'secret-value',
    token: 'secret-value'
  });
  assert.deepStrictEqual(value, { theme: 'native' });
});

test('Header、JWT、Bearer 与 URL query 深度脱敏', () => {
  const value = api.sanitizeForLog({
    headers: { Authorization: 'Bearer abc.def.ghi', Cookie: 'session=private' },
    url: 'https://example.test/path?api_key=private&safe=1',
    nested: ['eyJabcdefghijk.abcdefghijk.signature']
  });
  const encoded = JSON.stringify(value);
  assert(!encoded.includes('private'));
  assert(!encoded.includes('abc.def.ghi'));
  assert(!encoded.includes('signature'));
  assert(encoded.includes('safe=1'));
});

test('错误分类区分可重试限流与不可重试鉴权', () => {
  assert.strictEqual(api.classifyFailure({ status: 429 }).retryable, true);
  assert.strictEqual(api.classifyFailure({ status: 401 }).retryable, false);
  assert.strictEqual(api.classifyFailure({ message: 'schema invalid' }).retryable, false);
});

test('退避计算可注入随机源且有上限', () => {
  assert.strictEqual(api.computeBackoffMs(1, { baseMs: 100, jitterRatio: 0 }), 100);
  assert.strictEqual(api.computeBackoffMs(9, { baseMs: 100, maxMs: 500, jitterRatio: 0 }), 500);
});

test('AppError 输出稳定三层信息且默认不保存堆栈', () => {
  const error = api.toAppError(Object.assign(new Error('HTTP 429 secret'), { status: 429 }), {
    taskId: 'task-1', runId: 'run-1', stage: 'atomizing'
  }).toJSON();
  assert.strictEqual(error.code, 'RATE_LIMIT_PROVIDER_BUSY');
  assert.strictEqual(error.stage, 'atomizing');
  assert(error.message && error.suggestedAction && error.technicalMessage);
  assert.strictEqual(error.diagnosticStack, undefined);
});

test('ValidationReport 可复用并稳定给出硬门槛', () => {
  const report = api.buildValidationReport({
    schemaValid: true, routeValid: false, tagsValid: true, evidenceFound: false
  });
  assert.deepStrictEqual(report.hardGateFailures, ['ROUTING', 'EVIDENCE']);
  assert.strictEqual(report.finalDecision, 'review');
});

test('阶段指标不含正文且仅保留 source hash 前缀', () => {
  const metric = api.createStageMetric({
    taskId: 'task-1', sourceHash: '1234567890abcdef', stage: 'summary',
    stageStartedAt: 10, stageCompletedAt: 30, inputCharacters: 300
  });
  assert.strictEqual(metric.stageDurationMs, 20);
  assert.strictEqual(metric.estimatedInputTokens, 100);
  assert.strictEqual(metric.sourceFingerprint, '1234567890ab');
  assert(!Object.hasOwn(metric, 'content'));
});

test('新检查点带指纹且旧检查点保持可读', () => {
  const main = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
  assert(main.includes('artifactVersion: 3'));
  assert(main.includes('[2, 3].includes(parsed.artifactVersion)'));
  assert(main.includes("fingerprintVersion: 'parsed-input-v1'"));
  assert(main.includes("reason: 'fingerprint_changed'"));
});

test('生产路径全部通过安全 settings 持久化入口', () => {
  const main = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
  const unsafe = [...main.matchAll(/saveData\(([^)]*)\)/g)]
    .map((match) => match[1])
    .filter((argument) => !argument.includes('sanitizeSettingsForPersistence'));
  assert.deepStrictEqual(unsafe, []);
});

console.log(`${passed} passed, 0 failed`);
