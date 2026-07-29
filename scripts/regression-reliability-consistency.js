'use strict';
const assert = require('assert');
const fs = require('fs');
const crypto = require('crypto');
const path = require('path');
const { loadBundleModule } = require('./load-bundle-module');

const task = loadBundleModule('src/core/task.js', { crypto, path });
const routing = loadBundleModule('src/core/routing.js');
const migration = loadBundleModule('src/core/migration.js', { crypto });
const completion = loadBundleModule('src/core/completion-ui.js', { 'src/core/task.js': task });
const custom = task.migrateSettings({
  bidIntakePath: '客户库\\投标输入', businessIntakePath: '客户库\\业务输入',
  bidOutputPath: '成果\\投标', businessOutputPath: '成果\\业务',
  artifactsPath: '系统\\产物', draftPath: '系统\\产物\\审核',
  logPath: '系统\\产物\\日志', componentPackPath: '系统\\组件'
});
assert.strictEqual(custom.settingsVersion, 28);
assert.strictEqual(custom.bidIntakePath, '客户库/投标输入');
assert.strictEqual(custom.businessOutputPath, '成果/业务');
assert.strictEqual(custom.componentPackPath, '系统/组件');
assert.strictEqual(task.migrateSettings({ bidIntakePath: '' }).bidIntakePath, task.DEFAULT_SETTINGS.bidIntakePath);
assert.strictEqual(task.migrateSettings({ bidIntakePath: 'C:\\outside\\data' }).bidIntakePath, task.DEFAULT_SETTINGS.bidIntakePath);
assert(task.validateConfiguredPathSet(Object.assign({}, custom, { bidOutputPath: '成果', businessOutputPath: '成果/业务' }))
  .some((item) => item.reason === 'overlap'));

const folderMap = { routes: [
  { library: 'bid', folder_type: 'A', output_folder: '06-知识库/wiki/招投标/A' },
  { library: 'business', folder_type: 'B', output_folder: 'B' }
] };
assert.strictEqual(routing.cardOutputPath(custom, folderMap, { library: 'bid', folder_type: 'A' }, 'x'), '成果/投标/A/x.md');
assert.strictEqual(routing.cardOutputPath(custom, folderMap, { library: 'business', folder_type: 'B' }, 'y'), '成果/业务/B/y.md');
assert.throws(() => routing.cardOutputPath(custom, { routes: [
  { library: 'bid', folder_type: 'A', output_folder: '..' }
] }, { library: 'bid', folder_type: 'A' }, 'x'), /越界/);
assert.throws(() => routing.cardOutputPath(custom, { routes: [
  { library: 'bid', folder_type: 'A', output_folder: '06-知识库/wiki/招投标' }
] }, { library: 'bid', folder_type: 'A' }, 'x'), /根目录/);

const statuses = ['extracting', 'slicing', 'needs_ocr', 'unsupported_media', 'rolled_back'];
const migrated = statuses.map((status, index) => migration.migrateTaskLedgerV3([{
  task_id: `t${index}`, run_id: `r${index}`, source_path: `a${index}.md`,
  source_hash: 'a'.repeat(64), source_type: 'md', library: 'bid', schema_version: '1.1', status
}], { schemaVersion: '1.1' })[0]);
assert.deepStrictEqual(migrated.map((row) => row.status), statuses);
assert.strictEqual(task.statusCounts([{ status: 'extracting' }, { status: 'slicing' }]).processing, 2);
assert.deepStrictEqual(
  { written: task.statusCounts([{ status: 'rolled_back', written_card_ids: ['old'] }]).written,
    rolledBack: task.statusCounts([{ status: 'rolled_back', written_card_ids: ['old'] }]).rolledBack },
  { written: 0, rolledBack: 1 }
);
assert.strictEqual(completion.shouldAcceptIncrementalProgress({ task_id: 'x', status: 'slicing' }, new Set()), true);
assert.strictEqual(completion.shouldAcceptIncrementalProgress({ task_id: 'x', status: 'rolled_back' }, new Set()), false);

const source = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
const shadowBody = source.slice(source.indexOf('async evaluateShadowTask'), source.indexOf('async shadowReport'));
assert(shadowBody.includes('persistShadowArtifact'));
assert(!shadowBody.includes('persistArtifact(shadowTask'));
const rollbackBody = source.slice(source.indexOf('async rollbackLastBatch'), source.indexOf('assertTaskCanContinue'));
assert(rollbackBody.includes('previous_content'));
assert(rollbackBody.includes('rebuildKnowledgeIndexes'));
assert(!rollbackBody.includes('deleteFolderContents'));
assert(source.includes("reason: 'legacy_unverifiable'"));
assert(source.includes('componentContractHash'));
console.log('reliability consistency regression: passed');
