'use strict';

// REAL HOST GATE. This script launches the official Obsidian AppImage. It does
// not load the npm `obsidian` shim and deliberately contains no TFile/Vault mock.
const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawn } = require('child_process');

const root = path.join(__dirname, '..');
const binary = process.env.OBSIDIAN_APPIMAGE || '/tmp/Obsidian-1.12.7.AppImage';
const sha = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function processesForConfig(config) {
  try {
    return execFileSync('pgrep', ['-f', '--', `--user-data-dir=${config}`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
      .trim().split(/\s+/).map(Number).filter((pid) => pid > 1 && pid !== process.pid);
  } catch (_) { return []; }
}

async function stopHost(child, config) {
  try { process.kill(-child.pid, 'SIGTERM'); } catch (_) { child.kill('SIGTERM'); }
  for (const pid of processesForConfig(config)) { try { process.kill(pid, 'SIGTERM'); } catch (_) {} }
  await Promise.race([new Promise((resolve) => child.once('exit', resolve)), sleep(3000)]);
  for (const pid of processesForConfig(config)) { try { process.kill(pid, 'SIGKILL'); } catch (_) {} }
}

async function launch(vault, config, resultPath) {
  try { fs.unlinkSync(resultPath); } catch (_) {}
  const debugPort = 19000 + Math.floor(Math.random() * 1000);
  const child = spawn('xvfb-run', ['-a', binary, '--no-sandbox', '--disable-gpu', `--remote-debugging-port=${debugPort}`,
    `--user-data-dir=${config}`, `obsidian://open?path=${encodeURIComponent(vault)}`], {
    env: { ...process.env, HOME: path.dirname(config), XDG_CONFIG_HOME: config,
      EKS_REAL_OBSIDIAN_GATE: '1', ELECTRON_DISABLE_SECURITY_WARNINGS: 'true' },
    stdio: ['ignore', 'pipe', 'pipe'], detached: true
  });
  let output = '';
  const diagnostics = [];
  child.stdout.on('data', (chunk) => { output += chunk; });
  child.stderr.on('data', (chunk) => { output += chunk; });
  const deadline = Date.now() + Number(process.env.EKS_OBSIDIAN_GATE_TIMEOUT_MS || 120000);
  let enableAttempted = false;
  while (Date.now() < deadline && !fs.existsSync(resultPath)) {
    if (child.exitCode !== null) break;
    if (!enableAttempted) {
      try {
        const pages = await (await fetch(`http://127.0.0.1:${debugPort}/json`)).json();
        const page = pages.find((item) => item.type === 'page' && item.webSocketDebuggerUrl
          && !String(item.url || '').startsWith('devtools://'));
        if (page) {
          const enabled = await new Promise((resolve, reject) => {
            const socket = new WebSocket(page.webSocketDebuggerUrl);
            const timer = setTimeout(() => { socket.close(); reject(new Error('CDP timeout')); }, 10000);
            socket.onopen = () => socket.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: {
              expression: '(async()=>{if(typeof app==="undefined")return {ok:false,stage:"no_app"};if(!app.plugins||!app.workspace)return {ok:false,stage:"host_not_ready",plugins:!!app.plugins,workspace:!!app.workspace,vault:!!app.vault};localStorage.setItem("enable-plugin-"+app.appId,"true");let p=app.plugins.plugins["engineering-knowledge-slicer"];if(!p){try{p=await app.plugins.loadPlugin("engineering-knowledge-slicer")}catch(error){return {ok:false,stage:"load_throw",error:String(error&&error.stack||error)}}}if(!p)return {ok:false,stage:"not_loaded",globalCommunityPluginsEnabled:app.plugins.isEnabled(),manifest:app.plugins.manifests["engineering-knowledge-slicer"]||null};if(typeof p.runRealObsidianGateProbe!=="function")return {ok:false,stage:"probe_missing",pluginKeys:Object.getOwnPropertyNames(Object.getPrototypeOf(p))};try{await p.runRealObsidianGateProbe()}catch(error){return {ok:false,stage:"probe_throw",error:String(error&&error.stack||error)}}return {ok:true,stage:"complete",appId:app.appId,pluginVersion:p.manifest.version,pluginId:p.manifest.id}})()', awaitPromise: true, returnByValue: true
            } }));
            socket.onmessage = (event) => { const message = JSON.parse(event.data); if (message.id === 1) {
              clearTimeout(timer); socket.close();
              diagnostics.push({ page: { title: page.title, url: page.url }, evaluation: message.result });
              resolve(message.result?.result?.value?.ok === true);
            } };
            socket.onerror = reject;
          });
          enableAttempted = enabled;
        }
      } catch (error) { diagnostics.push({ cdp_error: String(error?.stack || error) }); }
    }
    await sleep(500);
  }
  await stopHost(child, config);
  assert(fs.existsSync(resultPath), `Obsidian did not produce gate evidence. CDP: ${JSON.stringify(diagnostics.slice(-8))}. Output: ${output.slice(-4000)}`);
  const result = JSON.parse(fs.readFileSync(resultPath, 'utf8'));
  const loaded = [...diagnostics].reverse().find((item) => item.evaluation?.result?.value?.stage === 'complete');
  assert(loaded, `CDP never observed a loaded plugin instance: ${JSON.stringify(diagnostics.slice(-8))}`);
  const hostVersion = String(loaded.page?.title || '').match(/Obsidian\s+([0-9.]+)/)?.[1];
  assert(hostVersion, `Could not derive host version from real window title: ${loaded.page?.title || ''}`);
  result.cdp_load = loaded.evaluation.result.value;
  result.host_window_title = loaded.page.title;
  result.obsidian_version = hostVersion;
  assert.strictEqual(result.real_host, true);
  assert.strictEqual(result.host_api, 'Obsidian Vault');
  assert.strictEqual(result.ok, true, JSON.stringify(result));
  return result;
}

