'use strict';
const assert = require('assert');
const { detectLanguage, canonicalizeDocument, segmentDocument, runUniversalPipelineMultilingual,
  validateTranslationResult } = require('../src/universal-knowledge-pipeline.js');
const { buildPlan, emptyIndex } = require('../src/structured-writer.js');
const block = (text, order = 0) => ({ block_id: `b${order}`, kind: 'paragraph', raw: { text },
  parse: { status: 'present' }, locator: { scheme: 'fixture', value: `b${order}` } });
const base = { source_identity: 'multi-source', source_document_id: 'multi-doc',
  source_path: '输入.txt', source_hash: 'hash', title: '多语言资料', metadata: {} };
const render = (text) => /risk|リスク/i.test(text) ? '风险：暴雨可能导致工期延误 7 天。'
  : '供应商必须在 2026-08-01 前提交材料型号 MX-200，除非项目经理书面批准延期。';
const run = (blocks, extra = {}) => runUniversalPipelineMultilingual({
  document: { ...base, blocks }, model_version: 'fixture-model', translation_prompt_version: 'fixture-v1',
  translate_batch: async (regions) => ({ translations: regions.map((region) =>
    ({ region_id: region.region_id, translated_text: render(region.text) })) }), ...extra
});
async function main() {
  assert.deepStrictEqual(['必须提交。', '提出しなければならない。', 'Supplier must submit.',
    '要求: Supplier must submit.', '123 --'].map((text) => detectLanguage(text).language),
  ['zh', 'ja', 'en', 'mixed', 'unknown']);
  const regions = segmentDocument(canonicalizeDocument({ ...base, blocks: [
    block('必须检查钢筋。'), block('The board approved the proposal.', 1), block('リスクを確認すること。', 2)
  ] }));
  assert.deepStrictEqual(new Set(regions.map((x) => x.source_language.language)), new Set(['zh', 'en', 'ja']));
  let calls = 0;
  const zh = await runUniversalPipelineMultilingual({ document: { ...base, blocks: [block('承包人必须检查型号 MX-200。')] },
    translate_batch: async () => { calls += 1; return { translations: [] }; } });
  assert.strictEqual(calls, 0); assert.strictEqual(zh.telemetry.translation.provider_calls, 0);
  const variants = await Promise.all([
    run([block('供应商必须在 2026-08-01 前提交材料型号 MX-200，除非批准延期。')]),
    run([block('サプライヤーは 2026-08-01 までに材料型式 MX-200 を提出しなければならない。ただし延期承認時を除く。')]),
    run([block('Supplier must submit material model MX-200 by 2026-08-01, unless an extension is approved.')])
  ]);
  variants.forEach(({ knowledge_units: [unit] }) => {
    assert.strictEqual(unit.semantic_kind, 'requirement');
    assert(unit.statement.includes('必须') && unit.statement.includes('除非'));
    assert(unit.statement.includes('MX-200') && unit.statement.includes('2026-08-01'));
    assert.strictEqual(unit.output_language, 'zh-CN');
  });
  assert.strictEqual(new Set(variants.map((x) => x.knowledge_units[0].route.category)).size, 1);
  const first = await run([block('Risk: heavy rain may delay completion by 7 days.')]);
  const cached = await run([block('Risk: heavy rain may delay completion by 7 days.')], {
    translation_cache: first.translation_cache, translate_batch: async () => { throw new Error('cache miss'); }
  });
  assert.strictEqual(cached.telemetry.translation.cache_hits, 1);
  const strictRegions = segmentDocument(canonicalizeDocument({ ...base, blocks: [
    block('Risk: delay by 7 days.'), block('Supplier must submit MX-200.', 1)
  ] }));
  assert.throws(() => validateTranslationResult(strictRegions, { translations: [
    { region_id: strictRegions[0].region_id, translated_text: '风险：延误 7 天。' }
  ] }), /区域 ID/);
  let checkpoint;
  try {
    await run([block('Risk: delay by 7 days.'), block('Supplier must submit MX-200.', 1)], {
      translation_batch_size: 1, translate_batch: async (batch) => {
        if (/Supplier/.test(batch[0].text)) throw new Error('temporary');
        return { translations: [{ region_id: batch[0].region_id, translated_text: render(batch[0].text) }] };
      }
    });
  } catch (error) { checkpoint = error.checkpoint; }
  assert(checkpoint && Object.keys(checkpoint.cache).length === 1 && checkpoint.missing_region_ids.length === 1);
  const resumed = await run([block('Risk: delay by 7 days.'), block('Supplier must submit MX-200.', 1)],
    { translation_batch_size: 1, translation_cache: checkpoint.cache });
  assert.strictEqual(resumed.telemetry.translation.cache_hits, 1);
  const result = variants[2]; const fingerprint = result.knowledge_units[0].fingerprint;
  result.knowledge_units[0].statement = '供应商须提交 MX-200。';
  assert.strictEqual(result.knowledge_units[0].fingerprint, fingerprint);
  const plan = buildPlan({ settings: { controlledWriterEnabled: true, structuredWriterMode: 'structured-write',
    structuredActiveRoot: '在办投标库', structuredBusinessRoot: '长期业务库', artifactsPath: '状态',
    structuredMaxRecords: 100, structuredMaxActions: 300 }, document: result.document,
    universalResult: result, projectRegistry: [], index: emptyIndex(), existingFiles: {},
    logicalTime: '2026-07-31T00:00:00.000Z' });
  const item = plan.actions.find((x) => ['business_item', 'company_knowledge'].includes(x.record_kind));
  assert(item.content.includes('## 来源证据（原文）') && item.content.includes('### 证据中文译文'));
  assert(item.content.includes('Supplier must submit') && !item.content.includes('"translations"'));
  console.log('multilingual zh output: ok');
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
