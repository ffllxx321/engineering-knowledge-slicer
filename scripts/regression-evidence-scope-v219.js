const assert = require('assert');
const { loadBundleModule } = require('./load-bundle-module');
const { calculateConfidence, evidenceConsistency } = loadBundleModule('src/core/confidence.js');

function decision(statement, quote, document = quote) {
  return calculateConfidence({
    parsePackage: { markdown: document, quality: { score: 1 } },
    classification: { model_confidence: 1, alternatives: [] },
    atom: { title: '要求', content: statement, source: {
      source_link: '[[source]]', source_locator: 'block:b1', parent_summary: '[[summary]]',
      evidence_quote: quote, provenance_verified: true
    } },
    schemaValid: true, routeValid: true, labelsValid: true, duplicate: false,
    autoApproveConfidenceThreshold: 0.9
  });
}

assert.strictEqual(decision('抗压强度必须达到 30 MPa。', '抗压强度必须达到 30 MPa。').decision, 'auto_ingest');
assert.notStrictEqual(decision('抗压强度必须达到 30 MPa。', '本行抗压强度必须达到 20 MPa。', '第一块：20 MPa。\n第二块：30 MPa。').decision, 'auto_ingest');
assert.notStrictEqual(decision('A 项单价为 80 元。', '| A | 60 元 |', '| A | 60 元 |\n| B | 80 元 |').decision, 'auto_ingest');
assert.notStrictEqual(decision('交付日期为 2026-08-01。', '邮件一：交付日期为 2026-07-01。', '邮件一：2026-07-01。\n邮件二：2026-08-01。').decision, 'auto_ingest');
assert.strictEqual(evidenceConsistency('压力不得超过 5 MPa。', '压力可以达到 5 MPa。').ok, false);
assert.strictEqual(evidenceConsistency('当温度低于 5 ℃ 时必须停机。', '温度低于 5 ℃ 时可以继续运行。').ok, false);
assert.strictEqual(evidenceConsistency('当温度低于 5 ℃ 时必须停机。', '当温度低于 5 ℃ 时必须停机。').ok, true);
assert.strictEqual(evidenceConsistency('工期为 20 日。', '工期为 20 月。').ok, false);
console.log('regression-evidence-scope-v219: ok');
