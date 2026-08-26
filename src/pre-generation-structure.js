'use strict';

const crypto = require('crypto');
const norm = (value) => String(value ?? '').normalize('NFKC').replace(/\s+/g, ' ').trim();
const hash = (value) => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 20);
const number = (value) => Number.isInteger(Number(value)) && Number(value) > 0 ? Number(value) : null;
const clause = (value) => norm(value).match(/^(\d+(?:\.\d+)*)(?:[.)、]|\s+)\s*(.+)$/u);
const unitOf = (value) => norm(value).match(/(?:\(|（|\[)(%|°C|MPa|kPa|Pa|mm\/s|mm|cm|m|kg)(?:\)|）|\])/i)?.[1] || '';
const requirement = (value) => /必须|应当|不得|须|应在|shall|must|required/i.test(norm(value));
const terminal = (value) => /[。！？；;.!?:：]$/.test(norm(value));
const container = (block) => norm(block.metadata?.container_id || block.metadata?.section_id || block.locator?.container || '');
const page = (block) => block.locator?.page ?? block.metadata?.page ?? null;
const PRE_GENERATION_SEMANTIC_CONTRACT_VERSION = 'pre-generation-semantics/2.0';
const PRE_GENERATION_SEMANTIC_CONTRACT_FINGERPRINT = hash({
  version: PRE_GENERATION_SEMANTIC_CONTRACT_VERSION,
  inline_enumeration: 'explicit-markers+normative-context+exact-trimmed-spans-v2',
  ocr_structure: 'numbering+marginalia+continuation-v1',
  complex_tables: 'coordinate-span-header-path-v1'
});
const INLINE_MARKER = /(?:[（(]\s*(\d{1,3}|[一二三四五六七八九十]{1,3})\s*[)）]|(?<![\d.])(\d{1,3})[、.]|([一二三四五六七八九十]{1,3})、)\s*/gu;
const GOVERNING_PREAMBLE = /(?:下列|如下|以下|分别|包括|要求|规定|规则|事项|许可|可选|可执行|rules?|requirements?(?:\s+apply)?|permissions?|options?|shall\s+apply|must\s+meet|permitted|allowed)\s*[:：]?\s*$/iu;
const ZH_STRONG_NORMATIVE = /(?:严禁|禁止|不得|不应当|不应|不宜|必须|应当|(?<!不)应|须|宜)/u;
const ZH_PERMISSION = /(?:可以|允许)/u;
const EN_STRONG_NORMATIVE = /\b(?:shall(?:\s+not)?|must(?:\s+not)?|is\s+required\s+to|are\s+required\s+to|is\s+prohibited|are\s+prohibited|should(?:\s+not)?)\b/i;
const EN_PERMISSION = /\b(?:may|is\s+permitted\s+to|are\s+permitted\s+to|is\s+allowed\s+to|are\s+allowed\s+to)\b/i;

function trimmedSlice(value, start, end) {
  let exactStart = start; let exactEnd = end;
  while (exactStart < exactEnd && /\s/u.test(value[exactStart])) exactStart += 1;
  while (exactEnd > exactStart && /\s/u.test(value[exactEnd - 1])) exactEnd -= 1;
  return { start: exactStart, end: exactEnd, text: value.slice(exactStart, exactEnd) };
}

function normativeItem(body, normativeGoverning) {
  if (ZH_STRONG_NORMATIVE.test(body) || EN_STRONG_NORMATIVE.test(body)) return true;
  if ((ZH_PERMISSION.test(body) || EN_PERMISSION.test(body)) && !normativeGoverning) return false;
  if (ZH_PERMISSION.test(body)) return !/(?:结果|现象|数据|证据|研究|分析).{0,12}(?:可以|允许)(?:表明|说明|意味着|导致|包括)/u.test(body);
  if (!EN_PERMISSION.test(body)) return false;
  // Bare epistemic/explanatory "may" normally governs a state or consequence.
  // Permission requires an actor-like subject followed by may + an action verb.
  return /^(?:the\s+)?[\p{L}][\p{L}\p{N}_ -]{0,48}\s+may\s+(?!be\b|have\b|indicate\b|mean\b|cause\b|result\b|occur\b|vary\b|include\b)[a-z][a-z-]*\b/iu.test(body)
    || /\b(?:is|are)\s+(?:permitted|allowed)\s+to\s+[a-z]/i.test(body);
}

