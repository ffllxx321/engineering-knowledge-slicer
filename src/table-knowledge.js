'use strict';

const crypto = require('crypto');

const text = (value) => String(value == null ? '' : value).normalize('NFKC').replace(/\s+/g, ' ').trim();
const id = (prefix, value) => `${prefix}-${crypto.createHash('sha256').update(value).digest('hex').slice(0, 20)}`;
const columnNumber = (value) => [...String(value || '').toUpperCase()]
  .reduce((number, character) => number * 26 + character.charCodeAt(0) - 64, 0);
const meaningful = (value) => text(value) && !/^(?:[-—/\\]|n\/?a|无|合计|小计|序号)$/iu.test(text(value));
const headerLike = (value) => /材料|产品|部位|位置|区域|系统|规格|型号|单位|性能|要求|做法|施工|验收|责任|适用|备注|名称/iu.test(text(value));

function tableKey(block) {
  const metadata = block.metadata || {};
  if (block.kind === 'spreadsheet_cell') return `xlsx:${metadata.sheet || ''}`;
  if (block.kind === 'table_cell') return `docx:${metadata.part || ''}:${metadata.table || 0}`;
  if (block.kind === 'table') return `text:${block.locator?.value || block.block_id}`;
  if (/table/i.test(block.kind || '') || metadata.table || metadata.table_id) {
    return `ocr:${metadata.table_id || metadata.table || block.locator?.page || block.locator?.value || block.block_id}`;
  }
  return '';
}

function cellPosition(block, fallbackRow, fallbackColumn) {
  const metadata = block.metadata || {};
  return {
    row: Number(metadata.row || metadata.table_row || fallbackRow),
    column: Number(metadata.cell || metadata.column_index || columnNumber(metadata.column) || fallbackColumn)
  };
}

function markdownCells(block) {
  const lines = String(block.raw?.text || '').split(/\r?\n/).filter((line) => /^\s*\|.*\|\s*$/.test(line));
  return lines.flatMap((line, rowIndex) => {
    const cells = line.trim().replace(/^\||\|$/g, '').split('|').map(text);
    if (cells.every((cell) => /^:?-{3,}:?$/.test(cell))) return [];
    return cells.map((value, columnIndex) => ({
      block, value, row: rowIndex + 1, column: columnIndex + 1
    }));
  });
}

function collectTables(parsePackage) {
  const groups = new Map();
  for (const block of parsePackage?.blocks || []) {
    const key = tableKey(block);
    if (!key || block.card_eligible === false || block.parse?.status === 'missing') continue;
    if (!groups.has(key)) groups.set(key, []);
    if (block.kind === 'table') groups.get(key).push(...markdownCells(block));
    else {
      const position = cellPosition(block, groups.get(key).length + 1, 1);
      groups.get(key).push({ block, value: text(block.raw?.text), ...position });
    }
  }
  return [...groups.entries()].map(([key, cells]) => ({ key, cells })).filter((table) => table.cells.some((cell) => meaningful(cell.value)));
}

function expandedValue(cell, table) {
  if (meaningful(cell.value)) return cell.value;
  const merge = cell.block.metadata?.merge;
  if (!merge) return '';
  const preceding = table.cells.filter((candidate) =>
    candidate.row <= cell.row && candidate.column <= cell.column && meaningful(candidate.value));
  return preceding.length ? preceding[preceding.length - 1].value : '';
}

