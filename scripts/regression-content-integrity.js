'use strict';
const assert = require('assert');
const { analyzeText } = require('../src/content-integrity.js');
const { AutoDocumentParser, qualityOk } = require('../src/auto-document-parser.js');
const { evidenceIsVerifiable } = require('../src/phase3-review-gate.js');
const { ProductionCommitService } = require('../src/production-commit-service.js');
const { runUniversalPipelineMultilingual } = require('../src/universal-knowledge-pipeline.js');
const { loadBundleModule } = require('./load-bundle-module.js');
const bundledIntegrity = loadBundleModule('src/content-integrity.js');
const bundledParser = loadBundleModule('src/auto-document-parser.js');

const block = (text, id = 'b1') => ({ block_id: id, card_eligible: true, raw: { text },
  locator: { scheme: 'page', value: '1', page: 1 } });
const result = (text) => ({ status: 'ok', text, parsePackage: { markdown: text, blocks: [block(text)],
  evidence_index: { b1: { block_id: 'b1', raw_text: text } }, quality: { readable: true, corruptRatio: 0 } } });

const corrupt = [
  '%PDF-1.7\n1 0 obj<</Type/Page/Filter/FlateDecode>>stream\x00\x01\x02xœí½ endstream endobj\nxref\nstartxref',
  'å·¥ç¨‹è¦æ± Ã¦Â©â€™ å®å¨è´¨é Ã¦Â©â€™ å®å¨è´¨é',
  '{"region_id":"reg-12","text":"...","preserve_exactly":["GB/T 50010"]} Please return JSON using the output_schema and preserve every field.',
  'The supplied payload appears corrupted and cannot be meaningfully translated; there is no meaningful natural-language text.'
];
for (const text of corrupt) {
  assert.strictEqual(analyzeText(text).ok, false, text);
  assert.strictEqual(qualityOk(result(text)), false, 'parser-supplied readable metadata must not override content');
  assert.strictEqual(evidenceIsVerifiable({ block_id: 'b1', evidence: { block_id: 'b1', verbatim: text,
    locator: { scheme: 'page', value: '1' } } }), false);
  assert.strictEqual(bundledIntegrity.analyzeText(text).ok, false, 'bundled integrity contract must reject');
  assert.strictEqual(bundledParser.qualityOk(result(text)), false, 'bundled parser must reject');
}

const engineering = '按 GB/T 50010-2010 验收：混凝土强度 C30，保护层 35 mm；公式 f_cu,k ≥ 30 MPa。\n构件 | 型号 | 数量\n梁 | HN400×200 | 12';
const multilingual = '耐震等級は ISO 3010 に従う。Seismic joint SJ-204 shall be 35 mm. 抗震缝必须复核。';
assert(analyzeText(engineering).ok);
assert(analyzeText(multilingual).ok);
assert(qualityOk(result(engineering)));

(async () => {
  const calls = [];
  const parser = new AutoDocumentParser({
    localPdf: async () => { calls.push('localPdf'); return result(corrupt[0]); },
    mineru: async () => { calls.push('mineru'); return result(corrupt[2]); },
    localOcr: async () => { calls.push('localOcr'); return result(engineering); }
  });
  const parsed = await parser.parse('scan.pdf', Buffer.from('%PDF'), { mineruConfigured: true, allowNecessaryCloud: true });
  assert.strictEqual(parsed.parsePackage.markdown, engineering);
  assert.deepStrictEqual(calls, ['localPdf', 'mineru', 'localOcr']);

  let translated = false;
  await assert.rejects(() => runUniversalPipelineMultilingual({ document: {
    source_document_id: 'bad-pdf', source_hash: 'bad', blocks: [block(corrupt[0])]
  }, translate_batch: async () => { translated = true; return []; } }),
  (error) => error.code === 'NO_VERIFIABLE_NATURAL_LANGUAGE_EVIDENCE');
  assert.strictEqual(translated, false, 'invalid evidence must be rejected before translation');

  let commitCalled = false;
  const vault = { getAbstractFileByPath() {}, async read() {}, async create() {}, async modify() {},
    async rename() {}, async createFolder() {} };
  const service = new ProductionCommitService(vault, async () => { commitCalled = true; });
  await assert.rejects(() => service.commit({ actions: [{ record_id: 'false-card', record_kind: 'company_knowledge',
    path: '06-知识库/false.md', content: `# 严重乱码\n\n${corrupt[2]}` }] }, { runId: 'run', taskId: 'task' }),
  (error) => error.code === 'INVALID_KNOWLEDGE_CONTENT');
  assert.strictEqual(commitCalled, false, 'existing false card/noop must fail before any commit write');
  console.log('Content integrity counterexample regression: PASS');
})().catch((error) => { console.error(error); process.exitCode = 1; });
