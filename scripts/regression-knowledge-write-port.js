'use strict';
const assert = require('assert');
const { KnowledgeWritePort, digest, applyVerifiedFacts, deriveVerifiedFacts,
  normalizeTaskForPersistence, auditTaskInvariants } = require('../src/knowledge-write-port.js');
class RealisticTFile { constructor(path) { this.path = path; this.stat = { mtime: Date.now() }; } }
function fixture() {
  const files = new Map(); const folders = new Set();
  return { files, vault: {
    getAbstractFileByPath: (path) => files.has(path) ? new RealisticTFile(path) : (folders.has(path) ? { path, children: [] } : null),
    read: async (file) => files.get(file.path), create: async (path, content) => { files.set(path, String(content)); return new RealisticTFile(path); },
    modify: async (file, content) => { files.set(file.path, String(content)); },
    rename: async (file, target) => { const value = files.get(file.path); files.delete(file.path); files.set(target, value); },
    createFolder: async (path) => { folders.add(path); }, delete: async (file) => { files.delete(file.path); }
  } };
}
async function main() {
  assert.throws(() => new KnowledgeWritePort({}), /公共 API 不完整/);
  const { vault, files } = fixture(); const port = new KnowledgeWritePort(vault);
  const content = '---\nrecord_id: "bi-test"\nrecord_kind: "business_item"\nsource_document_ids: ["src-test"]\n---\n\n正文\n- 归属来源：src-test\n';
  const action = { record_id: 'bi-test', record_kind: 'business_item', path: '知识 空格/中文 日本語.md', content,
    content_hash: digest(content), owner_source_id: 'src-test' };
  await port.write(action.path, content); const verified = await port.verify(action, 'txn-1', '2026-08-03T00:00:00.000Z');
  const task = { task_id: 't1', status: 'written', result_counts: {} }; applyVerifiedFacts(task, [verified]);
  assert.strictEqual(deriveVerifiedFacts(task).count, 1); assert.strictEqual(auditTaskInvariants([task]).ok, true);
  files.set(action.path, content.replace('正文', '替换')); await assert.rejects(() => port.verify(action, 'txn-1', ''), /校验失败/);
  files.delete(action.path); await assert.rejects(() => port.verify(action, 'txn-1', ''), /校验失败/);
  const stale = normalizeTaskForPersistence({ status: 'written', written_card_ids: ['lie'], writtenFiles: ['missing.md'], result_counts: { written: 9 } });
  assert.strictEqual(stale.status, 'verification_required'); assert.strictEqual(stale.result_counts.written, 0);
  const drift = JSON.parse(JSON.stringify(task)); drift.result_counts.written = 9; assert.strictEqual(auditTaskInvariants([drift]).ok, false);
  console.log('knowledge write port contract (mock Vault, NOT real Obsidian): PASS');
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
