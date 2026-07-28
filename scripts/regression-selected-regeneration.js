const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { loadBundleModule } = require('./load-bundle-module');

const service = loadBundleModule('src/core/selected-regeneration.js');

function fixture() {
  const point = (id) => ({ point_id: id, content: `point ${id}`, evidence_ids: [`e-${id}`] });
  const atom = (id, pointId) => ({ atom_id: id, content: { point_ids: [pointId] } });
  const item = (id, pointId) => ({
    atom_id: id,
    status: 'pending',
    atom: atom(id, pointId),
    proposed_card: { card_id: `card-${id}` }
  });
  return {
    summary: {
      document_title: 'fixture',
      key_points: [point('p1'), point('p2')],
      evidence: [{ evidence_id: 'e-p1' }, { evidence_id: 'e-p2' }]
    },
    atoms: [atom('a1', 'p1'), atom('a2', 'p2')],
    items: [item('a1', 'p1'), item('a2', 'p2')]
  };
}

async function selectedConsumerIsStatefulAndResumable() {
  const data = fixture();
  const plan = service.createSelectedRegenerationPlan({
    taskId: 'task-1',
    reviewItems: data.items,
    allAtoms: data.atoms,
    selectedAtomIds: ['a1'],
    summary: data.summary
  });
  assert.deepStrictEqual(plan.point_ids, ['p1']);
  assert.deepStrictEqual(plan.selected_summary.key_points.map((point) => point.point_id), ['p1']);

  let checkpoint = null;
  let generateCalls = 0;
  let interrupt = true;
  const existing = ['approved-card'];
  const writes = [];
  const options = {
    loadCheckpoint: async () => checkpoint,
    saveCheckpoint: async (value) => { checkpoint = value; },
    generate: async () => {
      generateCalls += 1;
      return {
        route: { output_folder: 'cards' },
        accepted: [{ card_id: 'approved-card' }, { card_id: 'new-card' }],
        review: []
      };
    },
    loadExistingCardIds: async () => existing,
    writeCard: async (card) => {
      if (interrupt) {
        interrupt = false;
        throw new Error('simulated interruption');
      }
      writes.push(card.card_id);
      existing.push(card.card_id);
    }
  };

  await assert.rejects(() => service.consumeSelectedRegeneration(options), /simulated interruption/);
  const resumed = await service.consumeSelectedRegeneration(options);
  assert.strictEqual(generateCalls, 1, 'resume must reuse the durable generation checkpoint');
  assert.deepStrictEqual(writes, ['new-card'], 'an already-approved card must never be written again');
  assert.deepStrictEqual(resumed.written, ['new-card']);

  const merged = service.mergeSelectedRegenerationResult(
    { items: data.items, handled: [] },
    plan,
    resumed.result,
    '2026-01-01T00:00:00.000Z'
  );
  assert.deepStrictEqual(merged.items.map((item) => item.atom_id), ['a2']);
  assert.strictEqual(merged.regeneration_requests[0].status, 'completed');
  assert.strictEqual(merged.handled.length, 1);
}

function attributionFailsClosed() {
  const data = fixture();
  data.atoms.push({ atom_id: 'approved-atom', content: { point_ids: ['p1'] } });
  assert.throws(() => service.createSelectedRegenerationPlan({
    taskId: 'task-1',
    reviewItems: data.items,
    allAtoms: data.atoms,
    selectedAtomIds: ['a1'],
    summary: data.summary
  }), /未选或已入库内容.*仅重做知识原子/);

  data.items[0].atom.content.point_ids = [];
  assert.throws(() => service.createSelectedRegenerationPlan({
    taskId: 'task-1',
    reviewItems: data.items,
    allAtoms: data.atoms,
    selectedAtomIds: ['a1'],
    summary: data.summary
  }), /缺少知识点归属.*仅重做知识原子/);
}

function manualStaysPendingAndRejectArchives() {
  const data = fixture();
  const manual = service.markManualPending({ items: data.items, handled: [] }, ['a1'], 'now');
  assert.strictEqual(manual.items.length, 2);
  assert.strictEqual(manual.items[0].status, 'manual_pending');
  assert.strictEqual(manual.handled.length, 0);
  assert.strictEqual(manual.manual_requests[0].status, 'pending');

  const rejected = service.archiveRejected(manual, ['a2'], 'later');
  assert.deepStrictEqual(rejected.items.map((item) => item.atom_id), ['a1']);
  assert.deepStrictEqual(rejected.rejected.map((item) => item.atom_id), ['a2']);
}

function noVisibleUnsafeApproveGroup() {
  const main = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
  const reviewUi = main.slice(main.indexOf('async renderReview(parent, tasks)'), main.indexOf('async renderReviewLegacy'));
  assert(!/approve_group/.test(reviewUi), 'review UI must not expose approve_group');
  assert(/item\.status = 'pending';[\s\S]*unresolved\.push\(item\);[\s\S]*continue;/.test(main),
    'visible group correction must return corrected items to pending review');
}

(async () => {
  await selectedConsumerIsStatefulAndResumable();
  attributionFailsClosed();
  manualStaysPendingAndRejectArchives();
  noVisibleUnsafeApproveGroup();
  console.log('selected regeneration regression tests passed');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
