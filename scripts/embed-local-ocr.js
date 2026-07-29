'use strict';

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const bundlePath = path.join(root, 'main.js');
const sourcePath = path.join(root, 'src', 'local-ocr.js');
const moduleId = 'src/core/local-ocr.js';
const startMarker = `/**\n * @module ${moduleId}\n */\n"${moduleId}": function(require, module, exports) {\n`;
const endMarker = '\n\n},\n';
const insertionMarker = '/**\n * @module src/core/block-v0\n';

function generatedModule() {
  const source = fs.readFileSync(sourcePath, 'utf8').replace(/\s+$/, '');
  return `${startMarker}${source}${endMarker}`;
}

function replaceEmbeddedModule(bundle) {
  const start = bundle.indexOf(startMarker);
  if (start >= 0) {
    const nextModule = bundle.indexOf(insertionMarker, start + startMarker.length);
    if (nextModule < 0) throw new Error(`找不到 ${moduleId} 后续模块`);
    return bundle.slice(0, start) + generatedModule() + bundle.slice(nextModule);
  }
  const insertion = bundle.indexOf(insertionMarker);
  if (insertion < 0) throw new Error(`找不到插入点：${insertionMarker}`);
  return bundle.slice(0, insertion) + generatedModule() + bundle.slice(insertion);
}

const current = fs.readFileSync(bundlePath, 'utf8');
const expected = replaceEmbeddedModule(current);
if (process.argv.includes('--check')) {
  if (current !== expected) {
    console.error(`bundle 中的 ${moduleId} 与 src/local-ocr.js 不一致；请运行 node scripts/embed-local-ocr.js`);
    process.exitCode = 1;
  }
} else if (current !== expected) {
  fs.writeFileSync(bundlePath, expected);
  console.log(`embedded ${moduleId} into main.js`);
}
