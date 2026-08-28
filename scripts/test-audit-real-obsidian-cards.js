#!/usr/bin/env node
'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { auditVault } = require('./audit-real-obsidian-cards.js');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'eks-card-audit-'));
const cards = path.join(root, '06-知识库/业务库');
function markdown(title, overrides = {}) {
  const values = { title, search_title: `${title} search`, aliases: '[]', source_document_ids: '["src-1"]', ...overrides };
  const lines = ['---', 'record_kind: "business_item"'];
  for (const [key, value] of Object.entries(values)) {
    if (value !== null) lines.push(`${key}: ${key === 'title' || key === 'search_title' ? JSON.stringify(value) : value}`);
  }
  return `${lines.join('\n')}\n---\n\n# ${overrides.h1 ?? title}\n`;
}
function run(files) {
  fs.rmSync(cards, { recursive: true, force: true });
  fs.mkdirSync(cards, { recursive: true });
  for (const [name, content] of Object.entries(files)) fs.writeFileSync(path.join(cards, `${name}.md`), content);
  return auditVault(root);
}
function expectOnly(kind, filename, content) {
  const report = run({ [filename]: content });
  assert.deepStrictEqual([...new Set(report.failures.map((failure) => failure.kind))], [kind], `${kind}: ${JSON.stringify(report.failures)}`);
}

assert(run({ Valid: markdown('Valid') }).passed);
assert(run({ 'C-': markdown('C#'), '-20°C': markdown('-20°C'), '≤0.5 mm': markdown('≤0.5 mm') }).passed,
  'path contract must use filename sanitization without changing canonical titles');
expectOnly('missing_or_invalid_title', '未命名', markdown('Missing', { title: null, h1: '' }));
expectOnly('missing_or_invalid_search_title', 'Missing search', markdown('Missing search', { search_title: null }));
expectOnly('invalid_aliases', 'Bad aliases', markdown('Bad aliases', { aliases: 'not-an-array' }));
expectOnly('invalid_source_document_ids', 'Bad sources', markdown('Bad sources', { source_document_ids: '[""]' }));
expectOnly('h1_mismatch', 'Expected', markdown('Expected', { h1: 'Expected.' }));
expectOnly('missing_h1', 'No heading', markdown('No heading').replace('# No heading\n', ''));
expectOnly('missing_h1', 'Fence only', markdown('Fence only').replace('# Fence only\n', '```text\n# Fence only\n```\n'));
expectOnly('h1_mismatch', 'Byte exact', markdown('Byte exact', { h1: 'Byte exact ' }));
expectOnly('multiple_h1', 'Duplicate heading', `${markdown('Duplicate heading')}\n# Duplicate heading\n`);
expectOnly('multiple_h1', 'Conflicting heading', `${markdown('Conflicting heading')}\n# Other heading\n`);
expectOnly('h1_not_at_body_start', 'Late heading', markdown('Late heading').replace('\n# Late heading\n', '\nintro\n\n# Late heading\n'));
assert(run({ 'Evidence heading': `${markdown('Evidence heading')}\n## 来源证据\n\n~~~markdown\n# Fake evidence H1\n~~~\n` }).passed,
  'headings inside source evidence fences must not be classified as document H1s');
expectOnly('path_title_mismatch', 'Path', markdown('Different'));
for (const [marked, filename] of [['- Marked', '- Marked'], ['> Quoted', '- Quoted'],
  ['（二） Listed', '（二） Listed'], ['[x] Task', '-x- Task']]) {
  assert.deepStrictEqual([...new Set(run({ [filename]: markdown(marked) }).failures.map((failure) => failure.kind))],
    ['title_boundary', 'marker_prefix']);
}
expectOnly('mechanical_alias', 'Alias duplicate', markdown('Alias duplicate', { aliases: '["Alias duplicate"]' }));

let collapse = run({ Same: markdown('Same', { search_title: 'first intent' }), 'Same（2）': markdown('Same', { search_title: 'second intent' }) });
assert.deepStrictEqual([...new Set(collapse.failures.map((failure) => failure.kind))], ['semantic_title_collapse']);
collapse = run({ Same: markdown('Same', { search_title: 'first intent', source_document_ids: 'broken' }),
  'Same（2）': markdown('Same', { search_title: 'second intent', source_document_ids: 'also-broken' }) });
assert(collapse.failures.some((failure) => failure.kind === 'semantic_title_collapse'),
  `malformed sources hid sibling collapse: ${JSON.stringify(collapse.failures)}`);

console.log('real Obsidian card audit self-test: PASS');
