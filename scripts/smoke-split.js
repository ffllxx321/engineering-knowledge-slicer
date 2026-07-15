// v2.5 splitMarkdownSections 边界测试

const SRC = `
function splitMarkdownSectionsInner(markdown, options = {}) {
  const source = String(markdown || '');
  const maxChars = Math.max(100, Number(options.maxChars) || 12000);
  if (!source.trim()) return [{ chunk_id: 'chunk-001', markdown: source, headings: [] }];
  const tokens = source.match(/[^\\n]*\\n|[^\\n]+$/g) || [source];
  const chunks = [];
  let current = '';
  function flush() {
    if (!current) return;
    chunks.push(current);
    current = '';
  }
  for (const token of tokens) {
    const heading = /^#{1,6}\\s+/.test(token);
    if (heading && current && current.length >= maxChars * 0.6) flush();
    if (token.length > maxChars) {
      flush();
      for (let offset = 0; offset < token.length; offset += maxChars) chunks.push(token.slice(offset, offset + maxChars));
      continue;
    }
    if (current && current.length + token.length > maxChars) flush();
    current += token;
  }
  flush();
  if (!chunks.length) chunks.push(source);
  return chunks.map((text, index) => ({
    chunk_id: \`chunk-\${String(index + 1).padStart(3, '0')}\`,
    markdown: text,
    headings: [...text.matchAll(/^#{1,6}\\s+(.+)$/gm)].map((match) => match[1].trim())
  }));
}
splitMarkdownSectionsInner;
`;

const splitMarkdownSections = eval(SRC);

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
    name: '普通文本',
    input: '# 标题\n段落 1\n## 子标题\n段落 2',
    expectChunks: 1,
    expectHeadingsCount: 2
  },
  {
    name: '超大单行',
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
    console.log('  ✓ ' + c.name);
    pass += 1;
  } catch (e) {
    console.log('  ✗ ' + c.name + ' — ' + e.message);
    fail += 1;
  }
}

console.log('共 ' + (pass + fail) + ' 用例，' + pass + ' 通过 / ' + fail + ' 失败');
process.exit(fail > 0 ? 1 : 0);
