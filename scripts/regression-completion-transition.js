const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { loadBundleModule } = require('./load-bundle-module');

const {
  completionUiSnapshot,
  pendingReviewCount,
  shouldAcceptIncrementalProgress
} = loadBundleModule('src/core/completion-ui.js');

function task(overrides = {}) {
  return Object.assign({
    task_id: 'task-1',
    queue_run_id: 'run-1',
    queue_order: 1,
    queue_total: 1,
    status: 'writing',
    progress: { stage: 'writing', completedWork: 99 },
    review_atom_ids: []
  }, overrides);
}

// Exact production timeline: workflow returned 1 accepted + 11 review items, then
// the durable ledger must drive a 100% Review view without a later "查看任务" click.
const reviewComplete = task({
  status: 'needs_review',
  progress: { stage: 'complete', completedWork: 100 },
  review_atom_ids: Array.from({ length: 11 }, (_, index) => `atom-${index + 1}`)
});
let snapshot = completionUiSnapshot([reviewComplete], reviewComplete.task_id);
assert.strictEqual(snapshot.reviewCount, 11);
assert.strictEqual(snapshot.overallPercent, 100);
assert.strictEqual(snapshot.activeCount, 0);
assert.strictEqual(pendingReviewCount([reviewComplete]), 11);

// Terminal state always wins over a late heartbeat/progress callback.
assert.strictEqual(shouldAcceptIncrementalProgress(reviewComplete, new Set()), false);
assert.strictEqual(shouldAcceptIncrementalProgress(
  task(),
  new Set(['task-1'])
), false);
assert.strictEqual(shouldAcceptIncrementalProgress(task(), new Set()), true);

// No-review completion is the ordinary completed state.
snapshot = completionUiSnapshot([
  task({ status: 'written', progress: { stage: 'complete', completedWork: 100 } })
], 'task-1');
assert.strictEqual(snapshot.reviewCount, 0);
assert.strictEqual(snapshot.overallPercent, 100);
assert.strictEqual(snapshot.activeTask, null);

// A second queued file keeps the overall run at 50%, while accumulated review
// remains surfaced and actionable.
snapshot = completionUiSnapshot([
  task({
    status: 'needs_review',
    queue_total: 2,
    progress: { stage: 'complete', completedWork: 100 },
    review_atom_ids: ['a', 'b']
  }),
  task({
    task_id: 'task-2',
    queue_order: 2,
    queue_total: 2,
    status: 'queued'
  })
], 'task-1');
assert.strictEqual(snapshot.overallPercent, 50);
assert.strictEqual(snapshot.queuedCount, 1);
assert.strictEqual(snapshot.reviewCount, 2);

// Once file two starts, overall progress remains run-level and review work stays visible.
snapshot = completionUiSnapshot([
  task({
    status: 'needs_review',
    queue_total: 2,
    progress: { stage: 'complete', completedWork: 100 },
    review_atom_ids: ['a', 'b']
  }),
  task({
    task_id: 'task-2',
    queue_order: 2,
    queue_total: 2,
    status: 'atomizing',
    progress: { stage: 'atomizing', completedWork: 60 }
  })
], 'task-1');
assert.strictEqual(snapshot.overallPercent, 80);
assert.strictEqual(snapshot.activeCount, 1);
assert.strictEqual(snapshot.reviewCount, 2);

// Structural regression for the durability boundary and dashboard-only navigation.
const main = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
const terminalBlock = main.slice(
  main.indexOf("current.status = workflow.review.length ? 'needs_review' : 'written';"),
  main.indexOf("diag('performance.task'", main.indexOf("current.status = workflow.review.length ? 'needs_review' : 'written';"))
);
const saveAt = terminalBlock.indexOf('await this.saveTasks');
const flushAt = terminalBlock.indexOf('await this.flushSaveTasksImmediate()');
const transitionAt = terminalBlock.indexOf('await this.transitionCompletionUi');
assert(saveAt >= 0 && flushAt > saveAt && transitionAt > flushAt,
  'completion refresh must occur only after the terminal ledger save is durably flushed');
assert(main.includes("if (snapshot.reviewCount > 0) view.activeSection = 'review';"),
  'review completion auto-selects Review inside each existing plugin dashboard');
assert(main.includes("if (!this._hasRendered && reviewCount > 0) this.activeSection = 'review';"),
  'a dashboard opened after completion also starts in Review');
const transitionBody = main.slice(
  main.indexOf('async transitionCompletionUi(taskId)'),
  main.indexOf('async processTaskLegacy')
);
assert(!transitionBody.includes('revealLeaf') && !transitionBody.includes('activateView'),
  'completion transition must not steal focus from another Obsidian pane');
assert(main.includes("diag('completion.ui.transition'"),
  'completion transition emits non-sensitive task/run/count/outcome diagnostics');

console.log('completion transition regressions passed');
