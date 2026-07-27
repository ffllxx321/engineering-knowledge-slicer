const assert = require('assert');
const { loadBundleModule } = require('./load-bundle-module');

const time = loadBundleModule('src/core/time-policy.js');
const identity = loadBundleModule('src/core/identity.js', { crypto: require('crypto') });
const renderer = loadBundleModule('src/core/markdown-renderer.js', {
  'src/core/identity.js': identity,
  'src/core/time-policy.js': time
});

const boundaryInstant = '2026-07-15T16:30:46.715Z';
assert.strictEqual(
  time.formatBusinessDate(boundaryInstant, { timeZone: 'Asia/Shanghai' }),
  '2026-07-16',
  'business date must be derived after timezone conversion'
);
assert.strictEqual(
  time.formatBusinessDate(boundaryInstant, { timeZone: 'UTC' }),
  '2026-07-15',
  'timezone selection must be deterministic'
);
assert.strictEqual(time.formatBusinessDate('2026-07-15', { timeZone: 'Asia/Shanghai' }), '2026-07-15');
assert.strictEqual(time.formatBusinessDate('not-a-date', { timeZone: 'Asia/Shanghai' }), '');

const operational = time.formatOperationalLocalDateTime(
  '2026-07-15T17:05:46.715Z',
  { timeZone: 'Asia/Shanghai', locale: 'zh-CN' }
);
assert(/2026/.test(operational) && /07/.test(operational) && /16/.test(operational));
assert(/01/.test(operational) && /05/.test(operational) && /46/.test(operational));

assert.strictEqual(
  time.preciseIsoInstant('2026-07-15T05:05:46.715Z'),
  '2026-07-15T05:05:46.715Z',
  'diagnostic/log instants retain millisecond precision'
);

const legacyMarkdown = renderer.renderKnowledgeCard({
  title: 'Legacy',
  card_id: 'card-legacy',
  card_kind: 'static',
  created: boundaryInstant,
  updated: '2026-07-15T05:05:46.715Z',
  related: [],
  aliases: [],
  tags: [],
  content: {}
}, { timeZone: 'Asia/Shanghai' });
assert(legacyMarkdown.includes('created: "2026-07-16"'));
assert(legacyMarkdown.includes('updated: "2026-07-15"'));
assert(!legacyMarkdown.includes('.715Z'));

console.log('timestamp policy smoke tests passed');
