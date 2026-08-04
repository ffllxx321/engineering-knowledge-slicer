const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { loadBundleModule } = require('./load-bundle-module.js');

const source = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
const displayStart = source.indexOf('  display() {', source.indexOf('class SlicerSettingTab'));
const displayEnd = source.indexOf('  renderAdvancedSettings(containerEl) {', displayStart);
assert(displayStart >= 0 && displayEnd > displayStart, 'production settings renderer must be identifiable');
const display = source.slice(displayStart, displayEnd);
const advancedStart = displayEnd;
const advancedEnd = source.indexOf('\n  }\n}\n\nfunction normalizeLegacyArtifact', advancedStart);
assert(advancedEnd > advancedStart, 'complete advanced renderer must be identifiable');
const advanced = source.slice(advancedStart, advancedEnd);

for (const allowed of [
  'MiniMax 密钥', 'MinerU 密钥', '阿里云百炼密钥',
  "text.inputEl.type = 'password'", "setButtonText('保存')",
  "setButtonText('测试')", "setButtonText('清除')"
]) assert(source.includes(allowed), `missing credential behavior: ${allowed}`);

for (const advancedLabel of [
  '模型', '接口地址', '端点', '维数', '最大候选数', 'Top K', '并发', '超时',
  '重试', '限流', 'Schema', '提示词', 'provider', '影子评估', '抽取顺序',
  '流式输出', '诊断日志'
]) {
  assert(!display.slice(0, display.indexOf(".setName('高级设置')")).includes(advancedLabel),
    `advanced setting leaked before gate: ${advancedLabel}`);
}

assert(!display.includes('PaddleOCR 密钥'), 'legacy PaddleOCR credential must not be rendered');
assert(display.includes("setName('解析方式')") && display.includes('自动选择（只读）'), 'single automatic parser explanation must be rendered');
assert(display.includes("setName('允许必要的云端识别')"), 'single privacy control must be rendered');
assert(display.includes('semanticConsent === true') && display.includes('semanticEnabled === true'),
  'optional Qwen credential must only appear when the existing feature is enabled');
assert(source.includes("inputEl.autocomplete = 'new-password'"), 'credential inputs must disable secret autofill exposure');
assert(display.includes(".setName('高级设置')"), 'plain advanced toggle must be present');
assert(display.includes('.setValue(this.plugin.settings.advancedSettingsEnabled === true)'),
  'toggle rendering must use strict persisted true');
assert(display.includes('this.plugin.settings.advancedSettingsEnabled = value === true'),
  'toggle callback must normalize the persisted value');
assert(display.includes('await this.plugin.saveSafeSettings();') && display.includes('this.display();'),
  'toggle must persist safely and rerender immediately');
assert(display.includes('if (this.plugin.settings.advancedSettingsEnabled === true)'),
  'advanced renderer must only be reachable through the gate');
assert.strictEqual((display.match(/this\.renderAdvancedSettings\(containerEl\)/g) || []).length, 1,
  'advanced renderer must have exactly one production call site');
assert(advanced.indexOf('return;') > 0 && advanced.slice(0, advanced.indexOf('return;')).includes("setName('自动解析')"),
  'advanced renderer must stop after the read-only automatic parser contract');
for (const key of ['minimaxApiKey', 'pdfMineruApiKey', 'pdfPaddleOcrApiKey', 'embeddingApiKey']) {
  assert(!advanced.includes(`'${key}'`), `advanced renderer duplicated credential input: ${key}`);
}
assert(!advanced.includes('passwordSetting('), 'advanced renderer must not use the legacy credential editor');
assert(!advanced.includes('connectionTestSetting('),
  'advanced renderer must not duplicate tests already provided by the canonical editor');

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
assert.strictEqual(migrated.advancedSettingsEnabled, false,
  'users without an explicit saved true must default to minimal settings');
assert.strictEqual(task.migrateSettings({ advancedSettingsEnabled: true }).advancedSettingsEnabled, true,
  'an explicit saved true must survive restart');
for (const dirty of [false, 'true', 1, null]) {
  assert.strictEqual(task.migrateSettings({ advancedSettingsEnabled: dirty }).advancedSettingsEnabled, false,
    `non-boolean advanced value must not reveal controls: ${String(dirty)}`);
}
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

const hidden = task.migrateSettings({
  advancedSettingsEnabled: true,
  aiChunkSize: 12345,
  semanticMaxCandidates: 321
});
hidden.advancedSettingsEnabled = false;
const hiddenAfterClose = task.migrateSettings(hidden);
assert.strictEqual(hiddenAfterClose.aiChunkSize, 12345);
assert.strictEqual(hiddenAfterClose.semanticMaxCandidates, 321);
assert.strictEqual(hiddenAfterClose.advancedSettingsEnabled, false,
  'closing advanced settings must preserve hidden values while hiding controls');

const commandIds = [...source.matchAll(/this\.addCommand\(\{ id: '([^']+)'/g)].map((match) => match[1]);
assert.strictEqual(new Set(commandIds).size, commandIds.length, 'settings change must not introduce duplicate commands');
assert.strictEqual(commandIds.filter((id) => id === 'open-ai-settings').length, 1,
  'there must be one canonical settings command');

assert(source.includes("ALIYUN_BAILIAN_MODEL = 'qwen3.7-text-embedding'"));
assert(source.includes("ALIYUN_BAILIAN_ENDPOINT = 'https://dashscope.aliyuncs.com/api/v1/services/embeddings/text-embedding/text-embedding'"));
assert(source.includes('this.fetch(ALIYUN_BAILIAN_ENDPOINT'));
assert(source.includes('model: ALIYUN_BAILIAN_MODEL'));

console.log('minimal settings UI regressions passed');
