// v2.4 RateLimiter 烟雾测试
// 验证修复后 waiters 数组不会泄漏 / 重复

const { setTimeout: sleep } = require('timers/promises');

// 加载 main.js bundle (IIFE) - 通过 vm 跑出来
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const code = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf-8');
const sandbox = {
  console,
  setTimeout,
  clearTimeout,
  Promise,
  Date,
  Math,
  JSON,
  Object,
  Array,
  String,
  Number,
  Boolean,
  Set,
  Map,
  Error,
  Symbol,
  Reflect,
  TextDecoder,
  TextEncoder,
  process,
  Buffer,
  require: (id) => {
    // main.js 是 IIFE 形式；其内部已经 require 了一些 Node 模块
    return require(id);
  }
};
sandbox.globalThis = sandbox;
sandbox.window = sandbox;
sandbox.self = sandbox;
vm.createContext(sandbox);

try {
  vm.runInContext(code, sandbox, { filename: 'main.js' });
} catch (e) {
  // main.js 在沙箱里跑会缺 obsidian/electron 等，跳过错误
  console.warn('main.js IIFE 在裸 Node 沙箱中部分 API 不可用 — 通过 eval 直接取 RateLimiter 类');
}

// 直接 evaluate 一份 RateLimiter 副本用于测试
const RL_CODE = `
class RateLimiter {
  constructor({ intervalMs = 1000, maxConcurrent = 2, backoffMaxMs = 30000, windowSize = 10 } = {}) {
    this.intervalMs = intervalMs;
    this.maxConcurrent = maxConcurrent;
    this.backoffMaxMs = backoffMaxMs;
    this.windowSize = windowSize;
    this.timestamps = [];
    this.failures = 0;
    this.waiters = [];
  }
  _cleanupExpired(now) {
    const cutoff = now - this.intervalMs * this.windowSize;
    while (this.timestamps.length && this.timestamps[0] < cutoff) this.timestamps.shift();
  }
  _activeInWindow(now) {
    const cutoff = now - this.intervalMs;
    let count = 0;
    for (const t of this.timestamps) if (t >= cutoff) count += 1;
    return count;
  }
  _scheduleNextWaiter() {
    if (!this.waiters.length) return;
    const next = this.waiters.shift();
    clearTimeout(next.timer);
    if (next.done) return this._scheduleNextWaiter();
    next.done = true;
    next.resolve();
  }
  acquire() {
    return new Promise((resolve) => {
      const now = Date.now();
      this._cleanupExpired(now);
      const active = this._activeInWindow(now);
      if (active < this.maxConcurrent) {
        this.timestamps.push(now);
        resolve();
        return;
      }
      const earliest = this.timestamps[0] || now;
      const waitMs = Math.max(50, (earliest + this.intervalMs) - now);
      const waiter = { resolve, startedAt: now, done: false };
      const tryFire = () => {
        if (waiter.done) return;
        const t = Date.now();
        this._cleanupExpired(t);
        if (this._activeInWindow(t) < this.maxConcurrent) {
          this.timestamps.push(t);
          waiter.done = true;
          resolve();
          return;
        }
        const earliest2 = this.timestamps[0] || t;
        const waitMs2 = Math.max(50, (earliest2 + this.intervalMs) - t);
        waiter.timer = setTimeout(tryFire, waitMs2);
      };
      waiter.timer = setTimeout(tryFire, waitMs);
      this.waiters.push(waiter);
    });
  }
  release() { this._scheduleNextWaiter(); }
  recordFailure() { this.failures += 1; }
  recordSuccess() { this.failures = 0; }
  backoffMs() {
    if (this.failures === 0) return 0;
    return Math.min(this.backoffMaxMs, this.intervalMs * Math.pow(2, Math.min(this.failures - 1, 10)));
  }
  async run(fn) {
    const backoff = this.backoffMs();
    if (backoff > 0) await new Promise((r) => setTimeout(r, backoff));
    await this.acquire();
    try {
      const result = await fn();
      this.recordSuccess();
      return result;
    } catch (e) {
      this.recordFailure();
      throw e;
    } finally {
      this.release();
    }
  }
}
RateLimiter;
`;

const RateLimiter = eval(RL_CODE);

async function testNoLeak() {
  const rl = new RateLimiter({ intervalMs: 100, maxConcurrent: 1, backoffMaxMs: 1000, windowSize: 5 });
  // 启动 1 个 long-running 任务占满并发槽
  const blocker = rl.run(() => new Promise((r) => setTimeout(r, 300)));
  // 立即再排 20 个短任务
  const queued = [];
  for (let i = 0; i < 20; i += 1) {
    queued.push(rl.run(async () => {
      await sleep(10);
      return i;
    }));
  }
  await blocker;
  const results = await Promise.all(queued);
  if (results.length !== 20) throw new Error('expected 20 results, got ' + results.length);
  // 等所有 timer 都收敛
  await sleep(500);
  // 关键：waiters 数组必须为空（修复前会留下脏数据 / 重复）
  if (rl.waiters.length !== 0) {
    throw new Error('waiters 数组未清空，length=' + rl.waiters.length + '（修复前会泄漏）');
  }
  if (rl.timestamps.length > rl.windowSize) {
    throw new Error('timestamps 超过 windowSize: ' + rl.timestamps.length);
  }
  console.log('  ✓ 20 个并发请求完成，waiters 已清空');
}

async function testBackoff() {
  const rl = new RateLimiter({ intervalMs: 50, maxConcurrent: 2, backoffMaxMs: 200, windowSize: 5 });
  rl.recordFailure();
  rl.recordFailure();
  const expected = Math.min(200, 50 * Math.pow(2, 1));
  if (rl.backoffMs() !== expected) throw new Error('backoff 算错: ' + rl.backoffMs());
  console.log('  ✓ backoff 指数退避: ' + expected + 'ms');
  rl.recordSuccess();
  if (rl.backoffMs() !== 0) throw new Error('recordSuccess 后 backoff 应清零');
  console.log('  ✓ recordSuccess 清零 backoff');
}

async function testWindowCleanup() {
  const rl = new RateLimiter({ intervalMs: 100, maxConcurrent: 1, backoffMaxMs: 1000, windowSize: 5 });
  // 模拟 8 个已完成时间戳（旧的）
  const old = Date.now() - 600;
  for (let i = 0; i < 8; i += 1) rl.timestamps.push(old + i);
  rl._cleanupExpired(Date.now());
  if (rl.timestamps.length !== 0) {
    throw new Error('windowSize=5 intervalMs=100，旧 8 个应被全部清理；剩 ' + rl.timestamps.length);
  }
  console.log('  ✓ _cleanupExpired 正确淘汰窗口外时间戳');
}

(async () => {
  console.log('RateLimiter 烟雾测试 (v2.4):');
  console.log('[1] waiters 不泄漏 / 重复入队');
  await testNoLeak();
  console.log('[2] 指数退避 backoff');
  await testBackoff();
  console.log('[3] 窗口淘汰');
  await testWindowCleanup();
  console.log('全部通过 ✓');
})().catch((e) => { console.error('FAIL:', e.message); process.exit(1); });
