// v2.9.0 烟雾测试：MIME 邮件解析（parseEmailMessage 及依赖函数）+ email 抽取分支。
// 与其他烟雾测试一致：从 main.js 抽取真实模块源码执行，测的是线上代码本身。

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

const { parseEmailMessage, decodeQuotedPrintable, decodeMimeWords, sanitizeAttachmentFileName, extractTextFromBuffer } = extractors;
for (const [name, fn] of Object.entries({ parseEmailMessage, decodeQuotedPrintable, decodeMimeWords, sanitizeAttachmentFileName, extractTextFromBuffer })) {
  if (typeof fn !== 'function') throw new Error(`extractors 缺少导出：${name}`);
}

const CRLF = '\r\n';
const utf8b64 = (text) => Buffer.from(text, 'utf8').toString('base64');

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

// --- 基础工具函数 ---

check('decodeQuotedPrintable：=XX 与软换行', () => {
  const out = decodeQuotedPrintable(Buffer.from('A=42C=\r\nD=E4=B8=AD', 'latin1'));
  assertEqual(out.toString('utf8'), 'ABCD中', 'QP 解码');
});

check('decodeMimeWords：B 编码中文', () => {
  assertEqual(decodeMimeWords(`=?UTF-8?B?${utf8b64('测试主题')}?=`), '测试主题', 'B 编码');
});

check('decodeMimeWords：相邻编码词间的空白应忽略', () => {
  const input = `=?UTF-8?B?${utf8b64('第一')}?= =?UTF-8?B?${utf8b64('第二')}?=`;
  assertEqual(decodeMimeWords(input), '第一第二', '相邻编码词');
});

check('sanitizeAttachmentFileName：路径穿越与非法字符', () => {
  const name = sanitizeAttachmentFileName('../../etc/pa:ss*wd.pdf');
  assert(!/[\\/]/.test(name), '不得包含路径分隔符');
  assert(!name.includes(':') && !name.includes('*'), '不得包含非法字符');
  assert(name.length > 0, '不得为空');
  assertEqual(sanitizeAttachmentFileName('   '), 'attachment', '全空回退');
});

// --- 完整邮件解析 ---

const pdfBytes = Buffer.from('%PDF-1.4\n1 0 obj\n', 'latin1');
const pdfB64 = pdfBytes.toString('base64');
const encodedFileName = `=?UTF-8?B?${utf8b64('测试文件')}?=.pdf`;

const multipartMail = [
  'From: =?UTF-8?B?' + utf8b64('张三') + '?= <zhangsan@example.com>',
  'To: lisi@example.com',
  'Cc: wangwu@example.com',
  'Subject: =?UTF-8?B?' + utf8b64('测试主题') + '?=',
  'Date: Mon, 1 Jan 2024 10:00:00 +0800',
  'Message-ID: <abc123@example.com>',
  'MIME-Version: 1.0',
  'Content-Type: multipart/mixed; boundary="BOUND1"',
  '',
  '--BOUND1',
  'Content-Type: multipart/alternative; boundary="BOUND2"',
  '',
  '--BOUND2',
  'Content-Type: text/plain; charset=utf-8',
  '',
  '这是纯文本正文',
  '--BOUND2',
  'Content-Type: text/html; charset=utf-8',
  '',
  '<html><body><p>这是HTML正文</p></body></html>',
  '--BOUND2--',
  '--BOUND1',
  `Content-Type: application/pdf; name="${encodedFileName}"`,
  'Content-Transfer-Encoding: base64',
  `Content-Disposition: attachment; filename="${encodedFileName}"`,
  '',
  pdfB64,
  '--BOUND1',
  'Content-Type: text/csv; charset=utf-8; name="data.csv"',
  'Content-Disposition: attachment; filename="data.csv"',
  'Content-Transfer-Encoding: quoted-printable',
  '',
  'a,b,c',
  '1,2,3',
  '--BOUND1',
  'Content-Type: image/png',
  'Content-Transfer-Encoding: base64',
  'Content-Disposition: inline',
  'Content-ID: <logo@example.com>',
  '',
  'iVBORw0KGgo=',
  '--BOUND1',
  'Content-Type: message/rfc822',
  'Content-Disposition: attachment; filename="转发邮件.eml"',
  '',
  'From: inner@example.com',
  'Subject: =?UTF-8?B?' + utf8b64('内部邮件') + '?=',
  '',
  '内层邮件正文',
  '--BOUND1--',
  ''
].join(CRLF);

check('multipart/mixed：头部元数据（编码词主题/发件人）', () => {
  const mail = parseEmailMessage(Buffer.from(multipartMail, 'utf8'));
  assertEqual(mail.subject, '测试主题', 'subject');
  assert(mail.from.includes('张三') && mail.from.includes('zhangsan@example.com'), 'from');
  assertEqual(mail.to, 'lisi@example.com', 'to');
  assertEqual(mail.cc, 'wangwu@example.com', 'cc');
  assertEqual(mail.messageId, '<abc123@example.com>', 'messageId');
});

check('multipart/alternative：正文优先取 text/plain', () => {
  const mail = parseEmailMessage(Buffer.from(multipartMail, 'utf8'));
  assertEqual(mail.text, '这是纯文本正文', '正文应为纯文本版而非 HTML 版');
});

