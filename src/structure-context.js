'use strict';

const crypto = require('crypto');
const STRUCTURE_VERSION = 'structure-context/2.0';
const NODE_KINDS = new Set(['document', 'section', 'heading', 'paragraph', 'list', 'list_item', 'table', 'table_row', 'table_cell', 'figure', 'caption', 'email_message', 'quote', 'signature', 'attachment']);
const EDGE_KINDS = new Set(['parent', 'child', 'continuation_of', 'continues']);
const ORIGINS = new Set(['native', 'parser', 'inferred']);
const hash = (value) => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 24);
const text = (value, max = 300) => String(value || '').normalize('NFKC').trim().slice(0, max);
const confidence = (value, fallback) => Number.isFinite(Number(value)) ? Math.max(0, Math.min(1, Number(value))) : fallback;

function fail(message) { throw Object.assign(new Error(message), { code: 'STRUCTURE_CONTEXT_INVALID' }); }
function nodeKind(block) {
  const kind = text(block.kind, 40);
  if (NODE_KINDS.has(kind)) return kind;
  if (kind === 'spreadsheet_cell') return 'table_cell';
  if (kind === 'email_body' || kind === 'email_subject' || kind === 'email_envelope') return 'email_message';
  if (kind === 'email_thread') return 'quote';
  if (kind === 'image_metadata' || kind === 'figure_metadata') return 'figure';
  if (kind === 'page' || kind === 'page-text' || kind === 'parsed-markdown' || kind === 'text' || kind === 'key_value' || kind === 'speaker_note') return 'paragraph';
  return 'paragraph';
}
function identity(block) {
  const locator = block.locator || {};
  return {
    block_id: block.block_id, source_block_ids: Array.isArray(block.metadata?.source_block_ids) ? block.metadata.source_block_ids.map(String) : [block.block_id], span_id: text(block.metadata?.span_id || locator.value, 500),
    page: locator.page || block.metadata?.page || null, sheet: locator.sheet || block.metadata?.sheet || null,
    slide: locator.slide || block.metadata?.slide || null, message: locator.message_id || block.metadata?.message_id || null,
    attachment: locator.attachment_id || block.metadata?.attachment_id || null
  };
}
function structureFields(block) {
  const m = block.metadata || {}; const list = m.list || {}; const locator = block.locator || {};
  return {
    heading_level: Number.isInteger(m.outline_level) ? m.outline_level + 1 : Number.isInteger(m.heading_level) ? m.heading_level : null,
    numbering_token: text(m.numbering_token || list.token || list.template, 80), numbering_path: Array.isArray(m.numbering_path) ? m.numbering_path.map(String) : [],
    list_id: text(m.list_id || list.num_id, 120), list_level: Number.isInteger(m.list_level) ? m.list_level : Number.isInteger(m.level) ? m.level : Number.isInteger(list.level) ? list.level : null,
    ordinal: Number.isInteger(m.ordinal) ? m.ordinal : null, parent_clause: text(m.parent_clause_id, 160),
    table_id: text(m.table_id || (m.table ? `table-${m.table}` : ''), 120), row_id: text(m.row_id || (m.row ? `row-${m.row}` : ''), 120),
    header_paths: Array.isArray(m.table_headers) ? m.table_headers.map(String) : Array.isArray(m.header_paths) ? m.header_paths.map(String) : [],
    cell_range: text(m.cell_range || m.coordinate || locator.range, 80), units: Array.isArray(m.units) ? m.units.map(String) : text(m.unit, 40) ? [text(m.unit, 40)] : []
  };
}
function originFor(block) {
  const explicit = text(block.metadata?.structure_origin || block.inferred?.structure_origin, 20);
  if (ORIGINS.has(explicit)) return explicit;
  if (block.metadata?.migrated_legacy || block.metadata?.generated_fallback) return 'inferred';
  return /ooxml|eml|msg|text-block/.test(text(block.parse_method || block.parse?.method, 80)) ? 'native' : 'parser';
}
function buildStructureContext(source, blocks) {
  const sourceId = text(source.source_document_id || source.source_identity || source.source_hash, 300) || 'anonymous-source';
  const documentId = `str-${hash(['document', sourceId])}`;
  const nodes = [{ node_id: documentId, kind: 'document', source_identity: { block_id: `document:${sourceId}`, span_id: '' }, parent_id: null, children: [], order: -1, origin: 'parser', confidence: 1, uncertainty: [], fields: {} }];
  const byBlock = new Map(); const headingStack = []; const listParents = new Map(); const tableParents = new Map(); const rowParents = new Map();
  const addVirtual = (kind, key, parentId, order, origin = 'parser') => {
    const nodeId = `str-${hash([sourceId, kind, key])}`;
    if (!nodes.some((n) => n.node_id === nodeId)) nodes.push({ node_id: nodeId, kind, source_identity: { block_id: `virtual:${key}`, span_id: '' }, parent_id: parentId, children: [], order: order - 0.1, origin, confidence: origin === 'inferred' ? 0.65 : 0.95, uncertainty: origin === 'inferred' ? ['legacy_or_layout_inference'] : [], fields: {} });
    return nodeId;
  };
  for (const block of blocks) {
    const kind = nodeKind(block); const fields = structureFields(block); const origin = originFor(block);
    let parentId = documentId;
    if (kind === 'heading' || kind === 'section') {
      const level = fields.heading_level || 1;
      while (headingStack.length >= level) headingStack.pop();
      parentId = headingStack.at(-1) || documentId;
    } else if (fields.table_id || kind === 'table_cell' || kind === 'table_row') {
      const tableKey = `${fields.table_id || (block.metadata?.sheet ? 'sheet-grid' : 'table')}:${block.metadata?.sheet || block.metadata?.slide || block.metadata?.part || ''}`;
      if (!tableParents.has(tableKey)) tableParents.set(tableKey, addVirtual('table', tableKey, headingStack.at(-1) || documentId, block.order, origin));
      parentId = tableParents.get(tableKey);
      if (kind === 'table_cell') {
        const rowKey = `${tableKey}:${fields.row_id || block.metadata?.row || 'unknown-row'}`;
        if (!rowParents.has(rowKey)) rowParents.set(rowKey, addVirtual('table_row', rowKey, parentId, block.order, origin));
        parentId = rowParents.get(rowKey);
      }
    } else if (kind === 'list_item') {
      const listKey = fields.list_id || `legacy-list:${headingStack.at(-1) || documentId}`;
      if (!listParents.has(listKey)) listParents.set(listKey, addVirtual('list', listKey, headingStack.at(-1) || documentId, block.order, fields.list_id ? origin : 'inferred'));
      parentId = listParents.get(listKey);
      const level = fields.list_level || 0;
      if (level > 0) {
        const prior = [...nodes].reverse().find((n) => n.kind === 'list_item' && n.fields.list_id === fields.list_id && (n.fields.list_level ?? 0) < level);
        if (prior) parentId = prior.node_id;
      }
    } else parentId = text(block.parent_id, 160) && byBlock.get(text(block.parent_id, 160)) || headingStack.at(-1) || documentId;
    const node = { node_id: `str-${hash([sourceId, block.block_id])}`, kind, source_identity: identity(block), parent_id: parentId, children: [], order: block.order, origin, confidence: confidence(block.metadata?.structure_confidence ?? block.parse_quality ?? block.parse?.quality, origin === 'inferred' ? 0.55 : 0.95), uncertainty: origin === 'inferred' ? ['relation_not_native'] : [], fields };
    nodes.push(node); byBlock.set(block.block_id, node.node_id);
    if (kind === 'heading' || kind === 'section') headingStack.push(node.node_id);
  }
  for (const node of nodes) if (node.parent_id) nodes.find((n) => n.node_id === node.parent_id)?.children.push(node.node_id);
  const edges = [];
  for (const node of nodes) if (node.parent_id) edges.push({ edge_id: `edge-${hash(['parent', node.node_id, node.parent_id])}`, kind: 'parent', from: node.node_id, to: node.parent_id, reason: 'hierarchy', confidence: node.confidence, origin: node.origin });
  for (const block of blocks) {
    const from = byBlock.get(block.block_id); const targetBlock = text(block.metadata?.continuation_of || block.inferred?.continuation_of, 160);
    if (targetBlock && byBlock.has(targetBlock)) {
      const to = byBlock.get(targetBlock); const c = confidence(block.metadata?.continuation_confidence || block.inferred?.continuation_confidence, 0.5);
      edges.push({ edge_id: `edge-${hash(['continuation', from, to])}`, kind: 'continuation_of', from, to, reason: text(block.metadata?.continuation_reason, 120) || 'parser_continuation', confidence: c, origin: originFor(block) });
      edges.push({ edge_id: `edge-${hash(['continues', to, from])}`, kind: 'continues', from: to, to: from, reason: text(block.metadata?.continuation_reason, 120) || 'parser_continuation', confidence: c, origin: originFor(block) });
    }
  }
  return validateStructureContext({ schema_version: STRUCTURE_VERSION, source_document_id: sourceId, nodes, edges, adapter: text(source.parser || source.metadata?.parser, 80) || 'canonical-block-v0', legacy_precision: blocks.some((b) => b.metadata?.migrated_legacy) ? 'explicitly-limited' : 'not-applicable' });
}
function validateStructureContext(graph) {
  if (!graph || graph.schema_version !== STRUCTURE_VERSION || !Array.isArray(graph.nodes) || !Array.isArray(graph.edges)) fail('结构契约版本或集合无效');
  const ids = new Set();
  for (const node of graph.nodes) {
    if (!node.node_id || ids.has(node.node_id) || !NODE_KINDS.has(node.kind) || !node.source_identity?.block_id || !ORIGINS.has(node.origin)) fail('结构节点身份、类型或来源无效');
    if (!Number.isFinite(node.confidence) || node.confidence < 0 || node.confidence > 1) fail('结构节点置信度无效');
    ids.add(node.node_id);
  }
  for (const node of graph.nodes) if (node.parent_id && (!ids.has(node.parent_id) || node.parent_id === node.node_id)) fail('结构父关系无效');
  for (const edge of graph.edges) if (!EDGE_KINDS.has(edge.kind) || !ids.has(edge.from) || !ids.has(edge.to) || edge.from === edge.to) fail('结构边无效');
  const parent = new Map(graph.nodes.map((n) => [n.node_id, n.parent_id]));
  for (const id of ids) { const seen = new Set([id]); let cursor = parent.get(id); while (cursor) { if (seen.has(cursor)) fail('结构层级存在环'); seen.add(cursor); cursor = parent.get(cursor); } }
  return graph;
}

module.exports = { STRUCTURE_VERSION, NODE_KINDS, EDGE_KINDS, buildStructureContext, validateStructureContext };
