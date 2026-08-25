'use strict';

const crypto = require('crypto');

// Exact, deliberately conservative semantic normalization. NFKC removes width
// and compatibility formatting differences; only presentation punctuation is
// discarded. Numbers, letters, units, negation, operators and technical symbols
// remain part of the signature.
const LIST_PREFIX = /^(?:\s*(?:[-*•●▪■□☐✓✔]+|[（(]?\d+[)）.、]|[（(]?[一二三四五六七八九十百]+[)）、.])\s*)+/u;
const PRESENTATION_PUNCTUATION = /[\s,，.。;；!?！？、'"“”‘’`´…]/gu;

function normalizeSemanticText(value) {
  return String(value ?? '')
    .normalize('NFKC')
    .replace(/[\u0000-\u001f\u007f\u200b-\u200f\u202a-\u202e\u2060\ufeff]/g, '')
    .split(/\r?\n/)
    .map((line) => line.replace(LIST_PREFIX, '').trim())
    .filter(Boolean)
    .join(' ')
    .toLocaleLowerCase()
    .replace(PRESENTATION_PUNCTUATION, '');
}

function semanticTextSignature(value) {
  return crypto.createHash('sha256').update(normalizeSemanticText(value)).digest('hex');
}

function dedupeSemanticTexts(values) {
  const seen = new Set();
  const output = [];
  for (const value of values || []) {
    const signature = semanticTextSignature(value);
    if (!normalizeSemanticText(value) || seen.has(signature)) continue;
    seen.add(signature);
    output.push(value);
  }
  return output;
}

module.exports = { normalizeSemanticText, semanticTextSignature, dedupeSemanticTexts };
