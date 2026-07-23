// v2.9.1 烟雾测试：编码根因修复全家桶。
// 与其他烟雾测试一致——从 main.js 抽取真实模块源码执行，测的是线上代码本身。
// 覆盖：自适应解码（UTF-8/GBK/EUC-KR/ShiftJIS/cp1252/UTF-16 无 BOM）、
//       HTML 实体解码、语言识别、乱码判定、代理对安全截断、ZIP 文件名 EFS/GBK 解码。

const fs = require('fs');
const path = require('path');

function loadModule(marker, requireImpl) {
  const code = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf-8');
  const start = code.indexOf(marker);
  if (start < 0) throw new Error(`找不到模块标记：${marker}`);
  const bodyStart = start + marker.length;
  const endIdx = code.indexOf('\n},\n/**', bodyStart);
  if (endIdx < 0) throw new Error(`找不到模块结尾：${marker}`);
  const body = code.slice(bodyStart, endIdx);
  const fn = new Function('require', 'module', 'exports', body);
  const mod = { exports: {} };
  fn(requireImpl, mod, mod.exports);
  return mod.exports;
}

const documentParser = loadModule(
  '"src/core/document-parser.js": function(require, module, exports) {',
  require
);
const extractors = loadModule(
  '"src/core/extractors.js": function(require, module, exports) {',
  (id) => {
    if (id === 'src/core/document-parser.js') return documentParser;
    if (id === 'src/core/external-pdf.js') return { extractDocumentWithApis: async () => ({ status: 'stub' }) };
    throw new Error('未预期的 require: ' + id);
  }
);
const { api: aiPipeline } = require('./load-ai-pipeline.js').loadAiPipeline();
const zip = loadModule(
  '"src/core/zip.js": function(require, module, exports) {',
  require
);

const {
  decodeTextBuffer, decodeHtmlEntities, detectDominantLanguage,
  looksLikeGibberish, readabilityScore
} = extractors;
const { safeSlice, classificationSample, splitMarkdownSections } = aiPipeline;
const { extractZipEntryEndingWith } = zip;

for (const [name, fn] of Object.entries({
  decodeTextBuffer, decodeHtmlEntities, detectDominantLanguage, looksLikeGibberish,
  readabilityScore, safeSlice, classificationSample, splitMarkdownSections, extractZipEntryEndingWith
})) {
  if (typeof fn !== 'function') throw new Error(`缺少导出：${name}`);
}

let pass = 0;
let fail = 0;
function check(name, fn) {
  try {
    fn();
    pass += 1;
    console.log(`  ✓ ${name}`);
  } catch (error) {
    fail += 1;
    console.error(`  ✗ ${name}`);
    console.error(`    ${error.message}`);
  }
}
function assert(condition, message) {
  if (!condition) throw new Error(message);
}
function assertEqual(actual, expected, label) {
  if (actual !== expected) throw new Error(`${label}：期望 ${JSON.stringify(expected)}，实际 ${JSON.stringify(actual)}`);
}

// 孤立代理检测：高位代理后不跟低位 / 低位代理前无高位 → 截断事故产物
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;
function assertNoLoneSurrogate(text, label) {
  if (LONE_SURROGATE.test(String(text))) throw new Error(`${label} 出现孤立代理（截断事故）`);
}

// --- 自适应解码：各语言真实字节 ---
// 历史 bug：法/越/俄 UTF-8 被 ShiftJIS 候选反超；韩文 EUC-KR 被静默解成 GBK 汉字；
//          cp1252 专有符号（€ " "）无候选只能按 latin1 出 C1 控制符。

check('解码：法语 UTF-8（重音字母不再当乱码）', () => {
  const text = "Café résumé naïve — l'été à Paris, ça va bien ? Élève, hôtel, forêt, garçon. Œuvre complète et définitive.";
  const r = decodeTextBuffer(Buffer.from(text, 'utf8'));
  assertEqual(r.encoding, 'utf-8', 'encoding');
  assert(r.text.includes('résumé') && r.text.includes('Œuvre'), '重音字母完整');
  assert(r.score > 0.9, '可读性应接近满分');
  assertEqual(looksLikeGibberish(r.text), false, '不得误判乱码');
});

check('解码：越南语 UTF-8（不再被 ShiftJIS 反超）', () => {
  const text = 'Kỹ thuật xây dựng cầu đường — thiết kế kết cấu bê tông cốt thép theo tiêu chuẩn Việt Nam, tài liệu engineering.';
  const r = decodeTextBuffer(Buffer.from(text, 'utf8'));
  assertEqual(r.encoding, 'utf-8', 'encoding');
  assert(r.text.includes('xây dựng'), '越南语完整');
  assertEqual(looksLikeGibberish(r.text), false, '不得误判乱码');
});

