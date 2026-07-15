// v2.3 ESM 切包可行性研究占位文件
//
// 当前 v2.3 不真正切包（IIFE CommonJS bundle 仍是发布形态）。
// 本文件存在的意义：让 esbuild config 有一个合法的 entryPoint 占位，
// 避免误指向不存在的 `src/main.ts`。
//
// v3.0 计划：
//   1. 把 IIFE 内的 22 个 factory 拆成 src/core/*.js
//   2. 改 esbuild.config.mjs 的 format: "cjs" → "esm"
//   3. main.js 入口 export default class extends Plugin
//
// 详见 docs/ESM_FEASIBILITY.md

throw new Error(
  '[EKS] src/main.js 是 v2.3 ESM 切包可行性研究的占位文件，不是真实入口。\n' +
  'Obsidian 应加载仓库根目录的 main.js（IIFE bundle）。\n' +
  '如需从 src/ 启动开发模式，请先按 docs/ESM_FEASIBILITY.md 第 5 节完成切包。'
);

export default {};
