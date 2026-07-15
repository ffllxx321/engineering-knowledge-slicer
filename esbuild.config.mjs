import esbuild from "esbuild";
import process from "process";
import builtins from "builtin-modules";
import { readFileSync } from "fs";

const banner = `/*
THIS IS A GENERATED/MANIFEST-BUNDLED FILE BY ESBUILD
If you want to view the source, please refer to the source files in src/
*/
`;

// v2.3 (M-03) ESM 切包可行性研究
// 当前发布形态仍是 IIFE CommonJS bundle（main.js 自包含）。
// 完整 ESM 切换见 docs/ESM_FEASIBILITY.md，留 v3.0 独立 PR。
//
// 本脚本的两种调用模式：
//   1) node esbuild.config.mjs           → watch 模式，校验语法
//   2) node esbuild.config.mjs production → 重新打包（不会改 main.js 内部 IIFE）
//
// 注意：src/main.js 在 v2.3 是占位文件，跑 npm run dev 会立刻抛错。
//       这是预期行为：v2.3 不真正切包。

const prod = process.argv[2] === "production";

const context = await esbuild.context({
  banner: { js: banner },
  entryPoints: ["src/main.js"],
  bundle: true,
  external: [
    "obsidian",
    "electron",
    "@codemirror/autocomplete",
    "@codemirror/collab",
    "@codemirror/commands",
    "@codemirror/language",
    "@codemirror/lint",
    "@codemirror/search",
    "@codemirror/state",
    "@codemirror/view",
    "@lezer/common",
    "@lezer/highlight",
    "@lezer/lr",
    ...builtins
  ],
  format: "cjs",
  target: "es2020",
  logLevel: "info",
  sourcemap: prod ? false : "inline",
  treeShaking: true,
  outfile: "main.js",
  minify: prod,
});

if (prod) {
  await context.rebuild();
  process.exit(0);
} else {
  await context.watch();
}
