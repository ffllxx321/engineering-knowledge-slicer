'use strict';
const assert = require('assert');
const fs = require('fs');
const { translateRegions } = require('../src/universal-knowledge-pipeline.js');
const english = (id, length) => ({ region_id: id, semantic_kind: 'fact', text: `${id.toLowerCase()} technical specification detail `.repeat(length).slice(0, length), source_language: { language: 'en', script_evidence: { han: 0, hiragana: 0, katakana: 0, latin: length } } });
const translated = (request) => ({ translations: request.map((row) => ({ region_id: row.region_id, translated_text: `工程要求${(row.preserve_exactly || []).join(' ')}${'内容'.repeat(Math.max(2, Math.ceil(row.text.length / 3)))}` })) });

async function truncationIsBoundedAndSplit() {
  const regions = [english('a', 1000), english('b', 1000), english('c', 1000), english('d', 14915)];
  const sizes = []; let truncated = false;
  const result = await translateRegions(regions, { translation_batch_char_budget: 3600, translate_batch: async (request) => {
    sizes.push(request.reduce((sum, row) => sum + row.text.length, 0));
    if (!truncated && request.length > 1) { truncated = true; throw Object.assign(new Error('provider output limit'), { code: 'AI_OUTPUT_TRUNCATED' }); }
    return translated(request);
  } });
  assert.strictEqual(regions.reduce((sum, row) => sum + row.text.length, 0), 17915);
  assert(sizes.every((size) => size <= 3600), `oversized request: ${Math.max(...sizes)}`);
  assert(truncated && result.telemetry.provider_calls > 5);
  assert(result.regions.every((row) => row.translated_text && row.translation.provenance === 'configured-provider'));
}

async function partialCheckpointResume() {
  let checkpoint; let calls = 0;
  await assert.rejects(() => translateRegions([english('resume-a', 2500), english('resume-b', 2500)], {
    translation_batch_char_budget: 3000,
    save_translation_checkpoint: async (value) => { checkpoint = JSON.parse(JSON.stringify(value)); },
    translate_batch: async (request) => { calls += 1; if (calls === 2) throw Object.assign(new Error('stop'), { code: 'TEST_STOP' }); return translated(request); }
  }), /翻译批次失败/);
  assert(checkpoint && Object.keys(checkpoint.cache).length === 1);
  const requests = []; const resumed = [english('resume-a', 2500), english('resume-b', 2500)];
  await translateRegions(resumed, { translation_batch_char_budget: 3000, translation_cache: checkpoint.cache,
    translate_batch: async (request) => { requests.push(...request); return translated(request); } });
  assert(requests.every((row) => row.region_id.startsWith('resume-b')));
  assert.strictEqual(resumed[0].translation.provenance, 'cache');
}

function stateAndDependencyGuards() {
  const main = fs.readFileSync(require.resolve('../main.js'), 'utf8');
  assert(main.includes('task.run_id !== runId || plugin.activeTaskRuns?.get(task.task_id)?.runId !== runId'));
  assert(main.includes("task.progress = null;\n    task.lease = null;"));
  assert(main.includes("item.validation = 'invalid-dependency:parsed';"));
  assert(main.includes("loadedTranslationCheckpoint?.schema_version === 'translation-checkpoint/2.0'"));
  assert(main.includes('save_translation_checkpoint: (checkpoint) => this.persistArtifact'));
}

(async () => { await truncationIsBoundedAndSplit(); await partialCheckpointResume(); stateAndDependencyGuards(); console.log('universal translation resume regressions passed'); })()
  .catch((error) => { console.error(error); process.exitCode = 1; });