function expandInlineEnumerations(rawBlocks) {
  const output = []; let expanded = 0;
  for (const block of rawBlocks) {
    const original = String(block.raw?.text ?? block.text ?? '');
    if (!['paragraph', 'text', 'page-text', 'parsed-markdown'].includes(block.kind) || /\n/.test(original) || block.metadata?.table_id) {
      output.push(block); continue;
    }
    const matches = [...original.matchAll(INLINE_MARKER)].filter((match) => {
      const prior = match.index ? original[match.index - 1] : '';
      const next = original[match.index + match[0].length] || '';
      return (!prior || /[\s:：;；。！？]/u.test(prior)) && !/^\d/u.test(next);
    });
    if (matches.length < 2) { output.push(block); continue; }
    const items = matches.map((match, index) => ({
      match, start: match.index, bodyStart: match.index + match[0].length,
      end: matches[index + 1]?.index ?? original.length
    }));
    const preambleSpan = trimmedSlice(original, 0, matches[0].index);
    const preamble = preambleSpan.text;
    const normativeGoverning = Boolean(preamble) && GOVERNING_PREAMBLE.test(preamble);
    const governing = !preamble || /[：:]\s*$/.test(preamble) || normativeGoverning;
    if (!governing || items.some((item) => !normativeItem(trimmedSlice(original, item.bodyStart, item.end).text, normativeGoverning))) {
      output.push(block); continue;
    }
    const sourceId = String(block.block_id || hash([block.locator, original]));
    const parentId = preamble ? `${sourceId}:inline-preamble` : '';
    if (preamble) output.push({ ...block, block_id: parentId, kind: 'paragraph', raw: { ...(block.raw || {}), text: preamble }, text: preamble,
      card_eligible: false, locator: { ...(block.locator || {}), fragment: `chars=${preambleSpan.start}-${preambleSpan.end}` },
      metadata: { ...(block.metadata || {}), inline_enumeration_preamble: true, original_source_block_id: sourceId, structure_origin: 'inferred', structure_confidence: 0.96, structure_reason: 'governing_preamble_before_explicit_inline_enumeration' } });
    items.forEach((item, index) => {
      const itemSpan = trimmedSlice(original, item.start, item.end);
      const bodySpan = trimmedSlice(original, item.bodyStart, item.end);
      const rawItem = itemSpan.text;
      const body = bodySpan.text;
      const marker = item.match[0].trim();
      output.push({ ...block, block_id: `${sourceId}:inline-item-${index + 1}`, kind: 'list_item', raw: { ...(block.raw || {}), text: rawItem }, text: rawItem,
        locator: { ...(block.locator || {}), fragment: `chars=${itemSpan.start}-${itemSpan.end}` },
        metadata: { ...(block.metadata || {}), inline_enumeration: true, numbering_token: marker, list_id: `inline-list:${sourceId}`, list_level: 0,
          ordinal: index + 1, parent_clause_id: parentId, parent_clause_text: preamble, original_source_block_id: sourceId,
          structure_origin: 'inferred', structure_confidence: 0.96, structure_reason: 'multiple_explicit_inline_markers_with_requirement_bodies' },
        inferred: { ...(block.inferred || {}), original_body: body } });
    });
    expanded += 1;
  }
  return { blocks: output, diagnostics: { paragraphs_expanded: expanded, derived_list_items: output.filter((block) => block.metadata?.inline_enumeration).length } };
}

