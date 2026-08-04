// @ts-nocheck -- Adapter inputs are validated at the v3 contract boundary.
'use strict';

const zlib = require('zlib');
const { attempt, buildParseResult } = require('./contracts');

const LOCAL_EXTENSIONS = Object.freeze(['txt', 'md', 'docx', 'xlsx', 'pptx', 'msg', 'eml']);
const decodeXml = (value) => String(value || '').replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<')
  .replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/\s+/g, ' ').trim();

function zipEntries(buffer) {
  const entries = new Map();
  let offset = 0;
  while (offset + 30 <= buffer.length && buffer.readUInt32LE(offset) === 0x04034b50) {
    const flags = buffer.readUInt16LE(offset + 6); const method = buffer.readUInt16LE(offset + 8);
    const compressed = buffer.readUInt32LE(offset + 18); const nameLength = buffer.readUInt16LE(offset + 26);
    const extraLength = buffer.readUInt16LE(offset + 28); const start = offset + 30 + nameLength + extraLength;
    if ((flags & 8) || start + compressed > buffer.length) throw new Error('V3_OOXML_UNSUPPORTED_ZIP');
    const name = buffer.subarray(offset + 30, offset + 30 + nameLength).toString('utf8');
    const payload = buffer.subarray(start, start + compressed);
    entries.set(name, method === 0 ? payload : method === 8 ? zlib.inflateRawSync(payload) : Buffer.alloc(0));
    offset = start + compressed;
  }
  if (!entries.size) throw new Error('V3_OOXML_INVALID_ZIP');
  return entries;
}

function parseOoxml(source) {
  const entries = zipEntries(source.bytes); const parts = [];
  const names = [...entries.keys()].filter((name) => {
    if (source.extension === 'docx') return /^word\/(document|header\d*|footer\d*)\.xml$/.test(name);
    if (source.extension === 'xlsx') return /^xl\/(sharedStrings|worksheets\/sheet\d+)\.xml$/.test(name);
    return /^ppt\/slides\/slide\d+\.xml$/.test(name);
  }).sort();
  for (const name of names) {
    const text = decodeXml(entries.get(name).toString('utf8'));
    if (text) parts.push(text);
  }
  return parts.join('\n\n');
}

function parseEmail(source) {
  const raw = source.bytes.toString('utf8').replace(/\r\n?/g, '\n');
  if (source.extension === 'eml') {
    const split = raw.indexOf('\n\n');
    return split >= 0 ? raw.slice(split + 2).replace(/<[^>]+>/g, ' ').trim() : raw.trim();
  }
  const utf16 = source.bytes.toString('utf16le').match(/[\p{L}\p{N}\p{P}\p{Zs}\r\n]{8,}/gu) || [];
  const ascii = raw.match(/[\x20-\x7e\r\n]{8,}/g) || [];
  return [...utf16, ...ascii].map((item) => item.trim()).filter(Boolean).join('\n');
}

function nativePdfText(bytes) {
  const raw = bytes.toString('latin1'); const chunks = [];
  for (const match of raw.matchAll(/\(([^()]*)\)\s*Tj/g)) chunks.push(match[1].replace(/\\([()\\])/g, '$1'));
  for (const match of raw.matchAll(/\[(.*?)\]\s*TJ/gs)) for (const inner of match[1].matchAll(/\(([^()]*)\)/g)) chunks.push(inner[1]);
  return chunks.join(' ').trim();
}

function pdfQualityProbe(text, bytes) {
  const chars = String(text || '').replace(/\s/g, '').length;
  const replacementRatio = chars ? (String(text).match(/�/g) || []).length / chars : 1;
  const score = Math.max(0, Math.min(1, chars / 160)) * (1 - replacementRatio);
  return { score, character_count: chars, replacement_ratio: replacementRatio, native_text_accepted: score >= 0.55,
    byte_size: bytes.length };
}

async function timed(name, fn, records) {
  const start = Date.now(); records.push(attempt(name, 'attempted', 'adapter selected', 0));
  try {
    const value = await fn(); records.push(attempt(name, 'succeeded', 'valid content produced', Date.now() - start)); return value;
  } catch (error) {
    records.push(attempt(name, 'failed', error?.message || error, Date.now() - start)); throw error;
  }
}

async function selectAndParse(source, options = {}) {
  const records = []; const ext = source.extension;
  if (LOCAL_EXTENSIONS.includes(ext)) {
    const text = await timed(`local-${ext}`, async () => ['txt', 'md'].includes(ext) ? source.bytes.toString('utf8')
      : ['docx', 'xlsx', 'pptx'].includes(ext) ? parseOoxml(source) : parseEmail(source), records);
    if (!String(text).trim()) throw closedError(records, 'local parser returned empty content');
    return { result: buildParseResult(source, text, { selected_parser: `local-${ext}`, attempts: records },
      { score: 1, valid: true, metrics: { character_count: text.trim().length } }), attempts: records };
  }
  if (ext !== 'pdf') throw closedError([attempt('parser-selection', 'failed', `unsupported extension: ${ext}`, 0)], 'unsupported file');

  const native = await timed('pdf-native-probe', async () => nativePdfText(source.bytes), records);
  const probe = pdfQualityProbe(native, source.bytes);
  if (probe.native_text_accepted) {
    records.push(attempt('pdf-cloud', 'skipped', 'native text quality accepted', 0));
    records.push(attempt('pdf-local-ocr', 'skipped', 'native text quality accepted', 0));
    return { result: buildParseResult(source, native, { selected_parser: 'pdf-native', attempts: records }, { score: probe.score, valid: true, metrics: probe }), attempts: records };
  }
  let cloudText = '';
  if (!options.cloud?.configured) records.push(attempt('pdf-cloud', 'skipped', 'no configured cloud key', 0));
  else if (!options.cloud.authorized) records.push(attempt('pdf-cloud', 'skipped', 'external upload not authorized or declined', 0));
  else {
    try { cloudText = await timed('pdf-cloud', () => options.cloud.parse(source), records); } catch (_) { cloudText = ''; }
    if (String(cloudText).trim()) {
      records.push(attempt('pdf-local-ocr', 'skipped', 'cloud parser produced valid content', 0));
      return { result: buildParseResult(source, cloudText, { selected_parser: 'pdf-cloud', attempts: records }, { score: 1, valid: true, metrics: probe }), attempts: records };
    }
  }
  let ocrText = '';
  if (!options.ocr?.available) records.push(attempt('pdf-local-ocr', 'skipped', 'local OCR unavailable', 0));
  else { try { ocrText = await timed('pdf-local-ocr', () => options.ocr.parse(source), records); } catch (_) { ocrText = ''; } }
  if (!String(ocrText).trim()) throw closedError(records, 'no adapter produced valid content');
  return { result: buildParseResult(source, ocrText, { selected_parser: 'pdf-local-ocr', attempts: records }, { score: 0.75, valid: true, metrics: probe }), attempts: records };
}

function closedError(records, summary) {
  const detail = records.map((entry) => `${entry.adapter}=${entry.status}(${entry.reason})`).join('; ');
  const error = new Error(`V3_PARSE_FAILED: ${summary}. ${detail}`); error.code = 'V3_PARSE_FAILED'; error.attempts = records; return error;
}

module.exports = { LOCAL_EXTENSIONS, closedError, nativePdfText, parseEmail, parseOoxml, pdfQualityProbe, selectAndParse, zipEntries };
