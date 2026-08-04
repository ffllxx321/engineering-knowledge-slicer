'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const root = path.join(__dirname, '..');
const binary = process.env.OBSIDIAN_APPIMAGE || '/tmp/Obsidian-1.12.7.AppImage';
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function evaluate(port) {
  const pages = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
  const page = pages.find((item) => item.type === 'page' && item.webSocketDebuggerUrl && !String(item.url).startsWith('devtools:'));
  if (!page) return false;
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(page.webSocketDebuggerUrl); const timer = setTimeout(() => reject(new Error('CDP timeout')), 15000);
    socket.onopen = () => socket.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { awaitPromise: true, returnByValue: true,
      expression: '(async()=>{if(typeof app==="undefined"||!app.plugins)return false;localStorage.setItem("enable-plugin-"+app.appId,"true");let p=app.plugins.plugins["engineering-knowledge-slicer"]||await app.plugins.loadPlugin("engineering-knowledge-slicer");if(!p||typeof p.runV3RealObsidianGateProbe!=="function")return false;await p.runV3RealObsidianGateProbe();return true})()' } }));
    socket.onmessage = (event) => { const message = JSON.parse(event.data); if (message.id === 1) { clearTimeout(timer); socket.close(); resolve(message.result?.result?.value === true); } };
    socket.onerror = reject;
  });
}

async function launch(vault, config, resultPath, restartExpected) {
  try { fs.unlinkSync(resultPath); } catch (_) {}
  const port = 20000 + Math.floor(Math.random() * 1000);
  const child = spawn('xvfb-run', ['-a', binary, '--no-sandbox', '--disable-gpu', `--remote-debugging-port=${port}`,
    `--user-data-dir=${config}`, `obsidian://open?path=${encodeURIComponent(vault)}`], { detached: true, stdio: 'ignore',
    env: { ...process.env, HOME: path.dirname(config), XDG_CONFIG_HOME: config } });
  const deadline = Date.now() + Number(process.env.EKS_OBSIDIAN_GATE_TIMEOUT_MS || 120000); let invoked = false;
  while (Date.now() < deadline && !fs.existsSync(resultPath)) {
    if (!invoked) { try { invoked = await evaluate(port); } catch (_) {} }
    await sleep(500);
  }
  try { process.kill(-child.pid, 'SIGTERM'); } catch (_) { child.kill('SIGTERM'); }
  assert(fs.existsSync(resultPath), 'official Obsidian host did not produce v3 evidence');
  const result = JSON.parse(fs.readFileSync(resultPath, 'utf8'));
  assert.strictEqual(result.ok, true); assert.strictEqual(result.real_host, true); assert.strictEqual(result.host_api, 'Obsidian Vault');
  assert.strictEqual(result.restart, restartExpected); return result;
}

(async () => {
  assert(fs.existsSync(binary), `Official Obsidian AppImage missing: ${binary}`);
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'eks-v3-obsidian-')); const vault = path.join(temporary, 'vault');
  const config = path.join(temporary, 'config'); const plugin = path.join(vault, '.obsidian/plugins/engineering-knowledge-slicer');
  fs.mkdirSync(plugin, { recursive: true }); fs.mkdirSync(config, { recursive: true });
  for (const file of ['main.js', 'manifest.json', 'styles.css']) fs.copyFileSync(path.join(root, file), path.join(plugin, file));
  fs.writeFileSync(path.join(vault, '.obsidian/community-plugins.json'), JSON.stringify(['engineering-knowledge-slicer']));
  fs.writeFileSync(path.join(vault, '.obsidian/app.json'), '{}');
  fs.writeFileSync(path.join(config, 'obsidian.json'), JSON.stringify({ vaults: { v3: { path: vault, ts: Date.now(), open: true } } }));
  const resultPath = path.join(vault, 'EKS v3 Phase 1 Gate/result.json');
  const first = await launch(vault, config, resultPath, false); const restart = await launch(vault, config, resultPath, true);
  assert(first.visible_openable.includes(restart.final_path));
  assert.strictEqual(first.phase2_complete, true); assert.strictEqual(restart.phase2_complete, true);
  assert(first.phase2_counts.accepted > 0); assert(first.phase2_preview.path.endsWith('.preview.md')); assert(first.phase2_artifact.path.endsWith('.candidates.json'));
  const artifact = { schema: 'eks/v3/real-obsidian-evidence/1', passed: true, generated_at: new Date().toISOString(), first, restart };
  fs.mkdirSync(path.join(root, 'test-artifacts'), { recursive: true });
  fs.writeFileSync(path.join(root, 'test-artifacts/v3-real-obsidian-evidence.json'), JSON.stringify(artifact, null, 2));
  console.log('v3 real Obsidian gate: PASS');
})().catch((error) => { console.error(error); process.exitCode = 1; });
