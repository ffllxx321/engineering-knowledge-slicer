const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { loadBundleModule } = require('./load-bundle-module.js');

const source = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
const displayStart = source.indexOf('  display() {', source.indexOf('class SlicerSettingTab'));
const displayEnd = source.indexOf('  displayAdvancedLegacy() {', displayStart);
assert(displayStart >= 0 && displayEnd > displayStart, 'production settings renderer must be identifiable');
const display = source.slice(displayStart, displayEnd);

for (const allowed of [
  'MiniMax 密钥', 'MinerU 密钥', 'PaddleOCR 密钥', '阿里云百炼密钥',
  "text.inputEl.type = 'password'", "setButtonText('保存')",
  "setButtonText('测试')", "setButtonText('清除')"
]) assert(source.includes(allowed), `missing credential behavior: ${allowed}`);

for (const forbidden of [
  '模型', '接口地址', '端点', '维数', '最大候选数', 'Top K', '并发', '超时',
  '重试', '限流', 'Schema', '提示词', 'provider', '影子评估', '抽取顺序',
  '流式输出', '诊断日志'
]) assert(!display.includes(forbidden), `advanced setting leaked into production renderer: ${forbidden}`);

assert(display.includes('pdfAllowExternalUpload === true'), 'cloud OCR credentials must be conditional');
assert(display.includes('semanticConsent === true') && display.includes('semanticEnabled === true'),
  'optional Qwen credential must only appear when the existing feature is enabled');
assert(source.includes("inputEl.autocomplete = 'new-password'"), 'credential inputs must disable secret autofill exposure');
assert(!display.includes('.setValue(this.plugin.settings.'), 'production renderer must delegate masked values to credential helper');

const task = loadBundleModule('src/core/task.js', { crypto: require('crypto'), path: require('path') });
const legacy = {
  settingsVersion: 28,
  customLegacySwitch: 'keep-me',
  aiChunkSize: 12000,
  pdfExternalTimeoutMs: 240000,
  embeddingEndpoint: 'https://legacy.example.invalid/embedding',
  embeddingModel: 'legacy-hidden-model'
};
const migrated = task.migrateSettings(legacy);
for (const key of ['customLegacySwitch', 'aiChunkSize', 'pdfExternalTimeoutMs']) {
  assert.strictEqual(migrated[key], legacy[key], `hidden setting changed: ${key}`);
}
assert.strictEqual(migrated.embeddingEndpoint, task.DEFAULT_SETTINGS.embeddingEndpoint);
assert.strictEqual(migrated.embeddingModel, task.DEFAULT_SETTINGS.embeddingModel);
assert.strictEqual(migrated.hiddenLegacyEmbedding.embeddingEndpoint, legacy.embeddingEndpoint);
assert.strictEqual(migrated.hiddenLegacyEmbedding.embeddingModel, legacy.embeddingModel);
const remigrated = task.migrateSettings(migrated);
assert.deepStrictEqual(remigrated.hiddenLegacyEmbedding, migrated.hiddenLegacyEmbedding,
  'archived Qwen routing values must survive repeated migration');

const errors = require('./load-bundle-module.js').loadBundleModule('src/core/reliability.js');
const secret = ['sk', 'minimal-settings-secret-1234567890'].join('-');
const persisted = errors.sanitizeSettingsForPersistence({
  minimaxApiKey: secret,
  pdfMineruApiKey: secret,
  pdfPaddleOcrApiKey: secret,
  embeddingApiKey: secret,
  customLegacySwitch: 'keep-me',
  aiChunkSize: 12000
});
assert(!JSON.stringify(persisted).includes(secret), 'settings persistence leaked a secret');
assert.deepStrictEqual(
  { customLegacySwitch: persisted.customLegacySwitch, aiChunkSize: persisted.aiChunkSize },
  { customLegacySwitch: 'keep-me', aiChunkSize: 12000 },
  'hidden settings must survive secret-safe persistence'
);
assert(!JSON.stringify(errors.sanitizeForLog({ apiKey: secret, nested: { token: secret } })).includes(secret),
  'diagnostics leaked a secret');

assert(source.includes("ALIYUN_BAILIAN_MODEL = 'qwen3.7-text-embedding'"));
assert(source.includes("ALIYUN_BAILIAN_ENDPOINT = 'https://dashscope.aliyuncs.com/api/v1/services/embeddings/text-embedding/text-embedding'"));
assert(source.includes('this.fetch(ALIYUN_BAILIAN_ENDPOINT'));
assert(source.includes('model: ALIYUN_BAILIAN_MODEL'));

console.log('minimal settings UI regressions passed');