function recoverOcrStructure(rawBlocks, source = {}) {
  const blocks = rawBlocks.map((block) => ({ ...block, metadata: { ...(block.metadata || {}) }, inferred: { ...(block.inferred || {}) } }));
  const isOcr = (block) => /ocr|mineru/i.test(String(block.parse?.method || block.parse_method || source.parser || ''));
  const occurrences = new Map();
  for (const block of blocks.filter(isOcr)) {
    const key = norm(block.raw?.text || block.text);
    if (!key) continue;
    if (!occurrences.has(key)) occurrences.set(key, new Set());
    occurrences.get(key).add(page(block));
  }
  for (const block of blocks.filter(isOcr)) {
    const rawText = String(block.raw?.text ?? block.text ?? ''); const value = norm(rawText);
    const repeated = (occurrences.get(value)?.size || 0) >= 2;
    const marginal = /^(?:第?\s*\d+\s*页|page\s+\d+(?:\s+of\s+\d+)?|\d+\s*\/\s*\d+)$/i.test(value)
      || (repeated && (block.kind === 'header' || block.kind === 'footer' || block.metadata?.marginal === true));
    if (marginal) { block.card_eligible = false; block.metadata.noise = true; block.metadata.noise_reason = 'repeated_marginalia_or_page_number'; }
  }
  const numbered = blocks.map((block, index) => ({ block, index, match: isOcr(block) && !['table_cell', 'spreadsheet_cell', 'table_row', 'table'].includes(block.kind) ? clause(block.raw?.text || block.text) : null })).filter((item) => item.match);
  const conflicts = new Set(); const seen = new Map();
  for (const item of numbered) {
    const token = item.match[1]; const scope = `${page(item.block)}|${container(item.block)}`; const key = `${scope}|${token}`;
    if (seen.has(key)) { conflicts.add(item.index); conflicts.add(seen.get(key)); }
    seen.set(key, item.index);
  }
  for (const item of numbered) {
    if (conflicts.has(item.index)) { item.block.metadata.structure_unknown_reason = 'ambiguous_or_conflicting_numbering'; continue; }
    const token = item.match[1]; const body = item.match[2]; const path = token.split('.');
    item.block.metadata.numbering_token = token; item.block.metadata.numbering_path = path;
    item.block.metadata.structure_origin = 'inferred'; item.block.metadata.structure_confidence = 0.92;
    item.block.metadata.structure_reason = 'explicit_clause_numbering';
    if (!requirement(body) && body.length <= 80 && !/[。；;]$/.test(body)) {
      item.block.kind = 'heading'; item.block.metadata.heading_level = path.length;
    } else { item.block.kind = 'list_item'; item.block.metadata.list_id = `ocr-clause:${path[0]}`; item.block.metadata.list_level = path.length - 1; }
  }
  for (let index = 1; index < blocks.length; index += 1) {
    const prior = blocks[index - 1]; const current = blocks[index];
    if (!isOcr(current) || !isOcr(prior) || clause(current.raw?.text || current.text) || terminal(prior.raw?.text || prior.text)) continue;
    if (page(prior) !== page(current) || container(prior) !== container(current)) continue;
    const sameIndent = Math.abs(Number(prior.metadata?.indent || prior.metadata?.x || 0) - Number(current.metadata?.indent || current.metadata?.x || 0)) <= 4;
    const continuationSignal = current.metadata?.continuation === true || /^[，、且并及或但以并且同时]/u.test(norm(current.raw?.text || current.text));
    if (sameIndent && continuationSignal && requirement(prior.raw?.text || prior.text)) {
      current.inferred.continuation_of = prior.block_id; current.inferred.continuation_confidence = 0.9;
      current.metadata.continuation_reason = 'same_page_container_indent_and_explicit_continuation';
    }
  }
  return { blocks, diagnostics: { inferred_numbered: numbered.length - conflicts.size, ambiguous_numbering: conflicts.size, marginalia_suppressed: blocks.filter((b) => b.metadata?.noise_reason).length, wrapped_continuations: blocks.filter((b) => b.inferred?.continuation_of).length } };
}

