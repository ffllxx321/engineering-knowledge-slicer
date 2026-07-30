'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {
  DEFAULT_LIMITS,
  ITEM_TYPES,
  eligibleBlocks,
  localRoute,
  consolidateCandidates,
  runPhase2CandidatePipeline
} = require('../src/phase2-candidate-pipeline.js');

const root = path.join(__dirname, '..');
const locator = (scheme, value, extra = {}) => ({ scheme, value, ...extra });
let blockSequence = 0;
function block(text, options = {}) {
  blockSequence += 1;
  const loc = options.locator || locator('page', String(blockSequence), { page: blockSequence });
  return {
    schema_version: 'block_v0',
    block_id: options.block_id || `block-${String(blockSequence).padStart(24, '0')}`,
    source_hash: 'a'.repeat(64),
    order: blockSequence,
    parent_id: options.parent_id || null,
    kind: options.kind || 'paragraph',
    locator: loc,
    provenance: options.provenance || [loc],
    raw: { text, fields: options.fields || {} },
    inferred: options.inferred || {},
    parse: { method: options.method || 'synthetic', quality: 0.9, status: options.status || 'present' },
    card_eligible: options.card_eligible !== false,
    exclusion_reason: options.exclusion_reason || null,
    metadata: options.metadata || {}
  };
}

function documentWith(blocks, metadata = {}, filename = 'neutral-001.bin') {
  return {
    source_document_id: `source-${blockSequence}`,
    filename,
    source_type: 'normalized',
    metadata,
    blocks
  };
}

const registry = [
  { project_id: 'project-1', name: 'Registry Alpha', aliases: ['RA-01'], references: ['REF-100'] },
  { project_id: 'project-2', name: 'Registry Beta', aliases: ['SHARED'] },
  { project_id: 'project-3', name: 'Registry Gamma', aliases: ['SHARED'] }
];

