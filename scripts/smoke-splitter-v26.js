// v2.6 WeKnora 式切片引擎烟雾测试
// 覆盖：文档画像 / 策略选择 / 标题切分 + 面包屑 / 受保护区域（表格、代码块）/
//       小节合并 / 重叠 / 覆盖校验 / 向后兼容形状

const { loadAiPipeline } = require('./load-ai-pipeline');
const { api, diagCalls } = loadAiPipeline();
const {
  splitMarkdownSections,
  profileMarkdown,
  commonBreadcrumbPrefix,
  splitByHeadings,
  validateChunks
} = api;

let pass = 0, fail = 0;
function check(name, fn) {
  try {
    fn();
    console.log('  ✓ ' + name);
    pass += 1;
  } catch (e) {
    console.log('  ✗ ' + name + ' — ' + e.message);
    fail += 1;
  }
}
function assert(cond, msg) { if (!cond) throw new Error(msg); }

// ---------- 1. 文档画像与策略选择 ----------
check('profileMarkdown：3 个以上 H2 → strategy=heading, dominant=2', () => {
  const doc = '# 文档\n## 一\n正文\n## 二\n正文\n## 三\n正文\n';
  const p = profileMarkdown(doc);
  assert(p.strategy === 'heading', `strategy=${p.strategy}`);
  assert(p.dominantHeadingLevel === 2, `dominant=${p.dominantHeadingLevel}`);
  assert(p.headingTotal === 4, `headingTotal=${p.headingTotal}`);
});

check('profileMarkdown：无标题有段落 → strategy=heuristic', () => {
  const p = profileMarkdown('段落一。\n\n段落二。\n\n段落三。');
  assert(p.strategy === 'heuristic', `strategy=${p.strategy}`);
});

check('profileMarkdown：单行纯文本 → strategy=legacy', () => {
  const p = profileMarkdown('没有任何结构的超长单行文本');
  assert(p.strategy === 'legacy', `strategy=${p.strategy}`);
});

check('profileMarkdown：代码块内的 # 行不计入标题', () => {
  const doc = '# 真标题1\n```md\n# 假标题1\n# 假标题2\n# 假标题3\n```\n# 真标题2\n';
  const p = profileMarkdown(doc);
  assert(p.headingTotal === 2, `headingTotal=${p.headingTotal}（代码块内标题被误计）`);
  assert(p.hasCode === true, 'hasCode 未识别');
});

check('profileMarkdown：识别表格 / LaTeX', () => {
  const doc = '| a | b |\n|---|---|\n| 1 | 2 |\n\n$$E=mc^2$$\n';
  const p = profileMarkdown(doc);
  assert(p.hasTables === true, 'hasTables 未识别');
  assert(p.hasMath === true, 'hasMath 未识别');
});

// ---------- 2. 标题切分 + 面包屑 ----------
check('splitByHeadings：按主层级切分并携带层级面包屑', () => {
  const doc = '# 章\n## 节A\n内容A\n## 节B\n内容B\n## 节C\n内容C\n';
  const sections = splitByHeadings(doc, 2);
  assert(sections && sections.length >= 3, `sections=${sections && sections.length}`);
  const secA = sections.find((s) => s.text.includes('内容A'));
  assert(secA.breadcrumb.includes('# 章'), `面包屑缺上级标题: ${secA.breadcrumb}`);
  assert(secA.breadcrumb.includes('## 节A'), `面包屑缺本节标题: ${secA.breadcrumb}`);
});

check('splitByHeadings：代码块内标题不产生切分边界', () => {
  const doc = '# 章\n## 节A\n```\n## 假标题\n```\n## 节B\n内容\n## 节C\n内容\n';
  const sections = splitByHeadings(doc, 2);
  const countWithB = sections.filter((s) => s.text.includes('## 节B')).length;
  assert(countWithB === 1, '代码块内 ## 产生了额外边界');
});

check('splitMarkdownSections：chunk 携带 breadcrumb 且注入层级路径', () => {
  const doc = '# 第一章 总则\n## 1.1 范围\n' + 'x'.repeat(100) + '\n## 1.2 引用\n' + 'y'.repeat(100) + '\n## 1.3 定义\n' + 'z'.repeat(100) + '\n';
  const chunks = splitMarkdownSections(doc, { maxChars: 400, coalesceTiny: false, overlapRatio: 0 });
  const withBreadcrumb = chunks.filter((c) => c.breadcrumb.includes('第一章'));
  assert(withBreadcrumb.length >= 2, `带面包屑 chunk 数=${withBreadcrumb.length}`);
});

