'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { launch, writeLifecycleFailureReport } = require('./acceptance-real.js');

(async () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'eks-lifecycle-regression-'));
  const resultPath = path.join(temporary, 'never-created.json');
  const previousGrace = process.env.EKS_ACCEPTANCE_KILL_GRACE_MS;
  process.env.EKS_ACCEPTANCE_KILL_GRACE_MS = '150';
  const started = Date.now();
  let failure;
  try {
    await launch(temporary, temporary, resultPath, {}, {
      command: process.execPath,
      args: ['-e', "process.on('SIGTERM',()=>{});setInterval(()=>{},1000)"],
      skipEvaluate: true,
      timeoutMs: 200
    });
  } catch (error) {
    failure = error;
    writeLifecycleFailureReport(error, temporary);
  } finally {
    if (previousGrace === undefined) delete process.env.EKS_ACCEPTANCE_KILL_GRACE_MS;
    else process.env.EKS_ACCEPTANCE_KILL_GRACE_MS = previousGrace;
  }
  const elapsed = Date.now() - started;
  assert(failure, 'never-exiting child must fail');
  assert.strictEqual(failure.code, 'HOST_RESULT_TIMEOUT');
  assert(elapsed < 2000, `bounded cleanup/reporting took ${elapsed}ms`);
  assert(failure.evidence.pid > 0, 'failure must identify the child');
  assert.throws(() => process.kill(failure.evidence.pid, 0), (error) => error.code === 'ESRCH',
    'stuck child must be gone after forced cleanup');
  const report = JSON.parse(fs.readFileSync(path.join(temporary, 'test-artifacts/acceptance-real.json'), 'utf8'));
  assert.strictEqual(report.passed, false);
  assert.strictEqual(report.lifecycle_failure.code, 'HOST_RESULT_TIMEOUT');
  assert.strictEqual(report.lifecycle_failure.evidence.pid, failure.evidence.pid);
  assert(fs.readFileSync(path.join(temporary, 'test-artifacts/acceptance-real.md'), 'utf8').includes('HOST_RESULT_TIMEOUT'));
  console.log(`acceptance lifecycle regression: forced cleanup and typed reports passed (${elapsed}ms)`);
})().catch((error) => { console.error(error); process.exitCode = 1; });
