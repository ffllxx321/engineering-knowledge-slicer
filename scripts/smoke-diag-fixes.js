// v2.8.1 诊断日志修复烟雾测试
// 覆盖：stripDiagHeaders（头部剥离 / 27 份重复头部自愈 / 无头部不误伤）
//       isTransientHttpStatus（529 判定为瞬态可重试）
// 两个函数都是 main.js 外层顶层函数，按行首 `function ... {\n}` 边界抽取真实源码执行。

const fs = require('fs');
const path = require('path');

const source = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf-8');

function extractFunction(name) {
  const start = source.indexOf(`function ${name}(`);
  if (start < 0) throw new Error(`main.js 中找不到 function ${name}`);
  const braceStart = source.indexOf('{', start);
  // 找到第一个位于行首的 `}` 作为函数结尾（顶层函数体内部的 } 都有缩进）
  const end = source.indexOf('\n}', braceStart);
  if (end < 0) throw new Error(`无法定位 ${name} 的结尾`);
  return source.slice(start, end + 2);
}

const stripDiagHeaders = new Function(`return (${extractFunction('stripDiagHeaders')});`)();
const isTransientHttpStatus = new Function(`return (${extractFunction('isTransientHttpStatus')});`)();

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

const HEADER = [
  '# 工程知识切片 诊断日志',
  '',
  '> 这份文件由插件自动写入，记录所有 `[EKS diag]` 诊断事件。',
  '> 复制本文件全部内容（除了这一段说明）发给开发者即可定位问题。',
  '> 文件位置：`C:\\Users\\test\\.eks\\logs\\diag.log`',
  '> 日志会自动 trim 到最近约 2000 行，避免文件无限增长。',
  '',
  ''
].join('\n');
const BODY = '2026-07-20T07:24:47.276Z [EKS diag] splitter.profile {"chars":21202}\n2026-07-20T07:33:56.756Z [EKS diag] heartbeat.stop {"totalElapsedMs":577504}\n';

check('剥离单份头部：只留正文', () => {
  const out = stripDiagHeaders(HEADER + BODY);
  assert(out === BODY, `剥离后应只剩正文，实际开头：${JSON.stringify(out.slice(0, 60))}`);
});

check('自愈 27 份历史重复头部（用户真实日志形态）', () => {
  let file = '';
  for (let i = 0; i < 27; i += 1) file += HEADER;
  file += BODY;
  const out = stripDiagHeaders(file);
  assert(out === BODY, `27 份头部应全部剥净，实际长度 ${out.length}（正文 ${BODY.length}）`);
  assert(!out.includes('# 工程知识切片 诊断日志'), '正文里不应残留标题行');
});

check('无头部文件不误伤', () => {
  const out = stripDiagHeaders(BODY);
  assert(out === BODY, '无头部时应原样返回');
});

check('空字符串 / 非字符串输入不崩', () => {
  assert(stripDiagHeaders('') === '', '空串应返回空串');
  assert(stripDiagHeaders(null) === '', 'null 应返回空串');
});

check('头部后紧跟 > 引用正文也只剥头部块（第一行必须是标题才启动剥离）', () => {
  const quoted = '> 用户自己的引用\n正文\n';
  assert(stripDiagHeaders(quoted) === quoted, '第一行不是标题时不应剥离任何内容');
});

check('isTransientHttpStatus：529（MiniMax overloaded）为瞬态可重试', () => {
  assert(isTransientHttpStatus(529) === true, '529 必须可重试');
});

check('isTransientHttpStatus：既有瞬态码保持可重试', () => {
  for (const status of [408, 425, 429, 500, 502, 503, 504]) {
    assert(isTransientHttpStatus(status) === true, `${status} 应可重试`);
  }
});

check('isTransientHttpStatus：终态错误不重试', () => {
  for (const status of [200, 400, 401, 403, 404, 422]) {
    assert(isTransientHttpStatus(status) === false, `${status} 不应重试`);
  }
});

check('isTransientHttpStatus：字符串状态码也能识别', () => {
  assert(isTransientHttpStatus('529') === true, "'529' 应可重试");
  assert(isTransientHttpStatus('401') === false, "'401' 不应重试");
});

console.log('共 ' + (pass + fail) + ' 用例，' + pass + ' 通过 / ' + fail + ' 失败');
process.exit(fail > 0 ? 1 : 0);
