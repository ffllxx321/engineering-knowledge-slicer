// v2.9.2 烟雾测试：针对 2026-07-20/23/24 诊断日志暴露的三个线上故障的回归。
//   #62 SSE 路径 requestMiniMaxStream ReferenceError（漏导出/漏导入）
//   #63 上传确认弹窗确认后仍被 runEngine 旧快照门拒绝（每次重启后首次确认失效）
//   #64 原子化归一化：AI 未写 content.point_ids 导致多知识点批次原子被全部丢弃
// 运行：node scripts/smoke-v292.js

const fs = require('fs');
const path = require('path');
const { loadAiPipeline } = require('./load-ai-pipeline.js');

let passed = 0;
let failed = 0;
function assert(cond, name) {
  if (cond) { passed += 1; console.log('  ok - ' + name); }
  else { failed += 1; console.error('  FAIL - ' + name); }
}

const MAIN = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf-8');

async function main() {
// ---------------------------------------------------------------------------
// #62 SSE：requestMiniMaxStream 必须既从 ai-pipeline 导出，又在 main.js 顶层导入
// ---------------------------------------------------------------------------
console.log('#62 SSE requestMiniMaxStream 作用域');
{
  const { api } = loadAiPipeline();
  assert(typeof api.requestMiniMaxStream === 'function', 'ai-pipeline 导出 requestMiniMaxStream 函数');
  assert(typeof api.requestMiniMaxJson === 'function', 'ai-pipeline 仍导出 requestMiniMaxJson');
  // 顶层必须把它 require 进来，否则插件类 line ~907 引用会抛 ReferenceError
  const destructure = MAIN.match(/const\s*\{[^}]*\}\s*=\s*require\("src\/core\/ai-pipeline\.js"\)/);
  assert(!!destructure && /requestMiniMaxStream/.test(destructure[0]), 'main.js 顶层 require 解构包含 requestMiniMaxStream');
  assert(!!destructure && /requestMiniMaxJson/.test(destructure[0]), 'main.js 顶层 require 解构仍包含 requestMiniMaxJson');
}

