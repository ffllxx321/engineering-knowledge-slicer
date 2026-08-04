// @ts-nocheck -- Runtime contracts are exhaustively exercised by test:v3.
'use strict';

const crypto = require('crypto');

const STATES = Object.freeze(['queued', 'reading', 'parsing', 'validating', 'staging', 'verifying', 'committed', 'failed']);
const TRANSITIONS = Object.freeze({
  queued: ['reading', 'failed'], reading: ['parsing', 'failed'], parsing: ['validating', 'failed'],
  validating: ['staging', 'failed'], staging: ['verifying', 'failed'], verifying: ['committed', 'failed'],
  committed: [], failed: []
});
const ATTEMPT_STATUSES = Object.freeze(['attempted', 'skipped', 'succeeded', 'failed']);
const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');

function transition(manifest, next, detail = {}) {
  if (!STATES.includes(next) || !TRANSITIONS[manifest.state]?.includes(next)) {
    throw new Error(`V3_INVALID_STATE_TRANSITION:${manifest.state}->${next}`);
  }
  manifest.state = next;
  manifest.transitions.push({ state: next, at: new Date().toISOString(), ...detail });
  return manifest;
}

function attempt(adapter, status, reason, durationMs = 0) {
  if (!ATTEMPT_STATUSES.includes(status)) throw new Error(`V3_INVALID_ATTEMPT_STATUS:${status}`);
  return { adapter, status, reason: String(reason || ''), duration_ms: Math.max(0, Number(durationMs) || 0) };
}

function detectLanguages(text) {
  const value = String(text || '');
  const result = [];
  if (/[぀-ヿ]/u.test(value)) result.push('ja');
  if (/[㐀-鿿]/u.test(value)) result.push('zh');
  if (/[A-Za-z]{3}/.test(value)) result.push('en');
  return result.length ? [...new Set(result)] : ['und'];
}

function buildParseResult(source, text, provenance, quality, warnings = [], locators = []) {
  const normalized = String(text || '').replace(/\r\n?/g, '\n').trim();
  const paragraphs = normalized.split(/\n{2,}/).map((part) => part.trim()).filter(Boolean);
  return {
    schema: 'eks/v3/parse-result/1',
    source: { path: source.path, name: source.name, extension: source.extension, byte_size: source.bytes.length,
      sha256: sha256(source.bytes) },
    languages: detectLanguages(normalized),
    chinese_normalized: { status: 'not_requested', text: null, capability: 'placeholder' },
    blocks: paragraphs.map((content, index) => ({ id: `b-${sha256(`${source.path}\0${index}\0${content}`).slice(0, 20)}`,
      type: 'paragraph', content, locator: locators[index] || { kind: 'paragraph', index: index + 1 } })),
    parser_provenance: provenance,
    quality,
    warnings: warnings.map(String),
    markdown: normalized
  };
}

function validateParseResult(result) {
  if (!result || result.schema !== 'eks/v3/parse-result/1' || !result.source?.sha256) throw new Error('V3_INVALID_PARSE_CONTRACT');
  if (!String(result.markdown || '').trim() || !Array.isArray(result.blocks) || !result.blocks.length) throw new Error('V3_EMPTY_PARSE_RESULT');
  const ids = result.blocks.map((block) => block.id);
  if (new Set(ids).size !== ids.length || result.blocks.some((block) => !block.locator || !String(block.content).trim())) {
    throw new Error('V3_INVALID_BLOCKS');
  }
  return result;
}

module.exports = { ATTEMPT_STATUSES, STATES, TRANSITIONS, attempt, buildParseResult, detectLanguages, sha256, transition, validateParseResult };
