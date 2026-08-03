const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function loadBundleModule(id, dependencies = {}) {
  const code = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
  const marker = `"${id}": function(require, module, exports) {`;
  const start = code.indexOf(marker);
  if (start < 0) throw new Error(`找不到 bundle 模块：${id}`);
  const bodyStart = start + marker.length;
  const endings = [
    code.indexOf('\n},\n/**', bodyStart),
    code.indexOf('\n},\n/*', bodyStart),
    code.indexOf('\n},\n"', bodyStart),
    code.indexOf('\n}\n};', bodyStart)
  ].filter((position) => position >= 0);
  const end = endings.length ? Math.min(...endings) : -1;
  if (end < 0) throw new Error(`找不到 bundle 模块结尾：${id}`);
  const module = { exports: {} };
  new Function('require', 'module', 'exports', code.slice(bodyStart, end))(
    (name) => {
      if (Object.hasOwn(dependencies, name)) return dependencies[name];
      if (name === 'src/core/document-parser.js') {
        const block = loadBundleModule('src/core/block-v0.js', { crypto });
        const provenance = loadBundleModule('src/core/provenance.js', { crypto });
        return loadBundleModule(name, {
          crypto,
          'src/core/block-v0.js': block,
          'src/core/provenance.js': provenance
        });
      }
      throw new Error(`未提供依赖：${name}`);
    },
    module,
    module.exports
  );
  return module.exports;
}

module.exports = { loadBundleModule };
