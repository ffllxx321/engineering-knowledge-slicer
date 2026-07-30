const assert = require('assert');
const crypto = require('crypto');
const { loadBundleModule } = require('./load-bundle-module');
const block = loadBundleModule('src/core/block-v0.js', { crypto });
const parser = loadBundleModule('src/core/document-parser.js', {
  crypto,
  'src/core/block-v0.js': block,
  'src/core/provenance.js': { normalizeLegacyArtifact: (markdown, pages) => ({ markdown, pages, spans: [], provenance_version: '1.0' }) }
});

function entry(name, type, start, size) {
  const out = Buffer.alloc(128);
  const encoded = Buffer.from(`${name}\0`, 'utf16le');
  encoded.copy(out, 0, 0, Math.min(64, encoded.length));
  out.writeUInt16LE(Math.min(64, encoded.length), 64);
  out[66] = type; out.writeUInt32LE(start, 116); out.writeBigUInt64LE(BigInt(size), 120);
  return out;
}
function syntheticMsg() {
  const file = Buffer.alloc(512 + 18 * 512);
  Buffer.from('d0cf11e0a1b11ae1', 'hex').copy(file);
  file.writeUInt16LE(9, 30); file.writeUInt32LE(1, 44); file.writeUInt32LE(1, 48);
  file.writeUInt32LE(4096, 56); file.writeUInt32LE(0xFFFFFFFE, 60);
  file.writeUInt32LE(0xFFFFFFFE, 68); file.writeUInt32LE(0, 76);
  for (let i = 1; i < 109; i += 1) file.writeUInt32LE(0xFFFFFFFF, 76 + i * 4);
  const fat = file.subarray(512, 1024);
  for (let i = 0; i < 128; i += 1) fat.writeUInt32LE(0xFFFFFFFF, i * 4);
  fat.writeUInt32LE(0xFFFFFFFD, 0); fat.writeUInt32LE(0xFFFFFFFE, 4);
  for (const [first, last] of [[2, 9], [10, 17]]) {
    for (let i = first; i < last; i += 1) fat.writeUInt32LE(i + 1, i * 4);
    fat.writeUInt32LE(0xFFFFFFFE, last * 4);
  }
  const dir = file.subarray(1024, 1536);
  entry('Root Entry', 5, 0xFFFFFFFE, 0).copy(dir);
  entry('__substg1.0_0037001F', 2, 2, 4096).copy(dir, 128);
  entry('__substg1.0_1000001F', 2, 10, 4096).copy(dir, 256);
  Buffer.from('项目周报\0', 'utf16le').copy(file, 512 + 2 * 512);
  Buffer.from('本周完成节点。https://track.example/open.gif?token=secret&utm_source=mail\n取消订阅\0', 'utf16le').copy(file, 512 + 10 * 512);
  return file;
}

const msg = block.parseMsg(syntheticMsg());
assert.equal(parser.documentPlan('mail.MSG').mode, 'msg');
assert.equal(msg.status, 'ok');
assert.equal(msg.metadata.subject, '项目周报');
assert.equal(msg.metadata.body_presence.plain, true);
assert.equal(msg.metadata.body_presence.rtf, false);
assert(msg.blocks.some((item) => ['tracking', 'unsubscribe'].includes(item.kind) && !item.card_eligible));
assert(!JSON.stringify(msg).includes('token=secret'));

const scan = block.inspectPdf(Buffer.from('%PDF-1.7\n1 0 obj <</Type /Page /Rotate 90 /Resources <</XObject <</Im0 2 0 R>>>>>>\n2 0 obj <</Subtype /Image /Width 1 /Height 1>>'));
assert.equal(scan.metadata.pure_scan, true);
assert.equal(scan.pages[0].classification, 'scanned');
assert.equal(scan.pages[0].ocr.required, true);
assert.equal(scan.pages[0].rotation, 90);
assert.equal(scan.pages[0].visual.approval_status, 'unverified');
assert.equal(scan.blocks[0].raw.text, '');

const sourceHash = crypto.createHash('sha256').update('packing').digest('hex');
const blocks = Array.from({ length: 12 }, (_, index) => block.createBlock({
  source_hash: sourceHash, order: index, raw_text: `短块${index}`, locator: { scheme: 'fixture', value: String(index) }
}));
blocks.push(block.createBlock({ source_hash: sourceHash, order: 12, raw_text: '长'.repeat(80), locator: { scheme: 'fixture', value: 'long' } }));
const packed = block.packBlocks(blocks, { hardBudget: 20, softBudget: 16, tokenCounter: (text) => text.length });
assert(packed.packs.length < blocks.length);
assert.equal(packed.metrics.locator_coverage, 1);
assert(packed.packs.every((item) => item.token_count <= 20));
assert(packed.metrics.split_atomic_blocks > 0);
assert.equal(block.parseMsg(Buffer.from('not-cfb')).status, 'unsupported');
assert.equal(block.parseMsg(syntheticMsg(), { limits: { maxFileBytes: 100 } }).status, 'limits_exceeded');
console.log('block_v0 / MSG / PDF inventory / packing regression passed');