async function main() {
  assert(fs.existsSync(binary), `Official Obsidian AppImage missing: ${binary}`);
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'eks-real-obsidian-'));
  const vault = path.join(temporary, 'vault');
  const config = path.join(temporary, 'config');
  const plugin = path.join(vault, '.obsidian', 'plugins', 'engineering-knowledge-slicer');
  fs.mkdirSync(plugin, { recursive: true });
  for (const file of ['main.js', 'manifest.json', 'styles.css']) fs.copyFileSync(path.join(root, file), path.join(plugin, file));
  fs.writeFileSync(path.join(vault, '.obsidian', 'community-plugins.json'), JSON.stringify(['engineering-knowledge-slicer']));
  fs.writeFileSync(path.join(vault, '.obsidian', 'app.json'), JSON.stringify({ promptDelete: false }));
  fs.mkdirSync(config, { recursive: true });
  fs.writeFileSync(path.join(config, 'obsidian.json'), JSON.stringify({ vaults: { gate: { path: vault, ts: Date.now(), open: true } } }));
  fs.writeFileSync(path.join(config, 'gate.json'), '{}');
  const resultPath = path.join(vault, 'EKS Release Gate', 'result.json');
  const first = await launch(vault, config, resultPath);
  const second = await launch(vault, config, resultPath);
  assert.deepStrictEqual(second.visible_openable, first.visible_openable, 'restart changed visible record set');
  const evidence = {
    schema: 'eks/real-obsidian-release-evidence/1.0', passed: true,
    generated_at: new Date().toISOString(), commit: require('child_process').execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
    bundle_sha256: sha(path.join(root, 'main.js')), obsidian_appimage_sha256: sha(binary),
    obsidian_version: first.obsidian_version, plugin_version: require(path.join(root, 'manifest.json')).version,
    first_launch: first, restart: second
  };
  const evidenceDir = path.join(root, 'test-artifacts');
  fs.mkdirSync(evidenceDir, { recursive: true });
  fs.writeFileSync(path.join(evidenceDir, 'real-obsidian-release-evidence.json'), JSON.stringify(evidence, null, 2));
  console.log(`REAL Obsidian release gate: PASS (${evidence.bundle_sha256})`);
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
