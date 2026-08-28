'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const fixture = require('./fixtures/phase5-evolution-v1.json');
const expected = require('./fixtures/phase5-expected-metrics-v1.json');
const { buildEvolutionGraph, renderEvolutionMarkdown } = require('../src/v3');
const { HybridRetriever, loadMarkdownCorpus } = require('../src/retrieval-core');

const byUnit = (graph, id) => graph.facts.find((fact) => fact.unit_ids.includes(id));
const mean = (values) => values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length);

async function main() {
  const graph = buildEvolutionGraph(fixture, { as_of: fixture.as_of });
  const repeat = buildEvolutionGraph(JSON.parse(JSON.stringify(fixture)), { as_of: fixture.as_of });
  assert.deepStrictEqual(repeat, graph, 'graph and IDs must repeat exactly');
  assert.strictEqual(graph.facts.length, fixture.units.length - 1, 'only the exact copy may collapse');

  const copied = byUnit(graph, 'u-copy-a');
  assert(copied.unit_ids.includes('u-copy-b') && copied.evidence.length === 2 && copied.source_ids.length === 2);
  assert(copied.relations.some((relation) => relation.type === 'exact_duplicate'));
  const equivalentA = byUnit(graph, 'u-equivalent-a'); const equivalentB = byUnit(graph, 'u-equivalent-b');
  assert.notStrictEqual(equivalentA.fact_id, equivalentB.fact_id);
  assert.strictEqual(equivalentA.equivalence_cluster_id, equivalentB.equivalence_cluster_id);
  assert.deepStrictEqual(new Set([...equivalentA.source_ids, ...equivalentB.source_ids]), new Set(['src-lift-a', 'src-lift-b']));

  const revA = byUnit(graph, 'u-rev-a'); const revB = byUnit(graph, 'u-rev-b'); const revC = byUnit(graph, 'u-rev-c');
  const supersedes = graph.relations.filter((relation) => relation.type === 'supersedes');
  assert.deepStrictEqual(supersedes.map((relation) => [relation.from_id, relation.target_id]).sort(), [[revB.fact_id, revA.fact_id], [revC.fact_id, revB.fact_id]].sort());
  assert.notStrictEqual(revB.fact_id, revC.fact_id, 'numeric amendment remains a separate fact');
  assert.strictEqual(revA.lifecycle, 'historical'); assert.strictEqual(revB.lifecycle, 'historical'); assert.strictEqual(revC.lifecycle, 'current');

  const red = byUnit(graph, 'u-red'); const blue = byUnit(graph, 'u-blue');
  assert.notStrictEqual(red.fact_id, blue.fact_id); assert(!red.relations.some((relation) => relation.target_id === blue.fact_id));
  const conflict7 = byUnit(graph, 'u-conflict-7'); const conflict14 = byUnit(graph, 'u-conflict-14');
  assert(conflict7.relations.some((relation) => relation.type === 'contradicts' && relation.target_id === conflict14.fact_id));
  assert.strictEqual(conflict7.lifecycle, 'conflicted'); assert.strictEqual(conflict14.lifecycle, 'conflicted');
  assert.strictEqual(byUnit(graph, 'u-current').lifecycle, 'current'); assert.strictEqual(byUnit(graph, 'u-expired').lifecycle, 'expired');
  assert.strictEqual(byUnit(graph, 'u-future').lifecycle, 'future'); assert.strictEqual(byUnit(graph, 'u-undated').lifecycle, 'undated');
  assert.strictEqual(byUnit(graph, 'u-malformed').lifecycle, 'undated'); assert(graph.diagnostics.some((item) => item.code === 'MALFORMED_EFFECTIVE_DATE'));
  assert.notStrictEqual(byUnit(graph, 'u-pump').fact_id, byUnit(graph, 'u-hose').fact_id);
  assert.strictEqual(byUnit(graph, 'u-crane').equivalence_cluster_id, byUnit(graph, 'u-crane-alias').equivalence_cluster_id);
  assert(!byUnit(graph, 'u-crane-near').equivalence_cluster_id, 'near-name collision must not merge');

  const existing = new Set(graph.facts.map((fact) => fact.fact_id));
  const fabricated = graph.facts.flatMap((fact) => fact.relations).filter((relation) => !existing.has(relation.target_id));
  assert.deepStrictEqual(fabricated, []);
  for (const fact of graph.facts) for (const relation of fact.relations) {
    assert(relation.reason && Number.isFinite(relation.confidence) && relation.origin);
    assert(relation.source_evidence.every((evidence) => evidence.evidence_id && evidence.source_id && evidence.block_id && evidence.locator));
  }

  const tempRoot = fs.mkdtempSync(path.join(process.cwd(), 'test-artifacts-phase5-'));
  try {
    for (const fact of graph.facts) fs.writeFileSync(path.join(tempRoot, `${fact.fact_id}.md`), renderEvolutionMarkdown(fact, graph), 'utf8');
    const records = loadMarkdownCorpus(tempRoot); const recordMap = new Map(records.map((record) => [record.id, record]));
    assert.deepStrictEqual(records.map((record) => record.id).sort(), graph.facts.map((fact) => fact.fact_id).sort());
    for (const fact of graph.facts) {
      const loaded = recordMap.get(fact.fact_id); assert(loaded);
      assert.strictEqual(loaded.source_id, fact.source_ids[0]); assert.deepStrictEqual(loaded.source_ids, fact.source_ids);
      assert.deepStrictEqual(loaded.scope, fact.scope); assert.deepStrictEqual(loaded.relations, fact.relations);
      assert.strictEqual(loaded.lifecycle, fact.lifecycle); assert.strictEqual(loaded.revision, fact.revision); assert.strictEqual(loaded.version, fact.version); assert.deepStrictEqual(loaded.dates, fact.dates);
      assert.deepStrictEqual(loaded.evidence.map((e) => e.raw_verbatim), fact.evidence.map((e) => e.raw_verbatim));
      assert(loaded.evidence.every((e) => e.evidence_id && e.block_id && e.locator));
    }
    const retriever = new HybridRetriever(records); const restarted = new HybridRetriever(loadMarkdownCorpus(tempRoot));
    const queries = [
      { id: 'current-clause', query: 'hydrostatic test pressure clause 8.4', expected: revC.fact_id, kind: 'current' },
      { id: 'current-date', query: 'current scaffold inspection rule', expected: byUnit(graph, 'u-current').fact_id, kind: 'current' },
      { id: 'historical-b', query: 'hydrostatic Rev B clause 8.4', expected: revB.fact_id, kind: 'historical', options: { historical: true } },
      { id: 'historical-a', query: 'hydrostatic Rev A clause 8.4', expected: revA.fact_id, kind: 'historical', options: { include_historical: true } },
      { id: 'project-red', query: 'Project Red façade anchor 450 mm', expected: red.fact_id, kind: 'project' },
      { id: 'clause-current', query: 'Amendment C 1.20 MPa', expected: revC.fact_id, kind: 'clause' }
    ];
    const results = [];
    for (const query of queries) {
      const options = { limit: 5, as_of: fixture.as_of, ...(query.options || {}) }; const ranked = await retriever.search(query.query, options); const again = await retriever.search(query.query, options); const afterRestart = await restarted.search(query.query, options);
      assert.deepStrictEqual(ranked.map((item) => item.record.id), again.map((item) => item.record.id));
      assert.deepStrictEqual(ranked.map((item) => item.record.id), afterRestart.map((item) => item.record.id));
      results.push({ ...query, ranked, rank: ranked.findIndex((item) => item.record.id === query.expected) + 1 });
    }
    const conflictResults = await retriever.search('concrete wet curing minimum duration days', { limit: 5, as_of: fixture.as_of });
    const conflictPeerRecall = [conflict7.fact_id, conflict14.fact_id].filter((id) => conflictResults.some((item) => item.record.id === id)).length / 2;
    assert(conflictResults.filter((item) => [conflict7.fact_id, conflict14.fact_id].includes(item.record.id)).every((item) => item.lifecycle === 'conflicted'));
    assert.strictEqual((await retriever.search('qzxvplm norkwuddle', { as_of: fixture.as_of })).length, 0);

    const noGenericNewer = buildEvolutionGraph({ as_of: fixture.as_of, documents: fixture.documents.filter((d) => ['src-project-red', 'src-project-blue'].includes(d.source_id)), units: [
      { ...fixture.units.find((u) => u.unit_id === 'u-red'), unit_id: 'generic-old', scope: { kind: 'general' }, effective_date: '2024-01-01' },
      { ...fixture.units.find((u) => u.unit_id === 'u-blue'), unit_id: 'generic-new', scope: { kind: 'general' }, effective_date: '2026-01-01' }
    ] });
    assert(!noGenericNewer.relations.some((relation) => relation.type === 'supersedes'), 'dates alone must never mean newer-wins');

    const evidenceHits = results.map((result) => {
      const hit = result.ranked.find((item) => item.record.id === result.expected); return hit && hit.record.evidence.some((e) => e.evidence_id && e.block_id && e.raw_verbatim);
    });
    const metrics = {
      current_query_recall_at_1: mean(results.filter((r) => r.kind === 'current').map((r) => r.rank === 1 ? 1 : 0)),
      historical_recall_at_3: mean(results.filter((r) => r.kind === 'historical').map((r) => r.rank > 0 && r.rank <= 3 ? 1 : 0)),
      evidence_hit_rate: mean(evidenceHits.map(Number)), conflict_peer_recall: conflictPeerRecall,
      false_merge_count: 0, false_supersedes_count: supersedes.length === 2 ? 0 : Math.abs(supersedes.length - 2), fabricated_relation_count: fabricated.length,
      locator_coverage: graph.facts.flatMap((fact) => fact.evidence).filter((e) => e.locator && Object.keys(e.locator).length).length / graph.facts.flatMap((fact) => fact.evidence).length,
      deterministic_repeatability: 1
    };
    for (const [metric, threshold] of Object.entries(expected.thresholds)) assert(metrics[metric] >= threshold, `${metric} ${metrics[metric]} < ${threshold}`);
    const report = { schema: 'eks/v3/phase5-observed-metrics/1', fixture_schema: fixture.schema, as_of: fixture.as_of, corpus: { input_units: fixture.units.length, facts: graph.facts.length, evidence_items: graph.facts.flatMap((fact) => fact.evidence).length, relations: graph.relations.length }, metrics, thresholds: expected.thresholds,
      rankings: results.map((result) => ({ id: result.id, expected_id: result.expected, rank: result.rank, observed_ids: result.ranked.map((item) => item.record.id) })), conflict_observed_ids: conflictResults.map((item) => item.record.id) };
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } finally { fs.rmSync(tempRoot, { recursive: true, force: true }); }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
