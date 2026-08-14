'use strict';
const assert = require('assert');
const fs = require('fs');
const { translateRegions } = require('../src/universal-knowledge-pipeline.js');
const english = (id, length) => ({ region_id: id, semantic_kind: 'fact', text: `${id.toLowerCase()} technical specification detail `.repeat(length).slice(0, length), source_language: { language: 'en', script_evidence: { han: 0, hiragana: 0, katakana: 0, latin: length } } });
const translated = (request) => ({ translations: request.map((row) => ({ region_id: row.region_id, translated_text: `工程要求${(row.preserve_exactly || []).join(' ')}${'内容'.repeat(Math.max(2, Math.ceil(row.text.length / 3)))}` })) });

async function noEagerSplitAndTruncationRecovery() {
  const regions = [english('a', 1000), english('b', 1000), english('c', 1000), english('d', 14915)];
  const requests = []; let truncated = false;
  const result = await translateRegions(regions, { translate_batch: async (request) => {
    requests.push(request.map((row) => ({ id: row.region_id, length: row.text.length })));
    if (!truncated && request.length > 1) { truncated = true; throw Object.assign(new Error('provider output limit'), { code: 'AI_OUTPUT_TRUNCATED' }); }
    return translated(request);
  } });
  assert.strictEqual(regions.reduce((sum, row) => sum + row.text.length, 0), 17915);
  assert.strictEqual(requests[0].length, 4, 'normal batching must not eagerly split around 3600 characters');
  assert(requests[0].some((row) => row.id === 'd' && row.length === 14915), 'large region must remain intact before real truncation');
  assert(truncated && result.telemetry.provider_calls === 3, 'real truncation should trigger one bounded batch bisection');
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

async function semanticRetryRecoversWithoutChangingRegionIds() {
  const regions = [english('semantic-a', 800), english('semantic-b', 800)];
  const calls = [];
  const result = await translateRegions(regions, { translate_batch: async (request, contract) => {
    calls.push({ ids: request.map((row) => row.region_id), contract });
    if (calls.length === 1) return { translations: request.map((row) => ({
      region_id: row.region_id, translated_text: 'English response only'
    })) };
    return translated(request);
  } });
  assert.strictEqual(calls.length, 2);
  assert.deepStrictEqual(calls[1].ids, calls[0].ids, 'semantic retry must preserve the original batch region IDs');
  assert.strictEqual(calls[0].contract.retry_attempt, undefined);
  assert.strictEqual(calls[1].contract.retry_attempt, 1);
  assert.match(calls[1].contract.retry_instruction, /简体中文/);
  assert.strictEqual(result.telemetry.semantic_retries, 1);
  assert.strictEqual(result.telemetry.semantic_retry_failures, 0);
}

async function semanticRetryExhaustionKeepsRetryableCheckpoint() {
  const regions = [english('completed', 800), english('failed', 800)];
  let calls = 0;
  let error;
  try {
    await translateRegions(regions, {
      translation_batch_size: 1,
      translate_batch: async (request) => {
        calls += 1;
        if (request[0].region_id === 'completed') return translated(request);
        return { translations: [{ region_id: request[0].region_id, translated_text: 'Still English only' }] };
      }
    });
  } catch (caught) { error = caught; }
  assert(error, 'persistent semantic validation failures must reject');
  assert.strictEqual(calls, 4, 'failed batch gets one initial request and two additional attempts');
  assert.strictEqual(error.retryable, true);
  assert.deepStrictEqual(error.checkpoint.missing_region_ids, ['failed']);
  assert.strictEqual(error.checkpoint.telemetry.semantic_retries, 2);
  assert.strictEqual(error.checkpoint.telemetry.semantic_retry_failures, 1);
  assert.strictEqual(Object.keys(error.checkpoint.cache).length, 1);
}

function stateAndDependencyGuards() {
  const main = fs.readFileSync(require.resolve('../main.js'), 'utf8');
  assert(main.includes('task.run_id !== runId || plugin.activeTaskRuns?.get(task.task_id)?.runId !== runId'));
  assert(main.includes("task.progress = null;\n    task.lease = null;"));
  assert(main.includes("item.validation = 'invalid-dependency:parsed';"));
  assert(main.includes("loadedTranslationCheckpoint?.schema_version === 'translation-checkpoint/2.0'"));
  assert(main.includes('save_translation_checkpoint: (checkpoint) => this.persistArtifact'));
}

(async () => { await noEagerSplitAndTruncationRecovery(); await partialCheckpointResume();
  await semanticRetryRecoversWithoutChangingRegionIds(); await semanticRetryExhaustionKeepsRetryableCheckpoint();
  stateAndDependencyGuards(); console.log('universal translation resume regressions passed'); })()
  .catch((error) => { console.error(error); process.exitCode = 1; });
