const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { loadBundleModule } = require('./load-bundle-module.js');

const ux = loadBundleModule('src/core/production-ux.js');
const review = loadBundleModule('src/core/review-service.js');
const source = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
const css = fs.readFileSync(path.join(__dirname, '..', 'styles.css'), 'utf8');

function item(index, failure = false) {
  return {
    atom_id: `A${index}`, status: 'pending',
    reasons: failure ? ['evidence locator missing'] : ['可信度略低，需确认'],
    validationReport: { hardGateFailures: failure ? ['EVIDENCE_NOT_FOUND'] : [] },
    atom: { title: `条目 ${index}` }, proposed_card: { card_id: `C${index}` }
  };
}

for (const [reason, kind] of [
  ['evidence locator missing', '证据位置缺失'], ['schema invalid', '内容格式不完整'],
  ['threshold quantity anomaly', '数量需要确认'], ['provider response HTTP 503', '外部服务返回异常'],
  ['upload consent required', '尚未确认上传']
]) assert.strictEqual(ux.explainIssue({ reasons: [reason] }).kind, kind);
assert.strictEqual(ux.explainIssue({ reasons: ['never-seen-cause'] }).kind, '需要人工确认');
const diagnostic = { reasons: ['schema invalid'], code: 'SCHEMA_42', atom: { id: 'raw-id' } };
assert.strictEqual(ux.explainIssue(diagnostic).technical, diagnostic);

const items = Array.from({ length: 40 }, (_, index) => item(index + 1, index >= 38));
const selection = review.reviewSelection(items, items.map((entry) => entry.atom_id));
assert.deepStrictEqual(
  { total: selection.total, eligible: selection.eligible, selectedEligible: selection.selectedEligible, selectedIneligible: selection.selectedIneligible },
  { total: 40, eligible: 38, selectedEligible: 38, selectedIneligible: 2 }
);
assert(selection.eligibleIds.every((id) => !['A39', 'A40'].includes(id)));
assert.strictEqual(review.isApprovalEligible(items[38]), false);

const renderContent = source.slice(source.indexOf('async renderContent(container)'), source.indexOf('async renderContentLegacy(container)'));
assert.strictEqual((renderContent.match(/createEl\('progress'/g) || []).length, 1);
assert(source.includes("text: '技术详情'") && source.includes('JSON.stringify({'));
assert(source.includes('pageSize = 20') && source.includes("role: 'listitem'"));
assert(css.includes('.eks-review-exception-item') && css.includes('gap: 12px') && css.includes(':focus-within'));

assert.strictEqual(ux.pipelineProgress({ status: 'summarizing', progress: { completedWork: 40 } }, { stage: 'parsing' }).completedWork, 40);
assert(ux.pipelineProgress({ status: 'writing' }, { stage: 'writing', batchIndex: 99, batchTotal: 99 }).completedWork < 100);
assert.strictEqual(ux.pipelineProgress({ status: 'written' }, { stage: 'complete' }).completedWork, 100);
const queueTask = { task_id: 'T11', queue_order: 11, queue_total: 20 };
assert.deepStrictEqual(ux.queuePosition(queueTask), { ordinal: 11, total: 20, label: '处理队列 11/20' });
assert.strictEqual(ux.queuePosition(queueTask, Array.from({ length: 9 })).total, 20);

console.log('production UX regressions passed');
