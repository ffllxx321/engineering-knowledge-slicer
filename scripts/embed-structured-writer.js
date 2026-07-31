'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const bundlePath = path.join(root, 'main.js');
const START = '/** STRUCTURED_PHASE_MODULES_START */';
const OLD_START = '/* STRUCTURED_PHASE_MODULES_START */';
const END = '/* STRUCTURED_PHASE_MODULES_END */';
const modules = [
  ['src/phase1-foundation.js', 'src/phase1-foundation.js'],
  ['src/phase2-candidate-pipeline.js', 'src/phase2-candidate-pipeline.js'],
  ['src/phase3-review-gate.js', 'src/phase3-review-gate.js'],
  ['src/universal-knowledge-pipeline.js', 'src/universal-knowledge-pipeline.js'],
  ['src/structured-writer.js', 'src/structured-writer.js']
];
function factory(id, sourcePath) {
  const source = fs.readFileSync(path.join(root, sourcePath), 'utf8')
    .replace(/^'use strict';\s*/, '')
    .replace(/require\('\.\/phase1-foundation\.js'\)/g, 'require("src/phase1-foundation.js")');
  return `"${id}": function(require, module, exports) {\n${source.trim()}\n},`;
}
const generated = `${START}\n${modules.map(([id, file]) => factory(id, file)).join('\n')}\n${END}`;
const current = fs.readFileSync(bundlePath, 'utf8');
let expected;
const presentStart = current.includes(START) ? START : current.includes(OLD_START) ? OLD_START : '';
if (presentStart) {
  expected = current.slice(0, current.indexOf(presentStart)) + generated
    + current.slice(current.indexOf(END) + END.length);
} else {
  const anchor = '/**\n * @module src/core/task';
  const offset = current.indexOf(anchor);
  assert(offset >= 0, '找不到结构化模块插入锚点');
  expected = `${current.slice(0, offset)}${generated}\n${current.slice(offset)}`;
}
if (process.argv.includes('--check')) {
  assert.strictEqual(current, expected, 'main.js 内嵌结构化模块与 src 源文件不同步');
  console.log('structured phase embed: synchronized');
} else {
  fs.writeFileSync(bundlePath, expected);
  console.log('structured phase embed: updated');
}
