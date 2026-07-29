'use strict';

const crypto = require('crypto');
const zlib = require('zlib');
const { createBlock, blocksToMarkdown } = require('src/core/block-v0.js');

const DEFAULT_LIMITS = Object.freeze({
  maxFileBytes: 256 * 1024 * 1024,
  maxEntries: 4096,
  maxCompressedBytes: 256 * 1024 * 1024,
  maxUncompressedBytes: 768 * 1024 * 1024,
  maxEntryBytes: 128 * 1024 * 1024,
  maxCompressionRatio: 200,
  maxXmlBytes: 64 * 1024 * 1024,
  maxXmlDepth: 128,
  maxTextChars: 8 * 1024 * 1024
});

class OoxmlError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'OoxmlError';
    this.code = code;
    this.details = details;
  }
}

function fail(code, message, details) { throw new OoxmlError(code, message, details); }
function checkAbort(signal) {
  if (signal?.aborted) fail('OOXML_ABORTED', 'OOXML parsing was aborted');
}
function limits(input = {}) {
  const out = {};
  for (const [key, fallback] of Object.entries(DEFAULT_LIMITS)) {
    const value = Number(input[key]);
    out[key] = Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
  }
  return out;
}
function safePath(name) {
  const value = String(name || '').replace(/\\/g, '/');
  if (!value || value.startsWith('/') || /^[A-Za-z]:/.test(value) || value.split('/').includes('..') || value.includes('\0')) {
    fail('OOXML_PATH_TRAVERSAL', 'Unsafe ZIP entry path', { entry: value.slice(0, 200) });
  }
  return value.replace(/^\/+/, '');
}