// ---------------------------------------------------------------------------
// #64 原子化归属：normalizeAtomBatch 单元 + atomizeSummary 端到端
// ---------------------------------------------------------------------------
console.log('#64 原子化 content.point_ids 归属');
{
  const { api, diagCalls } = loadAiPipeline();
  const summary = {
    document_title: '测试文档',
    key_points: [
      { point_id: 'P1', content: '知识点一', evidence_ids: ['E1'] },
      { point_id: 'P2', content: '知识点二', evidence_ids: ['E2'] },
      { point_id: 'P3', content: '知识点三', evidence_ids: ['E3'] }
    ],
    evidence: [
      { evidence_id: 'E1', locator: 'L1', quote: 'Q1' },
      { evidence_id: 'E2', locator: 'L2', quote: 'Q2' },
      { evidence_id: 'E3', locator: 'L3', quote: 'Q3' }
    ]
  };
  const pointIds = ['P1', 'P2', 'P3'];
  function atom(id, pid, opts) {
    const a = {
      atom_id: id, title: 't' + id, card_kind: 'static', library: 'business', folder_type: 'f',
      content: { core_knowledge: 'k' + id },
      source: { source_link: '[[s]]', source_locator: 'loc', evidence_quote: 'q', parent_summary: '[[p]]' },
      model_confidence: 0.9, validation_issues: []
    };
    if (opts === 'content') a.content.point_ids = [pid];
    else if (opts === 'top') a.point_ids = [pid];
    // opts === 'none' → 无归属
    return a;
  }

  // 1) content.point_ids（契约位置）→ 全部保留并正确归属
  let r = api.normalizeAtomBatch({ atoms: [atom('a', 'P1', 'content'), atom('b', 'P2', 'content'), atom('c', 'P3', 'content')] }, summary, pointIds);
  assert(r.atoms.length === 3, 'content.point_ids 归属：3/3 原子保留');
  assert(r.atoms[0].content.point_ids[0] === 'P1' && r.atoms[2].content.point_ids[0] === 'P3', '归属到正确知识点');
  assert(r.atoms[0].source.evidence_quote === 'Q1', '归属后证据摘录取自对应知识点证据');

  // 2) 顶层 point_ids（模型把归属写错位置）→ 兼容保留
  r = api.normalizeAtomBatch({ atoms: [atom('a', 'P1', 'top'), atom('b', 'P2', 'top'), atom('c', 'P3', 'top')] }, summary, pointIds);
  assert(r.atoms.length === 3, '顶层 point_ids 兼容：3/3 原子保留');

  // 3) 无归属 + 多知识点批次，但原子数量与知识点数量一致 → 按批次顺序安全补齐
  diagCalls.length = 0;
  r = api.normalizeAtomBatch({ atoms: [atom('a', 'P1', 'none'), atom('b', 'P2', 'none'), atom('c', 'P3', 'none')] }, summary, pointIds);
  const normDiag = diagCalls.find((d) => d.scope === 'atomization.normalize');
  assert(r.atoms.length === 3, '无归属多知识点批次：数量一致时按顺序补齐 3/3');
  assert(r.atoms[0].content.point_ids[0] === 'P1' && r.atoms[2].content.point_ids[0] === 'P3', '顺序补齐到对应知识点');
  assert(!normDiag || normDiag.payload.droppedNoPointAttribution === 0, '顺序补齐后不再记为无归属丢弃');

  // 4) 单知识点批次无归属 → 自动归属（既有兜底不受影响）
  r = api.normalizeAtomBatch({ atoms: [atom('a', 'P1', 'none')] }, { key_points: [summary.key_points[0]], evidence: [summary.evidence[0]] }, ['P1']);
  assert(r.atoms.length === 1, '单知识点批次无归属：自动归属保留');

  // 5) 错误 point_id → droppedPointIdMismatch
  diagCalls.length = 0;
  r = api.normalizeAtomBatch({ atoms: [atom('a', 'ZZZ', 'content')] }, summary, pointIds);
  const mm = diagCalls.find((d) => d.scope === 'atomization.normalize');
  assert(r.atoms.length === 0 && !!mm && mm.payload.droppedPointIdMismatch === 1, '错误 point_id：记 droppedPointIdMismatch');

  // 6) 端到端：atomizeSummary 的 prompt 必须显式要求 content.point_ids，且带归属的返回能全部入库
  let capturedPrompt = '';
  const goodBatch = {
    atoms: [atom('a', 'P1', 'content'), atom('b', 'P2', 'content'), atom('c', 'P3', 'content')],
    coverage: { point_ids: ['P1', 'P2', 'P3'], complete: true },
    schema_version: '1.1'
  };
  const result = await api.atomizeSummary({
    summary,
    atomPrompt: 'ATOM_PROMPT_BASE',
    typeMapping: 'TM', tagLibrary: 'TL', linkCandidates: [],
    atomSchema: { type: 'object', properties: { schema_version: { const: '1.1' } } },
    maxPointsPerRequest: 3, atomizationConcurrency: 1,
    requestJson: async (prompt) => { capturedPrompt = prompt; return JSON.stringify(goodBatch); }
  });
  assert(/content\.point_ids/.test(capturedPrompt), '原子化 prompt 显式要求 content.point_ids');
  assert(/ATOM_PROMPT_BASE/.test(capturedPrompt), '基础原子 prompt 仍被注入');
  assert(Array.isArray(result.atoms) && result.atoms.length === 3, '带归属的 AI 返回：3/3 入库');

  // 7) 顶层归属的端到端兼容
  const topBatch = {
    atoms: [atom('a', 'P1', 'top'), atom('b', 'P2', 'top'), atom('c', 'P3', 'top')],
    coverage: { point_ids: ['P1', 'P2', 'P3'], complete: true }, schema_version: '1.1'
  };
  const result2 = await api.atomizeSummary({
    summary, atomPrompt: 'B', typeMapping: 'TM', tagLibrary: 'TL', linkCandidates: [],
    atomSchema: { type: 'object', properties: { schema_version: { const: '1.1' } } },
    maxPointsPerRequest: 3, atomizationConcurrency: 1,
    requestJson: async () => JSON.stringify(topBatch)
  });
  assert(result2.atoms.length === 3, '顶层归属端到端：3/3 入库');
}

