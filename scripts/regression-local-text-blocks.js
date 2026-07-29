const assert = require('assert');
const crypto = require('crypto');
const { loadBundleModule } = require('./load-bundle-module');
const provenance = { normalizeLegacyArtifact: (markdown, pages) => ({ markdown, pages: pages || [], spans: [], provenance_version: '1.0' }) };
const parser = loadBundleModule('src/core/document-parser.js', { crypto, 'src/core/provenance.js': provenance });
const block = loadBundleModule('src/core/block-v0.js', { crypto });
let externalCalls = 0;
const extractors = loadBundleModule('src/core/extractors.js', {
  'src/core/document-parser.js': parser, 'src/core/block-v0.js': block,
  'src/core/external-pdf.js': { extractDocumentWithApis: async () => { externalCalls += 1; return { status: 'failed' }; } },
  'src/core/local-ocr.js': { probeLocalOcr: async () => ({ available: false }), runLocalPdfOcr: async () => ({}) },
  'src/core/ooxml.js': { parseOoxml: () => ({ status: 'unsupported' }) }
});
async function run() {
  const md = Buffer.from('# 总则\n\n适用于全部项目。\n\n| 项目 | 要求 |\n| --- | --- |\n| 复核 | 必须 |\n\n```js\nconst x = 1;\n```\n');
  const options = { localTextBlockAdapter: true, blockPacking: { hardBudget: 64 } };
  const first = await extractors.extractTextFromBuffer('drop/通用要求.md', md, options);
  const second = await extractors.extractTextFromBuffer('another/name.md', md, options);
  assert.equal(first.parsePackage.parser, 'text-block-v0');
  assert(first.parsePackage.blocks.some((item) => item.kind === 'heading' && item.locator.value === 'L1-L1'));
  assert(first.parsePackage.blocks.some((item) => item.kind === 'table' && item.locator.value === 'L5-L7'));
  assert(first.parsePackage.blocks.some((item) => item.kind === 'code_block'));
  assert(first.parsePackage.block_packs.length > 0);
  assert(first.parsePackage.block_packs.length <= Math.ceil(first.parsePackage.markdown.length / 256) + 1);
  assert.equal(Object.keys(first.parsePackage.evidence_index).length, first.parsePackage.blocks.length);
  assert.deepStrictEqual(first.parsePackage.blocks.map((item) => item.block_id), second.parsePackage.blocks.map((item) => item.block_id));
  const txt = Buffer.from('第一段通用说明。\r\n仍属第一段。\r\n\r\n第二段包含 https://track.example/open.gif?token=secret&utm_source=x\r\n');
  const textResult = await extractors.extractTextFromBuffer('drop/readme.txt', txt, options);
  assert.equal(textResult.parsePackage.blocks.length, 2);
  assert.equal(textResult.parsePackage.blocks[1].card_eligible, false);
  const eml = Buffer.from([
    'From: sender@example.com', 'To: receiver@example.com', 'Subject: 项目复核',
    'MIME-Version: 1.0', 'Content-Type: multipart/mixed; boundary="B"', '',
    '--B', 'Content-Type: text/plain; charset=utf-8', '', '请完成结构复核。', '--B',
    'Content-Type: text/plain; name="../note.txt"', 'Content-Disposition: attachment; filename="../note.txt"',
    'Content-Transfer-Encoding: base64', '', Buffer.from('附件正文').toString('base64'), '--B--', ''
  ].join('\r\n'));
  const email = await extractors.extractTextFromBuffer('drop/mail.eml', eml, options);
  assert.equal(email.parsePackage.parser, 'eml-block-v0');
  assert.equal(email.attachments[0].filename, '_note.txt');
  assert(email.parsePackage.blocks.some((item) => item.kind === 'attachment' && !item.card_eligible));
  assert(!JSON.stringify(email.parsePackage).includes('附件正文'));
  assert(!JSON.stringify(email.parsePackage).includes('../note.txt'));
  assert(email.parsePackage.blocks.some((item) => item.kind === 'email_subject' && item.card_eligible));
  assert(email.parsePackage.blocks.some((item) => item.kind === 'email_from' && !item.card_eligible));
  const legacy = await extractors.extractTextFromBuffer('drop/legacy.txt', Buffer.from('兼容旧文本解析路径，内容足够长。'), { localTextBlockAdapter: false });
  assert.equal(legacy.parsePackage.parser, 'text-normalizer');
  assert.equal(legacy.parsePackage.blocks.length, 0);
  assert.equal(externalCalls, 0);
  const migrated = loadBundleModule('src/core/task.js', { crypto, path: require('path') }).migrateSettings({ settingsVersion: 24 });
  assert.equal(migrated.settingsVersion, 28);
  assert.equal(migrated.localTextBlockAdapterEnabled, true);
  const main = require('fs').readFileSync(require('path').join(__dirname, '..', 'main.js'), 'utf8');
  assert(main.includes('packedChunks.length <= legacyChunks.length ? packedChunks : legacyChunks'));
  console.log('local MD/TXT/EML block_v0 normalization regression passed');
}
run().catch((error) => { console.error(error); process.exitCode = 1; });
