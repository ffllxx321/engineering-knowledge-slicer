'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { loadBundleModule } = require('./load-bundle-module.js');

const confidence = loadBundleModule('src/core/confidence.js');
const review = loadBundleModule('src/core/review-service.js');
const workflow = loadBundleModule('src/core/workflow.js', {
  'src/core/ai-pipeline.js': {},
  'src/core/document-parser.js': {},
  'src/core/confidence.js': confidence,
  'src/core/identity.js': {},
  'src/core/markdown-renderer.js': {},
  'src/core/routing.js': {},
  'src/core/link-service.js': {},
  'src/core/reliability.js': {},
  'src/core/provenance.js': {}
});

function difference(claim, evidence) {
  return confidence.evidenceConsistency(claim, evidence);
}

for (const [claim, evidence] of [
  ['计划于2023年5月完成。', '计划于2023年5月完成。'],
  ['计划于２０２３年５月完成。', '计划于2023-05完成。'],
  ['净距为10 mm。', '净距为１０mm。'],
  ['若下雨，施工必须暂停。', '若下雨，施工必须暂停。']
]) {
  assert.strictEqual(difference(claim, evidence).ok, true, `${claim} should match ${evidence}`);
}
assert.strictEqual(difference('净距为12 mm。', '净距为10 mm。').status, 'conflict');
assert.strictEqual(difference('计划于2024年6月完成。', '计划按期完成。').status, 'unsupported_addition');
assert.strictEqual(difference('净距为10 mm。', '净距为10。').status, 'missing_in_evidence');
assert.strictEqual(difference('净距为10 mm。', '净距为10 cm。').status, 'ambiguous_conversion');
assert(difference('施工必须暂停。', '施工暂停。').plainReasons.includes('生成内容把原文加强为强制要求'));
assert(difference('施工必须暂停。', '若下雨，施工必须暂停。').plainReasons.includes('生成内容删除了原文的条件或例外'));

const atom = {
  title: '工期',
  content: '计划于2023年5月完成。',
  source: {
    provenance_verified: true,
    evidence_quote: '计划完成。',
    block_id: 'block-a',
    source_provenance: { block_id: 'block-a' }
  }
};
const parsed = {
  evidence_index: {
    'block-a': { block_id: 'block-a', card_eligible: true, raw_text: '计划完成。本项目计划于2023年5月完成。' },
    'block-b': { block_id: 'block-b', card_eligible: true, raw_text: '另一个项目计划于2024年完成。' }
  }
};
const expansion = workflow.expandEvidenceWithinVerifiedBlock(parsed, atom);
assert.strictEqual(expansion.expanded, true);
assert.strictEqual(atom.source.evidence_scope.block_id, 'block-a');
assert.strictEqual(atom.source.evidence_scope.crossed_blocks, false);
assert(!atom.source.bound_evidence_text.includes('2024'));

function reviewItem(id, eligible, differenceStatus = 'matched') {
  return {
    atom_id: id,
    status: 'pending',
    atom: { source: { provenance_verified: true } },
    validationReport: {
      evidenceFound: true,
      materialDifferenceStatus: differenceStatus,
      hardGateFailures: eligible ? [] : ['FACT_CONFLICT'],
      nonOverridableFailures: eligible ? [] : ['FACT_CONFLICT']
    }
  };
}
const approval = review.safeApprovalPlan([
  reviewItem('safe-1', true),
  reviewItem('safe-2', true, 'not_applicable'),
  reviewItem('blocked', false, 'conflict')
]);
assert.deepStrictEqual(approval.eligibleIds, ['safe-1', 'safe-2']);
assert.deepStrictEqual(approval.blockedIds, ['blocked'], 'safe approve-all must preserve blockers');
assert.strictEqual(approval.blocked, 1);
assert.strictEqual(review.nextReviewIndex(2, 2), 1);
assert.strictEqual(review.nextReviewIndex(1, 1), 0);
assert.strictEqual(review.nextReviewIndex(0, 0), -1);

const main = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
const modal = main.slice(main.indexOf('class ReviewExceptionModal'), main.indexOf('class UploadConfirmModal'));
assert(modal.includes('第 ${this.index + 1} / ${this.items.length} 项'));
assert(modal.includes('批准此项') && modal.includes('批准全部可安全批准项'));
assert(modal.includes('重新生成') && modal.includes('更多操作') && modal.includes('关闭'));
assert(!modal.includes("type: 'checkbox'"));
assert(!modal.includes('全选可批准项'));
assert(!modal.includes('已选择'));
assert(!modal.includes('每页最多'));
assert(!modal.includes('pageSize'));
assert(!modal.includes('asserted'));
assert(modal.includes("event.key === 'ArrowLeft'") && modal.includes("event.key.toLowerCase() === 'a'"));

console.log('review policy and one-item UI regressions passed');
