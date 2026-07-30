'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  RECORD_KINDS,
  ACTIVE_TENDER_CATEGORIES,
  ACTIVE_TENDER_REFERENCE_CATEGORIES,
  BUSINESS_CATEGORIES,
  BUSINESS_ITEM_TYPES,
  DIRECTORY_PLAN,
  normalizeRecord,
  validateRecord,
  migrateRecord,
  validateProjectTransition,
  planLegacyMigration
} = require('../src/phase1-foundation.js');

const now = '2026-07-30T00:00:00.000Z';
const fixtures = [
  {
    record_kind: 'project', record_id: 'p-1', title: '项目甲', library: 'active_tender',
    state: 'bidding', created_at: now, updated_at: now
  },
  {
    record_kind: 'source_document', record_id: 's-1', title: '招标文件', library: 'active_tender',
    source_path: '投标/甲.pdf', project_ids: ['p-1'], business_item_ids: ['b-1'],
    company_knowledge_ids: ['k-1'], created_at: now, updated_at: now
  },
  {
    record_kind: 'business_item', record_id: 'b-1', title: '钢材报价', library: 'business',
    category: 'quotation_cost', item_type: 'quotation',
    source_document_ids: ['s-1'], related_item_ids: ['b-2'],
    derived_from_ids: ['s-1'], created_at: now, updated_at: now
  },
  {
    record_kind: 'company_knowledge', record_id: 'k-1', title: '报价检查表', library: 'business',
    category: '投标模板', reuse_status: 'approved', source_document_ids: ['s-1'],
    supersedes_id: 'k-0', replaces_id: 'template-old', created_at: now, updated_at: now
  }
];

assert.deepStrictEqual(RECORD_KINDS, fixtures.map((item) => item.record_kind));
for (const fixture of fixtures) {
  const first = migrateRecord(fixture);
  const second = migrateRecord(JSON.parse(JSON.stringify(first)));
  assert.deepStrictEqual(second, first, `${fixture.record_kind} migration must be idempotent`);
  assert(validateRecord(first).valid, `${fixture.record_kind} must round trip`);
}

const unknown = migrateRecord({
  ...fixtures[2],
  future_flag: { enabled: true, levels: [2, 1] },
  extensions: { existing_extension: '保留' }
});
assert.deepStrictEqual(unknown.extensions, {
  existing_extension: '保留',
  future_flag: { enabled: true, levels: [2, 1] }
});
assert.deepStrictEqual(migrateRecord(unknown), unknown, 'safe unknown fields must survive repeated migrations');

assert.strictEqual(validateProjectTransition('lead', 'submitted').allowed, false);
assert.strictEqual(validateProjectTransition('paused', 'archived', {
  archive_outcome: 'paused_by_decision'
}).allowed, false, 'paused archive requires an explicit decision');
assert.strictEqual(validateProjectTransition('paused', 'archived', {
  archive_outcome: 'paused_by_decision', explicit_decision: true
}).allowed, true);
for (const [state, outcome] of [
  ['won', 'won_completed'], ['lost', 'lost'], ['terminated', 'terminated']
]) {
  assert.strictEqual(validateProjectTransition(state, 'archived', {
    archive_outcome: outcome
  }).allowed, true, `${state} archive outcome must be supported`);
}
assert.strictEqual(validateProjectTransition('lost', 'archived', {
  archive_outcome: 'terminated'
}).allowed, false);

const source = migrateRecord(fixtures[1]);
assert.strictEqual(source.record_id, 's-1', 'one source record must retain one identity');
assert.deepStrictEqual(source.project_ids, ['p-1']);
assert.deepStrictEqual(source.business_item_ids, ['b-1']);
assert.deepStrictEqual(source.company_knowledge_ids, ['k-1']);

