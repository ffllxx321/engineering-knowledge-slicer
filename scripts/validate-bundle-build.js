const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const esbuild = require('esbuild');

async function main() {
  const source = path.join(__dirname, '..', 'main.js');
  const original = fs.readFileSync(source);
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'eks-build-'));
  const output = path.join(directory, 'main.js');
  try {
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
    assert(original.equals(fs.readFileSync(source)), 'validation must not mutate production main.js');
    console.log(`bundle validation: ok (${built.length} bytes, production source unchanged)`);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
