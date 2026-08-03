'use strict';
const fs = require('fs'); const path = require('path'); const root = path.join(__dirname, '..');
const main = fs.readFileSync(path.join(root, 'main.js'), 'utf8'); const findings = [];
const section = (start, end) => main.slice(main.indexOf(start), main.indexOf(end, main.indexOf(start)));
for (const marker of ['deriveVerifiedFacts(task)', 'applyVerifiedFacts(current', 'KnowledgeWritePort(obsidianVault)', 'LEGACY_KNOWLEDGE_WRITE_REMOVED']) {
  if (!main.includes(marker)) findings.push({ severity: 'error', marker, reason: 'required_authoritative_boundary_missing' });
}
if (/const universalProduction = !/.test(main)) findings.push({ severity: 'error', reason: 'legacy_production_switch_present' });
if (/适配器写入后不可读取/.test(main)) findings.push({ severity: 'error', reason: 'adapter_only_knowledge_success_fallback_present' });
const productionCommit = section('async runStructuredWriterPhase(', 'async writeAcceptedCard(');
if (!/const vault = new KnowledgeWritePort\(obsidianVault\)/.test(productionCommit)
  || /saveIndex:[^\n]*writeFile\(/.test(productionCommit)) {
  findings.push({ severity: 'error', reason: 'production_commit_bypasses_knowledge_write_port' });
}
const rollback = section('async rollbackLastBatch(', 'async processTask(');
if (!/const vault = new KnowledgeWritePort\(this\.app\.vault\)/.test(rollback)
  || /const adapter = this\.app\.vault\.adapter/.test(rollback)) {
  findings.push({ severity: 'error', reason: 'production_rollback_bypasses_knowledge_write_port' });
}
const indexes = section('async rebuildKnowledgeIndexes(', 'async applyReviewGroup(');
if (!/const vault = new KnowledgeWritePort\(this\.app\.vault\)/.test(indexes)
  || /await writeFile\(/.test(indexes)) findings.push({ severity: 'error', reason: 'index_regeneration_bypasses_knowledge_write_port' });
for (const legacyEntry of ['async writeAcceptedCard(', 'async approveDraft(', 'async revalidateLatestTaskLocal(']) {
  const body = main.slice(main.indexOf(legacyEntry), main.indexOf('\n  }', main.indexOf(legacyEntry)));
  if (!/LEGACY_KNOWLEDGE_WRITE_REMOVED/.test(body)) findings.push({ severity: 'error', legacyEntry, reason: 'legacy_review_write_entry_reachable' });
}
const report = { schema: 'eks/success-claim-audit/1.0', generated_at: new Date().toISOString(), ok: findings.length === 0,
  authority: 'task.verified_records[state=visible_verified]', scanned: ['main.js', 'src/knowledge-write-port.js'],
  claims_reviewed: ['Notice', 'status bar', 'task cards', 'review', 'diagnostic', 'performance', 'sessionStats', 'README/settings',
    'production commit', 'rollback', 'index regeneration', 'legacy review/regeneration entry points'],
  legacy_fields: ['written_card_ids', 'writtenFiles', 'result_counts.written', 'knowledge_records', 'output_paths'],
  policy: 'compatibility projections only; normalized from verified_records before persistence', findings };
const out = path.join(root, 'test-artifacts'); fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(out, 'success-claim-audit.json'), JSON.stringify(report, null, 2));
if (!report.ok) { console.error(JSON.stringify(report, null, 2)); process.exitCode = 1; } else console.log('success claim audit: PASS');
