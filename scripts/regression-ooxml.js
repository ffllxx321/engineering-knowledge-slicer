'use strict';

const assert = require('assert');
const crypto = require('crypto');
const zlib = require('zlib');
const { loadBundleModule } = require('./load-bundle-module');

function zip(entries, overrides = {}) {
  const locals = [], central = []; let offset = 0;
  for (const [name, source] of Object.entries(entries)) {
    const data = Buffer.from(source);
    const compressed = zlib.deflateRawSync(data);
    let crc = 0xffffffff;
    for (const byte of data) { crc ^= byte; for (let i = 0; i < 8; i += 1) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0); }
    crc = (crc ^ 0xffffffff) >>> 0;
    const nameBuffer = Buffer.from(name);
    const declared = overrides[name]?.uncompressed ?? data.length;
    const flags = overrides[name]?.flags ?? 0x800;
    const local = Buffer.alloc(30 + nameBuffer.length);
    local.writeUInt32LE(0x04034b50); local.writeUInt16LE(20, 4); local.writeUInt16LE(flags, 6);
    local.writeUInt16LE(8, 8); local.writeUInt32LE(crc, 14); local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(declared, 22); local.writeUInt16LE(nameBuffer.length, 26); nameBuffer.copy(local, 30);
    locals.push(local, compressed);
    const cd = Buffer.alloc(46 + nameBuffer.length);
    cd.writeUInt32LE(0x02014b50); cd.writeUInt16LE(20, 4); cd.writeUInt16LE(20, 6); cd.writeUInt16LE(flags, 8);
    cd.writeUInt16LE(8, 10); cd.writeUInt32LE(crc, 16); cd.writeUInt32LE(compressed.length, 20);
    cd.writeUInt32LE(declared, 24); cd.writeUInt16LE(nameBuffer.length, 28); cd.writeUInt32LE(offset, 42); nameBuffer.copy(cd, 46);
    central.push(cd); offset += local.length + compressed.length;
  }
  const cd = Buffer.concat(central);
  const eocd = Buffer.alloc(22); eocd.writeUInt32LE(0x06054b50); eocd.writeUInt16LE(central.length, 8);
  eocd.writeUInt16LE(central.length, 10); eocd.writeUInt32LE(cd.length, 12); eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, eocd]);
}
const contentTypes = '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>';
function docxFixture() {
  return zip({
    '[Content_Types].xml': contentTypes,
    'word/styles.xml': '<w:styles xmlns:w="w"><w:style w:styleId="H1"><w:name w:val="Heading 1"/><w:pPr><w:outlineLvl w:val="0"/></w:pPr></w:style><w:docDefaults><w:rPrDefault><w:rPr><w:lang w:val="zh-CN"/></w:rPr></w:rPrDefault></w:docDefaults></w:styles>',
    'word/numbering.xml': '<w:numbering xmlns:w="w"><w:abstractNum w:abstractNumId="1"><w:lvl w:ilvl="0"><w:numFmt w:val="bullet"/><w:lvlText w:val="•"/></w:lvl></w:abstractNum><w:num w:numId="5"><w:abstractNumId w:val="1"/></w:num></w:numbering>',
    'word/document.xml': '<w:document xmlns:w="w" xmlns:r="r" xmlns:a="a"><w:body><w:p><w:pPr><w:pStyle w:val="H1"/></w:pPr><w:r><w:t>项目标题</w:t></w:r></w:p><w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="5"/></w:numPr></w:pPr><w:hyperlink r:id="rId1"><w:r><w:t>链接条目</w:t></w:r></w:hyperlink><w:footnoteReference w:id="2"/></w:p><w:tbl><w:tr><w:tc><w:tcPr><w:gridSpan w:val="2"/></w:tcPr><w:p><w:r><w:t>合并表头</w:t></w:r></w:p></w:tc></w:tr></w:tbl><w:p><w:r><w:drawing><a:blip r:embed="rId2"/></w:drawing></w:r><w:br w:type="page"/></w:p><w:sectPr/></w:body></w:document>',
    'word/_rels/document.xml.rels': '<Relationships><Relationship Id="rId1" Type="hyperlink" Target="https://example.test" TargetMode="External"/><Relationship Id="rId2" Type="image" Target="media/image1.png"/></Relationships>',
    'word/header1.xml': '<w:hdr xmlns:w="w"><w:p><w:r><w:t>页眉</w:t></w:r></w:p></w:hdr>',
    'word/footer1.xml': '<w:ftr xmlns:w="w"><w:p><w:r><w:t>页脚</w:t></w:r></w:p></w:ftr>',
    'word/footnotes.xml': '<w:footnotes xmlns:w="w"><w:footnote w:id="2"><w:p><w:r><w:t>脚注内容</w:t></w:r></w:p></w:footnote></w:footnotes>',
    'word/media/image1.png': Buffer.from([137, 80, 78, 71])
  });
}
function xlsxFixture() {
  return zip({
    '[Content_Types].xml': contentTypes,
    'xl/workbook.xml': '<workbook xmlns:r="r"><sheets><sheet name="明细" sheetId="1" r:id="rId1"/><sheet name="隐藏" sheetId="2" state="hidden" r:id="rId2"/></sheets></workbook>',
    'xl/_rels/workbook.xml.rels': '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Target="worksheets/sheet2.xml"/></Relationships>',
    'xl/sharedStrings.xml': '<sst><si><t>设备</t></si><si><t>风机</t></si></sst>',
    'xl/styles.xml': '<styleSheet><cellXfs count="1"><xf numFmtId="0"/></cellXfs></styleSheet>',
    'xl/worksheets/sheet1.xml': '<worksheet xmlns:r="r"><dimension ref="A1:B3"/><cols><col min="2" max="2" hidden="1"/></cols><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="inlineStr"><is><t>数量</t></is></c></row><row r="2" hidden="1"><c r="A2" t="s"><v>1</v></c><c r="B2"><f>2+3</f><v>5</v></c></row></sheetData><mergeCells><mergeCell ref="A1:A3"/></mergeCells><autoFilter ref="A1:B3"/><drawing r:id="rDraw"/></worksheet>',
    'xl/worksheets/_rels/sheet1.xml.rels': '<Relationships><Relationship Id="rDraw" Target="../drawings/drawing1.xml"/></Relationships>',
    'xl/drawings/drawing1.xml': '<xdr:wsDr xmlns:xdr="xdr" xmlns:a="a" xmlns:r="r"><xdr:twoCellAnchor><xdr:from><xdr:col>0</xdr:col><xdr:row>1</xdr:row></xdr:from><xdr:to><xdr:col>1</xdr:col><xdr:row>3</xdr:row></xdr:to><xdr:pic><a:blip r:embed="rImg"/></xdr:pic></xdr:twoCellAnchor></xdr:wsDr>',
    'xl/drawings/_rels/drawing1.xml.rels': '<Relationships><Relationship Id="rImg" Target="../media/image1.png"/></Relationships>',
    'xl/worksheets/sheet2.xml': '<worksheet><dimension ref="A1"/><sheetData/></worksheet>',
    'xl/media/image1.png': Buffer.from([137, 80, 78, 71])
  });
}