// ---------- 3. 受保护区域：表格 / 代码块不切断 ----------
check('受保护表格：小 maxChars 下表格整体落在单个 chunk', () => {
  const rows = Array.from({ length: 20 }, (_, i) => `| r${i} | v${i} |`).join('\n');
  const table = '| 名称 | 值 |\n|---|---|\n' + rows;
  const doc = '前导段落。\n'.repeat(15) + table + '\n' + '后续段落。\n'.repeat(15);
  const chunks = splitMarkdownSections(doc, { maxChars: 400, coalesceTiny: false, overlapRatio: 0 });
  assert(chunks.length >= 2, `应切成多块，实际 ${chunks.length}`);
  const holder = chunks.filter((c) => c.markdown.includes('| r0 |'));
  assert(holder.length === 1, `表格首行出现在 ${holder.length} 个 chunk（重叠为 0 时应为 1）`);
  assert(holder[0].markdown.includes('| r19 |'), '表格末行被切到别的 chunk');
  assert(holder[0].markdown.includes('|---|---|'), '表格分隔行丢失');
});

check('受保护代码块：围栏代码不被拦腰切断', () => {
  const codeLines = Array.from({ length: 15 }, (_, i) => `const v${i} = ${i};`).join('\n');
  const fence = '```js\n' + codeLines + '\n```';
  const doc = '说明文字。\n'.repeat(15) + fence + '\n' + '收尾文字。\n'.repeat(15);
  const chunks = splitMarkdownSections(doc, { maxChars: 400, coalesceTiny: false, overlapRatio: 0 });
  assert(chunks.length >= 2, `应切成多块，实际 ${chunks.length}`);
  const holder = chunks.filter((c) => c.markdown.includes('const v0 = 0;'));
  assert(holder.length === 1, `代码块首行出现在 ${holder.length} 个 chunk`);
  assert(holder[0].markdown.includes('const v14 = 14;'), '代码块末行被切断');
  assert(holder[0].markdown.includes('```js') && holder[0].markdown.includes('const v14'), '围栏标记不完整');
});

check('受保护 LaTeX 块级公式不切断', () => {
  const formula = '$$' + 'x'.repeat(120) + '$$';
  const doc = '前文。\n'.repeat(20) + formula + '\n' + '后文。\n'.repeat(20);
  const chunks = splitMarkdownSections(doc, { maxChars: 300, coalesceTiny: false, overlapRatio: 0 });
  const holders = chunks.filter((c) => c.markdown.includes('$$'));
  const intact = holders.some((c) => c.markdown.includes(formula));
  assert(intact, `公式被切断（出现在 ${holders.length} 个 chunk 且均不完整）`);
});

// ---------- 4. 小节合并（coalesceTinyChunks） ----------
check('小节合并：10 个微型 H2 节合并为极少数 chunk', () => {
  let doc = '# 总标题\n';
  for (let i = 0; i < 10; i += 1) doc += `## S${i}\n内容${i}。`.padEnd(46, '。') + '\n';
  const merged = splitMarkdownSections(doc, { maxChars: 1000, coalesceTiny: true, overlapRatio: 0 });
  const unmerged = splitMarkdownSections(doc, { maxChars: 1000, coalesceTiny: false, overlapRatio: 0 });
  assert(unmerged.length >= 6, `未合并时应有多块，实际 ${unmerged.length}`);
  assert(merged.length < unmerged.length, `合并后 ${merged.length} 应少于未合并 ${unmerged.length}`);
  assert(merged.length <= 3, `合并后应 ≤3 块，实际 ${merged.length}`);
});