check('解码：俄语 UTF-8（不再被 ShiftJIS 反超）', () => {
  const text = 'Инженерная документация по строительству мостов и тоннелей, проектные решения и расчёты несущих конструкций.';
  const r = decodeTextBuffer(Buffer.from(text, 'utf8'));
  assertEqual(r.encoding, 'utf-8', 'encoding');
  assert(r.text.includes('документация'), '西里尔字母完整');
});

check('解码：韩语 EUC-KR（不再静默解成错误汉字）', () => {
  // '한글한글 테스트' 的 EUC-KR(KS X 1001) 字节 + ' test' ASCII
  const korean = Buffer.from([
    0xc7, 0xd1, 0xb1, 0xdb, 0xc7, 0xd1, 0xb1, 0xdb, 0x20,
    0xc5, 0xd7, 0xbd, 0xba, 0xc6, 0xae, 0x20, 0x74, 0x65, 0x73, 0x74
  ]);
  const r = decodeTextBuffer(korean);
  assertEqual(r.encoding, 'euc-kr', 'encoding');
  assert(/[가-힣]/.test(r.text), '应解出韩文音节');
  assert(!r.text.includes('茄'), '不得是 GBK 误解产物「茄臂」');
});

check('解码：GBK 中文（不再被 ShiftJIS 解成半角片假名）', () => {
  // '中文测试 engineering 工程 文档 test' 的 GBK 字节
  const gbk = Buffer.from([
    0xd6, 0xd0, 0xce, 0xc4, 0xb2, 0xe2, 0xca, 0xd4, 0x20,
    0x65, 0x6e, 0x67, 0x69, 0x6e, 0x65, 0x65, 0x72, 0x69, 0x6e, 0x67, 0x20,
    0xb9, 0xa4, 0xb3, 0xcc, 0x20, 0xce, 0xc4, 0xb5, 0xb5, 0x20,
    0x74, 0x65, 0x73, 0x74
  ]);
  const r = decodeTextBuffer(gbk);
  assertEqual(r.encoding, 'gb18030', 'encoding');
  assert(r.text.includes('中文测试') && r.text.includes('工程'), '中文完整');
  assert(!/[ﾖﾐﾎﾄ]/.test(r.text), '不得出现半角片假名');
});

check('解码：真日文 ShiftJIS 仍正确识别（收紧后不回归）', () => {
  // '日本語テストのドキュメント' + ASCII 的 ShiftJIS 字节
  const sjis = Buffer.concat([
    Buffer.from([
      0x93, 0xfa, 0x96, 0x7b, 0x8c, 0xea, 0x83, 0x65, 0x83, 0x58, 0x83, 0x67,
      0x82, 0xcc, 0x83, 0x68, 0x83, 0x4d, 0x83, 0x62, 0x83, 0x81, 0x83, 0x93
    ]),
    Buffer.from(' engineering document test file', 'ascii')
  ]);
  const r = decodeTextBuffer(sjis);
  assert(r.encoding === 'shift_jis' || r.encoding === 'windows-31j', `应判 ShiftJIS，实际 ${r.encoding}`);
  assert(/[぀-ヿ一-鿿]/.test(r.text), '应解出假名/汉字');
});

check('解码：无 BOM 的 UTF-16LE（不再按二进制拒收）', () => {
  const r = decodeTextBuffer(Buffer.from('没有BOM的UTF-16文本 abc def ghi jkl', 'utf16le'));
  assertEqual(r.encoding, 'utf-16le', 'encoding');
  assert(r.text.includes('UTF-16文本'), '中文完整');
});

check('解码：cp1252 欧元/弯引号（0x80-0x9F 专有符号）', () => {
  // 'Café - “tést” 500€'：E9=é, 93=", 94=", 80=€
  const cp1252 = Buffer.from([
    0x43, 0x61, 0x66, 0xe9, 0x20, 0x2d, 0x20, 0x93, 0x74, 0xe9, 0x73, 0x74,
    0x94, 0x20, 0x35, 0x30, 0x30, 0x80
  ]);
  const r = decodeTextBuffer(cp1252);
  assertEqual(r.encoding, 'windows-1252', 'encoding');
  assert(r.text.includes('€') && r.text.includes('“'), 'cp1252 专有符号完整');
});