const block = loadBundleModule('src/core/block-v0.js', { crypto });
const ooxml = loadBundleModule('src/core/ooxml.js', { crypto, zlib, 'src/core/block-v0.js': block });
const docx = ooxml.parseOoxml(docxFixture(), 'docx');
assert.equal(docx.status, 'ok');
assert(docx.blocks.some(b => b.kind === 'heading' && b.raw.text === '项目标题' && b.metadata.outline_level === 0));
assert(docx.blocks.some(b => b.kind === 'list_item' && b.metadata.list.format === 'bullet'));
assert(docx.blocks.some(b => b.kind === 'table_cell' && b.metadata.merge.grid_span === 2));
assert(docx.blocks.some(b => b.kind === 'header' && b.raw.text === '页眉'));
assert(docx.blocks.some(b => b.kind === 'footer' && b.raw.text === '页脚'));
assert(docx.blocks.some(b => b.metadata.hyperlinks?.[0]?.target === 'https://example.test'));
assert(docx.blocks.some(b => b.metadata.images?.[0]?.target === 'word/media/image1.png'));

const xlsx = ooxml.parseOoxml(xlsxFixture(), 'xlsx');
assert.equal(xlsx.status, 'ok');
assert.deepStrictEqual(xlsx.metadata.sheets.map(s => s.visibility), ['visible', 'hidden']);
assert(xlsx.blocks.some(b => b.metadata.coordinate === 'A2' && b.raw.text === '风机' && b.metadata.row_hidden));
const formula = xlsx.blocks.find(b => b.metadata.coordinate === 'B2');
assert.equal(formula.metadata.formula, '2+3'); assert.equal(formula.metadata.cached_value, '5'); assert.equal(formula.raw.text, '5');
assert(xlsx.blocks.some(b => b.metadata.coordinate === 'A3' && b.metadata.merge.role === 'inherited' && b.metadata.inherited_header === '设备'));
assert(xlsx.blocks.some(b => b.kind === 'image_metadata' && b.metadata.target === 'xl/media/image1.png'));
assert.equal(xlsx.metadata.ooxml_metrics.locator_coverage, 1);

