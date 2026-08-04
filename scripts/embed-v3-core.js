'use strict';

const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const bundlePath = path.join(root, 'main.js');
const ids = ['contracts', 'adapters', 'orchestrator', 'index'];
const begin = '/* V3_CORE_MODULES_BEGIN */';
const end = '/* V3_CORE_MODULES_END */';
let bundle = fs.readFileSync(bundlePath, 'utf8');
const modules = ids.map((name) => {
  let source = fs.readFileSync(path.join(root, 'src', 'v3', `${name}.js`), 'utf8');
  source = source.replace(/require\('\.\/contracts'\)/g, 'require("src/v3/contracts.js")')
    .replace(/require\('\.\/adapters'\)/g, 'require("src/v3/adapters.js")')
    .replace(/require\('\.\/orchestrator'\)/g, 'require("src/v3/orchestrator.js")');
  if (name === 'index') source = source.replace(/require\('\.\/contracts'\)/g, 'require("src/v3/contracts.js")');
  return `"src/v3/${name}.js": function(require, module, exports) {\n${source}\n}`;
}).join(',\n');
const block = `${begin}\n${modules}\n${end}`;
if (bundle.includes(begin)) {
  const start = bundle.indexOf(begin); const finish = bundle.indexOf(end, start);
  if (finish < 0) throw new Error('v3 module end marker not found');
  bundle = `${bundle.slice(0, start)}${block}${bundle.slice(finish + end.length)}`;
}
else {
  const anchor = '\n}\n};\nconst __cache = {};';
  const index = bundle.lastIndexOf(anchor);
  if (index < 0) throw new Error('bundle module-table anchor not found');
  bundle = `${bundle.slice(0, index)}\n},\n${block}${bundle.slice(index + 2)}`;
}
fs.writeFileSync(bundlePath, bundle);
console.log('v3 core embedded in main.js');
