'use strict';
const assert = require('assert');
const { loadBundleModule } = require('./load-bundle-module.js');
const { loadAiPipeline } = require('./load-ai-pipeline.js');

const { api: ai, diagCalls } = loadAiPipeline();
const task = loadBundleModule('src/core/task.js', { crypto: require('crypto'), path: require('path') });
const jsonResponse = (payload, status = 200) => ({
  ok: status >= 200 && status < 300, status, headers: { get: () => null },
  json: async () => payload, text: async () => typeof payload === 'string' ? payload : JSON.stringify(payload)
});
const anthropicSuccess = jsonResponse({ stop_reason: 'tool_use', content: [{ type: 'tool_use', name: 'return_structured_result', input: { ok: true } }] });
const openAiSuccess = jsonResponse({ choices: [{ finish_reason: 'stop', message: { tool_calls: [{ function: { name: 'return_structured_result', arguments: '{"ok":true}' } }] } }] });

async function requestConstruction() {
  for (const [endpoint, field, absent, response] of [
    ['https://api.minimaxi.com/anthropic/v1/messages', 'max_tokens', 'max_completion_tokens', anthropicSuccess],
    ['https://example.test/v1/chat/completions', 'max_completion_tokens', 'max_tokens', openAiSuccess]
  ]) {
    let sent;
    await ai.requestMiniMaxJson({ settings: { minimaxApiKey: 'test', minimaxEndpoint: endpoint, minimaxOutputTokenLimit: 16384, aiRequestMaxAttempts: 1 },
      prompt: 'x', context: { schema: { type: 'object' } }, fetchImpl: async (_url, init) => { sent = JSON.parse(init.body); return response; } });
    assert.strictEqual(sent[field], 16384);
    assert(!Object.hasOwn(sent, absent), `${absent} must not be sent to ${endpoint}`);
  }
}

async function exactFallback() {
  const settings = { minimaxApiKey: 'test', minimaxEndpoint: 'https://api.minimaxi.com/anthropic/v1/messages', minimaxOutputTokenLimit: 16384, aiRequestMaxAttempts: 1 };
  const limits = [];
  const result = await ai.requestMiniMaxJson({ settings, prompt: 'x', context: {}, fetchImpl: async (_url, init) => {
    limits.push(JSON.parse(init.body).max_tokens);
    return limits.length === 1 ? jsonResponse({ error: { message: 'max_tokens must be at most 8192' } }, 400) : anthropicSuccess;
  } });
  assert.deepStrictEqual(limits, [16384, 8192]);
  assert.deepStrictEqual(result, { ok: true });
  assert.strictEqual(settings.minimaxOutputTokenLimitFallback, 8192, 'fallback must be retained for persistence');
  assert(diagCalls.some((entry) => entry.scope === 'minimax.outputTokenLimitFallback'
    && entry.payload.requestedTokenLimit === 16384 && entry.payload.fallbackTokenLimit === 8192));

  for (const detail of ['authentication failed', 'max_tokens must be at most 8192']) {
    let calls = 0;
    const limit = detail.startsWith('max_') ? 12000 : 16384;
    await assert.rejects(() => ai.requestMiniMaxJson({ settings: { minimaxApiKey: 'test', minimaxEndpoint: settings.minimaxEndpoint,
      minimaxOutputTokenLimit: limit, aiRequestMaxAttempts: 1 }, prompt: 'x', fetchImpl: async () => { calls += 1; return jsonResponse(detail, 400); } }), /HTTP 400/);
    assert.strictEqual(calls, 1, 'unrelated errors and non-16384 values must not fallback');
  }
}

async function dynamicTruncation() {
  await assert.rejects(() => ai.requestMiniMaxJson({ settings: { minimaxApiKey: 'test', minimaxEndpoint: 'https://api.minimaxi.com/anthropic/v1/messages',
    minimaxOutputTokenLimit: 12345, aiRequestMaxAttempts: 1 }, prompt: 'x', fetchImpl: async () => jsonResponse({ stop_reason: 'max_tokens', content: [] }) }),
  (error) => error.code === 'AI_OUTPUT_TRUNCATED' && /12345/.test(error.message) && /max_tokens/.test(error.message)
    && error.details.requestedTokenLimit === 12345 && error.details.providerStopReason === 'max_tokens');
}

function settingsValidation() {
  assert.strictEqual(task.DEFAULT_SETTINGS.minimaxOutputTokenLimit, 16384);
  assert.strictEqual(task.migrateSettings({ minimaxOutputTokenLimit: 32768 }).minimaxOutputTokenLimit, 32768);
  for (const invalid of [0, -1, 1.5, 65537, 'junk']) assert.strictEqual(task.migrateSettings({ minimaxOutputTokenLimit: invalid }).minimaxOutputTokenLimit, 16384);
}

(async () => { settingsValidation(); await requestConstruction(); await exactFallback(); await dynamicTruncation(); console.log('MiniMax output limit regressions passed'); })()
  .catch((error) => { console.error(error); process.exitCode = 1; });
