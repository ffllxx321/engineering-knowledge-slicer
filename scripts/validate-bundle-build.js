const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Module = require('module');
const esbuild = require('esbuild');

async function main() {
  const root = path.join(__dirname, '..');
  const source = path.join(root, 'main.js');
  const original = fs.readFileSync(source);
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'eks-build-'));
  const output = path.join(directory, 'main.js');
  try {
    const runtimeRelativeImports = [...original.toString('utf8').matchAll(/\brequire\((['"])(\.[^'"]+)\1\)/g)]
      .map((match) => match[2]);
    assert.deepStrictEqual(runtimeRelativeImports, [],
      `main.js contains undeclared relative runtime dependencies: ${runtimeRelativeImports.join(', ')}`);

    await esbuild.build({
      entryPoints: [source],
      outfile: output,
      bundle: true,
      platform: 'node',
      format: 'cjs',
      target: 'node18',
      external: ['obsidian', 'electron'],
      logLevel: 'silent'
    });
    const built = fs.readFileSync(output, 'utf8');
    assert(built.length > 100_000, 'bundle validation output is unexpectedly small');
    for (const marker of ['EngineeringKnowledgeSlicerPlugin', 'src/core/workflow.js', 'src/core/link-service.js']) {
      assert(built.includes(marker), `built bundle lost marker: ${marker}`);
    }
    const install = path.join(directory, 'clean-install');
    fs.mkdirSync(install);
    for (const file of ['main.js', 'manifest.json', 'styles.css']) {
      fs.copyFileSync(path.join(root, file), path.join(install, file));
    }
    assert.deepStrictEqual(fs.readdirSync(install).sort(), ['main.js', 'manifest.json', 'styles.css'],
      'clean install must contain exactly main.js, manifest.json and styles.css');

    const originalLoad = Module._load;
    const hostApi = new Proxy(class HostApi {}, {
      get(target, property) {
        if (property === 'requestUrl') return async () => ({ status: 200, json: {}, text: '' });
        if (property === 'normalizePath') return (value) => value;
        return target;
      }
    });
    try {
      Module._load = function(request, parent, isMain) {
        if (request === 'obsidian' || request === 'electron') return hostApi;
        return originalLoad.call(this, request, parent, isMain);
      };
      const exported = require(path.join(install, 'main.js'));
      assert.strictEqual(typeof exported, 'function', 'clean install startup must export the plugin class');
    } finally {
      Module._load = originalLoad;
    }
    assert(original.equals(fs.readFileSync(source)), 'validation must not mutate production main.js');
    console.log(`bundle validation: ok (${built.length} bytes, exact three-file clean install starts)`);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
