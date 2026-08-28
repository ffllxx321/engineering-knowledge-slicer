'use strict';
const assert = require('assert');
const crypto = require('crypto');
const { loadBundleModule } = require('./load-bundle-module');
const sourceParser = require('../src/auto-document-parser.js');
const blockApi = loadBundleModule('src/core/block-v0.js', { crypto });
const provenance = loadBundleModule('src/core/provenance.js', { crypto });
const documentParser = loadBundleModule('src/core/document-parser.js', { crypto,
  'src/core/block-v0.js': blockApi, 'src/core/provenance.js': provenance });
const bundledParser = loadBundleModule('src/auto-document-parser.js');
const markdown = '# 施工要求\n\n混凝土强度等级为 C30，保护层厚度为 35 mm，验收前应逐项核验。';
const sourceHash = crypto.createHash('sha256').update('scan-pdf').digest('hex');
const inventoryBlock = blockApi.createBlock({ source_hash: sourceHash, order: 0,
  kind: 'page-inventory', raw_text: '', locator: { scheme: 'page', value: '1', page: 1 },
  parse_method: 'pdf-local-inventory', card_eligible: false, exclusion_reason: 'inventory_only' });
const parsePackage = documentParser.createParsePackage({ sourcePath: 'scan.pdf', buffer: Buffer.from('scan-pdf'),
  sourceType: 'pdf', parser: 'mineru-api-markdown', markdown, blocks: [inventoryBlock],
  pageInventory: [{ page: 1, text: '' }] });
const evidenceBlocks = parsePackage.blocks.filter((block) => block.card_eligible !== false && block.raw?.text);
assert.strictEqual(evidenceBlocks.length, 1, 'Markdown must add one eligible verbatim evidence block beside inventory');
assert.strictEqual(evidenceBlocks[0].raw.text, markdown);
assert.strictEqual(evidenceBlocks[0].locator.scheme, 'parsed-text-span');
assert.strictEqual(evidenceBlocks[0].locator.page, undefined, 'Markdown-only output must not invent a page');
assert.strictEqual(provenance.resolveEvidence(parsePackage, '混凝土强度等级为 C30').ok, true);
const result = { status: 'ok', text: markdown, parsePackage };
assert.strictEqual(bundledParser.qualityOk(result), true);
assert.strictEqual(sourceParser.qualityOk(result), true, 'source and bundle quality contracts must agree');
assert.strictEqual(bundledParser.qualityOk({ ...result, parsePackage: { ...parsePackage,
  quality: { ...parsePackage.quality, readable: false } } }), false, 'explicit unreadable quality remains fail-closed');
(async () => {
  const calls = [];
  const parser = new bundledParser.AutoDocumentParser({ probePdf: () => ({ reliableLocal: false }),
    localPdf: async () => { calls.push('localPdf'); return { status: 'failed' }; },
    mineru: async () => { calls.push('mineru'); return result; },
    localOcr: async () => { calls.push('localOcr'); return { status: 'failed' }; } });
  assert.strictEqual(await parser.parse('scan.pdf', Buffer.from('scan-pdf'), {
    mineruConfigured: true, allowNecessaryCloud: true }), result);
  assert.deepStrictEqual(calls, ['localPdf', 'mineru']);
  console.log('MinerU markdown quality regression: PASS');
})().catch((error) => { console.error(error); process.exitCode = 1; });
