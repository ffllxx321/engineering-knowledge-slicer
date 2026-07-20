// v2.6 烟雾测试共享加载器：
// 从 main.js 中抽取 "src/core/ai-pipeline.js" 模块源码，隔离执行并返回其 exports。
// 不依赖 obsidian / electron —— 只测纯函数（切片引擎 / JSON 修复等）。

const fs = require('fs');
const path = require('path');

function loadAiPipeline() {
  const code = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf-8');
  const marker = '"src/core/ai-pipeline.js": function(require, module, exports) {';
  const start = code.indexOf(marker);
  if (start < 0) throw new Error('找不到 ai-pipeline 模块标记（main.js 结构变了？）');
  const bodyStart = start + marker.length;
  const endIdx = code.indexOf('\n},\n/**', bodyStart);
  if (endIdx < 0) throw new Error('找不到 ai-pipeline 模块结尾');
  const body = code.slice(bodyStart, endIdx);

  // 安装诊断桩：模块内 diag() 在调用时才读 globalThis.__eksDiag，
  // 测试期间保持安装，diagCalls 可用于断言 splitter.validate / splitter.profile 打点。
  const diagCalls = [];
  globalThis.__eksDiag = {
    diag: (scope, payload) => { diagCalls.push({ scope, payload }); },
    keyFingerprint: () => 'fp:test'
  };

  const fn = new Function('require', 'module', 'exports', body);
  const mod = { exports: {} };
  fn((id) => {
    if (id === 'src/core/schema-validator.js') {
      return { validateSchema: () => ({ errors: [], warnings: [] }) };
    }
    throw new Error('未预期的 require: ' + id);
  }, mod, mod.exports);

  if (typeof mod.exports.splitMarkdownSections !== 'function') {
    throw new Error('ai-pipeline 模块加载后缺少 splitMarkdownSections 导出');
  }
  return { api: mod.exports, diagCalls };
}

module.exports = { loadAiPipeline };