// ---------------------------------------------------------------------------
// #63 上传确认：弹窗确认后必须回写 config.allowExternalUpload，runEngine 才放行
// ---------------------------------------------------------------------------
console.log('#63 上传确认竞态');
{
  const goodText = '这是一段足够长的可读 Markdown 内容，用于通过 isUsableMarkdown 校验。ABC def 123。';

  // a) 配置创建时 allowExternalUpload=false（本会话尚未授权），弹窗确认 true
  //    → 回写 allowExternalUpload → runEngine 真实闸门放行 → runMineruApi 被调用
  {
    let mineruCalled = false;
    const ext = loadExternalPdf({
      mineru: async () => { mineruCalled = true; return { status: 'ok', text: goodText }; }
    });
    const cfg = { confirmUploads: true, allowExternalUpload: false, order: 'mineru-api', fileName: 'x.pdf' };
    globalThis.__eksUploadConfirm = async () => true;
    const okRes = await ext.extractDocumentWithApis(Buffer.from('fake-pdf'), cfg);
    assert(cfg.allowExternalUpload === true, '确认后 config.allowExternalUpload 被回写为 true');
    assert(mineruCalled === true, '确认后 runEngine 闸门放行，runMineruApi 被调用');
    assert(okRes.status === 'ok', '确认后解析成功返回 ok');
  }

  // b) 用户取消 → cancelled，且不触碰引擎
  {
    let mineruCalled = false;
    const ext = loadExternalPdf({ mineru: async () => { mineruCalled = true; return { status: 'ok', text: goodText }; } });
    const cfg = { confirmUploads: true, allowExternalUpload: false, order: 'mineru-api', fileName: 'x.pdf' };
    globalThis.__eksUploadConfirm = async () => false;
    const cancelRes = await ext.extractDocumentWithApis(Buffer.from('fake-pdf'), cfg);
    assert(cancelRes.status === 'cancelled' && mineruCalled === false, '取消上传 → cancelled 且未调用引擎');
  }

  // c) 无确认弹窗（confirmUploads=false）且未授权 → runEngine 真实闸门仍拦截（不回归放行）
  {
    let mineruCalled = false;
    const ext = loadExternalPdf({ mineru: async () => { mineruCalled = true; return { status: 'ok', text: goodText }; } });
    const cfg = { confirmUploads: false, allowExternalUpload: false, order: 'mineru-api', fileName: 'x.pdf' };
    delete globalThis.__eksUploadConfirm;
    const gateRes = await ext.extractDocumentWithApis(Buffer.from('fake-pdf'), cfg);
    assert(mineruCalled === false, '未授权且无确认入口 → runMineruApi 未被调用');
    assert(gateRes.status === 'failed' && /未确认允许上传/.test(gateRes.message), '未授权 → 门拦截返回未确认错误');
  }

  delete globalThis.__eksUploadConfirm;
}
} // end main

// ---- external-pdf 模块抽取（桩掉 mineru/paddle 依赖）----
function loadExternalPdf(hooks) {
  const mineru = (hooks && hooks.mineru) || (async () => ({ status: 'ok', text: '' }));
  const marker = '"src/core/external-pdf.js": function(require, module, exports) {';
  const start = MAIN.indexOf(marker);
  if (start < 0) throw new Error('找不到 external-pdf 模块标记');
  const bodyStart = start + marker.length;
  const endIdx = MAIN.indexOf('\n},\n/**', bodyStart);
  const body = MAIN.slice(bodyStart, endIdx);
  const fn = new Function('require', 'module', 'exports', body);
  const mod = { exports: {} };
  fn((id) => {
    if (id === 'src/core/mineru-api.js') return { runMineruApi: mineru };
    if (id === 'src/core/paddleocr-api.js') return { runPaddleOcrApi: async () => ({ status: 'ok', text: '' }) };
    throw new Error('未预期的 require: ' + id);
  }, mod, mod.exports);
  if (typeof mod.exports.extractDocumentWithApis !== 'function') throw new Error('external-pdf 缺少 extractDocumentWithApis 导出');
  return mod.exports;
}

main().then(() => {
  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
}).catch((error) => {
  console.error(error);
  process.exit(1);
});
