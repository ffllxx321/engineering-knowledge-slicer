// @ts-nocheck -- Runtime JS contracts are exercised by adversarial regressions.
'use strict';

// Fail-closed checks for text that can never be knowledge evidence.  These are
// deliberately format/content signals rather than document-specific keywords.
const META_FAILURE = [
  /(?:cannot|can't|unable to).{0,40}(?:translate|translated|extract|read|interpret)|no\s+(?:meaningful|coherent|readable)\s+(?:natural[- ]language\s+)?(?:text|content)/i,
  /(?:无法|不能|未能)(?:翻译|提取|读取|识别|理解)|(?:没有|无)(?:有意义|可读|连贯)的?(?:自然语言|文本|内容)/
];
const CONTRACT_FIELDS = /\b(?:region_id|preserve_exactly|translated_text|expected_region_ids|actual_region_ids|schema_version|output_schema)\b/gi;
const CONTRACT_INSTRUCTION = /(?:return|respond|output|preserve|copy|include|must|仅返回|请返回|输出|保留|逐字|必须).{0,80}(?:json|schema|field|字段|格式|region|标识)/i;
const PROMPT_LEAKAGE = /(?:you are|system prompt|parser instructions?|translation instructions?).{0,160}(?:return|respond|output|must)|(?:"required"\s*:.*"properties"\s*:)|(?:请|必须|仅)(?:严格)?(?:返回|输出).{0,80}(?:JSON|字段|schema)/is;
const PDF_CONTAINER = /(?:^|[\r\n])\s*%PDF-\d|\b(?:xref|startxref|endobj)\b|\d+\s+\d+\s+obj\b|\/Type\s*\/Page\b|\/Filter\s*\/(?:FlateDecode|DCTDecode)|\bstream[\r\n]/i;
const MOJIBAKE = /(?:\uFFFD|Ã.|Â.|â..|(?:æ|å|ä|ç|é).{1,2})/g;

function analyzeText(value) {
  const text = String(value || '').trim();
  const reasons = [];
  if (!text) return { ok: false, reasons: ['empty'] };
  const controls = (text.match(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g) || []).length;
  const replacement = (text.match(/\uFFFD/g) || []).length;
  const mojibake = (text.match(MOJIBAKE) || []).length;
  const printable = (text.match(/[\p{L}\p{N}\p{P}\p{S}\s]/gu) || []).length;
  const letters = (text.match(/\p{L}/gu) || []).length;
  const contractFields = (text.match(CONTRACT_FIELDS) || []).length;
  if (PDF_CONTAINER.test(text)) reasons.push('pdf_or_container_bytes');
  if (controls / text.length > 0.01 || printable / text.length < 0.86
      || /(?:[A-Za-z0-9+/]{120,}={0,2}|(?:\\x[0-9a-f]{2}){8,})/i.test(text)) reasons.push('control_heavy_or_binary');
  if (replacement >= 2 || mojibake >= 3 || (replacement + mojibake) / Math.max(1, letters) > 0.08) reasons.push('mojibake');
  if ((contractFields >= 2 && (CONTRACT_INSTRUCTION.test(text) || /[{}[\]":]/.test(text)))
      || (contractFields >= 1 && CONTRACT_INSTRUCTION.test(text)) || PROMPT_LEAKAGE.test(text)) reasons.push('parser_or_schema_contract_leakage');
  if (META_FAILURE.some((pattern) => pattern.test(text))) reasons.push('non_content_meta_statement');
  return { ok: reasons.length === 0, reasons: [...new Set(reasons)] };
}

function blockText(block) {
  return String(block?.raw?.text || block?.raw_text || block?.text || block?.content || '').trim();
}

function quarantineInvalidBlocks(parsePackage) {
  if (!parsePackage || typeof parsePackage !== 'object') return { valid: [], invalid: [] };
  const valid = [];
  const invalid = [];
  for (const block of Array.isArray(parsePackage.blocks) ? parsePackage.blocks : []) {
    if (block?.card_eligible === false) continue;
    const analysis = analyzeText(blockText(block));
    if (analysis.ok) valid.push(block);
    else {
      block.card_eligible = false;
      block.exclusion_reason = `content_integrity:${analysis.reasons.join(',')}`;
      invalid.push({ block_id: String(block?.block_id || ''), reasons: analysis.reasons });
    }
  }
  if (invalid.length && parsePackage.evidence_index && typeof parsePackage.evidence_index === 'object') {
    for (const [key, entry] of Object.entries(parsePackage.evidence_index)) {
      if (!analyzeText(entry?.raw_text).ok) delete parsePackage.evidence_index[key];
    }
  }
  if (invalid.length) {
    parsePackage.markdown = valid.map(blockText).filter(Boolean).join('\n\n');
    parsePackage.quality = { ...(parsePackage.quality || {}), content_integrity_rejections: invalid };
  }
  return { valid, invalid };
}

function assertKnowledgeActions(actions) {
  const failures = [];
  for (const action of actions || []) {
    if (!['business_item', 'company_knowledge'].includes(action?.record_kind)) continue;
    const analysis = analyzeText(action.content);
    if (!analysis.ok) failures.push({ record_id: action.record_id, reasons: analysis.reasons });
  }
  if (failures.length) {
    const error = new Error('生产提交拒绝：知识记录包含不可核验的二进制、乱码、解析指令、契约泄漏或非内容元陈述。');
    error.code = 'INVALID_KNOWLEDGE_CONTENT';
    error.details = failures;
    throw error;
  }
}

module.exports = { analyzeText, blockText, quarantineInvalidBlocks, assertKnowledgeActions };
