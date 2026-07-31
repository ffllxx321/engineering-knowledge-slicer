'use strict';

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const mainPath = path.join(root, 'main.js');
const sourcePath = path.join(root, 'src', 'table-knowledge.js');
const marker = '"src/core/workflow.js": function(require, module, exports) {';
const moduleMarker = '"src/core/table-knowledge.js": function(require, module, exports) {';
const source = fs.readFileSync(sourcePath, 'utf8');
const wrapped = `${moduleMarker}\n${source}\n\n},\n`;
let main = fs.readFileSync(mainPath, 'utf8');
const start = main.indexOf(moduleMarker);
if (start >= 0) {
  const end = main.indexOf('\n},\n"src/core/workflow.js"', start);
  if (end < 0) throw new Error('Cannot locate embedded table knowledge module boundary');
  main = `${main.slice(0, start)}${wrapped}${main.slice(end + 4)}`;
} else {
  const workflow = main.indexOf(marker);
  if (workflow < 0) throw new Error('Cannot locate workflow module');
  main = `${main.slice(0, workflow)}${wrapped}${main.slice(workflow)}`;
}
fs.writeFileSync(mainPath, main);
if (process.argv.includes('--check')) {
  const embedded = fs.readFileSync(mainPath, 'utf8');
  if (!embedded.includes(source)) throw new Error('Embedded table knowledge module is stale');
}