function analyzeTable(table) {
  const rows = new Map();
  for (const cell of table.cells) {
    if (!rows.has(cell.row)) rows.set(cell.row, []);
    rows.get(cell.row).push(cell);
  }
  const orderedRows = [...rows.entries()].sort((a, b) => a[0] - b[0]);
  const headerRows = [];
  let previousHeaderSignature = '';
  for (const [row, cells] of orderedRows.slice(0, 5)) {
    const values = cells.map((cell) => expandedValue(cell, table)).filter(meaningful);
    if (!values.length) continue;
    const signature = values.map((value) => text(value).toLowerCase()).join('|');
    if (headerRows.length && signature === previousHeaderSignature) break;
    const headerScore = values.filter(headerLike).length / values.length;
    if (!headerRows.length || headerScore >= 0.5 || values.length === 1) {
      headerRows.push(row);
      previousHeaderSignature = signature;
    }
    else break;
  }
  if (!headerRows.length && orderedRows.length) headerRows.push(orderedRows[0][0]);
  const maxColumn = Math.max(0, ...table.cells.map((cell) => cell.column));
  const headers = new Map();
  for (let column = 1; column <= maxColumn; column += 1) {
    const path = headerRows.map((row) => {
      const cell = table.cells.find((candidate) => candidate.row === row && candidate.column === column);
      return cell ? expandedValue(cell, table) : '';
    }).filter(meaningful);
    headers.set(column, [...new Set(path)].join(' / ') || `第${column}列`);
  }
  const signatures = new Set();
  const subjects = [];
  let repeatedHeaders = 0;
  let emptyRows = 0;
  for (const [row, cells] of orderedRows) {
    if (headerRows.includes(row)) continue;
    const values = new Map(cells.map((cell) => [cell.column, expandedValue(cell, table)]));
    const nonempty = [...values.values()].filter(meaningful);
    if (!nonempty.length) { emptyRows += 1; continue; }
    const headerMatches = [...values].filter(([column, value]) =>
      text(value).toLowerCase() === text(headers.get(column)).split(' / ').pop().toLowerCase()).length;
    if (headerMatches >= Math.max(2, Math.ceil(nonempty.length * 0.6))) { repeatedHeaders += 1; continue; }
    const fields = [...values].filter(([, value]) => meaningful(value))
      .map(([column, value]) => ({ header: headers.get(column), value, column }));
    const signature = fields.map((field) => `${field.header}:${field.value}`).join('|').toLowerCase();
    if (signatures.has(signature)) continue;
    signatures.add(signature);
    const subjectFields = fields.filter((field) => /材料|产品|名称|部位|位置|区域|系统|做法/iu.test(field.header));
    const requirementFields = fields.filter((field) => !subjectFields.includes(field));
    const subject = subjectFields.map((field) => field.value).join(' / ') || fields[0].value;
    const content = `${subject}：${requirementFields.map((field) => `${field.header}=${field.value}`).join('；') || fields.map((field) => `${field.header}=${field.value}`).join('；')}`;
    const evidenceCells = cells.filter((cell) => meaningful(cell.value));
    subjects.push({ row, subject, content, fields, evidenceCells });
  }
  return { ...table, headers: Object.fromEntries(headers), headerRows, subjects, repeatedHeaders, emptyRows };
}

function structureAwareTableKnowledge(parsePackage, summary = {}) {
  const tables = collectTables(parsePackage).map(analyzeTable);
  const existing = new Set((summary.key_points || []).map((point) => text(point.content).toLowerCase()));
  const keyPoints = [];
  const evidence = [];
  let duplicates = 0;
  for (const table of tables) {
    for (const subject of table.subjects) {
      const normalized = text(subject.content).toLowerCase();
      if (existing.has(normalized)) { duplicates += 1; continue; }
      existing.add(normalized);
      const evidenceIds = subject.evidenceCells.map((cell) => {
        const evidenceId = id('table-evidence', `${cell.block.block_id}|${cell.row}|${cell.column}|${cell.value}`);
        evidence.push({
          evidence_id: evidenceId,
          block_id: cell.block.block_id,
          locator: `${cell.block.locator?.scheme || ''}:${cell.block.locator?.value || ''}`,
          quote: cell.value,
          source_page: cell.block.locator?.page || cell.block.metadata?.page || cell.block.metadata?.sheet || '',
          locator_precision: 'table-cell',
          provenance: { ...(cell.block.locator || {}), block_id: cell.block.block_id, row: cell.row, column: cell.column },
          table_context: { table: table.key, headers: table.headers, row: subject.row, section: cell.block.metadata?.section || '' }
        });
        return evidenceId;
      });
      keyPoints.push({
        point_id: id('table-point', `${table.key}|${subject.content}`),
        kind: 'table_requirement',
        content: subject.content,
        evidence_ids: [...new Set(evidenceIds)],
        table_subject: subject.subject,
        table_context: { table: table.key, headers: table.headers, row: subject.row }
      });
    }
  }
  const subjectsFound = tables.reduce((sum, table) => sum + table.subjects.length, 0);
  const dense = tables.filter((table) => table.subjects.length >= 6);
  const ratio = subjectsFound ? keyPoints.length / subjectsFound : 1;
  const warning = dense.length && ratio < 0.6 ? {
    code: 'TABLE_DENSE_COVERAGE_WARNING',
    message: `发现 ${subjectsFound} 个表格知识主题，仅生成 ${keyPoints.length} 个候选，压缩比例异常。`,
    blocking: false
  } : null;
  return {
    keyPoints, evidence,
    diagnostics: {
      tables_found: tables.length,
      subjects_found: subjectsFound,
      candidates_generated: keyPoints.length,
      consolidated: duplicates,
      dropped: {
        empty_rows: tables.reduce((sum, table) => sum + table.emptyRows, 0),
        repeated_headers: tables.reduce((sum, table) => sum + table.repeatedHeaders, 0),
        duplicates
      },
      coverage_ratio: ratio,
      warning
    }
  };
}

function enrichSummaryWithTableKnowledge(parsePackage, summary) {
  const result = structureAwareTableKnowledge(parsePackage, summary);
  return {
    summary: {
      ...summary,
      key_points: [...(summary.key_points || []), ...result.keyPoints],
      evidence: [...(summary.evidence || []), ...result.evidence],
      table_coverage: result.diagnostics
    },
    diagnostics: result.diagnostics
  };
}

module.exports = { collectTables, analyzeTable, structureAwareTableKnowledge, enrichSummaryWithTableKnowledge };
