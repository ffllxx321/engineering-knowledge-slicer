const fs = require('fs');
const path = require('path');

function loadBundleModule(id, dependencies = {}) {
  const code = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
  const marker = `"${id}": function(require, module, exports) {`;
  const start = code.indexOf(marker);
  if (start < 0) throw new Error(`找不到 bundle 模块：${id}`);
  const bodyStart = start + marker.length;
  let end = code.indexOf('\n},\n/**', bodyStart);
  if (end < 0) end = code.indexOf('\n}\n};', bodyStart);
  if (end < 0) throw new Error(`找不到 bundle 模块结尾：${id}`);
  const module = { exports: {} };
  new Function('require', 'module', 'exports', code.slice(bodyStart, end))(
    (name) => {
      if (Object.hasOwn(dependencies, name)) return dependencies[name];
      throw new Error(`未提供依赖：${name}`);
    },
    module,
    module.exports
  );
  return module.exports;
}

module.exports = { loadBundleModule };