class SafeZip {
  constructor(buffer, options = {}) {
    this.buffer = Buffer.from(buffer || []);
    this.limits = limits(options.limits);
    this.signal = options.signal;
    this.metrics = { entries: 0, compressed_bytes: 0, declared_uncompressed_bytes: 0, inflated_bytes: 0 };
    checkAbort(this.signal);
    if (this.buffer.length > this.limits.maxFileBytes) fail('OOXML_LIMIT_EXCEEDED', 'OOXML file exceeds byte limit');
    if (this.buffer.length < 22 || this.buffer.readUInt32LE(0) !== 0x04034b50) fail('OOXML_INVALID_ZIP', 'Missing ZIP local header');
    this.entries = this.readDirectory();
  }
  readDirectory() {
    const start = Math.max(0, this.buffer.length - 65557);
    let eocd = -1;
    for (let i = this.buffer.length - 22; i >= start; i -= 1) {
      if (this.buffer.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) fail('OOXML_INVALID_ZIP', 'Missing ZIP central directory');
    const disk = this.buffer.readUInt16LE(eocd + 4);
    const cdDisk = this.buffer.readUInt16LE(eocd + 6);
    const count = this.buffer.readUInt16LE(eocd + 10);
    const cdSize = this.buffer.readUInt32LE(eocd + 12);
    const cdOffset = this.buffer.readUInt32LE(eocd + 16);
    if (disk || cdDisk || count === 0xffff || cdOffset === 0xffffffff) fail('OOXML_UNSUPPORTED', 'Multi-disk or ZIP64 OOXML is unsupported');
    if (count > this.limits.maxEntries) fail('OOXML_LIMIT_EXCEEDED', 'ZIP entry count exceeds limit', { count });
    if (cdOffset + cdSize > eocd || cdOffset < 0) fail('OOXML_INVALID_ZIP', 'Central directory is out of bounds');
    const map = new Map();
    let pos = cdOffset;
    let compressedTotal = 0;
    let uncompressedTotal = 0;
    for (let index = 0; index < count; index += 1) {
      checkAbort(this.signal);
      if (pos + 46 > eocd || this.buffer.readUInt32LE(pos) !== 0x02014b50) fail('OOXML_INVALID_ZIP', 'Malformed central directory entry');
      const flags = this.buffer.readUInt16LE(pos + 8);
      const method = this.buffer.readUInt16LE(pos + 10);
      const crc = this.buffer.readUInt32LE(pos + 16);
      const compressed = this.buffer.readUInt32LE(pos + 20);
      const uncompressed = this.buffer.readUInt32LE(pos + 24);
      const nameLen = this.buffer.readUInt16LE(pos + 28);
      const extraLen = this.buffer.readUInt16LE(pos + 30);
      const commentLen = this.buffer.readUInt16LE(pos + 32);
      const localOffset = this.buffer.readUInt32LE(pos + 42);
      if (flags & 1) fail('OOXML_ENCRYPTED', 'Encrypted OOXML packages are unsupported');
      if (![0, 8].includes(method)) fail('OOXML_UNSUPPORTED', `ZIP compression method ${method} is unsupported`);
      if (compressed === 0xffffffff || uncompressed === 0xffffffff || localOffset === 0xffffffff) fail('OOXML_UNSUPPORTED', 'ZIP64 OOXML is unsupported');
      if (pos + 46 + nameLen + extraLen + commentLen > eocd) fail('OOXML_INVALID_ZIP', 'Central directory name is out of bounds');
      const name = safePath(this.buffer.subarray(pos + 46, pos + 46 + nameLen).toString((flags & 0x800) ? 'utf8' : 'latin1'));
      if (map.has(name)) fail('OOXML_INVALID_ZIP', 'Duplicate ZIP entry', { entry: name });
      compressedTotal += compressed; uncompressedTotal += uncompressed;
      if (compressedTotal > this.limits.maxCompressedBytes || uncompressedTotal > this.limits.maxUncompressedBytes ||
          uncompressed > this.limits.maxEntryBytes || (compressed > 0 && uncompressed / compressed > this.limits.maxCompressionRatio) ||
          (compressed === 0 && uncompressed > 0)) {
        fail('OOXML_LIMIT_EXCEEDED', 'ZIP decompression limits exceeded', { entry: name });
      }
      map.set(name, { name, flags, method, crc, compressed, uncompressed, localOffset });
      pos += 46 + nameLen + extraLen + commentLen;
    }
    this.metrics = { entries: count, compressed_bytes: compressedTotal, declared_uncompressed_bytes: uncompressedTotal, inflated_bytes: 0 };
    return map;
  }
  has(name) { return this.entries.has(name); }
  read(name, xml = false) {
    checkAbort(this.signal);
    const entry = this.entries.get(name);
    if (!entry) return null;
    const pos = entry.localOffset;
    if (pos + 30 > this.buffer.length || this.buffer.readUInt32LE(pos) !== 0x04034b50) fail('OOXML_INVALID_ZIP', 'Malformed ZIP local header', { entry: name });
    const nameLen = this.buffer.readUInt16LE(pos + 26);
    const extraLen = this.buffer.readUInt16LE(pos + 28);
    const localFlags = this.buffer.readUInt16LE(pos + 6);
    const localMethod = this.buffer.readUInt16LE(pos + 8);
    const localName = safePath(this.buffer.subarray(pos + 30, pos + 30 + nameLen).toString((localFlags & 0x800) ? 'utf8' : 'latin1'));
    if (localName !== name || localMethod !== entry.method || (localFlags & 1) !== (entry.flags & 1)) {
      fail('OOXML_INVALID_ZIP', 'ZIP local header disagrees with central directory', { entry: name });
    }
    const start = pos + 30 + nameLen + extraLen;
    const end = start + entry.compressed;
    if (end > this.buffer.length) fail('OOXML_INVALID_ZIP', 'ZIP entry data is out of bounds', { entry: name });
    let out;
    try {
      out = entry.method === 0 ? Buffer.from(this.buffer.subarray(start, end)) :
        zlib.inflateRawSync(this.buffer.subarray(start, end), { maxOutputLength: Math.min(entry.uncompressed + 1, this.limits.maxEntryBytes + 1) });
    } catch (error) {
      fail('OOXML_INVALID_ZIP', 'ZIP decompression failed', { entry: name, reason: String(error.message || error).slice(0, 200) });
    }
    if (out.length !== entry.uncompressed || out.length > this.limits.maxEntryBytes) fail('OOXML_INVALID_ZIP', 'ZIP entry size mismatch', { entry: name });
    if (crc32(out) !== entry.crc) fail('OOXML_INVALID_ZIP', 'ZIP entry CRC mismatch', { entry: name });
    this.metrics.inflated_bytes += out.length;
    if (this.metrics.inflated_bytes > this.limits.maxUncompressedBytes) fail('OOXML_LIMIT_EXCEEDED', 'Inflated byte budget exceeded');
    if (xml && out.length > this.limits.maxXmlBytes) fail('OOXML_LIMIT_EXCEEDED', 'XML entry exceeds size limit', { entry: name });
    return out;
  }
  xml(name) {
    const data = this.read(name, true);
    if (!data) return null;
    const text = data.toString('utf8');
    if (/<!DOCTYPE|<!ENTITY/i.test(text)) fail('OOXML_UNSUPPORTED', 'DTD and XML entities are unsupported', { entry: name });
    return text;
  }
}
function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let i = 0; i < 8; i += 1) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function decodeXml(value) {
  return String(value || '').replace(/&(?:#x([0-9a-f]+)|#([0-9]+)|amp|lt|gt|quot|apos);/gi, (m, hex, dec) => {
    if (hex) return String.fromCodePoint(parseInt(hex, 16));
    if (dec) return String.fromCodePoint(parseInt(dec, 10));
    return ({ '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'" })[m.toLowerCase()] || m;
  });
}
function localName(name) { return String(name || '').split(':').pop(); }
function attrs(text) {
  const out = {};
  const re = /([:\w.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  let match;
  while ((match = re.exec(text))) out[match[1]] = decodeXml(match[2] ?? match[3]);
  return out;
}
function xmlEvents(xml, options = {}) {
  const lim = options.limits || DEFAULT_LIMITS;
  const signal = options.signal;
  const events = [];
  const re = /<[^>]*>|[^<]+/g;
  let depth = 0;
  let chars = 0;
  let match;
  while ((match = re.exec(xml))) {
    checkAbort(signal);
    const token = match[0];
    if (token[0] !== '<') {
      const text = decodeXml(token);
      chars += text.length;
      if (chars > lim.maxTextChars) fail('OOXML_LIMIT_EXCEEDED', 'XML text exceeds character limit');
      if (text) events.push({ type: 'text', text, depth });
    } else if (/^<\?/.test(token) || /^<!--/.test(token)) {
      continue;
    } else if (/^<!/.test(token)) {
      fail('OOXML_UNSUPPORTED', 'Unsupported XML declaration');
    } else if (/^<\//.test(token)) {
      depth -= 1;
      if (depth < 0) fail('OOXML_MALFORMED_XML', 'Unbalanced XML closing tag');
      events.push({ type: 'end', name: localName(token.slice(2, -1).trim()), depth });
    } else {
      const self = /\/>$/.test(token);
      const body = token.slice(1, self ? -2 : -1).trim();
      const split = body.search(/\s/);
      const name = localName(split < 0 ? body : body.slice(0, split));
      events.push({ type: 'start', name, attrs: attrs(split < 0 ? '' : body.slice(split)), depth, self });
      if (!self) {
        depth += 1;
        if (depth > lim.maxXmlDepth) fail('OOXML_LIMIT_EXCEEDED', 'XML nesting depth exceeds limit');
      } else events.push({ type: 'end', name, depth });
    }
  }
  if (depth !== 0) fail('OOXML_MALFORMED_XML', 'Unclosed XML element');
  return events;
}
function attr(a, name) {
  return a[name] ?? a[`r:${name}`] ?? a[`w:${name}`] ?? a[`x:${name}`] ?? a[`xml:${name}`];
}
function rels(zip, part, options) {
  const slash = part.lastIndexOf('/');
  const relPath = `${part.slice(0, slash + 1)}_rels/${part.slice(slash + 1)}.rels`;
  const xml = zip.xml(relPath);
  if (!xml) return new Map();
  const map = new Map();
  try {
    for (const event of xmlEvents(xml, options)) if (event.type === 'start' && event.name === 'Relationship') {
      const id = attr(event.attrs, 'Id');
      const target = attr(event.attrs, 'Target');
      if (!id || !target) fail('OOXML_MALFORMED_RELATIONSHIP', 'Relationship is missing Id or Target', { part: relPath });
      map.set(id, { id, type: attr(event.attrs, 'Type') || '', target, external: attr(event.attrs, 'TargetMode') === 'External' });
    }
  } catch (error) {
    if (error.code) throw error;
    fail('OOXML_MALFORMED_RELATIONSHIP', 'Malformed relationship XML', { part: relPath });
  }
  return map;
}
function resolvePart(base, target) {
  if (/^[A-Za-z][A-Za-z0-9+.-]*:/.test(target)) return target;
  const stack = base.split('/'); stack.pop();
  for (const piece of String(target).replace(/\\/g, '/').split('/')) {
    if (!piece || piece === '.') continue;
    if (piece === '..') {
      if (!stack.length) fail('OOXML_PATH_TRAVERSAL', 'Relationship target escapes package');
      stack.pop();
    } else stack.push(piece);
  }
  return safePath(stack.join('/'));
}
function sourceHash(buffer) { return crypto.createHash('sha256').update(buffer).digest('hex'); }
function presence(value, unsupported = false, failed = false) {
  return failed ? 'extraction_failed' : unsupported ? 'unsupported' : value === undefined || value === null || value === '' ? 'missing' : 'present';
}
function makeBlock(ctx, item) {
  return createBlock({
    source_hash: ctx.hash, order: ctx.order++, kind: item.kind || 'paragraph',
    raw_text: item.text || '', raw_fields: item.raw_fields || {}, inferred: item.inferred || {},
    locator: item.locator, provenance: item.provenance || [item.locator],
    parse_method: ctx.parser, parse_quality: item.confidence ?? 1,
    status: item.status || presence(item.text), card_eligible: item.card_eligible !== false,
    exclusion_reason: item.exclusion_reason || '', metadata: item.metadata || {}
  });
}

function parseDocx(buffer, options = {}) {
  const lim = limits(options.limits);
  const zip = new SafeZip(buffer, { limits: lim, signal: options.signal });
  const content = zip.xml('[Content_Types].xml');
  if (!content || !zip.has('word/document.xml')) fail('OOXML_UNSUPPORTED', 'Package is not a supported DOCX');
  const ctx = { hash: sourceHash(buffer), order: 0, parser: 'docx-ooxml-local' };
  const warnings = [];
  if ([...zip.entries.keys()].some(name => /vbaProject\.bin$|\/embeddings\//i.test(name))) {
    warnings.push({ code: 'OOXML_PARTIAL_FEATURE_SUPPORT', feature: 'embedded-object-or-macro', status: 'unsupported' });
  }
  const styles = parseDocxStyles(zip, lim, options.signal);
  const numbering = parseNumbering(zip, lim, options.signal);
  const parts = [{ name: 'document', path: 'word/document.xml' }];
  for (const name of [...zip.entries.keys()].sort()) {
    if (/^word\/header\d*\.xml$/i.test(name)) parts.push({ name: 'header', path: name });
    if (/^word\/footer\d*\.xml$/i.test(name)) parts.push({ name: 'footer', path: name });
  }
  for (const [kind, path] of [['footnote', 'word/footnotes.xml'], ['endnote', 'word/endnotes.xml'], ['comment', 'word/comments.xml']]) {
    if (zip.has(path)) parts.push({ name: kind, path });
  }
  const blocks = [];
  const metadata = { language: styles.language || 'unknown', parts: parts.map(p => p.path), warnings };
  for (const part of parts) blocks.push(...parseDocxPart(zip, part, ctx, styles, numbering, lim, options.signal, warnings));
  const textBlocks = blocks.filter(b => b.card_eligible && b.raw?.text);
  const markdown = blocksToMarkdown(textBlocks);
  return finalize('docx', ctx, zip, blocks, markdown, metadata);
}
function parseDocxStyles(zip, lim, signal) {
  const xml = zip.xml('word/styles.xml');
  const out = { map: new Map(), language: '' };
  if (!xml) return out;
  let style = null;
  for (const e of xmlEvents(xml, { limits: lim, signal })) {
    if (e.type === 'start' && e.name === 'style') style = { id: attr(e.attrs, 'styleId') || '', name: '', outline: null, basedOn: '' };
    else if (style && e.type === 'start' && e.name === 'name') style.name = attr(e.attrs, 'val') || '';
    else if (style && e.type === 'start' && e.name === 'outlineLvl') style.outline = Number(attr(e.attrs, 'val'));
    else if (style && e.type === 'start' && e.name === 'basedOn') style.basedOn = attr(e.attrs, 'val') || '';
    else if (e.type === 'start' && e.name === 'lang' && !out.language) out.language = attr(e.attrs, 'val') || '';
    else if (style && e.type === 'end' && e.name === 'style') { out.map.set(style.id, style); style = null; }
  }
  return out;
}
function parseNumbering(zip, lim, signal) {
  const xml = zip.xml('word/numbering.xml');
  const abstracts = new Map(), nums = new Map();
  if (!xml) return { abstracts, nums };
  let abstract = null, level = null, num = null;
  for (const e of xmlEvents(xml, { limits: lim, signal })) {
    if (e.type === 'start' && e.name === 'abstractNum') abstract = { id: attr(e.attrs, 'abstractNumId'), levels: new Map() };
    else if (abstract && e.type === 'start' && e.name === 'lvl') level = { ilvl: Number(attr(e.attrs, 'ilvl') || 0), format: '', text: '' };
    else if (level && e.type === 'start' && e.name === 'numFmt') level.format = attr(e.attrs, 'val') || '';
    else if (level && e.type === 'start' && e.name === 'lvlText') level.text = attr(e.attrs, 'val') || '';
    else if (level && e.type === 'end' && e.name === 'lvl') { abstract.levels.set(level.ilvl, level); level = null; }
    else if (abstract && e.type === 'end' && e.name === 'abstractNum') { abstracts.set(abstract.id, abstract); abstract = null; }
    else if (e.type === 'start' && e.name === 'num') num = { id: attr(e.attrs, 'numId'), abstractId: '' };
    else if (num && e.type === 'start' && e.name === 'abstractNumId') num.abstractId = attr(e.attrs, 'val') || '';
    else if (num && e.type === 'end' && e.name === 'num') { nums.set(num.id, num); num = null; }
  }
  return { abstracts, nums };
}
function parseDocxPart(zip, part, ctx, styles, numbering, lim, signal, warnings) {
  const xml = zip.xml(part.path);
  if (!xml) return [];
  const rs = rels(zip, part.path, { limits: lim, signal });
  const out = [];
  let paragraph = null, table = null, row = null, cell = null;
  let hyperlink = null, textTarget = null, sectionIndex = 0, paraIndex = 0, tableIndex = 0;
  const stack = [];
  for (const e of xmlEvents(xml, { limits: lim, signal })) {
    if (e.type === 'start') {
      stack.push(e.name);
      if (e.name === 'p') paragraph = { text: '', style: '', outline: null, numId: '', level: 0, refs: [], breaks: [], hyperlinks: [], images: [] };
      else if (paragraph && e.name === 'pStyle') paragraph.style = attr(e.attrs, 'val') || '';
      else if (paragraph && e.name === 'outlineLvl') paragraph.outline = Number(attr(e.attrs, 'val'));
      else if (paragraph && e.name === 'numId') paragraph.numId = attr(e.attrs, 'val') || '';
      else if (paragraph && e.name === 'ilvl') paragraph.level = Number(attr(e.attrs, 'val') || 0);
      else if (paragraph && e.name === 'br') paragraph.breaks.push(attr(e.attrs, 'type') || 'line');
      else if (paragraph && ['footnoteReference', 'endnoteReference', 'commentReference'].includes(e.name)) paragraph.refs.push({ kind: e.name, id: attr(e.attrs, 'id') });
      else if (paragraph && e.name === 'hyperlink') {
        const id = attr(e.attrs, 'id'); const rel = rs.get(id);
        hyperlink = { id, target: rel ? (rel.external ? rel.target : resolvePart(part.path, rel.target)) : '', text: '' };
      } else if (paragraph && ['blip', 'imagedata'].includes(e.name)) {
        const id = attr(e.attrs, 'embed') || attr(e.attrs, 'id'); const rel = rs.get(id);
        paragraph.images.push({ relationship_id: id || '', target: rel ? (rel.external ? rel.target : resolvePart(part.path, rel.target)) : '', anchor: 'paragraph' });
      } else if (e.name === 't' || e.name === 'instrText') textTarget = e.name;
      else if (e.name === 'tbl') table = { index: ++tableIndex, rows: [] };
      else if (table && e.name === 'tr') row = { index: table.rows.length + 1, cells: [] };
      else if (row && e.name === 'tc') cell = { index: row.cells.length + 1, text: '', gridSpan: 1, vMerge: '' };
      else if (cell && e.name === 'gridSpan') cell.gridSpan = Number(attr(e.attrs, 'val') || 1);
      else if (cell && e.name === 'vMerge') cell.vMerge = attr(e.attrs, 'val') || 'continue';
      else if (e.name === 'sectPr') sectionIndex += 1;
    } else if (e.type === 'text' && textTarget) {
      if (cell) cell.text += e.text;
      if (paragraph) paragraph.text += e.text;
      if (hyperlink) hyperlink.text += e.text;
    } else if (e.type === 'end') {
      if (e.name === 't' || e.name === 'instrText') textTarget = null;
      else if (e.name === 'hyperlink' && hyperlink) { paragraph.hyperlinks.push(hyperlink); hyperlink = null; }
      else if (e.name === 'tc' && cell) { row.cells.push(cell); cell = null; }
      else if (e.name === 'tr' && row) {
        table.rows.push(row);
        for (const c of row.cells) out.push(makeBlock(ctx, {
          kind: 'table_cell', text: c.text.trim(),
          locator: { scheme: 'ooxml', value: `${part.path}#table=${table.index}/row=${row.index}/cell=${c.index}` },
          metadata: { part: part.name, table: table.index, row: row.index, cell: c.index,
            merge: { grid_span: c.gridSpan, vertical: c.vMerge || 'none' } }
        }));
        row = null;
      } else if (e.name === 'tbl') table = null;
      else if (e.name === 'p' && paragraph) {
        paraIndex += 1;
        const style = styles.map.get(paragraph.style);
        let heading = paragraph.outline;
        let headingInference = {};
        if (!Number.isFinite(heading) && style && Number.isFinite(style.outline)) heading = style.outline;
        if (!Number.isFinite(heading) && /^(heading|标题)\s*[1-9]/i.test(style?.name || paragraph.style)) {
          const match = String(style?.name || paragraph.style).match(/[1-9]/);
          heading = Number(match?.[0] || 1) - 1;
          headingInference = { heading: { value: true, confidence: 0.88, basis: 'style-name' } };
        }
        const num = numbering.nums.get(paragraph.numId);
        const level = numbering.abstracts.get(num?.abstractId)?.levels.get(paragraph.level);
        const isList = Boolean(paragraph.numId);
        const locator = { scheme: 'ooxml', value: `${part.path}#section=${sectionIndex || 1}/p=${paraIndex}` };
        if (!cell) out.push(makeBlock(ctx, {
          kind: Number.isFinite(heading) ? 'heading' : isList ? 'list_item' : part.name,
          text: paragraph.text.trim(), locator, inferred: headingInference,
          metadata: {
            part: part.name, paragraph: paraIndex, section: sectionIndex || 1,
            style: paragraph.style || '', outline_level: Number.isFinite(heading) ? heading : null,
            list: isList ? { num_id: paragraph.numId, level: paragraph.level, format: level?.format || '', template: level?.text || '' } : null,
            hyperlinks: paragraph.hyperlinks, references: paragraph.refs, images: paragraph.images,
            breaks: paragraph.breaks, language: styles.language || 'unknown',
            raw_vs_inferred: { heading: Object.keys(headingInference).length ? 'inferred' : Number.isFinite(heading) ? 'raw' : 'missing' }
          }
        }));
        paragraph = null;
      }
      if (stack.length) stack.pop();
    }
  }
  return out;
}

function parseXlsx(buffer, options = {}) {
  const lim = limits(options.limits);
  const zip = new SafeZip(buffer, { limits: lim, signal: options.signal });
  if (!zip.has('xl/workbook.xml')) fail('OOXML_UNSUPPORTED', 'Package is not a supported XLSX');
  const ctx = { hash: sourceHash(buffer), order: 0, parser: 'xlsx-ooxml-local' };
  const shared = parseSharedStrings(zip, lim, options.signal);
  const styles = parseXlsxStyles(zip, lim, options.signal);
  const wbRels = rels(zip, 'xl/workbook.xml', { limits: lim, signal: options.signal });
  const workbook = [];
  for (const e of xmlEvents(zip.xml('xl/workbook.xml'), { limits: lim, signal: options.signal })) {
    if (e.type === 'start' && e.name === 'sheet') {
      const rel = wbRels.get(attr(e.attrs, 'id'));
      if (!rel) fail('OOXML_MALFORMED_RELATIONSHIP', 'Worksheet relationship is missing');
      workbook.push({ name: attr(e.attrs, 'name') || '', id: attr(e.attrs, 'sheetId') || '', state: attr(e.attrs, 'state') || 'visible', path: resolvePart('xl/workbook.xml', rel.target) });
    }
  }
  const blocks = [], sheets = [];
  for (let i = 0; i < workbook.length; i += 1) {
    const sheet = workbook[i];
    const parsed = parseSheet(zip, sheet, i + 1, ctx, shared, styles, lim, options.signal);
    blocks.push(...parsed.blocks);
    sheets.push(parsed.metadata);
  }
  const markdown = blocksToMarkdown(blocks.filter(b => b.card_eligible && b.raw?.text));
  return finalize('xlsx', ctx, zip, blocks, markdown, { sheets, shared_strings: shared.length });
}

function parsePptx(buffer, options = {}) {
  const lim = limits(options.limits);
  const zip = new SafeZip(buffer, { limits: lim, signal: options.signal });
  if (!zip.has('ppt/presentation.xml')) fail('OOXML_UNSUPPORTED', 'Package is not a supported PPTX');
  const ctx = { hash: sourceHash(buffer), order: 0, parser: 'pptx-ooxml-local' };
  const presentationRels = rels(zip, 'ppt/presentation.xml', { limits: lim, signal: options.signal });
  const slides = [];
  let size = {};
  for (const e of xmlEvents(zip.xml('ppt/presentation.xml'), { limits: lim, signal: options.signal })) {
    if (e.type === 'start' && e.name === 'sldSz') {
      size = { width_emu: Number(attr(e.attrs, 'cx') || 0), height_emu: Number(attr(e.attrs, 'cy') || 0), type: attr(e.attrs, 'type') || '' };
    } else if (e.type === 'start' && e.name === 'sldId') {
      const relationshipId = e.attrs['r:id'] || e.attrs['relationships:id'] || '';
      const relationship = presentationRels.get(relationshipId);
      if (!relationship) fail('OOXML_MALFORMED_RELATIONSHIP', 'Slide relationship is missing', { relationship_id: relationshipId || '' });
      const path = resolvePart('ppt/presentation.xml', relationship.target);
      if (!/^ppt\/slides\/slide[^/]*\.xml$/i.test(path) || !zip.has(path)) {
        fail('OOXML_MALFORMED_RELATIONSHIP', 'Slide relationship target is invalid', { relationship_id: relationshipId || '', target: path });
      }
      slides.push({ id: attr(e.attrs, 'id') || '', relationship_id: relationshipId || '', path });
    }
  }
  const blocks = [], slideMetadata = [], warnings = [];
  if ([...zip.entries.keys()].some(name => /vbaProject\.bin$|\/embeddings\//i.test(name))) {
    warnings.push({ code: 'OOXML_PARTIAL_FEATURE_SUPPORT', feature: 'embedded-object-or-macro', status: 'unsupported' });
  }
  for (let i = 0; i < slides.length; i += 1) {
    const parsed = parseSlide(zip, slides[i], i + 1, ctx, lim, options.signal);
    blocks.push(...parsed.blocks);
    slideMetadata.push(parsed.metadata);
  }
  const markdown = blocksToMarkdown(blocks.filter(block => block.card_eligible && block.raw?.text));
  return finalize('pptx', ctx, zip, blocks, markdown, { slides: slideMetadata, slide_size: size, warnings });
}

function parseSlide(zip, slide, index, ctx, lim, signal) {
  const xml = zip.xml(slide.path);
  if (!xml) fail('OOXML_MALFORMED_RELATIONSHIP', 'Slide part is missing', { slide: index });
  const rs = rels(zip, slide.path, { limits: lim, signal });
  const blocks = [], images = [], charts = [], hyperlinks = [];
  let shape = null, paragraph = null, table = null, row = null, cell = null, captureText = false;
  let shapeIndex = 0, paragraphIndex = 0, tableIndex = 0, hidden = false, transition = '', hasTiming = false;
  for (const e of xmlEvents(xml, { limits: lim, signal })) {
    if (e.type === 'start' && e.name === 'sld') hidden = attr(e.attrs, 'show') === '0';
    else if (e.type === 'start' && e.name === 'transition') transition = attr(e.attrs, 'spd') || 'present';
    else if (e.type === 'start' && e.name === 'timing') hasTiming = true;
    else if (e.type === 'start' && ['sp', 'pic', 'graphicFrame', 'cxnSp'].includes(e.name) && !shape) {
      shape = { index: ++shapeIndex, kind: e.name, name: '', description: '', placeholder: '', x: null, y: null, cx: null, cy: null };
    } else if (shape && e.type === 'start' && e.name === 'cNvPr') {
      shape.name = attr(e.attrs, 'name') || '';
      shape.description = attr(e.attrs, 'descr') || attr(e.attrs, 'title') || '';
    } else if (shape && e.type === 'start' && e.name === 'ph') shape.placeholder = attr(e.attrs, 'type') || 'body';
    else if (shape && e.type === 'start' && e.name === 'off') {
      shape.x = numberOrNull(attr(e.attrs, 'x')); shape.y = numberOrNull(attr(e.attrs, 'y'));
    } else if (shape && e.type === 'start' && e.name === 'ext') {
      shape.cx = numberOrNull(attr(e.attrs, 'cx')); shape.cy = numberOrNull(attr(e.attrs, 'cy'));
    } else if (shape && e.type === 'start' && e.name === 'p') {
      paragraph = { text: '', level: Number(attr(e.attrs, 'lvl') || 0), bullets: false, hyperlinks: [] };
    } else if (paragraph && e.type === 'start' && e.name === 'pPr') {
      paragraph.level = Number(attr(e.attrs, 'lvl') || paragraph.level || 0);
    } else if (paragraph && e.type === 'start' && ['buChar', 'buAutoNum'].includes(e.name)) paragraph.bullets = true;
    else if (paragraph && e.type === 'start' && e.name === 'hlinkClick') {
      const id = attr(e.attrs, 'id'); const relationship = rs.get(id);
      const link = { relationship_id: id || '', target: relationship ? (relationship.external ? relationship.target : resolvePart(slide.path, relationship.target)) : '', external: relationship?.external === true };
      paragraph.hyperlinks.push(link); hyperlinks.push(link);
    } else if (e.type === 'start' && e.name === 'tbl') table = { index: ++tableIndex, rows: 0 };
    else if (table && e.type === 'start' && e.name === 'tr') row = { index: ++table.rows, cells: [] };
    else if (row && e.type === 'start' && e.name === 'tc') cell = {
      index: row.cells.length + 1, text: '', row_span: Number(attr(e.attrs, 'rowSpan') || 1),
      grid_span: Number(attr(e.attrs, 'gridSpan') || 1), h_merge: attr(e.attrs, 'hMerge') === '1', v_merge: attr(e.attrs, 'vMerge') === '1'
    };
    else if (cell && e.type === 'start' && e.name === 'tcPr') {
      if (attr(e.attrs, 'rowSpan') !== undefined) cell.row_span = Number(attr(e.attrs, 'rowSpan') || 1);
      if (attr(e.attrs, 'gridSpan') !== undefined) cell.grid_span = Number(attr(e.attrs, 'gridSpan') || 1);
      if (attr(e.attrs, 'hMerge') !== undefined) cell.h_merge = attr(e.attrs, 'hMerge') === '1';
      if (attr(e.attrs, 'vMerge') !== undefined) cell.v_merge = attr(e.attrs, 'vMerge') === '1';
    } else if (e.type === 'start' && ['t', 'fld'].includes(e.name)) captureText = true;
    else if (shape && e.type === 'start' && ['blip', 'imagedata'].includes(e.name)) {
      const id = attr(e.attrs, 'embed') || attr(e.attrs, 'id'); const relationship = rs.get(id);
      images.push({ relationship_id: id || '', target: relationship ? (relationship.external ? relationship.target : resolvePart(slide.path, relationship.target)) : '', external: relationship?.external === true, shape: shape.index, name: shape.name, description: shape.description });
    } else if (shape && e.type === 'start' && e.name === 'chart') {
      const id = attr(e.attrs, 'id'); const relationship = rs.get(id);
      charts.push({ relationship_id: id || '', target: relationship ? resolvePart(slide.path, relationship.target) : '', shape: shape.index, name: shape.name });
    } else if (e.type === 'text' && captureText) {
      if (cell) cell.text += e.text;
      if (paragraph) paragraph.text += e.text;
    } else if (e.type === 'end' && ['t', 'fld'].includes(e.name)) captureText = false;
    else if (e.type === 'end' && e.name === 'tc' && cell) {
      row.cells.push(cell); cell = null;
    } else if (e.type === 'end' && e.name === 'tr' && row) {
      for (const current of row.cells) blocks.push(makeBlock(ctx, {
        kind: 'table_cell', text: current.text.trim(),
        locator: { scheme: 'ooxml', value: `${slide.path}#slide=${index}/table=${table.index}/row=${row.index}/cell=${current.index}` },
        metadata: { slide: index, slide_id: slide.id, table: table.index, row: row.index, column: current.index,
          merge: { row_span: current.row_span, grid_span: current.grid_span, horizontal_continuation: current.h_merge, vertical_continuation: current.v_merge },
          shape: shapeMetadata(shape), hidden }
      }));
      row = null;
    } else if (e.type === 'end' && e.name === 'p' && paragraph && shape) {
      paragraphIndex += 1;
      const text = paragraph.text.trim();
      if (text && !table) blocks.push(makeBlock(ctx, {
        kind: isTitleShape(shape) ? 'heading' : paragraph.bullets ? 'list_item' : 'paragraph', text,
        locator: { scheme: 'ooxml', value: `${slide.path}#slide=${index}/shape=${shape.index}/p=${paragraphIndex}` },
        inferred: isTitleShape(shape) ? { outline_level: 0 } : {},
        metadata: { slide: index, slide_id: slide.id, paragraph: paragraphIndex, level: paragraph.level,
          list: paragraph.bullets ? { level: paragraph.level, format: 'presentation-bullet' } : null,
          hyperlinks: paragraph.hyperlinks, shape: shapeMetadata(shape), hidden,
          raw_vs_inferred: { heading: isTitleShape(shape) ? 'inferred-from-placeholder' : 'not_applicable' } }
      }));
      paragraph = null;
    } else if (e.type === 'end' && e.name === 'tbl') table = null;
    else if (shape && e.type === 'end' && e.name === shape.kind) shape = null;
  }
  const note = parseSlideNotes(zip, slide, index, ctx, lim, signal);
  blocks.push(...note.blocks);
  for (const image of images) blocks.push(makeBlock(ctx, {
    kind: 'image_metadata', text: image.description || '', card_eligible: false, exclusion_reason: 'non-card metadata',
    locator: { scheme: 'ooxml', value: `${slide.path}#slide=${index}/image=${image.shape}` }, metadata: Object.assign({ slide: index }, image)
  }));
  for (const chart of charts) blocks.push(makeBlock(ctx, {
    kind: 'chart_metadata', text: '', card_eligible: false, exclusion_reason: 'non-card metadata',
    locator: { scheme: 'ooxml', value: `${slide.path}#slide=${index}/chart=${chart.shape}` }, metadata: Object.assign({ slide: index }, chart)
  }));
  return { blocks, metadata: { index, id: slide.id, path: slide.path, hidden, transition, has_timing: hasTiming,
    images, charts, hyperlinks, notes_part: note.part, notes_blocks: note.blocks.length } };
}

function parseSlideNotes(zip, slide, index, ctx, lim, signal) {
  const relationship = [...rels(zip, slide.path, { limits: lim, signal }).values()]
    .find(item => /\/notesSlide$/i.test(item.type) || /notesSlides\/notesSlide[^/]*\.xml$/i.test(item.target));
  if (!relationship) return { blocks: [], part: '' };
  const part = resolvePart(slide.path, relationship.target);
  const xml = zip.xml(part);
  if (!xml) return { blocks: [], part };
  const blocks = []; let paragraph = '', captureText = false, paragraphIndex = 0, placeholder = '', inShape = false;
  for (const e of xmlEvents(xml, { limits: lim, signal })) {
    if (e.type === 'start' && e.name === 'sp') { inShape = true; placeholder = ''; }
    else if (inShape && e.type === 'start' && e.name === 'ph') placeholder = attr(e.attrs, 'type') || '';
    else if (e.type === 'start' && e.name === 'p') paragraph = '';
    else if (e.type === 'start' && ['t', 'fld'].includes(e.name)) captureText = true;
    else if (e.type === 'text' && captureText) paragraph += e.text;
    else if (e.type === 'end' && ['t', 'fld'].includes(e.name)) captureText = false;
    else if (e.type === 'end' && e.name === 'p') {
      paragraphIndex += 1;
      const text = paragraph.trim();
      if (text && !['sldNum', 'hdr', 'ftr', 'dt'].includes(placeholder)) blocks.push(makeBlock(ctx, {
        kind: 'speaker_note', text,
        locator: { scheme: 'ooxml', value: `${part}#slide=${index}/p=${paragraphIndex}` },
        metadata: { slide: index, notes_part: part, placeholder }
      }));
      paragraph = '';
    } else if (e.type === 'end' && e.name === 'sp') { inShape = false; placeholder = ''; }
  }
  return { blocks, part };
}
function isTitleShape(shape) { return ['title', 'ctrTitle'].includes(shape?.placeholder); }
function numberOrNull(value) { const number = Number(value); return Number.isFinite(number) ? number : null; }
function shapeMetadata(shape) {
  return { index: shape?.index || 0, kind: shape?.kind || '', name: shape?.name || '', description: shape?.description || '',
    placeholder: shape?.placeholder || '', bounds_emu: { x: shape?.x, y: shape?.y, width: shape?.cx, height: shape?.cy } };
}
function parseSharedStrings(zip, lim, signal) {
  const xml = zip.xml('xl/sharedStrings.xml');
  if (!xml) return [];
  const out = []; let current = null, inText = false;
  for (const e of xmlEvents(xml, { limits: lim, signal })) {
    if (e.type === 'start' && e.name === 'si') current = '';
    else if (current !== null && e.type === 'start' && e.name === 't') inText = true;
    else if (current !== null && e.type === 'text' && inText) current += e.text;
    else if (e.type === 'end' && e.name === 't') inText = false;
    else if (e.type === 'end' && e.name === 'si') { out.push(current); current = null; }
  }
  return out;
}
function parseXlsxStyles(zip, lim, signal) {
  const xml = zip.xml('xl/styles.xml');
  const numFmts = new Map(), xfs = []; let inXfs = false;
  if (!xml) return { numFmts, xfs };
  for (const e of xmlEvents(xml, { limits: lim, signal })) {
    if (e.type === 'start' && e.name === 'numFmt') numFmts.set(Number(attr(e.attrs, 'numFmtId')), attr(e.attrs, 'formatCode') || '');
    else if (e.type === 'start' && e.name === 'cellXfs') inXfs = true;
    else if (inXfs && e.type === 'start' && e.name === 'xf') xfs.push({ numFmtId: Number(attr(e.attrs, 'numFmtId') || 0) });
    else if (e.type === 'end' && e.name === 'cellXfs') inXfs = false;
  }
  return { numFmts, xfs };
}
function parseSheet(zip, sheet, index, ctx, shared, styles, lim, signal) {
  const xml = zip.xml(sheet.path);
  if (!xml) fail('OOXML_MALFORMED_RELATIONSHIP', 'Worksheet part is missing', { sheet: sheet.name });
  const rs = rels(zip, sheet.path, { limits: lim, signal });
  const blocks = [], cells = new Map(), merges = [], hiddenRows = [], hiddenCols = [], drawings = [], filters = [], tables = [];
  let row = 0, rowHidden = false, cell = null, capture = '', dimension = '';
  for (const e of xmlEvents(xml, { limits: lim, signal })) {
    if (e.type === 'start' && e.name === 'dimension') dimension = attr(e.attrs, 'ref') || '';
    else if (e.type === 'start' && e.name === 'row') { row = Number(attr(e.attrs, 'r') || row + 1); rowHidden = attr(e.attrs, 'hidden') === '1'; if (rowHidden) hiddenRows.push(row); }
    else if (e.type === 'start' && e.name === 'col' && attr(e.attrs, 'hidden') === '1') hiddenCols.push({ min: Number(attr(e.attrs, 'min')), max: Number(attr(e.attrs, 'max')) });
    else if (e.type === 'start' && e.name === 'c') cell = { ref: attr(e.attrs, 'r') || '', type: attr(e.attrs, 't') || 'n', style: Number(attr(e.attrs, 's') || 0), value: '', formula: '', inline: '', rowHidden };
    else if (cell && e.type === 'start' && ['v', 'f', 't'].includes(e.name)) capture = e.name;
    else if (cell && e.type === 'text' && capture) cell[capture === 'f' ? 'formula' : capture === 't' ? 'inline' : 'value'] += e.text;
    else if (e.type === 'end' && ['v', 'f', 't'].includes(e.name)) capture = '';
    else if (e.type === 'end' && e.name === 'c' && cell) {
      const typed = cellValue(cell, shared, styles);
      const locator = { scheme: 'ooxml', value: `${sheet.path}#sheet=${index}/cell=${cell.ref}` };
      const block = makeBlock(ctx, {
        kind: 'spreadsheet_cell', text: typed.text, locator,
        status: presence(typed.text), metadata: {
          sheet: sheet.name, sheet_index: index, sheet_visibility: sheet.state, coordinate: cell.ref,
          row: coordinate(cell.ref).row, column: coordinate(cell.ref).column, row_hidden: cell.rowHidden,
          column_hidden: hiddenCols.some(item => coordinate(cell.ref).column &&
            columnNumber(coordinate(cell.ref).column) >= item.min && columnNumber(coordinate(cell.ref).column) <= item.max),
          cell_type: typed.type, raw_value: cell.value, formula: cell.formula || '', cached_value: cell.value || '',
          cached_value_status: cell.formula ? presence(cell.value) : 'not_applicable',
          number_format: typed.format, date_serial: typed.dateSerial, merge: null
        }
      });
      blocks.push(block); cells.set(cell.ref, block); cell = null;
    } else if (e.type === 'start' && e.name === 'mergeCell') merges.push(attr(e.attrs, 'ref') || '');
    else if (e.type === 'start' && e.name === 'autoFilter') filters.push(attr(e.attrs, 'ref') || '');
    else if (e.type === 'start' && e.name === 'tablePart') {
      const rel = rs.get(attr(e.attrs, 'id')); if (rel) tables.push(resolvePart(sheet.path, rel.target));
    } else if (e.type === 'start' && e.name === 'drawing') {
      const rel = rs.get(attr(e.attrs, 'id')); if (rel) drawings.push(...parseDrawing(zip, resolvePart(sheet.path, rel.target), sheet, signal, lim));
    }
  }
  for (const range of merges) applyMerge(range, cells, blocks, sheet, index, ctx);
  inferRowIdentities(blocks);
  for (const image of drawings) blocks.push(makeBlock(ctx, {
    kind: 'image_metadata', text: '', card_eligible: false, exclusion_reason: 'non-card metadata',
    locator: { scheme: 'ooxml', value: `${image.part}#anchor=${image.anchor}` }, metadata: image
  }));
  return { blocks, metadata: { name: sheet.name, index, visibility: sheet.state, used_range: dimension, merges, hidden_rows: hiddenRows, hidden_columns: hiddenCols, autofilters: filters, tables, drawings } };
}
function cellValue(cell, shared, styles) {
  const raw = cell.type === 'inlineStr' ? cell.inline : cell.value;
  const style = styles.xfs[cell.style];
  const format = styles.numFmts.get(style?.numFmtId) || builtinFormat(style?.numFmtId);
  if (cell.type === 's') {
    const index = Number(raw);
    if (!Number.isInteger(index) || index < 0 || index >= shared.length) fail('OOXML_MALFORMED_XML', 'Shared string index is invalid', { cell: cell.ref });
    return { text: shared[index], type: 'shared_string', format };
  }
  if (cell.type === 'inlineStr' || cell.type === 'str') return { text: raw, type: cell.type === 'str' ? 'formula_string_cache' : 'inline_string', format };
  if (cell.type === 'b') return { text: raw === '1' ? 'TRUE' : 'FALSE', type: 'boolean', format };
  if (cell.type === 'e') return { text: raw, type: 'error', format };
  const date = isDateFormat(format);
  return { text: raw, type: date ? 'date_serial' : 'number', format, dateSerial: date && raw !== '' ? Number(raw) : undefined };
}
function builtinFormat(id) {
  if ([14, 15, 16, 17, 22].includes(id)) return 'builtin-date';
  return '';
}
function isDateFormat(format) { return format === 'builtin-date' || /(^|[^\\])[ymdhis]/i.test(String(format || '').replace(/"[^"]*"/g, '')); }
function coordinate(ref) {
  const m = /^([A-Z]+)(\d+)$/i.exec(ref) || [];
  return { column: (m[1] || '').toUpperCase(), row: Number(m[2] || 0) };
}
function columnNumber(value) { return [...String(value || '').toUpperCase()].reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0); }
function inferRowIdentities(blocks) {
  const rows = new Map();
  for (const block of blocks) {
    if (block.kind !== 'spreadsheet_cell') continue;
    const row = Number(block.metadata?.row || 0);
    if (!rows.has(row)) rows.set(row, []);
    rows.get(row).push(block);
  }
  const candidates = [];
  for (const [row, rowBlocks] of rows) {
    const first = rowBlocks.filter(b => b.raw?.text && !b.metadata?.row_hidden)
      .sort((a, b) => columnNumber(a.metadata.column) - columnNumber(b.metadata.column))[0];
    if (first && first.metadata.cell_type !== 'number' && !first.metadata.formula) candidates.push({ row, first, value: first.raw.text.trim() });
  }
  const counts = new Map();
  for (const item of candidates) counts.set(item.value, (counts.get(item.value) || 0) + 1);
  for (const item of candidates) {
    if (!item.value || counts.get(item.value) !== 1) continue;
    for (const block of rows.get(item.row)) block.metadata.row_identity = {
      value: item.value, source_coordinate: item.first.metadata.coordinate,
      raw_or_inferred: 'inferred', confidence: 0.82, basis: 'unique-leftmost-nonempty-text'
    };
  }
}
function expandRange(range) {
  const [a, b = a] = String(range).split(':'); const ca = coordinate(a), cb = coordinate(b);
  const colNum = s => [...s].reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0);
  const colName = n => { let s = ''; while (n) { n -= 1; s = String.fromCharCode(65 + n % 26) + s; n = Math.floor(n / 26); } return s; };
  const out = [];
  for (let r = ca.row; r <= cb.row; r += 1) for (let c = colNum(ca.column); c <= colNum(cb.column); c += 1) out.push(`${colName(c)}${r}`);
  return out;
}
function applyMerge(range, cells, blocks, sheet, index, ctx) {
  const refs = expandRange(range); const anchorRef = refs[0]; const anchor = cells.get(anchorRef);
  for (const ref of refs) {
    let block = cells.get(ref);
    if (!block) {
      block = makeBlock(ctx, {
        kind: 'spreadsheet_cell', text: '', status: 'missing',
        locator: { scheme: 'ooxml', value: `${sheet.path}#sheet=${index}/cell=${ref}` },
        metadata: { sheet: sheet.name, sheet_index: index, coordinate: ref, row: coordinate(ref).row, column: coordinate(ref).column }
      });
      blocks.push(block); cells.set(ref, block);
    }
    block.metadata.merge = { range, anchor: anchorRef, role: ref === anchorRef ? 'anchor' : 'inherited' };
    block.metadata.inherited_header = ref === anchorRef ? '' : (anchor?.raw?.text || '');
  }
}
function parseDrawing(zip, part, sheet, signal, lim) {
  const xml = zip.xml(part); if (!xml) return [];
  const rs = rels(zip, part, { limits: lim, signal });
  const out = []; let anchor = null, point = null, embed = '';
  for (const e of xmlEvents(xml, { limits: lim, signal })) {
    if (e.type === 'start' && ['twoCellAnchor', 'oneCellAnchor', 'absoluteAnchor'].includes(e.name)) anchor = { kind: e.name, from: {}, to: {}, part, sheet: sheet.name };
    else if (anchor && e.type === 'start' && ['from', 'to'].includes(e.name)) point = e.name;
    else if (anchor && e.type === 'start' && e.name === 'blip') embed = attr(e.attrs, 'embed') || '';
    else if (anchor && point && e.type === 'start' && ['col', 'row', 'colOff', 'rowOff'].includes(e.name)) anchor.capture = e.name;
    else if (anchor && point && e.type === 'text' && anchor.capture) anchor[point][anchor.capture] = Number(e.text);
    else if (e.type === 'end' && ['col', 'row', 'colOff', 'rowOff'].includes(e.name) && anchor) anchor.capture = '';
    else if (e.type === 'end' && ['from', 'to'].includes(e.name)) point = null;
    else if (anchor && e.type === 'end' && ['twoCellAnchor', 'oneCellAnchor', 'absoluteAnchor'].includes(e.name)) {
      const rel = rs.get(embed);
      out.push(Object.assign(anchor, { relationship_id: embed, target: rel ? (rel.external ? rel.target : resolvePart(part, rel.target)) : '', anchor: JSON.stringify({ from: anchor.from, to: anchor.to }) }));
      anchor = null; embed = '';
    }
  }
  return out;
}
function finalize(type, ctx, zip, blocks, markdown, metadata) {
  const eligible = blocks.filter(b => b.card_eligible && b.raw?.text);
  const locators = blocks.filter(b => b.locator?.value).length;
  const status = eligible.length ? 'ok' : 'review_required';
  return {
    status, code: status === 'review_required' ? 'OOXML_NO_ELIGIBLE_CONTENT' : '',
    text: markdown, sourceType: type, sourceEncoding: 'ooxml-local', sourceLanguage: metadata.language || 'unknown',
    extractor: `${type}-ooxml-local`, blocks, metadata: Object.assign(metadata, {
      ooxml_metrics: Object.assign({}, zip.metrics, {
        block_count: blocks.length, eligible_blocks: eligible.length,
        locator_coverage: blocks.length ? locators / blocks.length : 1
      })
    }),
    message: status === 'review_required' ? 'OOXML 文件有效，但没有可进入卡片生成的内容。' : ''
  };
}
function parseOoxml(buffer, type, options = {}) {
  try {
    return type === 'docx' ? parseDocx(buffer, options) : type === 'xlsx' ? parseXlsx(buffer, options) : type === 'pptx' ? parsePptx(buffer, options) :
      fail('OOXML_UNSUPPORTED', 'Unsupported OOXML document type');
  } catch (error) {
    if (!(error instanceof OoxmlError)) return { status: 'failed', code: 'OOXML_EXTRACTION_FAILED', message: String(error.message || error) };
    const status = error.code === 'OOXML_ABORTED' ? 'cancelled' :
      error.code === 'OOXML_UNSUPPORTED' || error.code === 'OOXML_ENCRYPTED' ? 'unsupported' :
      error.code === 'OOXML_LIMIT_EXCEEDED' ? 'limits_exceeded' : 'failed';
    return { status, code: error.code, message: error.message, details: error.details };
  }
}

module.exports = { DEFAULT_LIMITS, OoxmlError, SafeZip, parseDocx, parseXlsx, parsePptx, parseOoxml, xmlEvents };
