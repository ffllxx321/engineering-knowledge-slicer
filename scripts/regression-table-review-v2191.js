'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {
  structureAwareTableKnowledge,
  enrichSummaryWithTableKnowledge
} = require('../src/table-knowledge.js');
const { loadBundleModule } = require('./load-bundle-module.js');

const cell = (kind, id, value, metadata, locator = {}) => ({
  block_id: id, kind, raw: { text: value }, parse: { status: 'present' }, card_eligible: true,
  locator: { scheme: 'fixture', value: id, ...locator }, metadata
});

function xlsxFixture() {
  const rows = [
    ['材料', '使用位置', '性能要求', '单位'], ['材料', '使用位置', '性能要求', '单位'],
    ['真石漆', '外墙', '耐候年限≥10', '年'], ['乳胶漆', '内墙', '耐擦洗≥5000', '次'],
    ['防水卷材', '屋面', '厚度≥4', 'mm'], ['防火涂料', '钢结构', '耐火极限≥2', 'h'],
    ['密封胶', '幕墙接缝', '位移能力≥25', '%'], ['保温板', '外墙系统', '导热系数≤0.03', 'W/(m·K)']
  ];
  return rows.flatMap((row, rowIndex) => row.map((value, columnIndex) =>
    cell('spreadsheet_cell', `x-${rowIndex}-${columnIndex}`, value, {
      sheet: '材料表', row: rowIndex + 1, column: String.fromCharCode(65 + columnIndex),
      merge: rowIndex === 0 && columnIndex === 2 ? { grid_span: 1 } : null,
      number_format: columnIndex === 3 ? 'unit' : ''
    }, { sheet: '材料表', row: rowIndex + 1 })));
}

{
  const result = structureAwareTableKnowledge({ blocks: xlsxFixture() }, {});
  assert.equal(result.diagnostics.tables_found, 1);
  assert.equal(result.diagnostics.subjects_found, 6);
  assert.equal(result.diagnostics.dropped.repeated_headers, 1);
  assert.equal(result.keyPoints.length, 6);
  assert(result.keyPoints.some((point) => /真石漆.*外墙.*耐候年限/u.test(point.content)));
  assert(result.keyPoints.some((point) => /乳胶漆.*内墙.*耐擦洗/u.test(point.content)));
  assert(result.evidence.every((entry) => entry.provenance.block_id && entry.table_context.headers));
  assert.equal(new Set(result.keyPoints.map((point) => point.point_id)).size, result.keyPoints.length);
}

{
  const blocks = [
    cell('table_cell', 'd-1', '材料', { part: 'document', table: 1, row: 1, cell: 1 }),
    cell('table_cell', 'd-2', '位置', { part: 'document', table: 1, row: 1, cell: 2 }),
    cell('table_cell', 'd-3', '要求', { part: 'document', table: 1, row: 1, cell: 3 }),
    cell('table_cell', 'd-4', '石材', { part: 'document', table: 1, row: 2, cell: 1 }),
    cell('table_cell', 'd-5', '首层大厅', { part: 'document', table: 1, row: 2, cell: 2 }),
    cell('table_cell', 'd-6', '干挂并通过拉拔验收', { part: 'document', table: 1, row: 2, cell: 3 }),
    cell('table_cell', 'd-7', '石材', { part: 'document', table: 1, row: 3, cell: 1 }),
    cell('table_cell', 'd-8', '卫生间', { part: 'document', table: 1, row: 3, cell: 2 }),
    cell('table_cell', 'd-9', '湿贴并由监理验收', { part: 'document', table: 1, row: 3, cell: 3 })
  ];
  const first = structureAwareTableKnowledge({ blocks }, {});
  const second = structureAwareTableKnowledge({ blocks }, {});
  assert.equal(first.keyPoints.length, 2, 'different locations and acceptance conditions stay separate');
  assert.deepEqual(first.keyPoints.map((point) => point.point_id), second.keyPoints.map((point) => point.point_id), 'idempotent ids');
}

{
  const block = cell('table', 'ocr-table', [
    '| 材料 | 部位 | 要求 |', '|---|---|---|', '| 铝板 | 幕墙 | 厚度 3mm |',
    '| 玻璃 | 天窗 | 传热系数 1.5W/(m²·K) |'
  ].join('\n'), { page: 2 }, { page: 2 });
  const result = enrichSummaryWithTableKnowledge({ blocks: [block] }, {
    key_points: [], evidence: [], document_title: '材料表'
  });
  assert.equal(result.summary.key_points.length, 2);
  assert(result.summary.evidence.every((entry) => entry.source_page === 2));
}

{
  const summary = { key_points: xlsxFixture().length ? [
    { point_id: 'old', kind: 'table_requirement', content: '真石漆 / 外墙：性能要求=耐候年限≥10；单位=年', evidence_ids: [] },
    { point_id: 'old2', kind: 'table_requirement', content: '乳胶漆 / 内墙：性能要求=耐擦洗≥5000；单位=次', evidence_ids: [] },
    { point_id: 'old3', kind: 'table_requirement', content: '防水卷材 / 屋面：性能要求=厚度≥4；单位=mm', evidence_ids: [] }
  ] : [], evidence: [] };
  const result = structureAwareTableKnowledge({ blocks: xlsxFixture() }, summary);
  assert(result.diagnostics.warning, 'dense implausible compression warns');
  assert.equal(result.diagnostics.warning.blocking, false);
}

{
  const confidence = loadBundleModule('src/core/confidence.js');
  const matching = confidence.evidenceConsistency('材料：真石漆；厚度 3mm', '材料：真石漆；厚度 3mm');
  assert(matching.ok, 'matching material and number do not trigger review');
  const materialConflict = confidence.evidenceConsistency('材料：真石漆', '材料：乳胶漆');
  assert.equal(materialConflict.status, 'material_conflict');
  assert.equal(materialConflict.factComparison.differences[0].claim, '材料：真石漆');
  const numericConflict = confidence.evidenceConsistency('厚度 3mm；日期 2026-07-01', '厚度 4mm；日期 2026-07-02');
  assert(numericConflict.factComparison.differences.some((item) => item.status === 'conflict'));
}

{
  const main = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
  const modalStart = main.indexOf('class ReviewExceptionModal');
  const modalEnd = main.indexOf('class UploadConfirmModal', modalStart);
  const modal = main.slice(modalStart, modalEnd);
  assert(!modal.includes("summary', { text: '技术信息'"), 'standard review UI has no technical JSON section');
  assert(modal.includes("createEl('mark'"), 'exact differing spans are marked');
  assert(modal.includes('生成值：') && modal.includes('原文值：') && modal.includes('影响：'));
  assert(modal.includes("text: '批准'") && modal.includes("text: '重新生成'") &&
    modal.includes("text: '更多操作'") && modal.includes("text: '关闭'"));
  assert(main.includes("report.materialDifferenceStatus = 'matched'"), 'legacy matching review objects normalize at ingress');
}

console.log('table extraction and review UX regression tests passed');
