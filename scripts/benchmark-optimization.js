const { performance } = require('perf_hooks');
const { loadAiPipeline } = require('./load-ai-pipeline.js');

async function main() {
  const { api } = loadAiPipeline();
  const shortText = '# 项目\n\n范围确认。\n\n## 决策\n\n采用方案 A。';
  const longText = Array.from({ length: 120 }, (_, index) =>
    `## 第 ${index + 1} 节\n\n项目第 ${index + 1} 节的范围、责任人、日期与验收要求。\n`
  ).join('\n');
  const rows = [];
  for (const [name, text, options] of [
    ['short', shortText, { maxChars: 12000, overlapRatio: 0, coalesceTinyChunks: true }],
    ['long-structured', longText, { maxChars: 1200, overlapRatio: 0.1, coalesceTinyChunks: true }],
    ['long-no-coalesce', longText, { maxChars: 1200, overlapRatio: 0.1, coalesceTinyChunks: false }]
  ]) {
    const start = performance.now();
    let chunks;
    for (let index = 0; index < 100; index += 1) {
      chunks = api.splitMarkdownSections(text, options);
    }
    const elapsedMs = performance.now() - start;
    rows.push({
      fixture: name,
      iterations: 100,
      inputCharacters: text.length,
      chunks: chunks.length,
      estimatedMapRequests: chunks.length,
      elapsedMs: Number(elapsedMs.toFixed(2)),
      meanMs: Number((elapsedMs / 100).toFixed(4))
    });
  }
  console.log(JSON.stringify({
    environment: { node: process.version, externalProviderNetworkMeasured: false },
    measurements: rows,
    notes: [
      '只测本地切片编排开销、输入字符和预期 map 请求数。',
      '未调用真实付费 API，不对供应商网络延迟或 Token 费用做量化声明。'
    ]
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