check('小节合并：不同顶级章节不跨语境合并', () => {
  const doc = '# A章\n## a1\n' + '甲'.repeat(60) + '\n## a2\n' + '乙'.repeat(60) + '\n# B章\n## b1\n' + '丙'.repeat(60) + '\n## b2\n' + '丁'.repeat(60) + '\n# C章\n## c1\n' + '戊'.repeat(60) + '\n## c2\n' + '己'.repeat(60) + '\n';
  const chunks = splitMarkdownSections(doc, { maxChars: 600, coalesceTiny: true, overlapRatio: 0 });
  // 每个合并块的面包屑只能是单一顶级章节路径（A/B/C 不混用）
  for (const c of chunks) {
    const topLevels = (c.breadcrumb.match(/^# /gm) || []).length;
    assert(topLevels <= 1, `面包屑混入多个顶级章节: ${c.breadcrumb}`);
  }
});

// ---------- 5. 重叠（overlap） ----------
check('重叠：相邻 chunk 有公共衔接内容', () => {
  const lines = Array.from({ length: 40 }, (_, i) => `第${i}行：这是一段用于测试重叠切分的填充文本。`);
  const doc = lines.join('\n');
  const chunks = splitMarkdownSections(doc, { maxChars: 400, coalesceTiny: false, overlapRatio: 0.2 });
  assert(chunks.length >= 3, `应切成多块，实际 ${chunks.length}`);
  for (let i = 1; i < chunks.length; i += 1) {
    const prev = chunks[i - 1].markdown;
    const next = chunks[i].markdown;
    let overlapLen = 0;
    const max = Math.min(prev.length, next.length);
    for (let len = 1; len <= max; len += 1) {
      // 注意：小 len 不相等不代表大 len 不相等（对齐不同），必须全量扫描取最大
      if (prev.slice(-len) === next.slice(0, len)) overlapLen = len;
    }
    // 回退到安全换行切点，重叠可能不足 80 字符但必须 > 0
    assert(overlapLen > 0, `chunk ${i - 1} → ${i} 无重叠`);
  }
});

check('重叠=0 时相邻 chunk 无重复（拼接即还原原文）', () => {
  const doc = '# 标题\n' + '段落内容。\n'.repeat(200);
  const chunks = splitMarkdownSections(doc, { maxChars: 500, coalesceTiny: false, overlapRatio: 0 });
  const restored = chunks.map((c) => c.markdown).join('');
  assert(restored === doc, `无重叠 + 无合并时拼接应等于原文（差 ${Math.abs(restored.length - doc.length)} 字符）`);
});

// ---------- 6. 校验器 ----------
check('validateChunks：乱序 / 缺口被检出', () => {
  const good = validateChunks(
    [{ start: 0, end: 5, markdown: 'aaaaa' }, { start: 5, end: 9, markdown: 'bbbb' }],
    'aaaaabbbb', 100);
  assert(good === true, '合法切片应通过');
  const badOrder = validateChunks(
    [{ start: 5, end: 9, markdown: 'bbbb' }, { start: 0, end: 5, markdown: 'aaaaa' }],
    'aaaaabbbb', 100);
  assert(badOrder === false, '乱序应不通过');
  const badGap = validateChunks(
    [{ start: 0, end: 3, markdown: 'aaa' }, { start: 5, end: 9, markdown: 'bbbb' }],
    'aaaaabbbb', 100);
  assert(badGap === false, '缺口应不通过');
  const diagHit = diagCalls.some((d) => d.scope === 'splitter.validate' && d.payload && d.payload.ok === false);
  assert(diagHit, '失败校验应打 diag 日志');
});

check('splitMarkdownSections：切分结果通过内置校验（diag 无 splitter.validate 失败）', () => {
  diagCalls.length = 0;
  const doc = '# 一\n## 1\n' + '文'.repeat(500) + '\n## 2\n' + '文'.repeat(500) + '\n# 二\n## 3\n' + '文'.repeat(500) + '\n## 4\n' + '文'.repeat(500) + '\n';
  splitMarkdownSections(doc, { maxChars: 600, overlapRatio: 0.1 });
  const failed = diagCalls.filter((d) => d.scope === 'splitter.validate' && d.payload && d.payload.ok === false);
  assert(failed.length === 0, `内置校验失败: ${JSON.stringify(failed[0] && failed[0].payload)}`);
  const profiled = diagCalls.some((d) => d.scope === 'splitter.profile');
  assert(profiled, '应打 splitter.profile 画像日志');
});

// ---------- 7. 公共工具 ----------
check('commonBreadcrumbPrefix：行对齐公共前缀', () => {
  assert(commonBreadcrumbPrefix('# A\n## B', '# A\n## C') === '# A', 'common1');
  assert(commonBreadcrumbPrefix('# A\n## B', '# A\n## B') === '# A\n## B', 'common2');
  assert(commonBreadcrumbPrefix('# A', '# Z') === '', 'common3');
  assert(commonBreadcrumbPrefix('', '') === '', 'common4');
});

// ---------- 8. 向后兼容 + 边界 ----------
check('向后兼容：输出形状含 chunk_id/markdown/headings/breadcrumb 且 id 连续唯一', () => {
  const doc = '# 标题\n' + 'x'.repeat(100);
  const chunks = splitMarkdownSections(doc, { maxChars: 50 });
  chunks.forEach((c, i) => {
    assert(c.chunk_id === `chunk-${String(i + 1).padStart(3, '0')}`, `chunk_id 序号错: ${c.chunk_id}`);
    assert(typeof c.markdown === 'string' && Array.isArray(c.headings) && typeof c.breadcrumb === 'string', '字段缺失');
  });
});

check('边界：overlapRatio 非法值被夹取不报错', () => {
  const chunks = splitMarkdownSections('普通文本\n'.repeat(10), { maxChars: 20, overlapRatio: 99 });
  assert(chunks.length >= 1, '应正常返回');
});

check('边界：maxChars 极小（100）不崩溃', () => {
  const doc = '## 节\n' + '长'.repeat(500) + '\n## 节2\n' + '短\n';
  const chunks = splitMarkdownSections(doc, { maxChars: 100 });
  assert(chunks.length >= 1, '应正常返回');
  assert(chunks.every((c) => c.markdown.length > 0), '不应有空 chunk');
});

console.log('共 ' + (pass + fail) + ' 用例，' + pass + ' 通过 / ' + fail + ' 失败');
process.exit(fail > 0 ? 1 : 0);
