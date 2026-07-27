const assert = require('assert');
const { loadBundleModule } = require('./load-bundle-module');

const time = loadBundleModule('src/core/time-policy.js');
const identity = loadBundleModule('src/core/identity.js', { crypto: require('crypto') });
const schemaValidator = loadBundleModule('src/core/schema-validator.js');
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
assert.strictEqual(time.formatBusinessDate(undefined, { timeZone: 'Asia/Shanghai' }), '');

const deterministicCard = renderer.buildCardRecord({
  atom: {
    title: 'Clock regression',
    card_kind: 'static',
    library: 'bid',
    folder_type: '01-test',
    source: {},
    content: {}
  },
  library: 'bid',
  sourceHash: 'a'.repeat(64),
  route: { output_folder: 'test' },
  confidence: { score: 1, components: {} },
  versions: { schemaVersion: '1.1', pipelineVersion: '1.1.1', promptBundleVersion: '1.1' },
  businessTimeZone: 'Asia/Shanghai',
  clock: () => new Date(boundaryInstant)
});
assert.strictEqual(deterministicCard.created, '2026-07-16', 'omitted now uses the injected current instant');
assert.strictEqual(deterministicCard.updated, '2026-07-16', 'omitted now never produces a blank update date');

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

const cardSchema = require('../组件包/schemas/card.schema.json');
for (const value of [
  '2026-07-15',
  '2026-07-15T05:05:46Z',
  '2026-07-15T05:05:46.715Z',
  '2026-07-15T13:05:46+08:00'
]) {
  assert(schemaValidator.validateSchema(cardSchema.properties.created, value).valid, `valid card date: ${value}`);
}
for (const value of [
  '2026-07-15Tanything',
  '2026-07-15garbage',
  '2026-07-15T05:05:46.715Zsuffix',
  '2026-07-15T05:05:46'
]) {
  assert(!schemaValidator.validateSchema(cardSchema.properties.created, value).valid, `invalid card date suffix: ${value}`);
}

const staticTemplate = require('fs').readFileSync(require('path').join(__dirname, '../组件包/模板/静态信息卡片.md'), 'utf8');
const eventTemplate = require('fs').readFileSync(require('path').join(__dirname, '../组件包/模板/动态事件卡片.md'), 'utf8');
assert(staticTemplate.includes('{{created}}') && staticTemplate.includes('{{updated}}'));
assert(eventTemplate.includes('{{created}}') && eventTemplate.includes('{{updated}}') && eventTemplate.includes('{{event_date}}'));
assert(!`${staticTemplate}\n${eventTemplate}`.includes('_yyyy_mm_dd'), 'templates retain supported placeholders');

const bundleSource = require('fs').readFileSync(require('path').join(__dirname, '../main.js'), 'utf8');
assert(
  /return \{\n    schemaVersion: 1,\n    generatedAt: new Date\(\)\.toISOString\(\),/.test(bundleSource),
  'generatedAt remains aligned with the returned index object'
);

console.log('timestamp policy smoke tests passed');
