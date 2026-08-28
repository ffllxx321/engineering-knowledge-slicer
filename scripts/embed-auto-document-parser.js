'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const bundlePath = path.join(root, 'main.js');
const id = 'src/auto-document-parser.js';
const start = `"${id}": function(require, module, exports) {`;
const next = '/**\n * @module src/core/external-pdf';
const source = fs.readFileSync(path.join(root, id), 'utf8')
  .replace(/^'use strict';\s*/, '')
  .replace(/require\('\.\/content-integrity\.js'\)/g, 'require("src/content-integrity.js")')
  .trim();
const current = fs.readFileSync(bundlePath, 'utf8');
const from = current.indexOf(start);
const nextAt = current.indexOf(next, from);
assert(from >= 0 && nextAt > from, '找不到 AutoDocumentParser bundle 模块边界');
const closeAt = current.lastIndexOf('\n},\n', nextAt);
assert(closeAt > from, '找不到 AutoDocumentParser bundle 结束边界');
const generated = `${start}\n${source}\n}`;
const expected = `${current.slice(0, from)}${generated}${current.slice(closeAt + 2)}`;
if (process.argv.includes('--check')) {
  assert.strictEqual(current, expected, 'main.js 内嵌 AutoDocumentParser 与 src 源文件不同步');
  console.log('auto document parser embed: synchronized');
} else {
  fs.writeFileSync(bundlePath, expected);
  console.log('auto document parser embed: updated');
}
