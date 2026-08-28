#!/usr/bin/env node
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { normalizeSemanticText, cleanTitleBoundary } = require('../src/semantic-text.js');

const MALFORMED_SOURCE = '__malformed_source_document_ids__';

function frontmatter(content) {
  return String(content).match(/^---\s*\r?\n([\s\S]*?)\r?\n---(?:\s*\r?\n|$)/)?.[1] || '';
}
function field(content, key) {
  const match = frontmatter(content).match(new RegExp(`^${key}:\\s*(.*)$`, 'm'));
  if (!match) return { present: false, valid: false, value: undefined };
  const raw = match[1].trim();
  try { return { present: true, valid: true, value: JSON.parse(raw) }; }
  catch (_) { return { present: true, valid: Boolean(raw), value: raw.replace(/^['"]|['"]$/g, '') }; }
}
function arrayField(content, key) {
  const parsed = field(content, key);
  const valid = parsed.present && parsed.valid && Array.isArray(parsed.value)
    && parsed.value.every((value) => typeof value === 'string' && value.trim().length > 0);
  return { ...parsed, valid, value: valid ? parsed.value.map((value) => value.trim()) : [] };
}
function safeTitleFilename(value) {
  return String(value || '').trim().replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 120).normalize('NFC')
    .replace(/[\\/:*?"<>|#[\]^]/g, '-').replace(/\.\./g, '-').replace(/\s+/g, ' ').replace(/^[. ]+|[. ]+$/g, '') || '未命名';
}
function walk(root) {
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(root, entry.name);
    return entry.isDirectory() ? walk(target) : entry.isFile() && entry.name.endsWith('.md') ? [target] : [];
  });
}
function auditVault(vault) {
  const roots = ['06-知识库/业务库', '06-知识库/招投标库'].map((item) => path.join(vault, item));
  const records = walk(vault).filter((file) => roots.some((root) => file.startsWith(`${root}${path.sep}`)))
    .map((file) => ({ file, content: fs.readFileSync(file, 'utf8') }))
    .filter(({ content }) => /^(?:record_kind):\s*["']?(?:business_item|company_knowledge)["']?\s*$/m.test(frontmatter(content)))
    .map((record) => {
      const title = field(record.content, 'title'); const search = field(record.content, 'search_title');
      return { ...record, titleField: title, searchField: search, title: typeof title.value === 'string' ? title.value.trim() : '',
        search: typeof search.value === 'string' ? search.value.trim() : '', aliasesField: arrayField(record.content, 'aliases'),
        sourcesField: arrayField(record.content, 'source_document_ids'), h1: record.content.match(/^#\s+(.+)$/m)?.[1]?.trim() || '' };
    });
  const failures = [];
  for (const record of records) {
    const basename = path.basename(record.file, '.md');
    const expectedBasename = safeTitleFilename(record.title);
    if (!record.titleField.present || !record.titleField.valid || !record.title) failures.push({ kind: 'missing_or_invalid_title', file: record.file });
    if (!record.searchField.present || !record.searchField.valid || !record.search) failures.push({ kind: 'missing_or_invalid_search_title', file: record.file });
    if (!record.aliasesField.valid) failures.push({ kind: 'invalid_aliases', file: record.file });
    if (!record.sourcesField.valid || record.sourcesField.value.length === 0) failures.push({ kind: 'invalid_source_document_ids', file: record.file });
    if (record.title && record.title !== cleanTitleBoundary(record.title)) failures.push({ kind: 'title_boundary', file: record.file, title: record.title });
    if (record.h1 !== record.title) failures.push({ kind: 'h1_mismatch', file: record.file, title: record.title, h1: record.h1 });
    if (basename !== expectedBasename && !new RegExp(`^${expectedBasename.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}（[2-9]\\d*）$`).test(basename)) {
      failures.push({ kind: 'path_title_mismatch', file: record.file, title: record.title, basename });
    }
    if (/^(?:#{1,6}(?=\s)|>(?=\s)|[-+*](?=\s)|[•●▪■□☐✓✔](?=\s)|\[[ xX]\](?=\s)|[（(]?\d+[)）.、](?=\s)|[（(]?[一二三四五六七八九十百]+[)）、.](?=\s))/.test(record.title || basename)) failures.push({ kind: 'marker_prefix', file: record.file });
    const blocked = new Set([record.title, record.search].map(normalizeSemanticText).filter(Boolean));
    if (record.aliasesField.value.some((alias) => blocked.has(normalizeSemanticText(alias)))) failures.push({ kind: 'mechanical_alias', file: record.file });
  }
  const groups = new Map();
  for (const record of records) for (const source of record.sourcesField.valid && record.sourcesField.value.length
    ? record.sourcesField.value : [MALFORMED_SOURCE]) {
    const key = `${source}|${normalizeSemanticText(record.title)}`;
    if (!groups.has(key)) groups.set(key, []); groups.get(key).push(record);
  }
  for (const [key, siblings] of groups) if (siblings.length > 1
    && new Set(siblings.map((record) => normalizeSemanticText(record.search))).size > 1) {
    failures.push({ kind: 'semantic_title_collapse', key, files: siblings.map((record) => record.file) });
  }
  return { passed: failures.length === 0, cards: records.length, failures };
}
if (require.main === module) {
  const vault = path.resolve(process.argv[2] || '');
  assert(vault && fs.existsSync(vault) && fs.statSync(vault).isDirectory(), 'usage: audit-real-obsidian-cards.js VAULT');
  const report = auditVault(vault);
  assert(report.passed, JSON.stringify(report.failures, null, 2));
  console.log(`real Obsidian card audit: PASS (${report.cards} cards)`);
}
module.exports = { auditVault };
