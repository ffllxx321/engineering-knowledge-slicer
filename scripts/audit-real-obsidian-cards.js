#!/usr/bin/env node
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { normalizeSemanticText, cleanTitleBoundary } = require('../src/semantic-text.js');

function scalar(content, key) {
  const raw = String(content).match(new RegExp(`^${key}:\\s*(.+)$`, 'm'))?.[1]?.trim() || '';
  try { return JSON.parse(raw); } catch (_) { return raw.replace(/^['"]|['"]$/g, ''); }
}
function array(content, key) {
  const raw = String(content).match(new RegExp(`^${key}:\\s*(\\[[^\\n]*\\])`, 'm'))?.[1] || '[]';
  try { return JSON.parse(raw); } catch (_) { return []; }
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
    .filter(({ content }) => /^(?:record_kind):\s*["']?(?:business_item|company_knowledge)["']?\s*$/m.test(content))
    .map((record) => { const h1 = record.content.match(/^#\s+(.+)$/m)?.[1]?.trim() || ''; return ({ ...record,
      title: scalar(record.content, 'title') || h1, title_field: scalar(record.content, 'title'), search: scalar(record.content, 'search_title'),
      aliases: array(record.content, 'aliases'), sources: array(record.content, 'source_document_ids'),
      h1 }); });
  const failures = [];
  for (const record of records) {
    const basename = path.basename(record.file, '.md').replace(/（\d+）$/, '');
    if (!record.title || record.title !== cleanTitleBoundary(record.title)) failures.push({ kind: 'title_boundary', file: record.file, title: record.title });
    if (normalizeSemanticText(record.h1) !== normalizeSemanticText(record.title)) failures.push({ kind: 'h1_mismatch', file: record.file, title: record.title, h1: record.h1 });
    if (normalizeSemanticText(basename) !== normalizeSemanticText(record.title)) failures.push({ kind: 'path_title_mismatch', file: record.file, title: record.title });
    if (/^(?:#|[-+*•●▪■□☐✓✔]|\[[ xX]\]|\d+[.)、]|[（(]\d+[)）])/.test(record.title || basename)) failures.push({ kind: 'marker_prefix', file: record.file });
    const blocked = new Set([record.title, record.search].map(normalizeSemanticText));
    if (record.aliases.some((alias) => blocked.has(normalizeSemanticText(alias)))) failures.push({ kind: 'mechanical_alias', file: record.file });
  }
  const groups = new Map();
  for (const record of records) for (const source of record.sources) {
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
  assert(vault && fs.statSync(vault).isDirectory(), 'usage: audit-real-obsidian-cards.js VAULT');
  const report = auditVault(vault);
  assert(report.passed, JSON.stringify(report.failures, null, 2));
  console.log(`real Obsidian card audit: PASS (${report.cards} cards)`);
}
module.exports = { auditVault };
