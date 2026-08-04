'use strict';

const assert = require('assert');
const path = require('path');
const { ATTEMPT_STATUSES, STATES, TRANSITIONS, V3Phase1Orchestrator, MANIFEST_PATH, OUTPUT_ROOT,
  selectAndParse, sha256 } = require('../src/v3');

class MemoryVault {
  constructor(initial = {}) { this.files = new Map(Object.entries(initial)); this.folders = new Set(); this.fail = {}; }
  file(pathValue) { return { path: pathValue, name: path.basename(pathValue), basename: path.basename(pathValue, path.extname(pathValue)), extension: path.extname(pathValue).slice(1) }; }
  getAbstractFileByPath(p) { return this.files.has(p) ? this.file(p) : this.folders.has(p) ? { path: p, children: [] } : null; }
  async readBinary(file) { if (this.fail.readBinary) throw new Error('injected read failure'); return Buffer.from(this.files.get(file.path)); }
  async read(file) { if (this.fail.reopen && file.path.includes('verified-output')) throw new Error('injected reopen failure'); let value = String(this.files.get(file.path)); if (this.fail.hash && file.path.includes('/staging/')) value += 'tampered'; return value; }
  async createFolder(p) { this.folders.add(p); }
  async create(p, value) { if (this.fail.stagingWrite && p.includes('/staging/')) throw new Error('injected staging write failure'); this.files.set(p, value); return this.file(p); }
  async modify(file, value) { this.files.set(file.path, value); }
  async rename(file, destination) { const value = this.files.get(file.path); this.files.delete(file.path); this.files.set(destination, value); }
  async delete(file) { this.files.delete(file.path); }
}

function crc32(buffer) { let crc = 0xffffffff; for (const byte of buffer) { crc ^= byte; for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0); } return (crc ^ 0xffffffff) >>> 0; }
function storedZip(entries) {
  const chunks = [];
  for (const [name, content] of Object.entries(entries)) {
    const n = Buffer.from(name); const data = Buffer.from(content); const h = Buffer.alloc(30);
    h.writeUInt32LE(0x04034b50); h.writeUInt16LE(20, 4); h.writeUInt32LE(crc32(data), 14); h.writeUInt32LE(data.length, 18);
    h.writeUInt32LE(data.length, 22); h.writeUInt16LE(n.length, 26); chunks.push(h, n, data);
  }
  return Buffer.concat(chunks);
}
function source(extension, bytes, name = `fixture.${extension}`) { return { path: `fixtures/${name}`, name, extension, bytes: Buffer.from(bytes) }; }
async function expectFailure(promise, pattern) { let error; try { await promise; } catch (caught) { error = caught; } assert(error, 'expected failure'); assert.match(error.message, pattern); return error; }

async function parserContracts() {
  assert.deepStrictEqual(STATES, ['queued', 'reading', 'parsing', 'validating', 'staging', 'verifying', 'committed', 'failed']);
  assert.deepStrictEqual(ATTEMPT_STATUSES, ['attempted', 'skipped', 'succeeded', 'failed']);
  assert.deepStrictEqual(TRANSITIONS.verifying, ['committed', 'failed']);
  const cases = [
    source('txt', '中文工程资料'), source('md', '# 日本語\n\n品質基準'),
    source('docx', storedZip({ 'word/document.xml': '<w:document><w:t>DOCX English content</w:t></w:document>' })),
    source('xlsx', storedZip({ 'xl/sharedStrings.xml': '<sst><si><t>表格数据</t></si></sst>', 'xl/worksheets/sheet1.xml': '<x><v>42</v></x>' })),
    source('pptx', storedZip({ 'ppt/slides/slide1.xml': '<p:sld><a:t>プレゼン資料</a:t></p:sld>' })),
    source('eml', 'Subject: Gate\r\nContent-Type: text/plain\r\n\r\nEnglish email body'),
    source('msg', Buffer.from('MSG English body and project facts\0', 'utf16le'))
  ];
  for (const fixture of cases) {
    const parsed = await selectAndParse(fixture);
    assert(parsed.result.blocks.length > 0); assert(parsed.result.blocks.every((block) => block.id && block.locator));
    assert.strictEqual(parsed.attempts[0].status, 'attempted'); assert.strictEqual(parsed.attempts[1].status, 'succeeded');
    assert(!('knowledge_card' in parsed.result));
  }
  const native = source('pdf', '%PDF-1.4 BT (This is a sufficiently long native PDF text with engineering requirements, schedule, safety controls, verification evidence, and acceptance criteria for the representative fixture.) Tj ET');
  const nativeResult = await selectAndParse(native, {});
  assert.strictEqual(nativeResult.result.parser_provenance.selected_parser, 'pdf-native');
  assert(nativeResult.attempts.some((a) => a.adapter === 'pdf-cloud' && a.status === 'skipped'));
  const scanned = source('pdf', '%PDF-1.4\n/image scanned only');
  const ocr = await selectAndParse(scanned, { ocr: { available: true, parse: async () => '扫描件 OCR 中文内容' } });
  assert.strictEqual(ocr.result.parser_provenance.selected_parser, 'pdf-local-ocr');
  const cloud = await selectAndParse(scanned, { cloud: { configured: true, authorized: true, parse: async () => 'Cloud parsed English result' }, ocr: { available: true, parse: async () => { throw new Error('must skip'); } } });
  assert.strictEqual(cloud.result.parser_provenance.selected_parser, 'pdf-cloud');
  assert(cloud.attempts.some((a) => a.adapter === 'pdf-local-ocr' && a.status === 'skipped'));
}

