"use strict";
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const { externalCorpusAcceptance, root, safeSources } = require("./acceptance-real.js");

function task(overrides = {}) {
  return {
    source_origin: "external", source_hash: "a".repeat(64), source_type: "docx",
    source_size_bucket: "1KiB_1MiB", status: "stored", production_state: "stored",
    terminal_outcome: "completed_with_output", cards: [{ content_hash: "b".repeat(64), bytes: 123, quality_ok: true, quality_reasons: [] }],
    counts: { verified: 1 }, error_codes: [], errors: [], source_path: "/secret/client-name.docx",
    source_text: "DO NOT LEAK THIS SOURCE", prompt: "DO NOT LEAK THIS PROMPT",
    provider_response: "DO NOT LEAK THIS RESPONSE", ...overrides,
  };
}

const healthy = externalCorpusAcceptance([task()], 1);
assert.strictEqual(healthy.passed, true);
assert.deepStrictEqual(healthy.metrics, { supplied: 1, observed: 1, successful: 1, unsuccessful: 0, status_counts: { stored: 1 } });
for (const failed of [
  task({ status: "failed", production_state: "failed", terminal_outcome: "failed", cards: [], counts: { verified: 0 }, error_codes: ["INTERNAL_UNEXPECTED"] }),
  task({ status: "needs_review", production_state: "pending_confirmation", terminal_outcome: null }),
  task({ status: "unsupported", production_state: "failed", terminal_outcome: "failed" }),
  task({ cards: [] }), task({ counts: { verified: 0 } }),
  task({ cards: [{ content_hash: "b".repeat(64), bytes: 123, quality_ok: false, quality_reasons: ["mojibake"] }] }),
]) assert.strictEqual(externalCorpusAcceptance([failed], 1).passed, false);
assert.strictEqual(externalCorpusAcceptance([], 1).checks.external_corpus_accounted, false);
assert.strictEqual(externalCorpusAcceptance([task({ source_origin: "fixture" })], 0).passed, true);

const serialized = JSON.stringify(safeSources([task({ error_codes: ["INTERNAL_UNEXPECTED"], errors: [{ code: "INTERNAL_UNEXPECTED", message: "secret" }] })]));
for (const forbidden of ["client-name", "DO NOT LEAK", "source_path", "source_text", "prompt", "provider_response", "secret"])
  assert(!serialized.includes(forbidden), `redaction leaked ${forbidden}`);
assert(serialized.includes("INTERNAL_UNEXPECTED"));

const env = { ...process.env }; delete env.EKS_ACCEPTANCE_MINIMAX_API_KEY;
const provider = spawnSync(process.execPath, [path.join(root, "scripts/acceptance-provider-real.js")], { cwd: root, env, encoding: "utf8" });
assert.strictEqual(provider.status, 0, provider.stderr);
const providerReport = JSON.parse(fs.readFileSync(path.join(root, "test-artifacts/acceptance-provider-real.json"), "utf8"));
assert.strictEqual(providerReport.passed, false);
assert.strictEqual(providerReport.provider.status, "not_run");
assert(providerReport.failures.includes("provider_secret_absent"));
console.log("acceptance truthfulness regression: external gates, redaction, and provider not_run semantics passed");
