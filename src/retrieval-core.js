'use strict';

const crypto = require('crypto');
const fs = require('fs');
const pathModule = require('path');

const SEARCH_SCHEMA = 'eks-search-record/1.0';
const FIELD_WEIGHTS = Object.freeze({ title: 5, keywords: 3, evidence: 2, body: 1 });

function clean(value) { return String(value ?? '').normalize('NFKC').replace(/\s+/g, ' ').trim(); }
function normalized(value) { return clean(value).toLocaleLowerCase('en-US'); }
function uniq(values) { return [...new Set((values || []).map(clean).filter(Boolean))]; }
function hash(value) { return crypto.createHash('sha256').update(String(value)).digest('hex'); }

function tokenize(value) {
  const text = normalized(value);
  const tokens = text.match(/[\p{Script=Han}]+|[\p{L}\p{N}]+(?:[._+/#-][\p{L}\p{N}]+)*/gu) || [];
  const out = [];
  for (const token of tokens) {
    if (/^[\p{Script=Han}]+$/u.test(token)) {
      const chars = [...token];
      if (chars.length === 1) out.push(chars[0]);
      else for (let i = 0; i < chars.length - 1; i += 1) out.push(chars.slice(i, i + 2).join(''));
    } else {
      out.push(token);
      for (const part of token.split(/[._+/#-]+/)) if (part && part !== token) out.push(part);
    }
  }
  return out;
}

function parseArray(value) {
  const input = clean(value);
  if (!input) return [];
  try { const parsed = JSON.parse(input); return Array.isArray(parsed) ? parsed : [parsed]; } catch (_) {}
  return input.replace(/^\[|\]$/g, '').split(',').map((item) => item.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean);
}

function assertSafeMarkdown(value, path = '') {
  const input = Buffer.isBuffer(value) ? value : Buffer.from(String(value ?? ''), 'utf8');
  if (!input.length) throw Object.assign(new Error(`空 Markdown 卡片：${path}`), { code: 'CARD_EMPTY' });
  if (input.includes(0) || input.subarray(0, 4096).some((byte) => byte < 9 || (byte > 13 && byte < 32))) {
    throw Object.assign(new Error(`疑似二进制卡片：${path}`), { code: 'CARD_BINARY_LIKE' });
  }
  const text = input.toString('utf8');
  const replacementCount = (text.match(/\uFFFD/g) || []).length;
  const mojibakeCount = (text.match(/(?:Ã.|Â.|â.|锟斤拷|烫烫烫)/g) || []).length;
  if (replacementCount || mojibakeCount >= 2) throw Object.assign(new Error(`卡片编码损坏：${path}`), { code: 'CARD_MOJIBAKE' });
  return text;
}

function locatorValue(value) {
  const input = clean(value);
  if (!input) return '';
  if (input.startsWith('base64url:')) {
    try { return JSON.parse(Buffer.from(input.slice(10), 'base64url').toString('utf8')); } catch (_) { return ''; }
  }
  try { const parsed = JSON.parse(input); return parsed && typeof parsed === 'object' ? parsed : input; } catch (_) { return input; }
}

function markdownRecord(markdown, path = '') {
  const input = assertSafeMarkdown(markdown, path);
  const frontmatter = input.match(/^---\s*\n([\s\S]*?)\n---\s*(?:\n|$)/)?.[1] || '';
  const meta = {};
  for (const line of frontmatter.split('\n')) {
    const match = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (match) meta[match[1]] = match[2].trim().replace(/^['"]|['"]$/g, '');
  }
  const body = input.replace(/^---\s*\n[\s\S]*?\n---\s*(?:\n|$)/, '');
  const heading = body.match(/^#\s+(.+)$/m)?.[1];
  const evidence = [...body.matchAll(/^>\s?(.*(?:\n>\s?.*)*)/gm)].map((match) => match[1].replace(/\n>\s?/g, '\n'));
  const locators = [...body.matchAll(/^定位：(.+)$/gm)].map((match) => clean(match[1]));
  const structuredLocators = [...body.matchAll(/^定位数据：(.+)$/gm)].map((match) => locatorValue(match[1]));
  return canonicalRecord({
    id: meta.record_id || meta.card_id, title: meta.search_title || meta.title || heading,
    search_title: meta.search_title, aliases: parseArray(meta.aliases), keywords: parseArray(meta.keywords),
    tags: parseArray(meta.tags), body, evidence: evidence.map((text, index) => ({ text, locator: structuredLocators[index] || locators[index] || '' })),
    source_id: meta.owner_source_id || parseArray(meta.source_document_ids)[0], source_path: meta.source_path,
    semantic_kind: meta.semantic_kind || meta.record_kind, category: meta.category, library: meta.library,
    path, content_hash: meta.content_hash || meta.source_hash
  });
}

function loadMarkdownCorpus(root, options = {}) {
  const absolute = pathModule.resolve(root);
  const stat = fs.statSync(absolute);
  const files = stat.isDirectory() ? fs.readdirSync(absolute, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.md'))
    .map((entry) => pathModule.join(entry.parentPath || entry.path, entry.name)).sort() : [absolute];
  if (!files.length) throw Object.assign(new Error(`卡片目录不含 Markdown：${root}`), { code: 'CORPUS_EMPTY' });
  const maxBytes = Math.max(1024, Number(options.max_bytes) || 2 * 1024 * 1024);
  return files.map((file) => {
    const buffer = fs.readFileSync(file);
    if (buffer.length > maxBytes) throw Object.assign(new Error(`卡片超过安全大小：${file}`), { code: 'CARD_TOO_LARGE' });
    const record = markdownRecord(buffer, pathModule.relative(absolute, file) || pathModule.basename(file));
    if (!record.id || !record.title) throw Object.assign(new Error(`卡片缺少 ID 或标题：${file}`), { code: 'CARD_INVALID' });
    return record;
  });
}

function canonicalRecord(input = {}) {
  const evidenceInput = input.evidence_list || input.evidence || input.original_evidence || [];
  const evidence = (Array.isArray(evidenceInput) ? evidenceInput : [evidenceInput]).map((item) => typeof item === 'string'
    ? { text: clean(item), locator: '' }
    : { text: clean(item?.text || item?.verbatim || item?.original || item?.quote), locator: item?.locator || '' }).filter((item) => item.text);
  const body = clean(input.body || input.claim || input.summary);
  const title = clean(input.search_title || input.title);
  const contentHash = clean(input.content_hash) || hash(JSON.stringify({ title, body, evidence }));
  return {
    schema: SEARCH_SCHEMA, id: clean(input.id || input.record_id || input.card_id) || `search-${contentHash.slice(0, 20)}`,
    title, search_title: clean(input.search_title || input.title), aliases: uniq(input.aliases),
    keywords: uniq([...(input.keywords || []), ...(input.tags || [])]), tags: uniq(input.tags), body,
    evidence, source_id: clean(input.source_id || input.owner_source_id || input.source_document_ids?.[0]),
    source_path: clean(input.source_path), semantic_kind: clean(input.semantic_kind || input.record_kind || input.card_type),
    category: clean(input.category), library: clean(input.library), path: clean(input.path), content_hash: contentHash
  };
}

function filterMatch(record, filters = {}) {
  return Object.entries(filters).every(([key, expected]) => {
    if (expected === undefined || expected === null || expected === '') return true;
    const actual = record[key]; const wanted = Array.isArray(expected) ? expected : [expected];
    return wanted.some((value) => Array.isArray(actual) ? actual.includes(value) : actual === value);
  });
}

function cosine(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length || !a.length) return 0;
  let dot = 0; let aa = 0; let bb = 0;
  for (let i = 0; i < a.length; i += 1) { dot += a[i] * b[i]; aa += a[i] ** 2; bb += b[i] ** 2; }
  return aa && bb ? dot / Math.sqrt(aa * bb) : 0;
}

function evidenceKey(record) {
  return normalized(record.evidence.map((item) => `${typeof item.locator === 'string' ? item.locator : JSON.stringify(item.locator)}:${item.text}`).join('|'));
}

function similarity(left, right) {
  const a = new Set(tokenize(`${left.title} ${left.body}`)); const b = new Set(tokenize(`${right.title} ${right.body}`));
  const intersection = [...a].filter((token) => b.has(token)).length;
  return intersection / Math.max(1, a.size + b.size - intersection);
}

function deduplicate(ranked) {
  const kept = [];
  for (const candidate of ranked) {
    const duplicate = kept.find((prior) => evidenceKey(prior.record) === evidenceKey(candidate.record)
      && (prior.record.content_hash === candidate.record.content_hash || similarity(prior.record, candidate.record) >= 0.9));
    if (duplicate) duplicate.duplicate_ids.push(candidate.record.id); else kept.push({ ...candidate, duplicate_ids: [] });
  }
  return kept;
}

class HybridRetriever {
  constructor(records = [], options = {}) {
    this.embedding = options.embedding || null;
    this.records = records.map((item) => typeof item === 'string' ? markdownRecord(item) : canonicalRecord(item));
    this.documentVectors = options.documentVectors || null;
    this.observability = { mode: this.embedding?.embed ? 'hybrid' : 'lexical-only', dense_available: Boolean(this.embedding?.embed), dense_error: null };
    this._prepareLexical();
  }

  _prepareLexical() {
    this.docs = this.records.map((record) => {
      const fields = { title: tokenize(`${record.title} ${record.search_title}`), keywords: tokenize([...record.aliases, ...record.keywords, ...record.tags].join(' ')), evidence: tokenize(record.evidence.map((item) => item.text).join(' ')), body: tokenize(record.body) };
      const terms = new Set(Object.values(fields).flat()); return { record, fields, terms };
    });
    this.df = new Map();
    for (const doc of this.docs) for (const term of doc.terms) this.df.set(term, (this.df.get(term) || 0) + 1);
    this.avg = {}; for (const field of Object.keys(FIELD_WEIGHTS)) this.avg[field] = this.docs.reduce((sum, doc) => sum + doc.fields[field].length, 0) / Math.max(1, this.docs.length);
  }

  lexical(query, filters = {}) {
    const terms = tokenize(query); const n = this.docs.length;
    return this.docs.filter(({ record }) => filterMatch(record, filters)).map((doc) => {
      let score = 0; const matched = {};
      for (const [field, weight] of Object.entries(FIELD_WEIGHTS)) {
        const counts = new Map(); for (const token of doc.fields[field]) counts.set(token, (counts.get(token) || 0) + 1);
        for (const term of terms) {
          const tf = counts.get(term) || 0; if (!tf) continue;
          const idf = Math.log(1 + (n - (this.df.get(term) || 0) + 0.5) / ((this.df.get(term) || 0) + 0.5));
          const lengthNorm = tf + 1.2 * (0.25 + 0.75 * doc.fields[field].length / Math.max(1, this.avg[field]));
          const contribution = weight * idf * (tf * 2.2 / lengthNorm); score += contribution;
          matched[term] = (matched[term] || 0) + contribution;
        }
      }
      return { record: doc.record, score, matched_terms: Object.keys(matched).sort() };
    }).filter((item) => item.score > 0).sort((a, b) => b.score - a.score || a.record.id.localeCompare(b.record.id));
  }

  async _vectors() {
    if (this.documentVectors) return this.documentVectors;
    const texts = this.records.map((record) => `${record.title}\n${record.keywords.join(' ')}\n${record.body}\n${record.evidence.map((item) => item.text).join('\n')}`);
    this.documentVectors = await this.embedding.embed(texts, { textType: 'document' }); return this.documentVectors;
  }

  async search(query, options = {}) {
    const limit = Math.max(1, options.limit || 10); const filters = options.filters || {};
    const lexical = this.lexical(query, filters); let dense = [];
    if (this.embedding?.embed) {
      try {
        const [queryVector] = await this.embedding.embed([query], { textType: 'query' }); const vectors = await this._vectors();
        dense = this.records.map((record, index) => ({ record, score: cosine(queryVector, vectors[index]) }))
          .filter((item) => filterMatch(item.record, filters) && Number.isFinite(item.score) && item.score > 0)
          .sort((a, b) => b.score - a.score || a.record.id.localeCompare(b.record.id));
      } catch (error) { this.observability = { mode: 'lexical-only', dense_available: false, dense_error: error.code || error.message || 'embedding_failed' }; }
    }
    const scores = new Map();
    const add = (list, kind) => list.forEach((item, rank) => { const current = scores.get(item.record.id) || { record: item.record, lexical_score: 0, dense_score: 0, lexical_rank: null, dense_rank: null, fusion_score: 0, matched_terms: [] }; current[`${kind}_score`] = item.score; current[`${kind}_rank`] = rank + 1; current.fusion_score += 1 / (60 + rank + 1); if (item.matched_terms) current.matched_terms = item.matched_terms; scores.set(item.record.id, current); });
    add(lexical, 'lexical'); add(dense, 'dense');
    const minLexicalScore = Math.max(0, Number(options.min_lexical_score) || 0);
    return deduplicate([...scores.values()].filter((item) => item.lexical_score >= minLexicalScore)
      .sort((a, b) => b.fusion_score - a.fusion_score || b.lexical_score - a.lexical_score || a.record.id.localeCompare(b.record.id)))
      .slice(0, limit).map((item) => ({ ...item, evidence_locators: item.record.evidence.map((e) => ({ locator: e.locator, text: e.text })) }));
  }
}

module.exports = { SEARCH_SCHEMA, FIELD_WEIGHTS, tokenize, canonicalRecord, markdownRecord, loadMarkdownCorpus, assertSafeMarkdown, HybridRetriever, deduplicate };