check('base64 PDF 附件：编码文件名解码 + 字节完整', () => {
  const mail = parseEmailMessage(Buffer.from(multipartMail, 'utf8'));
  const pdf = mail.attachments.find((a) => a.contentType === 'application/pdf');
  assert(pdf, '应有 PDF 附件');
  assertEqual(pdf.filename, '测试文件.pdf', '附件名');
  assert(Buffer.isBuffer(pdf.data), '附件应为 Buffer');
  assert(pdf.data.equals(pdfBytes), '附件字节应与原文一致');
  assertEqual(pdf.data.length, pdfBytes.length, '附件长度');
});

check('quoted-printable 附件 + 内联 CID 图被跳过 + 嵌套邮件存为 .eml', () => {
  const mail = parseEmailMessage(Buffer.from(multipartMail, 'utf8'));
  const csv = mail.attachments.find((a) => a.filename === 'data.csv');
  assert(csv, '应有 CSV 附件');
  // QP 解码只去掉软换行（=CRLF），正文内的硬换行按字节保留（fixture 用 CRLF 拼接）
  assertEqual(csv.data.toString('utf8'), 'a,b,c\r\n1,2,3', 'CSV 内容');
  const png = mail.attachments.find((a) => a.contentType === 'image/png');
  assert(!png, '无文件名的内联 CID 图不应成为附件');
  const nested = mail.attachments.find((a) => a.contentType === 'message/rfc822');
  assert(nested, '应有嵌套邮件附件');
  assert(nested.filename.endsWith('.eml'), '嵌套邮件应存为 .eml');
  assert(nested.data.toString('utf8').includes('内层邮件正文'), '嵌套邮件内容完整');
});

// --- GBK 字符集正文 ---

const gbkBytes = Buffer.from([0xd6, 0xd0, 0xce, 0xc4, 0xb2, 0xe2, 0xca, 0xd4]); // "中文测试" GBK
const gbkMail = [
  'From: a@example.com',
  'Subject: GBK 邮件',
  'Content-Type: text/plain; charset=gbk',
  'Content-Transfer-Encoding: base64',
  '',
  gbkBytes.toString('base64'),
  ''
].join(CRLF);

check('GBK charset 正文按声明编码解码', () => {
  const mail = parseEmailMessage(Buffer.from(gbkMail, 'utf8'));
  assert(mail.text.includes('中文测试'), `正文应为 GBK 解码结果，实际：${mail.text.slice(0, 20)}`);
});

// --- 简单 LF 邮件（无 MIME multipart） ---

check('简单 LF 邮件（无 multipart）', () => {
  const mail = parseEmailMessage(Buffer.from('From: a@b.c\nTo: d@e.f\nSubject: Hi\n\nBody line\n', 'utf8'));
  assertEqual(mail.subject, 'Hi', 'subject');
  assertEqual(mail.text, 'Body line', 'text');
  assertEqual(mail.attachments.length, 0, '无附件');
});

// --- 畸形输入兜底 ---

check('二进制垃圾输入不抛异常', () => {
  const junk = Buffer.from([0x00, 0x01, 0xff, 0xfe, 0x00, 0x80, 0x7f, 0x00]);
  const mail = parseEmailMessage(junk);
  assert(mail && typeof mail.text === 'string', '应返回结构化结果');
  assert(Array.isArray(mail.attachments), 'attachments 应为数组');
});

// --- extractTextFromBuffer email 分支（端到端：含 parsePackage 元数据透传） ---

const attachmentOnlyMail = [
  'From: sender@example.com',
  'Subject: 只有附件的邮件',
  'Content-Type: multipart/mixed; boundary="B"',
  '',
  '--B',
  'Content-Type: application/pdf; name="only.pdf"',
  'Content-Transfer-Encoding: base64',
  'Content-Disposition: attachment; filename="only.pdf"',
  '',
  pdfB64,
  '--B--',
  ''
].join(CRLF);

(async () => {
  try {
    const result = await extractTextFromBuffer('06-知识库/源文件/招投标/邮件/测试.eml', Buffer.from(attachmentOnlyMail, 'utf8'), {});
    assertEqual(result.status, 'ok', 'status');
    assert(result.text.includes('本邮件正文为空'), '占位正文');
    assert(result.text.includes('only.pdf'), '占位正文应列出附件名');
    assert(Array.isArray(result.attachments) && result.attachments.length === 1, 'result.attachments 应携带 1 个 Buffer');
    assert(Buffer.isBuffer(result.attachments[0].data) && result.attachments[0].data.equals(pdfBytes), '附件字节完整');
    assert(result.parsePackage, '应有 parsePackage');
    assertEqual(result.parsePackage.metadata.subject, '只有附件的邮件', 'parsePackage.metadata.subject');
    assertEqual(result.parsePackage.metadata.attachments.length, 1, 'parsePackage.metadata.attachments');
    assertEqual(result.parsePackage.metadata.attachments[0].filename, 'only.pdf', '附件元数据名');
    assertEqual(result.parsePackage.metadata.attachments[0].size, pdfBytes.length, '附件元数据大小');
    assert(!('data' in result.parsePackage.metadata.attachments[0]), '附件二进制不得进入可序列化的 parsePackage');
    JSON.stringify(result.parsePackage); // 必须可 JSON 序列化（persistArtifact 前提）
    pass += 1;
    console.log('  ✓ extractTextFromBuffer：空正文+附件 → 占位正文且 status ok');
  } catch (error) {
    fail += 1;
    console.error('  ✗ extractTextFromBuffer：空正文+附件 → 占位正文且 status ok');
    console.error(`    ${error.message}`);
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
})();
