'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const zlib = require('zlib');
const { performance } = require('perf_hooks');
const { loadBundleModule } = require('./load-bundle-module');
const block = loadBundleModule('src/core/block-v0.js', { crypto });
const ooxml = loadBundleModule('src/core/ooxml.js', { crypto, zlib, 'src/core/block-v0.js': block });
const candidates = [
  '/tmp/ventilation_preembedded.xlsx',
  '/tmp/alibaba_finish_material_schedule.xlsx',
  '/tmp/bim_tender_requirements.docx',
  '/tmp/engineering_project_report.pptx',
  '/tmp/project_report.pptx'
];
for (const file of candidates) {
  if (!fs.existsSync(file)) continue;
  const buffer = fs.readFileSync(file);
  const type = path.extname(file).slice(1).toLowerCase();
  const started = performance.now();
  const result = ooxml.parseOoxml(buffer, type);
  const elapsed = performance.now() - started;
  const metrics = result.metadata?.ooxml_metrics || {};
  console.log(JSON.stringify({
    file: path.basename(file), bytes: buffer.length, status: result.status, code: result.code || '',
    elapsed_ms: Number(elapsed.toFixed(2)), blocks: result.blocks?.length || 0,
    eligible_blocks: metrics.eligible_blocks || 0, entries: metrics.entries || 0,
    inflated_bytes: metrics.inflated_bytes || 0,
    locator_coverage: metrics.locator_coverage ?? null,
    sheets: result.metadata?.sheets?.length || 0,
    slides: result.metadata?.slides?.length || 0,
    parts: result.metadata?.parts?.length || 0,
    warnings: result.metadata?.warnings || []
  }));
}