const expectedActive = [
  ['project_overview', '项目概览'],
  ['opportunity_customer', '商机与客户'],
  ['tender_documents_interpretation', '招标文件与解读'],
  ['site_survey_original_materials', '现场踏勘与原始资料'],
  ['bid_strategy_responsibilities', '投标策略与职责分工'],
  ['technical_solution', '技术方案'],
  ['design_optimization', '设计与优化'],
  ['construction_organization_schedule', '施工组织与进度计划'],
  ['technical_bid', '技术标'],
  ['commercial_quotation_cost', '商务报价与成本'],
  ['procurement_subcontracting', '采购与分包'],
  ['risk_deviation_compliance', '风险、偏差与合规'],
  ['internal_review_decision', '内部评审与决策'],
  ['qa_addenda', '答疑与补遗'],
  ['bid_document_submission_history', '投标文件与提交历史'],
  ['opening_evaluation_award_tracking', '开标、评标与中标跟踪'],
  ['contract_negotiation_signing', '合同谈判与签约'],
  ['review_knowledge_candidates', '复盘与知识候选'],
  ['project_correspondence', '项目往来函件'],
  ['meeting_minutes_decisions', '会议纪要与决议'],
  ['project_material_index', '项目资料索引'],
  ['business_common_knowledge_refs', '引用业务库通用知识'],
  ['business_templates_tools_refs', '引用业务库模板与工具']
];
const expectedBusiness = [
  ['customers', '客户'],
  ['complete_historical_projects', '完整历史项目'],
  ['proposals_cases', '提案与案例'],
  ['quotation_cost', '报价与成本'],
  ['construction_organization_schedules', '施工组织与进度计划'],
  ['risks_issues', '风险与问题'],
  ['failures_terminated_lessons', '失败与终止项目教训'],
  ['talent_experts', '人才与专家'],
  ['suppliers_subcontractors', '供应商与分包商'],
  ['materials_equipment', '材料与设备'],
  ['standards_specifications', '标准与规范'],
  ['contracts_legal', '合同与法务'],
  ['technical_methods_workmanship', '技术方法与工艺'],
  ['quality_acceptance', '质量与验收'],
  ['safety_civilized_construction', '安全与文明施工'],
  ['correspondence_important_decisions', '往来函件与重要决策'],
  ['company_systems_processes', '公司制度与流程'],
  ['market_competition_intelligence', '市场与竞争情报'],
  ['templates_tools', '模板与工具'],
  ['terminology_general_knowledge', '术语与通用知识']
];
const expectedItemTypes = [
  ['requirement', '要求'], ['decision', '决策'], ['commitment', '承诺'],
  ['risk', '风险'], ['issue', '问题'], ['change', '变更'], ['action', '行动'],
  ['quotation', '报价'], ['material', '材料'], ['method', '方法'],
  ['acceptance_criterion', '验收标准'], ['clarification', '澄清'],
  ['contract_obligation', '合同义务'], ['project_lesson', '项目教训']
];
const keyLabels = (items) => items.map(({ key, label }) => [key, label]);
assert.deepStrictEqual(
  keyLabels([...ACTIVE_TENDER_CATEGORIES, ...ACTIVE_TENDER_REFERENCE_CATEGORIES]),
  expectedActive
);
assert.deepStrictEqual(keyLabels(BUSINESS_CATEGORIES), expectedBusiness);
assert.deepStrictEqual(keyLabels(BUSINESS_ITEM_TYPES), expectedItemTypes);
const active = DIRECTORY_PLAN.libraries.find((item) => item.key === 'active_tender');
const business = DIRECTORY_PLAN.libraries.find((item) => item.key === 'business');
assert.deepStrictEqual(keyLabels(active.categories), expectedActive);
assert.deepStrictEqual(keyLabels(business.categories), expectedBusiness);
for (const library of DIRECTORY_PLAN.libraries) {
  assert.strictEqual(
    new Set(library.categories.map((item) => item.key)).size,
    library.categories.length,
    `${library.key} category keys must be unique`
  );
  assert.strictEqual(
    new Set(library.categories.map((item) => item.label)).size,
    library.categories.length,
    `${library.key} category labels must be unique`
  );
}
const references = active.categories.filter((item) => item.storage === 'reference');
assert.deepStrictEqual(references.map((item) => item.key), [
  'business_common_knowledge_refs', 'business_templates_tools_refs'
]);
assert(active.categories.slice(0, -2).every((item) => item.storage === 'owned'));
assert(references.every((item) => item.target_library === 'business'));
assert.deepStrictEqual(references.map((item) => item.target_category), [
  'terminology_general_knowledge', 'templates_tools'
]);
assert.strictEqual(DIRECTORY_PLAN.mode, 'definitions_only');
assert.strictEqual(DIRECTORY_PLAN.auto_create_or_move, false);

