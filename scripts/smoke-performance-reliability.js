// v2.9.3 回归：总结/原子化并发解耦、重试账本可见性、滚动备份。

const fs = require('fs');
const path = require('path');
const { loadAiPipeline } = require('./load-ai-pipeline.js');

const MAIN = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');

function assert(condition, message) {
  if (!condition) throw new Error(message);
  console.log(`  ok - ${message}`);
}

async function testSummaryConcurrency() {
  const { api } = loadAiPipeline();
  let active = 0;
  let peak = 0;
  const requestJson = async (_prompt, context) => {
    if (!context.chunk) {
      return {
        document_title: '并发测试',
        library: 'business',
        folder_type: 'test',
        document_type: 'test',
        executive_summary: 'merged',
        entities: [],
        key_points: [],
        evidence: [],
        suggested_links: [],
        coverage: { chunk_ids: context.chunkIds, complete: true },
        model_confidence: 1,
        schema_version: '1.1'
      };
    }
    active += 1;
    peak = Math.max(peak, active);
    await new Promise((resolve) => setTimeout(resolve, 20));
    active -= 1;
    const chunkId = context.chunk.chunk_id;
    return {
      document_title: '并发测试',
      library: 'business',
      folder_type: 'test',
      document_type: 'test',
      executive_summary: chunkId,
      entities: [],
      key_points: [],
      evidence: [],
      suggested_links: [],
      coverage: { chunk_ids: [chunkId], complete: true },
      model_confidence: 1,
      schema_version: '1.1'
    };
  };
  let typedEmpty = false;
  try {
    await api.summarizeDocument({
    parsePackage: {
      source_name: 'test',
      markdown: `${'甲'.repeat(120)}\n${'乙'.repeat(120)}\n${'丙'.repeat(120)}`,
      evidence_index: {
        source: { block_id: 'source', raw_text: '可验证来源块', locator: { scheme: 'line', value: '1' } }
      }
    },
    classification: { library: 'business', folder_type: 'test', document_type: 'test' },
    basePrompt: 'summary',
    typePrompt: '',
    summarySchema: {},
    maxChunkChars: 100,
    coalesceTinyChunks: false,
    summaryConcurrency: 3,
      requestJson
    });
  } catch (error) {
    typedEmpty = error.code === 'SUMMARY_ALL_CHUNKS_UNSUPPORTED';
  }
  assert(peak === 3, '逐段总结使用独立 summaryConcurrency');
  assert(typedEmpty, '并发空分块以 SUMMARY_ALL_CHUNKS_UNSUPPORTED 明确结束');
}

async function main() {
  console.log('性能与可靠性回归:');
  await testSummaryConcurrency();
  assert(
    /summaryConcurrency:\s*this\.settings\.summaryConcurrency/.test(MAIN)
      && /summaryConcurrency:\s*options\.summaryConcurrency/.test(MAIN),
    '插件设置到工作流的总结并发接线未复用原子化并发'
  );
  assert(
    /retryFailedAndAutoProcess[\s\S]*?saveTasks\(tasks\);[\s\S]*?flushSaveTasksImmediate\(\);[\s\S]*?autoProcessQueue/.test(MAIN),
    '批量重试在队列重读前立即落盘'
  );
  assert(
    /async retryTask[\s\S]*?saveTasks\(tasks\);[\s\S]*?flushSaveTasksImmediate\(\);[\s\S]*?processTask\(task\)/.test(MAIN),
    '单任务重试在处理器重读前立即落盘'
  );
  assert(
    MAIN.includes("target.replace(/\\.json$/i, '.bak.json')")
      && !MAIN.includes('.bak.${ts}.json'),
    '任务账本使用单一滚动备份，避免时间戳备份文件膨胀'
  );
}

main().catch((error) => {
  console.error(`FAIL: ${error.message}`);
  process.exit(1);
});