check('解码：纯 ASCII 与二进制拒收兜底', () => {
  const ascii = decodeTextBuffer(Buffer.from('plain ascii engineering document with several words here', 'utf8'));
  assert(ascii.text.includes('plain ascii'), 'ASCII 正常');
  // PNG 头 + 随机高位字节：含 NUL 但零字节分布不符合 UTF-16 交替特征
  const junk = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0xff, 0xd8, 0xff, 0xe0, 0x00, 0x01, 0x02, 0x03]);
  const bin = decodeTextBuffer(junk);
  assertEqual(bin.encoding, 'binary-rejected', '二进制应拒收');
  assertEqual(bin.text, '', '拒收文本为空');
});

check('解码：可读性评分——合法多语文本接近满分', () => {
  assert(readabilityScore("Café résumé naïve — l'été à Paris") > 0.9, '法语应 > 0.9（v1.5 的 /u 缺失 bug 曾压到 0.3）');
  assert(readabilityScore('한글 테스트 정상 문서') > 0.9, '韩文应 > 0.9');
  assert(readabilityScore('中文测试文档 abc') > 0.9, '中文应 > 0.9');
});

// --- HTML 实体解码（stripHtml 的配套能力） ---

check('HTML 实体：数字/十六进制/命名实体 + 未知实体保留', () => {
  assertEqual(
    decodeHtmlEntities('&#20013;&#x6587;&eacute;&unknown; &amp; test'),
    '中文é&unknown; & test',
    '实体解码'
  );
});

check('HTML 实体：代理区码点拒绝（防孤立代理注入）', () => {
  assertEqual(decodeHtmlEntities('&#xD800; lone surrogate'), '&#xD800; lone surrogate', '代理区实体应原样保留');
});

// --- 语言识别 ---

check('语言识别：ko/ru/zh/ja/en', () => {
  assertEqual(detectDominantLanguage('한글 테스트입니다'), 'ko', '韩文');
  assertEqual(detectDominantLanguage('Документация проекта'), 'ru', '俄文');
  assertEqual(detectDominantLanguage('中文测试文档内容'), 'zh', '中文');
  assertEqual(detectDominantLanguage('これはテストです'), 'ja', '日文');
  assertEqual(detectDominantLanguage('Plain English text only'), 'en', '英文');
});

// --- 乱码判定：只拦真乱码，不误杀合法多语文本 ---

check('乱码判定：长串 mojibake 二联体 / 替换字符 → 识别', () => {
  const mojibake = ('Ã©lÃ¨ve Ã  Paris, garÃ§on, hÃ´tel, forÃªt, naÃ¯ve, Ã§a va, tÃªte, bÃªte, ').repeat(2);
  assertEqual(looksLikeGibberish(mojibake), true, 'latin1 误解 UTF-8 的经典乱码');
  assertEqual(looksLikeGibberish('文档里有替换字符' + '\uFFFD'.repeat(6) + '穿插在文本中间各处位置的文档内容里到处都是这种替换符号字符'), true, 'U+FFFD 密集');
});

check('乱码判定：合法韩/越/俄长文 → 不误杀', () => {
  assertEqual(looksLikeGibberish('한글 테스트 정상 문서입니다. 여러 줄의 내용이 들어 있는 문서입니다.'.repeat(2)), false, '韩文');
  assertEqual(looksLikeGibberish('Tài liệu kỹ thuật xây dựng cầu đường bình thường, không có lỗi gì cả.'.repeat(2)), false, '越南文');
  assertEqual(looksLikeGibberish('Инженерная документация по строительству мостов и тоннелей.'.repeat(2)), false, '俄文');
});

// --- 代理对安全截断（emoji / CJK 扩展 B 汉字） ---

check('safeSlice：切点落在代理对中间时前移，永不产出孤立代理', () => {
  const t = 'a😀b𠀀c'; // 😀=U+1F600(索引1-2) 𠀀=U+20000(索引4-5)
  assertEqual(safeSlice(t, 0, 2), 'a', 'end=2 切在 😀 中间 → 前移到 1');
  assertEqual(safeSlice(t, 2, 6), '😀b𠀀', 'start=2 前移到 1，end=6 安全');
  assertEqual(safeSlice(t, 5, 6), '𠀀', 'start 落在代理对中间 → 前移一位取到完整字符');
  assertEqual(safeSlice(t, 1, 2), '', 'end 落在代理对中间且与 start 同对一个代理对 → 返回空而非半个字符');
  for (let s = 0; s <= t.length; s += 1) {
    for (let e = s; e <= t.length; e += 1) {
      assertNoLoneSurrogate(safeSlice(t, s, e), `safeSlice(${s},${e})`);
    }
  }
});