function reconstructComplexTables(rawBlocks) {
  const blocks = rawBlocks.map((block) => ({ ...block, metadata: { ...(block.metadata || {}) } }));
  const groups = new Map();
  for (const block of blocks) if (['table_cell', 'spreadsheet_cell'].includes(block.kind) && (block.metadata.table_id || block.metadata.table)) {
    const key = String(block.metadata.table_id || block.metadata.table); if (!groups.has(key)) groups.set(key, []); groups.get(key).push(block);
  }
  const facts = []; const diagnostics = [];
  for (const [tableId, cells] of groups) {
    const explicitHeaderRows = new Set(cells.filter((cell) => cell.metadata.table_header === true || cell.metadata.header === true).map((cell) => Number(cell.metadata.row)).filter(Number.isFinite));
    const complex = cells.some((cell) => Number(cell.metadata.rowspan || cell.metadata.row_span || 1) > 1 || Number(cell.metadata.colspan || cell.metadata.col_span || 1) > 1 || cell.metadata.complex_table === true) || explicitHeaderRows.size > 1;
    if (!complex) continue;
    const occupied = new Map(); let malformed = false; const issues = [];
    for (const cell of cells) {
      const row = number(cell.metadata.row); const column = number(cell.metadata.column || cell.metadata.cell || cell.metadata.column_index);
      const rowspan = number(cell.metadata.rowspan || cell.metadata.row_span) || 1; const colspan = number(cell.metadata.colspan || cell.metadata.col_span) || 1;
      if (!row || !column) { malformed = true; issues.push('missing_coordinates'); continue; }
      cell.metadata.row = row; cell.metadata.column = column; cell.metadata.rowspan = rowspan; cell.metadata.colspan = colspan;
      for (let r = row; r < row + rowspan; r += 1) for (let c = column; c < column + colspan; c += 1) {
        const key = `${r}:${c}`; if (occupied.has(key)) { malformed = true; issues.push('overlapping_spans'); } else occupied.set(key, cell);
      }
    }
    const headerRows = [...new Set(cells.filter((cell) => cell.metadata.table_header === true || cell.metadata.header === true).map((cell) => cell.metadata.row))].sort((a, b) => a - b);
    if (!headerRows.length) { malformed = true; issues.push('missing_explicit_header_rows'); }
    if (malformed) {
      for (const cell of cells) { cell.card_eligible = false; cell.metadata.table_review_required = true; }
      diagnostics.push({ table_id: tableId, status: 'review_required', issues: [...new Set(issues)] }); continue;
    }
    const maxRow = Math.max(...cells.map((cell) => cell.metadata.row + cell.metadata.rowspan - 1));
    const maxColumn = Math.max(...cells.map((cell) => cell.metadata.column + cell.metadata.colspan - 1));
    for (let row = Math.max(...headerRows) + 1; row <= maxRow; row += 1) {
      const rowLabelCell = occupied.get(`${row}:1`); const rowLabel = norm(rowLabelCell?.raw?.text || rowLabelCell?.text);
      for (let column = 2; column <= maxColumn; column += 1) {
        const valueCell = occupied.get(`${row}:${column}`); const value = norm(valueCell?.raw?.text || valueCell?.text);
        if (!value || valueCell === rowLabelCell) continue;
        const headerCells = headerRows.map((headerRow) => occupied.get(`${headerRow}:${column}`)).filter(Boolean);
        const headerPath = [...new Set(headerCells.map((cell) => norm(cell.raw?.text || cell.text)).filter(Boolean))];
        const units = [...new Set(headerCells.map((cell) => norm(cell.metadata.unit || unitOf(cell.raw?.text || cell.text))).filter(Boolean))];
        if (!rowLabel || !headerPath.length || units.length > 1) { malformed = true; issues.push(units.length > 1 ? 'contradictory_units' : 'missing_structural_label'); continue; }
        const sources = [...new Set([rowLabelCell, ...headerCells, valueCell])];
        facts.push({ block_id: `table-fact-${hash([tableId, row, column, rowLabel, headerPath, value])}`, kind: 'table_cell',
          raw: { text: `${rowLabel} ${headerPath.join(' / ')}：${value}${units[0] && !value.includes(units[0]) ? ` ${units[0]}` : ''}` },
          locator: { ...(valueCell.locator || {}), row, column }, parse: { ...(valueCell.parse || {}) }, card_eligible: true,
          metadata: { table_id: tableId, row, column, reconstructed_table_fact: true, table_headers: [rowLabel, ...headerPath], unit: units[0] || '', source_block_ids: sources.map((cell) => cell.block_id), structure_origin: 'parser', structure_confidence: 1, structure_reason: 'coordinate_span_header_path' },
          provenance: sources.map((cell) => ({ block_id: cell.block_id, locator: cell.locator, row: cell.metadata.row, column: cell.metadata.column })) });
      }
    }
    if (malformed) {
      for (const cell of cells) { cell.card_eligible = false; cell.metadata.table_review_required = true; }
      for (let index = facts.length - 1; index >= 0; index -= 1) if (facts[index].metadata.table_id === tableId) facts.splice(index, 1);
      diagnostics.push({ table_id: tableId, status: 'review_required', issues: [...new Set(issues)] });
    } else {
      for (const cell of cells) { cell.card_eligible = false; cell.metadata.table_context_only = true; }
      diagnostics.push({ table_id: tableId, status: 'reconstructed', facts: facts.filter((fact) => fact.metadata.table_id === tableId).length });
    }
  }
  return { blocks: [...blocks, ...facts], diagnostics };
}

function preparePreGenerationBlocks(rawBlocks, source) {
  const inline = expandInlineEnumerations(rawBlocks); const ocr = recoverOcrStructure(inline.blocks, source); const tables = reconstructComplexTables(ocr.blocks);
  return { blocks: tables.blocks, diagnostics: { inline_enumerations: inline.diagnostics, ocr: ocr.diagnostics, tables: tables.diagnostics } };
}

module.exports = {
  PRE_GENERATION_SEMANTIC_CONTRACT_VERSION, PRE_GENERATION_SEMANTIC_CONTRACT_FINGERPRINT,
  expandInlineEnumerations, recoverOcrStructure, reconstructComplexTables, preparePreGenerationBlocks
};