const planJson = JSON.parse(fs.readFileSync(
  path.join(__dirname, '..', '组件包', 'two-library-plan.json'), 'utf8'
));
assert.deepStrictEqual(planJson, DIRECTORY_PLAN, 'runtime directory definitions and JSON must agree exactly');

const itemWithoutClassification = migrateRecord({
  record_kind: 'business_item', record_id: 'b-optional', title: '待分类条目',
  library: 'active_tender', created_at: now, updated_at: now
});
assert.strictEqual(itemWithoutClassification.category, undefined);
assert.strictEqual(itemWithoutClassification.item_type, undefined);
assert(validateRecord(itemWithoutClassification).valid);
assert(validateRecord({ ...itemWithoutClassification, category: 'quotation_cost' }).valid === false);
assert(validateRecord({
  ...itemWithoutClassification, category: 'commercial_quotation_cost', item_type: 'quotation'
}).valid);
assert(validateRecord({ ...itemWithoutClassification, item_type: 'unknown_type' }).valid === false);

const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'eks-phase1-'));
const sentinel = path.join(sandbox, 'untouched.txt');
fs.writeFileSync(sentinel, '不应改变');
const before = fs.readdirSync(sandbox).sort();
let providerCalls = 0;
const report = planLegacyMigration({
  cards: [{ card_id: 'c-1', title: '旧经验', project: '项目甲' }],
  tasks: [{ task_id: 't-1', source_path: '旧资料/甲.pdf' }],
  projects: [
    { project_id: 'p-won', state: 'won', archive_outcome: 'won_completed' },
    { project_id: 'p-paused', state: 'paused', archive_outcome: 'paused_by_decision' }
  ],
  requestJson: () => { providerCalls += 1; }
});
assert.deepStrictEqual(fs.readdirSync(sandbox).sort(), before, 'dry run must not write');
assert.strictEqual(fs.readFileSync(sentinel, 'utf8'), '不应改变');
assert.strictEqual(report.writes_performed, 0);
assert.strictEqual(report.deletes_performed, 0);
assert.strictEqual(report.provider_calls, 0);
assert.strictEqual(providerCalls, 0, 'planning must never invoke a provided provider callback');
assert(report.actions.some((item) => item.action === 'archive_complete_project'));
assert(report.actions.some((item) => item.action === 'extract_reusable_knowledge'));
assert(report.actions.every((item) => item.preserves_source));
assert.strictEqual(
  report.actions.find((item) => item.source_ref === 'legacy-project:p-paused').ready,
  false,
  'legacy paused projects cannot be archived without an explicit decision'
);
fs.rmSync(sandbox, { recursive: true, force: true });

for (const file of [
  'project-v1.schema.json', 'source-document-v1.schema.json',
  'business-item-v1.schema.json', 'company-knowledge-v1.schema.json'
]) {
  JSON.parse(fs.readFileSync(path.join(__dirname, '..', '组件包', 'schemas', file), 'utf8'));
}
const businessItemSchema = JSON.parse(fs.readFileSync(
  path.join(__dirname, '..', '组件包', 'schemas', 'business-item-v1.schema.json'), 'utf8'
));
assert(!businessItemSchema.required.includes('category'));
assert(!businessItemSchema.required.includes('item_type'));
assert.deepStrictEqual(
  businessItemSchema.properties.item_type.enum,
  BUSINESS_ITEM_TYPES.map((item) => item.key)
);
assert.deepStrictEqual(
  businessItemSchema.allOf[0].then.properties.category.enum,
  expectedActive.map(([key]) => key)
);
assert.deepStrictEqual(
  businessItemSchema.allOf[1].then.properties.category.enum,
  expectedBusiness.map(([key]) => key)
);
assert.deepStrictEqual(
  businessItemSchema.properties.category.enum,
  [...expectedActive, ...expectedBusiness].map(([key]) => key)
);

console.log('phase1-foundation: ok');
