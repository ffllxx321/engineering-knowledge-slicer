'use strict';
const assert = require('assert');
const { PluginActivation } = require('../src/plugin-activation.js');
let views = 0; let commands = 0; let unregisters = 0;
const workspace = { unregisterView: () => { unregisters += 1; views -= 1; } };
const lifecycle = new PluginActivation();
const activate = async () => { if (!lifecycle.begin()) return false; await Promise.resolve(); views += 1; commands += 9; lifecycle.registered(); return true; };
(async () => {
  const results = await Promise.all([activate(), activate(), activate()]);
  assert.deepStrictEqual(results, [true, false, false]); assert.strictEqual(views, 1); assert.strictEqual(commands, 9);
  lifecycle.unload(workspace, 'engineering-knowledge-slicer-dashboard'); assert.strictEqual(views, 0); assert.strictEqual(unregisters, 1);
  assert.strictEqual(await activate(), true); assert.strictEqual(views, 1); assert.strictEqual(commands, 18);
  lifecycle.unload(workspace, 'engineering-knowledge-slicer-dashboard'); assert.strictEqual(views, 0); assert.strictEqual(unregisters, 2);
  const failed=new PluginActivation(); assert(failed.begin()); failed.registered(); failed.unload(workspace,'engineering-knowledge-slicer-dashboard'); failed.failed(); assert(failed.begin(),'a propagated unrelated load error must permit a clean retry');
  console.log(JSON.stringify({ schema: 'eks/phase6-startup-regression/1', concurrent_activations: 3, view_registrations: 2, command_sets: 2, clean_reload: true }));
})().catch(e => { console.error(e); process.exitCode = 1; });