assert.equal(ooxml.parseOoxml(zip({ '[Content_Types].xml': contentTypes, 'word/document.xml': '<w:document/>' }), 'docx').status, 'review_required');
assert.equal(ooxml.parseOoxml(zip({ '../evil': 'x', '[Content_Types].xml': contentTypes }), 'docx').code, 'OOXML_PATH_TRAVERSAL');
assert.equal(ooxml.parseOoxml(zip({ '[Content_Types].xml': contentTypes, 'word/document.xml': '<w:document/>' }, { 'word/document.xml': { uncompressed: 1000000 } }), 'docx', { limits: { maxCompressionRatio: 2 } }).code, 'OOXML_LIMIT_EXCEEDED');
const controller = new AbortController(); controller.abort();
assert.equal(ooxml.parseOoxml(docxFixture(), 'docx', { signal: controller.signal }).code, 'OOXML_ABORTED');

const packed = block.packBlocks(xlsx.blocks, { hardBudget: 12, softBudget: 8, tokenCounter: text => text.length });
assert(packed.packs.every(p => p.token_count <= 12)); assert.equal(packed.metrics.locator_coverage, 1);
async function fallbackGate() {
  const parser = loadBundleModule('src/core/document-parser.js', {
    crypto, 'src/core/provenance.js': { normalizeLegacyArtifact: (markdown, pages) => ({ markdown, pages, spans: [], provenance_version: '1.0' }) }
  });
  let uploads = 0;
  const extractor = loadBundleModule('src/core/extractors.js', {
    'src/core/document-parser.js': parser,
    'src/core/block-v0.js': block,
    'src/core/ooxml.js': ooxml,
    'src/core/local-ocr.js': { probeLocalOcr: async () => ({ available: false }), runLocalPdfOcr: async () => ({}) },
    'src/core/external-pdf.js': { extractDocumentWithApis: async () => { uploads += 1; return { status: 'ok', text: 'remote fallback', engine: 'mineru-api' }; } }
  });
  const invalid = Buffer.from('not a zip');
  const gated = await extractor.extractTextFromBuffer('bad.docx', invalid, { localOoxml: {}, pdfExtractor: { allowExternalUpload: false } });
  assert.equal(uploads, 0); assert.equal(gated.code, 'OOXML_INVALID_ZIP');
  const allowed = await extractor.extractTextFromBuffer('bad.docx', invalid, { localOoxml: {}, pdfExtractor: { allowExternalUpload: true } });
  assert.equal(uploads, 1); assert.equal(allowed.status, 'ok'); assert.equal(allowed.text, 'remote fallback');
  console.log(`OOXML regression passed: docx=${docx.blocks.length} blocks, xlsx=${xlsx.blocks.length} blocks, locator=100%, upload-gate=passed`);
}
fallbackGate().catch(error => { console.error(error); process.exitCode = 1; });
