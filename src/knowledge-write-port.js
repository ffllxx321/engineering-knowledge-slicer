'use strict';

const crypto = require('crypto');

const RECORD_STATES = Object.freeze([
  'planned', 'attempted', 'vault_committed', 'visible_verified',
  'failed', 'rollback_required', 'rolled_back'
]);
const VERIFIED_SCHEMA = 'eks/verified-records/1.0';
const KNOWLEDGE_KINDS = new Set(['business_item', 'company_knowledge']);

const digest = (value) => crypto.createHash('sha256').update(String(value ?? '')).digest('hex');
const normalizePath = (value) => String(value || '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
const frontmatter = (content, key) => {
  const match = String(content || '').match(new RegExp(`^${key}:\\s*["']?([^"'\\n]+)`, 'm'));
  return String(match?.[1] || '').trim();
};
const sourceMatches = (content, sourceId) => !sourceId || String(content).includes(`- 归属来源：${sourceId}`)
  || new RegExp(`^source_document_ids:\\s*\\[[^\\n]*["']?${String(sourceId).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}["']?`, 'm').test(String(content));

function verifiedRecordsOf(task) {
  const rows = Array.isArray(task?.verified_records) ? task.verified_records : [];
  return rows.filter((record) => record && record.state === 'visible_verified'
    && record.record_id && KNOWLEDGE_KINDS.has(record.record_kind) && normalizePath(record.path)
    && /^[a-f0-9]{64}$/.test(String(record.content_hash || '')) && record.transaction_id);
}

function deriveVerifiedFacts(task) {
  const records = verifiedRecordsOf(task);
  return { records, count: records.length, paths: records.map((item) => item.path) };
}

function applyVerifiedFacts(task, records) {
  task.verified_records_schema = VERIFIED_SCHEMA;
  task.verified_records = (records || []).map((record) => ({ ...record, state: 'visible_verified' }));
  // Compatibility-only projections. They are overwritten from the authority on every save.
  const facts = deriveVerifiedFacts(task);
  task.output_paths = facts.paths;
  task.written_card_ids = [];
  task.writtenFiles = [];
  task.result_counts = Object.assign({}, task.result_counts || {}, {
    committed: facts.count, verified: facts.count, written: facts.count, knowledge_records: facts.count
  });
  return facts;
}

function assertTaskInvariant(task) {
  const facts = deriveVerifiedFacts(task);
  const errors = [];
  const claimsSuccess = ['written', 'success', 'archived'].includes(task?.status)
    || task?.terminal_outcome === 'completed_with_output';
  if (claimsSuccess && facts.count === 0) errors.push('success_without_visible_verified_record');
  if (Number(task?.result_counts?.verified || 0) !== facts.count) errors.push('verified_count_drift');
  if (Number(task?.result_counts?.written || 0) !== facts.count) errors.push('written_count_drift');
  if (Number(task?.result_counts?.knowledge_records || 0) !== facts.count) errors.push('knowledge_count_drift');
  if (JSON.stringify(task?.output_paths || []) !== JSON.stringify(facts.paths)) errors.push('output_paths_drift');
  return { ok: errors.length === 0, task_id: task?.task_id || task?.taskId || '', verified: facts.count, errors };
}

function auditTaskInvariants(tasks) {
  const results = (tasks || []).map(assertTaskInvariant);
  return { schema: 'eks/invariant-audit/1.0', ok: results.every((item) => item.ok), results };
}

function normalizeTaskForPersistence(task) {
  const facts = applyVerifiedFacts(task, verifiedRecordsOf(task));
  if (['written', 'success', 'archived'].includes(task.status) && facts.count === 0) {
    task.status = 'verification_required';
    task.terminal_outcome = null;
  }
  return task;
}

class KnowledgeWritePort {
  constructor(obsidianVault) {
    const required = ['getAbstractFileByPath', 'read', 'create', 'modify', 'rename', 'createFolder'];
    const missing = required.filter((name) => typeof obsidianVault?.[name] !== 'function');
    if (missing.length) {
      const error = new Error(`Obsidian Vault 公共 API 不完整：${missing.join(', ')}`);
      error.code = 'OBSIDIAN_PUBLIC_VAULT_API_REQUIRED';
      throw error;
    }
    this.vault = obsidianVault;
  }

  async mkdirp(folder) {
    const parts = normalizePath(folder).split('/').filter(Boolean);
    let current = '';
    for (const part of parts) {
      current = current ? `${current}/${part}` : part;
      if (!this.vault.getAbstractFileByPath(current)) {
        try { await this.vault.createFolder(current); }
        catch (error) {
          // Multiple transactions can discover the same missing ancestor before
          // Obsidian's metadata cache observes either create. The public API is
          // authoritative: tolerate only the proven already-created race.
          let visible = this.vault.getAbstractFileByPath(current);
          if (/already exists/i.test(String(error?.message || error))) {
            for (let attempt = 0; attempt < 20 && !visible; attempt += 1) {
              await new Promise((resolve) => setTimeout(resolve, 25));
              visible = this.vault.getAbstractFileByPath(current);
            }
          }
          if (!visible) throw error;
        }
      }
    }
  }

  async readIfExists(path) {
    const normalized = normalizePath(path);
    const file = this.vault.getAbstractFileByPath(normalized);
    if (!file || file.path !== normalized) return null;
    return this.vault.read(file);
  }

  async write(path, content) {
    const normalized = normalizePath(path);
    await this.mkdirp(normalized.split('/').slice(0, -1).join('/'));
    const existing = this.vault.getAbstractFileByPath(normalized);
    if (existing) await this.vault.modify(existing, String(content));
    else await this.vault.create(normalized, String(content));
    const visible = this.vault.getAbstractFileByPath(normalized);
    if (!visible || visible.path !== normalized || String(await this.vault.read(visible)) !== String(content)) {
      const error = new Error(`Obsidian 无法确认文件可见：${normalized}`);
      error.code = 'VAULT_VISIBLE_VERIFICATION_FAILED';
      throw error;
    }
    return normalized;
  }

  async rename(from, to) {
    const source = normalizePath(from);
    const target = normalizePath(to);
    await this.mkdirp(target.split('/').slice(0, -1).join('/'));
    const file = this.vault.getAbstractFileByPath(source);
    if (!file) throw new Error(`找不到待移动文件：${source}`);
    await this.vault.rename(file, target);
    if (!this.vault.getAbstractFileByPath(target)) throw new Error(`移动后文件不可见：${target}`);
  }

  async verify(action, transactionId, verifiedAt) {
    const content = await this.readIfExists(action.path);
    const valid = String(content || '').trim() && frontmatter(content, 'record_id') === action.record_id
      && frontmatter(content, 'record_kind') === action.record_kind
      && digest(content) === action.content_hash
      && (!KNOWLEDGE_KINDS.has(action.record_kind) || sourceMatches(content, action.owner_source_id));
    if (!valid) {
      const error = new Error(`记录可见性/身份/hash/来源校验失败：${action.path}`);
      error.code = 'VAULT_RECORD_VERIFICATION_FAILED';
      throw error;
    }
    return {
      record_id: action.record_id, record_kind: action.record_kind, path: action.path,
      content_hash: action.content_hash, verified_at: verifiedAt, transaction_id: transactionId,
      source_association: action.owner_source_id || '', state: 'visible_verified'
    };
  }
}

module.exports = {
  RECORD_STATES, VERIFIED_SCHEMA, KNOWLEDGE_KINDS, KnowledgeWritePort, digest,
  verifiedRecordsOf, deriveVerifiedFacts, applyVerifiedFacts, normalizeTaskForPersistence,
  assertTaskInvariant, auditTaskInvariants
};