async function main() {
  const structuralPatterns = [
    block('Alpha prose in a manual section.', { kind: 'paragraph', inferred: { heading: 'Section 4' } }),
    block('Clause text with normative modality.', { kind: 'clause' }),
    block('Row value 17 u.', { kind: 'table_row', metadata: { table_row_id: 'row-1' } }),
    block('Row value 19 u.', { kind: 'table_row', metadata: { table_row_id: 'row-2' } }),
    block('Sheet row amount 23.', {
      kind: 'spreadsheet_row',
      locator: locator('sheet-range', 'S1!A3:D3', { sheet: 'S1', range: 'A3:D3', row: 3 })
    }),
    block('Message records a decision.', {
      kind: 'email_message',
      locator: locator('email-message', 'msg-1', { message_id: 'msg-1', attachment_id: 'att-1' }),
      metadata: { email_message_id: 'msg-1', attachment_id: 'att-1' }
    }),
    block('扫描识别段落。', { method: 'ocr' }),
    block('条件付きの記録。 Mixed texte.', { method: 'ocr' })
  ];
  assert.strictEqual(eligibleBlocks([
    ...structuralPatterns,
    block('header', { metadata: { noise: true } }),
    block('', {}),
    block('failed', { status: 'extraction_failed' }),
    block('not eligible', { card_eligible: false })
  ]).length, structuralPatterns.length);

  const exact = localRoute(documentWith(structuralPatterns, {
    project_reference: 'REF-100',
    library: 'active_tender',
    directory_category: 'project_overview',
    document_role: 'source_record',
    version_label: 'v2',
    supersedes_document_id: 'source-old'
  }), structuralPatterns, registry);
  assert.strictEqual(exact.project_id, 'project-1');
  assert.strictEqual(exact.resolved, true);
  assert.strictEqual(exact.version_label, 'v2');
  assert.strictEqual(exact.supersedes_document_id, 'source-old');

  const ambiguousBlock = block('Neutral.', { metadata: { project_name: 'SHARED' } });
  const ambiguous = localRoute(documentWith([ambiguousBlock]), [ambiguousBlock], registry);
  assert(ambiguous.review_reasons.includes('ambiguous_project'));
  assert.strictEqual(ambiguous.project_id, undefined);

  const unknown = localRoute(documentWith([block('Unknown document.')]), [], registry);
  assert.strictEqual(unknown.resolved, false);
  assert.strictEqual(unknown.project_id, undefined);

  let routingCalls = 0;
  const routedUnknown = await runPhase2CandidatePipeline({
    document: documentWith([block('Unclassified multilingual 未分類.')]),
    projectRegistry: registry,
    requestJson: async (request) => {
      routingCalls += 1;
      assert.strictEqual(request.kind, 'phase2_document_route');
      return {
        project_id: 'invented-project',
        library: 'business',
        directory_category: 'risks_issues',
        document_role: 'reference',
        confidence: 0.6,
        reasons: ['Model candidate']
      };
    },
    limits: { max_extraction_requests: 0 }
  });
  assert.strictEqual(routingCalls, 1, 'routing may call the provider at most once');
  assert.strictEqual(routedUnknown.route.project_id, undefined, 'provider cannot invent a project');
  assert(routedUnknown.route.review_reasons.includes('unsupported_invented_facts'));

  let calls = 0;
  const dry = await runPhase2CandidatePipeline({
    document: documentWith(structuralPatterns),
    projectRegistry: registry,
    requestJson: null
  });
  assert.strictEqual(dry.counters.total_provider_requests, 0);
  assert.strictEqual(calls, 0);
  assert.strictEqual(dry.writes_performed, 0);
  assert.strictEqual(dry.deletes_performed, 0);
  assert.strictEqual(dry.state_transitions_performed, 0);
  assert.deepStrictEqual(dry.business_item_batch.items, []);
  const noiseOnly = await runPhase2CandidatePipeline({
    document: documentWith([
      block('decorative', { metadata: { structural_noise: true } }),
      block('', {})
    ])
  });
  assert.strictEqual(noiseOnly.counters.eligible_blocks, 0);
  assert.strictEqual(noiseOnly.counters.total_provider_requests, 0);

  const extractionBlocks = [
    block('Record A has value 17 u under condition north.', {
      kind: 'table_row', metadata: { table_row_id: 'r-a' }
    }),
    block('Record A has value 19 u under condition south.', {
      kind: 'table_row', metadata: { table_row_id: 'r-b' }
    }),
    block('We will complete action Z on 2099-01-02.', {
      kind: 'email_message', metadata: { email_message_id: 'm-a' },
      locator: locator('email-message', 'm-a', { message_id: 'm-a' })
    }),
    block('Attachment is separately located.', {
      kind: 'attachment', metadata: { email_message_id: 'm-a', attachment_id: 'a-a' },
      locator: locator('email-attachment', 'a-a', { message_id: 'm-a', attachment_id: 'a-a' })
    })
  ];
  const extractDoc = documentWith(extractionBlocks, {
    project_id: 'project-1',
    library: 'business',
    directory_category: 'risks_issues',
    document_role: 'commercial_record'
  });
  const seen = [];
  const provider = async (request) => {
    calls += 1;
    seen.push(request);
    if (request.kind === 'phase2_business_item_extract') {
      return {
        items: request.input.blocks.map((source, index) => ({
          item_type: index < 2 ? 'quotation' : 'action',
          summary: index < 2 ? 'Record A' : `Message ${index}`,
          block_id: source.block_id,
          evidence: { block_id: source.block_id, verbatim: source.text },
          facts: index < 2
            ? { numbers: [index === 0 ? '17' : '19'], units: ['u'] }
            : { dates: index === 2 ? ['2099-01-02'] : [] },
          applicable_conditions: index < 2 ? [index === 0 ? 'north' : 'south'] : [],
          reusable_knowledge_candidate: index === 2,
          reuse_reasons: index === 2 ? ['May apply again'] : []
        }))
      };
    }
    return {};
  };
  calls = 0;
  const extracted = await runPhase2CandidatePipeline({
    document: extractDoc,
    projectRegistry: registry,
    requestJson: provider,
    limits: { max_blocks_per_batch: 10, max_extraction_requests: 2 }
  });
  assert.strictEqual(extracted.counters.routing_requests, 0);
  assert.strictEqual(extracted.counters.extraction_requests, 1);
  assert.strictEqual(extracted.counters.repair_requests, 0);
  assert.strictEqual(calls, 1);
  assert.strictEqual(extracted.business_item_batch.items.length, 4);
  const conflicting = extracted.business_item_batch.items.filter((item) => item.summary === 'Record A');
  assert.strictEqual(conflicting.length, 2, 'conflicting table rows must stay separate');
  assert(conflicting.every((item) => item.review_reasons.includes('conflicting_facts')));
  assert(extracted.business_item_batch.items.some((item) =>
    item.review_reasons.includes('reuse_promotion')));
  assert(!extracted.review_summary.trim().startsWith('{'));
  assert(extracted.review_summary.includes('来源'));
  assert(extracted.review_summary.includes('可选操作'));

  let repairCalls = 0;
  const repaired = await runPhase2CandidatePipeline({
    document: documentWith([block('Verbatim repair evidence.')], {
      library: 'business',
      directory_category: 'risks_issues',
      document_role: 'source_record'
    }),
    requestJson: async (request) => {
      if (request.kind === 'phase2_business_item_extract') return { invalid: true };
      if (request.kind === 'phase2_quality_repair') {
        repairCalls += 1;
        const source = request.input.blocks[0];
        return { items: [{
          item_type: 'issue', block_id: source.block_id, summary: 'Repair',
          evidence: { verbatim: source.text }, reusable_knowledge_candidate: false
        }] };
      }
      return {};
    },
    limits: { max_extraction_requests: 1 }
  });
  assert.strictEqual(repairCalls, 1);
  assert.strictEqual(repaired.counters.repair_requests, 1);
  assert.strictEqual(repaired.business_item_batch.items.length, 1);

  const largeBlocks = Array.from({ length: 25 }, (_, index) => block(`Synthetic record ${index}.`));
  let largeCalls = 0;
  const large = await runPhase2CandidatePipeline({
    document: documentWith(largeBlocks, {
      library: 'business',
      directory_category: 'risks_issues',
      document_role: 'source_record'
    }),
    requestJson: async (request) => {
      largeCalls += 1;
      assert.strictEqual(request.kind, 'phase2_business_item_extract');
      return { items: [] };
    },
    limits: { max_blocks_per_batch: 4, max_extraction_requests: 3 },
    resumeFromBatch: 2
  });
  assert.strictEqual(large.counters.planned_batches, 7);
  assert.strictEqual(large.counters.processed_batches, 3);
  assert.strictEqual(largeCalls, 3);
  assert.deepStrictEqual(seen.filter((request) => request.kind === 'phase2_business_item_extract').length, 1);

  const baseCandidate = (id, row, numbers, conditions, message = '') => ({
    candidate_id: id,
    source_document_id: 's',
    item_type: 'requirement',
    summary: 'Same normalized summary',
    evidence: { block_id: `b-${row}`, verbatim: 'Same evidence', locator: locator('row', row) },
    applicable_conditions: conditions,
    facts: { numbers },
    reuse_reasons: [],
    review_reasons: [],
    _boundary: {
      locator_key: `row:${row}`, table_row_id: row, email_message_id: message,
      explicit_same_item_id: ''
    }
  });
  const consolidated = consolidateCandidates([
    baseCandidate('1', '1', ['1'], ['if A']),
    baseCandidate('2', '1', ['1'], ['if A']),
    baseCandidate('3', '2', ['2'], ['if B'])
  ]);
  assert.strictEqual(consolidated.length, 2, 'duplicate paraphrases in one identity collapse');
  assert(consolidated.every((item) => item.review_reasons.includes('conflicting_facts')));

  for (const schema of [
    'phase2-routing-result-v2.schema.json',
    'phase2-business-item-candidate-batch-v2.schema.json'
  ]) JSON.parse(fs.readFileSync(path.join(root, '组件包', 'schemas', schema), 'utf8'));

  assert.strictEqual(DEFAULT_LIMITS.max_blocks_per_batch, 12);
  assert.strictEqual(DEFAULT_LIMITS.max_extraction_requests, 8);
  assert.strictEqual(ITEM_TYPES.length, 14);
  const productionText = [
    fs.readFileSync(path.join(root, 'src', 'phase2-candidate-pipeline.js'), 'utf8'),
    ...fs.readdirSync(path.join(root, '组件包', '提示词', 'phase2'))
      .map((name) => fs.readFileSync(path.join(root, '组件包', '提示词', 'phase2', name), 'utf8'))
  ].join('\n');
  for (const forbidden of [
    'Registry Alpha', 'RA-01', 'REF-100', 'Record A', 'condition north',
    '2099-01-02', 'Verbatim repair evidence', 'Synthetic record'
  ]) assert(!productionText.includes(forbidden), `synthetic fixture leaked: ${forbidden}`);

  console.log('phase2-candidate-pipeline: ok');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
