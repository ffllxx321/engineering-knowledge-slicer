// v2.4 parseJsonPayload / repairJsonText 烟雾测试

const RR = `
// 复制自 main.js ai-pipeline.js 模块闭包内的实现
function repairJsonTextInner(text) {
  if (!text || typeof text !== 'string') return null;
  let s = text.replace(/,\\s*$/, '');
  let inString = false;
  let escape = false;
  const stack = [];
  for (let i = 0; i < s.length; i += 1) {
    const ch = s[i];
    if (escape) { escape = false; continue; }
    if (ch === '\\\\') { escape = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === '{' || ch === '[') stack.push(ch === '{' ? '}' : ']');
    else if (ch === '}' || ch === ']') stack.pop();
  }
  if (inString) s += '"';
  while (stack.length) s += stack.pop();
  s = s.replace(/,\\s*([}\\]])/g, '$1').replace(/,\\s*$/, '');
  try { JSON.parse(s); return s; } catch { return null }
}
repairJsonTextInner;
`;

const repairJsonText = eval(RR);

const cases = [
  {
    name: '已完整 JSON',
    input: '{"a": 1, "b": [2, 3]}',
    expect: { a: 1, b: [2, 3] }
  },
  {
    name: '尾部逗号 + 缺 }',
    input: '{"a": 1, "b": [2, 3,',
    expect: { a: 1, b: [2, 3] }
  },
  {
    name: '未闭合字符串',
    input: '{"a": "hello',
    expect: { a: 'hello' }
  },
  {
    name: '未闭合字符串 + 缺 ]',
    input: '{"items": [{"x": "y"',
    expect: { items: [{ x: 'y' }] }
  },
  {
    name: '已平衡不应被修改',
    input: '{"a": 1}',
    expect: { a: 1 }
  },
  {
    name: '多个对象层级',
    input: '{"a": {"b": {"c": [1, 2',
    expect: { a: { b: { c: [1, 2] } } }
  }
];

let pass = 0;
let fail = 0;
for (const c of cases) {
  try {
    const repaired = repairJsonText(c.input);
    if (!repaired) throw new Error('repairJsonText 返回 null');
    const parsed = JSON.parse(repaired);
    const expected = JSON.stringify(c.expect);
    const actual = JSON.stringify(parsed);
    if (expected === actual) {
      console.log('  ✓ ' + c.name);
      pass += 1;
    } else {
      console.log('  ✗ ' + c.name + ' — 期望 ' + expected + ' 实际 ' + actual);
      fail += 1;
    }
  } catch (e) {
    console.log('  ✗ ' + c.name + ' — ' + e.message);
    fail += 1;
  }
}

console.log('共 ' + (pass + fail) + ' 用例，' + pass + ' 通过 / ' + fail + ' 失败');
process.exit(fail > 0 ? 1 : 0);
