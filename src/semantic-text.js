'use strict';

const crypto = require('crypto');

// Exact, deliberately conservative semantic normalization. NFKC removes width
// and compatibility formatting differences; only presentation punctuation is
// discarded. Numbers, letters, units, negation, operators and technical symbols
// remain part of the signature.
const LIST_PREFIX = /^(?:\s*(?:[-*•●▪■□☐✓✔]+|[（(]?\d+[)）.、]|[（(]?[一二三四五六七八九十百]+[)）、.])\s*)+/u;
const PRESENTATION_PUNCTUATION = /[\s,，.。;；!?！？、'"“”‘’`´…]/gu;
const MARKDOWN_BOUNDARY_PREFIX = /^(?:\s*(?:#{1,6}(?=\s)\s*|>(?=\s)\s*|[-+*](?=\s)\s*|[•●▪■□☐✓✔]\s*|\[[ xX]\](?=\s)\s*|[（(]?\d+[)）.、](?=\s)\s*|[（(]?[一二三四五六七八九十百]+[)）、.](?=\s)\s*))+/u;
const PRESENTATION_WRAPPERS = [
  [/^\*\*(.+)\*\*$/u, '$1'], [/^__(.+)__$/u, '$1'], [/^~~(.+)~~$/u, '$1'],
  [/^`+(.+?)`+$/u, '$1'], [/^"(.+)"$/u, '$1'], [/^'(.+)'$/u, '$1'],
  [/^“(.+)”$/u, '$1'], [/^‘(.+)’$/u, '$1'], [/^《(.+)》$/u, '$1'],
  [/^【(.+)】$/u, '$1'], [/^\[(.+)\]$/u, '$1'], [/^（(.+)）$/u, '$1'], [/^\((.+)\)$/u, '$1']
];

function cleanTitleBoundary(value, max = 160) {
  let output = String(value ?? '').normalize('NFKC')
    .replace(/[\u0000-\u001f\u007f\u200b-\u200f\u202a-\u202e\u2060\ufeff]/g, '')
    .replace(/\r?\n+/g, ' ').trim();
  // A heading may itself contain a list/task prefix, so peel layers until the
  // boundary is ordinary prose. Internal punctuation and engineering symbols
  // are deliberately retained.
  let previous;
  do {
    previous = output;
    output = output.replace(MARKDOWN_BOUNDARY_PREFIX, '').trim();
    for (const [wrapper, replacement] of PRESENTATION_WRAPPERS) output = output.replace(wrapper, replacement).trim();
  }
  while (output && output !== previous);
  return output.slice(0, max).trim();
}

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

function distinctSemanticTexts(values, against = []) {
  const blocked = new Set((against || []).map(normalizeSemanticText).filter(Boolean));
  const output = [];
  for (const value of values || []) {
    const normalized = normalizeSemanticText(value);
    if (!normalized || blocked.has(normalized)) continue;
    blocked.add(normalized);
    output.push(value);
  }
  return output;
}

function semanticContains(container, value) {
  const outer = normalizeSemanticText(container); const inner = normalizeSemanticText(value);
  return Boolean(outer && inner && outer.includes(inner));
}

module.exports = { normalizeSemanticText, semanticTextSignature, dedupeSemanticTexts, distinctSemanticTexts, semanticContains, cleanTitleBoundary };
