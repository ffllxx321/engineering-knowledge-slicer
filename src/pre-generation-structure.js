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
  const ocr = recoverOcrStructure(rawBlocks, source); const tables = reconstructComplexTables(ocr.blocks);
  return { blocks: tables.blocks, diagnostics: { ocr: ocr.diagnostics, tables: tables.diagnostics } };
}

module.exports = { recoverOcrStructure, reconstructComplexTables, preparePreGenerationBlocks };