async function counterexamples() {
  const scanned = source('pdf', '%PDF scanned');
  const noKey = await expectFailure(selectAndParse(scanned, {}), /no configured cloud key.*local OCR unavailable/);
  assert(!noKey.attempts.some((a) => a.adapter === 'pdf-cloud' && a.status === 'failed'));
  await expectFailure(selectAndParse(scanned, { cloud: { configured: true, authorized: false }, ocr: { available: false } }), /upload not authorized or declined/);
  const timeout = await expectFailure(selectAndParse(scanned, { cloud: { configured: true, authorized: true, parse: async () => { throw new Error('cloud timeout'); } }, ocr: { available: true, parse: async () => { throw new Error('ocr failure'); } } }), /cloud timeout.*ocr failure/);
  assert(timeout.attempts.filter((a) => a.status === 'failed').length === 2);
  await expectFailure(selectAndParse(source('txt', '')), /empty content/);
  await expectFailure(selectAndParse(source('docx', 'malformed')), /V3_OOXML_INVALID_ZIP/);
}

async function vaultContracts() {
  const inputPath = 'Sources/代表资料.txt'; const vault = new MemoryVault({ [inputPath]: '中文\n\nEnglish\n\n日本語' }); const file = vault.file(inputPath);
  const first = await new V3Phase1Orchestrator(vault).process(file, 'run-one');
  assert.strictEqual(first.manifest.state, 'committed'); assert(first.manifest.final.path.startsWith(OUTPUT_ROOT));
  assert.strictEqual(await V3Phase1Orchestrator.completionFromManifest(vault), true);
  const firstPath = first.manifest.final.path; const firstHash = first.manifest.final.sha256;
  const restarted = new V3Phase1Orchestrator(vault); assert.strictEqual(await V3Phase1Orchestrator.completionFromManifest(restarted.vault), true);
  const repeated = await restarted.process(file, 'run-two'); assert.strictEqual(repeated.manifest.final.path, firstPath); assert.strictEqual(repeated.manifest.final.sha256, firstHash);
  assert.strictEqual([...vault.files.keys()].filter((p) => p.startsWith(OUTPUT_ROOT)).length, 1);
  const before = new MemoryVault({ [inputPath]: 'restart before commit' });
  assert.strictEqual(await V3Phase1Orchestrator.completionFromManifest(before), false);
  for (const [flag, pattern] of [['stagingWrite', /staging write/], ['hash', /HASH_MISMATCH/], ['reopen', /reopen failure/]]) {
    const bad = new MemoryVault({ [inputPath]: 'failure content' }); bad.fail[flag] = true;
    await expectFailure(new V3Phase1Orchestrator(bad).process(bad.file(inputPath), `run-${flag}`), pattern);
    assert.strictEqual(await V3Phase1Orchestrator.completionFromManifest(bad), false);
  }
  const manifest = JSON.parse(vault.files.get(MANIFEST_PATH)); vault.files.set(firstPath, `${vault.files.get(firstPath)}tamper`);
  assert.strictEqual(manifest.state, 'committed'); assert.strictEqual(await V3Phase1Orchestrator.completionFromManifest(vault), false);
}

(async () => { await parserContracts(); await counterexamples(); await vaultContracts(); console.log('v3 core contracts: PASS'); })()
  .catch((error) => { console.error(error); process.exitCode = 1; });
