// splitMarkdownSections 回归测试（v2.5 用例，v2.6 起改为从 main.js 真实模块抽取执行，
// 不再内嵌旧实现副本 —— 测的是线上代码本身）

const { loadAiPipeline } = require('./load-ai-pipeline');
const { splitMarkdownSections } = loadAiPipeline().api;

const cases = [
  {
    name: '空字符串',
    input: '',
    expectChunks: 1
  },
  {
    name: '纯空白',
    input: '   \n\n  \n',
    expectChunks: 1
  },
  {
    name: '全换行',
    input: '\n\n\n\n\n',
    expectChunks: 1
  },
  {
    name: '普通文本（标题少于 3 个，走 heuristic）',
    input: '# 标题\n段落 1\n## 子标题\n段落 2',
    expectChunks: 1,
    expectHeadingsCount: 2
  },
  {
    name: '超大单行（硬切兜底）',
    input: 'a'.repeat(25000),
    expectChunks: 3,
    expectMaxChars: 12000
  },
  {
    name: '多个 heading 边界',
    input: 'a'.repeat(8000) + '\n# 标题1\n' + 'b'.repeat(8000) + '\n# 标题2\n',
    expectHeadingsCount: 2
  }
];

let pass = 0, fail = 0;
for (const c of cases) {
  try {
    const result = splitMarkdownSections(c.input);
    if (c.expectChunks !== undefined && result.length !== c.expectChunks) {
      throw new Error(`期望 ${c.expectChunks} chunks，实际 ${result.length}`);
    }
    if (c.expectMaxChars && result.some((r) => r.markdown.length > c.expectMaxChars + 1)) {
      throw new Error('有 chunk 超过 maxChars');
    }
    if (c.expectHeadingsCount !== undefined) {
      const totalHeadings = result.reduce((sum, r) => sum + r.headings.length, 0);
      if (totalHeadings !== c.expectHeadingsCount) {
        throw new Error(`期望 ${c.expectHeadingsCount} headings，实际 ${totalHeadings}`);
      }
    }
    // 每条 chunk_id 必须唯一
    const ids = new Set(result.map((r) => r.chunk_id));
    if (ids.size !== result.length) throw new Error('chunk_id 重复');
    // v2.6: breadcrumb 字段必须存在（可为空串）
    if (result.some((r) => typeof r.breadcrumb !== 'string')) throw new Error('缺少 breadcrumb 字段');
    console.log('  ✓ ' + c.name);
    pass += 1;
  } catch (e) {
    console.log('  ✗ ' + c.name + ' — ' + e.message);
    fail += 1;
  }
}

console.log('共 ' + (pass + fail) + ' 用例，' + pass + ' 通过 / ' + fail + ' 失败');
process.exit(fail > 0 ? 1 : 0);