check('splitMarkdownSections：超长单行硬切不产出孤立代理', () => {
  // '普通文字😀𠀀测试' = 10 码元；maxChars=137 → 切点 137 正好落在 𠀀 中间
  const unit = '普通文字😀𠀀测试';
  const doc = `# 压力测试\n\n${unit.repeat(300)}`;
  const chunks = splitMarkdownSections(doc, { maxChars: 137, coalesceTiny: false, overlapRatio: 0 });
  assert(chunks.length > 5, `应切成多块，实际 ${chunks.length}`);
  let joined = '';
  for (const chunk of chunks) {
    assertNoLoneSurrogate(chunk.markdown, '切片文本');
    JSON.stringify(chunk.markdown); // 孤立代理会产出 \uDXXX 转义，配合上一行双重保险
    joined += chunk.markdown;
  }
  assertEqual(joined, doc, '无重叠时切片拼接应与原文逐字节一致');
  assert(joined.includes('😀') && joined.includes('𠀀'), '代理对字符在拼接后完整');
});

check('classificationSample：定长截取不产出孤立代理', () => {
  // 30000 码元的 'a😀' 流，各处边界都可能落在代理对中间
  const doc = `# 标题\n\n${'a😀'.repeat(15000)}`;
  const sample = classificationSample(doc, 24000);
  assertNoLoneSurrogate(sample, '分类抽样');
  assert(sample.includes('😀'), 'emoji 应完整保留');
});

// --- ZIP 文件名解码（EFS 标志 / GBK 回退） ---

function buildZip(entries) {
  // 手工拼装最小 ZIP（stored 无压缩，CRC 不校验——被测代码也不校验）
  const localParts = [];
  const centralParts = [];
  let offset = 0;
  for (const entry of entries) {
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(entry.flags, 6);
    local.writeUInt16LE(0, 8); // method: stored
    local.writeUInt32LE(entry.content.length, 18); // compSize
    local.writeUInt32LE(entry.content.length, 22); // uncompSize
    local.writeUInt16LE(entry.name.length, 26);
    localParts.push(local, entry.name, entry.content);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(entry.flags, 8); // decodeZipFileName 读这里
    central.writeUInt16LE(0, 10);
    central.writeUInt32LE(entry.content.length, 20); // compSize——extractZipEntryEndingWith 读这里
    central.writeUInt32LE(entry.content.length, 24); // uncompSize
    central.writeUInt16LE(entry.name.length, 28);
    central.writeUInt32LE(offset, 42);
    centralParts.push(central, entry.name);

    offset += 30 + entry.name.length + entry.content.length;
  }
  const centralDir = Buffer.concat(centralParts);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralDir.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...localParts, centralDir, eocd]);
}

const CONTENT = '# 压缩包含中文条目\n\n这是正文内容。';

check('ZIP：GBK 文件名（无 EFS 标志，Windows 中文压缩工具）', () => {
  // '测试.md' 的 GBK 字节：测=B2E2 试=CAD4
  const gbkName = Buffer.from([0xb2, 0xe2, 0xca, 0xd4, 0x2e, 0x6d, 0x64]);
  const zipBuf = buildZip([{ name: gbkName, flags: 0, content: Buffer.from(CONTENT, 'utf8') }]);
  assertEqual(extractZipEntryEndingWith(zipBuf, '.md'), CONTENT, '应按 GBK 解名并命中 .md 条目');
});

check('ZIP：UTF-8 文件名 + EFS 标志', () => {
  const utf8Name = Buffer.from('测试.md', 'utf8');
  const zipBuf = buildZip([{ name: utf8Name, flags: 0x800, content: Buffer.from(CONTENT, 'utf8') }]);
  assertEqual(extractZipEntryEndingWith(zipBuf, '.md'), CONTENT, 'EFS 置位按 UTF-8 解名');
});

check('ZIP：UTF-8 文件名无 EFS（合法 UTF-8 字节直通）+ ASCII 名 + 多条目跳过', () => {
  const utf8Name = Buffer.from('说明文件.md', 'utf8');
  const asciiEntry = { name: Buffer.from('readme.txt'), flags: 0, content: Buffer.from('not markdown') };
  const mdEntry = { name: utf8Name, flags: 0, content: Buffer.from(CONTENT, 'utf8') };
  const zipBuf = buildZip([asciiEntry, mdEntry]);
  assertEqual(extractZipEntryEndingWith(zipBuf, '.md'), CONTENT, '多条目中按后缀命中中文名');
});

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
