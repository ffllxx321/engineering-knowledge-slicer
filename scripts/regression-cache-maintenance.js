'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const source = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');

function extractBlock(startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);
  assert(start >= 0 && end > start, `missing production block: ${startMarker}`);
  return source.slice(start, end);
}

function extractMethod(signature) {
  const start = source.indexOf(signature);
  assert(start >= 0, `missing method: ${signature}`);
  const brace = source.indexOf('{', start);
  let depth = 0;
  for (let index = brace; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1;
    if (source[index] === '}') depth -= 1;
    if (depth === 0) return source.slice(start, index + 1);
  }
  throw new Error(`unterminated method: ${signature}`);
}

const ordinarySettings = extractBlock('  display() {', '  renderAdvancedSettings(containerEl) {');
assert(ordinarySettings.includes("setName('\u6e05\u7a7a\u7f13\u5b58')"), '普通设置页必须显示“清空缓存”');
assert(ordinarySettings.indexOf("setName('\u6e05\u7a7a\u7f13\u5b58')") < ordinarySettings.indexOf("setName('\u9ad8\u7ea7设置')"),
  '缓存维护不得被高级设置开关隐藏');
assert(ordinarySettings.includes('任务队列、处理日志、待审核草稿与解析/OCR/AI 中间产物'), '设置页必须说明清理范围');
assert(ordinarySettings.includes('不会删除源文档或已入库知识 Markdown'), '设置页必须说明安全边界');
assert(source.includes("id: 'clear-plugin-cache', name: '清空工程知识切片缓存'"), '命令面板必须提供明确的中文命令');
assert(!source.includes("name: '[开发] 清空"), '缓存维护不得成为开发者影子控件');

const notices = [];
const confirmMethod = extractMethod('async confirmAndClearPluginCache(confirmAction = null)');
class TestNotice {
  constructor(message) { notices.push(message); }
}
const Harness = new Function('Notice', `return class Harness { ${confirmMethod} }`)(TestNotice);

(async () => {
  let cleanupCalls = 0;
  let refreshCalls = 0;
  const harness = new Harness();
  harness.clearPluginCache = async () => { cleanupCalls += 1; return { deletedFiles: 3, deletedFolders: 2 }; };
  harness.refreshViews = async () => { refreshCalls += 1; };
  const cancelled = await harness.confirmAndClearPluginCache(() => false);
  assert.deepStrictEqual(cancelled, { ok: false, cancelled: true, deletedFiles: 0, deletedFolders: 0 });
  assert.strictEqual(cleanupCalls, 0, '取消确认后不得清理');
  const confirmed = await harness.confirmAndClearPluginCache((message) => {
    assert(message.includes('不会删除源文档或已入库知识 Markdown'));
    return true;
  });
  assert.deepStrictEqual(confirmed, { ok: true, cancelled: false, deletedFiles: 3, deletedFolders: 2 });
  assert.strictEqual(cleanupCalls, 1, '确认后应调用现有清理 API 一次');

  harness.clearPluginCache = async () => { throw new Error('模拟删除失败'); };
  const failed = await harness.confirmAndClearPluginCache(() => true);
  assert.strictEqual(failed.ok, false);
  assert.strictEqual(failed.cancelled, false);
  assert.strictEqual(refreshCalls, 1, '失败后也应刷新 UI');
  assert(notices.some((message) => message.includes('未报告清理成功')), '失败时不得伪报成功');
  assert(!notices.some((message) => message.includes('缓存清理完成')), '失败路径不得显示成功通知');

  class TFolder {
    constructor(name, children = []) { this.name = name; this.children = children; }
  }
  const helperSource = extractBlock('async function deleteFolderContents', '\nfunction upsertTask');
  const helpers = new Function('TFolder', 'normalizeVaultPath', `${helperSource}; return { deleteFolderContents };`)(TFolder, (value) => value);
  const cacheRoot = new TFolder('cache', [
    { name: 'tasks.json' },
    new TFolder('run-1', [{ name: 'parsed.json' }, new TFolder('logs', [{ name: 'task.json' }])])
  ]);
  const sourceDocument = { name: '源文档.pdf' };
  const knowledgeMarkdown = { name: '已入库知识.md' };
  const deleted = [];
  const app = { vault: {
    getAbstractFileByPath: (target) => target === 'cache' ? cacheRoot : null,
    delete: async (target) => {
      deleted.push(target);
      cacheRoot.children = cacheRoot.children.filter((child) => child !== target);
    }
  } };
  const first = await helpers.deleteFolderContents(app, 'cache');
  assert.deepStrictEqual(first, { deletedFiles: 3, deletedFolders: 2 });
  assert.deepStrictEqual(deleted.map((item) => item.name), ['tasks.json', 'run-1'], '只能把缓存根的子项交给现有 scoped delete API');
  assert(!deleted.includes(sourceDocument) && !deleted.includes(knowledgeMarkdown), '不得删除源文档或知识 Markdown');
  const repeated = await helpers.deleteFolderContents(app, 'cache');
  assert.deepStrictEqual(repeated, { deletedFiles: 0, deletedFolders: 0 }, '重复清理必须幂等并如实报告 0');

  console.log('cache maintenance regressions passed');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
