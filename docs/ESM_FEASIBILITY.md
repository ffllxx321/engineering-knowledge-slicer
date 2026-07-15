# ESM 切包可行性研究 (M-03)

> **v2.3.0 — 2026-07-15**
> 评估把 `main.js`（5500+ 行 IIFE CommonJS bundle）切成真 ESM + src/ 树 的可行性、路径与风险。

## TL;DR

| 项目 | 当前 | 切 ESM 后 |
|------|------|-----------|
| 入口文件 | `main.js`（自包含 IIFE） | `main.js`（仍然单文件，但 esbuild 产出 ESM）+ 可选 `src/*.js` |
| Obsidian 要求 | 1.5+ | 1.5+（ESM 插件 1.5.0 起支持） |
| 内部代码组织 | 22 个 IIFE 模块用 `__modules[id] = function(require, module, exports)` 模拟 | 真 `import` / `export` |
| 跨模块通信 | `globalThis.__eksDiag` / `__eksUploadConfirm` 黑板 | 同上（黑板继续可用） |
| 估算工时 | — | 2-3 天切换 + 1-2 天回归测试 |
| 破坏性 | — | 中等：依赖此插件 fork / 二次开发者需要重新安装 |

**结论**：v2.3 仍发"研究 + 框架"版（不动 main.js 内部）；真切换留 v3.0 单独规划。

## 1. 现状

### 1.1 内部 IIFE 模式
main.js 顶部是：

```js
const __modules = {};
__modules["src/core/identity.js"] = function(require, module, exports) { ... };
__modules["src/core/tags.js"] = function(require, module, exports) { ... };
// ... 22 个

function __require(id) {
  const factory = __modules[id];
  if (!factory) throw new Error("Module not found: " + id);
  const module = { exports: {} };
  factory(__require, module, module.exports);
  return module.exports;
}
const { atomFingerprint } = require("src/core/identity.js");
```

每个模块是一个闭包工厂，模拟 CommonJS。优点：
- 单文件可加载（Obsidian 只读 main.js）
- 跨平台一致（macOS/Win/Linux/Android/iOS 都是同一份 JS）
- 没有 source map 暴露

缺点：
- IDE 不能 Go-to-Definition 跨模块（虽然 v2.1 加了 JSDoc，仍无法跳转）
- esbuild 把 src/ 树打包后，main.js 仍然是单 IIFE，等于白切

### 1.2 Obsidian 1.5+ ESM 支持
Obsidian 自 1.5.0 (2023-11) 起支持 ES module 插件，要求：
- `manifest.json` 不变（仍用 `id` / `version` / `main`）
- `main` 指向的 JS 文件**必须**用 ESM 语法（`import` / `export`）
- esbuild 打包时设 `format: "esm"`
- 不能用 CommonJS 风格的 `require` / `module.exports`

参考 [Obsidian 文档：Plugin guidelines](https://docs.obsidian.md/Plugins/Getting+started/Build+a+plugin)

## 2. 切包方案

### 2.1 最小破坏版本（推荐 v3.0 走这条）

```bash
src/
  main.js           # 入口（export default class extends Plugin）
  core/
    identity.js     # export function atomFingerprint(...) { ... }
    tags.js         # export function parseTagLibrary(...) { ... }
    markdown-renderer.js
    ...
  utils/
    diag.js
    fingerprint.js
```

esbuild 配置：
```js
{
  entryPoints: ["src/main.js"],
  bundle: true,
  format: "esm",
  target: "es2020",
  outfile: "main.js",
  external: ["obsidian", "electron", ...builtins]
}
```

产物仍是单 `main.js`（Obsidian 加载方式不变），但内部是 ESM。

### 2.2 真多文件版本（激进）

发 `manifest.json` 的 `main` 指向 `main.js`（esbuild 产物），但仓库内 `src/` 是真源文件：

```
工程知识切片/
  main.js              # 拉取时包含的 esbuild 产物
  src/                 # 开发者本地目录（不上传 / 或上传但不带 .map）
    main.js
    core/*.js
  esbuild.config.mjs
  package.json
  manifest.json
```

Obsidian 仍然只加载 `main.js`（打包产物），不直接读 src/。

## 3. 风险

| 风险 | 等级 | 说明 |
|------|------|------|
| 移动端兼容性 | 中 | iOS Obsidian 在 1.5+ 已支持 ESM 插件，但偶有缓存兼容问题 |
| 旧用户数据迁移 | 低 | 切包不影响 tasks.json / 卡片文件 schema |
| 黑板通信失效 | 中 | `globalThis.__eksDiag` 仍工作（`globalThis` 在所有 JS 模块里都是同一对象），但需要确认 Obsidian 1.7+ 没有引入多 worker 隔离 |
| 二次开发破坏 | 中 | fork 此插件的开发者需要重新 `npm install` 走 esbuild |
| 调试体验变差 | 低 | main.js 从 IIFE 字符串里只能看到 `module.exports` 的扁平函数名，不像 src/ 那么直观 |

## 4. v2.3 实际交付（框架版，不切）

- ✅ esbuild.config.mjs 修正：现在它指向不存在的 `src/main.ts`，本次**修正**为 `src/main.js` + `format: "cjs"`（保留 IIFE），并在配置中**注释**说明如何切到 ESM
- ✅ `src/main.js` 骨架文件：占位 + 提示语，让 `npm run dev` 在没有切包前输出友好错误
- ✅ 本文档

完整切换留 v3.0 单独 PR。

## 5. 切包 checklist（v3.0 用）

- [ ] 选 2.1 / 2.2 哪条路径
- [ ] 写迁移脚本：把 22 个 IIFE factory → 22 个 `export function ...`
- [ ] 把 `__require` → `import`
- [ ] 修 esbuild config：`format: "esm"`、`platform: "browser"`
- [ ] 移动端 (iOS) 端到端测一遍
- [ ] 二次开发者文档更新（README）
- [ ] 备份 v2.3 main.js 做紧急回滚锚点
